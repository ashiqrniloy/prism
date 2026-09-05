import type { AgentIdentity, LeaseRecord, LeaseStore, OwnershipScope, SecretRedactor } from "@arnilo/prism";
import { WorkflowDefinitionError, WorkflowRuntimeError } from "./errors.js";
import type { WorkflowCheckpointAdapter } from "./types.js";
import { errorCode, errorMessage, stableStringify, utf8ByteLength } from "./util.js";

export const SAGA_NAMESPACE = "prism.workflow.saga";
export const SAGA_SCHEMA_VERSION = 1 as const;
export const DEFAULT_LEASE_TTL_MS = 30_000;
export const HARD_LEASE_TTL_MS = 300_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const HARD_MAX_ATTEMPTS = 10;
export const MAX_SAGA_STEPS = 100;
export const MAX_ID_BYTES = 256;
export const MAX_REVISION_BYTES = 256;
export const MAX_REASON_BYTES = 2 * 1024;
export const MAX_ERROR_BYTES = 2 * 1024;
export const SAGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const AUDIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export type SagaStatus = "running" | "compensating" | "completed" | "compensated" | "manual_intervention";
export type SagaStepStatus = "pending" | "running" | "succeeded" | "failed" | "unknown";
export type SagaCompensationStatus = "pending" | "running" | "succeeded" | "unknown";
export type SagaPhase = "forward" | "compensation";
export type SagaReconcileStatus = "succeeded" | "failed" | "unknown";

export interface SagaForwardContext {
  readonly sagaId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly operationId: string;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface SagaCompensationContext extends SagaForwardContext {
  readonly output: unknown;
}

export interface SagaReconcileContext extends SagaCompensationContext {
  readonly phase: SagaPhase;
}

export interface SagaReconcileResult {
  readonly status: SagaReconcileStatus;
  readonly output?: unknown;
  readonly error?: unknown;
}

export interface SagaStep {
  readonly id: string;
  readonly run: (context: SagaForwardContext) => unknown | Promise<unknown>;
  readonly compensate: (context: SagaCompensationContext) => unknown | Promise<unknown>;
  readonly reconcile: (
    context: SagaReconcileContext,
  ) => SagaReconcileStatus | SagaReconcileResult | Promise<SagaReconcileStatus | SagaReconcileResult>;
}

export interface SagaDefinition {
  readonly id: string;
  readonly revision: string;
  readonly steps: readonly SagaStep[];
}

export interface SagaEvent {
  readonly type: "saga_transition";
  readonly sagaId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly status: SagaStatus;
  readonly phase: SagaPhase | "manual";
  readonly version: number;
  readonly timestamp: string;
  readonly stepId?: string;
}

export interface SagaRunOptions {
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
  readonly ownerId: string;
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly input?: unknown;
  readonly runId?: string;
  readonly leaseTtlMs?: number;
  readonly maxAttempts?: number;
  readonly maxCheckpointBytes?: number;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: SagaEvent) => void;
}

export interface SagaManualResolutionInput {
  readonly status: "completed" | "compensated";
  readonly expectedVersion: number;
  readonly reason: string;
  readonly auditRef: string;
  readonly actor: AgentIdentity;
}

export interface SagaResumeOptions extends SagaRunOptions {
  readonly runId: string;
  readonly manualResolution?: SagaManualResolutionInput;
}

export interface SagaManualResolutionRecord {
  readonly status: "completed" | "compensated";
  readonly revision: number;
  readonly reason: string;
  readonly auditRef: string;
  readonly actor: {
    readonly tenantId: string;
    readonly principalKind: string;
    readonly principalId: string;
  };
}

export interface SagaRunResult {
  readonly sagaId: string;
  readonly runId: string;
  readonly status: SagaStatus;
  readonly version: number;
  readonly completedStepIds: readonly string[];
  readonly compensatedStepIds: readonly string[];
  readonly manualResolution?: SagaManualResolutionRecord;
}

export interface SagaErrorRecord {
  readonly message: string;
  readonly code?: string | number;
}

export interface SagaStepRecord {
  readonly id: string;
  readonly status: SagaStepStatus;
  readonly attempts: number;
  readonly reconcileAttempts: number;
  readonly compensationStatus?: SagaCompensationStatus;
  readonly compensationAttempts: number;
  readonly compensationReconcileAttempts: number;
  readonly operationId: string;
  readonly compensationOperationId: string;
  readonly output?: unknown;
  readonly error?: SagaErrorRecord;
}

export interface SagaCheckpointValue {
  readonly schemaVersion: typeof SAGA_SCHEMA_VERSION;
  readonly sagaId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly definitionRevision: string;
  readonly status: SagaStatus;
  readonly stepIds: readonly string[];
  readonly nextStepIndex: number;
  readonly completedStepIds: readonly string[];
  readonly compensationCursor: number;
  readonly steps: Readonly<Record<string, SagaStepRecord>>;
  readonly input?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly leaseFencingToken: number;
  readonly lastError?: SagaErrorRecord;
  readonly manualResolution?: SagaManualResolutionRecord;
}

export interface SagaCheckpoint {
  readonly value: SagaCheckpointValue;
  readonly version: number;
}

export interface NormalizedOptions {
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
  readonly ownerId: string;
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly input?: unknown;
  readonly runId: string;
  readonly leaseTtlMs: number;
  readonly maxAttempts: number;
  readonly maxCheckpointBytes: number;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: SagaEvent) => void;
  readonly ownership: OwnershipScope;
}

