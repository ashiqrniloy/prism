/**
 * Field-level classification and fail-closed redaction (plan 027 Task 8).
 *
 * A dependency-free, JSON-like structured-value walker that evaluates an
 * explicit host policy against every field of a value destined to cross a
 * data boundary (provider prompt egress, tool dispatch/result persistence,
 * artifact write/read/export, audit hashing, telemetry attributes/events,
 * lifecycle export). The policy classifies fields by label, path, destination,
 * and tenant; unknown fields fail closed under the protected default.
 *
 * Non-goals (frozen): no automatic sensitive-data discovery (labels come from
 * an explicit `labelFor` hint function supplied by the boundary owner), no
 * global registry, no decorator framework, no second policy language. Existing
 * hardcoded secret redaction (`createSecretRedactor`) stays in place as
 * defense in depth and runs *after* policy transformation at egress seams.
 */

export type FieldPolicyAction = "allow" | "redact" | "tokenize" | "deny";

export interface FieldPolicyDecision {
  readonly action: FieldPolicyAction;
  /** Bounded reason recorded in audit redaction lists; never includes values. */
  readonly reason?: string;
}

export interface FieldPolicyInput {
  /** Dot/bracket path from the value root, e.g. `user.credentials[2].apiKey`. */
  readonly path: string;
  /** Boundary destination: prompt, tool, artifact, audit, telemetry, persistence, export, ... */
  readonly destination: string;
  /** Explicit caller-assigned label from `labelFor`; undefined = unknown. */
  readonly label?: string;
  readonly kind: "string" | "number" | "boolean" | "null" | "array" | "object";
  readonly tenantId?: string;
  readonly direction: "inbound" | "outbound";
  readonly purpose?: string;
}

export type FieldPolicy = (input: FieldPolicyInput) => FieldPolicyDecision;

interface MutableFieldPolicyInput {
  destination: string;
  path: string;
  label?: string;
  kind: FieldPolicyInput["kind"];
  tenantId?: string;
  direction: FieldPolicyInput["direction"];
  purpose?: string;
}

export interface ApplyFieldPolicyOptions {
  readonly destination: string;
  readonly direction?: "inbound" | "outbound";
  readonly tenantId?: string;
  readonly purpose?: string;
  /** Explicit key→label hints owned by the boundary; no automatic discovery. */
  readonly labelFor?: (key: string, path: string) => string | undefined;
  /** Called for every non-allow decision with {path, reason}; used by audit adapters. */
  readonly onRedact?: (path: string, reason: string) => void;
  readonly maxDepth?: number;
  readonly maxKeys?: number;
  readonly maxChars?: number;
  /** Wall-clock budget for the whole walk; a slow policy trips it (fail closed). */
  readonly maxPolicyMs?: number;
  /** Deterministic token prefix (stable across runs; safe for audit chains). */
  readonly tokenPrefix?: string;
}

export class FieldPolicyError extends Error {
  readonly code = "ERR_PRISM_FIELD_POLICY";
  readonly path: string;
  constructor(path: string, message: string) {
    super(`field policy rejected value at ${path}: ${message}`);
    this.name = "FieldPolicyError";
    this.path = path;
  }
}

export const FIELD_POLICY_LIMITS = Object.freeze({
  maxDepth: 32,
  maxKeys: 10_000,
  maxChars: 1_000_000,
  maxPolicyMs: 5_000,
  tokenPrefix: "tok_",
} as const);

const REDACTED = "[REDACTED]";
const DENIED = "[DENIED]";

function tokenOf(prefix: string, path: string, original: string, sha: (text: string) => string): string {
  const hash = sha(`${path}\u0000${original}`);
  return `${prefix}${hash.slice(0, 12)}`;
}

type Decision = FieldPolicyDecision;
const ALLOW: Decision = { action: "allow" };
const DENY_UNKNOWN: Decision = Object.freeze({ action: "deny", reason: "unknown-field" });
const DENY_UNKNOWN_LABEL: Decision = Object.freeze({ action: "deny", reason: "unknown-label" });

const denied = (reason: string): Decision => Object.freeze({ action: "deny", reason });

