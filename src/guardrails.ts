/**
 * The generic guardrail stage runner. Plan 159 Task 5 moved the pack compile path and pack
 * definitions to `@arnilo/prism-extensions/guardrail-packs` (and Task 7 moved `field-evidence.ts` to
 * `@arnilo/prism-extensions/governance`), but this runner stays in the kernel: a package passes its own
 * `package` label and calls it through `@arnilo/prism`, so its `guardrail.decision` events are
 * attributed correctly.
 */
import type {
  AgentEvent,
  Guardrail,
  GuardrailAction,
  GuardrailContext,
  GuardrailRecord,
  GuardrailStage,
  GuardrailValue,
  JsonValue,
} from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";

export const MAX_GUARDRAIL_CONCURRENCY = 16;
const MAX_REASON_BYTES = 4 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
/** Bytes allowed for a rule-naming refusal line, so no rule text can grow a model or host message. */
const MAX_GUARDRAIL_REFUSAL_BYTES = 200;

/**
 * Plan 104 T4/T6: the bounded, redacted refusal line for a terminal record that came from a compiled
 * pack rule — `<prefix> by guardrail rule pack:<pack>/<rule>`, plus the pack's own reason when it set
 * one — or `undefined` for any other guardrail, so the caller keeps its own neutral text. Only the
 * compiler writes the `pack`/`rule` metadata, so a host-written guardrail named `pack:…` is never
 * presented as a pack rule. Reasons are redacted where the record is built, pack names are
 * compiler-bounded to 128 bytes (the identity always survives the cap), and a long reason is
 * truncated, so the same derivation serves the tool refusal and decision-time revalidation.
 */
export function guardrailRefusalText(record: GuardrailRecord, prefix = "Blocked"): string | undefined {
  const pack = record.metadata?.pack;
  const rule = record.metadata?.rule;
  if (typeof pack !== "string" || typeof rule !== "string") return undefined;
  const line = `${prefix} by guardrail rule ${record.guardrail}`;
  // The compiler synthesizes `guardrail pack rule <pack>/<rule>` when the rule set no reason; the
  // identity already implies it, so only a real reason is appended.
  const text = record.reason && record.reason !== `guardrail pack rule ${pack}/${rule}` ? `${line}: ${record.reason}` : line;
  return boundText(text, MAX_GUARDRAIL_REFUSAL_BYTES);
}

export class GuardrailError extends Error {
  readonly code: string;
  readonly record: GuardrailRecord;

  constructor(record: GuardrailRecord) {
    super(
      record.action === "interrupt"
        ? `Guardrail interruption is unavailable at stage "${record.stage}"; interrupt suspends only at the input stage of durable runs`
        : "Guardrail blocked run",
    );
    this.name = "GuardrailError";
    this.code = record.action === "interrupt" ? "ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE" : "ERR_PRISM_GUARDRAIL_BLOCKED";
    this.record = record;
  }
}

/** A stage run over an explicit guardrail list (the pack seams). */
export interface RunGuardrailListOptions<S extends GuardrailStage> {
  readonly stage: S;
  readonly guards: readonly Guardrail<S>[];
  readonly value: GuardrailValue<S>;
  readonly context: Omit<GuardrailContext<S>, "stage" | "value" | "signal"> & { readonly signal?: AbortSignal };
  readonly redactor?: SecretRedactor;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
  readonly guardrailsMaxConcurrency?: number;
  /** `package.event.package` for emitted decisions. Defaults to `"kernel"`. */
  readonly package?: string;
}

export interface GuardrailRunResult {
  readonly records: readonly GuardrailRecord[];
  readonly terminal?: GuardrailRecord;
}

