import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { CheckFinding } from "@/lib/monitor-check-types";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export class OpenApiDiffError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "FAILED" | "INVALID_OUTPUT" | "UNSUPPORTED_VERSION") {
    super(`OpenAPI comparison failed (${code}).`);
    this.name = "OpenApiDiffError";
  }
}

export function verifyOasdiffVersion(output: string): void {
  if (!/^oasdiff version 1\.35\.0(?:\s|$)/.test(output.trim())) {
    throw new OpenApiDiffError("UNSUPPORTED_VERSION");
  }
}

type OasdiffFinding = {
  id?: unknown;
  text?: unknown;
  level?: unknown;
  operation?: unknown;
  path?: unknown;
  section?: unknown;
  schema?: unknown;
  property?: unknown;
};

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

export function parseBreakingChanges(output: string): CheckFinding[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new OpenApiDiffError("INVALID_OUTPUT");
  }
  if (!Array.isArray(value)) throw new OpenApiDiffError("INVALID_OUTPUT");

  return value.map((item: OasdiffFinding) => {
    const code = safeText(item.id, 120);
    const summary = safeText(item.text, 600);
    const level = item.level;
    if (!code || !summary || typeof level !== "number" || (level !== 2 && level !== 3)) {
      throw new OpenApiDiffError("INVALID_OUTPUT");
    }
    const method = safeText(item.operation, 12)?.toUpperCase() ?? null;
    const path = safeText(item.path, 500);
    const section = safeText(item.section, 160);
    const schema = safeText(item.schema, 160);
    const property = safeText(item.property, 160);
    const location = method && path
      ? `${method} ${path}`
      : [section, schema, property].filter((part): part is string => Boolean(part)).join("/") || "OpenAPI document";

    return {
      code,
      location: location.slice(0, 700),
      method,
      path,
      summary,
      severity: level === 3 ? "BREAKING" : "POTENTIAL",
    };
  });
}

function findOasdiffPath(): string | null {
  const configured = process.env.OASDIFF_PATH?.trim();
  if (configured) return resolve(configured);

  const localBinary = resolve(process.cwd(), ".tools", "oasdiff-1.35.0", process.platform === "win32" ? "oasdiff.exe" : "oasdiff");
  if (existsSync(localBinary)) return localBinary;

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const pathBinary = process.platform === "win32" ? "oasdiff.exe" : "oasdiff";
  for (const entry of pathEntries) {
    const candidate = join(entry, pathBinary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runOasdiff(binary: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(binary, args, {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(new OpenApiDiffError("FAILED"));
      else resolveOutput(stdout);
    });
  });
}

export async function compareOpenApiDocuments(previous: unknown, current: unknown): Promise<CheckFinding[]> {
  const binary = findOasdiffPath();
  if (!binary) throw new OpenApiDiffError("UNAVAILABLE");
  verifyOasdiffVersion(await runOasdiff(binary, ["--version"]));

  const directory = await mkdtemp(join(tmpdir(), "mendwire-oasdiff-"));
  const previousFile = join(directory, "previous.json");
  const currentFile = join(directory, "current.json");
  try {
    await Promise.all([
      writeFile(previousFile, JSON.stringify(previous), { encoding: "utf8", flag: "wx", mode: 0o600 }),
      writeFile(currentFile, JSON.stringify(current), { encoding: "utf8", flag: "wx", mode: 0o600 }),
    ]);
    const output = await runOasdiff(binary, [
      "breaking",
      "--allow-external-refs=false",
      "--auto-upgrade",
      "--format",
      "json",
      previousFile,
      currentFile,
    ]);
    return parseBreakingChanges(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
