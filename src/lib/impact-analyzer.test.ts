import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyzeContractImpact } from "@/lib/impact-analyzer";
import type { CheckFinding } from "@/lib/monitor-check-types";
import type { ImpactCoverage } from "@/lib/impact-types";

const commitSha = "a".repeat(40);
const coverage: ImpactCoverage = { source: "SUPPORTED", filesDiscovered: 1, filesAnalyzed: 1, filesSkipped: 0, reasons: [] };
const previousContract = {
  openapi: "3.1.0",
  servers: [{ url: "https://api.example.test/v1" }],
  paths: { "/users": { get: { responses: { "200": { description: "ok" } } } } },
};
const nextContract = { openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }], paths: {} };
const removedOperation: CheckFinding = {
  code: "api-path-removed-without-deprecation", location: "GET /users", method: "GET", path: "/users",
  summary: "The GET /users operation was removed.", severity: "BREAKING",
};
const widgetsFinding: CheckFinding = {
  code: "api-path-removed-without-deprecation", location: "GET /widgets", method: "GET", path: "/widgets",
  summary: "The GET /widgets operation was removed.", severity: "BREAKING",
};

function analyze(source: string, overrides: Partial<Parameters<typeof analyzeContractImpact>[0]> = {}) {
  return analyzeContractImpact({
    previousContract, nextContract, repositoryUrl: "https://github.com/acme/web", contractUrl: "https://api.example.test/openapi.json",
    commitSha, findings: [removedOperation], files: [{ path: "src/client.ts", content: source }], coverage, ...overrides,
  });
}

const widgetContracts = {
  previousContract: {
    openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }],
    paths: { "/widgets": { get: { responses: { "200": { description: "ok" } } } } },
  },
  nextContract: { openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }], paths: {} },
  findings: [widgetsFinding],
};

