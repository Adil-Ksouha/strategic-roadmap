import { describe, expect, it } from "vitest";
import { sarM } from "../shared/currency";

describe("Saudi Riyal monetary formatting", () => {
  it("presents direct Saudi Riyal amounts in millions without a currency conversion", () => {
    expect(sarM(46.5)).toBe("SAR 46.5M");
    expect(sarM(10, 0)).toBe("SAR 10M");
    expect(sarM(10)).toBe("SAR 10.0M");
  });
});
