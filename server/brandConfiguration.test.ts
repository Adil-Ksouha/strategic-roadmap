import { describe, expect, it } from "vitest";

describe("managed application branding", () => {
  it("uses the configured Strategic Roadmap application title", () => {
    expect(process.env.VITE_APP_TITLE).toBe("Strategic Roadmap");
  });
});