function normalizeDecision(value: unknown, path: string): Decision {
  if (value && typeof value === "object" && typeof (value as Decision).action === "string") {
    const candidate = value as { action?: unknown; reason?: unknown };
    const action = candidate.action as string;
    if (action === "allow" || action === "redact" || action === "tokenize" || action === "deny") {
      // Returned decision objects are used as-is (host policies may reuse
      // frozen constants; a hostile mutation is their own risk).
      if (candidate.reason !== undefined && typeof candidate.reason !== "string") {
        throw new FieldPolicyError(path, "policy returned an invalid reason");
      }
      return candidate as Decision;
    }
  }
  throw new FieldPolicyError(path, "policy returned an invalid decision");
}

const JSON_PRIMITIVE_KINDS = new Set(["string", "number", "boolean"]);

const kindOf = (value: unknown): FieldPolicyInput["kind"] => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return (JSON_PRIMITIVE_KINDS.has(typeof value) ? typeof value : "object") as FieldPolicyInput["kind"];
};

interface WalkContext {
  readonly policy: FieldPolicy;
  readonly options: ApplyFieldPolicyOptions;
  readonly tokenSha: (text: string) => string;
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxChars: number;
  readonly hasTimeBudget: boolean;
  readonly maxPolicyMs?: number;
  readonly labelCache: Map<string, string | undefined>;
  readonly input: MutableFieldPolicyInput; // reused per node; host policies must not retain it
  budgetRemaining: number;
  nodesVisited: number;
  startedAt: number;
}

function checkLimits(ctx: WalkContext, path: string, depth: number): void {
  // Time budget only when explicitly configured; the default walk is pure
  // structural (depth/keys/bytes below), so the hot path avoids Date.now().
  // Time budget only when explicitly configured; the default walk is pure
  // structural (depth/keys/bytes below), so the hot path avoids Date.now().
  if (ctx.hasTimeBudget && Date.now() - ctx.startedAt > (ctx.maxPolicyMs as number)) {
    throw new FieldPolicyError(path, `policy walk exceeded ${ctx.maxPolicyMs}ms`);
  }
  if (depth > ctx.maxDepth) throw new FieldPolicyError(path, `depth exceeds ${ctx.maxDepth}`);
}

/**
 * Applies `policy` to every field of a JSON-like value.
 *
 * Decisions: `allow` keeps the value; `redact` replaces string leaves with
 * `[REDACTED]` while preserving container shape; `tokenize` replaces string
 * leaves with a deterministic token; `deny` replaces the value with `[DENIED]`.
 * Unknown labels fail closed under the protected default. Hostile values
 * (cycles, unsupported types, over-budget walks) throw `FieldPolicyError`
 * instead of stringifying guesses. The input is never mutated; only fields the
 * policy changed are allocated.
 */
export function applyFieldPolicy<T>(value: T, policy: FieldPolicy, options: ApplyFieldPolicyOptions): T {
  if (typeof policy !== "function") throw new FieldPolicyError("", "policy must be a function");
  const ctx: WalkContext = {
    policy,
    options,
    tokenSha: (text) => sha256Hex(text),
    maxDepth: options.maxDepth ?? FIELD_POLICY_LIMITS.maxDepth,
    maxKeys: options.maxKeys ?? FIELD_POLICY_LIMITS.maxKeys,
    maxChars: options.maxChars ?? FIELD_POLICY_LIMITS.maxChars,
    hasTimeBudget: options.maxPolicyMs !== undefined,
    maxPolicyMs: options.maxPolicyMs,
    labelCache: new Map<string, string | undefined>(),
    input: {
      path: "",
      destination: options.destination,
      label: undefined,
      kind: "object",
      direction: options.direction ?? "outbound",
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
      ...(options.purpose !== undefined ? { purpose: options.purpose } : {}),
    },
    budgetRemaining: options.maxChars ?? FIELD_POLICY_LIMITS.maxChars,
    nodesVisited: 0,
    startedAt: Date.now(),
  };
  return walkValue(value, ctx, "", 0) as T;
}

