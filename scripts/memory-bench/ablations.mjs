import { validateJsonSchema } from "@arnilo/prism";
import { memoryFabricConfigSchema, resolveMemoryFabricConfig } from "@arnilo/prism-memory-system";
import { memorySystemConfigSchema, resolveMemorySystemConfig } from "@arnilo/prism-memory-system";
import { presetFields } from "../../packages/memory/system/src/ltm/config.ts";
import { BENCH_SCOPES } from "./bench-scope.mjs";
import { parseVariantSpecs, VARIANT_PATHS } from "./variants.mjs";

export function historicalVariants(specs = []) {
  return parseVariantSpecs(
    specs.filter((spec) => typeof spec === "string" && Object.keys(VARIANT_PATHS).some((key) => key.split("=")[0] === spec.split("=")[0])),
  );
}

/**
 * Plan 216 Task 4: the session tiers moved into `@arnilo/prism-memory-system` with renamed config
 * (`observer` → `stm`, `messageTokens` → `triggerTokens`, `reflector` → `wm`, `dropper` → `rehearsal`).
 * `session` is the arm's current name; `om` stays the arm id of finished plan 202/210 evidence and the
 * frozen OM-before row, and its `om.*` ablation paths translate onto the renamed fields.
 */
export const SESSION_ARM_KEYS = { observer: "stm", messageTokens: "triggerTokens", reflector: "wm", dropper: "rehearsal" };

/**
 * Plan 216 Task 5: long-term memory (the fabric) is the memory system's `ltm` component. The arms take the component
 * names at the entry point: `session` → `om`, `session+ltm` → `om+fabric`, `ltm…` → `fabric…`. Internally, and in every
 * report, the arm keeps its historical id, so a new run compares like with like against plan 202/210 evidence, the
 * frozen criteria and resume fingerprints.
 */
export const ARM_ALIASES = Object.freeze({
  session: "om",
  "session+ltm": "om+fabric",
  ltm: "fabric",
  "ltm-agentic": "fabric-agentic",
  "ltm-x": "fabric-x",
  "ltm-xc": "fabric-xc",
  "ltm-xc-agentic": "fabric-xc-agentic",
  "ltm-x-tools": "fabric-x-tools",
  "ltm-xc-tools": "fabric-xc-tools",
});

/** The historical arm id for a component-named arm; any other id is returned unchanged. */
export function canonicalArm(config) {
  return typeof config === "string" && Object.hasOwn(ARM_ALIASES, config) ? ARM_ALIASES[config] : config;
}

/** True for an arm that installs the session tiers: `session…`, or the historical `om…` ids. */
export function isSessionConfig(config) {
  return typeof config === "string" && (config.startsWith("session") || config.includes("om"));
}

