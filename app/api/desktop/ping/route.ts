import { NextResponse } from "next/server";

// Lightweight capability probe for the desktop shell's attach-or-spawn decision
// (replaces the removed /api/terminals probe).
export async function GET() {
  return NextResponse.json({
    ok: true,
    name: "PiPi Agent",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
  });
}
