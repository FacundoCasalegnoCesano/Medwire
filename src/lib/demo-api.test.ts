import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getOpenApi } from "@/app/api/demo/openapi/route";
import { GET as getWidgets } from "@/app/api/demo/widgets/route";

afterEach(() => vi.unstubAllEnvs());

describe("demo API", () => {
  it("stays disabled unless an explicit supported revision is configured", async () => {
    const previousRevision = process.env.MENDWIRE_DEMO_API_REVISION;
    delete process.env.MENDWIRE_DEMO_API_REVISION;
    try {
      expect((await getWidgets()).status).toBe(404);
      expect((await getOpenApi()).status).toBe(404);
    } finally {
      if (previousRevision !== undefined) process.env.MENDWIRE_DEMO_API_REVISION = previousRevision;
    }

    vi.stubEnv("MENDWIRE_DEMO_API_REVISION", "");
    expect((await getWidgets()).status).toBe(404);
    expect((await getOpenApi()).status).toBe(404);

    vi.stubEnv("MENDWIRE_DEMO_API_REVISION", "unexpected");
    expect((await getWidgets()).status).toBe(404);
    expect((await getOpenApi()).status).toBe(404);
  });

  it("serves fictional read-only rows and matching baseline OpenAPI without caching", async () => {
    vi.stubEnv("MENDWIRE_DEMO_API_REVISION", "baseline");
    vi.stubEnv("MENDWIRE_DEMO_API_ORIGIN", "http://127.0.0.1:3000");

    const response = await getWidgets();
    const specResponse = await getOpenApi();
    const body = await response.json();
    const spec = await specResponse.json();

    expect(response.status).toBe(200);
    expect(body.widgets).toEqual([
      { id: "widget-1", name: "Blue Widget", price: 12.5 },
      { id: "widget-2", name: "Amber Widget", price: 18 },
    ]);
    expect(spec.paths["/api/demo/widgets"].get.responses["200"]).toBeDefined();
    expect(spec.servers).toEqual([{ url: "http://127.0.0.1:3000" }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(specResponse.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 410 and removes the operation from the same spec route", async () => {
    vi.stubEnv("MENDWIRE_DEMO_API_REVISION", "breaking");
    vi.stubEnv("MENDWIRE_DEMO_API_ORIGIN", "http://127.0.0.1:3000");

    const response = await getWidgets();
    const specResponse = await getOpenApi();
    const spec = await specResponse.json();

    expect(response.status).toBe(410);
    expect(spec.paths).toEqual({});
    expect(spec.info.version).toBe("2.0.0");
  });

  it("rejects request-derived or malformed API origins", async () => {
    vi.stubEnv("MENDWIRE_DEMO_API_REVISION", "baseline");
    vi.stubEnv("MENDWIRE_DEMO_API_ORIGIN", "https://example.test/path");
    expect((await getOpenApi()).status).toBe(404);

    vi.stubEnv("MENDWIRE_DEMO_API_ORIGIN", "https://user:pass@example.test");
    expect((await getOpenApi()).status).toBe(404);
  });
});
