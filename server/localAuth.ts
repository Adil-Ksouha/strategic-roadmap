import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { teamAccessGrants, teamMemberships, users } from "../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";

export type LocalAccountInput = {
  email: string;
  name: string;
  password: string;
  teamId: number;
  teamRole: "lead" | "contributor";
  role?: "user" | "admin";
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function hashLocalPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const digest = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${digest}`;
}

export function verifyLocalPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;
  const [scheme, salt, expected] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function isBootstrapTokenValid(token: string, configuredToken: string | undefined) {
  if (!token || !configuredToken) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(configuredToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function databaseOrThrow() {
  const database = await getDb();
  if (!database) throw new Error("The platform account database is unavailable.");
  return database;
}

export async function hasLocalAdministrator() {
  const database = await databaseOrThrow();
  const result = await database.select({ id: users.id }).from(users).where(and(eq(users.loginMethod, "local"), eq(users.role, "admin"))).limit(1);
  return result.length > 0;
}

export async function createLocalAccount(input: LocalAccountInput) {
  const database = await databaseOrThrow();
  const email = normalizeEmail(input.email);
  const existing = await database.select({ id: users.id, openId: users.openId, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  const openId = existing[0]?.openId ?? createHash("sha256").update(`local:${email}`).digest("hex");
  const role = existing[0]?.role === "admin" ? "admin" : (input.role ?? "user");
  const passwordHash = hashLocalPassword(input.password);
  await database.insert(users).values({ openId, email, name: input.name.trim(), loginMethod: "local", passwordHash, isActive: "active", role, lastSignedIn: new Date() }).onDuplicateKeyUpdate({ set: { email, name: input.name.trim(), loginMethod: "local", passwordHash, isActive: "active", role } });
  const account = await database.select().from(users).where(eq(users.email, email)).limit(1);
  const user = account[0];
  if (!user) throw new Error("The platform account could not be created.");
  await database.insert(teamAccessGrants).values({ email, teamId: input.teamId, role: input.teamRole }).onDuplicateKeyUpdate({ set: { teamId: input.teamId, role: input.teamRole } });
  await database.delete(teamMemberships).where(eq(teamMemberships.userId, user.id));
  await database.insert(teamMemberships).values({ userId: user.id, teamId: input.teamId, role: input.teamRole });
  return user;
}

export async function bootstrapLocalAdministrator(input: LocalAccountInput & { bootstrapToken: string }) {
  if (!isBootstrapTokenValid(input.bootstrapToken, process.env.LOCAL_AUTH_BOOTSTRAP_TOKEN)) throw new Error("The setup token is invalid.");
  if (await hasLocalAdministrator()) throw new Error("A local administrator account has already been created.");
  return createLocalAccount({ ...input, role: "admin" });
}

export async function authenticateLocalAccount(emailInput: string, password: string) {
  const database = await databaseOrThrow();
  const email = normalizeEmail(emailInput);
  const result = await database.select().from(users).where(eq(users.email, email)).limit(1);
  const user = result[0];
  if (!user || user.loginMethod !== "local" || user.isActive !== "active" || !verifyLocalPassword(password, user.passwordHash)) return null;
  await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function resetLocalPassword(input: { userId: number; password: string }) {
  const database = await databaseOrThrow();
  await database.update(users).set({ passwordHash: hashLocalPassword(input.password), loginMethod: "local", isActive: "active" }).where(eq(users.id, input.userId));
}

export async function setLocalAccountStatus(input: { userId: number; isActive: "active" | "disabled" }) {
  const database = await databaseOrThrow();
  const matching = await database.select({ role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (matching[0]?.role === "admin" && input.isActive === "disabled") throw new Error("Administrator accounts cannot be disabled from this screen.");
  await database.update(users).set({ isActive: input.isActive }).where(eq(users.id, input.userId));
}

export async function removeLocalAccount(userId: number) {
  const database = await databaseOrThrow();
  const account = await database.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account[0]) throw new Error("The platform account no longer exists.");
  if (account[0].role === "admin") throw new Error("Administrator accounts cannot be removed from this screen.");
  await database.delete(teamMemberships).where(eq(teamMemberships.userId, userId));
  if (account[0].email) await database.delete(teamAccessGrants).where(eq(teamAccessGrants.email, account[0].email));
  await database.delete(users).where(eq(users.id, userId));
}

export function clearLocalSession(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
}

export function setLocalSession(req: Request, res: Response, user: { openId: string; name: string | null; email: string | null }) {
  return sdk.createSessionToken(user.openId, { name: user.name ?? user.email ?? "Platform user", expiresInMs: ONE_YEAR_MS }).then(token => {
    res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
  });
}

export function registerLocalAuthRoutes(app: Express) {
  app.get("/api/auth/logout", (req: Request, res: Response) => {
    clearLocalSession(req, res);
    return res.redirect(302, "/?signedOut=1");
  });
}
