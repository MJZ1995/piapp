import { NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

// 更新模型可见白名单（settings.json 的 enabledModels）。
// body: { enabledModels: string[] | null }；null/空数组 = 全部可见。
export async function PUT(req: Request) {
  try {
    const body = await req.json() as { enabledModels?: unknown };
    const raw = body.enabledModels;
    const list = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const services = await createAgentSessionServices({ cwd: process.cwd(), agentDir: getAgentDir() });
    services.settingsManager.setEnabledModels(list.length > 0 ? list : undefined);
    await services.settingsManager.flush();
    invalidateModelsCache();
    return NextResponse.json({ success: true, enabledModels: list.length > 0 ? list : null });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
