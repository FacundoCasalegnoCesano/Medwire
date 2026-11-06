import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import { isIP, type LookupFunction } from "node:net";
import { Agent, request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

export type SourceValidationResult = { valid: boolean; error: string | null };

export type MonitorSourcesValidation = {
  contract: SourceValidationResult;
  repository: SourceValidationResult;
};

export type MonitorSourceKind = "contract" | "repository";

type MonitorSourcesLimits = {
  timeoutMs: number;
  maxContractBytes: number;
  maxRepositoryBytes: number;
  maxRedirects: number;
};

type MonitorHttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
};

export type MonitorSourcesNetwork = {
  resolve(hostname: string): Promise<readonly string[]>;
  request(
    url: URL,
    address: string,
    options: { maxBytes: number; timeoutMs: number; headers: Record<string, string> },
  ): Promise<MonitorHttpResponse>;
};

type MonitorSourcesValidatorOptions = {
  resolve: MonitorSourcesNetwork["resolve"];
  request: MonitorSourcesNetwork["request"];
  limits?: Partial<MonitorSourcesLimits>;
};

const MAX_URL_LENGTH = 2_048;
const MAX_DOCUMENT_DEPTH = 64;
const MAX_DOCUMENT_NODES = 20_000;
const MAX_YAML_ALIASES = 64;
const MAX_YAML_ANCHORS = 64;
const DEFAULT_LIMITS: MonitorSourcesLimits = {
  timeoutMs: 5_000,
  maxContractBytes: 1_048_576,
  maxRepositoryBytes: 2_097_152,
  maxRedirects: 3,
};

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  JSON_SCHEMA: unknown;
  load(input: string, options: {
    schema: unknown;
    maxDepth: number;
    maxTotalMergeKeys: number;
  }): unknown;
};

const IPV4_BLOCKED = [
  [0x00000000, 8],  // This network
  [0x0a000000, 8],  // Private use
  [0x64400000, 10], // Shared address space / CGNAT
  [0x7f000000, 8],  // Loopback
  [0xa9fe0000, 16], // Link local
  [0xac100000, 12], // Private use
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // Documentation
  [0xc0586300, 24], // Deprecated 6to4 relay anycast
  [0xc0a80000, 16], // Private use
  [0xc6120000, 15], // Benchmarking
  [0xc6336400, 24], // Documentation
  [0xcb007100, 24], // Documentation
  [0xe0000000, 4],  // Multicast
  [0xf0000000, 4],  // Reserved and limited broadcast
] as const;

const IPV6_BLOCKED = [
  [0x20010000000000000000000000000000n, 23], // IETF protocol assignments, including Teredo
  [0x20010db8000000000000000000000000n, 32], // Documentation
  [0x20020000000000000000000000000000n, 16], // 6to4
  [0x3fff0000000000000000000000000000n, 20], // Documentation
] as const;

function inPrefix(address: bigint, prefix: bigint, bits: number): boolean {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (address & mask) === prefix;
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets.reduce((value, octet) => (value * 256 + octet) >>> 0, 0);
}

