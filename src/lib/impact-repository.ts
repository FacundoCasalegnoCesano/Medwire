import "server-only";

import { createHash } from "node:crypto";
import { fetchGitHubApiResource } from "@/lib/monitor-sources";
import type { ImpactCoverage } from "@/lib/impact-types";

const MAX_ANALYSIS_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 48 * 1024;
const MAX_TOTAL_FILE_BYTES = 1_440 * 1024;
const MAX_FILES = 30;
const MAX_CONCURRENT_BLOBS = 4;
const SOURCE_EXTENSIONS = /\.(?:[cm]?js|[cm]?jsx|tsx?)$/i;
const OTHER_SOURCE_EXTENSIONS = /\.(?:py|go|rs|java|kt|rb|php|cs|vue|svelte|html|swift|scala|dart|c|h|cc|cpp|cxx|hpp|hxx|m|mm|sh|bash|zsh|sql|pl|pm|ex|exs|clj|cljs|edn|erl|hrl|fs|fsx|hs|lua|r)$/i;
const KNOWN_NON_SOURCE_EXTENSIONS = /\.(?:md|mdx|txt|rst|adoc|png|jpe?g|gif|webp|svg|ico|pdf|woff2?|ttf|otf|eot|mp[34]|wav|zip|gz|lock|json|ya?ml|toml|ini|xml|csv|env|gitignore|editorconfig|map)$/i;
const SKIPPED_DIRECTORY = /(?:^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|\.turbo|generated|\.output)(?:\/|$)/i;

export type ImpactSourceErrorCode =
  | "UNSUPPORTED_SOURCE"
  | "INVALID_SOURCE"
  | "REVISION_NOT_FOUND"
  | "FETCH_FAILED"
  | "LIMIT_EXCEEDED";

export class ImpactSourceError extends Error {
  constructor(readonly code: ImpactSourceErrorCode, message: string) {
    super(message);
    this.name = "ImpactSourceError";
  }
}

type GitHubRepository = { owner: string; repo: string; canonicalUrl: string };
type GitTreeEntry = { path?: unknown; type?: unknown; mode?: unknown; sha?: unknown; size?: unknown };

function repositoryFromUrl(repositoryUrl: string): GitHubRepository {
  let url: URL;
  try { url = new URL(repositoryUrl); }
  catch { throw new ImpactSourceError("INVALID_SOURCE", "Repository URL is invalid."); }
  if (url.hostname.toLowerCase() !== "github.com" || url.protocol !== "https:") {
    throw new ImpactSourceError("UNSUPPORTED_SOURCE", "Repository analysis currently supports public GitHub repositories only.");
  }
  if ((url.port && url.port !== "443") || url.username || url.password || url.search || url.hash) {
    throw new ImpactSourceError("INVALID_SOURCE", "Repository URL must be a public GitHub HTTPS URL without credentials, query, or fragment.");
  }
  const path = url.pathname.replace(/\/$/, "").replace(/\.git$/i, "");
  const parts = path.slice(1).split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part) || part === "." || part === "..")) {
    throw new ImpactSourceError("INVALID_SOURCE", "Repository URL must identify one GitHub owner and repository.");
  }
  return { owner: parts[0], repo: parts[1], canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}` };
}

function apiUrl(repository: GitHubRepository, endpoint: string, query = ""): string {
  return `https://api.github.com/repos/${repository.owner}/${repository.repo}/${endpoint}${query}`;
}

