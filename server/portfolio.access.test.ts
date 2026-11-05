import { describe, expect, it } from "vitest";
import { requireTeamEditor } from "./portfolio";
import type { User } from "../drizzle/schema";

const executive: User = {
  id: 91,
  openId: "executive-user",
  name: "Executive Administrator",
  email: "executive@example.com",
  loginMethod: "google",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("team access rules", () => {
  it("allows an executive administrator to write across every team without querying memberships", async () => {
    await expect(requireTeamEditor(executive, 1)).resolves.toBeUndefined();
    await expect(requireTeamEditor(executive, 2)).resolves.toBeUndefined();
    await expect(requireTeamEditor(executive, 3)).resolves.toBeUndefined();
    await expect(requireTeamEditor(executive, 4)).resolves.toBeUndefined();
    await expect(requireTeamEditor(executive, 5)).resolves.toBeUndefined();
  });
});
