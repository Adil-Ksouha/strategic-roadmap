import { describe, expect, it } from "vitest";
import { getSessionApplicationId, PRIVATE_PLATFORM_SESSION_APP_ID } from "./sdk";

describe("self-hosted local account session identity", () => {
  it("uses a stable private-platform identifier when no Manus OAuth application ID is configured", () => {
    expect(getSessionApplicationId("")).toBe(PRIVATE_PLATFORM_SESSION_APP_ID);
  });

  it("retains a configured application identifier when one is available", () => {
    expect(getSessionApplicationId(" configured-app ")).toBe("configured-app");
  });
});
