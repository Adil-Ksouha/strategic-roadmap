import { describe, expect, it } from "vitest";
import { HEALTH_RESPONSE } from "./health";

describe("deployment health response", () => {
  it("returns the stable lightweight health payload used by the load balancer", () => {
    expect(HEALTH_RESPONSE).toEqual({ status: "ok" });
  });
});
