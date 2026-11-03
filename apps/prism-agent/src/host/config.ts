import { readFileSync } from "node:fs";
import type { HookRegistrar, HostPort, HostUi, ModelRef, OwnershipScope, PackageInstance } from "@arnilo/prism";
import type { ToolsWebCacheConfig, ToolsWebDomainsConfig, ToolsWebFetchConfig } from "@arnilo/prism-tools-web";

/** Modes the approval package owns. Passed through; the package validates. */
export type HostApprovalMode = "deny" | "ask" | "edits" | "auto";

export type HostWebBackend = "brave" | "exa" | "firecrawl" | "obscura" | "searxng" | "tavily" | "kagi";

/**
 * Refs, paths, and modes only. Package options stay in each factory call.
 * A literal secret is passed through so the package's ref-only check rejects it.
 */
export interface HostConfig {
  readonly models: {
    readonly orchestrator: ModelRef;
    readonly coding: ModelRef;
    readonly research: ModelRef;
  };
  readonly storePath: string;
  readonly workspace: string;
  readonly approval: HostApprovalMode;
  readonly web: {
    readonly backend: HostWebBackend;
    readonly apiKey?: string;
    readonly obscuraBinary?: string;
    /** Exact origin of the SearXNG instance; required when `backend` is `"searxng"`. */
    readonly searxngOrigin?: string;
    /** Second backend for `web_fetch` when `backend` is a keyed search backend. */
    readonly fetch?: Pick<ToolsWebFetchConfig, "backend" | "apiKey">;
    /** Host-enforced hostname permission for search results and every fetch path. */
    readonly domains?: ToolsWebDomainsConfig;
    /** Opt-in per-session page cache. */
    readonly cache?: ToolsWebCacheConfig;
  };
  readonly embeddings?: { readonly model: ModelRef };
  /** Opt-in memory for the research and coding workers. `coding` adds standing decisions and path rules. */
  readonly memory?: "conversational" | "coding";
  /**
   * Opt-in ontology tier (needs `memory`): adds `@arnilo/prism-memory-wiki` beside the fabric, so a background pass
   * consolidates the fabric's notes into cited concepts that `memory.recall` returns first. Default off. The pass
   * is extra model calls, on `ontologyModel` when set and on the agent's own model otherwise.
   */
  readonly ontology?: boolean;
  /** The concept pass's model. A ref, never a key. */
  readonly ontologyModel?: ModelRef;
  /** Passed to tools-research and to `limits.maxContinuations`. Default 1. */
  readonly maxRepairs?: number;
  /**
   * Fixed argv for the build workflow's test gate. Never a shell string, never model output.
   * Exit 0 passes; anything else routes back to the coding worker.
   */
  readonly gate?: {
    readonly command: readonly string[];
  };
  /** The external worker's driver binary (a Phase 15 reference adapter). `args` are argv, never a shell string. */
  /** Scheduled firings. Targets are the fixed research and build agents; cron and prompt are config, never model output. */
  readonly schedule?: {
    /** IANA zone for both crons. Default `UTC`. */
    readonly tz?: string;
    /** Policy for firings missed while no scheduler ran. Default `skip`. */
    readonly missed?: "skip" | "run-once";
    readonly brief?: { readonly cron: string; readonly prompt: string };
    readonly build?: { readonly cron: string };
  };
  readonly external?: {
    readonly binary: string;
    readonly args?: readonly string[];
    /** Default `external`. */
    readonly profile?: string;
    /** Default `<dirname(storePath)>/profiles`. */
    readonly profilesRoot?: string;
  };
}

export interface HostDeps {
  readonly host?: HostPort;
  /** A bare UI: the factories wrap it as `host: { ui }`. A routed UI from `buildHostUi` goes here. */
  readonly ui?: HostUi;
  readonly packages?: readonly PackageInstance[];
  /** Set by the scheduler host: scheduler targets must share the scheduler's ownership scope. */
  readonly ownership?: OwnershipScope;
  /** Host hook registrar, for scenarios and tests that probe a gate. */
  readonly hooks?: (hooks: HookRegistrar) => void;
}

/** `deps.host` wins; otherwise a bare `deps.ui` becomes one. */
export function hostPortOf(deps: HostDeps): HostPort | undefined {
  if (deps.host !== undefined) return deps.host;
  return deps.ui === undefined ? undefined : { ui: deps.ui };
}

