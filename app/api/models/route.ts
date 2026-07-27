import { stat } from "fs/promises";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { loadModelsWithCache, withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.substring(colonIndex + 1);
  return THINKING_SUFFIXES.has(suffix) ? trimmed.substring(0, colonIndex) : trimmed;
}

function filterByExactEnabledModels<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
  declaredModels: ReadonlySet<string>,
): readonly T[] {
  // 用户在 Models 对话框（models.json）里显式声明的模型视为显式启用，
  // 不被 enabledModels 白名单隐藏；白名单继续约束其他自动发现的模型。
  const declared = available.filter((m) => declaredModels.has(`${m.provider}/${m.id}`));
  if (!enabledModels || enabledModels.length === 0) return available;

  const refs = new Set(enabledModels.map(stripThinkingSuffix).filter(Boolean));
  const visible = available.filter((m) => refs.has(`${m.provider}/${m.id}`) || refs.has(m.id));
  const merged = [...visible, ...declared.filter((m) => !visible.includes(m))];
  return merged.length > 0 ? merged : available;
}

function getDeclaredModels(): Set<string> {
  try {
    const data = JSON.parse(readFileSync(join(getAgentDir(), "models.json"), "utf8")) as {
      providers?: Record<string, { models?: { id?: string }[] }>;
    };
    const pairs = new Set<string>();
    for (const [provider, entry] of Object.entries(data.providers ?? {})) {
      for (const model of entry?.models ?? []) {
        if (model?.id) pairs.add(`${provider}/${model.id}`);
      }
    }
    return pairs;
  } catch {
    return new Set();
  }
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const agentDir = getAgentDir();
  const services = await createAgentSessionServices({ cwd, agentDir });
  const available = await services.modelRuntime.getAvailable();
  const modelError = services.modelRuntime.getError();
  const settings: SettingsManager = services.settingsManager;
  const enabledModels = settings.getEnabledModels();
  const visible = filterByExactEnabledModels(available, enabledModels, getDeclaredModels());
  modelList = visible.map((m: { id: string; name: string; provider: string }) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
  })).sort(compareModelEntries);
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = getSupportedThinkingLevels(m);
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
  }

  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (provider && modelId && visible.some((m) => m.provider === provider && m.id === modelId)) {
    defaultModel = { provider, modelId };
  }

  return withModelRuntimeError(
    { models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps },
    modelError,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
};

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch {
    return Response.json(EMPTY_MODELS);
  }
}
