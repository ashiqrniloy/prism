import manifest from "../package.json" with { type: "json" };
import { dirname, join, resolve } from "node:path";
import type { AgentState, ContextDraft, HookContext, Message, PackageAPI, PackageInstance, SystemPromptContribution } from "@arnilo/prism";
import { composeSystemPrompt, createPathTrustPolicy, definePackage, isPathInside } from "@arnilo/prism";
import { type ContextFilesConfig, contextFilesConfigSchema } from "./config.js";
import { type ContextFileLayersResult, readFileMtime, resolveContextFileLayers } from "./layers.js";

const PACKAGE = "@arnilo/prism-context-files";

/** Per-session cache. The layers are read once and re-checked by mtime at most once per run. */
interface SessionCache {
  /** Set by the `run.started` observer. */
  runId?: string;
  /** The run whose mtimes the cached layers were validated against. */
  readRunId?: string;
  files?: ContextFileLayersResult;
}

interface FilesPlan {
  readonly root: string;
  readonly agentsMdPaths: readonly string[];
  readonly systemMdPaths: readonly string[];
  readonly trust: ReturnType<typeof createPathTrustPolicy>;
}

const definition = definePackage<ContextFilesConfig>({
  name: PACKAGE,
  version: manifest.version,
  description: "AGENTS.md and SYSTEM.md context layers, trust-gated and cached per session.",
  requires: { api: 1 },
  config: contextFilesConfigSchema,
  setup(prism) {
    install(prism, planFiles(prism));
  },
});

/**
 * `contextFiles({ root })` — one agent's layers.
 *
 * Reads `AGENTS.md` from `root` up to the enclosing trusted root, the `SYSTEM.md` layer under
 * `root` (and under `globalRoot` when set), plus any explicit `files`, and adds them to the
 * `context.build` draft as system-prompt layers in the kernel's source rank order. Nothing is
 * written to the store.
 */
export function contextFiles(config: ContextFilesConfig): PackageInstance {
  return definition(config);
}

/** The definition itself, so a host that owns the config can list it directly. */
export default definition;

function planFiles(prism: PackageAPI<ContextFilesConfig>): FilesPlan {
  const config = prism.config;
  const root = config.root?.trim();
  if (!root) throw new Error(`${PACKAGE}: config needs root — the workspace directory AGENTS.md and SYSTEM.md are read from`);
  const resolvedRoot = resolve(root);
  const files = (config.files ?? []).map((file) => resolve(file));
  const trustedRoots = [
    ...new Set([
      ...(config.trustedRoots?.length ? config.trustedRoots.map((entry) => resolve(entry)) : [resolvedRoot]),
      ...files.map((file) => dirname(file)),
    ]),
  ];
  const agentsMdPaths =
    config.agentsMd === false ? [...files] : [...agentsMdCandidates(resolvedRoot, trustedRoots), ...files].filter(unique());
  const systemMdPaths =
    config.systemMd === false
      ? []
      : [join(resolvedRoot, "SYSTEM.md"), ...(config.globalRoot ? [join(resolve(config.globalRoot), ".prism", "agent", "SYSTEM.md")] : [])];
  return { root: resolvedRoot, agentsMdPaths, systemMdPaths, trust: createPathTrustPolicy({ trustedRoots }) };
}

/** `AGENTS.md` candidates from the outermost enclosing trusted root down to `root`. */
function agentsMdCandidates(root: string, trustedRoots: readonly string[]): readonly string[] {
  const dirs = [root];
  for (let dir = root; ; ) {
    const parent = dirname(dir);
    if (parent === dir || !trustedRoots.some((trusted) => isPathInside(trusted, parent))) break;
    dirs.unshift(parent);
    dir = parent;
  }
  return dirs.map((dir) => join(dir, "AGENTS.md"));
}

function unique(): (value: string, index: number, all: readonly string[]) => boolean {
  return (value, index, all) => all.indexOf(value) === index;
}

function install(prism: PackageAPI<ContextFilesConfig>, plan: FilesPlan): void {
  const sessions = prism.state.agent<Map<string, SessionCache>>("sessions", new Map());
  prism.hooks.on("run.started", (payload) => {
    const cached = sessions.get().get(payload.sessionId);
    sessions.get().set(payload.sessionId, { ...cached, runId: payload.runId });
  });
  prism.hooks.on("context.build", (draft: ContextDraft, context: HookContext) => build(draft, context, prism, plan, sessions));
}

async function build(
  draft: ContextDraft,
  context: HookContext,
  prism: PackageAPI<ContextFilesConfig>,
  plan: FilesPlan,
  sessions: AgentState<Map<string, SessionCache>>,
): Promise<ContextDraft | undefined> {
  const layers = await layersFor(context, prism, plan, sessions);
  if (layers.length === 0) return undefined;
  const base = leadingSystemText(draft.messages);
  const text = composeSystemPrompt(layers, base === undefined ? {} : { base });
  if (text === undefined || text === base) return undefined;
  return { ...draft, systemPrompt: text };
}

/**
 * The cached layers for this session. `context.build` is dispatched kernel-side with an empty
 * `sessionId`/`runId`, so the session comes from the bound `SessionContext` and the current run
 * from the last `run.started` event. Freshness (one `stat` per candidate path) is checked at most
 * once per run — a resumed run without a fresh `run.started` falls back to once per turn.
 */
async function layersFor(
  context: HookContext,
  prism: PackageAPI<ContextFilesConfig>,
  plan: FilesPlan,
  sessions: AgentState<Map<string, SessionCache>>,
): Promise<readonly SystemPromptContribution[]> {
  const key = context.session?.id ?? context.sessionId;
  const map = sessions.get();
  const cache = map.get(key) ?? {};
  map.set(key, cache);
  const runId = cache.runId ?? "";
  const cached = cache.files;
  if (cached && runId !== "" && cache.readRunId === runId) return cached.layers;
  if (cached && (runId === "" || (await unchanged(cached)))) {
    cache.readRunId = runId;
    return cached.layers;
  }
  cache.files = await resolveContextFileLayers({
    workspaceRoot: plan.root,
    agentsMdPaths: plan.agentsMdPaths,
    systemMdPaths: plan.systemMdPaths,
    trust: plan.trust,
    onSkip: (path) => prism.status.note("warn", `skipped ${path}: outside trusted roots`),
  });
  cache.readRunId = runId;
  return cache.files.layers;
}

/** True when every candidate file still has the mtime the cached layers were read at. */
async function unchanged(result: ContextFileLayersResult): Promise<boolean> {
  for (const [path, mtime] of result.mtimes) {
    if ((await readFileMtime(path)) !== mtime) return false;
  }
  return true;
}

/** The draft's leading system text, which `draft.systemPrompt` replaces when set. */
function leadingSystemText(messages: readonly Message[]): string | undefined {
  const first = messages[0];
  if (first?.role !== "system") return undefined;
  const text = first.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

export type { ContextFilesConfig } from "./config.js";
export { contextFilesConfigSchema } from "./config.js";
export type { InstructionSourceOptions } from "./instructions.js";
export { resolveInstructionSource, resolveInstructionSources } from "./instructions.js";
export type { ContextFileLayerOptions, ContextFileLayersResult } from "./layers.js";
export { readContextFileLayers, resolveContextFileLayers } from "./layers.js";