function ipv6Number(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedTail) {
    const ipv4 = ipv4Number(dottedTail[1]);
    if (ipv4 === null) return null;
    normalized = normalized.slice(0, -dottedTail[1].length) +
      `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return value !== null && !IPV4_BLOCKED.some(([prefix, bits]) => {
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return ((value & mask) >>> 0) === prefix;
    });
  }

  if (family !== 6) return false;
  const value = ipv6Number(address);
  if (value === null) return false;

  // IPv4-mapped IPv6 must pass the IPv4 policy too.
  if (value >> 32n === 0xffffn) {
    const mapped = value & 0xffffffffn;
    return isPublicAddress([
      Number((mapped >> 24n) & 255n),
      Number((mapped >> 16n) & 255n),
      Number((mapped >> 8n) & 255n),
      Number(mapped & 255n),
    ].join("."));
  }

  // Only global-unicast IPv6 is eligible. This also excludes loopback,
  // unspecified, multicast, link-local, ULA, NAT64, and reserved space.
  if (!inPrefix(value, 0x20000000000000000000000000000000n, 3)) return false;
  return !IPV6_BLOCKED.some(([prefix, bits]) => inPrefix(value, prefix, bits));
}

function parseUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH || raw.trim() !== raw) {
    throw new Error("URL is invalid or too long.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only public HTTPS URLs without credentials are allowed.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Only HTTPS port 443 is allowed.");
  }
  if (url.search || url.hash) throw new Error("Source URLs cannot include a query or fragment.");
  if (!url.hostname) throw new Error("URL must include a public hostname.");
  return url;
}

export function getMonitorSourceInputError(
  value: string,
  kind: MonitorSourceKind,
): string | null {
  try {
    if (kind === "repository") repositoryUrl(value);
    else parseUrl(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Source URL is invalid.";
  }
}

function getHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

async function withDeadline<T>(operation: () => Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error("Validation timed out.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Validation timed out.")), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolvePublicAddress(
  url: URL,
  resolve: MonitorSourcesNetwork["resolve"],
  deadline: number,
): Promise<string> {
  const hostname = getHostname(url);
  const literal = isIP(hostname) ? [hostname] : null;
  const addresses = literal ?? await withDeadline(() => resolve(hostname), deadline - Date.now());
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Hostname does not resolve exclusively to public IP addresses.");
  }
  return addresses[0];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createPinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error("Pinned address is invalid.");
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function requestHttpsPinned(
  url: URL,
  address: string,
  options: { maxBytes: number; timeoutMs: number; headers: Record<string, string> },
): Promise<MonitorHttpResponse> {
  return new Promise((resolve, reject) => {
    const family = isIP(address);
    const agent = new Agent({ keepAlive: false, maxSockets: 1 });
    let settled = false;
    const finish = (error?: Error, result?: MonitorHttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      agent.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Request failed."));
    };

    const req = httpsRequest(url, {
      method: "GET",
      headers: options.headers,
      agent,
      maxHeaderSize: 16 * 1024,
      family,
      autoSelectFamily: false,
      ...(!isIP(getHostname(url)) ? { servername: getHostname(url) } : {}),
      lookup: createPinnedLookup(address),
    } as Parameters<typeof httpsRequest>[1], (res: IncomingMessage) => {
      const headers = {
        "content-type": headerValue(res.headers["content-type"]),
        location: headerValue(res.headers.location),
      };
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
        res.destroy();
        finish(undefined, { statusCode: res.statusCode ?? 0, headers, body: Buffer.alloc(0) });
        return;
      }

      const announcedLength = Number(res.headers["content-length"]);
      if (Number.isFinite(announcedLength) && announcedLength > options.maxBytes) {
        res.destroy();
        finish(new Error("Response exceeds the byte limit."));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > options.maxBytes) {
          res.destroy();
          req.destroy(new Error("Response exceeds the byte limit."));
          finish(new Error("Response exceeds the byte limit."));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => finish(undefined, {
        statusCode: res.statusCode ?? 0,
        headers,
        body: Buffer.concat(chunks, size),
      }));
      res.on("error", (error) => finish(error));
    });

    const totalTimer = setTimeout(() => req.destroy(new Error("Validation timed out.")), options.timeoutMs);
    req.on("error", (error: Error) => finish(error));
    req.end();
  });
}

function contentType(response: MonitorHttpResponse): string {
  return (headerValue(response.headers["content-type"]) ?? "").split(";", 1)[0].trim().toLowerCase();
}

function readPacket(body: Uint8Array, offset: number): { payload?: string; next: number; special?: "flush" } {
  if (offset + 4 > body.length) throw new Error("Repository advertisement is malformed.");
  const lengthText = Buffer.from(body.subarray(offset, offset + 4)).toString("ascii");
  if (!/^[0-9a-fA-F]{4}$/.test(lengthText)) throw new Error("Repository advertisement is malformed.");
  const length = Number.parseInt(lengthText, 16);
  if (length === 0) return { next: offset + 4, special: "flush" };
  if (length < 4 || offset + length > body.length) throw new Error("Repository advertisement is malformed.");
  const payload = Buffer.from(body.subarray(offset + 4, offset + length)).toString("utf8");
  return { payload, next: offset + length };
}

function isValidRef(ref: string): boolean {
  if (ref === "HEAD") return true;
  if (!ref.startsWith("refs/") || ref.length > 1024) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(ref) || ref.includes("..") || ref.includes("@{")) return false;
  if (ref.startsWith("/") || ref.endsWith("/") || ref.includes("//")) return false;
  return ref.split("/").every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock"));
}

function hasGitRefAdvertisement(response: MonitorHttpResponse): boolean {
  if (contentType(response) !== "application/x-git-upload-pack-advertisement") return false;
  let offset = 0;
  const service = readPacket(response.body, offset);
  if (service.payload !== "# service=git-upload-pack\n") return false;
  offset = service.next;
  const serviceFlush = readPacket(response.body, offset);
  if (serviceFlush.special !== "flush") return false;
  offset = serviceFlush.next;

  let refCount = 0;
  let sawFlush = false;
  while (offset < response.body.length) {
    const packet = readPacket(response.body, offset);
    offset = packet.next;
    if (packet.special === "flush") {
      sawFlush = true;
      break;
    }
    const line = packet.payload?.replace(/\n$/, "") ?? "";
    if (line === "version 2" || line.startsWith("ERR ") || line.length === 0) return false;
    const firstNul = line.indexOf("\0");
    const refLine = firstNul === -1 ? line : line.slice(0, firstNul);
    const match = refLine.match(/^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}) (.+)$/);
    if (!match) return false;
    const ref = match[2].replace(/\^\{\}$/, "");
    if (!isValidRef(ref)) return false;
    refCount += 1;
  }

  return sawFlush && offset === response.body.length && refCount > 0;
}

function countYamlAliases(source: string): { aliases: number; anchors: number } {
  let aliases = 0;
  let anchors = 0;
  let quote: "single" | "double" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote === "single") {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === "double") {
      if (char === "\\") index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "#") {
      const newline = source.indexOf("\n", index);
      if (newline === -1) break;
      index = newline;
      continue;
    }
    if (char === "'") {
      quote = "single";
      continue;
    }
    if (char === '"') {
      quote = "double";
      continue;
    }
    if ((char === "*" || char === "&") && /[\w-]/.test(source[index + 1] ?? "") &&
      (index === 0 || /[\s[{,:?]/.test(source[index - 1]))) {
      if (char === "*") aliases += 1;
      else anchors += 1;
    }
  }
  return { aliases, anchors };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkDocumentSize(document: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    count += 1;
    if (count > MAX_DOCUMENT_NODES || current.depth > MAX_DOCUMENT_DEPTH) {
      throw new Error("OpenAPI document exceeds structural limits.");
    }
    if (current.value === null || typeof current.value !== "object" || seen.has(current.value)) continue;
    seen.add(current.value);
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (count + stack.length + children.length > MAX_DOCUMENT_NODES) {
      throw new Error("OpenAPI document exceeds structural limits.");
    }
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
}

function resolveJsonPointer(document: unknown, fragment: string): unknown {
  if (fragment === "") return document;
  if (!fragment.startsWith("/")) throw new Error("OpenAPI reference is unresolved.");
  let current: unknown = document;
  for (const encodedSegment of fragment.slice(1).split("/")) {
    if (/~(?![01])/.test(encodedSegment)) throw new Error("OpenAPI reference is unresolved.");
    const segment = encodedSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error("OpenAPI reference is unresolved.");
      current = current[Number(segment)];
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      throw new Error("OpenAPI reference is unresolved.");
    }
    if (current === undefined) throw new Error("OpenAPI reference is unresolved.");
  }
  return current;
}

function validateOpenApiReferences(document: Record<string, unknown>, version: string): void {
  const anchors = new Set<string>();
  const refs: string[] = [];
  const stack: unknown[] = [document];
  const seen = new Set<object>();

  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$anchor === "string") anchors.add(record.$anchor);
    if (typeof record.$dynamicRef === "string") {
      throw new Error("OpenAPI dynamic references ($dynamicRef) are not supported.");
    }
    if (typeof record.$ref === "string") refs.push(record.$ref);
    stack.push(...Object.values(record));
  }

  for (const ref of refs) {
    if (!ref.startsWith("#")) throw new Error("External OpenAPI references are not allowed.");
    let fragment: string;
    try {
      fragment = decodeURIComponent(ref.slice(1));
    } catch {
      throw new Error("OpenAPI reference is malformed.");
    }
    if (!fragment.startsWith("/") && fragment !== "") {
      if (!version.startsWith("3.1.") || !anchors.has(fragment)) {
        throw new Error("OpenAPI reference is unresolved.");
      }
      continue;
    }
    resolveJsonPointer(document, fragment);
  }
}

function validatePaths(paths: Record<string, unknown>): void {
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  for (const [path, rawItem] of Object.entries(paths)) {
    if (!path.startsWith("/") || !isPlainObject(rawItem)) {
      throw new Error("OpenAPI paths must map slash-prefixed paths to path items.");
    }
    for (const [key, operation] of Object.entries(rawItem)) {
      if (key.startsWith("x-") || ["$ref", "summary", "description", "servers", "parameters"].includes(key)) {
        continue;
      }
      if (!methods.has(key)) throw new Error("OpenAPI path item contains an unsupported field.");
      if (!isPlainObject(operation) || !isPlainObject(operation.responses) ||
        Object.keys(operation.responses).length === 0) {
        throw new Error("OpenAPI operations must include a non-empty responses object.");
      }
      for (const response of Object.values(operation.responses)) {
        if (!isPlainObject(response) ||
          (response.$ref !== undefined && typeof response.$ref !== "string")) {
          throw new Error("OpenAPI responses must be response objects or internal references.");
        }
      }
    }
  }
}

function parseOpenApi(body: Uint8Array): Record<string, unknown> {
  if (body.byteLength === 0 || body.byteLength > DEFAULT_LIMITS.maxContractBytes) {
    throw new Error("Contract exceeds the byte limit or is empty.");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("Contract must be UTF-8 JSON or YAML.");
  }

  let document: unknown;
  try {
    if (/^\s*[\[{]/.test(source)) document = JSON.parse(source);
    else {
      const { aliases, anchors } = countYamlAliases(source);
      if (aliases > MAX_YAML_ALIASES || anchors > MAX_YAML_ANCHORS) {
        throw new Error("YAML aliases exceed the allowed limit.");
      }
      document = yaml.load(source, {
        schema: yaml.JSON_SCHEMA,
        maxDepth: MAX_DOCUMENT_DEPTH,
        maxTotalMergeKeys: 1_000,
      });
    }
  } catch {
    throw new Error("Contract is not valid JSON or YAML.");
  }

  checkDocumentSize(document);
  if (!isPlainObject(document)) throw new Error("Contract is not an OpenAPI object.");

  const version = document.openapi;
  if (typeof version !== "string" || !/^3\.(?:0|1)\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new Error("Only OpenAPI 3.0 and 3.1 documents are supported.");
  }
  if (!isPlainObject(document.info) ||
    typeof document.info.title !== "string" || !document.info.title.trim() ||
    typeof document.info.version !== "string" || !document.info.version.trim()) {
    throw new Error("OpenAPI info must include a title and version.");
  }
  if (document.paths !== undefined && !isPlainObject(document.paths)) {
    throw new Error("OpenAPI paths must be an object.");
  }
  if (document.components !== undefined && !isPlainObject(document.components)) {
    throw new Error("OpenAPI components must be an object.");
  }
  if (version.startsWith("3.0.") && !isPlainObject(document.paths)) {
    throw new Error("OpenAPI 3.0 requires a paths object.");
  }
  if (version.startsWith("3.1.") && !["paths", "components", "webhooks"].some((key) =>
    isPlainObject(document[key]),
  )) {
    throw new Error("OpenAPI 3.1 requires paths, components, or webhooks.");
  }
  if (isPlainObject(document.paths)) validatePaths(document.paths);

  validateOpenApiReferences(document, version);
  return document;
}

function repositoryUrl(input: string): URL {
  const url = parseUrl(input);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/info/refs`;
  url.search = "?service=git-upload-pack";
  return url;
}

