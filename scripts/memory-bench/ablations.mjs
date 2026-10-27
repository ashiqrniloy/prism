import { validateJsonSchema } from "@arnilo/prism";
import { memoryFabricConfigSchema, resolveMemoryFabricConfig } from "@arnilo/prism-memory-fabric";
import { memoryObservationalConfigSchema, resolveMemoryObservationalConfig } from "@arnilo/prism-memory-observational";
import { presetFields } from "../../packages/memory/fabric/src/config.ts";
import { BENCH_SCOPES } from "./bench-scope.mjs";
import { parseVariantSpecs, VARIANT_PATHS } from "./variants.mjs";

export function historicalVariants(specs = []) {
  return parseVariantSpecs(
    specs.filter((spec) => typeof spec === "string" && Object.keys(VARIANT_PATHS).some((key) => key.split("=")[0] === spec.split("=")[0])),
  );
}

const paths = new Set([
  "om.observer.messageTokens",
  "om.reflector.observationTokens",
  "om.dropper.targetTokens",
  "fabric.inject",
  "fabric.inject.query",
  "fabric.inject.budgetTokens",
  "fabric.inject.minSimilarity",
  "fabric.inject.topK",
  "fabric.directory",
  "fabric.consolidate",
  "fabric.consolidate.threshold",
  "fabric.consolidate.decider",
  "fabric.promote",
  "fabric.promote.minScore",
  "fabric.exchanges",
  "fabric.lifecycle.verifyAfterSessions",
  "fabric.lifecycle.archive.retrievalBelow",
  "fabric.lifecycle.archive.storageBelow",
  "fabric.lifecycle.archive.graceSessions",
  "fabric.lifecycle.merge.duplicateDice",
  "fabric.lifecycle.merge.episodes",
  "fabric.core",
  "fabric.cues",
  "fabric.lifecycle.widen.minProjects",
  "fabric.lifecycle.widen.minSiblings",
  "fabric.lifecycle.widen.contradictionsToSupersede",
  ...["explicit", "correction", "outcome", "recurrence", "generality", "ephemerality", "derivability", "duplicate"].map(
    (k) => `fabric.promote.weights.${k}`,
  ),
  ...["episode", "fact", "preference", "procedure", "exchange"].map((k) => `fabric.lifecycle.decay.${k}`),
  ...["user", "agent", "project"].flatMap((scope) => ["notes", "tokens"].map((k) => `fabric.lifecycle.capacity.${scope}.${k}`)),
]);

/**
 * Plan 188.10 Task 4: the arms that ship passive injection *and* the memory tools. `agentic` means
 * tools with injection off; `-tools` means the product's shape, both on.
 */
export function isToolsConfig(config) {
  return typeof config === "string" && (config.includes("agentic") || config.endsWith("-tools"));
}

/**
 * Plan 188.10 Task 5: the extractor's budget and reasoning level belong to the write side, so they go
 * into `promote` (answer and judge generation stay 4,096). Only an arm that promotes takes them.
 */
export function extractorSettings(options = {}) {
  return {
    ...(options.writeOutputTokens === undefined ? {} : { maxOutputTokens: options.writeOutputTokens }),
    ...(options.writeThinking === undefined ? {} : { thinkingLevel: options.writeThinking }),
  };
}

/** The manifest's write-side generation, recorded separately from `generation`. */
export function writeGeneration(options = {}) {
  if (options.offline) return null;
  return {
    temperature: 0,
    maxTokens: options.writeOutputTokens ?? 4096,
    ...(options.writeThinking === undefined ? {} : { thinkingLevel: options.writeThinking }),
  };
}

