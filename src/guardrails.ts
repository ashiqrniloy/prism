import type {
  AgentEvent,
  Guardrail,
  GuardrailAction,
  GuardrailContext,
  GuardrailRecord,
  Guardrails,
  GuardrailStage,
  GuardrailValue,
} from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";

export const MAX_GUARDRAIL_CONCURRENCY = 16;
const MAX_REASON_BYTES = 4 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;

export class GuardrailError extends Error {
  readonly code: string;
  readonly record: GuardrailRecord;

  constructor(record: GuardrailRecord) {
    super(record.action === "interrupt" ? "Guardrail interruption is unavailable" : "Guardrail blocked run");
    this.name = "GuardrailError";
    this.code = record.action === "interrupt"
      ? "ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE"
      : "ERR_PRISM_GUARDRAIL_BLOCKED";
    this.record = record;
  }
}

export interface RunGuardrailsOptions<S extends GuardrailStage> {
  readonly stage: S;
  readonly guardrails?: Guardrails;
  readonly value: GuardrailValue<S>;
  readonly context: Omit<GuardrailContext<S>, "stage" | "value" | "signal"> & { readonly signal?: AbortSignal };
  readonly redactor?: SecretRedactor;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
}

export interface GuardrailRunResult {
  readonly records: readonly GuardrailRecord[];
  readonly terminal?: GuardrailRecord;
}

/** Evaluate one typed stage. Default is declaration-order sequential; bounded parallel mode still reports declaration order. */
export async function runGuardrails<S extends GuardrailStage>(options: RunGuardrailsOptions<S>): Promise<GuardrailRunResult> {
  const guards = stageGuards(options.guardrails, options.stage);
  if (guards.length === 0) return { records: [] };
  const maxConcurrency = resolveConcurrency(options.guardrails?.maxConcurrency);
  const controller = new AbortController();
  const signal = options.context.signal
    ? AbortSignal.any([options.context.signal, controller.signal])
    : controller.signal;
  const records: (GuardrailRecord | undefined)[] = new Array(guards.length);
  let next = 0;
  let stopped = false;

  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const index = next++;
      if (index >= guards.length) return;
      const record = await evaluate(guards[index]!, options, signal);
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
      type: "guardrail_decision",
      sessionId: options.context.sessionId,
      runId: options.context.runId,
      toolCallId: options.context.toolCallId,
      toolName: options.context.toolName,
      record,
    });
  }
  return { records: normalized, terminal: normalized.find((record) => record.action !== "allow") };
}

export function assertGuardrailsAllowed(result: GuardrailRunResult): void {
  if (result.terminal) throw new GuardrailError(result.terminal);
}

function stageGuards<S extends GuardrailStage>(guardrails: Guardrails | undefined, stage: S): readonly Guardrail<S>[] {
  if (!guardrails) return [];
  switch (stage) {
    case "input": return (guardrails.input ?? []) as readonly Guardrail<S>[];
    case "output": return (guardrails.output ?? []) as readonly Guardrail<S>[];
    case "tool_input": return (guardrails.toolInput ?? []) as readonly Guardrail<S>[];
    case "tool_output": return (guardrails.toolOutput ?? []) as readonly Guardrail<S>[];
  }
}

async function evaluate<S extends GuardrailStage>(
  guardrail: Guardrail<S>,
  options: RunGuardrailsOptions<S>,
  signal: AbortSignal,
): Promise<GuardrailRecord> {
  if (!guardrail || typeof guardrail.name !== "string" || !guardrail.name || guardrail.name.length > 128 || guardrail.stage !== options.stage || typeof guardrail.evaluate !== "function") {
    return record(guardrail?.name ?? "invalid", options.stage, "tripwire", "guardrail_invalid", undefined, options.redactor);
  }
  try {
    const decision = await guardrail.evaluate({ ...options.context, stage: options.stage, value: options.value, signal });
    if (!decision || !isAction(decision.action)) {
      return record(guardrail.name, options.stage, "tripwire", "guardrail_invalid_decision", undefined, options.redactor);
    }
    return record(guardrail.name, options.stage, decision.action, decision.reason, decision.metadata, options.redactor);
  } catch {
    return record(guardrail.name, options.stage, "tripwire", "guardrail_failed", undefined, options.redactor);
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : undefined;
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
