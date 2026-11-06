import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMonitorSourcesValidator,
  createPinnedLookup,
  getMonitorSourceInputError,
  type MonitorSourcesNetwork,
} from "@/lib/monitor-sources";

const PUBLIC_IP = "93.184.216.34";
const OPENAPI_JSON = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Example", version: "1.0.0" },
  paths: {},
  components: { schemas: { Item: { type: "string" } } },
});

function pkt(payload: string): string {
  const bytes = Buffer.from(payload, "utf8");
  return `${(bytes.length + 4).toString(16).padStart(4, "0")}${payload}`;
}

const GIT_ADVERTISEMENT = [
  pkt("# service=git-upload-pack\n"),
  "0000",
  pkt(`${"a".repeat(40)} refs/heads/main\0multi_ack\n`),
  "0000",
].join("");

function response(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return { statusCode, headers, body: Buffer.from(body) };
}

function validator(
  options: {
    resolve?: MonitorSourcesNetwork["resolve"];
    request?: MonitorSourcesNetwork["request"];
    timeoutMs?: number;
    maxContractBytes?: number;
    maxRepositoryBytes?: number;
    maxRedirects?: number;
  } = {},
) {
  const resolve = options.resolve ?? vi.fn(async () => [PUBLIC_IP]);
  const request = vi.fn<MonitorSourcesNetwork["request"]>(async (url, address, requestOptions) => {
    if (options.request) return options.request(url, address, requestOptions);
    return url.pathname.endsWith("/info/refs")
      ? response(200, GIT_ADVERTISEMENT, {
          "content-type": "application/x-git-upload-pack-advertisement",
        })
      : response(200, OPENAPI_JSON, { "content-type": "application/json" });
  });

  return {
    run: createMonitorSourcesValidator({
      resolve,
      request,
      limits: {
        timeoutMs: options.timeoutMs,
        maxContractBytes: options.maxContractBytes,
        maxRepositoryBytes: options.maxRepositoryBytes,
        maxRedirects: options.maxRedirects,
      },
    }),
    resolve,
    request,
  };
}

const validInput = {
  contractUrl: "https://contracts.example/openapi.json",
  repositoryUrl: "https://code.example/team/service.git",
};

