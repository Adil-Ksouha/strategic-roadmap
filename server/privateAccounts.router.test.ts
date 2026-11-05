import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const localAuthMocks = vi.hoisted(() => ({
  authenticateLocalAccount: vi.fn(), bootstrapLocalAdministrator: vi.fn(), createLocalAccount: vi.fn(), hasLocalAdministrator: vi.fn(), removeLocalAccount: vi.fn(), resetLocalPassword: vi.fn(), setLocalAccountStatus: vi.fn(), setLocalSession: vi.fn(),
}));
const portfolioMocks = vi.hoisted(() => ({
  createCapability: vi.fn(), createExecutionMilestone: vi.fn(), createUseCase: vi.fn(), deleteCapability: vi.fn(), deleteExecutionMilestone: vi.fn(), deleteUseCase: vi.fn(), getPortfolioAccess: vi.fn(), getPortfolioSnapshot: vi.fn(), linkCapabilityToUseCase: vi.fn(), listTeamDirectory: vi.fn(), requireCapabilityEditor: vi.fn(), requireExecutive: vi.fn(), requireMilestoneEditor: vi.fn(), requireTeamEditor: vi.fn(), requireUseCaseEditor: vi.fn(), updateCapability: vi.fn(), updateExecutionMilestone: vi.fn(), updateUseCase: vi.fn(), upsertInvestment: vi.fn(),
}));
vi.mock("./localAuth", () => localAuthMocks);
vi.mock("./portfolio", () => portfolioMocks);
const { appRouter } = await import("./routers");

const administrator = { id: 1, openId: "admin-user", name: "Executive Administrator", email: "admin@example.com", loginMethod: "local", passwordHash: "hash", isActive: "active", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const createdUser = { id: 2, openId: "new-user", name: "Network Engineer", email: "engineer@example.com", loginMethod: "local", passwordHash: "hash", isActive: "active", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const accountInput = { email: "engineer@example.com", name: "Network Engineer", password: "A secure initial password", teamId: 2, teamRole: "contributor" as const };

function caller(user: typeof administrator | null) {
  return appRouter.createCaller({ user, req: { protocol: "https", headers: {} }, res: { cookie: vi.fn(), clearCookie: vi.fn() } } as unknown as TrpcContext);
}

describe("executive private-account lifecycle", () => {
  beforeEach(() => { Object.values(localAuthMocks).forEach(mock => mock.mockReset()); Object.values(portfolioMocks).forEach(mock => mock.mockReset()); });

  it("creates a private account under executive control and allows it through the local login contract", async () => {
    portfolioMocks.requireExecutive.mockResolvedValue(undefined);
    localAuthMocks.createLocalAccount.mockResolvedValue(createdUser);
    await expect(caller(administrator).portfolio.createAccount(accountInput)).resolves.toMatchObject({ id: 2, email: "engineer@example.com", loginMethod: "local", isActive: "active" });
    expect(localAuthMocks.createLocalAccount).toHaveBeenCalledWith({ ...accountInput, role: "user" });

    localAuthMocks.authenticateLocalAccount.mockResolvedValue(createdUser);
    localAuthMocks.setLocalSession.mockResolvedValue(undefined);
    await expect(caller(null).auth.login({ email: accountInput.email, password: accountInput.password })).resolves.toEqual({ success: true });
    expect(localAuthMocks.setLocalSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), createdUser);
  });
});
