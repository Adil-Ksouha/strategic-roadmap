import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const localAuthMocks = vi.hoisted(() => ({
  authenticateLocalAccount: vi.fn(), bootstrapLocalAdministrator: vi.fn(), createLocalAccount: vi.fn(), hasLocalAdministrator: vi.fn(), removeLocalAccount: vi.fn(), resetLocalPassword: vi.fn(), setLocalAccountStatus: vi.fn(), setLocalSession: vi.fn(),
}));
vi.mock("./localAuth", () => localAuthMocks);
const { appRouter } = await import("./routers");

const localUser = { id: 1, openId: "local-user", name: "Local Planner", email: "planner@example.com", loginMethod: "local", passwordHash: "hash", isActive: "active", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
function caller() {
  return appRouter.createCaller({ user: null, req: { protocol: "https", headers: {} }, res: { cookie: vi.fn(), clearCookie: vi.fn() } } as unknown as TrpcContext);
}

describe("local authentication router", () => {
  beforeEach(() => { Object.values(localAuthMocks).forEach(mock => mock.mockReset()); });

  it("issues a local session only after valid local credentials are verified", async () => {
    localAuthMocks.authenticateLocalAccount.mockResolvedValue(localUser);
    localAuthMocks.setLocalSession.mockResolvedValue(undefined);
    await expect(caller().auth.login({ email: "planner@example.com", password: "private-password" })).resolves.toEqual({ success: true });
    expect(localAuthMocks.authenticateLocalAccount).toHaveBeenCalledWith("planner@example.com", "private-password");
    expect(localAuthMocks.setLocalSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), localUser);
  });

  it("rejects an invalid or disabled private-account login without issuing a session", async () => {
    localAuthMocks.authenticateLocalAccount.mockResolvedValue(null);
    await expect(caller().auth.login({ email: "planner@example.com", password: "wrong-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(localAuthMocks.setLocalSession).not.toHaveBeenCalled();
  });

  it("allows setup only when the account service accepts the one-time bootstrap token", async () => {
    localAuthMocks.bootstrapLocalAdministrator.mockResolvedValue(localUser);
    localAuthMocks.setLocalSession.mockResolvedValue(undefined);
    await expect(caller().auth.bootstrap({ email: "admin@example.com", name: "Executive Administrator", password: "A secure initial password", bootstrapToken: "12345678901234567", teamId: 1, teamRole: "lead" })).resolves.toEqual({ success: true });
    localAuthMocks.bootstrapLocalAdministrator.mockRejectedValue(new Error("A local administrator account has already been created."));
    await expect(caller().auth.bootstrap({ email: "admin@example.com", name: "Executive Administrator", password: "A secure initial password", bootstrapToken: "12345678901234567", teamId: 1, teamRole: "lead" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports first-administrator setup as unavailable after an administrator exists", async () => {
    localAuthMocks.hasLocalAdministrator.mockResolvedValue(true);
    await expect(caller().auth.canBootstrap()).resolves.toEqual({ enabled: false });
    localAuthMocks.hasLocalAdministrator.mockResolvedValue(false);
    await expect(caller().auth.canBootstrap()).resolves.toEqual({ enabled: true });
  });
});