describe("validateMonitorSources", () => {
  it("accepts public JSON OpenAPI and a real Git smart HTTP ref advertisement", async () => {
    const { run, request } = validator();

    const result = await run(validInput);

    expect(result).toEqual({
      contract: { valid: true, error: null },
      repository: { valid: true, error: null },
    });
    expect(request.mock.calls.some(([url, address, options]) =>
      url.href === "https://code.example/team/service.git/info/refs?service=git-upload-pack" &&
      address === PUBLIC_IP && options.maxBytes > 0,
    )).toBe(true);
  });

  it("accepts YAML OpenAPI and resolves local JSON Pointer references", async () => {
    const yaml = [
      "openapi: 3.0.4",
      "info:",
      "  title: Example",
      '  version: "1.0.0"',
      "paths: {}",
      "components:",
      "  schemas:",
      "    Item:",
      "      type: string",
      "    ItemList:",
      "      items:",
      '        $ref: "#/components/schemas/Item"',
    ].join("\n");
    const { run } = validator({
      request: vi.fn(async (url: URL) =>
        url.pathname.endsWith("/info/refs")
          ? response(200, GIT_ADVERTISEMENT, {
              "content-type": "application/x-git-upload-pack-advertisement",
            })
          : response(200, yaml, { "content-type": "application/yaml" }),
      ),
    });

    const result = await run(validInput);

    expect(result.contract).toEqual({ valid: true, error: null });
  });

  it("rejects malformed path items and operations without responses", async () => {
    const { run } = validator({
      request: vi.fn(async (url: URL) => url.pathname.endsWith("/info/refs")
        ? response(200, GIT_ADVERTISEMENT, { "content-type": "application/x-git-upload-pack-advertisement" })
        : response(200, JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Example", version: "1" },
            paths: { nonsense: 7 },
          }), { "content-type": "application/json" })),
    });
    const result = await run(validInput);
    expect(result.contract).toMatchObject({ valid: false, error: expect.stringContaining("paths") });

    const missingResponses = validator({
      request: vi.fn(async (url: URL) => url.pathname.endsWith("/info/refs")
        ? response(200, GIT_ADVERTISEMENT, { "content-type": "application/x-git-upload-pack-advertisement" })
        : response(200, JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Example", version: "1" },
            paths: { "/items": { get: {} } },
          }), { "content-type": "application/json" })),
    });
    const operationResult = await missingResponses.run(validInput);
    expect(operationResult.contract).toMatchObject({ valid: false, error: expect.stringContaining("responses") });
  });

  it("keeps DNS pin lookup compatible with Node's family and all lookup options", () => {
    const lookup = createPinnedLookup(PUBLIC_IP);
    const callback = vi.fn();
    lookup("code.example", { all: false }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, PUBLIC_IP, 4);
    lookup("code.example", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: PUBLIC_IP, family: 4 }]);
  });

  it.each([
    ["http://contracts.example/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://user:pass@contracts.example/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://127.0.0.1/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://100.64.0.1/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://[::ffff:127.0.0.1]/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://[64:ff9b::7f00:1]/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://contracts.example:8443/openapi.json", validInput.repositoryUrl, "contract"],
    ["https://contracts.example/openapi.json?access_token=secret", validInput.repositoryUrl, "contract"],
    [validInput.contractUrl, "https://code.example/team/service.git?ref=main", "repository"],
    [validInput.contractUrl, "https://code.example/team/service.git#main", "repository"],
  ])("rejects unsafe source URL", async (contractUrl, repositoryUrl, source) => {
    const { run } = validator();

    const result = await run({ contractUrl, repositoryUrl });

    expect(result[source as "contract" | "repository"].valid).toBe(false);
  });

  it.each([
    "https://0.1.2.3/openapi.json",
    "https://10.0.0.1/openapi.json",
    "https://169.254.169.254/openapi.json",
    "https://172.31.1.2/openapi.json",
    "https://192.168.1.1/openapi.json",
    "https://192.0.2.1/openapi.json",
    "https://198.18.0.1/openapi.json",
    "https://224.0.0.1/openapi.json",
    "https://240.0.0.1/openapi.json",
    "https://[::]/openapi.json",
    "https://[::1]/openapi.json",
    "https://[fc00::1]/openapi.json",
    "https://[fe80::1]/openapi.json",
    "https://[ff02::1]/openapi.json",
    "https://[2001:db8::1]/openapi.json",
    "https://[2001::1]/openapi.json",
    "https://[2002::1]/openapi.json",
    "https://[3fff::1]/openapi.json",
  ])("rejects reserved or non-public address %s", async (contractUrl) => {
    const { run } = validator();

    const result = await run({ ...validInput, contractUrl });

    expect(result.contract.valid).toBe(false);
  });

  it("rejects DNS answers containing any private, reserved, or mixed address", async () => {
    const resolve = vi.fn(async (host: string) =>
      host === "contracts.example" ? [PUBLIC_IP, "10.0.0.8"] : [PUBLIC_IP],
    );
    const { run, request } = validator({ resolve });

    const result = await run(validInput);

    expect(result.contract.valid).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      PUBLIC_IP,
      expect.any(Object),
    );
  });

  it("revalidates every redirect and never follows an unsafe destination", async () => {
    const request = vi.fn(async () =>
      response(302, "", { location: "http://127.0.0.1/private" }),
    );
    const { run, resolve } = validator({ request });

    const result = await run(validInput);

    expect(result.contract.valid).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("pins each hop and rejects a DNS rebinding answer on redirect", async () => {
    let contractLookups = 0;
    const resolve = vi.fn(async (host: string) => {
      if (host === "contracts.example") {
        contractLookups += 1;
        return contractLookups === 1 ? [PUBLIC_IP] : ["127.0.0.1"];
      }
      return [PUBLIC_IP];
    });
    const request = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/info/refs")
        ? response(200, GIT_ADVERTISEMENT, {
            "content-type": "application/x-git-upload-pack-advertisement",
          })
        : response(302, "", { location: "/next.json" }),
    );
    const { run } = validator({ resolve, request });

    const result = await run({
      contractUrl: "https://contracts.example/openapi.json",
      repositoryUrl: validInput.repositoryUrl,
    });

    expect(result.contract.valid).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects to a different public host after resolving that host", async () => {
    const request = vi.fn(async (url: URL) =>
      url.hostname === "contracts.example"
        ? response(302, "", { location: "https://other.example/openapi.json" })
        : url.pathname.endsWith("/info/refs")
          ? response(200, GIT_ADVERTISEMENT, {
              "content-type": "application/x-git-upload-pack-advertisement",
            })
          : response(200, OPENAPI_JSON),
    );
    const { run, resolve } = validator({ request });

    const result = await run(validInput);

    expect(result.contract.valid).toBe(true);
    expect(resolve).toHaveBeenCalledWith("other.example");
  });

  it("rejects non-OpenAPI JSON, unresolved references, and external references", async () => {
    const bodies = [
      JSON.stringify({ openapi: "3.1.0", info: {}, paths: {} }),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Example", version: "1" },
        paths: {},
        components: { schemas: { Item: { $ref: "#/components/schemas/Missing" } } },
      }),
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Example", version: "1" },
        paths: {},
        components: { schemas: { Item: { $ref: "schemas.yaml#/Item" } } },
      }),
    ];

    for (const body of bodies) {
      const { run } = validator({
        request: vi.fn(async (url: URL) =>
          url.pathname.endsWith("/info/refs")
            ? response(200, GIT_ADVERTISEMENT, {
                "content-type": "application/x-git-upload-pack-advertisement",
              })
            : response(200, body),
        ),
      });

      const result = await run(validInput);

      expect(result.contract.valid).toBe(false);
    }
  });

  it("rejects internal and external $dynamicRef with an explicit unsupported message", async () => {
    for (const dynamicRef of ["https://schemas.example/Item", "#item"]) {
      const body = JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Example", version: "1" },
        paths: {},
        components: { schemas: { Item: { $dynamicRef: dynamicRef } } },
      });
      const { run, request } = validator({
        request: vi.fn(async (url: URL) => url.pathname.endsWith("/info/refs")
          ? response(200, GIT_ADVERTISEMENT, { "content-type": "application/x-git-upload-pack-advertisement" })
          : response(200, body, { "content-type": "application/json" })),
      });

      const result = await run(validInput);

      expect(result.contract).toEqual({ valid: false, error: "OpenAPI dynamic references ($dynamicRef) are not supported." });
      expect(request).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects duplicate YAML keys, alias abuse, and excessive document depth", async () => {
    const bodies = [
      "openapi: 3.0.0\nopenapi: 3.1.0\ninfo: {title: X, version: '1'}\npaths: {}",
      [
        "openapi: 3.0.0",
        "info: {title: X, version: '1'}",
        "paths: {}",
        "components:",
        "  schemas:",
        "    base: &base {type: string}",
        ...Array.from({ length: 65 }, (_, index) => `    item${index}: *base`),
      ].join("\n"),
      `openapi: 3.0.0\ninfo: {title: X, version: '1'}\npaths: {}\ncomponents:\n  schemas:\n${Array.from({ length: 80 }, (_, index) => `${"  ".repeat(index + 3)}level${index}:`).join("\n")}\n${"  ".repeat(83)}type: string`,
    ];

    for (const body of bodies) {
      const { run } = validator({
        request: vi.fn(async (url: URL) =>
          url.pathname.endsWith("/info/refs")
            ? response(200, GIT_ADVERTISEMENT, {
                "content-type": "application/x-git-upload-pack-advertisement",
              })
            : response(200, body),
        ),
      });

      const result = await run(validInput);

      expect(result.contract.valid).toBe(false);
    }
  });

  it("rejects HTML login pages and malformed Git protocol advertisements", async () => {
    const cases = [
      {
        url: validInput.contractUrl,
        body: "<!doctype html><html>Sign in</html>",
        headers: { "content-type": "text/html" },
      },
      {
        url: "https://code.example/team/service.git/info/refs?service=git-upload-pack",
        body: "<html>Sign in</html>",
        headers: { "content-type": "text/html" },
      },
      {
        url: "https://code.example/team/service.git/info/refs?service=git-upload-pack",
        body: "000e# service=git-upload-pack\n0000" + pkt("not-a-ref\n") + "0000",
        headers: { "content-type": "application/x-git-upload-pack-advertisement" },
      },
    ];

    for (const broken of cases) {
      const { run } = validator({
        request: vi.fn(async (url: URL) =>
          url.pathname.endsWith("/info/refs")
            ? broken.url.includes("/info/refs")
              ? response(200, broken.body, broken.headers)
              : response(200, GIT_ADVERTISEMENT, {
                  "content-type": "application/x-git-upload-pack-advertisement",
                })
            : response(200, broken.body, broken.headers),
        ),
      });

      const result = await run(validInput);

      if (broken.url.includes("/info/refs")) expect(result.repository.valid).toBe(false);
      else expect(result.contract.valid).toBe(false);
    }
  });

  it("enforces response byte limits and total request deadlines", async () => {
    const oversized = validator({
      maxContractBytes: 32,
      request: vi.fn(async (url: URL) =>
        url.pathname.endsWith("/info/refs")
          ? response(200, GIT_ADVERTISEMENT, {
              "content-type": "application/x-git-upload-pack-advertisement",
            })
          : response(200, OPENAPI_JSON),
      ),
    });
    expect((await oversized.run(validInput)).contract.valid).toBe(false);

    const stalled = validator({
      timeoutMs: 20,
      request: vi.fn(async () => new Promise<never>(() => undefined)),
    });
    const started = Date.now();
    const result = await stalled.run(validInput);

    expect(result.contract.valid).toBe(false);
    expect(result.repository.valid).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);

    const stalledDns = validator({
      timeoutMs: 20,
      resolve: vi.fn(async () => new Promise<never>(() => undefined)),
    });
    const dnsStarted = Date.now();
    const dnsResult = await stalledDns.run(validInput);

    expect(dnsResult.contract.valid).toBe(false);
    expect(dnsResult.repository.valid).toBe(false);
    expect(stalledDns.request).not.toHaveBeenCalled();
    expect(Date.now() - dnsStarted).toBeLessThan(500);
  });

  it("exposes a persistence-safe URL check without echoing supplied values", () => {
    const contractError = getMonitorSourceInputError(
      "https://contracts.example/openapi.json?token=private-value",
      "contract",
    );
    const repositoryError = getMonitorSourceInputError(
      "https://user:password@code.example/team/service.git",
      "repository",
    );

    expect(contractError).toBe("Source URLs cannot include a query or fragment.");
    expect(repositoryError).toBe("Only public HTTPS URLs without credentials are allowed.");
    expect(contractError).not.toContain("private-value");
    expect(repositoryError).not.toContain("password");
    expect(getMonitorSourceInputError(validInput.contractUrl, "contract")).toBeNull();
    expect(getMonitorSourceInputError("not-a-url", "contract")).toBe("URL is invalid.");
  });

  it("rejects inaccessible repositories and repositories without refs", async () => {
    const cases = [
      response(404, "Not found"),
      response(200, pkt("# service=git-upload-pack\n") + "0000" + "0000", {
        "content-type": "application/x-git-upload-pack-advertisement",
      }),
    ];

    for (const reply of cases) {
      const { run } = validator({
        request: vi.fn(async (url: URL) =>
          url.pathname.endsWith("/info/refs")
            ? reply
            : response(200, OPENAPI_JSON),
        ),
      });

      const result = await run(validInput);

      expect(result.repository.valid).toBe(false);
    }
  });
});
