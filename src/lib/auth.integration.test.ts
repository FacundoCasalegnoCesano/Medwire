import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const context = vi.hoisted(() => ({ cookie: "" }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: context.cookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string): never => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

const testDatabaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set AUTH_TEST_DATABASE_URL to a dedicated local test database before running test:integration");
}

const testDatabase = new URL(testDatabaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(testDatabase.hostname) || !testDatabase.pathname.endsWith("_test")) {
  throw new Error("AUTH_TEST_DATABASE_URL must use a loopback host and a database name ending in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_URL = process.env.AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3000";
process.env.BETTER_AUTH_SECRET = "test-only-secret-that-is-long-enough-for-better-auth";

const appUrl = process.env.BETTER_AUTH_URL!;
const emails = [`auth-${randomUUID()}@example.test`, `auth-${randomUUID()}@example.test`];

describe("Better Auth and workspace integration", () => {
  let auth = undefined as unknown as typeof import("@/lib/auth").auth;
  let db = undefined as unknown as typeof import("@/lib/db").db;
  let requireWorkspace: typeof import("@/lib/workspace").requireWorkspace;
  let takeTestResetEmails: typeof import("@/lib/email").takeTestResetEmails;
  let authGetRoute: typeof import("@/app/api/auth/[...all]/route").GET;
  let authPostRoute: typeof import("@/app/api/auth/[...all]/route").POST;
  const resetVerificationIdentifiers: string[] = [];

  beforeAll(async () => {
    ({ auth } = await import("@/lib/auth"));
    ({ db } = await import("@/lib/db"));
    ({ requireWorkspace } = await import("@/lib/workspace"));
    ({ takeTestResetEmails } = await import("@/lib/email"));
    ({ GET: authGetRoute, POST: authPostRoute } = await import("@/app/api/auth/[...all]/route"));
    await db.$connect();
  });

  afterAll(async () => {
    if (!db?.$disconnect) return;
    await db.verification.deleteMany({ where: { identifier: { in: resetVerificationIdentifiers } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  async function request(path: string, body?: unknown, cookie = "", origin = appUrl) {
    const request = new Request(`${origin}/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = path === "request-password-reset" && body !== undefined
      ? await authPostRoute(request)
      : await auth.handler(request);
    const sessionCookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return { response, sessionCookie, json: await response.json().catch(() => null) as Record<string, unknown> | null };
  }

  async function sessionFor(cookie: string) {
    const result = await request("get-session", undefined, cookie);
    return result.json;
  }

  function tokenFromResetEmailUrl(resetUrl: string) {
    return new URL(resetUrl).pathname.split("/").filter(Boolean).at(-1);
  }

  async function resetLinkCallback(token: string, callbackURL = "/reset-password") {
    const url = new URL(`/api/auth/reset-password/${token}`, appUrl);
    url.searchParams.set("callbackURL", callbackURL);
    return authGetRoute(new Request(url, { headers: { origin: appUrl }, redirect: "manual" }));
  }

  it("covers signup, login, logout, reset expiry/use, session revocation, and workspace isolation", async () => {
    const firstSignup = await request("sign-up/email", {
      name: "Ada",
      email: emails[0],
      password: "old-password-123",
      callbackURL: "/app",
    });
    expect(firstSignup.response.ok).toBe(true);
    expect(firstSignup.sessionCookie).not.toBe("");
    expect(await sessionFor(firstSignup.sessionCookie)).toBeTruthy();

    const userA = await db.user.findUniqueOrThrow({ where: { email: emails[0] } });
    context.cookie = firstSignup.sessionCookie;
    const workspaceA = await requireWorkspace();
    expect(workspaceA.ownerId).toBe(userA.id);
    expect((await requireWorkspace()).id).toBe(workspaceA.id);

    const secondSignup = await request("sign-up/email", {
      name: "Grace",
      email: emails[1],
      password: "other-password-123",
      callbackURL: "/app",
    });
    expect(secondSignup.response.ok).toBe(true);
    const userB = await db.user.findUniqueOrThrow({ where: { email: emails[1] } });
    context.cookie = secondSignup.sessionCookie;
    const workspaceB = await requireWorkspace();
    expect(workspaceB.ownerId).toBe(userB.id);
    expect(workspaceB.id).not.toBe(workspaceA.id);

    context.cookie = firstSignup.sessionCookie;
    expect((await requireWorkspace()).id).toBe(workspaceA.id);

    const signOut = await request("sign-out", {}, firstSignup.sessionCookie);
    expect(signOut.response.ok).toBe(true);
    expect(await sessionFor(firstSignup.sessionCookie)).toBeFalsy();
    const login = await request("sign-in/email", { email: emails[0], password: "old-password-123" });
    expect(login.response.ok).toBe(true);
    const localhostLogin = await request("sign-in/email", { email: emails[0], password: "old-password-123" }, "", "http://localhost:3000");
    expect(localhostLogin.response.ok).toBe(true);
    const wrongPortLogin = await request("sign-in/email", { email: emails[0], password: "old-password-123" }, firstSignup.sessionCookie, "http://localhost:3001");
    expect(wrongPortLogin.response.ok).toBe(false);
    const secondLogin = await request("sign-in/email", { email: emails[0], password: "old-password-123" });
    expect(secondLogin.response.ok).toBe(true);

    const resetRequested = await request("request-password-reset", { email: emails[0], redirectTo: "/reset-password" });
    expect(resetRequested.response.ok).toBe(true);
    const captured = takeTestResetEmails().find((email) => email.to === emails[0]);
    expect(captured).toBeDefined();
    const expiredToken = tokenFromResetEmailUrl(captured!.resetUrl);
    expect(expiredToken).toBeTruthy();
    const unknownReset = await request("request-password-reset", {
      email: `unknown-${randomUUID()}@example.test`,
      redirectTo: "/reset-password",
    });
    expect(unknownReset.response.status).toBe(resetRequested.response.status);
    expect(unknownReset.json).toEqual(resetRequested.json);
    expect(takeTestResetEmails()).toEqual([]);
    for (const redirectTo of [
      "https://attacker.example/collect",
      "//attacker.example/collect",
      "/\\attacker.example/collect",
      "/%2f%2fattacker.example/collect",
      "javascript:alert(1)",
      "http://user:pass@127.0.0.1:3000/reset-password",
    ]) {
      const unsafeResetRequest = await request("request-password-reset", { email: emails[0], redirectTo });
      expect(unsafeResetRequest.response.ok).toBe(false);
    }
    const formRedirectRequest = await authPostRoute(new Request(`${appUrl}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { origin: appUrl, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: emails[0], redirectTo: "https://attacker.example/collect" }),
    }));
    expect(formRedirectRequest.status).toBe(400);

    const resetRecord = await db.verification.findFirstOrThrow({
      where: { identifier: `reset-password:${expiredToken}` },
      orderBy: { createdAt: "desc" },
    });
    resetVerificationIdentifiers.push(resetRecord.identifier);
    expect(Math.abs(resetRecord.expiresAt.getTime() - resetRecord.createdAt.getTime() - 60 * 60 * 1000)).toBeLessThan(5000);
    await db.verification.update({ where: { id: resetRecord.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredAttempt = await request("reset-password", { token: expiredToken, newPassword: "new-password-456" });
    expect(expiredAttempt.response.ok).toBe(false);

    const resetAgain = await request("request-password-reset", { email: emails[0], redirectTo: "/reset-password" });
    expect(resetAgain.response.ok).toBe(true);
    const validEmail = takeTestResetEmails().find((email) => email.to === emails[0]);
    const validToken = tokenFromResetEmailUrl(validEmail!.resetUrl);
    expect(validToken).toBeTruthy();
    resetVerificationIdentifiers.push(`reset-password:${validToken}`);
    const callback = await resetLinkCallback(validToken!);
    expect(callback.status).toBe(302);
    const callbackLocation = new URL(callback.headers.get("location")!);
    expect(callbackLocation.origin).toBe(appUrl);
    expect(callbackLocation.pathname).toBe("/reset-password");
    expect(callbackLocation.searchParams.get("token")).toBe(validToken);

    for (const callbackURL of [
      "https://attacker.example/collect",
      "//attacker.example/collect",
      "/\\attacker.example/collect",
      "/%2f%2fattacker.example/collect",
      "javascript:alert(1)",
      "http://user:pass@127.0.0.1:3000/reset-password",
    ]) {
      const rejectedCallback = await resetLinkCallback(validToken!, callbackURL);
      expect(rejectedCallback.status).toBe(400);
      expect(rejectedCallback.headers.get("location")).toBeNull();
    }
    const completed = await request("reset-password", { token: validToken, newPassword: "new-password-456" });
    expect(completed.response.ok).toBe(true);
    const reused = await request("reset-password", { token: validToken, newPassword: "another-password-789" });
    expect(reused.response.ok).toBe(false);

    expect(await sessionFor(login.sessionCookie)).toBeFalsy();
    expect(await sessionFor(secondLogin.sessionCookie)).toBeFalsy();
    expect(await sessionFor(secondSignup.sessionCookie)).toBeTruthy();
    const newLogin = await request("sign-in/email", { email: emails[0], password: "new-password-456" });
    expect(newLogin.response.ok).toBe(true);
    expect(await sessionFor(newLogin.sessionCookie)).toBeTruthy();
    const newLogout = await request("sign-out", {}, newLogin.sessionCookie);
    expect(newLogout.response.ok).toBe(true);
    expect(await sessionFor(newLogin.sessionCookie)).toBeFalsy();
  });
});
