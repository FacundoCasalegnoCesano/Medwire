import { demoJsonResponse, demoWidgetsResponse, readDemoApiRevision } from "@/lib/demo-api";

export function GET() {
  const revision = readDemoApiRevision();
  if (!revision) return demoJsonResponse({ error: "Demo API is disabled." }, 404);
  if (revision === "breaking") return demoJsonResponse(demoWidgetsResponse(revision), 410);
  return demoJsonResponse(demoWidgetsResponse(revision));
}
