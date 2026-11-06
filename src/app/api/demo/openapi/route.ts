import { demoJsonResponse, demoOpenApiDocument, readDemoApiOrigin, readDemoApiRevision } from "@/lib/demo-api";

export function GET() {
  const revision = readDemoApiRevision();
  const origin = readDemoApiOrigin();
  if (!revision || !origin) return demoJsonResponse({ error: "Demo API is disabled or misconfigured." }, 404);
  return demoJsonResponse(demoOpenApiDocument(revision, origin));
}