export interface LeaseGuard {
  readonly signal: AbortSignal;
  readonly lease: LeaseRecord;
  readonly assertOwned: () => void;
  stop(): Promise<void>;
}

export interface Runtime {
  readonly definition: SagaDefinition;
  readonly options: NormalizedOptions;
  readonly key: string;
  readonly guard: LeaseGuard;
  state: SagaCheckpointValue;
  version: number;
}

export function updateStep(state: SagaCheckpointValue, id: string, patch: Partial<SagaStepRecord>): SagaCheckpointValue {
  const current = state.steps[id];
  if (!current) throw new WorkflowRuntimeError(`Unknown saga step "${id}"`, "ERR_PRISM_SAGA_STATE");
  return { ...state, steps: { ...state.steps, [id]: { ...current, ...patch } } };
}

export function normalizeReconcileResult(result: SagaReconcileStatus | SagaReconcileResult): SagaReconcileResult {
  if (result === "succeeded" || result === "failed" || result === "unknown") return { status: result };
  if (!result || typeof result !== "object" || !isReconcileStatus(result.status)) {
    throw new WorkflowRuntimeError("Saga reconcile handler returned an invalid status", "ERR_PRISM_SAGA_RECONCILE");
  }
  return result;
}

export function isUnknownError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { readonly unknown?: unknown; readonly outcome?: unknown; readonly code?: unknown };
  return value.unknown === true || value.outcome === "unknown" || value.code === "ERR_PRISM_SAGA_UNKNOWN";
}

export function errorSnapshot(error: unknown, options: NormalizedOptions): SagaErrorRecord {
  const rawMessage = errorMessage(error);
  const message = boundedText(options.redactor?.redact(rawMessage) ?? rawMessage, "Saga error", MAX_ERROR_BYTES);
  const code = errorCode(error);
  return { message, ...(code === undefined ? {} : { code }) };
}

export function boundedJson(value: unknown, options: NormalizedOptions, label: string): unknown {
  const redacted = options.redactor?.redact(value) ?? value;
  let encoded: string | undefined;
  try {
    encoded = stableStringify(redacted);
  } catch (error) {
    throw new WorkflowRuntimeError(`${label} must be JSON serializable: ${errorMessage(error)}`, "ERR_PRISM_SAGA_BOUNDS");
  }
  if (encoded === undefined) return undefined;
  if (utf8ByteLength(encoded) > options.maxCheckpointBytes) {
    throw new WorkflowRuntimeError(`${label} exceeds maxCheckpointBytes`, "ERR_PRISM_SAGA_BOUNDS");
  }
  try {
    return JSON.parse(encoded) as unknown;
  } catch (error) {
    throw new WorkflowRuntimeError(`${label} must be JSON serializable: ${errorMessage(error)}`, "ERR_PRISM_SAGA_BOUNDS");
  }
}

export function toResult(checkpoint: SagaCheckpoint): SagaRunResult {
  return {
    sagaId: checkpoint.value.sagaId,
    runId: checkpoint.value.runId,
    status: checkpoint.value.status,
    version: checkpoint.version,
    completedStepIds: [...checkpoint.value.completedStepIds],
    compensatedStepIds: checkpoint.value.completedStepIds.filter((id) => checkpoint.value.steps[id]?.compensationStatus === "succeeded"),
    ...(checkpoint.value.manualResolution === undefined ? {} : { manualResolution: checkpoint.value.manualResolution }),
  };
}

export function isTerminal(value: SagaCheckpointValue): boolean {
  return value.status === "completed" || value.status === "compensated" || value.status === "manual_intervention";
}
export function operationId(tenantId: string, sagaId: string, runId: string, stepId: string, phase: "forward" | "compensate"): string {
  return [tenantId, sagaId, runId, stepId, phase].map((value) => encodeURIComponent(value)).join("/");
}

export function checkpointKey(tenantId: string, sagaId: string, runId: string): string {
  return [tenantId, sagaId, runId].map((value) => encodeURIComponent(value)).join("/");
}
export function isSagaStatus(value: unknown): value is SagaStatus {
  return (
    value === "running" || value === "compensating" || value === "completed" || value === "compensated" || value === "manual_intervention"
  );
}

export function isStepStatus(value: unknown): value is SagaStepStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "unknown";
}

export function isReconcileStatus(value: unknown): value is SagaReconcileStatus {
  return value === "succeeded" || value === "failed" || value === "unknown";
}

export function textId(value: unknown, label: string): string {
  const text = boundedText(value, label, MAX_ID_BYTES);
  if (!SAGA_ID_PATTERN.test(text)) throw new WorkflowDefinitionError(`${label} has invalid characters`);
  return text;
}

export function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string") throw new WorkflowRuntimeError(`${label} is required`, "ERR_PRISM_SAGA_OPTIONS");
  const text = value.trim();
  if (!text || utf8ByteLength(text) > maxBytes) throw new WorkflowRuntimeError(`${label} is empty or too large`, "ERR_PRISM_SAGA_BOUNDS");
  return text;
}

export function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : boundedText(value, label, MAX_ID_BYTES);
}

export function positiveBoundedInteger(value: unknown, hardCap: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > hardCap) {
    throw new WorkflowRuntimeError(`${label} must be a positive safe integer at most ${hardCap}`, "ERR_PRISM_SAGA_BOUNDS");
  }
  return value as number;
}