async function githubJson(url: string, deadline: number, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ImpactSourceError("FETCH_FAILED", "Repository analysis timed out.");
  let response: { statusCode: number; body: Uint8Array };
  try {
    response = await fetchGitHubApiResource({ url, maxBytes, timeoutMs: remaining });
  } catch (error) {
    if (error instanceof ImpactSourceError) throw error;
    throw new ImpactSourceError("FETCH_FAILED", "GitHub repository data could not be fetched safely.");
  }
  if (response.statusCode === 404) throw new ImpactSourceError("REVISION_NOT_FOUND", "The pinned GitHub repository revision is unavailable.");
  if (response.statusCode === 403 || response.statusCode === 429) {
    throw new ImpactSourceError("FETCH_FAILED", "GitHub rate limited repository analysis; retry later.");
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new ImpactSourceError("FETCH_FAILED", "GitHub repository data could not be fetched.");
  }
  if (Date.now() > deadline) throw new ImpactSourceError("FETCH_FAILED", "Repository analysis timed out.");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)) as unknown; }
  catch { throw new ImpactSourceError("FETCH_FAILED", "GitHub returned invalid repository data."); }
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

export async function resolveRepositoryRevision(repositoryUrl: string): Promise<{ commitSha: string }> {
  const repository = repositoryFromUrl(repositoryUrl);
  const deadline = Date.now() + MAX_ANALYSIS_MS;
  const response = await githubJson(apiUrl(repository, "commits", "?per_page=1"), deadline);
  const commit = Array.isArray(response) ? response[0] as { sha?: unknown } | undefined : undefined;
  if (!commit || !isSha(commit.sha)) {
    throw new ImpactSourceError("FETCH_FAILED", "GitHub did not return a valid repository commit SHA.");
  }
  return { commitSha: commit.sha };
}

function safeRepositoryPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 1_024 || value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\u0000-\u001f\u007f]/.test(part));
}

function addReason(reasons: string[], reason: string) {
  if (reasons.length < 12 && !reasons.includes(reason)) reasons.push(reason);
}

type BlobCandidate = { path: string; sha: string; size: number };

function parseBlob(value: unknown, candidate: BlobCandidate): string | null {
  if (!value || typeof value !== "object") return null;
  const blob = value as { encoding?: unknown; content?: unknown; size?: unknown; sha?: unknown };
  if (blob.encoding !== "base64" || typeof blob.content !== "string" || blob.sha !== candidate.sha ||
    !Number.isSafeInteger(blob.size) || blob.size !== candidate.size) return null;
  const compact = blob.content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  if (bytes.byteLength !== candidate.size || bytes.includes(0)) return null;
  const gitBlobSha = createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
  if (gitBlobSha !== candidate.sha) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return null; }
}

