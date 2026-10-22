import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = (process.env.HOMEOS_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");
  try {
    const response = await fetch(`${backend}/state`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    const payload = await response.json().catch(() => ({ error: "Backend returned invalid JSON." }));
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "HomeOS backend is unreachable. Start backend/server.py on port 8000." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
