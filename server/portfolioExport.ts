import ExcelJS from "exceljs";
import PptxGenJSImport from "pptxgenjs";

const PptxGenJSConstructor = ((
  PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }
).default ?? PptxGenJSImport) as typeof PptxGenJSImport;

type Capability = {
  id: number;
  name: string;
  domain: string;
  description: string;
  owner: string;
  maturity: string;
  criticality: string;
  targetYear: number;
  teamId: number | null;
};

type StrategicObjective = {
  id: number;
  name: string;
  theme: string;
  description: string;
  outcome: string;
  sponsor: string;
  status: string;
  priority: string;
  startYear: number;
  endYear: number;
  teamId: number | null;
  scope: "team" | "shared";
};

type Relationship = {
  id: number;
  useCaseId: number;
  capabilityId: number;
  contribution: string;
};

type Milestone = {
  id: number;
  useCaseId: number;
  planningYear: number;
  phase: string;
  title: string;
  status: string;
  sourceCapabilityId: number | null;
};

type Investment = {
  useCaseId: number;
  planningYear: number;
  budgetType: "internal" | "external";
  amountSarM: number;
};

type Team = { id: number; name: string };
type KpiDefinition = {
  id: number;
  code: string;
  name: string;
  strategicPillar: string;
  theme: string;
  unit: string;
};
type CapabilityKpi = { capabilityId: number; kpiId: number };

export type PortfolioExportSnapshot = {
  capabilities: Capability[];
  useCases: StrategicObjective[];
  relationships: Relationship[];
  milestones: Milestone[];
  investments: Investment[];
  teams: Team[];
  financialYears: number[];
  kpis: KpiDefinition[];
  capabilityKpis: CapabilityKpi[];
};

export type PortfolioExportFormat = "excel" | "powerpoint";

export type PortfolioExportFile = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

const COLORS = {
  ink: "100B16",
  inkSoft: "16101F",
  panel: "1E1228",
  panelRaised: "291735",
  violet: "7C2FC8",
  violetDeep: "4F1F78",
  lilac: "D8B4FE",
  cyan: "A5F3FC",
  rose: "E11D48",
  roseSoft: "FB7185",
  mint: "6EE7B7",
  white: "FFFFFF",
  muted: "B9AFC4",
  line: "4C3A58",
} as const;

const PPT_WIDTH = 13.333;
const PPT_HEIGHT = 7.5;

const safeFileDate = () => new Date().toISOString().slice(0, 10);

function teamName(teams: Team[], teamId: number | null) {
  return teams.find(team => team.id === teamId)?.name ?? "All domains";
}