const paths = new Set([
  "om.observer.messageTokens",
  "om.reflector.observationTokens",
  "om.dropper.targetTokens",
  "session.stm.triggerTokens",
  "session.wm.observationTokens",
  "session.rehearsal.targetTokens",
  "session.rehearsal.policy",
  "fabric.inject",
  "fabric.inject.query",
  "fabric.inject.budgetTokens",
  "fabric.inject.minSimilarity",
  "fabric.inject.topK",
  "fabric.directory",
  "fabric.consolidate",
  "fabric.consolidate.threshold",
  "fabric.promote",
  "fabric.promote.minScore",
  "fabric.exchanges",
  "fabric.lifecycle.verifyAfterSessions",
  "fabric.lifecycle.archive.retrievalBelow",
  "fabric.lifecycle.archive.storageBelow",
  "fabric.lifecycle.archive.graceSessions",
  "fabric.lifecycle.exchangeCapacity.hotTokens",
  "fabric.lifecycle.merge.duplicateDice",
  "fabric.rules",
  // Plan 209 Task 6: the `P+W` no-harm arm on plan 202's suites (tool steps, confirmed rule capture, the lesson nudge).
  "fabric.exchanges.steps",
  "fabric.rules.capture",
  "fabric.lessons.nudge",
  "fabric.cues",
  // Plan 210 Task 5 (gate C-1): the tuning-tier fields its arms set. Each is an existing product field.
  "fabric.lifecycle.recall.retrieval",
  "fabric.recall.expansion",
  "fabric.recall.gather",
  "fabric.inject.cardExcerpt",
  "fabric.inject.minScore",
  "fabric.decisions",
  "fabric.ontology.conceptPrior",
  "om.dropper.policy",
  // Plan 208 Task 3: the ontology arm's tuning, so Task 5 compares trigger policies without a code change.
  "wiki.consolidate.triggers",
  "wiki.consolidate.minNotes",
  "wiki.consolidate.minCoReads",
  "wiki.consolidate.minIntervalTurns",
  "wiki.consolidate.maxSubjectsPerPass",
  "wiki.consolidate.maxClaimsPerConcept",
  "wiki.consolidate.model",
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
  // Plan 210 Task 7 removed `retrieval: "hybrid"`: the fabric package is lexical and has no embeddings arm.
  if (options.config === "fabric-hybrid") throw new Error("MemoryBenchAblation: fabric-hybrid was removed with retrieval hybrid (plan 210 Task 7)");
  const observational = isSessionConfig(options.config)
    ? { enabled: true, ...(options.offline || lifecycle ? { stm: { triggerTokens: options.offline ? 1 : 1000 } } : {}) }
    : null;
  const fabric = options.config?.includes("fabric")
    ? {
        ...(lifecycle ? { promote: {} } : {}),
        ...structuredClone(policy),
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
  // MAB supplies raw fact lists, not conversations. Record this explicit corpus adapter override.
  if (fabric && options.suite === "memoryagentbench-cr" && fabric.inject !== false) {
    fabric.inject = { ...(fabric.inject ?? presetFields(fabric.preset)?.inject), kinds: ["fact"] };
  }
  // Plan 208 Task 3: `--ontology` installs `@arnilo/prism-wiki` next to the fabric. The key exists only on
  // an ontology arm, so every other arm's resolved config (and its protocol hash) is unchanged.
  if (options.ontology && !fabric) throw new Error("MemoryBenchArguments: --ontology needs a fabric arm");
  // The offline fixture holds a handful of notes, so its accumulation threshold is two, the smallest cluster the curator accepts (the OM arm does the same with messageTokens).
  const wiki = options.ontology ? { consolidate: options.offline ? { minNotes: 2 } : {} } : null;
  const configs = { om: observational, session: observational, fabric, ...(wiki ? { wiki } : {}) };
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
      const sessionSpec = spec.startsWith("om.") || spec.startsWith("session.");
      if ((sessionSpec && !observational) || (!sessionSpec && !fabric))
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
    const [arm, ...rawKeys] = path.split(".");
    const keys = arm === "om" ? rawKeys.map((key) => SESSION_ARM_KEYS[key] ?? key) : rawKeys;
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
    if (["fabric.inject", "fabric.promote"].includes(path) && value === true) value = {};
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key];
    }
    target[keys.at(-1)] = value;
  }
  if (observational) {
    if (!validateJsonSchema(memorySystemConfigSchema, observational).ok) throw new Error("MemoryBenchAblation: invalid session-memory settings");
    resolveMemorySystemConfig(observational);
  }
  if (fabric) {
    if (!validateJsonSchema(memoryFabricConfigSchema, fabric).ok) throw new Error("MemoryBenchAblation: invalid fabric settings");
    resolveMemoryFabricConfig(fabric);
  }
  return { observational, fabric, ...(wiki ? { wiki } : {}) };
}

export function resolvedMemoryConfigs(configs) {
  const resolved = {
    observational: configs.observational ? resolveMemorySystemConfig(configs.observational) : null,
    fabric: configs.fabric ? resolveMemoryFabricConfig(configs.fabric) : null,
    // Explicit settings only: the package's defaults move its product hash, which every ontology manifest pins.
    ...(configs.wiki ? { wiki: structuredClone(configs.wiki) } : {}),
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
  return { observational: resolveMemorySystemConfig(), fabric };
}
