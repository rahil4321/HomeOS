import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_SCENARIOS = new Set(["delivery", "urgent", "trivial", "meeting", "offline", "reset"]);

export async function POST(request: Request) {
  const token = process.env.HOMEOS_DEMO_TOKEN;
  const backend = (process.env.HOMEOS_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

  if (!token) {
    return NextResponse.json(
      { error: "Demo controls are not configured. Set HOMEOS_DEMO_TOKEN in frontend/.env.local." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const scenario = (body as { scenario?: unknown } | null)?.scenario;
  if (typeof scenario !== "string" || !ALLOWED_SCENARIOS.has(scenario)) {
    return NextResponse.json({ error: "Unknown demo scenario." }, { status: 400 });
  }

  try {
    const response = await fetch(`${backend}/demo/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HomeOS-Demo-Key": token,
      },
      body: JSON.stringify({ scenario }),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const payload = await response.json().catch(() => ({ error: "Backend returned invalid JSON." }));
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not reach HomeOS backend. Keep backend/server.py running on port 8000." },
      { status: 503 },
    );
  }
}