const HOST_KEYS = new Set([
  "models",
  "storePath",
  "workspace",
  "approval",
  "web",
  "embeddings",
  "memory",
  "ontology",
  "ontologyModel",
  "maxRepairs",
  "gate",
  "external",
  "schedule",
]);
const GATE_KEYS = new Set(["command"]);
const MODEL_KEYS = new Set(["orchestrator", "coding", "research"]);
const WEB_KEYS = new Set(["backend", "apiKey", "obscuraBinary", "searxngOrigin", "fetch", "domains", "cache"]);
const WEB_FETCH_KEYS = new Set(["backend", "apiKey"]);
const WEB_DOMAIN_KEYS = new Set(["allow", "block"]);
const WEB_CACHE_KEYS = new Set(["ttlSeconds", "maxEntries", "maxBytes"]);
const FETCH_BACKENDS = new Set(["native", "firecrawl", "off"]);
const EMBED_KEYS = new Set(["model"]);
const SCHEDULE_KEYS = new Set(["tz", "missed", "brief", "build"]);
const EXTERNAL_KEYS = new Set(["binary", "args", "profile", "profilesRoot"]);
const MODES = new Set<HostApprovalMode>(["deny", "ask", "edits", "auto"]);
const BACKENDS = new Set<HostWebBackend>(["brave", "exa", "firecrawl", "obscura", "searxng", "tavily", "kagi"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`prism-agent config ${label} has unknown key ${key}`);
  }
}

function modelRef(value: unknown, label: string): ModelRef {
  if (typeof value === "string" && value.length > 0) return value;
  if (isRecord(value) && typeof value.provider === "string" && typeof value.model === "string") {
    // A test or offline host may pin limits the provider catalog cannot supply; real refs resolve them.
    return {
      provider: value.provider,
      model: value.model,
      ...(isRecord(value.limits) ? { limits: value.limits as never } : {}),
    };
  }
  throw new Error(`prism-agent config ${label} must be a model ref`);
}

