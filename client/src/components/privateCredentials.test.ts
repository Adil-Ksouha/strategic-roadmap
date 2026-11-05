import { describe, expect, it } from "vitest";
import { normalizePrivateCredentialFields } from "./privateCredentials";

describe("private credential form values", () => {
  it("preserves passwords and normalizes submitted account fields", () => {
    expect(normalizePrivateCredentialFields({ email: " admin@example.com ", password: "Private password 123!", name: " Executive ", bootstrapToken: "token-17-characters", teamId: "2" })).toEqual({
      email: "admin@example.com",
      password: "Private password 123!",
      name: "Executive",
      bootstrapToken: "token-17-characters",
      teamId: "2",
    });
  });
});
