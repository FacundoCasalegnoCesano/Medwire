import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MonitorCheckError, enqueueManualCheck, listCheckRuns } from "@/lib/monitor-checks";
import { MonitorNotFoundError } from "@/lib/monitors";
import { PolicyDeniedError } from "@/lib/beta-policy";
import { monitorErrorResponse, readMonitorJson, unauthenticatedResponse } from "@/lib/monitor-api";

type RouteContext = { params: Promise<{ id: string }> };

function checkErrorResponse(error: unknown) {
  if (error instanceof MonitorCheckError) {
    return NextResponse.json({
      error: error.message,
      ...(error.availableAt ? { availableAt: error.availableAt.toISOString() } : {}),
    }, { status: error.status });
  }
  if (error instanceof PolicyDeniedError) {
    const status = error.code === "WORKSPACE_FORBIDDEN" ? 404 : 403;
    return NextResponse.json({ error: "The current workspace cannot run this check." }, { status });
  }
  if (error instanceof MonitorNotFoundError) return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
  return monitorErrorResponse(error);
}

export async function GET(_request: Request, context: RouteContext) {
  if (!(await getSession())) return unauthenticatedResponse("view check history for");
  try {
    const { id } = await context.params;
    return NextResponse.json({ runs: await listCheckRuns(id) });
  } catch (error) {
    return checkErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await getSession())) return unauthenticatedResponse("run checks for");
  try {
    await readMonitorJson(request);
    const { id } = await context.params;
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const run = await enqueueManualCheck(id, idempotencyKey);
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return checkErrorResponse(error);
  }
}