describe("contract consumer analysis", () => {
  it("confirms only a statically linked fetch host, method, path, and removed operation", () => {
    const result = analyze('const API = "https://api.example.test/v1";\nfetch(API + "/users", { method: "GET" });');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      classification: "CONFIRMED", repositoryUrl: "https://github.com/acme/web", commitSha,
      filePath: "src/client.ts", startLine: 2, method: "GET", requestPath: "/users",
      contractElement: { method: "GET", path: "/users", changeCode: removedOperation.code },
    });
  });

  it("confirms a method removal using the pinned oasdiff operation-removal code", () => {
    const result = analyze('fetch("https://api.example.test/v1/users");', {
      nextContract: {
        openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }],
        paths: { "/users": { post: { responses: { "200": { description: "ok" } } } } },
      },
      findings: [{ ...removedOperation, code: "api-removed-without-deprecation" }],
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CONFIRMED", method: "GET", requestPath: "/users" });
  });

  it("does not match a different API merely because it uses the same path", () => {
    const result = analyze('fetch("https://other.example.test/v1/users");');
    expect(result.evidence).toEqual([]);
  });

  it("keeps a dynamic URL as a candidate and never confirms template wildcards", () => {
    const result = analyze('fetch(`/users/${userId}`, { method: "GET" });');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", requestPath: null });
  });

  it("does not resolve a top-level constant when a function parameter shadows it", () => {
    const result = analyze([
      'const endpoint = "https://api.example.test/v1/users";',
      'function run(endpoint: string) { fetch(endpoint, { method: "GET" }); }',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].classification).toBe("CANDIDATE");
  });

  it("does not assume GET when fetch options or method are dynamic", () => {
    const result = analyze([
      'fetch("https://api.example.test/v1/users", options);',
      'fetch("https://api.example.test/v1/users", { method: configuredMethod });',
    ].join("\n"));
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.every((item) => item.classification === "CANDIDATE" && item.method === null)).toBe(true);
  });

  it("ignores comments and a locally shadowed fetch binding", () => {
    const result = analyze([
      '// fetch("https://api.example.test/v1/users")',
      'function run(fetch: (url: string) => void) { fetch("https://api.example.test/v1/users"); }',
    ].join("\n"));
    expect(result.evidence).toEqual([]);
  });

  it("recognizes an Axios import alias and configured base URL", () => {
    const result = analyze([
      'import client from "axios";',
      'const api = client.create({ baseURL: "https://api.example.test/v1" });',
      'api.get("/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CONFIRMED", client: "axios", method: "GET", requestPath: "/users", startLine: 3 });
  });

  it("keeps named Axios method imports as candidates with explicit partial coverage", () => {
    const result = analyze([
      'import { get as readUser } from "axios";',
      'readUser("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", client: "axios", method: "GET", requestPath: "/users" });
    expect(result.coverage.source).toBe("PARTIAL");
    expect(result.coverage.reasons.join(" ")).toMatch(/named Axios method imports/i);
  });

  it("keeps namespace Axios request methods as candidates with explicit partial coverage", () => {
    const result = analyze([
      'import * as client from "axios";',
      'client.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", client: "axios", method: "GET" });
    expect(result.coverage.source).toBe("PARTIAL");
    expect(result.coverage.reasons.join(" ")).toMatch(/namespace Axios imports/i);
  });

  it("marks namespace Axios default access as omitted partial coverage", () => {
    const result = analyze([
      'import * as client from "axios";',
      'client.default.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toEqual([]);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesAnalyzed: 1 });
    expect(result.coverage.reasons.join(" ")).toMatch(/namespace Axios imports \(including \.default access\)/i);
  });

  it("does not confirm a request that uses a type-only Axios import", () => {
    const result = analyze([
      'import type axios from "axios";',
      'axios.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
    expect(result.coverage.source).toBe("PARTIAL");
  });

  it("keeps Axios calls as candidates when a request interceptor can rewrite them", () => {
    const result = analyze([
      'import axios from "axios";',
      'const api = axios.create({ baseURL: "https://api.example.test/v1" });',
      'api.interceptors.request.use((config) => { config.baseURL = "https://other.example.test"; return config; });',
      'api.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", client: "axios" });
  });

  it("keeps singleton Axios calls as candidates when an interceptor can rewrite them", () => {
    const result = analyze([
      'import axios from "axios";',
      'axios.interceptors.request.use((config) => { config.url = "https://other.example.test/users"; return config; });',
      'axios.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it("keeps singleton Axios calls as candidates when defaults are mutated", () => {
    const result = analyze([
      'import axios from "axios";',
      'axios.defaults.baseURL = "https://other.example.test";',
      'axios.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it("does not confirm an absolute Axios URL when allowAbsoluteUrls is disabled", () => {
    const result = analyze([
      'import axios from "axios";',
      'axios.get("https://api.example.test/v1/users", { baseURL: "https://other.example.test", allowAbsoluteUrls: false });',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it.each([
    ['adapter', 'adapter: customAdapter'],
    ['request transformer', 'transformRequest: [(data, config) => { config.url = "https://other.example.test"; return data; }]'],
  ])("does not confirm an Axios instance with a custom %s", (_label, customConfig) => {
    const result = analyze([
      'import axios from "axios";',
      `const api = axios.create({ baseURL: "https://api.example.test/v1", ${customConfig} });`,
      'api.get("https://api.example.test/v1/users");',
    ].join("\n"));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it("uses the OpenAPI document URL as the base for relative server URLs", () => {
    const result = analyze('fetch("https://api.example.test/specs/v1/users");', {
      contractUrl: "https://api.example.test/specs/openapi.json",
      previousContract: {
        openapi: "3.1.0", servers: [{ url: "./v1" }],
        paths: { "/users": { get: {} } },
      },
      nextContract: { openapi: "3.1.0", servers: [{ url: "./v1" }], paths: {} },
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CONFIRMED", requestPath: "/users" });
  });

  it.each([
    "#/components/pathItems/Users",
    "https://contracts.example.test/openapi.json#/components/pathItems/Users",
  ])("does not confirm a removed operation when the next Path Item is unresolved by $ref %s", (ref) => {
    const result = analyze('fetch("https://api.example.test/v1/users");', {
      previousContract,
      nextContract: {
        openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }],
        paths: { "/users": { $ref: ref } },
      },
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", contractElement: { changeCode: removedOperation.code } });
  });

  it("does not confirm a response change merely because its operation is absent", () => {
    const result = analyze('fetch("https://api.example.test/v1/users");', {
      findings: [{ ...removedOperation, code: "response.status-removed" }],
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", contractElement: { changeCode: "response.status-removed" } });
  });

  it("marks a source file skipped when the cooperative analysis time budget expires", () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 800));
    try {
      const result = analyze('fetch("https://api.example.test/v1/users");');
      expect(result.evidence).toEqual([]);
      expect(result.coverage).toMatchObject({ source: "PARTIAL", filesAnalyzed: 0, filesSkipped: 1 });
      expect(result.coverage.reasons.join(" ")).toMatch(/time limit/i);
    } finally {
      clock.mockRestore();
    }
  });

  it("marks the current file incomplete when time expires inside finding comparisons", () => {
    let clockCalls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (++clockCalls >= 6 ? 2_000 : 0));
    try {
      const findings = Array.from({ length: 100 }, () => ({
        ...removedOperation,
        path: "/users",
      }));
      const result = analyze('fetch("https://api.example.test/v1/users");', {
        findings,
        coverage: { ...coverage, reasons: Array.from({ length: 12 }, (_, index) => `Existing reason ${index + 1}.`) },
      });
      expect(result.coverage).toMatchObject({ source: "PARTIAL", filesAnalyzed: 0, filesSkipped: 1 });
      expect(result.coverage.reasons.join(" ")).toMatch(/time limit/i);
      expect(result.evidence).toEqual([]);
      expect(result.coverage.reasons).toHaveLength(12);
    } finally {
      clock.mockRestore();
    }
  });

  it("bounds retained evidence and reports truncated coverage", () => {
    const findings = Array.from({ length: 100 }, () => ({ ...removedOperation }));
    const result = analyze('fetch("https://api.example.test/v1/users");', {
      findings,
      coverage: { ...coverage, reasons: Array.from({ length: 12 }, (_, index) => `Existing reason ${index + 1}.`) },
    });
    expect(result.evidence).toHaveLength(80);
    expect(result.coverage).toMatchObject({ source: "PARTIAL", filesAnalyzed: 1, filesSkipped: 0 });
    expect(result.coverage.reasons.join(" ")).toMatch(/evidence result limit reached/i);
    expect(result.coverage.reasons.join(" ")).toMatch(/other HTTP clients are unsupported/i);
    expect(result.coverage.reasons).toHaveLength(12);
  });

  it("keeps completed file evidence and counts the timed-out and remaining files as skipped", () => {
    let clockCalls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (++clockCalls >= 9 ? 2_000 : 0));
    try {
      const result = analyze('fetch("https://api.example.test/v1/users");', {
        files: [
          { path: "src/complete.ts", content: 'fetch("https://api.example.test/v1/users");' },
          { path: "src/timed-out.ts", content: 'fetch("https://api.example.test/v1/users");' },
          { path: "src/not-started.ts", content: 'fetch("https://api.example.test/v1/users");' },
        ],
      });
      expect(result.evidence.map((item) => item.filePath)).toEqual(["src/complete.ts"]);
      expect(result.coverage).toMatchObject({ source: "PARTIAL", filesDiscovered: 3, filesAnalyzed: 1, filesSkipped: 2 });
      expect(result.coverage.reasons.join(" ")).toMatch(/time limit/i);
    } finally {
      clock.mockRestore();
    }
  });

  it("uses Axios's third argument as post config and refuses a dynamic base override", () => {
    const result = analyze([
      'import axios from "axios";',
      'const api = axios.create({ baseURL: "https://api.example.test/v1" });',
      'api.post("/users", data, { baseURL: process.env.API_URL });',
    ].join("\n"), {
      findings: [{ ...removedOperation, method: "POST" }],
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", method: "POST" });
  });

  it("does not confirm an API instance after its configured base URL is mutated", () => {
    const result = analyze([
      'import axios from "axios";',
      'const api = axios.create({ baseURL: "https://api.example.test/v1" });',
      'api.defaults.baseURL = otherOrigin;',
      'api.get("/users");',
    ].join("\n"));
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it("does not treat a shadowed Axios instance or imported name as a proven client", () => {
    const result = analyze([
      'import axios from "axios";',
      'const api = axios.create({ baseURL: "https://api.example.test/v1" });',
      'function run(api: { get: (url: string) => void }) { api.get("/users"); }',
    ].join("\n"));
    expect(result.evidence).toEqual([]);
  });

  it("does not confirm fetch calls shadowed by destructured bindings or constants", () => {
    const result = analyze([
      'const url = "https://api.example.test/v1/widgets";',
      'function withFetch({ fetch }: { fetch: typeof globalThis.fetch }) { fetch("https://api.example.test/v1/widgets"); }',
      'function withUrl({ url }: { url: string }) { fetch(url); }',
    ].join("\n"), widgetContracts);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", method: "GET" });
  });

  it("does not treat fetch as global when a var inside a nested block is function-scoped", () => {
    const result = analyze([
      'function run() {',
      '  if (true) { var fetch = customClient; }',
      '  fetch("https://api.example.test/v1/widgets");',
      '}',
    ].join("\n"), widgetContracts);
    expect(result.evidence).toEqual([]);
  });

  it("keeps block-scoped or nested-function fetch bindings local to their own scopes", () => {
    const result = analyze([
      'function nested() { var fetch = customClient; fetch("https://api.example.test/v1/widgets"); }',
      '{ const fetch = customClient; fetch("https://api.example.test/v1/widgets"); }',
      'fetch("https://api.example.test/v1/widgets");',
    ].join("\n"), widgetContracts);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CONFIRMED", startLine: 3 });
  });

  it.each([
    ["shorthand method", 'fetch("https://api.example.test/v1/users", { method });'],
    ["computed method", 'fetch("https://api.example.test/v1/users", { ["method"]: "POST" });'],
    ["method getter", 'fetch("https://api.example.test/v1/users", { get method() { return "POST"; } });'],
  ])("does not infer GET from %s fetch options", (_label, call) => {
    const result = analyze([
      "const method = \"POST\";",
      call.replaceAll("/users", "/widgets").replaceAll("api.example.test", "api.example.test"),
    ].join("\n"), widgetContracts);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", method: null });
  });

  it("does not infer an Axios instance base URL when create options contain a spread", () => {
    const result = analyze([
      'import axios from "axios";',
      'const client = axios.create({ baseURL: "https://api.example.test/v1", ...options });',
      'client.get("/widgets");',
    ].join("\n"), widgetContracts);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", client: "axios", method: "GET" });
  });

  it.each([
    'client.defaults.baseURL += "/proxy";',
    'client.defaults["baseURL"] = "https://other.example.test";',
    'const key = "defaults"; client[key].baseURL = "https://other.example.test";',
    'client[dynamicKey].baseURL = "https://other.example.test";',
    'Object.assign(client.defaults, { baseURL: "https://other.example.test" });',
  ])("invalidates an Axios instance base after defaults mutation: %s", (mutation) => {
    const result = analyze([
      'import axios from "axios";',
      'const client = axios.create({ baseURL: "https://api.example.test/v1" });',
      mutation,
      'client.get("/widgets");',
    ].join("\n"), widgetContracts);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.classification).toBe("CANDIDATE");
  });

  it("reports non-operation schema changes as candidates rather than confirmed impact", () => {
    const schemaFinding: CheckFinding = {
      code: "request-body.required-property-added", location: "components/schemas/User/requestId", method: null, path: null,
      summary: "A required request property was added.", severity: "BREAKING",
    };
    const result = analyze('fetch("https://api.example.test/v1/users", { method: "POST" });', {
      findings: [schemaFinding],
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ classification: "CANDIDATE", contractElement: null });
  });

  it("marks parse errors and file caps as partial coverage", () => {
    const result = analyze("fetch(", { files: [
      { path: "bad.ts", content: "fetch(" },
      ...Array.from({ length: 30 }, (_, index) => ({ path: `f${index}.ts`, content: "// empty" })),
    ] });
    expect(result.coverage.source).toBe("PARTIAL");
    expect(result.coverage.filesSkipped).toBeGreaterThan(0);
    expect(result.coverage.reasons.join(" ")).toMatch(/parse|limit/i);
  });

  it("reports unsupported HTTP client coverage and operation server overrides conservatively", () => {
    const result = analyze([
      'import got from "got";',
      'got("https://api.example.test/v1/users");',
    ].join("\n"), {
      previousContract: {
        ...previousContract,
        paths: { "/users": { servers: [{ url: "https://other.example.test/v1" }], get: {} } },
      },
    });
    expect(result.coverage.source).toBe("PARTIAL");
    expect(result.coverage.reasons.join(" ")).toMatch(/unsupported HTTP client patterns/i);
    expect(result.evidence).toEqual([]);
  });

  it("prefers a concrete surviving operation over a deleted templated path", () => {
    const result = analyze('fetch("https://api.example.test/v1/users/me");', {
      previousContract: {
        openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }],
        paths: { "/users/{id}": { get: {} } },
      },
      nextContract: {
        openapi: "3.1.0", servers: [{ url: "https://api.example.test/v1" }],
        paths: { "/users/me": { get: {} } },
      },
      findings: [{ ...removedOperation, path: "/users/{id}", location: "GET /users/{id}" }],
    });
    expect(result.evidence).toEqual([]);
  });

  it("records a stable commit-pinned path and bounded snippet", () => {
    const long = `fetch("https://api.example.test/v1/users");\n${"// padding\n".repeat(80)}`;
    const result = analyze(long);
    expect(result.evidence[0].commitSha).toBe(commitSha);
    expect(result.evidence[0].snippet.length).toBeLessThanOrEqual(900);
    expect(result.evidence[0].filePath).toBe("src/client.ts");
  });
});