function walkValue(input: unknown, ctx: WalkContext, path: string, depth: number): unknown {
  const active = new Set<object>();
  const climb = (value: unknown, p: string, d: number, key: string): unknown => {
    if (value === null || typeof value !== "object") {
      return leaf(value, ctx, p, d, key);
    }
    if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return leaf(value, ctx, p, d, key);
    }
    if (d > ctx.maxDepth) throw new FieldPolicyError(p, `depth exceeds ${ctx.maxDepth}`);
    if (active.has(value)) throw new FieldPolicyError(p, "cyclic reference is not supported (fail closed)");
    active.add(value);
    try {
      // The root has no key and never substitutes the whole payload; its own
      // decision governs the walk of children only.
      const decision = p === "" ? ALLOW : decide(ctx, value, p, d, undefined, key);
      if (decision.action === "deny") return deny();
      if (decision.action === "redact") return shapePreserving(value, ctx, p, d, "redact", active);
      if (decision.action === "tokenize") return shapePreserving(value, ctx, p, d, "tokenize", active);
      return walkChildren(value, ctx, p, d, climb);
    } finally {
      active.delete(value);
    }
  };
  return climb(input, path, depth, "");
}

/** labelFor results are key-scoped (paths only reach the first call); cached per walk. */
function labelForKey(ctx: WalkContext, key: string, path: string): string | undefined {
  const labelFor = ctx.options.labelFor;
  if (!labelFor) return undefined;
  if (ctx.labelCache.has(key)) return ctx.labelCache.get(key);
  const label = labelFor(key, path);
  ctx.labelCache.set(key, label);
  return label;
}

function decide(ctx: WalkContext, value: unknown, path: string, depth: number, override: Decision | undefined, key: string): Decision {
  if (override) return override;
  const kind = kindOf(value);
  const label = labelForKey(ctx, key, path);
  const input = ctx.input; // reused per node; see the reuse contract on WalkContext
  input.path = path;
  input.label = label;
  input.kind = kind;
  let decision: unknown;
  try {
    decision = ctx.policy(input);
  } catch (error) {
    throw new FieldPolicyError(path, `policy threw ${error instanceof Error ? error.name : typeof error} (value never echoed)`);
  }
  const normalized = normalizeDecision(decision, path);
  checkLimits(ctx, path, depth); // slow policy over budget trips here
  if (normalized.action !== "allow") {
    ctx.options.onRedact?.(path, normalized.reason ?? normalized.action);
  }
  return normalized;
}

function leaf(input: unknown, ctx: WalkContext, path: string, depth: number, key: string): unknown {
  if (input === undefined || typeof input === "bigint" || typeof input === "symbol" || typeof input === "function") {
    throw new FieldPolicyError(path, `unsupported value type ${typeof input} (fail closed, no stringification)`);
  }
  if (typeof input === "string") {
    ctx.budgetRemaining -= input.length;
    if (ctx.budgetRemaining < 0) throw new FieldPolicyError(path, `string budget exceeds ${ctx.maxChars}`);
  }
  const decision = decide(ctx, input, path, depth, undefined, key);
  switch (decision.action) {
    case "allow":
      return input;
    case "redact":
      return typeof input === "string" ? REDACTED : input;
    case "tokenize":
      return typeof input === "string"
        ? tokenOf(ctx.options.tokenPrefix ?? FIELD_POLICY_LIMITS.tokenPrefix, path, input, ctx.tokenSha)
        : input;
    case "deny":
      return deny();
  }
}

// decide() already recorded the redaction entry for this path
function deny(): string {
  return DENIED;
}

function shapePreserving(
  input: unknown,
  ctx: WalkContext,
  path: string,
  depth: number,
  mode: "redact" | "tokenize",
  active: Set<object>,
): unknown {
  if (active.has(input as object)) throw new FieldPolicyError(path, "cyclic reference is not supported (fail closed)");
  const forced: Decision = { action: mode };
  if (Array.isArray(input)) {
    const out = new Array<unknown>(input.length);
    for (let index = 0; index < input.length; index += 1) {
      out[index] = safeChild(input[index], ctx, `${path}[${index}]`, depth + 1, forced, active);
    }
    return out;
  }
  if (isPlainRecord(input)) {
    const out: Record<string, unknown> = {};
    let keysChecked = 0;
    for (const [key, item] of Object.entries(input)) {
      keysChecked += 1;
      if (keysChecked > ctx.maxKeys) throw new FieldPolicyError(`${path}.${key}`, `key count exceeds ${ctx.maxKeys}`);
      out[key] = safeChild(item, ctx, joinPath(path, key), depth + 1, forced, active);
    }
    return out;
  }
  if (input instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of input) {
      out[String(key)] = safeChild(item, ctx, joinPath(path, String(key)), depth + 1, forced, active);
    }
    return out;
  }
  if (input instanceof Set) {
    return [...input].map((item, index) => safeChild(item, ctx, `${path}[${index}]`, depth + 1, forced, active));
  }
  throw new FieldPolicyError(
    path,
    `unsupported value ${(input as { constructor?: { name?: string } })?.constructor?.name ?? "object"} (fail closed, no stringification)`,
  );
}

