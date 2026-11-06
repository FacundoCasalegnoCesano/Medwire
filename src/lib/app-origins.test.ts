import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppOrigins } from "@/lib/app-origins";

afterEach(() => vi.unstubAllEnvs());

describe("configured app origins", () => {
  it.each([
    ["http://127.0.0.1:3000", ["http://127.0.0.1:3000", "http://localhost:3000"]],
    ["http://localhost:3000", ["http://localhost:3000", "http://127.0.0.1:3000"]],
  ])("adds only the same-port loopback alias for %s", (appUrl, expected) => {
    vi.stubEnv("BETTER_AUTH_URL", appUrl);
    expect(getAppOrigins()).toEqual(expected);
  });

  it.each([
    "https://localhost:3000",
    "http://api.example.test:3000",
    "https://api.example.test:3000",
    "http://localhost.evil.com:3000",
    "http://constructor:3000",
    "http://__proto__:3000",
  ])("does not add an alias for %s", (appUrl) => {
    vi.stubEnv("BETTER_AUTH_URL", appUrl);
    expect(getAppOrigins()).toEqual([new URL(appUrl).origin]);
  });
});
