import { createHash, randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";

const GOOGLE_STATE_COOKIE = "__Host-northstar_google_state";
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type GoogleState = { nonce: string; origin: string };

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): GoogleState | null {
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof data?.nonce !== "string" || typeof data?.origin !== "string") return null;
    return data as GoogleState;
  } catch {
    return null;
  }
}

export function getTrustedOrigin(origin: string | undefined) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    const isHostedByManus = hostname.endsWith(".manus.space") || hostname.endsWith(".manus.computer");
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    const isConfiguredProductionOrigin = Boolean(ENV.appBaseUrl) && url.origin === ENV.appBaseUrl;
    if ((url.protocol === "https:" && (isHostedByManus || isConfiguredProductionOrigin)) || (url.protocol === "http:" && isLocal)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export function createGoogleAuthorizationUrl(input: { clientId: string; origin: string; nonce: string; email?: string }) {
  const redirectUri = `${input.origin}/api/auth/google/callback`;
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", toBase64Url(JSON.stringify({ nonce: input.nonce, origin: input.origin })));
  url.searchParams.set("nonce", randomUUID());
  url.searchParams.set("prompt", "select_account");
  if (input.email) url.searchParams.set("login_hint", input.email);
  return url.toString();
}

export function isEmailAuthorizedForPlatform(input: { email: string; platformAdminEmail?: string; hasAccessGrant: boolean }) {
  const email = input.email.trim().toLowerCase();
  return Boolean(input.platformAdminEmail && email === input.platformAdminEmail.trim().toLowerCase()) || input.hasAccessGrant;
}

function configurationError(res: Response) {
  return res.redirect(302, "/?authError=google_configuration");
}

function errorRedirect(res: Response, origin: string, reason: string) {
  const url = new URL(origin);
  url.searchParams.set("authError", reason);
  return res.redirect(302, url.toString());
}

export function clearNorthstarSession(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
}

async function exchangeCode(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    code,
    client_id: ENV.googleClientId,
    client_secret: ENV.googleClientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return response.json() as Promise<{ id_token?: string }>;
}

export function registerGoogleAuthRoutes(app: Express) {
  app.get("/api/auth/logout", (req: Request, res: Response) => {
    clearNorthstarSession(req, res);
    return res.redirect(302, "/?signedOut=1");
  });

  app.get("/api/auth/google/start", (req: Request, res: Response) => {
    if (!ENV.googleClientId || !ENV.googleClientSecret) return configurationError(res);
    const origin = getTrustedOrigin(typeof req.query.origin === "string" ? req.query.origin : undefined);
    if (!origin) return res.status(400).json({ error: "A valid application origin is required." });
    const email = typeof req.query.email === "string" && req.query.email.length <= 320 ? req.query.email : undefined;
    const nonce = randomUUID();
    res.cookie(GOOGLE_STATE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 10 * 60 * 1000 });
    return res.redirect(302, createGoogleAuthorizationUrl({ clientId: ENV.googleClientId, origin, nonce, email }));
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const stateValue = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = stateValue ? fromBase64Url(stateValue) : null;
    const origin = state ? getTrustedOrigin(state.origin) : null;
    const expectedNonce = parseCookie(req.headers.cookie ?? "")[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: "/", secure: true, sameSite: "lax" });
    if (!origin) return res.status(400).json({ error: "Invalid sign-in return address." });
    if (!code || !state || !expectedNonce || state.nonce !== expectedNonce) return errorRedirect(res, origin, "google_state");
    if (!ENV.googleClientId || !ENV.googleClientSecret) return errorRedirect(res, origin, "google_configuration");

    try {
      const token = await exchangeCode(code, `${origin}/api/auth/google/callback`);
      if (!token.id_token) throw new Error("Google did not provide an ID token.");
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({ idToken: token.id_token, audience: ENV.googleClientId });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || profile.email_verified !== true) throw new Error("Google account email could not be verified.");

      const openId = createHash("sha256").update(`google:${profile.sub}`).digest("hex");
      const normalizedEmail = profile.email.trim().toLowerCase();
      const hasAccessGrant = await db.hasTeamAccessGrant(normalizedEmail);
      const isPlatformAdmin = Boolean(ENV.platformAdminEmail) && normalizedEmail === ENV.platformAdminEmail;
      if (!isEmailAuthorizedForPlatform({ email: normalizedEmail, platformAdminEmail: ENV.platformAdminEmail, hasAccessGrant })) return errorRedirect(res, origin, "access_denied");
      await db.upsertUser({ openId, name: profile.name ?? null, email: profile.email, loginMethod: "google", role: isPlatformAdmin ? "admin" : undefined, lastSignedIn: new Date() });
      const user = await db.getUserByOpenId(openId);
      if (user?.email) await db.applyTeamAccessGrant(user.id, user.email);
      const sessionToken = await sdk.createSessionToken(openId, { name: profile.name ?? profile.email, expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      return res.redirect(302, origin);
    } catch (error) {
      console.error("[GoogleAuth] Callback failed", error);
      return errorRedirect(res, origin, "google_authentication");
    }
  });
}