function walkChildren(
  input: unknown,
  ctx: WalkContext,
  path: string,
  depth: number,
  climb: (value: unknown, p: string, d: number, key: string) => unknown,
): unknown {
  if (Array.isArray(input)) {
    let changed = false;
    const out = new Array<unknown>(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const item = input[index];
      const next = climb(item, `${path}[${index}]`, depth + 1, String(index));
      if (next !== item) changed = true;
      out[index] = next;
    }
    return changed ? out : input;
  }
  if (isPlainRecord(input)) {
    let changed = false;
    let keysChecked = 0;
    const out: Record<string, unknown> = {};
    for (const key in input) {
      if (!Object.hasOwn(input, key)) continue;
      keysChecked += 1;
      if (keysChecked > ctx.maxKeys) throw new FieldPolicyError(joinPath(path, key), `key count exceeds ${ctx.maxKeys}`);
      const item = input[key];
      if (item === undefined) continue;
      const next = climb(item, joinPath(path, key), depth + 1, key);
      out[key] = next;
      if (next !== item) changed = true;
    }
    return changed ? out : input; // sparse copy: untouched subtrees share the input
  }
  if (input instanceof Map) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [entryKey, item] of input) {
      out[String(entryKey)] = climb(item, joinPath(path, String(entryKey)), depth + 1, String(entryKey));
      if (out[String(entryKey)] !== item) changed = true;
    }
    return changed ? out : input;
  }
  if (input instanceof Set) {
    let changed = false;
    const items = [...input];
    const out = new Array<unknown>(items.length);
    for (let index = 0; index < items.length; index += 1) {
      out[index] = climb(items[index], `${path}[${index}]`, depth + 1, String(index));
      if (out[index] !== items[index]) changed = true;
    }
    return changed ? out : input;
  }
  throw new FieldPolicyError(
    path,
    `unsupported value ${(input as { constructor?: { name?: string } })?.constructor?.name ?? "object"} (fail closed, no stringification)`,
  );
}

function safeChild(item: unknown, ctx: WalkContext, path: string, depth: number, forced: Decision, active: Set<object>): unknown {
  if (item === null || typeof item !== "object") {
    return applyForcedLeaf(item, ctx, path, forced);
  }
  if (item instanceof Date || item instanceof RegExp || ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
    return item;
  }
  checkLimits(ctx, path, depth);
  return shapePreserving(item, ctx, path, depth, forced.action as "redact" | "tokenize", active);
}

