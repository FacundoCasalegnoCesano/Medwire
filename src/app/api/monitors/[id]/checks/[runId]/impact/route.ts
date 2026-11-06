import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ImpactAnalysisError, getImpactAnalysis, requestImpactAnalysis } from "@/lib/impact-analysis";
import { MonitorRequestError, monitorErrorResponse, readMonitorJson, unauthenticatedResponse } from "@/lib/monitor-api";
import { PolicyDeniedError } from "@/lib/beta-policy";

type RouteContext = { params: Promise<{ id: string; runId: string }> };

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function errorResponse(error: unknown) {
  if (error instanceof ImpactAnalysisError) {
    return privateResponse(NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status }));
  }
  if (error instanceof PolicyDeniedError) {
    const status = error.code === "WORKSPACE_FORBIDDEN" ? 404 : 403;
    return privateResponse(NextResponse.json({ error: "The current workspace cannot access this impact analysis." }, { status }));
  }
  return privateResponse(monitorErrorResponse(error));
}

export async function GET(_request: Request, context: RouteContext) {
  if (!(await getSession())) return privateResponse(unauthenticatedResponse("view impact analysis for"));
  try {
    const { id, runId } = await context.params;
    return privateResponse(NextResponse.json({ analysis: await getImpactAnalysis(id, runId) }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await getSession())) return privateResponse(unauthenticatedResponse("request impact analysis for"));
  try {
    const body = await readMonitorJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
      throw new MonitorRequestError(400, "Send an empty JSON object to request impact analysis.");
    }
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const { id, runId } = await context.params;
    const analysis = await requestImpactAnalysis(id, runId, idempotencyKey);
    return privateResponse(NextResponse.json({ analysis }, { status: 202 }));
  } catch (error) {
    return errorResponse(error);
  }
}
