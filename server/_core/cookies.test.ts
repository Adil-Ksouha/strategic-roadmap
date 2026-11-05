import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

function requestForCookieOptions(input: { hostname: string; protocol: string; forwardedProto?: string }): Request {
  return {
    hostname: input.hostname,
    protocol: input.protocol,
    headers: input.forwardedProto ? { "x-forwarded-proto": input.forwardedProto } : {},
  } as Request;
}

describe("session cookie options", () => {
  it("uses a secure first-party cookie when HTTPS is forwarded by the EC2 reverse proxy", () => {
    const options = getSessionCookieOptions(requestForCookieOptions({ hostname: "54-156-192-70.nip.io", protocol: "http", forwardedProto: "https" }));
    expect(options).toMatchObject({ httpOnly: true, path: "/", sameSite: "lax", secure: true });
  });

  it("keeps local development cookies usable without requiring HTTPS", () => {
    const options = getSessionCookieOptions(requestForCookieOptions({ hostname: "localhost", protocol: "http" }));
    expect(options).toMatchObject({ sameSite: "lax", secure: false });
  });
});