/** Only shipped settings: unsupported historical mechanisms fail before any paid call. */
export function memoryConfigs(options, { lifecycle = false, policy = {} } = {}) {
  const observational = options.config?.includes("om")
    ? { enabled: true, ...(options.offline || lifecycle ? { observer: { messageTokens: options.offline ? 1 : 1000 } } : {}) }
    : null;
  const fabric = options.config?.includes("fabric")
    ? {
        ...(lifecycle ? { promote: {} } : {}),
        ...structuredClone(policy),
        retrieval: options.config === "fabric-hybrid" ? "hybrid" : "lexical",
        inject:
          options.config === "fabric-agentic"
            ? false
            : (structuredClone(policy.inject) ?? {
                query: "task",
                kinds: lifecycle ? ["fact", "procedure", "episode", "file"] : ["episode", "fact", "file"],
              }),
        ...(!lifecycle ? { scopes: BENCH_SCOPES } : {}),
      }
    : null;
  // Plan 188.9 Task 9: the product-ingestion arms. `fabric-x` archives exchanges and delivers them
  // with Task 5's evidence-sized renderer, LLM-free write side (no promote). `fabric-xc` also
  // promotes, so consolidation links dated facts to their exchanges; `fabric-xc-agentic` is the
  // same store with tools and passive injection off. Kinds are explicit: an x store holds
  // exchanges, an xc store holds exchanges plus the facts extracted from them.
  // Plan 188.10 Task 4: the `-tools` arms are the product's shipping shape — passive injection with
  // the same kinds and defaults, and the memory tools left on — over the x or xc store.
  if (options.config?.startsWith("fabric-x") && fabric) {
    const agentic = options.config === "fabric-xc-agentic";
    const exchangesOnly = options.config.startsWith("fabric-x") && !options.config.startsWith("fabric-xc");
    if (exchangesOnly) {
      // Plan 188.11 Task 3: the x and x-tools arms are the conversational preset. Only what the arm
      // adds to it is explicit; `inject` stays the preset's unless a policy replaces it.
      fabric.preset = "conversational";
      delete fabric.inject;
      if (policy.inject !== undefined) fabric.inject = structuredClone(policy.inject);
    } else {
      fabric.exchanges = {};
      fabric.inject = agentic ? false : (structuredClone(policy.inject) ?? { query: "task", kinds: ["fact", "exchange"] });
      // The write side builds balances of fact+exchange only for xc; x has no extractor to call.
      fabric.promote = {};
    }
  }
  // The extractor budget reaches only an arm that promotes: adding `promote` to `fabric-x` would
  // give an LLM-free write side a model call.
  if (fabric && typeof fabric.promote === "object") fabric.promote = { ...fabric.promote, ...extractorSettings(options) };
  const configs = { om: observational, fabric };
  const seen = new Set();
  if (options.ablate !== undefined && !Array.isArray(options.ablate)) throw new Error("MemoryBenchAblation: expected array");
  const historical = historicalVariants(options.ablate);
  const preloaded = process.execArgv.some((arg) => arg.endsWith("/variants.mjs"));
  const matching = JSON.stringify(historical) === JSON.stringify(JSON.parse(process.env.PRISM_MEMORY_BENCH_VARIANTS ?? "[]"));
  if (historical.length && (!preloaded || !matching))
    throw new Error("MemoryBenchAblation: historical variants require matching process preload");
  for (const spec of options.ablate ?? []) {
    if (typeof spec !== "string") throw new Error("MemoryBenchAblation: expected path=value");
    if (historical.includes(spec)) {
      if ((spec.startsWith("om.") && !observational) || (!spec.startsWith("om.") && !fabric))
        throw new Error("MemoryBenchAblation: inactive historical arm");
      continue;
    }
    const index = spec.indexOf("="),
      path = spec.slice(0, index),
      raw = spec.slice(index + 1);
    if (
      index < 1 ||
      !raw ||
      !paths.has(path) ||
      [...seen].some((key) => key === path || key.startsWith(`${path}.`) || path.startsWith(`${key}.`))
    )
      throw new Error("MemoryBenchAblation: unsupported or conflicting setting");
    seen.add(path);
    const [arm, ...keys] = path.split(".");
    let target = configs[arm];
    if (!target) throw new Error("MemoryBenchAblation: setting does not belong to selected arm");
    // An explicit field replaces the preset's whole value, so an ablation of one nested key starts from the preset's field.
    if (arm === "fabric" && fabric.preset !== undefined && fabric[keys[0]] === undefined) {
      const inherited = presetFields(fabric.preset)[keys[0]];
      if (inherited !== undefined) fabric[keys[0]] = inherited;
    }
    if (options.config === "fabric-agentic" && path.startsWith("fabric.inject"))
      throw new Error("MemoryBenchAblation: agentic arm fixes injection off");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    if (raw === "on") value = true;
    if (raw === "off") value = false;
    if (["fabric.inject", "fabric.promote", "fabric.lifecycle.merge.episodes"].includes(path) && value === true) value = {};
    if (path === "fabric.consolidate.decider" && value === false && fabric.consolidate === false) continue;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key];
    }
    if (path === "fabric.consolidate.decider" && value === false) {
      delete target[keys.at(-1)];
      continue;
    }
    target[keys.at(-1)] = value;
  }
  if (observational) {
    if (!validateJsonSchema(memoryObservationalConfigSchema, observational).ok) throw new Error("MemoryBenchAblation: invalid OM settings");
    resolveMemoryObservationalConfig(observational);
  }
  if (fabric) {
    if (!validateJsonSchema(memoryFabricConfigSchema, fabric).ok) throw new Error("MemoryBenchAblation: invalid fabric settings");
    resolveMemoryFabricConfig(fabric);
  }
  return { observational, fabric };
}

export function resolvedMemoryConfigs(configs) {
  const resolved = {
    observational: configs.observational ? resolveMemoryObservationalConfig(configs.observational) : null,
    fabric: configs.fabric ? resolveMemoryFabricConfig(configs.fabric) : null,
  };
  // Host filesystem identity is unnecessary in public measurement artifacts.
  if (resolved.fabric?.scopes.project) {
    delete resolved.fabric.scopes.project.root;
    delete resolved.fabric.scopes.project.roots;
  }
  return resolved;
}

export function defaultSnapshot() {
  const { scopes, tools, store, ...fabric } = resolveMemoryFabricConfig();
  return { observational: resolveMemoryObservationalConfig(), fabric };
}
