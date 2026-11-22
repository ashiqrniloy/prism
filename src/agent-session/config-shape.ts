/**
 * Plan 229 Task 3: shape checks for `AgentConfig`, `RunOptions`, and `SessionOptions`. A table of
 * key → checker, shared where keys repeat. One pass over the object's own keys; tool schemas are not
 * walked. Messages name keys and expected shapes, never values: a config can hold secrets.
 */
import { assertCompactionTrigger, type CompactionTrigger } from "../contracts-core/compaction.js";
import type { SessionLimits } from "../contracts-core/run-limits.js";
import { resolveCeilings, resolveRunLimits, resolveSessionLimits } from "../run-limits.js";
import { resolveToolConcurrency } from "../tools.js";

type Check = (value: unknown, path: string) => void;

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return type === "object" ? "an object" : type === "undefined" ? "undefined" : `a ${type}`;
}

function fail(path: string, expected: string, value: unknown): never {
  throw new TypeError(`${path} must be ${expected}; received ${kindOf(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Levenshtein distance, bounded to short key names. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

function nearestKey(key: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of known) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Checks every own key with a defined value against `table`; an unknown key throws with the nearest known key. */
function checkKeys(
  value: Record<string, unknown>,
  path: string,
  table: Readonly<Record<string, Check>>,
  extra: readonly string[] = [],
): void {
  const known = [...Object.keys(table), ...extra];
  for (const key of Object.keys(value)) {
    const field = value[key];
    if (field === undefined) continue;
    const check = table[key];
    if (check) {
      check(field, `${path}.${key}`);
      continue;
    }
    if (extra.includes(key)) continue;
    const near = nearestKey(key, known);
    throw new TypeError(`${path} has unknown key "${key}"${near ? `; did you mean "${near}"?` : ""}`);
  }
}

const any: Check = () => {};
const string: Check = (value, path) => {
  if (typeof value !== "string") fail(path, "a string", value);
};
const boolean: Check = (value, path) => {
  if (typeof value !== "boolean") fail(path, "a boolean", value);
};
const literalTrue: Check = (value, path) => {
  if (value !== true) fail(path, "true", value);
};
const fn: Check = (value, path) => {
  if (typeof value !== "function") fail(path, "a function", value);
};
const object: Check = (value, path) => {
  if (!isRecord(value)) fail(path, "an object", value);
};
/** An instance: an object or a callable (a class instance, a policy object, or a function). */
const instance: Check = (value, path) => {
  if (!isRecord(value) && typeof value !== "function") fail(path, "an object", value);
};
const array: Check = (value, path) => {
  if (!Array.isArray(value)) fail(path, "an array", value);
};
const stringArray: Check = (value, path) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail(path, "an array of strings", value);
};
function oneOf(...options: readonly string[]): Check {
  const expected = options.map((option) => `"${option}"`).join(" or ");
  return (value, path) => {
    if (typeof value !== "string" || !options.includes(value)) fail(path, expected, value);
  };
}
function closedObject(table: Readonly<Record<string, Check>>, shape: string): Check {
  return (value, path) => {
    if (!isRecord(value)) fail(path, `an object (${shape})`, value);
    checkKeys(value, path, table);
  };
}
const nonNegativeInteger: Check = (value, path) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(path, "a non-negative safe integer", value);
};
const nonNegativeNumber: Check = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(path, "a finite non-negative number", value);
};
const positiveInteger: Check = (value, path) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(path, "a positive safe integer", value);
};
// The upper bound is the agent's `ceilings.toolConcurrency`, checked once the ceilings resolve.
const concurrency: Check = (value, path) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) fail(path, "a positive integer", value);
};

const modelRef: Check = (value, path) => {
  if (typeof value !== "string" && !isRecord(value)) fail(path, 'a "provider/model" string or a model object', value);
};

const toolDefinitions: Check = (value, path) => {
  if (!Array.isArray(value)) fail(path, "an array of ToolDefinition", value);
  value.forEach((tool: unknown, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(tool)) fail(at, "a ToolDefinition object", tool);
    if (typeof tool.name !== "string" || !tool.name) fail(`${at}.name`, "a non-empty string", tool.name);
    if (typeof tool.execute !== "function") fail(`${at}.execute`, "a function", tool.execute);
  });
};

const skillList: Check = (value, path) => {
  if (!Array.isArray(value)) fail(path, "an array of Skill", value);
  value.forEach((skill: unknown, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(skill)) fail(at, "a Skill object", skill);
    if (typeof skill.name !== "string" || !skill.name) fail(`${at}.name`, "a non-empty string", skill.name);
  });
};

const limits: Check = (value, path) => {
  if (!isRecord(value)) fail(path, "an object (RunLimits)", value);
  checkKeys(value, path, LIMIT_KEYS);
  try {
    // Shape only: the byte axes are bounded by the agent's ceilings, checked where they resolve.
    resolveRunLimits(value, undefined, UNBOUNDED_CEILINGS);
  } catch (error) {
    // `validateLimits` messages name the axis and the expected range only.
    throw new TypeError(`${path}: ${(error as Error).message}`);
  }
};
const UNBOUNDED_CEILINGS = resolveCeilings({
  maxRequestBytes: Number.MAX_SAFE_INTEGER,
  maxResponseBytes: Number.MAX_SAFE_INTEGER,
  runStateBytes: Number.MAX_SAFE_INTEGER,
});
const LIMIT_KEYS: Readonly<Record<string, Check>> = Object.fromEntries(
  [
    "maxTurns",
    "maxProviderAttempts",
    "maxToolRounds",
    "maxToolCalls",
    "maxRepeatedToolRounds",
    "maxWallTimeMs",
    "maxRequestBytes",
    "maxResponseBytes",
    "maxInputTokens",
    "maxOutputTokens",
    "maxTotalTokens",
    "maxCost",
    "maxContinuations",
    "maxToolTimeMs",
    "backgroundSettleMs",
    "bufferOutput",
    "maxRunStateBytes",
  ].map((key) => [key, any]),
);

const SESSION_LIMIT_KEYS: Readonly<Record<string, Check>> = {
  maxCost: any,
  maxTotalTokens: any,
  maxRuns: any,
  deadline: any,
};

const sessionLimitsCheck: Check = (value, path) => {
  if (!isRecord(value)) fail(path, "an object (SessionLimits)", value);
  checkKeys(value, path, SESSION_LIMIT_KEYS);
  try {
    resolveSessionLimits(value as SessionLimits);
  } catch (error) {
    throw new TypeError(`${path}: ${(error as Error).message}`);
  }
};

const compaction: Check = (value, path) => {
  if (value === false) return;
  if (!isRecord(value)) fail(path, "false or an object (CompactionOptions)", value);
  for (const key of ["thresholdEntries", "keepRecentEntries", "maxSummaryChars"] as const) {
    if (value[key] !== undefined) nonNegativeInteger(value[key], `${path}.${key}`);
  }
  if (value.trigger !== undefined) {
    try {
      assertCompactionTrigger(value.trigger as CompactionTrigger);
    } catch (error) {
      throw new TypeError(`${path}.trigger: ${(error as Error).message}`);
    }
  }
};

const retry: Check = (value, path) => {
  if (value === false) return;
  if (!isRecord(value)) fail(path, "false or an object (RetryOptions)", value);
  if (value.policy !== undefined) {
    const policy = value.policy;
    if (!isRecord(policy) || typeof policy.decide !== "function") fail(`${path}.policy`, "an object with a decide() function", policy);
  }
  if (value.maxAttempts !== undefined) nonNegativeInteger(value.maxAttempts, `${path}.maxAttempts`);
  for (const key of ["baseDelayMs", "maxDelayMs", "maxRetryAfterMs"] as const) {
    if (value[key] !== undefined) nonNegativeNumber(value[key], `${path}.${key}`);
  }
  if (value.afterOutput !== undefined) boolean(value.afterOutput, `${path}.afterOutput`);
};

const packageConfig: Check = (value, path) => {
  if (!isRecord(value)) fail(path, "an object of per-package config objects", value);
  for (const name of Object.keys(value)) {
    if (value[name] !== undefined && !isRecord(value[name])) fail(`${path}["${name}"]`, "an object", value[name]);
  }
};

const usageEstimation = oneOf("fallback", "off", "strict");

/** Keys `AgentConfig` and `RunOptions` share, with the same shape. */
const SHARED: Readonly<Record<string, Check>> = {
  model: modelRef,
  limits,
  providerOptions: object,
  thinkingLevel: string,
  systemPrompt: (value, path) => {
    if (value !== false && !isRecord(value) && !Array.isArray(value))
      fail(path, "false, a contribution object, or an array of them", value);
  },
  compaction,
  retry,
  metadata: object,
  redactor: instance,
  runLedger: instance,
  effectStore: instance,
  ownership: object,
  principal: object,
  idempotencyKey: string,
  allowHiddenToolCalls: literalTrue,
  inputLayout: oneOf("cache_aware"),
};

const AGENT_CONFIG: Readonly<Record<string, Check>> = {
  ...SHARED,
  id: string,
  name: string,
  instructions: string,
  sessionLimits: sessionLimitsCheck,
  tools: closedObject(
    { add: toolDefinitions, validation: oneOf("schema", "off"), concurrency },
    '{ add?: ToolDefinition[], validation?: "schema" | "off", concurrency?: number }',
  ),
  skills: closedObject(
    {
      dirs: stringArray,
      add: skillList,
      disclosure: oneOf("progressive", "eager"),
      catalog: closedObject(
        { maxEntries: positiveInteger, maxDescriptionBytes: positiveInteger },
        "{ maxEntries?: number, maxDescriptionBytes?: number }",
      ),
    },
    "{ dirs?: string[], add?: Skill[], disclosure?, catalog? }",
  ),
  usageEstimation,
  durability: oneOf("suspension", "turn"),
  resourceLoader: instance,
  trust: instance,
  costCatalog: instance,
  validator: fn,
  hooks: fn,
  slots: object,
  packages: array,
  packageConfig,
  disable: closedObject(
    { tools: stringArray, hooks: stringArray, commands: stringArray, skills: stringArray, packages: stringArray },
    "{ tools?, hooks?, commands?, skills?, packages?: string[] }",
  ),
  host: object,
  // Host-only (plan 239 Task 4): not in SHARED, so `RunOptions.ceilings` is an unknown key.
  ceilings: object,
};

const RUN_OPTIONS: Readonly<Record<string, Check>> = {
  ...SHARED,
  signal: object,
  interactive: boolean,
  validate: fn,
  tools: closedObject({ only: stringArray, concurrency }, "{ only?: string[], concurrency?: number }"),
  skills: (value, path) => {
    if (value === false) return;
    if (!isRecord(value)) fail(path, "false or { only: string[] }", value);
    checkKeys(value, path, { only: stringArray });
    if (value.only === undefined) fail(`${path}.only`, "a string array", value.only);
  },
  chargeTo: object,
  // `assertPromptVersionRef` owns the shape and runs before the run starts.
  promptVersion: any,
};

const SUBSCRIBE_KEYS = ["acrossRuns", "maxQueuedEvents", "overflow"] as const;

const SESSION_OPTIONS: Readonly<Record<string, Check>> = {
  id: string,
  create: boolean,
  leafId: string,
  parent: object,
  actor: object,
  metadata: object,
  ownership: object,
  snapshotCacheTtlMs: nonNegativeNumber,
  limits: sessionLimitsCheck,
};

function root(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(path, "an object", value);
  return value;
}

/** Throws `TypeError` for an unknown `AgentConfig` key or a known key of the wrong shape. */
export function assertAgentConfigShape(config: unknown): void {
  const value = root(config, "AgentConfig");
  if (!value) fail("AgentConfig", "an object", config);
  checkKeys(value, "AgentConfig", AGENT_CONFIG);
  let ceilings: ReturnType<typeof resolveCeilings>;
  try {
    ceilings = resolveCeilings(value.ceilings as Parameters<typeof resolveCeilings>[0]);
  } catch (error) {
    throw new TypeError(`AgentConfig.${(error as Error).message}`);
  }
  try {
    if (value.limits !== undefined) resolveRunLimits(value.limits as Parameters<typeof resolveRunLimits>[0], undefined, ceilings);
    const tools = value.tools as { readonly concurrency?: number } | undefined;
    resolveToolConcurrency(tools?.concurrency, undefined, ceilings.toolConcurrency);
  } catch (error) {
    throw new TypeError(`AgentConfig: ${(error as Error).message}`);
  }
}

/** The same check for `RunOptions`; `stream()` and `resume()` pass `subscribe: true` to accept `SubscribeOptions` keys. */
export function assertRunOptionsShape(options: unknown, subscribe = false): void {
  const value = root(options, "RunOptions");
  if (value) checkKeys(value, "RunOptions", RUN_OPTIONS, subscribe ? SUBSCRIBE_KEYS : []);
}

/** The same check for `SessionOptions`. `store` keeps its removed-field message, checked by the caller first. */
export function assertSessionOptionsShape(options: unknown): void {
  const value = root(options, "SessionOptions");
  if (value) checkKeys(value, "SessionOptions", SESSION_OPTIONS);
}