function formatSarM(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} SAR M`;
}

function formatSarMCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function objectiveScope(objective: StrategicObjective, teams: Team[]) {
  return objective.scope === "shared"
    ? "All domains · shared"
    : teamName(teams, objective.teamId);
}

function kpiCoverage(snapshot: PortfolioExportSnapshot) {
  const kpiIdsByCapability = snapshot.capabilityKpis.reduce<
    Record<number, number[]>
  >((result, mapping) => {
    result[mapping.capabilityId] = [
      ...(result[mapping.capabilityId] ?? []),
      mapping.kpiId,
    ];
    return result;
  }, {});
  const mapped = snapshot.capabilities.filter(
    capability => (kpiIdsByCapability[capability.id] ?? []).length > 0
  );
  const unmapped = snapshot.capabilities.filter(
    capability => (kpiIdsByCapability[capability.id] ?? []).length === 0
  );
  return { kpiIdsByCapability, mapped, unmapped };
}

function addExcelSheet(
  workbook: ExcelJS.Workbook,
  title: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, string | number | null>[]
) {
  const sheet = workbook.addWorksheet(title, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F1F78" },
  };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rows.length + 1, 1), column: columns.length },
  };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    row.height = rowNumber === 1 ? 24 : 32;
    row.eachCell(cell => {
      cell.border = {
        top: { style: "hair", color: { argb: "FFE9D5FF" } },
        left: { style: "hair", color: { argb: "FFE9D5FF" } },
        bottom: { style: "hair", color: { argb: "FFE9D5FF" } },
        right: { style: "hair", color: { argb: "FFE9D5FF" } },
      };
    });
  });
  return sheet;
}

export async function createExcelExport(snapshot: PortfolioExportSnapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Strategic Roadmap";
  workbook.created = new Date();
  const coverage = kpiCoverage(snapshot);

  addExcelSheet(
    workbook,
    "Portfolio summary",
    [
      { header: "Measure", key: "measure", width: 36 },
      { header: "Value", key: "value", width: 24 },
    ],
    [
      { measure: "Strategic Objectives", value: snapshot.useCases.length },
      { measure: "Capabilities", value: snapshot.capabilities.length },
      { measure: "KPI catalogue measures", value: snapshot.kpis.length },
      {
        measure: "Capabilities with KPI mappings",
        value: coverage.mapped.length,
      },
      {
        measure: "Capabilities without KPI mappings",
        value: coverage.unmapped.length,
      },
      {
        measure: "Capability connections",
        value: snapshot.relationships.length,
      },
      {
        measure: "Executive Roadmap milestones",
        value: snapshot.milestones.length,
      },
      {
        measure: "Financial planning years",
        value: snapshot.financialYears.length,
      },
      {
        measure: "Total allocated budget (SAR M)",
        value: snapshot.investments.reduce(
          (total, item) => total + item.amountSarM,
          0
        ),
      },
    ]
  );

  addExcelSheet(
    workbook,
    "Capabilities",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Capability", key: "name", width: 34 },
      { header: "Domain", key: "domain", width: 22 },
      { header: "Owner", key: "owner", width: 24 },
      { header: "Team", key: "team", width: 26 },
      { header: "Maturity", key: "maturity", width: 16 },
      { header: "Criticality", key: "criticality", width: 16 },
      { header: "Target year", key: "targetYear", width: 14 },
      { header: "KPI coverage", key: "kpiCoverage", width: 22 },
      { header: "KPI count", key: "kpiCount", width: 12 },
      { header: "Mapped KPIs", key: "mappedKpis", width: 64 },
      { header: "Description", key: "description", width: 55 },
    ],
    snapshot.capabilities.map(capability => ({
      ...capability,
      team: teamName(snapshot.teams, capability.teamId),
      kpiCount: (coverage.kpiIdsByCapability[capability.id] ?? []).length,
      kpiCoverage:
        (coverage.kpiIdsByCapability[capability.id] ?? []).length > 0
          ? "Mapped"
          : "Unmapped / action required",
      mappedKpis: (coverage.kpiIdsByCapability[capability.id] ?? [])
        .map(kpiId => snapshot.kpis.find(kpi => kpi.id === kpiId))
        .filter((kpi): kpi is KpiDefinition => Boolean(kpi))
        .map(kpi => `${kpi.code}: ${kpi.name}`)
        .join("\n"),
    }))
  );

  addExcelSheet(
    workbook,
    "KPI Catalogue",
    [
      { header: "Code", key: "code", width: 14 },
      { header: "KPI measure", key: "name", width: 54 },
      { header: "Strategic pillar", key: "strategicPillar", width: 34 },
      { header: "Theme", key: "theme", width: 34 },
      { header: "Unit / measurement", key: "unit", width: 24 },
    ],
    snapshot.kpis
  );

  addExcelSheet(
    workbook,
    "Capability KPI Map",
    [
      { header: "Capability", key: "capability", width: 38 },
      { header: "Domain", key: "domain", width: 25 },
      { header: "KPI code", key: "code", width: 14 },
      { header: "KPI measure", key: "name", width: 54 },
      { header: "Strategic pillar", key: "strategicPillar", width: 34 },
      { header: "Theme", key: "theme", width: 34 },
      { header: "Unit", key: "unit", width: 22 },
    ],
    snapshot.capabilityKpis.map(mapping => {
      const capability = snapshot.capabilities.find(
        item => item.id === mapping.capabilityId
      );
      const kpi = snapshot.kpis.find(item => item.id === mapping.kpiId);
      return {
        capability: capability?.name ?? `Capability #${mapping.capabilityId}`,
        domain: capability?.domain ?? "Unknown",
        code: kpi?.code ?? `KPI #${mapping.kpiId}`,
        name: kpi?.name ?? "Unknown KPI",
        strategicPillar: kpi?.strategicPillar ?? "Unknown",
        theme: kpi?.theme ?? "Unknown",
        unit: kpi?.unit ?? "Unknown",
      };
    })
  );

  addExcelSheet(
    workbook,
    "Strategic Objectives",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Strategic Objective", key: "name", width: 34 },
      { header: "Scope", key: "scope", width: 24 },
      { header: "Theme", key: "theme", width: 20 },
      { header: "Sponsor", key: "sponsor", width: 26 },
      { header: "Status", key: "status", width: 16 },
      { header: "Priority", key: "priority", width: 12 },
      { header: "Start year", key: "startYear", width: 14 },
      { header: "End year", key: "endYear", width: 14 },
      { header: "Outcome", key: "outcome", width: 55 },
      { header: "Description", key: "description", width: 55 },
    ],
    snapshot.useCases.map(objective => ({
      ...objective,
      scope: objectiveScope(objective, snapshot.teams),
    }))
  );

  addExcelSheet(
    workbook,
    "Relationships",
    [
      { header: "Strategic Objective", key: "objective", width: 36 },
      { header: "Capability", key: "capability", width: 36 },
      { header: "Contribution", key: "contribution", width: 18 },
    ],
    snapshot.relationships.map(link => ({
      objective:
        snapshot.useCases.find(item => item.id === link.useCaseId)?.name ??
        `Objective #${link.useCaseId}`,
      capability:
        snapshot.capabilities.find(item => item.id === link.capabilityId)
          ?.name ?? `Capability #${link.capabilityId}`,
      contribution: link.contribution,
    }))
  );

  addExcelSheet(
    workbook,
    "Executive Roadmap",
    [
      { header: "Planning year", key: "planningYear", width: 15 },
      { header: "Strategic Objective", key: "objective", width: 36 },
      { header: "Milestone", key: "title", width: 40 },
      { header: "Phase", key: "phase", width: 16 },
      { header: "Status", key: "status", width: 16 },
      { header: "Source capability", key: "sourceCapability", width: 34 },
    ],
    snapshot.milestones.map(milestone => ({
      ...milestone,
      objective:
        snapshot.useCases.find(item => item.id === milestone.useCaseId)?.name ??
        `Objective #${milestone.useCaseId}`,
      sourceCapability: milestone.sourceCapabilityId
        ? (snapshot.capabilities.find(
            item => item.id === milestone.sourceCapabilityId
          )?.name ?? `Capability #${milestone.sourceCapabilityId}`)
        : "Manual milestone",
    }))
  );

  const financialSheet = addExcelSheet(
    workbook,
    "Financial Roadmap",
    [
      { header: "Planning year", key: "planningYear", width: 15 },
      { header: "Strategic Objective", key: "objective", width: 36 },
      { header: "Scope", key: "scope", width: 24 },
      { header: "Budget type", key: "budgetType", width: 16 },
      { header: "Amount (SAR M)", key: "amountSarM", width: 18 },
    ],
    snapshot.investments.map(investment => {
      const objective = snapshot.useCases.find(
        item => item.id === investment.useCaseId
      );
      return {
        planningYear: investment.planningYear,
        objective: objective?.name ?? `Objective #${investment.useCaseId}`,
        scope: objective
          ? objectiveScope(objective, snapshot.teams)
          : "Unknown",
        budgetType:
          investment.budgetType === "external" ? "External" : "Internal",
        amountSarM: investment.amountSarM,
      };
    })
  );
  financialSheet.getColumn("amountSarM").numFmt = '0.0 "SAR M"';

  const totalsByYear = snapshot.financialYears.map(year => ({
    planningYear: year,
    internalSarM: snapshot.investments
      .filter(
        item => item.planningYear === year && item.budgetType === "internal"
      )
      .reduce((total, item) => total + item.amountSarM, 0),
    externalSarM: snapshot.investments
      .filter(
        item => item.planningYear === year && item.budgetType === "external"
      )
      .reduce((total, item) => total + item.amountSarM, 0),
    amountSarM: snapshot.investments
      .filter(item => item.planningYear === year)
      .reduce((total, item) => total + item.amountSarM, 0),
  }));
  const summarySheet = addExcelSheet(
    workbook,
    "Financial Summary",
    [
      { header: "Planning year", key: "planningYear", width: 16 },
      { header: "Internal budget (SAR M)", key: "internalSarM", width: 24 },
      { header: "External budget (SAR M)", key: "externalSarM", width: 24 },
      { header: "Total budget (SAR M)", key: "amountSarM", width: 24 },
    ],
    totalsByYear
  );
  summarySheet.getColumn("internalSarM").numFmt = '0.0 "SAR M"';
  summarySheet.getColumn("externalSarM").numFmt = '0.0 "SAR M"';
  summarySheet.getColumn("amountSarM").numFmt = '0.0 "SAR M"';

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addPptHeader(
  slide: PptxGenJSImport.Slide,
  eyebrow: string,
  title: string
) {
  slide.background = { color: COLORS.ink };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: PPT_WIDTH,
    h: 0.1,
    fill: { color: COLORS.violet },
    line: { color: COLORS.violet },
  });
  slide.addShape("rect", {
    x: 0,
    y: 0.1,
    w: 0.12,
    h: PPT_HEIGHT - 0.1,
    fill: { color: COLORS.violetDeep },
    line: { color: COLORS.violetDeep },
  });
  slide.addShape("rect", {
    x: 0.12,
    y: 0.1,
    w: PPT_WIDTH - 0.12,
    h: 1.18,
    fill: { color: COLORS.inkSoft, transparency: 4 },
    line: { color: COLORS.inkSoft, transparency: 100 },
  });
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.62,
    y: 0.39,
    w: 5.5,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 6.8,
    charSpacing: 1.4,
    color: COLORS.lilac,
    bold: true,
    margin: 0,
  });
  slide.addText(title, {
    x: 0.62,
    y: 0.68,
    w: 9.6,
    h: 0.45,
    fontFace: "Aptos Display",
    fontSize: 24,
    color: COLORS.white,
    bold: true,
    margin: 0,
  });
  slide.addText("Strategic Roadmap", {
    x: 10.15,
    y: 0.43,
    w: 2.2,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 7.2,
    color: COLORS.muted,
    align: "right",
    margin: 0,
  });
  slide.addText("EXECUTIVE PORTFOLIO", {
    x: 10.15,
    y: 0.71,
    w: 2.2,
    h: 0.15,
    fontFace: "Aptos",
    fontSize: 5.8,
    color: COLORS.lilac,
    charSpacing: 1.05,
    align: "right",
    margin: 0,
  });
}