/** Load `prism-agent.json`. Does not reject a literal secret — the package does. */
export function loadHostConfig(path: string): HostConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("prism-agent config must be an object");
  assertKeys(parsed, HOST_KEYS, "");
  if (!isRecord(parsed.models)) throw new Error("prism-agent config models must be an object");
  assertKeys(parsed.models, MODEL_KEYS, "models");
  if (typeof parsed.storePath !== "string" || parsed.storePath.length === 0) throw new Error("prism-agent config needs storePath");
  if (typeof parsed.workspace !== "string" || parsed.workspace.length === 0) throw new Error("prism-agent config needs workspace");
  if (!MODES.has(parsed.approval as HostApprovalMode)) throw new Error("prism-agent config approval must be deny, ask, edits, or auto");
  if (!isRecord(parsed.web)) throw new Error("prism-agent config web must be an object");
  assertKeys(parsed.web, WEB_KEYS, "web");
  if (!BACKENDS.has(parsed.web.backend as HostWebBackend)) throw new Error("prism-agent config web.backend is not a tools-web backend");
  if (parsed.web.apiKey !== undefined && typeof parsed.web.apiKey !== "string")
    throw new Error("prism-agent config web.apiKey must be a string");
  if (parsed.web.obscuraBinary !== undefined && typeof parsed.web.obscuraBinary !== "string") {
    throw new Error("prism-agent config web.obscuraBinary must be a string");
  }
  if (parsed.web.searxngOrigin !== undefined && typeof parsed.web.searxngOrigin !== "string") {
    throw new Error("prism-agent config web.searxngOrigin must be a string");
  }
  let fetch: HostConfig["web"]["fetch"];
  if (parsed.web.fetch !== undefined) {
    if (!isRecord(parsed.web.fetch)) throw new Error("prism-agent config web.fetch must be an object");
    assertKeys(parsed.web.fetch, WEB_FETCH_KEYS, "web.fetch");
    if (!FETCH_BACKENDS.has(parsed.web.fetch.backend as string)) {
      throw new Error("prism-agent config web.fetch.backend must be native, firecrawl, or off");
    }
    if (parsed.web.fetch.apiKey !== undefined && typeof parsed.web.fetch.apiKey !== "string") {
      throw new Error("prism-agent config web.fetch.apiKey must be a string");
    }
    fetch = {
      backend: parsed.web.fetch.backend as NonNullable<HostConfig["web"]["fetch"]>["backend"],
      ...(typeof parsed.web.fetch.apiKey === "string" ? { apiKey: parsed.web.fetch.apiKey } : {}),
    };
  }
  let domains: HostConfig["web"]["domains"];
  if (parsed.web.domains !== undefined) {
    if (!isRecord(parsed.web.domains)) throw new Error("prism-agent config web.domains must be an object");
    assertKeys(parsed.web.domains, WEB_DOMAIN_KEYS, "web.domains");
    for (const key of ["allow", "block"] as const) {
      const list = parsed.web.domains[key];
      if (list !== undefined && (!Array.isArray(list) || list.some((entry) => typeof entry !== "string"))) {
        throw new Error(`prism-agent config web.domains.${key} must be an array of strings`);
      }
    }
    domains = {
      ...(Array.isArray(parsed.web.domains.allow) ? { allow: parsed.web.domains.allow as string[] } : {}),
      ...(Array.isArray(parsed.web.domains.block) ? { block: parsed.web.domains.block as string[] } : {}),
    };
  }
  let cache: HostConfig["web"]["cache"];
  if (parsed.web.cache !== undefined) {
    if (!isRecord(parsed.web.cache)) throw new Error("prism-agent config web.cache must be an object");
    assertKeys(parsed.web.cache, WEB_CACHE_KEYS, "web.cache");
    if (typeof parsed.web.cache.ttlSeconds !== "number" || !Number.isInteger(parsed.web.cache.ttlSeconds)) {
      throw new Error("prism-agent config web.cache.ttlSeconds must be an integer");
    }
    for (const key of ["maxEntries", "maxBytes"] as const) {
      const value = parsed.web.cache[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value))) {
        throw new Error(`prism-agent config web.cache.${key} must be an integer`);
      }
    }
    cache = {
      ttlSeconds: parsed.web.cache.ttlSeconds,
      ...(typeof parsed.web.cache.maxEntries === "number" ? { maxEntries: parsed.web.cache.maxEntries } : {}),
      ...(typeof parsed.web.cache.maxBytes === "number" ? { maxBytes: parsed.web.cache.maxBytes } : {}),
    };
  }
  let embeddings: HostConfig["embeddings"];
  if (parsed.embeddings !== undefined) {
    if (!isRecord(parsed.embeddings)) throw new Error("prism-agent config embeddings must be an object");
    assertKeys(parsed.embeddings, EMBED_KEYS, "embeddings");
    embeddings = { model: modelRef(parsed.embeddings.model, "embeddings.model") };
  }
  if (parsed.memory !== undefined && parsed.memory !== "conversational" && parsed.memory !== "coding") {
    throw new Error("prism-agent config memory must be conversational or coding");
  }
  if (parsed.ontology !== undefined && typeof parsed.ontology !== "boolean") {
    throw new Error("prism-agent config ontology must be a boolean");
  }
  if (parsed.ontology === true && parsed.memory === undefined) {
    throw new Error("prism-agent config ontology needs memory: the ontology tier consolidates the fabric's notes");
  }
  if (parsed.ontologyModel !== undefined && parsed.ontology !== true) {
    throw new Error("prism-agent config ontologyModel needs ontology: true");
  }
  if (parsed.maxRepairs !== undefined && (typeof parsed.maxRepairs !== "number" || !Number.isInteger(parsed.maxRepairs))) {
    throw new Error("prism-agent config maxRepairs must be an integer");
  }
  let gate: HostConfig["gate"];
  if (parsed.gate !== undefined) {
    if (!isRecord(parsed.gate)) throw new Error("prism-agent config gate must be an object");
    assertKeys(parsed.gate, GATE_KEYS, "gate");
    if (
      !Array.isArray(parsed.gate.command) ||
      parsed.gate.command.length === 0 ||
      parsed.gate.command.some((arg) => typeof arg !== "string" || arg.length === 0)
    ) {
      throw new Error("prism-agent config gate.command must be a non-empty argv");
    }
    gate = { command: parsed.gate.command as string[] };
  }
  let external: HostConfig["external"];
  if (parsed.external !== undefined) {
    if (!isRecord(parsed.external)) throw new Error("prism-agent config external must be an object");
    assertKeys(parsed.external, EXTERNAL_KEYS, "external");
    if (typeof parsed.external.binary !== "string" || parsed.external.binary.length === 0) {
      throw new Error("prism-agent config external needs a binary path");
    }
    if (
      parsed.external.args !== undefined &&
      (!Array.isArray(parsed.external.args) || parsed.external.args.some((arg) => typeof arg !== "string"))
    ) {
      throw new Error("prism-agent config external.args must be an array of strings");
    }
    for (const key of ["profile", "profilesRoot"] as const) {
      if (parsed.external[key] !== undefined && typeof parsed.external[key] !== "string") {
        throw new Error(`prism-agent config external.${key} must be a string`);
      }
    }
    external = {
      binary: parsed.external.binary,
      ...(Array.isArray(parsed.external.args) ? { args: parsed.external.args as string[] } : {}),
      ...(typeof parsed.external.profile === "string" ? { profile: parsed.external.profile } : {}),
      ...(typeof parsed.external.profilesRoot === "string" ? { profilesRoot: parsed.external.profilesRoot } : {}),
    };
  }
  let schedule: HostConfig["schedule"];
  if (parsed.schedule !== undefined) {
    if (!isRecord(parsed.schedule)) throw new Error("prism-agent config schedule must be an object");
    assertKeys(parsed.schedule, SCHEDULE_KEYS, "schedule");
    const { tz, missed, brief, build } = parsed.schedule;
    if (tz !== undefined && typeof tz !== "string") throw new Error("prism-agent config schedule.tz must be a string");
    if (missed !== undefined && missed !== "skip" && missed !== "run-once") {
      throw new Error("prism-agent config schedule.missed must be skip or run-once");
    }
    let briefOut: { cron: string; prompt: string } | undefined;
    if (brief !== undefined) {
      if (!isRecord(brief)) throw new Error("prism-agent config schedule.brief must be an object");
      assertKeys(brief, new Set(["cron", "prompt"]), "schedule.brief");
      if (typeof brief.cron !== "string" || typeof brief.prompt !== "string" || brief.prompt.length === 0) {
        throw new Error("prism-agent config schedule.brief needs a cron and a prompt");
      }
      briefOut = { cron: brief.cron, prompt: brief.prompt };
    }
    let buildOut: { cron: string } | undefined;
    if (build !== undefined) {
      if (!isRecord(build)) throw new Error("prism-agent config schedule.build must be an object");
      assertKeys(build, new Set(["cron"]), "schedule.build");
      if (typeof build.cron !== "string") throw new Error("prism-agent config schedule.build needs a cron");
      buildOut = { cron: build.cron };
    }
    schedule = {
      ...(tz === undefined ? {} : { tz }),
      ...(missed === undefined ? {} : { missed }),
      ...(briefOut === undefined ? {} : { brief: briefOut }),
      ...(buildOut === undefined ? {} : { build: buildOut }),
    };
  }
  return {
    models: {
      orchestrator: modelRef(parsed.models.orchestrator, "models.orchestrator"),
      coding: modelRef(parsed.models.coding, "models.coding"),
      research: modelRef(parsed.models.research, "models.research"),
    },
    storePath: parsed.storePath,
    workspace: parsed.workspace,
    approval: parsed.approval as HostApprovalMode,
    web: {
      backend: parsed.web.backend as HostWebBackend,
      ...(typeof parsed.web.apiKey === "string" ? { apiKey: parsed.web.apiKey } : {}),
      ...(typeof parsed.web.obscuraBinary === "string" ? { obscuraBinary: parsed.web.obscuraBinary } : {}),
      ...(typeof parsed.web.searxngOrigin === "string" ? { searxngOrigin: parsed.web.searxngOrigin } : {}),
      ...(fetch === undefined ? {} : { fetch }),
      ...(domains === undefined ? {} : { domains }),
      ...(cache === undefined ? {} : { cache }),
    },
    ...(embeddings === undefined ? {} : { embeddings }),
    ...(parsed.memory === "conversational" || parsed.memory === "coding" ? { memory: parsed.memory } : {}),
    ...(parsed.ontology === true ? { ontology: true } : {}),
    ...(parsed.ontologyModel === undefined ? {} : { ontologyModel: modelRef(parsed.ontologyModel, "ontologyModel") }),
    ...(typeof parsed.maxRepairs === "number" ? { maxRepairs: parsed.maxRepairs } : {}),
    ...(gate === undefined ? {} : { gate }),
    ...(external === undefined ? {} : { external }),
    ...(schedule === undefined ? {} : { schedule }),
  };
}
