import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handlers = toNextJsHandler(auth);
const authOrigin = new URL(process.env.BETTER_AUTH_URL!).origin;

function isSameOriginCallback(value: string | null) {
  if (!value || value.startsWith("//") || /[\u0000-\u001f\u007f\\]|%(?:2f|5c)/i.test(value)) return false;
  try {
    const target = new URL(value, authOrigin);
    return target.origin === authOrigin && !target.username && !target.password && ["http:", "https:"].includes(target.protocol);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/auth/reset-password/") &&
    !isSameOriginCallback(url.searchParams.get("callbackURL"))
  ) {
    return Response.json({ message: "Invalid callback URL" }, { status: 400 });
  }

  return handlers.GET(request);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/request-password-reset") {
    const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ message: "Invalid callback URL" }, { status: 400 });
    }
    if (
      body.redirectTo !== undefined &&
      (typeof body.redirectTo !== "string" || !isSameOriginCallback(body.redirectTo))
    ) {
      return Response.json({ message: "Invalid callback URL" }, { status: 400 });
    }
  }

  return handlers.POST(request);
}