function addPptFooter(slide: PptxGenJSImport.Slide, page: number) {
  slide.addShape("line", {
    x: 0.62,
    y: 7.03,
    w: 12.16,
    h: 0,
    line: { color: COLORS.line, width: 0.5 },
  });
  slide.addText(`CONFIDENTIAL · STRATEGIC PORTFOLIO · ${safeFileDate()}`, {
    x: 0.62,
    y: 7.12,
    w: 5.5,
    h: 0.15,
    fontFace: "Aptos",
    fontSize: 6.2,
    charSpacing: 0.45,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText(String(page).padStart(2, "0"), {
    x: 12.2,
    y: 7.12,
    w: 0.55,
    h: 0.15,
    fontFace: "Aptos",
    fontSize: 6.5,
    color: COLORS.muted,
    align: "right",
    margin: 0,
  });
}

function addPptMetric(
  slide: PptxGenJSImport.Slide,
  x: number,
  label: string,
  value: string,
  tone: string
) {
  slide.addShape("roundRect", {
    x,
    y: 1.55,
    w: 2.85,
    h: 1.18,
    rectRadius: 0.08,
    fill: { color: COLORS.panelRaised, transparency: 2 },
    line: { color: tone, transparency: 35, width: 0.8 },
  } as any);
  slide.addShape("rect", {
    x,
    y: 1.55,
    w: 2.85,
    h: 0.055,
    fill: { color: tone },
    line: { color: tone },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.22,
    y: 1.88,
    w: 2.4,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 6.5,
    charSpacing: 1,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText(value, {
    x: x + 0.22,
    y: 2.17,
    w: 2.4,
    h: 0.3,
    fontFace: "Aptos Display",
    fontSize: 19,
    color: COLORS.white,
    bold: true,
    margin: 0,
  });
}

function addPptNarrativeCard(
  slide: PptxGenJSImport.Slide,
  x: number,
  y: number,
  label: string,
  body: string,
  accent: string
) {
  slide.addShape("roundRect", {
    x,
    y,
    w: 2.78,
    h: 1.18,
    rectRadius: 0.06,
    fill: { color: COLORS.panelRaised },
    line: { color: COLORS.line, width: 0.55 },
  } as any);
  slide.addShape("rect", {
    x: x + 0.18,
    y: y + 0.19,
    w: 0.12,
    h: 0.42,
    fill: { color: accent },
    line: { color: accent },
  });
  slide.addText(label.toUpperCase(), {
    x: x + 0.42,
    y: y + 0.2,
    w: 2.08,
    h: 0.14,
    fontFace: "Aptos",
    fontSize: 6.1,
    charSpacing: 0.8,
    color: COLORS.lilac,
    bold: true,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.42,
    y: y + 0.48,
    w: 2.08,
    h: 0.48,
    fontFace: "Aptos",
    fontSize: 8.5,
    color: COLORS.white,
    margin: 0,
    breakLine: false,
  });
}

function addPptBarChart(
  slide: PptxGenJSImport.Slide,
  rows: { label: string; value: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
  valueLabel: (value: number) => string
) {
  const maximum = Math.max(...rows.map(row => row.value), 1);
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.06,
    fill: { color: COLORS.panelRaised },
    line: { color: COLORS.line, width: 0.55 },
  } as any);
  const baselineY = y + h - 0.58;
  const chartHeight = h - 1.02;
  slide.addShape("line", {
    x: x + 0.32,
    y: baselineY,
    w: w - 0.58,
    h: 0,
    line: { color: COLORS.line, width: 0.55 },
  });
  const usableWidth = w - 0.74;
  const gap = 0.18;
  const barWidth = Math.max(
    0.26,
    (usableWidth - gap * Math.max(rows.length - 1, 0)) /
      Math.max(rows.length, 1)
  );
  rows.forEach((row, index) => {
    const barHeight = Math.max(
      row.value > 0 ? 0.08 : 0.025,
      (row.value / maximum) * chartHeight
    );
    const barX = x + 0.37 + index * (barWidth + gap);
    slide.addShape("roundRect", {
      x: barX,
      y: baselineY - barHeight,
      w: barWidth,
      h: barHeight,
      rectRadius: 0.03,
      fill: { color: accent, transparency: row.value === 0 ? 72 : 0 },
      line: { color: accent, transparency: row.value === 0 ? 72 : 0 },
    } as any);
    slide.addText(valueLabel(row.value), {
      x: barX - 0.17,
      y: baselineY - barHeight - 0.24,
      w: barWidth + 0.34,
      h: 0.14,
      fontFace: "Aptos",
      fontSize: 6.1,
      color: row.value === 0 ? COLORS.muted : COLORS.white,
      align: "center",
      margin: 0,
    });
    slide.addText(row.label, {
      x: barX - 0.17,
      y: baselineY + 0.13,
      w: barWidth + 0.34,
      h: 0.12,
      fontFace: "Aptos",
      fontSize: 6.4,
      color: COLORS.muted,
      align: "center",
      margin: 0,
    });
  });
}

function addPptTable(
  slide: PptxGenJSImport.Slide,
  rows: (string | number)[][],
  x: number,
  y: number,
  w: number,
  h: number,
  colW: number[]
) {
  slide.addTable(
    rows as any,
    {
      x,
      y,
      w,
      h,
      colW,
      rowH: 0.32,
      border: { type: "solid", color: COLORS.line, pt: 0.45 },
      fill: COLORS.panel,
      color: COLORS.white,
      fontFace: "Aptos",
      fontSize: 8,
      margin: 0.08,
      autoFit: false,
      valign: "mid",
      bold: false,
      autoPage: false,
      rowProps: [{ fill: COLORS.violet, bold: true, color: COLORS.white }],
    } as any
  );
}

function chunk<T>(items: T[], size: number) {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size));
  return pages;
}

function shortenLabel(value: string, maximumLength: number) {
  return value.length > maximumLength
    ? `${value.slice(0, maximumLength - 1)}…`
    : value;
}

function exportTimelineYears(snapshot: PortfolioExportSnapshot) {
  const scheduledYears = [
    ...snapshot.financialYears,
    ...snapshot.useCases.flatMap(objective => [
      objective.startYear,
      objective.endYear,
    ]),
    ...snapshot.capabilities.map(capability => capability.targetYear),
    ...snapshot.milestones.map(milestone => milestone.planningYear),
    ...snapshot.investments.map(investment => investment.planningYear),
  ].filter(year => Number.isInteger(year) && year >= 2020 && year <= 2100);

  if (!scheduledYears.length) return [];
  const startYear = Math.min(...scheduledYears);
  const endYear = Math.max(...scheduledYears);
  return Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => startYear + index
  );
}

function addPptYearHeader(
  slide: PptxGenJSImport.Slide,
  years: number[],
  x: number,
  y: number,
  width: number
) {
  const columnWidth = width / Math.max(years.length, 1);
  years.forEach((year, index) => {
    slide.addShape("rect", {
      x: x + index * columnWidth,
      y,
      w: columnWidth,
      h: 0.4,
      fill: { color: COLORS.panelRaised },
      line: { color: COLORS.line, width: 0.5 },
    });
    slide.addText(String(year), {
      x: x + index * columnWidth,
      y: y + 0.13,
      w: columnWidth,
      h: 0.12,
      fontFace: "Aptos",
      fontSize: 7,
      color: COLORS.white,
      bold: true,
      align: "center",
      margin: 0,
    });
  });
  return columnWidth;
}

function addPptRelationshipChip(
  slide: PptxGenJSImport.Slide,
  x: number,
  y: number,
  label: string,
  contribution: string,
  accent: string
) {
  slide.addShape("roundRect", {
    x,
    y,
    w: 2.8,
    h: 0.36,
    rectRadius: 0.04,
    fill: { color: COLORS.panelRaised },
    line: { color: accent, transparency: 38, width: 0.5 },
  } as any);
  slide.addText(shortenLabel(label, 31), {
    x: x + 0.12,
    y: y + 0.09,
    w: 2.02,
    h: 0.11,
    fontFace: "Aptos",
    fontSize: 6.4,
    color: COLORS.white,
    margin: 0,
  });
  slide.addText(shortenLabel(contribution, 12), {
    x: x + 2.1,
    y: y + 0.09,
    w: 0.58,
    h: 0.11,
    fontFace: "Aptos",
    fontSize: 5.4,
    color: COLORS.lilac,
    align: "right",
    margin: 0,
  });
}