export async function readRepositoryFiles(input: {
  repositoryUrl: string;
  commitSha: string;
}): Promise<{ files: Array<{ path: string; content: string }>; coverage: ImpactCoverage }> {
  const repository = repositoryFromUrl(input.repositoryUrl);
  if (!isSha(input.commitSha)) throw new ImpactSourceError("INVALID_SOURCE", "A full immutable GitHub commit SHA is required.");

  const coverage: ImpactCoverage = { source: "SUPPORTED", filesDiscovered: 0, filesAnalyzed: 0, filesSkipped: 0, reasons: [] };
  const deadline = Date.now() + MAX_ANALYSIS_MS;
  const commitValue = await githubJson(apiUrl(repository, `git/commits/${input.commitSha}`), deadline);
  const commit = commitValue && typeof commitValue === "object" ? commitValue as { sha?: unknown; tree?: { sha?: unknown } } : null;
  if (!commit || commit.sha !== input.commitSha || !isSha(commit.tree?.sha)) {
    throw new ImpactSourceError("REVISION_NOT_FOUND", "The pinned GitHub commit is unavailable or invalid.");
  }
  const treeValue = await githubJson(apiUrl(repository, `git/trees/${commit.tree.sha}`, "?recursive=1"), deadline);
  if (!treeValue || typeof treeValue !== "object" || !Array.isArray((treeValue as { tree?: unknown }).tree)) {
    throw new ImpactSourceError("FETCH_FAILED", "GitHub did not return a repository tree.");
  }
  const tree = treeValue as { sha?: unknown; truncated?: unknown; tree: GitTreeEntry[] };
  if (tree.sha !== commit.tree.sha) throw new ImpactSourceError("FETCH_FAILED", "GitHub returned a tree for a different commit.");
  if (tree.truncated === true) {
    coverage.source = "PARTIAL";
    addReason(coverage.reasons, "GitHub truncated the repository tree response.");
  }

  const candidates: BlobCandidate[] = [];
  for (const entry of tree.tree) {
    if (entry.type === "commit" && entry.mode === "160000") {
      coverage.source = "PARTIAL";
      addReason(coverage.reasons, "Git submodules are not traversed or analyzed.");
      continue;
    }
    if (entry.type !== "blob" || typeof entry.path !== "string") continue;
    if (SKIPPED_DIRECTORY.test(entry.path)) {
      if (SOURCE_EXTENSIONS.test(entry.path)) {
        coverage.filesDiscovered += 1;
        coverage.filesSkipped += 1;
        addReason(coverage.reasons, "Generated, vendored, build, and dependency directories are excluded.");
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.test(entry.path)) {
      if (OTHER_SOURCE_EXTENSIONS.test(entry.path)) {
        coverage.filesDiscovered += 1;
        coverage.filesSkipped += 1;
        coverage.source = "PARTIAL";
        addReason(coverage.reasons, "Non-JavaScript and non-TypeScript source files are not analyzed.");
      } else if (/[.]([A-Za-z0-9]+)$/.test(entry.path) && !KNOWN_NON_SOURCE_EXTENSIONS.test(entry.path)) {
        coverage.filesDiscovered += 1;
        coverage.filesSkipped += 1;
        coverage.source = "PARTIAL";
        addReason(coverage.reasons, "Unclassified file extensions may contain source code and are omitted from analysis.");
      }
      continue;
    }
    coverage.filesDiscovered += 1;
    if (!safeRepositoryPath(entry.path) || entry.mode === "120000" || entry.mode === "160000" || !isSha(entry.sha) ||
      !Number.isSafeInteger(entry.size) || (entry.size as number) < 0) {
      coverage.filesSkipped += 1;
      addReason(coverage.reasons, "Some source entries had unsafe paths or unsupported Git object types.");
      continue;
    }
    const size = entry.size as number;
    if (size > MAX_FILE_BYTES) {
      coverage.filesSkipped += 1;
      addReason(coverage.reasons, "Some source files exceeded the 48 KiB per-file limit.");
      continue;
    }
    candidates.push({ path: entry.path, sha: entry.sha, size });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  const selected: BlobCandidate[] = [];
  let selectedBytes = 0;
  for (const candidate of candidates) {
    if (selected.length >= MAX_FILES || selectedBytes + candidate.size > MAX_TOTAL_FILE_BYTES) continue;
    selected.push(candidate);
    selectedBytes += candidate.size;
  }
  if (candidates.length > selected.length) {
    coverage.filesSkipped += candidates.length - selected.length;
    coverage.source = "PARTIAL";
    addReason(coverage.reasons, "Repository file or total source byte limit reached (30 files and 1.4 MiB per analysis).");
  }
  if (coverage.filesSkipped > 0) coverage.source = "PARTIAL";

  const files: Array<{ path: string; content: string }> = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const current = selected[cursor++];
      let value: unknown;
      try {
        value = await githubJson(apiUrl(repository, `git/blobs/${current.sha}`), deadline, Math.min(MAX_FILE_BYTES * 2, MAX_RESPONSE_BYTES));
      } catch (error) {
        throw error;
      }
      const content = parseBlob(value, current);
      if (content === null) {
        coverage.filesSkipped += 1;
        coverage.source = "PARTIAL";
        addReason(coverage.reasons, "Some source blobs were invalid, binary, or inconsistent with the pinned tree.");
        continue;
      }
      files.push({ path: current.path, content });
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_BLOBS, selected.length) }, () => worker()));
  files.sort((a, b) => a.path.localeCompare(b.path));
  coverage.filesAnalyzed = files.length;
  if (coverage.filesDiscovered === 0) {
    coverage.source = "PARTIAL";
    addReason(coverage.reasons, "No JavaScript or TypeScript source files were found.");
  }
  return { files, coverage };
}
