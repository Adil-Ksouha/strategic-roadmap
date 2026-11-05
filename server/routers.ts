import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  authenticateLocalAccount,
  bootstrapLocalAdministrator,
  createLocalAccount,
  hasLocalAdministrator,
  removeLocalAccount,
  resetLocalPassword,
  setLocalAccountStatus,
  setLocalSession,
} from "./localAuth";
import {
  addFinancialPlanningYear,
  bulkLinkCapabilitiesToUseCase,
  createCapability,
  createExecutionMilestone,
  createKpiDefinition,
  createUseCase,
  deleteCapability,
  deleteExecutionMilestone,
  deleteKpiDefinition,
  deleteUseCase,
  getPortfolioAccess,
  getPortfolioSnapshot,
  linkCapabilityToUseCase,
  listTeamDirectory,
  requireCapabilityEditor,
  requireExecutive,
  requireMilestoneEditor,
  requireTeamEditor,
  requireUseCaseEditor,
  setCapabilityKpis,
  unlinkCapabilityFromUseCase,
  updateCapability,
  updateExecutionMilestone,
  updateKpiDefinition,
  updateUseCase,
  upsertInvestment,
} from "./portfolio";
import { createPortfolioExport } from "./portfolioExport";

const id = z.number().int().positive();
const year = z.number().int().min(2020).max(2100);
const capabilityInput = z.object({
  name: z.string().min(2).max(160),
  domain: z.string().min(2).max(80),
  description: z.string().min(10).max(2000),
  owner: z.string().min(2).max(120),
  maturity: z.enum(["emerging", "evolving", "established"]),
  criticality: z.enum(["critical", "high", "medium", "low"]),
  targetYear: year,
  teamId: id,
});
const useCaseInput = z
  .object({
    name: z.string().min(2).max(160),
    theme: z.string().min(2).max(100),
    description: z.string().min(10).max(2000),
    outcome: z.string().min(10).max(2000),
    sponsor: z.string().min(2).max(120),
    status: z.enum(["prioritized", "in_flight", "planned", "watchlist"]),
    priority: z.enum(["p1", "p2", "p3"]),
    startYear: year,
    endYear: year,
    teamId: id.nullable(),
    scope: z.enum(["team", "shared"]).default("team"),
  })
  .superRefine((data, ctx) => {
    if (data.endYear < data.startYear)
      ctx.addIssue({
        code: "custom",
        message: "End year must follow start year.",
        path: ["endYear"],
      });
    if (data.scope === "team" && !data.teamId)
      ctx.addIssue({
        code: "custom",
        message: "Select an owning team for a team-owned Strategic Objective.",
        path: ["teamId"],
      });
    if (data.scope === "shared" && data.teamId !== null)
      ctx.addIssue({
        code: "custom",
        message: "Shared Strategic Objectives do not have an owning team.",
        path: ["teamId"],
      });
  });
const milestoneInput = z.object({
  useCaseId: id,
  planningYear: year,
  phase: z.enum(["discover", "foundation", "scale", "optimize", "run"]),
  title: z.string().min(2).max(180),
  status: z.enum(["planned", "in_progress", "complete"]),
});
const kpiDefinitionInput = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(2).max(240),
  strategicPillar: z.string().trim().min(2).max(140),
  theme: z.string().trim().min(2).max(160),
  unit: z.string().trim().min(1).max(40),
});
const localAccountInput = z.object({
  email: z.string().email().max(320),
  name: z.string().min(2).max(120),
  password: z.string().min(12).max(200),
  teamId: id,
  teamRole: z.enum(["lead", "contributor"]),
  role: z.enum(["user", "admin"]).default("user"),
});

function requireActiveLocalAccount(user: {
  loginMethod: string | null;
  isActive: "active" | "disabled";
}) {
  if (user.loginMethod !== "local" || user.isActive !== "active")
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in with an active private platform account.",
    });
}

const localAccountProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  requireActiveLocalAccount(ctx.user);
  return next();
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts =>
      opts.ctx.user?.loginMethod === "local" &&
      opts.ctx.user.isActive === "active"
        ? opts.ctx.user
        : null
    ),
    canBootstrap: publicProcedure.query(async () => ({
      enabled: !(await hasLocalAdministrator()),
    })),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email().max(320),
          password: z.string().min(1).max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await authenticateLocalAccount(
          input.email,
          input.password
        );
        if (!user)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "Email or password is incorrect, or this account is disabled.",
          });
        await setLocalSession(ctx.req, ctx.res, user);
        return { success: true } as const;
      }),
    bootstrap: publicProcedure
      .input(
        localAccountInput.extend({ bootstrapToken: z.string().min(1).max(500) })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const user = await bootstrapLocalAdministrator(input);
          await setLocalSession(ctx.req, ctx.res, user);
          return { success: true } as const;
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              error instanceof Error
                ? error.message
                : "Administrator setup failed.",
          });
        }
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  portfolio: router({
    snapshot: localAccountProcedure.query(() => getPortfolioSnapshot()),
    access: localAccountProcedure.query(({ ctx }) =>
      getPortfolioAccess(ctx.user)
    ),
    exportPortfolio: localAccountProcedure
      .input(z.object({ format: z.enum(["excel", "powerpoint"]) }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return createPortfolioExport(
          input.format,
          await getPortfolioSnapshot()
        );
      }),
    directory: localAccountProcedure.query(async ({ ctx }) => {
      await requireExecutive(ctx.user);
      return listTeamDirectory();
    }),
    createAccount: localAccountProcedure
      .input(localAccountInput)
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return createLocalAccount(input);
      }),
    resetAccountPassword: localAccountProcedure
      .input(z.object({ userId: id, password: z.string().min(12).max(200) }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return resetLocalPassword(input);
      }),
    setAccountStatus: localAccountProcedure
      .input(z.object({ userId: id, isActive: z.enum(["active", "disabled"]) }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return setLocalAccountStatus(input);
      }),
    removeAccount: localAccountProcedure
      .input(z.object({ userId: id }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return removeLocalAccount(input.userId);
      }),
    addCapability: localAccountProcedure
      .input(capabilityInput)
      .mutation(async ({ ctx, input }) => {
        await requireTeamEditor(ctx.user, input.teamId);
        return createCapability(input);
      }),
    updateCapability: localAccountProcedure
      .input(capabilityInput.extend({ id }))
      .mutation(async ({ ctx, input }) => {
        const { id: recordId, ...values } = input;
        await requireCapabilityEditor(ctx.user, recordId);
        await requireTeamEditor(ctx.user, values.teamId);
        return updateCapability(recordId, values);
      }),
    deleteCapability: localAccountProcedure
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireCapabilityEditor(ctx.user, input.id);
        return deleteCapability(input.id);
      }),
    setCapabilityKpis: localAccountProcedure
      .input(
        z.object({
          capabilityId: id,
          kpiIds: z
            .array(id)
            .max(100)
            .refine(
              ids => new Set(ids).size === ids.length,
              "Select each KPI only once."
            ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireCapabilityEditor(ctx.user, input.capabilityId);
        return setCapabilityKpis(input);
      }),
    createKpiDefinition: localAccountProcedure
      .input(kpiDefinitionInput)
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return createKpiDefinition(input);
      }),
    updateKpiDefinition: localAccountProcedure
      .input(kpiDefinitionInput.extend({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        const { id: recordId, ...values } = input;
        return updateKpiDefinition(recordId, values);
      }),
    deleteKpiDefinition: localAccountProcedure
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return deleteKpiDefinition(input.id);
      }),
    addUseCase: localAccountProcedure
      .input(useCaseInput)
      .mutation(async ({ ctx, input }) => {
        if (input.scope === "shared") await requireExecutive(ctx.user);
        else await requireTeamEditor(ctx.user, input.teamId!);
        return createUseCase(input);
      }),
    updateUseCase: localAccountProcedure
      .input(useCaseInput.safeExtend({ id }))
      .mutation(async ({ ctx, input }) => {
        const { id: recordId, ...values } = input;
        await requireUseCaseEditor(ctx.user, recordId);
        if (values.scope === "shared") await requireExecutive(ctx.user);
        else await requireTeamEditor(ctx.user, values.teamId!);
        return updateUseCase(recordId, values);
      }),
    deleteUseCase: localAccountProcedure
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.id);
        return deleteUseCase(input.id);
      }),
    addMilestone: localAccountProcedure
      .input(milestoneInput)
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.useCaseId);
        return createExecutionMilestone(input);
      }),
    updateMilestone: localAccountProcedure
      .input(milestoneInput.extend({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireMilestoneEditor(ctx.user, input.id);
        const { id: recordId, ...values } = input;
        return updateExecutionMilestone(recordId, values);
      }),
    deleteMilestone: localAccountProcedure
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        await requireMilestoneEditor(ctx.user, input.id);
        return deleteExecutionMilestone(input.id);
      }),
    linkCapability: localAccountProcedure
      .input(
        z.object({
          useCaseId: id,
          capabilityId: id,
          contribution: z.enum(["anchor", "enabling", "supporting"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.useCaseId);
        return linkCapabilityToUseCase(input);
      }),
    bulkLinkCapabilities: localAccountProcedure
      .input(
        z.object({
          useCaseId: id,
          capabilityIds: z
            .array(id)
            .min(1)
            .max(100)
            .refine(
              ids => new Set(ids).size === ids.length,
              "Select each capability only once."
            ),
          contribution: z.enum(["anchor", "enabling", "supporting"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.useCaseId);
        return bulkLinkCapabilitiesToUseCase(input);
      }),
    unlinkCapability: localAccountProcedure
      .input(z.object({ useCaseId: id, capabilityId: id }))
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.useCaseId);
        return unlinkCapabilityFromUseCase(input);
      }),
    addFinancialPlanningYear: localAccountProcedure
      .input(z.object({ planningYear: year }))
      .mutation(async ({ ctx, input }) => {
        await requireExecutive(ctx.user);
        return addFinancialPlanningYear(input.planningYear);
      }),
    setInvestment: localAccountProcedure
      .input(
        z.object({
          useCaseId: id,
          planningYear: year,
          budgetType: z.enum(["internal", "external"]),
          amountSarM: z.number().min(0).max(999999),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireUseCaseEditor(ctx.user, input.useCaseId);
        return upsertInvestment(input);
      }),
  }),
});

export type AppRouter = typeof appRouter;
