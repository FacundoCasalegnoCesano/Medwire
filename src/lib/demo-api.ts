export type DemoApiRevision = "baseline" | "breaking";

export const DEMO_API_ORIGIN_DEFAULT = "http://127.0.0.1:3000";

const widgets = [
  { id: "widget-1", name: "Blue Widget", price: 12.5 },
  { id: "widget-2", name: "Amber Widget", price: 18 },
];

export function readDemoApiRevision(value = process.env.MENDWIRE_DEMO_API_REVISION): DemoApiRevision | null {
  return value === "baseline" || value === "breaking" ? value : null;
}

export function readDemoApiOrigin(value = process.env.MENDWIRE_DEMO_API_ORIGIN): string | null {
  const raw = value ?? DEMO_API_ORIGIN_DEFAULT;
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "3000";
    if ((!localHttp && url.protocol !== "https:") || (url.port.length > 0 && !localHttp) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function demoWidgetsResponse(revision: DemoApiRevision) {
  return revision === "baseline"
    ? { widgets }
    : { error: "This demo endpoint was removed in the breaking revision." };
}

export function demoOpenApiDocument(revision: DemoApiRevision, origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mendwire Demo Widgets API",
      version: revision === "baseline" ? "1.0.0" : "2.0.0",
      description: "Fictional, read-only data for demonstrating contract monitoring.",
    },
    servers: [{ url: origin }],
    paths: revision === "baseline"
      ? {
          "/api/demo/widgets": {
            get: {
              operationId: "listDemoWidgets",
              summary: "List fictional widgets",
              responses: {
                "200": {
                  description: "Fictional demo widgets.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["widgets"],
                        properties: {
                          widgets: {
                            type: "array",
                            items: {
                              type: "object",
                              required: ["id", "name", "price"],
                              properties: {
                                id: { type: "string" },
                                name: { type: "string" },
                                price: { type: "number" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }
      : {},
  };
}

export function demoJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
