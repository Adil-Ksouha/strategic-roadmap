import { describe, expect, it } from "vitest";
import { hashLocalPassword, isBootstrapTokenValid, verifyLocalPassword } from "./localAuth";

describe("private local account authentication", () => {
  it("hashes passwords with a unique salt and verifies only the correct password", () => {
    const first = hashLocalPassword("A private password that is long enough");
    const second = hashLocalPassword("A private password that is long enough");
    expect(first).not.toBe(second);
    expect(verifyLocalPassword("A private password that is long enough", first)).toBe(true);
    expect(verifyLocalPassword("A different private password", first)).toBe(false);
  });

  it("accepts only the configured bootstrap token without exposing its value", () => {
    const configuredToken = process.env.LOCAL_AUTH_BOOTSTRAP_TOKEN;
    expect(configuredToken).toBeTruthy();
    expect(isBootstrapTokenValid(configuredToken ?? "", configuredToken)).toBe(true);
    expect(isBootstrapTokenValid("incorrect-bootstrap-token", configuredToken)).toBe(false);
  });
});
