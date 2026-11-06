import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createMonitor, listMonitors } from "@/lib/monitors";
import { monitorErrorResponse, monitorInputFrom, readMonitorJson, unauthenticatedResponse } from "@/lib/monitor-api";

async function authenticated() {
  return (await getSession()) !== null;
}

export async function GET() {
  if (!(await authenticated())) return unauthenticatedResponse("view");
  try {
    return NextResponse.json({ monitors: await listMonitors() });
  } catch (error) {
    return monitorErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await authenticated())) return unauthenticatedResponse("create");
  try {
    const monitor = await createMonitor(monitorInputFrom(await readMonitorJson(request)));
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (error) {
    return monitorErrorResponse(error);
  }
}