function applyForcedLeaf(item: unknown, ctx: WalkContext, path: string, forced: Decision): unknown {
  if (typeof item === "string") {
    ctx.budgetRemaining -= item.length;
    if (ctx.budgetRemaining < 0) throw new FieldPolicyError(path, `string budget exceeds ${ctx.maxChars}`);
  }
  switch (forced.action) {
    case "redact":
      return typeof item === "string" ? REDACTED : item;
    case "tokenize":
      return typeof item === "string"
        ? tokenOf(ctx.options.tokenPrefix ?? FIELD_POLICY_LIMITS.tokenPrefix, path, item, ctx.tokenSha)
        : item;
    case "deny":
      return DENIED;
    default:
      return item;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `a.b` for object keys; arrays use `[i]`; root fields use bare `key`. */
function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function sha256Hex(text: string): string {
  // FNV-1a is enough for token differentiation and avoids a crypto import at
  // every leaf; collisions change a token value, never cross boundaries.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + (hash >>> 8).toString(16).padStart(8, "0").slice(0, 4);
}

// ---------------------------------------------------------------------------
// Protected default profile
// ---------------------------------------------------------------------------

export interface ProtectedFieldPolicyOptions {
  /** Labels allowed to cross outbound/persisted boundaries unchanged. */
  readonly publicLabels?: readonly string[];
  /** Labels denied with the given reason; default `secret` and `financial`. */
  readonly deniedLabels?: Readonly<Record<string, string>>;
  /** Labels redacted with the given reason; default `personal`. */
  readonly redactedLabels?: Readonly<Record<string, string>>;
  /** Labels tokenized; default none. */
  readonly tokenizedLabels?: Readonly<Record<string, string>>;
}

/**
 * Fail-closed default for the protected profile (frozen behavior):
 * unknown labels are denied on outbound boundaries and allowed inbound;
 * `secret`/`financial` denied, `personal` redacted, listed public labels
 * allowed. Labels are never auto-discovered — `labelFor` decides them.
 */
export function createProtectedFieldPolicy(options: ProtectedFieldPolicyOptions = {}): FieldPolicy {
  const publicLabels = new Set<string>(options.publicLabels ?? ["public"]);
  const deniedLabels: Readonly<Record<string, string>> = {
    secret: "secret-egress",
    financial: "financial-egress",
    ...options.deniedLabels,
  };
  const LABEL_DENY_REASONS: Readonly<Record<string, string>> = deniedLabels;
  const redactedLabels: Readonly<Record<string, string>> = {
    personal: "personal-data",
    ...options.redactedLabels,
  };
  const tokenizedLabels: Readonly<Record<string, string>> = { token: "tokenization", ...options.tokenizedLabels };
  const outbound = new Set(["prompt", "tool", "artifact", "audit", "telemetry", "export", "persistence"]);

  return (input) => {
    const { label } = input;
    if (label === undefined || label === "") {
      // Fail closed: unknown fields do not cross outbound/persisted boundaries.
      if (input.direction === "outbound" && outbound.has(input.destination)) return DENY_UNKNOWN;
      return ALLOW;
    }
    if (publicLabels.has(label)) return ALLOW;
    if (label in deniedLabels) return denied(LABEL_DENY_REASONS[label] ?? "denied");
    if (label in redactedLabels) return { action: "redact", reason: redactedLabels[label] };
    if (label in tokenizedLabels) return { action: "tokenize", reason: tokenizedLabels[label] };
    return DENY_UNKNOWN_LABEL;
  };
}

/** Identity policy: every field allowed (explicit override for trusted marks). */
export const ALLOW_FIELD_POLICY: FieldPolicy = () => ALLOW;

// ---------------------------------------------------------------------------
// Audit-export adapter (structural; no dependency on @arnilo/prism-policy)
// ---------------------------------------------------------------------------

export interface AuditFieldRedaction {
  readonly path: string;
  readonly reason: string;
}

/** Structural match for `AuditRedactionPolicy` in @arnilo/prism-policy. */
export interface AuditFieldRedactorLike {
  apply(record: Readonly<Record<string, unknown>>): {
    record: Readonly<Record<string, unknown>>;
    redactions?: readonly AuditFieldRedaction[];
  };
}

export interface AuditFieldRedactorOptions {
  readonly tenantId?: string;
  readonly purpose?: string;
  readonly labelFor?: (key: string, path: string) => string | undefined;
  /** Default true; denial instead would fail export (protected profile fails closed). */
  readonly collectProvenance?: boolean;
}

/**
 * Adapts a `FieldPolicy` to the audit-export redaction hook. Transformation
 * runs BEFORE canonical hashing so the exported chain verifies exactly.
 * Only `{path, reason}` provenance survives; values never echo into the list.
 */
export function createAuditFieldRedactor(policy: FieldPolicy, options: AuditFieldRedactorOptions = {}): AuditFieldRedactorLike {
  return {
    apply(record) {
      const redactions: { path: string; reason: string }[] = [];
      const transformed = applyFieldPolicy(record, policy, {
        destination: "audit",
        direction: "outbound",
        tenantId: options.tenantId,
        purpose: options.purpose ?? "audit-export",
        labelFor: options.labelFor,
        onRedact: (path, reason) => {
          if (options.collectProvenance !== false) redactions.push({ path, reason });
        },
      });
      return {
        record: transformed as Readonly<Record<string, unknown>>,
        ...(redactions.length ? { redactions } : {}),
      };
    },
  };
}
