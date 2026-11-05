import { describe, expect, it } from "vitest";
import { clearNorthstarSession, createGoogleAuthorizationUrl, getTrustedOrigin, isEmailAuthorizedForPlatform } from "./googleAuth";
import { ENV } from "./_core/env";

describe("Google federation helpers", () => {
  it("has a valid configured executive administrator email for platform access", () => {
    expect(ENV.platformAdminEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("accepts the configured Google OAuth client credentials at the token endpoint", async () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();
    const body = new URLSearchParams({
      code: "northstar_configuration_probe",
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      redirect_uri: "https://stratportf-phejj5qh.manus.space/api/auth/google/callback",
      grant_type: "authorization_code",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const payload = await response.json() as { error?: string };
    expect(payload.error).not.toBe("invalid_client");
  }, 20_000);

  it("allows secure hosted platform origins and rejects untrusted origins", () => {
    expect(getTrustedOrigin("https://northstar.manus.space")).toBe("https://northstar.manus.space");
    expect(getTrustedOrigin("https://northstar.awsapprunner.com")).toBe(process.env.APP_BASE_URL === "https://northstar.awsapprunner.com" ? "https://northstar.awsapprunner.com" : null);
    expect(getTrustedOrigin("https://untrusted.example.com")).toBeNull();
  });

  it("creates a Google authorization request with a safe return URI and login hint", () => {
    const url = new URL(createGoogleAuthorizationUrl({ clientId: "client-id", origin: "https://northstar.manus.space", nonce: "state-nonce", email: "planner@gmail.com" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://northstar.manus.space/api/auth/google/callback");
    expect(url.searchParams.get("login_hint")).toBe("planner@gmail.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("allows only an approved email or the configured executive administrator into the platform", () => {
    expect(isEmailAuthorizedForPlatform({ email: "engineer@example.com", platformAdminEmail: "admin@example.com", hasAccessGrant: true })).toBe(true);
    expect(isEmailAuthorizedForPlatform({ email: "ADMIN@example.com", platformAdminEmail: "admin@example.com", hasAccessGrant: false })).toBe(true);
    expect(isEmailAuthorizedForPlatform({ email: "unapproved@example.com", platformAdminEmail: "admin@example.com", hasAccessGrant: false })).toBe(false);
  });

  it("clears the Northstar platform session cookie using secure browser settings", () => {
    const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
    const req = { protocol: "https", headers: {} } as any;
    const res = { clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }) } as any;
    clearNorthstarSession(req, res);
    expect(cleared).toEqual([{ name: "app_session_id", options: expect.objectContaining({ maxAge: -1, httpOnly: true, secure: true, sameSite: "lax", path: "/" }) }]);
  });
});
