import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitor-sources", () => ({ fetchGitHubApiResource: vi.fn() }));

import { fetchGitHubApiResource } from "@/lib/monitor-sources";
import { ImpactSourceError, readRepositoryFiles, resolveRepositoryRevision } from "@/lib/impact-repository";
import { createHash } from "node:crypto";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const blobContent = "fetch('/x');\n";
function gitBlobSha(content: string) {
  const bytes = Buffer.from(content);
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
const blobSha = gitBlobSha(blobContent);
const mockedFetch = vi.mocked(fetchGitHubApiResource);

function response(value: unknown) {
  return { statusCode: 200, body: Buffer.from(JSON.stringify(value)) };
}

beforeEach(() => mockedFetch.mockReset());

describe("impact repository source", () => {
  it("resolves a public GitHub head to a validated immutable commit SHA", async () => {
    mockedFetch.mockResolvedValueOnce(response([{ sha: commitSha }]));
    await expect(resolveRepositoryRevision("https://github.com/acme/widgets.git/")).resolves.toEqual({ commitSha });
    expect(mockedFetch.mock.calls[0][0].url).toBe("https://api.github.com/repos/acme/widgets/commits?per_page=1");
  });

  it("reads the commit tree and blobs by the supplied SHA even if the branch head changes", async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: [
        { path: "src/client.ts", type: "blob", mode: "100644", sha: blobSha, size: Buffer.byteLength(blobContent) },
      ] }))
      .mockResolvedValueOnce(response({ sha: blobSha, size: Buffer.byteLength(blobContent), encoding: "base64", content: Buffer.from(blobContent).toString("base64") }));

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files).toEqual([{ path: "src/client.ts", content: blobContent }]);
    expect(result.coverage).toMatchObject({ source: "SUPPORTED", filesDiscovered: 1, filesAnalyzed: 1, filesSkipped: 0 });
    expect(mockedFetch.mock.calls.map(([request]) => request.url)).toEqual([
      `https://api.github.com/repos/acme/widgets/git/commits/${commitSha}`,
      `https://api.github.com/repos/acme/widgets/git/trees/${treeSha}?recursive=1`,
      `https://api.github.com/repos/acme/widgets/git/blobs/${blobSha}`,
    ]);
  });

  it("reports unsupported hosts and rejects a moving ref instead of reading it", async () => {
    await expect(resolveRepositoryRevision("https://gitlab.com/acme/widgets")).rejects.toMatchObject({ code: "UNSUPPORTED_SOURCE" });
    await expect(readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha: "main" }))
      .rejects.toMatchObject({ code: "INVALID_SOURCE" });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("makes truncated trees and source count or size limits visible as partial coverage", async () => {
    const entries = Array.from({ length: 32 }, (_, index) => ({
      path: `src/file-${String(index).padStart(2, "0")}.ts`, type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1,
    }));
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: true, tree: entries }));
    for (const entry of entries.slice(0, 30)) {
      mockedFetch.mockResolvedValueOnce(response({ sha: entry.sha, size: 1, encoding: "base64", content: Buffer.from("x").toString("base64") }));
    }

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files).toHaveLength(30);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 32, filesAnalyzed: 30, filesSkipped: 2 });
    expect(result.coverage.reasons.join(" ")).toMatch(/truncated|limit/i);
  });

  it("selects application source before lower-priority files and accounts for every omitted candidate", async () => {
    const entries = [
      { path: "src/components/monitor-check-panel.tsx", type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1 },
      ...Array.from({ length: 35 }, (_, index) => ({
        path: `scripts/tool-${String(index).padStart(2, "0")}.ts`, type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1,
      })),
    ];
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: entries }));
    entries.slice(0, 30).forEach(() => {
      mockedFetch.mockResolvedValueOnce(response({ sha: gitBlobSha("x"), size: 1, encoding: "base64", content: Buffer.from("x").toString("base64") }));
    });

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });

    expect(result.files).toHaveLength(30);
    expect(result.files.map((file) => file.path)).toContain("src/components/monitor-check-panel.tsx");
    expect(result.files.map((file) => file.path)).not.toContain("scripts/tool-34.ts");
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 36, filesAnalyzed: 30, filesSkipped: 6 });
    expect(result.coverage.reasons.join(" ")).toMatch(/prioritized/i);
  });

  it("uses path depth before lexical order when bounded selection cuts through application source", async () => {
    const entries = [
      ...Array.from({ length: 30 }, (_, index) => ({
        path: `src/components/nested/deep-${String(index).padStart(2, "0")}.tsx`, type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1,
      })),
      { path: "src/services/Zeta.tsx", type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1 },
    ];
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: entries }));
    entries.slice(0, 30).forEach(() => {
      mockedFetch.mockResolvedValueOnce(response({ sha: gitBlobSha("x"), size: 1, encoding: "base64", content: Buffer.from("x").toString("base64") }));
    });

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });

    expect(result.files).toHaveLength(30);
    expect(result.files.map((file) => file.path)).toContain("src/services/Zeta.tsx");
    expect(result.files.map((file) => file.path)).not.toContain("src/components/nested/deep-29.tsx");
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 31, filesAnalyzed: 30, filesSkipped: 1 });
  });

  it("uses codepoint path order as a deterministic tie-breaker at the file cap", async () => {
    const entries = Array.from({ length: 31 }, (_, index) => ({
      path: `src/components/Component-${String(index).padStart(2, "0")}.tsx`, type: "blob", mode: "100644", sha: gitBlobSha("x"), size: 1,
    })).reverse();
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: entries }));
    entries.slice(0, 30).forEach(() => {
      mockedFetch.mockResolvedValueOnce(response({ sha: gitBlobSha("x"), size: 1, encoding: "base64", content: Buffer.from("x").toString("base64") }));
    });

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });

    expect(result.files).toHaveLength(30);
    expect(result.files.map((file) => file.path)).toContain("src/components/Component-00.tsx");
    expect(result.files.map((file) => file.path)).not.toContain("src/components/Component-30.tsx");
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 31, filesAnalyzed: 30, filesSkipped: 1 });
  });

  it("rejects blob content whose SHA or byte size differs from the pinned tree", async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: [
        { path: "client.js", type: "blob", mode: "100644", sha: gitBlobSha("xy"), size: 2 },
      ] }))
      .mockResolvedValueOnce(response({ sha: gitBlobSha("xy"), size: 2, encoding: "base64", content: Buffer.from("zz").toString("base64") }));

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files).toEqual([]);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesAnalyzed: 0, filesSkipped: 1 });
  });

  it("skips symlinks and oversized source blobs without requesting their contents", async () => {
    const normalSha = gitBlobSha("x");
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: [
        { path: "safe.ts", type: "blob", mode: "100644", sha: normalSha, size: 1 },
        { path: "link.ts", type: "blob", mode: "120000", sha: blobSha, size: 1 },
        { path: "large.ts", type: "blob", mode: "100644", sha: "e".repeat(40), size: 49 * 1024 },
      ] }))
      .mockResolvedValueOnce(response({ sha: normalSha, size: 1, encoding: "base64", content: Buffer.from("x").toString("base64") }));

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files.map((file) => file.path)).toEqual(["safe.ts"]);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 3, filesAnalyzed: 1, filesSkipped: 2 });
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it("makes recognized and unclassified source extensions visible in coverage", async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: [
        { path: "native/module.c", type: "blob", mode: "100644", sha: gitBlobSha("int x;"), size: 6 },
        { path: "custom/module.zig", type: "blob", mode: "100644", sha: gitBlobSha("const x = 1;"), size: 12 },
      ] }));

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files).toEqual([]);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 2, filesAnalyzed: 0, filesSkipped: 2 });
    expect(result.coverage.reasons.join(" ")).toMatch(/non-JavaScript|unclassified/i);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("reports Git submodules as omitted coverage", async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ sha: commitSha, tree: { sha: treeSha } }))
      .mockResolvedValueOnce(response({ sha: treeSha, truncated: false, tree: [
        { path: "packages/sdk", type: "commit", mode: "160000", sha: "c".repeat(40) },
      ] }));

    const result = await readRepositoryFiles({ repositoryUrl: "https://github.com/acme/widgets", commitSha });
    expect(result.files).toEqual([]);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 0, filesAnalyzed: 0, filesSkipped: 0 });
    expect(result.coverage.reasons.join(" ")).toMatch(/Git submodules are not traversed/i);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("uses a typed public-source error for other Git hosts", async () => {
    let caught: unknown;
    try { await readRepositoryFiles({ repositoryUrl: "https://bitbucket.org/acme/widgets", commitSha }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ImpactSourceError);
    expect(caught).toMatchObject({ code: "UNSUPPORTED_SOURCE" });
  });
});