function safeFailure(error: unknown): SourceValidationResult {
  return {
    valid: false,
    error: error instanceof Error ? error.message : "Source could not be validated.",
  };
}

async function fetchSource(
  initialUrl: URL,
  kind: MonitorSourceKind,
  network: MonitorSourcesNetwork,
  limits: MonitorSourcesLimits,
): Promise<MonitorHttpResponse> {
  const deadline = Date.now() + limits.timeoutMs;
  const visited = new Set<string>();
  let url = initialUrl;

  for (let redirect = 0; ; redirect += 1) {
    if (Date.now() >= deadline) throw new Error("Validation timed out.");
    if (visited.has(url.href)) throw new Error("Source redirected in a loop.");
    visited.add(url.href);

    const address = await resolvePublicAddress(url, network.resolve, deadline);
    const requestOptions = {
      maxBytes: kind === "contract" ? limits.maxContractBytes : limits.maxRepositoryBytes,
      timeoutMs: deadline - Date.now(),
      headers: kind === "repository"
        ? {
            accept: "application/x-git-upload-pack-advertisement",
            "accept-encoding": "identity",
          }
        : {
            accept: "application/json, application/yaml, text/yaml, text/plain;q=0.9",
            "accept-encoding": "identity",
          },
    };
    const response = await withDeadline(
      () => network.request(url, address, requestOptions),
      requestOptions.timeoutMs,
    );

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (redirect >= limits.maxRedirects) throw new Error("Source exceeded the redirect limit.");
      const location = headerValue(response.headers.location);
      if (!location) throw new Error("Source redirect is invalid.");
      try {
        url = new URL(location, url);
      } catch {
        throw new Error("Source redirect is invalid.");
      }
      if (kind === "repository") {
        const search = url.search;
        url.search = "";
        parseUrl(url.href);
        if (search !== "?service=git-upload-pack") {
          throw new Error("Repository redirect query is invalid.");
        }
        url.search = search;
      } else {
        parseUrl(url.href);
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("Source did not return a successful response.");
    }
    const maxBytes = kind === "contract" ? limits.maxContractBytes : limits.maxRepositoryBytes;
    if (response.body.byteLength > maxBytes) throw new Error("Response exceeds the byte limit.");
    return response;
  }
}

