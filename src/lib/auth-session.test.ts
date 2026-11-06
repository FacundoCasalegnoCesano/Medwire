import { beforeAll, describe, expect, it, vi } from "vitest";

const { getSessionFromAuth, headers, redirect } = vi.hoisted(() => ({
  getSessionFromAuth: vi.fn(),
  headers: vi.fn(async () => new Headers({ cookie: "session=opaque" })),
  redirect: vi.fn((path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("better-auth", () => ({ betterAuth: () => ({ api: { getSession: getSessionFromAuth } }) }));
vi.mock("@better-auth/prisma-adapter", () => ({ prismaAdapter: vi.fn(() => ({})) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: vi.fn() }));

describe("server session guard", () => {
  beforeAll(() => {
    vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-secret-with-more-than-thirty-two-characters");
  });

  it("redirects requests without a valid session to the sign-in page", async () => {
    getSessionFromAuth.mockResolvedValue(null);
    const { requireSession } = await import("@/lib/auth");

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(getSessionFromAuth).toHaveBeenCalledWith({ headers: expect.any(Headers) });
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("returns the session bound to request cookies", async () => {
    const session = { user: { id: "user-a", name: "Ada" }, session: { id: "session-a" } };
    getSessionFromAuth.mockResolvedValue(session);
    const { requireSession } = await import("@/lib/auth");

    await expect(requireSession()).resolves.toBe(session);
    expect(headers).toHaveBeenCalled();
  });
});
