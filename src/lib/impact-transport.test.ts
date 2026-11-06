import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGitHubApiResourceFetcher, type MonitorSourcesNetwork } from "@/lib/monitor-sources";

function response(statusCode: number) {
  return { statusCode, headers: {}, body: Buffer.from("{}") };
}

function network(options: { addresses?: string[]; status?: number } = {}) {
  const resolve = vi.fn(async () => options.addresses ?? ["140.82.112.6"]);
  const request = vi.fn(async (url: URL, address: string, requestOptions: { maxBytes: number; timeoutMs: number; headers: Record<string, string> }) => {
    expect(url.hostname).toBe("api.github.com");
    expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(requestOptions.maxBytes).toBeGreaterThan(0);
    return response(options.status ?? 200);
  });
  return { resolve, request, value: { resolve, request } as MonitorSourcesNetwork };
}

describe("pinned GitHub API transport", () => {
  it("allows only the fixed API host and repository read paths", async () => {
    const fixture = network();
    const fetch = createGitHubApiResourceFetcher(fixture.value);
    await expect(fetch({
      url: "https://api.github.com/repos/acme/widgets/commits?per_page=1", maxBytes: 128, timeoutMs: 1000,
    })).resolves.toMatchObject({ statusCode: 200 });
    expect(fixture.resolve).toHaveBeenCalledWith("api.github.com");
    expect(fixture.request.mock.calls[0][0].pathname).toBe("/repos/acme/widgets/commits");
    expect(fixture.request.mock.calls[0][1]).toBe("140.82.112.6");
  });

  it("rejects alternate hosts, API paths, and unapproved query strings before network access", async () => {
    const fixture = network();
    const fetch = createGitHubApiResourceFetcher(fixture.value);
    for (const url of [
      "https://evil.example/repos/acme/widgets/commits?per_page=1",
      "https://api.github.com/user",
      "https://api.github.com/repos/acme/widgets/commits?per_page=100",
    ]) {
      await expect(fetch({ url, maxBytes: 128, timeoutMs: 1000 })).rejects.toThrow();
    }
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("rejects redirects rather than following an untrusted Location", async () => {
    const fixture = network({ status: 302 });
    const fetch = createGitHubApiResourceFetcher(fixture.value);
    await expect(fetch({
      url: "https://api.github.com/repos/acme/widgets/git/trees/" + "a".repeat(40) + "?recursive=1",
      maxBytes: 128, timeoutMs: 1000,
    })).rejects.toThrow(/redirect/i);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it("rejects a public hostname if DNS returns any private address", async () => {
    const fixture = network({ addresses: ["140.82.112.6", "127.0.0.1"] });
    const fetch = createGitHubApiResourceFetcher(fixture.value);
    await expect(fetch({
      url: "https://api.github.com/repos/acme/widgets/commits?per_page=1", maxBytes: 128, timeoutMs: 1000,
    })).rejects.toThrow(/public IP/i);
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
