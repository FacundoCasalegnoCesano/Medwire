import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reactivateMonitor, updateMonitor, withdrawMonitor } from "@/lib/monitors";
import { monitorErrorResponse, monitorInputFrom, readMonitorJson, unauthenticatedResponse } from "@/lib/monitor-api";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await getSession())) return unauthenticatedResponse("edit");
  try {
    const { id } = await context.params;
    const body = await readMonitorJson(request);
    let monitor;
    const action = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).action
      : null;
    if (action === "withdraw") monitor = await withdrawMonitor(id);
    else if (action === "reactivate") monitor = await reactivateMonitor(id);
    else monitor = await updateMonitor(id, monitorInputFrom(body));
    return NextResponse.json({ monitor });
  } catch (error) {
    return monitorErrorResponse(error);
  }
}
