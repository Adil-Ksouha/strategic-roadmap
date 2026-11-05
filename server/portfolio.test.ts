import { describe, expect, it } from "vitest";

const investments = [
  { planningYear: 2026, amountSarM: 2.1 },
  { planningYear: 2026, amountSarM: 3.8 },
  { planningYear: 2027, amountSarM: 5.2 },
];

function summarizeAnnualInvestment(
  rows: Array<{ planningYear: number; amountSarM: number }>
) {
  return rows.reduce<Record<number, number>>((summary, row) => {
    summary[row.planningYear] =
      (summary[row.planningYear] ?? 0) + row.amountSarM;
    return summary;
  }, {});
}

describe("portfolio financial rollups", () => {
  it("aggregates investment values by planning year", () => {
    expect(summarizeAnnualInvestment(investments)).toEqual({
      2026: 5.9,
      2027: 5.2,
    });
  });
});
