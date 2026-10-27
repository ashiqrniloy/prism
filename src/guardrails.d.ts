/**
 * The generic guardrail stage runner. Plan 159 Task 5 moved the pack compile path and pack
 * definitions to `@arnilo/prism-guardrail-packs` (and Task 7 moved `field-evidence.ts` to
 * `@arnilo/prism-governance`), but this runner stays in the kernel: a package passes its own
 * `package` label and calls it through `@arnilo/prism`, so its `guardrail.decision` events are
 * attributed correctly.
 */
import type { AgentEvent, Guardrail, GuardrailContext, GuardrailRecord, GuardrailStage, GuardrailValue } from "./contracts.js";
import type { SecretRedactor } from "./redaction.js";
export declare const MAX_GUARDRAIL_CONCURRENCY = 16;
/**
 * Plan 104 T4/T6: the bounded, redacted refusal line for a terminal record that came from a compiled
 * pack rule — `<prefix> by guardrail rule pack:<pack>/<rule>`, plus the pack's own reason when it set
 * one — or `undefined` for any other guardrail, so the caller keeps its own neutral text. Only the
 * compiler writes the `pack`/`rule` metadata, so a host-written guardrail named `pack:…` is never
 * presented as a pack rule. Reasons are redacted where the record is built, pack names are
 * compiler-bounded to 128 bytes (the identity always survives the cap), and a long reason is
 * truncated, so the same derivation serves the tool refusal and decision-time revalidation.
 */
export declare function guardrailRefusalText(record: GuardrailRecord, prefix?: string): string | undefined;
export declare class GuardrailError extends Error {
    readonly code: string;
    readonly record: GuardrailRecord;
    constructor(record: GuardrailRecord);
}
/** A stage run over an explicit guardrail list (the pack seams). */
export interface RunGuardrailListOptions<S extends GuardrailStage> {
    readonly stage: S;
    readonly guards: readonly Guardrail<S>[];
    readonly value: GuardrailValue<S>;
    readonly context: Omit<GuardrailContext<S>, "stage" | "value" | "signal"> & {
        readonly signal?: AbortSignal;
    };
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
export declare function runGuardrailList<S extends GuardrailStage>(options: RunGuardrailListOptions<S>): Promise<GuardrailRunResult>;
export declare function assertGuardrailsAllowed(result: GuardrailRunResult): void;
