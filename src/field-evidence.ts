import type { Guardrail, GuardrailContext, JsonObject, ToolCallContent } from "./contracts.js";

const MAX_REQUIRED_FIELDS = 256;
const MAX_FIELD_PATH_CHARS = 256;
const MAX_EVIDENCE_RECORDS = 4096;
const MAX_EVIDENCE_KEY_CHARS = 512;

/** One authoritative host evidence row: the current value of `path` inside `source` at `revision`. */
export interface FieldEvidenceRecord {
  /** Host ledger / tool-result identity the value lives in. */
  readonly source: string;
  /** Field path inside that source object; matched literally against the claim's `path`. */
  readonly path: string;
  readonly value: unknown;
  /** Source revision/freshness marker; a claim must name the same revision when the host sets one. */
  readonly revision?: string | number;
}

export interface FieldEvidenceContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  /** The tool call's normalized arguments, so the host can resolve evidence per call. */
  readonly arguments: JsonObject;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

/** Supplies per-call host evidence without coupling this primitive to a host ledger or store. */
export type FieldEvidenceSource = (context: FieldEvidenceContext) => readonly FieldEvidenceRecord[];

/** The provenance envelope a proposal-shaped call must place at a required field path. */
export interface FieldProvenanceClaim {
  readonly value: unknown;
  readonly source: string;
  /** Field path inside `source`; matched literally against {@link FieldEvidenceRecord.path}. */
  readonly path: string;
  readonly revision?: string | number;
}

/** Canonicalizes claimed and evidence values before exact comparison (units, currency, case). */
export type FieldEvidenceNormalizer = (value: unknown, field: string) => unknown;

/** Closed rejection reasons; the decision metadata carries the field and this code. */
export type FieldEvidenceViolation =
  | "missing_field"
  | "malformed_claim"
  | "missing_evidence"
  | "unknown_source"
  | "stale_revision"
  | "value_mismatch"
  | "evidence_over_limit";

export interface FieldEvidenceGuardrailOptions {
  /** Only calls to this tool are verified; every other tool call is allowed. */
  readonly toolName: string;
  /** Argument paths that must carry a {@link FieldProvenanceClaim}; 1–256 entries. */
  readonly required: readonly string[];
  /** Host-supplied authoritative evidence for the call. Must be synchronous — no retrieval here. */
  readonly evidence: FieldEvidenceSource;
  /** Defaults to identity; comparison after normalization is exact (`Object.is`). */
  readonly normalize?: FieldEvidenceNormalizer;
}

/**
 * Deterministic tool-input guardrail verifying claimed field provenance on one host-selected tool.
 * It performs no retrieval and grants no authority: it only checks that each required field carries
 * a typed source reference whose revision and normalized value match the host's evidence set.
 * Fail-closed: an absent field, absent evidence, unknown source, revision mismatch, or value
 * mismatch blocks the tool call before dispatch.
 */
export function createFieldEvidenceGuardrail(options: FieldEvidenceGuardrailOptions): Guardrail<"tool_input"> {
  const resolved = resolveOptions(options);
  return {
    name: "field-evidence",
    stage: "tool_input",
    revision: "1",
    evaluate(context) {
      if (context.toolName !== resolved.toolName) return { action: "allow" };
      const args = context.value.arguments;
      const { records, truncated } = resolveEvidence(resolved.evidence, resolved.toolName, context);
      if (truncated) return { action: "block", reason: "field_evidence", metadata: { violation: "evidence_over_limit" } };
      for (const field of resolved.required) {
        const violation = verifyField(field, args, records, resolved.normalize);
        if (violation !== undefined) {
          return { action: "block", reason: "field_evidence", metadata: { field, violation } };
        }
      }
      return { action: "allow" };
    },
  };
}

