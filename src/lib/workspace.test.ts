import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, upsert, currentUser, db } = vi.hoisted(() => {
  const currentUser = { id: "user-a", name: "Ada" };
  const upsert = vi.fn(async ({ where, create }: {
    where: { ownerId: string };
    create: { ownerId: string; name: string };
  }) => {
    return { id: `workspace-${where.ownerId}`, ...create };
  });
  const db = {
    workspace: { upsert },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const requireSession = vi.fn(async () => ({ user: currentUser }));
  return { requireSession, upsert, currentUser, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireSession }));
vi.mock("@/lib/db", () => ({ db }));

import { requireWorkspace } from "@/lib/workspace";

describe("requireWorkspace", () => {
  beforeEach(() => {
    upsert.mockClear();
    db.$transaction.mockClear();
    currentUser.id = "user-a";
    currentUser.name = "Ada";
  });

  it("passes the authenticated account ID into the transactional upsert", async () => {
    const workspace = await requireWorkspace();

    expect(workspace.ownerId).toBe("user-a");
    expect(upsert).toHaveBeenCalledWith({
      where: { ownerId: "user-a" },
      create: { ownerId: "user-a", name: "Ada's workspace" },
      update: {},
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("ignores an unexpected external owner argument and keeps accounts isolated", async () => {
    await requireWorkspace();
    currentUser.id = "user-b";
    currentUser.name = "Grace";
    const second = await Reflect.apply(requireWorkspace, undefined, ["user-a"]);

    expect(second.ownerId).toBe("user-b");
    expect(upsert).toHaveBeenLastCalledWith({
      where: { ownerId: "user-b" },
      create: { ownerId: "user-b", name: "Grace's workspace" },
      update: {},
    });
  });

  it("does not touch the database when session resolution fails", async () => {
    requireSession.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/sign-in"));

    await expect(requireWorkspace()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