function resultOf(run: () => Promise<void>): Promise<SourceValidationResult> {
  return run().then(
    () => ({ valid: true, error: null }),
    (error: unknown) => safeFailure(error),
  );
}

export function createMonitorSourcesValidator(options: MonitorSourcesValidatorOptions) {
  const limits: MonitorSourcesLimits = {
    timeoutMs: options.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxContractBytes: options.limits?.maxContractBytes ?? DEFAULT_LIMITS.maxContractBytes,
    maxRepositoryBytes: options.limits?.maxRepositoryBytes ?? DEFAULT_LIMITS.maxRepositoryBytes,
    maxRedirects: options.limits?.maxRedirects ?? DEFAULT_LIMITS.maxRedirects,
  };
  const network: MonitorSourcesNetwork = {
    resolve: options.resolve,
    request: options.request,
  };

  return async (input: { contractUrl: string; repositoryUrl: string }): Promise<MonitorSourcesValidation> => {
    let contract: URL | undefined;
    let repository: URL | undefined;
    let contractError: Error | undefined;
    let repositoryError: Error | undefined;
    try { contract = parseUrl(input.contractUrl); }
    catch (error) { contractError = error instanceof Error ? error : new Error("Contract URL is invalid."); }
    try { repository = repositoryUrl(input.repositoryUrl); }
    catch (error) { repositoryError = error instanceof Error ? error : new Error("Repository URL is invalid."); }

    const [contractResult, repositoryResult] = await Promise.all([
      contractError
        ? Promise.resolve(safeFailure(contractError))
        : resultOf(async () => {
            const response = await fetchSource(contract!, "contract", network, limits);
            parseOpenApi(response.body);
          }),
      repositoryError
        ? Promise.resolve(safeFailure(repositoryError))
        : resultOf(async () => {
            const response = await fetchSource(repository!, "repository", network, limits);
            if (!hasGitRefAdvertisement(response)) {
              throw new Error("Source did not return Git upload-pack refs.");
            }
          }),
    ]);
    return { contract: contractResult, repository: repositoryResult };
  };
}