/** Evaluate one typed stage over an explicit guardrail list (the pack seams). */
export async function runGuardrailList<S extends GuardrailStage>(options: RunGuardrailListOptions<S>): Promise<GuardrailRunResult> {
  const guards = options.guards;
  if (guards.length === 0) return { records: [] };
  const maxConcurrency = resolveConcurrency(options.guardrailsMaxConcurrency);
  const controller = new AbortController();
  const signal = options.context.signal ? AbortSignal.any([options.context.signal, controller.signal]) : controller.signal;
  const records: (GuardrailRecord | undefined)[] = new Array(guards.length);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const index = next++;
      if (index >= guards.length) return;
      const guard = guards[index];
      if (!guard) return;
      const record = await evaluate(guard, options, signal);
      // A sibling may have reached a terminal decision while this callback was settling.
      if (stopped) return;
      records[index] = record;
      if (record.action !== "allow") {
        stopped = true;
        controller.abort(new GuardrailError(record));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, guards.length) }, worker));

  const normalized = records.filter((record): record is GuardrailRecord => record !== undefined);
  for (const record of normalized) {
    await options.emit?.({
      type: "package.event",
      sessionId: options.context.sessionId,
      runId: options.context.runId,
      package: options.package ?? "kernel",
      name: "guardrail.decision",
      data: {
        ...(options.context.toolCallId === undefined ? {} : { toolCallId: options.context.toolCallId }),
        ...(options.context.toolName === undefined ? {} : { toolName: options.context.toolName }),
        record,
      } as unknown as JsonValue,
    });
  }
  return { records: normalized, terminal: normalized.find((record) => record.action !== "allow") };
}

export function assertGuardrailsAllowed(result: GuardrailRunResult): void {
  if (result.terminal) throw new GuardrailError(result.terminal);
}

async function evaluate<S extends GuardrailStage>(
  guardrail: Guardrail<S>,
  options: RunGuardrailListOptions<S>,
  signal: AbortSignal,
): Promise<GuardrailRecord> {
  if (
    !guardrail ||
    typeof guardrail.name !== "string" ||
    !guardrail.name ||
    guardrail.name.length > 128 ||
    guardrail.stage !== options.stage ||
    typeof guardrail.evaluate !== "function"
  ) {
    return record(guardrail?.name ?? "invalid", options.stage, "tripwire", "guardrail_invalid", undefined, options.redactor);
  }
  try {
    const decision = await guardrail.evaluate({ ...options.context, stage: options.stage, value: options.value, signal });
    if (!decision || !isAction(decision.action)) {
      return record(guardrail.name, options.stage, "tripwire", "guardrail_invalid_decision", undefined, options.redactor);
    }
    return record(guardrail.name, options.stage, decision.action, decision.reason, decision.metadata, options.redactor);
  } catch (error) {
    // Keep the cause diagnosable without leaking internals: message only, bounded and
    // passed through the same redact+bound metadata path as guardrail-provided metadata.
    const message = error instanceof Error ? error.message : String(error);
    const redacted = options.redactor?.redact(message) ?? message;
    return record(
      guardrail.name,
      options.stage,
      "tripwire",
      "guardrail_failed",
      { error: boundText(redacted, MAX_REASON_BYTES) },
      options.redactor,
    );
  }
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_GUARDRAIL_CONCURRENCY) {
    throw new Error(`Guardrail maxConcurrency must be a safe integer from 1 to ${MAX_GUARDRAIL_CONCURRENCY}`);
  }
  return value;
}

function isAction(value: unknown): value is GuardrailAction {
  return value === "allow" || value === "block" || value === "tripwire" || value === "interrupt";
}

function record(
  guardrail: string,
  stage: GuardrailStage,
  action: GuardrailAction,
  reason: unknown,
  metadata: unknown,
  redactor: SecretRedactor | undefined,
): GuardrailRecord {
  return {
    guardrail: boundText(guardrail, 128) || "invalid",
    stage,
    action,
    reason: typeof reason === "string" ? boundText(redactor?.redact(reason) ?? reason, MAX_REASON_BYTES) : undefined,
    metadata: boundedMetadata(metadata, redactor),
  };
}

function boundedMetadata(value: unknown, redactor: SecretRedactor | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const json = JSON.stringify(redactor?.redact(value) ?? value);
    if (!json || byteLength(json) > MAX_METADATA_BYTES) return { truncated: true };
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Readonly<Record<string, unknown>>) : undefined;
  } catch {
    return { invalid: true };
  }
}

function boundText(value: string, limit: number): string {
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= limit ? value : new TextDecoder().decode(bytes.subarray(0, limit));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
