# Strategic Roadmap

Strategic Roadmap is an executive and architect-facing strategy-and-architecture workspace. It connects Strategic Objectives, technology capabilities, KPI coverage, execution sequencing, and direct-SAR investment planning in one governed application.

## What the application provides

### Strategy and capability mapping

- Create and manage technology capabilities and their target execution years.
- Create department-owned and shared Strategic Objectives.
- Map many capabilities to one Strategic Objective and map one capability to multiple Strategic Objectives.
- View relationships through an interactive graph with focus filtering, linked-item filtering, connection editing, and connection removal.
- Bulk-provision capability-to-Strategic Objective relationships instead of creating them one at a time.
- Automatically reflect capability, objective, relationship, and target-year changes throughout the roadmaps and exports.

### Team-scoped planning

- Preserve the five-team ownership model and team-scoped write access.
- Keep shared Strategic Objectives visible across the relevant teams without assigning them to a single department.
- Keep team-owned objectives, execution plans, and financial inputs scoped to the owning team.
- Give administrators an aggregated enterprise view across all teams.

### KPI governance and coverage

- Includes the supplied Enterprise KPI Library with 137 seeded KPI measures.
- Preserve source KPI codes, names, units, milestone measures, and repeated source codes through composite code/name uniqueness.
- Map multiple KPIs to each capability and identify capabilities with no KPI mapping.
- Provide administrator-only KPI catalogue governance and KPI definition management.
- Show KPI coverage in Portfolio, Executive Roadmap, Financial Roadmap, Excel, and PowerPoint outputs.

### Executive and Financial Roadmaps

- Provide a five-year readable viewport with horizontal scrolling for future years, including years beyond 2030 and up to 2100.
- Show capability enablement sequencing, target-year markers, milestone counts, and KPI coverage by Strategic Objective and year.
- Support direct SAR millions with no currency conversion.
- Capture both Internal and External budget amounts for each Strategic Objective and year.
- Provide Internal, External, and total investment summaries, annual phasing, team views, and administrator aggregation.

### Executive exports

Administrator-only exports produce structured Excel and PowerPoint reports containing:

- Complete, paginated capability-to-Strategic Objective mapping registers.
- KPI coverage status for each relationship and unmapped-capability visibility.
- Executive Roadmap slides covering every configured Strategic Objective and planning window.
- Capability counts by objective and year, target-year markers, and milestone counts.
- Financial Roadmap phasing with separate Internal, External, and total direct-SAR values.
- Executive-ready traceability between strategic intent, architecture enablement, delivery sequencing, KPI coverage, and investment requirements.

## Application architecture

Strategic Roadmap is a full-stack TypeScript application built with:

- React 19, Vite, Tailwind CSS, and shadcn/ui for the client.
- Express 4 and tRPC 11 for the application API.
- Drizzle ORM with MySQL/TiDB-compatible persistence.
- Private local email/password authentication using scrypt password hashes and HttpOnly JWT sessions.
- Team-scoped authorization and administrator-only governance operations.
- ExcelJS and PptxGenJS for secured Excel and PowerPoint generation.
- Docker-based production packaging for AWS deployment.

The visible product terminology is **Strategic Objectives**. The legacy database table name `useCases` is retained internally for compatibility.

## Local development

```bash
pnpm install
pnpm dev
```

Useful validation commands:

```bash
pnpm check
pnpm test
pnpm build
```

The application requires the project runtime environment for its database and authentication configuration. Do not commit `.env` files, credentials, passwords, JWT secrets, database URLs, AWS keys, or exported private data.

## Database migrations

The project uses forward-only migrations. Historical Drizzle metadata must not be deleted or rewritten. The latest additive migrations include:

- `drizzle/0008_kpi_coverage.sql` for the KPI catalogue and capability-to-KPI mappings.
- `drizzle/0009_budget_classification.sql` for Internal and External investment classification and the composite investment uniqueness rule.

Apply migrations through the controlled deployment process for the target environment.

## AWS deployment

The application can be deployed to the existing AWS App Runner service with a private Amazon RDS database and Amazon ECR image repository. The guarded release workflow:

1. Builds the migration image and application image.
2. Applies forward-only migrations through the controlled release process.
3. Restores the normal application image and existing App Runner configuration.
4. Preserves the existing database, runtime secrets, local administrator account, VPC configuration, and network settings.

Use the guarded script in `aws/update-apprunner-roadmap-release.sh` from a freshly unpacked release bundle. Never place AWS credentials, runtime secrets, or bootstrap values in the repository or in command output.

## Project status

The latest functional export enhancement includes complete relationship coverage, all-objective Executive Roadmap reporting, capability enablement counts by objective and year, KPI status per relationship, and Internal/External Financial Roadmap reporting. The source was validated with TypeScript checks, automated tests, production build validation, and visual review of a representative PowerPoint export.

The latest clean application checkpoint is `1881ef54`.