const defaultMonitorSourcesNetwork: MonitorSourcesNetwork = {
  resolve: async (hostname) => {
    const results = await lookup(hostname, { all: true, order: "verbatim" });
    return results.map((result) => result.address);
  },
  request: requestHttpsPinned,
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type FetchedOpenApiContract = {
  contractUrl: string;
  document: Record<string, unknown>;
  revisionId: string;
  specVersion: string;
};

export function createMonitorContractFetcher(options: MonitorSourcesValidatorOptions) {
  const limits: MonitorSourcesLimits = {
    timeoutMs: options.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxContractBytes: options.limits?.maxContractBytes ?? DEFAULT_LIMITS.maxContractBytes,
    maxRepositoryBytes: options.limits?.maxRepositoryBytes ?? DEFAULT_LIMITS.maxRepositoryBytes,
    maxRedirects: options.limits?.maxRedirects ?? DEFAULT_LIMITS.maxRedirects,
  };
  const network: MonitorSourcesNetwork = { resolve: options.resolve, request: options.request };

  return async (contractUrl: string): Promise<FetchedOpenApiContract> => {
    const url = parseUrl(contractUrl);
    const response = await fetchSource(url, "contract", network, limits);
    const document = parseOpenApi(response.body);
    return {
      contractUrl: url.href,
      document,
      revisionId: createHash("sha256").update(canonicalJson(document)).digest("hex"),
      specVersion: document.openapi as string,
    };
  };
}

const fetchWithDefaultNetwork = createMonitorContractFetcher(defaultMonitorSourcesNetwork);
const validateWithDefaultNetwork = createMonitorSourcesValidator(defaultMonitorSourcesNetwork);

export function fetchMonitorContract(contractUrl: string): Promise<FetchedOpenApiContract> {
  return fetchWithDefaultNetwork(contractUrl);
}

export async function validateMonitorSources(input: {
  contractUrl: string;
  repositoryUrl: string;
}): Promise<MonitorSourcesValidation> {
  return validateWithDefaultNetwork(input);
}

/**
 * Read one fixed GitHub REST API resource using the monitor source fetcher's
 * DNS pinning and byte/time bounded HTTPS transport. Redirects are rejected:
 * callers must only request the fixed api.github.com origin.
 */
export function createGitHubApiResourceFetcher(network: MonitorSourcesNetwork) {
  return async function fetchGitHubApiResourceWithNetwork(input: {
  url: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: Uint8Array }> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("GitHub API URL is invalid.");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" ||
    (url.port && url.port !== "443") || url.username || url.password || url.hash ||
    !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:commits|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}|git\/blobs\/[a-f0-9]{40})$/.test(url.pathname) ||
    (url.search && url.search !== "?per_page=1" && url.search !== "?recursive=1")) {
    throw new Error("GitHub API URL is outside the supported read-only endpoint set.");
  }
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 ||
    !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error("GitHub API limits are invalid.");
  }
  const deadline = Date.now() + input.timeoutMs;
  const address = await resolvePublicAddress(url, network.resolve, deadline);
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("GitHub API request timed out.");
  const response = await network.request(url, address, {
    maxBytes: input.maxBytes,
    timeoutMs: remainingMs,
    headers: { accept: "application/vnd.github+json", "accept-encoding": "identity", "x-github-api-version": "2022-11-28", "user-agent": "Mendwire-Monitor" },
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    throw new Error("GitHub API redirects are not supported for repository analysis.");
  }
  return { statusCode: response.statusCode, body: response.body };
  };
}

const fetchWithGitHubApiNetwork = createGitHubApiResourceFetcher(defaultMonitorSourcesNetwork);

export function fetchGitHubApiResource(input: {
  url: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: Uint8Array }> {
  return fetchWithGitHubApiNetwork(input);
}