function resolveOptions(
  options: FieldEvidenceGuardrailOptions,
): Required<Pick<FieldEvidenceGuardrailOptions, "toolName" | "required" | "evidence" | "normalize">> {
  if (!options || typeof options.toolName !== "string" || options.toolName.trim().length === 0) {
    throw new TypeError("Field evidence toolName must be a non-empty string");
  }
  if (!Array.isArray(options.required) || options.required.length === 0 || options.required.length > MAX_REQUIRED_FIELDS) {
    throw new TypeError(`Field evidence required must be 1–${MAX_REQUIRED_FIELDS} field paths`);
  }
  for (const field of options.required) {
    if (typeof field !== "string" || field.trim().length === 0 || field.length > MAX_FIELD_PATH_CHARS) {
      throw new TypeError(`Field evidence required paths must be non-empty strings of at most ${MAX_FIELD_PATH_CHARS} chars`);
    }
  }
  if (typeof options.evidence !== "function") throw new TypeError("Field evidence requires an evidence source function");
  if (options.normalize !== undefined && typeof options.normalize !== "function") {
    throw new TypeError("Field evidence normalize must be a function");
  }
  return {
    toolName: options.toolName,
    required: [...options.required],
    evidence: options.evidence,
    normalize: options.normalize ?? ((value) => value),
  };
}

function resolveEvidence(
  source: FieldEvidenceSource,
  toolName: string,
  context: GuardrailContext<"tool_input">,
): { readonly records: readonly FieldEvidenceRecord[]; readonly truncated: boolean } {
  const value: ToolCallContent = context.value;
  const raw = source({
    sessionId: context.sessionId,
    runId: context.runId,
    toolName,
    ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
    arguments: value.arguments,
    metadata: context.metadata,
    signal: context.signal,
  });
  if (!Array.isArray(raw)) return { records: [], truncated: false };
  const valid = raw.filter(validRecord);
  return { records: valid.slice(0, MAX_EVIDENCE_RECORDS), truncated: valid.length > MAX_EVIDENCE_RECORDS };
}

function validRecord(record: FieldEvidenceRecord): boolean {
  if (!record || typeof record !== "object") return false;
  if (typeof record.source !== "string" || record.source.length === 0 || record.source.length > MAX_EVIDENCE_KEY_CHARS) return false;
  if (typeof record.path !== "string" || record.path.length === 0 || record.path.length > MAX_EVIDENCE_KEY_CHARS) return false;
  if (!Object.hasOwn(record, "value")) return false;
  const revision = record.revision;
  return (
    revision === undefined ||
    (typeof revision === "string" && revision.length > 0) ||
    (typeof revision === "number" && Number.isFinite(revision))
  );
}

function verifyField(
  field: string,
  args: JsonObject,
  records: readonly FieldEvidenceRecord[],
  normalize: FieldEvidenceNormalizer,
): FieldEvidenceViolation | undefined {
  const raw = readPath(args, field);
  if (raw === undefined) return "missing_field";
  const claim = asClaim(raw);
  if (claim === undefined) return "malformed_claim";
  if (records.length === 0) return "missing_evidence";
  const candidates = records.filter((record) => record.source === claim.source && record.path === claim.path);
  if (candidates.length === 0) return "unknown_source";
  const fresh = candidates.filter((record) => record.revision === claim.revision);
  if (fresh.length === 0) return "stale_revision";
  const claimed = normalize(claim.value, field);
  if (fresh.some((record) => Object.is(normalize(record.value, field), claimed))) return undefined;
  return "value_mismatch";
}

function asClaim(raw: unknown): FieldProvenanceClaim | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (!Object.hasOwn(record, "value")) return undefined;
  if (typeof record.source !== "string" || record.source.length === 0) return undefined;
  if (typeof record.path !== "string" || record.path.length === 0) return undefined;
  const revision = record.revision;
  if (
    revision !== undefined &&
    !(typeof revision === "string" && revision.length > 0) &&
    !(typeof revision === "number" && Number.isFinite(revision))
  ) {
    return undefined;
  }
  return { value: record.value, source: record.source, path: record.path, ...(revision === undefined ? {} : { revision }) };
}

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