export async function createPowerPointExport(
  snapshot: PortfolioExportSnapshot
) {
  const pptx = new PptxGenJSConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Strategic Roadmap";
  pptx.subject = "Strategic portfolio export";
  pptx.title = "Strategic Roadmap portfolio";
  pptx.company = "Strategic Roadmap";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  let page = 1;
  const totalBudget = snapshot.investments.reduce(
    (total, item) => total + item.amountSarM,
    0
  );
  const internalBudget = snapshot.investments
    .filter(item => item.budgetType === "internal")
    .reduce((total, item) => total + item.amountSarM, 0);
  const externalBudget = snapshot.investments
    .filter(item => item.budgetType === "external")
    .reduce((total, item) => total + item.amountSarM, 0);
  const coverage = kpiCoverage(snapshot);
  const coveragePercent = snapshot.capabilities.length
    ? Math.round((coverage.mapped.length / snapshot.capabilities.length) * 100)
    : 0;
  const kpiPillars = Array.from(
    new Set(snapshot.kpis.map(kpi => kpi.strategicPillar))
  ).map(pillar => {
    const catalogue = snapshot.kpis.filter(
      kpi => kpi.strategicPillar === pillar
    );
    const assignedKpiIds = new Set(
      snapshot.capabilityKpis
        .map(mapping => snapshot.kpis.find(kpi => kpi.id === mapping.kpiId))
        .filter((kpi): kpi is KpiDefinition => kpi?.strategicPillar === pillar)
        .map(kpi => kpi.id)
    );
    return {
      pillar,
      catalogueCount: catalogue.length,
      assignedCount: assignedKpiIds.size,
    };
  });
  const overview = pptx.addSlide();
  addPptHeader(overview, "Executive portfolio export", "Strategic Roadmap");
  overview.addText(
    "A concise executive briefing for strategic decisions, architecture dependencies, delivery sequencing, and investment planning.",
    {
      x: 0.62,
      y: 1.22,
      w: 9.4,
      h: 0.35,
      fontFace: "Aptos",
      fontSize: 10.5,
      color: COLORS.muted,
      margin: 0,
    }
  );
  addPptMetric(
    overview,
    0.55,
    "Strategic Objectives",
    String(snapshot.useCases.length),
    COLORS.violet
  );
  addPptMetric(
    overview,
    3.62,
    "Capabilities",
    String(snapshot.capabilities.length),
    COLORS.cyan
  );
  addPptMetric(
    overview,
    6.69,
    "KPI coverage",
    `${coveragePercent}%`,
    coverage.unmapped.length ? COLORS.roseSoft : COLORS.mint
  );
  addPptMetric(
    overview,
    9.76,
    "Total budget",
    formatSarM(totalBudget),
    COLORS.rose
  );
  overview.addText("Executive briefing", {
    x: 0.62,
    y: 3.25,
    w: 2.4,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: COLORS.white,
    margin: 0,
  });
  addPptNarrativeCard(
    overview,
    0.62,
    3.62,
    "Planning horizon",
    snapshot.financialYears.length
      ? `${Math.min(...snapshot.financialYears)}–${Math.max(...snapshot.financialYears)} delivery and investment view.`
      : "Planning years have not been configured.",
    COLORS.violet
  );
  addPptNarrativeCard(
    overview,
    3.56,
    3.62,
    "Delivery evidence",
    `${snapshot.milestones.length} delivery milestones across ${new Set(snapshot.milestones.map(item => item.planningYear)).size} planning years.`,
    COLORS.cyan
  );
  addPptNarrativeCard(
    overview,
    6.5,
    3.62,
    "KPI evidence",
    `${coverage.unmapped.length} capabilities require KPI mapping; ${snapshot.kpis.length} catalogue measures are available.`,
    coverage.unmapped.length ? COLORS.roseSoft : COLORS.mint
  );
  addPptNarrativeCard(
    overview,
    9.44,
    3.62,
    "Funding mix",
    `Internal ${formatSarM(internalBudget)} · External ${formatSarM(externalBudget)}.`,
    COLORS.roseSoft
  );
  overview.addShape("roundRect", {
    x: 0.62,
    y: 5.22,
    w: 12.14,
    h: 0.88,
    fill: { color: COLORS.panel },
    line: { color: COLORS.line, width: 0.5 },
  } as any);
  overview.addText(
    "Prepared from the current provisioned portfolio. Counts, dates, connections, milestones, and investment values are generated directly from the Strategic Roadmap workspace.",
    {
      x: 0.9,
      y: 5.51,
      w: 11.5,
      h: 0.22,
      fontFace: "Aptos",
      fontSize: 8.5,
      color: COLORS.muted,
      align: "center",
      margin: 0,
    }
  );
  addPptFooter(overview, page++);

  const domainSlide = pptx.addSlide();
  addPptHeader(
    domainSlide,
    "Portfolio composition",
    "Capability and outcome coverage by domain"
  );
  snapshot.teams.slice(0, 6).forEach((team, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 0.62 + column * 4.05;
    const y = 1.55 + row * 2.18;
    const capabilities = snapshot.capabilities.filter(
      item => item.teamId === team.id
    ).length;
    const objectives = snapshot.useCases.filter(
      item => item.teamId === team.id
    ).length;
    const relationships = snapshot.relationships.filter(
      link =>
        snapshot.capabilities.find(item => item.id === link.capabilityId)
          ?.teamId === team.id
    ).length;
    const accent = index % 2 === 0 ? COLORS.violet : COLORS.roseSoft;
    domainSlide.addShape("roundRect", {
      x,
      y,
      w: 3.65,
      h: 1.75,
      rectRadius: 0.07,
      fill: { color: COLORS.panelRaised },
      line: { color: COLORS.line, width: 0.6 },
    } as any);
    domainSlide.addShape("rect", {
      x,
      y,
      w: 3.65,
      h: 0.06,
      fill: { color: accent },
      line: { color: accent },
    });
    domainSlide.addText(team.name, {
      x: x + 0.22,
      y: y + 0.28,
      w: 3.1,
      h: 0.25,
      fontFace: "Aptos Display",
      fontSize: 13,
      bold: true,
      color: COLORS.white,
      margin: 0,
    });
    domainSlide.addText(`${capabilities} capabilities`, {
      x: x + 0.22,
      y: y + 0.75,
      w: 1.12,
      h: 0.2,
      fontFace: "Aptos",
      fontSize: 8.4,
      color: COLORS.cyan,
      margin: 0,
    });
    domainSlide.addText(`${objectives} objectives`, {
      x: x + 1.45,
      y: y + 0.75,
      w: 1.1,
      h: 0.2,
      fontFace: "Aptos",
      fontSize: 8.4,
      color: COLORS.lilac,
      margin: 0,
    });
    domainSlide.addText(`${relationships} mapped links`, {
      x: x + 2.6,
      y: y + 0.75,
      w: 0.85,
      h: 0.34,
      fontFace: "Aptos",
      fontSize: 8.4,
      color: COLORS.roseSoft,
      margin: 0,
      breakLine: false,
    });
    domainSlide.addText(
      "Coverage is derived from current owner and relationship assignments.",
      {
        x: x + 0.22,
        y: y + 1.25,
        w: 3.0,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7.1,
        color: COLORS.muted,
        margin: 0,
      }
    );
  });
  addPptFooter(domainSlide, page++);

  const kpiSlide = pptx.addSlide();
  addPptHeader(
    kpiSlide,
    "KPI coverage",
    "Architecture capabilities connected to measurable outcomes"
  );
  kpiSlide.addText(
    "KPI mapping is a coverage signal: it confirms that a capability has one or more accountable outcome measures in the enterprise KPI library.",
    {
      x: 0.62,
      y: 1.22,
      w: 11.7,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 8.5,
      color: COLORS.muted,
      margin: 0,
    }
  );
  addPptMetric(
    kpiSlide,
    0.55,
    "KPI coverage",
    `${coveragePercent}%`,
    coverage.unmapped.length ? COLORS.roseSoft : COLORS.mint
  );
  addPptMetric(
    kpiSlide,
    3.62,
    "Mapped capabilities",
    String(coverage.mapped.length),
    COLORS.mint
  );
  addPptMetric(
    kpiSlide,
    6.69,
    "KPI gaps",
    String(coverage.unmapped.length),
    coverage.unmapped.length ? COLORS.roseSoft : COLORS.mint
  );
  addPptMetric(
    kpiSlide,
    9.76,
    "Catalogue measures",
    String(snapshot.kpis.length),
    COLORS.cyan
  );
  kpiSlide.addText("KPI evidence by strategic pillar", {
    x: 0.62,
    y: 3.25,
    w: 4.3,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: COLORS.white,
    margin: 0,
  });
  kpiPillars.slice(0, 6).forEach((pillar, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 0.62 + column * 4.05;
    const y = 3.65 + row * 1.28;
    const accent = index % 2 === 0 ? COLORS.violet : COLORS.cyan;
    kpiSlide.addShape("roundRect", {
      x,
      y,
      w: 3.65,
      h: 0.96,
      rectRadius: 0.06,
      fill: { color: COLORS.panelRaised },
      line: { color: COLORS.line, width: 0.5 },
    } as any);
    kpiSlide.addShape("rect", {
      x,
      y,
      w: 0.06,
      h: 0.96,
      fill: { color: accent },
      line: { color: accent },
    });
    kpiSlide.addText(shortenLabel(pillar.pillar, 38), {
      x: x + 0.2,
      y: y + 0.18,
      w: 3.2,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 8.2,
      color: COLORS.white,
      bold: true,
      margin: 0,
    });
    kpiSlide.addText(
      `${pillar.assignedCount} assigned measures · ${pillar.catalogueCount} catalogue measures`,
      {
        x: x + 0.2,
        y: y + 0.57,
        w: 3.15,
        h: 0.13,
        fontFace: "Aptos",
        fontSize: 6.5,
        color: COLORS.muted,
        margin: 0,
      }
    );
  });
  addPptFooter(kpiSlide, page++);

  const unmappedCapabilityPages: Capability[][] = coverage.unmapped.length
    ? chunk(coverage.unmapped, 8)
    : [[]];
  for (const capabilityPage of unmappedCapabilityPages) {
    const slide = pptx.addSlide();
    addPptHeader(
      slide,
      "KPI coverage action",
      coverage.unmapped.length
        ? "Capabilities requiring KPI mapping"
        : "All capabilities have KPI coverage"
    );
    const rows: (string | number)[][] = coverage.unmapped.length
      ? [
          ["Capability", "Domain", "Owner", "Team", "Target year"],
          ...capabilityPage.map(capability => [
            capability.name,
            capability.domain,
            capability.owner,
            teamName(snapshot.teams, capability.teamId),
            capability.targetYear,
          ]),
        ]
      : [
          ["Status", "Detail"],
          [
            "Coverage complete",
            "Every provisioned capability is mapped to at least one KPI.",
          ],
        ];
    const widths = coverage.unmapped.length
      ? [3.5, 2.05, 2.25, 2.67, 1.65]
      : [2.4, 9.72];
    addPptTable(slide, rows, 0.62, 1.48, 12.12, 4.92, widths);
    slide.addText(
      coverage.unmapped.length
        ? "Action: assign one or more KPI measures to each listed capability through the portfolio catalogue."
        : "The KPI coverage register has no current gaps.",
      {
        x: 0.82,
        y: 6.58,
        w: 11.3,
        h: 0.12,
        fontFace: "Aptos",
        fontSize: 6.8,
        color: COLORS.muted,
        align: "center",
        margin: 0,
      }
    );
    addPptFooter(slide, page++);
  }

  for (const objectivePage of chunk(snapshot.useCases, 4)) {
    const slide = pptx.addSlide();
    addPptHeader(
      slide,
      "Architecture traceability",
      "Strategic outcomes and their enabling capabilities"
    );
    slide.addText(
      "Each outcome is linked to the capabilities that make delivery possible. The relationship appendix retains the complete connection register.",
      {
        x: 0.62,
        y: 1.22,
        w: 11.6,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 8.5,
        color: COLORS.muted,
        margin: 0,
      }
    );
    objectivePage.forEach((objective, objectiveIndex) => {
      const rowY = 1.62 + objectiveIndex * 1.26;
      const linkedCapabilities = snapshot.relationships
        .filter(link => link.useCaseId === objective.id)
        .map(link => ({
          relationship: link,
          capability: snapshot.capabilities.find(
            item => item.id === link.capabilityId
          ),
        }))
        .filter(
          (
            entry
          ): entry is { relationship: Relationship; capability: Capability } =>
            Boolean(entry.capability)
        );
      const accent = objectiveIndex % 2 === 0 ? COLORS.violet : COLORS.roseSoft;

      slide.addShape("roundRect", {
        x: 0.62,
        y: rowY,
        w: 2.7,
        h: 0.9,
        rectRadius: 0.06,
        fill: { color: COLORS.panelRaised },
        line: { color: accent, transparency: 25, width: 0.7 },
      } as any);
      slide.addText(shortenLabel(objective.name, 33), {
        x: 0.82,
        y: rowY + 0.18,
        w: 2.3,
        h: 0.22,
        fontFace: "Aptos Display",
        fontSize: 10.4,
        color: COLORS.white,
        bold: true,
        margin: 0,
      });
      slide.addText(
        `${objective.priority.toUpperCase()} · ${objectiveScope(objective, snapshot.teams)} · ${objective.startYear}–${objective.endYear}`,
        {
          x: 0.82,
          y: rowY + 0.58,
          w: 2.28,
          h: 0.14,
          fontFace: "Aptos",
          fontSize: 6.3,
          color: COLORS.lilac,
          margin: 0,
        }
      );
      slide.addShape("line", {
        x: 3.32,
        y: rowY + 0.45,
        w: 0.56,
        h: 0,
        line: {
          color: accent,
          width: 1.1,
          beginArrowType: "none",
          endArrowType: "triangle",
        },
      } as any);

      const visibleLinks = linkedCapabilities.slice(0, 3);
      visibleLinks.forEach((entry, linkIndex) => {
        addPptRelationshipChip(
          slide,
          4.02 + linkIndex * 2.9,
          rowY + 0.24,
          entry.capability.name,
          entry.relationship.contribution,
          accent
        );
      });
      if (!visibleLinks.length) {
        slide.addText("No mapped capabilities", {
          x: 4.02,
          y: rowY + 0.38,
          w: 2.3,
          h: 0.14,
          fontFace: "Aptos",
          fontSize: 8,
          color: COLORS.muted,
          italic: true,
          margin: 0,
        });
      }
      if (linkedCapabilities.length > visibleLinks.length) {
        slide.addText(
          `+${linkedCapabilities.length - visibleLinks.length} additional linked capabilities`,
          {
            x: 4.02,
            y: rowY + 0.7,
            w: 3.15,
            h: 0.12,
            fontFace: "Aptos",
            fontSize: 6.2,
            color: COLORS.muted,
            margin: 0,
          }
        );
      }
    });
    slide.addShape("roundRect", {
      x: 0.62,
      y: 6.3,
      w: 12.14,
      h: 0.45,
      rectRadius: 0.05,
      fill: { color: COLORS.panel },
      line: { color: COLORS.line, width: 0.5 },
    } as any);
    slide.addText(
      "Reading guide: each line flows from a strategic outcome to its enabling architecture capabilities. Use this page to assess dependency coverage; use the Excel export for every relationship record.",
      {
        x: 0.88,
        y: 6.46,
        w: 11.55,
        h: 0.12,
        fontFace: "Aptos",
        fontSize: 6.8,
        color: COLORS.muted,
        align: "center",
        margin: 0,
      }
    );
    addPptFooter(slide, page++);
  }

  const completeMappingPages = snapshot.useCases.flatMap(objective => {
    const relationships = snapshot.relationships.filter(
      relationship => relationship.useCaseId === objective.id
    );
    return relationships.length
      ? chunk(relationships, 8).map((relationships, pageIndex, pages) => ({
          objective,
          relationships,
          pageIndex,
          pageCount: pages.length,
        }))
      : [
          {
            objective,
            relationships: [] as Relationship[],
            pageIndex: 0,
            pageCount: 1,
          },
        ];
  });
  for (const mappingPage of completeMappingPages) {
    const linkedCapabilityCount = snapshot.relationships.filter(
      relationship => relationship.useCaseId === mappingPage.objective.id
    ).length;
    const titleSuffix =
      mappingPage.pageCount > 1
        ? ` · ${mappingPage.pageIndex + 1}/${mappingPage.pageCount}`
        : "";
    const slide = pptx.addSlide();
    addPptHeader(
      slide,
      "Executive capability map",
      `Capability enablement · ${shortenLabel(mappingPage.objective.name, 44)}${titleSuffix}`
    );
    slide.addText(
      `${linkedCapabilityCount} configured ${linkedCapabilityCount === 1 ? "capability" : "capabilities"} mapped to this Strategic Objective. This series contains the complete relationship set; additional pages continue only where necessary.`,
      {
        x: 0.62,
        y: 1.22,
        w: 11.7,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 8.5,
        color: COLORS.muted,
        margin: 0,
      }
    );
    const rows: (string | number)[][] = [
      ["Capability", "Contribution", "Target year", "KPI coverage"],
    ];
    if (!mappingPage.relationships.length) {
      rows.push([
        "No capability is currently mapped",
        "—",
        "—",
        "Mapping required",
      ]);
    } else {
      mappingPage.relationships.forEach(relationship => {
        const capability = snapshot.capabilities.find(
          item => item.id === relationship.capabilityId
        );
        const mappedKpis =
          coverage.kpiIdsByCapability[relationship.capabilityId] ?? [];
        rows.push([
          capability?.name ?? `Capability #${relationship.capabilityId}`,
          relationship.contribution,
          capability?.targetYear ?? "—",
          mappedKpis.length
            ? `${mappedKpis.length} KPI(s) mapped`
            : "KPI mapping required",
        ]);
      });
    }
    addPptTable(slide, rows, 0.62, 1.7, 12.12, 4.82, [4.8, 2.1, 1.65, 3.57]);
    slide.addText(
      `${mappingPage.objective.priority.toUpperCase()} · ${objectiveScope(mappingPage.objective, snapshot.teams)} · ${mappingPage.objective.startYear}–${mappingPage.objective.endYear}`,
      {
        x: 0.82,
        y: 6.63,
        w: 11.2,
        h: 0.12,
        fontFace: "Aptos",
        fontSize: 6.8,
        color: COLORS.lilac,
        align: "center",
        margin: 0,
      }
    );
    addPptFooter(slide, page++);
  }

  const timelineYears = exportTimelineYears(snapshot);
  for (const objectivePage of chunk(snapshot.useCases, 4)) {
    for (const yearWindow of chunk(timelineYears, 5)) {
      const slide = pptx.addSlide();
      addPptHeader(
        slide,
        "Executive Roadmap",
        `Delivery sequencing · ${yearWindow[0]}–${yearWindow[yearWindow.length - 1]}`
      );
      slide.addText(
        "Outcome bands show the strategic horizon. Delivery markers show the number of execution milestones planned in each year.",
        {
          x: 0.62,
          y: 1.22,
          w: 11.6,
          h: 0.2,
          fontFace: "Aptos",
          fontSize: 8.5,
          color: COLORS.muted,
          margin: 0,
        }
      );
      const labelX = 0.62;
      const labelW = 2.75;
      const gridX = labelX + labelW;
      const gridW = 9.39;
      const yearColumnWidth = addPptYearHeader(
        slide,
        yearWindow,
        gridX,
        1.58,
        gridW
      );
      slide.addShape("rect", {
        x: labelX,
        y: 1.58,
        w: labelW,
        h: 0.4,
        fill: { color: COLORS.panelRaised },
        line: { color: COLORS.line, width: 0.5 },
      });
      slide.addText("STRATEGIC OBJECTIVE", {
        x: labelX + 0.16,
        y: 1.71,
        w: 2.2,
        h: 0.11,
        fontFace: "Aptos",
        fontSize: 6.2,
        charSpacing: 0.9,
        color: COLORS.lilac,
        bold: true,
        margin: 0,
      });
      objectivePage.forEach((objective, objectiveIndex) => {
        const rowY = 2.0 + objectiveIndex * 0.9;
        const rowH = 0.9;
        const linkedCount = snapshot.relationships.filter(
          link => link.useCaseId === objective.id
        ).length;
        slide.addShape("rect", {
          x: labelX,
          y: rowY,
          w: labelW,
          h: rowH,
          fill: { color: COLORS.panel },
          line: { color: COLORS.line, width: 0.5 },
        });
        slide.addText(shortenLabel(objective.name, 32), {
          x: labelX + 0.16,
          y: rowY + 0.16,
          w: 2.36,
          h: 0.18,
          fontFace: "Aptos",
          fontSize: 8.5,
          color: COLORS.white,
          bold: true,
          margin: 0,
        });
        slide.addText(
          `${objective.priority.toUpperCase()} · ${linkedCount} linked capabilities`,
          {
            x: labelX + 0.16,
            y: rowY + 0.53,
            w: 2.34,
            h: 0.11,
            fontFace: "Aptos",
            fontSize: 6.1,
            color: COLORS.muted,
            margin: 0,
          }
        );
        yearWindow.forEach((year, yearIndex) => {
          const columnX = gridX + yearIndex * yearColumnWidth;
          slide.addShape("rect", {
            x: columnX,
            y: rowY,
            w: yearColumnWidth,
            h: rowH,
            fill: {
              color: objectiveIndex % 2 === 0 ? COLORS.inkSoft : COLORS.panel,
            },
            line: { color: COLORS.line, width: 0.45 },
          });
        });
        const activeStart = Math.max(objective.startYear, yearWindow[0]);
        const activeEnd = Math.min(
          objective.endYear,
          yearWindow[yearWindow.length - 1]
        );
        if (activeStart <= activeEnd) {
          const startIndex = yearWindow.indexOf(activeStart);
          const span = activeEnd - activeStart + 1;
          slide.addShape("roundRect", {
            x: gridX + startIndex * yearColumnWidth + 0.09,
            y: rowY + 0.15,
            w: span * yearColumnWidth - 0.18,
            h: 0.12,
            rectRadius: 0.03,
            fill: { color: COLORS.violet, transparency: 18 },
            line: { color: COLORS.violet, transparency: 25, width: 0.4 },
          } as any);
        }
        yearWindow.forEach((year, yearIndex) => {
          const capabilityCount = new Set(
            snapshot.relationships
              .filter(link => link.useCaseId === objective.id)
              .map(link =>
                snapshot.capabilities.find(
                  capability => capability.id === link.capabilityId
                )
              )
              .filter((capability): capability is Capability =>
                Boolean(capability && capability.targetYear === year)
              )
              .map(capability => capability.id)
          ).size;
          const milestoneCount = snapshot.milestones.filter(
            item =>
              item.useCaseId === objective.id && item.planningYear === year
          ).length;
          if (!milestoneCount && !capabilityCount) return;
          const markerX =
            gridX + yearIndex * yearColumnWidth + yearColumnWidth / 2;
          if (capabilityCount) {
            slide.addShape("roundRect", {
              x: markerX - 0.24,
              y: rowY + 0.36,
              w: 0.48,
              h: 0.18,
              rectRadius: 0.03,
              fill: { color: COLORS.violet },
              line: { color: COLORS.lilac, width: 0.35 },
            } as any);
            slide.addText(`C${capabilityCount}`, {
              x: markerX - 0.2,
              y: rowY + 0.412,
              w: 0.4,
              h: 0.06,
              fontFace: "Aptos",
              fontSize: 5.1,
              bold: true,
              color: COLORS.white,
              align: "center",
              margin: 0,
            });
          }
          if (milestoneCount) {
            slide.addShape("ellipse", {
              x: markerX - 0.12,
              y: rowY + 0.58,
              w: 0.24,
              h: 0.24,
              fill: { color: COLORS.cyan },
              line: { color: COLORS.cyan },
            } as any);
            slide.addText(String(milestoneCount), {
              x: markerX - 0.1,
              y: rowY + 0.645,
              w: 0.2,
              h: 0.06,
              fontFace: "Aptos",
              fontSize: 5.2,
              bold: true,
              color: COLORS.ink,
              align: "center",
              margin: 0,
            });
          }
        });
      });
      slide.addShape("roundRect", {
        x: 0.62,
        y: 5.9,
        w: 12.14,
        h: 0.5,
        rectRadius: 0.05,
        fill: { color: COLORS.panel },
        line: { color: COLORS.line, width: 0.5 },
      } as any);
      slide.addText(
        "Legend: violet band = objective horizon · C# = linked capabilities targeted for that year · cyan marker = execution milestones. Slides continue for every objective and planning window.",
        {
          x: 0.88,
          y: 6.08,
          w: 11.55,
          h: 0.12,
          fontFace: "Aptos",
          fontSize: 6.8,
          color: COLORS.muted,
          align: "center",
          margin: 0,
        }
      );
      addPptFooter(slide, page++);
    }
  }

  for (const objectiveFinancialPage of chunk(snapshot.useCases, 5)) {
    for (const yearWindow of chunk(timelineYears, 5)) {
      const slide = pptx.addSlide();
      addPptHeader(
        slide,
        "Financial Roadmap",
        `Investment phasing · ${yearWindow[0]}–${yearWindow[yearWindow.length - 1]}`
      );
      slide.addText(
        `Direct Saudi Riyal million allocations by Strategic Objective. Window mix: Internal ${formatSarM(snapshot.investments.filter(item => yearWindow.includes(item.planningYear) && item.budgetType === "internal").reduce((total, item) => total + item.amountSarM, 0))} · External ${formatSarM(snapshot.investments.filter(item => yearWindow.includes(item.planningYear) && item.budgetType === "external").reduce((total, item) => total + item.amountSarM, 0))}.`,
        {
          x: 0.62,
          y: 1.22,
          w: 11.8,
          h: 0.2,
          fontFace: "Aptos",
          fontSize: 8.5,
          color: COLORS.muted,
          margin: 0,
        }
      );
      const labelX = 0.62;
      const labelW = 2.75;
      const gridX = labelX + labelW;
      const gridW = 9.39;
      const yearColumnWidth = addPptYearHeader(
        slide,
        yearWindow,
        gridX,
        1.58,
        gridW
      );
      slide.addShape("rect", {
        x: labelX,
        y: 1.58,
        w: labelW,
        h: 0.4,
        fill: { color: COLORS.panelRaised },
        line: { color: COLORS.line, width: 0.5 },
      });
      slide.addText("STRATEGIC OBJECTIVE", {
        x: labelX + 0.16,
        y: 1.71,
        w: 2.2,
        h: 0.11,
        fontFace: "Aptos",
        fontSize: 6.2,
        charSpacing: 0.9,
        color: COLORS.lilac,
        bold: true,
        margin: 0,
      });
      const objectives = objectiveFinancialPage;
      const maximumAllocation = Math.max(
        ...snapshot.investments
          .filter(item => yearWindow.includes(item.planningYear))
          .map(item => item.amountSarM),
        1
      );
      objectives.forEach((objective, objectiveIndex) => {
        const rowY = 2.0 + objectiveIndex * 0.76;
        slide.addShape("rect", {
          x: labelX,
          y: rowY,
          w: labelW,
          h: 0.76,
          fill: { color: COLORS.panel },
          line: { color: COLORS.line, width: 0.5 },
        });
        slide.addText(shortenLabel(objective.name, 32), {
          x: labelX + 0.16,
          y: rowY + 0.15,
          w: 2.35,
          h: 0.18,
          fontFace: "Aptos",
          fontSize: 8.2,
          color: COLORS.white,
          bold: true,
          margin: 0,
        });
        slide.addText(
          `${objective.priority.toUpperCase()} · ${objectiveScope(objective, snapshot.teams)}`,
          {
            x: labelX + 0.16,
            y: rowY + 0.47,
            w: 2.34,
            h: 0.11,
            fontFace: "Aptos",
            fontSize: 5.9,
            color: COLORS.muted,
            margin: 0,
          }
        );
        yearWindow.forEach((year, yearIndex) => {
          const yearInvestments = snapshot.investments.filter(
            item =>
              item.useCaseId === objective.id && item.planningYear === year
          );
          const internalAmount = yearInvestments
            .filter(item => item.budgetType === "internal")
            .reduce((total, item) => total + item.amountSarM, 0);
          const externalAmount = yearInvestments
            .filter(item => item.budgetType === "external")
            .reduce((total, item) => total + item.amountSarM, 0);
          const amount = yearInvestments.reduce(
            (total, item) => total + item.amountSarM,
            0
          );
          const intensity =
            amount === 0
              ? 92
              : Math.max(20, 78 - (amount / maximumAllocation) * 58);
          const columnX = gridX + yearIndex * yearColumnWidth;
          slide.addShape("rect", {
            x: columnX,
            y: rowY,
            w: yearColumnWidth,
            h: 0.76,
            fill: {
              color: amount === 0 ? COLORS.inkSoft : COLORS.rose,
              transparency: intensity,
            },
            line: { color: COLORS.line, width: 0.45 },
          });
          slide.addText(
            amount === 0
              ? "—"
              : `I ${formatSarMCompact(internalAmount)}\nE ${formatSarMCompact(externalAmount)}`,
            {
              x: columnX + 0.04,
              y: rowY + 0.22,
              w: yearColumnWidth - 0.08,
              h: 0.3,
              fontFace: "Aptos",
              fontSize: 5.6,
              color: amount === 0 ? COLORS.muted : COLORS.white,
              bold: amount > 0,
              align: "center",
              margin: 0,
            }
          );
        });
      });
      const totalY = 5.92;
      slide.addShape("rect", {
        x: labelX,
        y: totalY,
        w: labelW,
        h: 0.48,
        fill: { color: COLORS.panelRaised },
        line: { color: COLORS.line, width: 0.5 },
      });
      slide.addText("WINDOW TOTAL", {
        x: labelX + 0.16,
        y: totalY + 0.18,
        w: 2.1,
        h: 0.1,
        fontFace: "Aptos",
        fontSize: 6.2,
        charSpacing: 0.8,
        color: COLORS.lilac,
        bold: true,
        margin: 0,
      });
      yearWindow.forEach((year, yearIndex) => {
        const yearInvestments = snapshot.investments.filter(
          item => item.planningYear === year
        );
        const internalAmount = yearInvestments
          .filter(item => item.budgetType === "internal")
          .reduce((total, item) => total + item.amountSarM, 0);
        const externalAmount = yearInvestments
          .filter(item => item.budgetType === "external")
          .reduce((total, item) => total + item.amountSarM, 0);
        const amount = yearInvestments.reduce(
          (total, item) => total + item.amountSarM,
          0
        );
        const columnX = gridX + yearIndex * yearColumnWidth;
        slide.addShape("rect", {
          x: columnX,
          y: totalY,
          w: yearColumnWidth,
          h: 0.48,
          fill: { color: COLORS.panelRaised },
          line: { color: COLORS.line, width: 0.5 },
        });
        slide.addText(
          `I ${formatSarMCompact(internalAmount)} · E ${formatSarMCompact(externalAmount)}`,
          {
            x: columnX + 0.04,
            y: totalY + 0.12,
            w: yearColumnWidth - 0.08,
            h: 0.18,
            fontFace: "Aptos",
            fontSize: 5.3,
            color: COLORS.white,
            bold: true,
            align: "center",
            margin: 0,
          }
        );
      });
      addPptFooter(slide, page++);
    }
  }

  for (const objectives of chunk(snapshot.useCases, 6)) {
    const slide = pptx.addSlide();
    addPptHeader(
      slide,
      "Strategic objectives",
      "Prioritized strategic outcomes"
    );
    const rows: (string | number)[][] = [
      ["Strategic Objective", "Scope", "Horizon", "Priority", "Status"],
    ];
    objectives.forEach(objective =>
      rows.push([
        objective.name,
        objectiveScope(objective, snapshot.teams),
        `${objective.startYear}–${objective.endYear}`,
        objective.priority.toUpperCase(),
        objective.status.replaceAll("_", " "),
      ])
    );
    addPptTable(
      slide,
      rows,
      0.62,
      1.48,
      12.12,
      4.92,
      [4.2, 2.4, 1.45, 1.15, 2.92]
    );
    addPptFooter(slide, page++);
  }

  for (const capabilityPage of chunk(snapshot.capabilities, 8)) {
    const slide = pptx.addSlide();
    addPptHeader(slide, "Capabilities", "Architecture capability landscape");
    const rows: (string | number)[][] = [
      ["Capability", "Domain", "Owner", "Team", "KPI coverage", "Target year"],
    ];
    capabilityPage.forEach(capability => {
      const kpiCount = (coverage.kpiIdsByCapability[capability.id] ?? [])
        .length;
      rows.push([
        capability.name,
        capability.domain,
        capability.owner,
        teamName(snapshot.teams, capability.teamId),
        kpiCount ? `${kpiCount} mapped` : "Unmapped",
        capability.targetYear,
      ]);
    });
    addPptTable(
      slide,
      rows,
      0.62,
      1.48,
      12.12,
      4.92,
      [2.8, 1.85, 2, 2.25, 1.55, 1.67]
    );
    addPptFooter(slide, page++);
  }

  for (const relationshipPage of chunk(snapshot.relationships, 8)) {
    const slide = pptx.addSlide();
    addPptHeader(
      slide,
      "Architecture traceability",
      "Capabilities that enable each strategic objective"
    );
    const rows: (string | number)[][] = [
      ["Strategic Objective", "Capability", "Contribution"],
    ];
    relationshipPage.forEach(link =>
      rows.push([
        snapshot.useCases.find(item => item.id === link.useCaseId)?.name ??
          `Objective #${link.useCaseId}`,
        snapshot.capabilities.find(item => item.id === link.capabilityId)
          ?.name ?? `Capability #${link.capabilityId}`,
        link.contribution,
      ])
    );
    addPptTable(slide, rows, 0.62, 1.48, 12.12, 4.92, [5.1, 5.1, 1.92]);
    addPptFooter(slide, page++);
  }

  const milestonesByYear = snapshot.financialYears.map(year => [
    year,
    snapshot.milestones.filter(milestone => milestone.planningYear === year)
      .length,
    snapshot.milestones.filter(
      milestone =>
        milestone.planningYear === year && milestone.status === "in_progress"
    ).length,
  ]);
  const executionSlide = pptx.addSlide();
  addPptHeader(
    executionSlide,
    "Executive Roadmap",
    "Delivery milestones by planning year"
  );
  addPptTable(
    executionSlide,
    [["Planning year", "Milestones", "In progress"], ...milestonesByYear],
    0.62,
    1.48,
    4.85,
    4.92,
    [1.62, 1.62, 1.61]
  );
  addPptBarChart(
    executionSlide,
    milestonesByYear.map(([year, count]) => ({
      label: String(year),
      value: Number(count),
    })),
    5.85,
    1.48,
    6.9,
    2.8,
    COLORS.violet,
    value => String(value)
  );
  executionSlide.addText("Delivery control", {
    x: 5.95,
    y: 4.72,
    w: 2.25,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 8,
    color: COLORS.lilac,
    bold: true,
    margin: 0,
  });
  executionSlide.addText(
    "Capability-derived enablement milestones are automatically maintained when a capability is linked, renamed, rescheduled, or unlinked. The companion Excel workbook retains the full milestone register and source-capability traceability.",
    {
      x: 5.95,
      y: 5.1,
      w: 6.25,
      h: 0.72,
      fontFace: "Aptos",
      fontSize: 10,
      color: COLORS.muted,
      margin: 0,
      breakLine: false,
    }
  );
  addPptFooter(executionSlide, page++);

  const financialSlide = pptx.addSlide();
  addPptHeader(
    financialSlide,
    "Financial Roadmap",
    "Annual allocation outlook"
  );
  const financialRows: (string | number)[][] = [
    [
      "Planning year",
      "Internal budget (SAR M)",
      "External budget (SAR M)",
      "Total budget (SAR M)",
    ],
  ];
  snapshot.financialYears.forEach(year => {
    const annualInvestments = snapshot.investments.filter(
      item => item.planningYear === year
    );
    const internal = annualInvestments
      .filter(item => item.budgetType === "internal")
      .reduce((total, item) => total + item.amountSarM, 0);
    const external = annualInvestments
      .filter(item => item.budgetType === "external")
      .reduce((total, item) => total + item.amountSarM, 0);
    financialRows.push([
      year,
      formatSarM(internal),
      formatSarM(external),
      formatSarM(internal + external),
    ]);
  });
  financialRows.push([
    "Total",
    formatSarM(internalBudget),
    formatSarM(externalBudget),
    formatSarM(totalBudget),
  ]);
  addPptTable(
    financialSlide,
    financialRows,
    0.62,
    1.48,
    6.7,
    4.92,
    [1.25, 1.8, 1.8, 1.85]
  );
  addPptBarChart(
    financialSlide,
    snapshot.financialYears.map(year => ({
      label: String(year),
      value: snapshot.investments
        .filter(item => item.planningYear === year)
        .reduce((total, item) => total + item.amountSarM, 0),
    })),
    7.7,
    1.48,
    5.05,
    2.8,
    COLORS.rose,
    formatSarM
  );
  financialSlide.addText("Funding composition", {
    x: 7.8,
    y: 4.72,
    w: 3.3,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 8,
    color: COLORS.lilac,
    bold: true,
    margin: 0,
  });
  financialSlide.addText(
    "Internal and External values are entered separately and stored directly in Saudi Riyal millions. The companion Excel workbook retains every Strategic Objective-year funding entry.",
    {
      x: 7.8,
      y: 5.1,
      w: 4.5,
      h: 0.55,
      fontFace: "Aptos",
      fontSize: 10,
      color: COLORS.muted,
      margin: 0,
      breakLine: false,
    }
  );
  financialSlide.addText(
    `Internal ${formatSarM(internalBudget)} · External ${formatSarM(externalBudget)}`,
    {
      x: 7.8,
      y: 5.86,
      w: 4.5,
      h: 0.45,
      fontFace: "Aptos Display",
      fontSize: 15,
      color: COLORS.white,
      bold: true,
      margin: 0,
    }
  );
  addPptFooter(financialSlide, page++);

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(output as Uint8Array);
}

export async function createPortfolioExport(
  format: PortfolioExportFormat,
  snapshot: PortfolioExportSnapshot
): Promise<PortfolioExportFile> {
  const isExcel = format === "excel";
  const content = isExcel
    ? await createExcelExport(snapshot)
    : await createPowerPointExport(snapshot);
  const extension = isExcel ? "xlsx" : "pptx";
  return {
    filename: `strategic-roadmap-portfolio-${safeFileDate()}.${extension}`,
    mimeType: isExcel
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    contentBase64: content.toString("base64"),
  };
}
