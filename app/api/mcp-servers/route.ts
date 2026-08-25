import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { listMcpServers, setMcpServerDisabled } from "@/lib/mcp-config";

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") ?? "";
  if (cwd) {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }
  return NextResponse.json({ servers: listMcpServers(cwd) });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null) as { cwd?: unknown; name?: unknown; disabled?: unknown } | null;
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const name = body?.name;
  const disabled = body?.disabled;
  if (typeof name !== "string" || !name.trim() || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "name and disabled are required" }, { status: 400 });
  }
  if (cwd) {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }
  if (!setMcpServerDisabled(cwd, name, disabled)) {
    return NextResponse.json({ error: "unknown server" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
