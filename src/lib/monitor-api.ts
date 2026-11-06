import { NextResponse } from "next/server";
import { MonitorCapacityError, MonitorConflictError, MonitorInputError, MonitorNotFoundError } from "@/lib/monitors";
import { getAppOrigins } from "@/lib/app-origins";

const MAX_MONITOR_BODY_BYTES = 8 * 1024;

export class MonitorRequestError extends Error {
  constructor(readonly status: 400 | 403 | 413 | 415 | 503, message: string) {
    super(message);
  }
}

export async function readMonitorJson(request: Request): Promise<unknown> {
  let allowedOrigins: string[];
  try {
    allowedOrigins = getAppOrigins();
  } catch {
    throw new MonitorRequestError(503, "Monitor requests are temporarily unavailable.");
  }

  if (!allowedOrigins.includes(request.headers.get("origin") ?? "")) {
    throw new MonitorRequestError(403, "This request origin is not allowed.");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new MonitorRequestError(415, "Send monitor changes as application/json.");
  }

  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new MonitorRequestError(400, "Content-Length is invalid.");
    if (Number(length) > MAX_MONITOR_BODY_BYTES) throw new MonitorRequestError(413, "Monitor request is too large.");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Request body is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MONITOR_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new MonitorRequestError(413, "Monitor request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new SyntaxError("Request body is not valid UTF-8.");
  }
}

export function monitorInputFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MonitorInputError({ name: "Enter a monitor name." });
  }
  const data = value as Record<string, unknown>;
  return {
    name: typeof data.name === "string" ? data.name : "",
    contractUrl: typeof data.contractUrl === "string" ? data.contractUrl : "",
    repositoryUrl: typeof data.repositoryUrl === "string" ? data.repositoryUrl : "",
  };
}

export function monitorErrorResponse(error: unknown) {
  if (error instanceof MonitorRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof MonitorInputError) {
    return NextResponse.json({ error: error.message, fields: error.fields }, { status: 422 });
  }
  if (error instanceof MonitorNotFoundError) return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
  if (error instanceof MonitorCapacityError) return NextResponse.json({ error: error.message, code: "ACTIVE_MONITOR_LIMIT", limit: error.limit }, { status: 409 });
  if (error instanceof MonitorConflictError) return NextResponse.json({ error: "Refresh this monitor before trying again." }, { status: 409 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Send a valid JSON body." }, { status: 400 });
  console.error("Monitor request failed");
  return NextResponse.json({ error: "The monitor request could not be completed. Try again." }, { status: 500 });
}

export function unauthenticatedResponse(action: string) {
  return NextResponse.json({ error: `Sign in to ${action} monitors.` }, { status: 401 });
}
