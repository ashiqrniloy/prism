import type { LeaseRecord } from "@arnilo/prism";
import { WorkflowRuntimeError } from "./errors.js";
import {
  boundedJson,
  HARD_MAX_ATTEMPTS,
  isSagaStatus,
  isStepStatus,
  type LeaseGuard,
  MAX_SAGA_STEPS,
  type NormalizedOptions,
  type Runtime,
  SAGA_ID_PATTERN,
  SAGA_SCHEMA_VERSION,
  type SagaCheckpoint,
  type SagaCheckpointValue,
  type SagaDefinition,
  type SagaPhase,
} from "./saga-types.js";
import type { WorkflowCheckpointRecord, WorkflowCheckpointValue } from "./types.js";
import { nowIso } from "./util.js";

export async function persist(
  runtime: Runtime,
  value: SagaCheckpointValue,
  stepId: string | undefined,
  phase: SagaPhase | "manual",
): Promise<void> {
  runtime.guard.assertOwned();
  const nextValue = {
    ...value,
    updatedAt: nowIso(),
    leaseFencingToken: runtime.guard.lease.fencingToken,
  };
  const saved = await writeCheckpoint(runtime.options, runtime.key, nextValue, runtime.version, runtime.guard, runtime.guard.lease);
  runtime.state = extractSagaState(saved, runtime.options, runtime.definition);
  runtime.version = saved.version;
  runtime.options.onEvent?.({
    type: "saga_transition",
    sagaId: runtime.definition.id,
    runId: runtime.options.runId,
    tenantId: runtime.options.tenantId,
    status: runtime.state.status,
    phase,
    version: runtime.version,
    timestamp: saved.updatedAt,
    ...(stepId === undefined ? {} : { stepId }),
  });
}

export async function saveCheckpoint(
  options: NormalizedOptions,
  key: string,
  value: SagaCheckpointValue,
  expectedVersion: number,
  guard: LeaseGuard,
  lease: LeaseRecord,
  stepId: string | undefined,
  phase: SagaPhase | "manual",
): Promise<SagaCheckpoint> {
  guard.assertOwned();
  const saved = await writeCheckpoint(options, key, value, expectedVersion, guard, lease);
  const parsed = extractSagaState(saved, options, { id: value.sagaId, revision: value.definitionRevision, steps: [] });
  options.onEvent?.({
    type: "saga_transition",
    sagaId: value.sagaId,
    runId: value.runId,
    tenantId: options.tenantId,
    status: parsed.status,
    phase,
    version: saved.version,
    timestamp: saved.updatedAt,
    ...(stepId === undefined ? {} : { stepId }),
  });
  return { value: parsed, version: saved.version };
}

export async function loadCheckpoint(options: NormalizedOptions, key: string): Promise<SagaCheckpoint | null> {
  const record = await options.checkpoints.load({
    workflowId: storageWorkflowId(key),
    runId: options.runId,
    ownership: options.ownership,
    signal: options.signal,
  });
  if (!record) return null;
  return { value: extractSagaState(record, options), version: record.version };
}

export async function writeCheckpoint(
  options: NormalizedOptions,
  key: string,
  value: SagaCheckpointValue,
  expectedVersion: number,
  guard: LeaseGuard,
  lease: LeaseRecord,
): Promise<WorkflowCheckpointRecord> {
  guard.assertOwned();
  const nextValue = boundedJson(value, options, "Saga checkpoint") as SagaCheckpointValue;
  await options.checkpoints.save({
    workflowId: storageWorkflowId(key),
    runId: options.runId,
    version: expectedVersion + 1,
    expectedVersion,
    fencingToken: lease.fencingToken,
    ownership: options.ownership,
    value: toWorkflowCheckpointValue(nextValue, options, storageWorkflowId(key)),
    signal: options.signal,
  });
  const saved = await options.checkpoints.load({
    workflowId: storageWorkflowId(key),
    runId: options.runId,
    ownership: options.ownership,
    signal: options.signal,
  });
  if (!saved || saved.version !== expectedVersion + 1) {
    throw new WorkflowRuntimeError("Saga checkpoint disappeared after save", "ERR_PRISM_SAGA_STATE");
  }
  return saved;
}

export function storageWorkflowId(key: string): string {
  return `__prism_saga__/${key}`;
}

export function toWorkflowCheckpointValue(
  value: SagaCheckpointValue,
  options: NormalizedOptions,
  workflowId: string,
): WorkflowCheckpointValue {
  return {
    schemaVersion: 1,
    workflowId,
    runId: value.runId,
    definitionHash: value.definitionRevision,
    status:
      value.status === "completed" || value.status === "compensated"
        ? "succeeded"
        : value.status === "manual_intervention"
          ? "failed"
          : "running",
    readyNodeIds: [],
    completedNodeIds: [...value.completedStepIds],
    nodes: {},
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    redacted: true,
    metadata: { sagaState: boundedJson(value, options, "Saga checkpoint") },
  };
}

export function extractSagaState(
  record: WorkflowCheckpointRecord,
  options: NormalizedOptions,
  definition?: SagaDefinition,
): SagaCheckpointValue {
  const metadata = record.value.metadata;
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).sagaState : undefined;
  const state = parseCheckpointValue(raw, definition, options.tenantId, options.runId, definition?.steps.length === 0);
  if (record.fencingToken !== undefined && record.fencingToken !== state.leaseFencingToken) {
    throw new WorkflowRuntimeError("Saga checkpoint fencing metadata mismatch", "ERR_PRISM_SAGA_STATE");
  }
  return state;
}

export function parseCheckpointValue(
  value: unknown,
  definition: SagaDefinition | undefined,
  tenantId: string,
  runId: string,
  allowEmptyDefinition = false,
): SagaCheckpointValue {
  if (!value || typeof value !== "object") throw new WorkflowRuntimeError("Saga checkpoint is not an object", "ERR_PRISM_SAGA_STATE");
  const record = value as Partial<SagaCheckpointValue>;
  if (record.schemaVersion !== SAGA_SCHEMA_VERSION) {
    throw new WorkflowRuntimeError("Unsupported saga checkpoint schema", "ERR_PRISM_SAGA_SCHEMA");
  }
  if (record.tenantId !== tenantId || record.runId !== runId || typeof record.sagaId !== "string") {
    throw new WorkflowRuntimeError("Saga checkpoint ownership or identity mismatch", "ERR_PRISM_SAGA_STATE");
  }
  if (!isSagaStatus(record.status) || !Array.isArray(record.stepIds) || !Array.isArray(record.completedStepIds)) {
    throw new WorkflowRuntimeError("Malformed saga checkpoint state", "ERR_PRISM_SAGA_STATE");
  }
  if (!Number.isSafeInteger(record.nextStepIndex) || record.nextStepIndex! < 0 || record.nextStepIndex! > MAX_SAGA_STEPS) {
    throw new WorkflowRuntimeError("Malformed saga checkpoint cursor", "ERR_PRISM_SAGA_STATE");
  }
  if (!Number.isSafeInteger(record.compensationCursor) || record.compensationCursor! < -1 || record.compensationCursor! >= MAX_SAGA_STEPS) {
    throw new WorkflowRuntimeError("Malformed saga compensation cursor", "ERR_PRISM_SAGA_STATE");
  }
  if (!record.steps || typeof record.steps !== "object") {
    throw new WorkflowRuntimeError("Malformed saga step ledger", "ERR_PRISM_SAGA_STATE");
  }
  if (record.stepIds.length === 0 || record.stepIds.length > MAX_SAGA_STEPS || record.completedStepIds.length > record.stepIds.length) {
    throw new WorkflowRuntimeError("Malformed saga step bounds", "ERR_PRISM_SAGA_STATE");
  }
  if (definition && !allowEmptyDefinition) assertCompatible(record as SagaCheckpointValue, definition, tenantId, runId);
  for (const id of record.stepIds) {
    if (typeof id !== "string" || !SAGA_ID_PATTERN.test(id))
      throw new WorkflowRuntimeError("Malformed saga step id", "ERR_PRISM_SAGA_STATE");
    const step = record.steps[id];
    if (!step || step.id !== id || !isStepStatus(step.status))
      throw new WorkflowRuntimeError("Malformed saga step record", "ERR_PRISM_SAGA_STATE");
    if (
      !Number.isSafeInteger(step.attempts) ||
      !Number.isSafeInteger(step.reconcileAttempts) ||
      !Number.isSafeInteger(step.compensationAttempts) ||
      !Number.isSafeInteger(step.compensationReconcileAttempts) ||
      step.attempts < 0 ||
      step.reconcileAttempts < 0 ||
      step.compensationAttempts < 0 ||
      step.compensationReconcileAttempts < 0 ||
      step.attempts > HARD_MAX_ATTEMPTS ||
      step.reconcileAttempts > HARD_MAX_ATTEMPTS ||
      step.compensationAttempts > HARD_MAX_ATTEMPTS ||
      step.compensationReconcileAttempts > HARD_MAX_ATTEMPTS
    ) {
      throw new WorkflowRuntimeError("Malformed saga attempt counters", "ERR_PRISM_SAGA_STATE");
    }
  }
  if (!allowEmptyDefinition && definition && record.stepIds.length !== definition.steps.length) {
    throw new WorkflowRuntimeError("Saga checkpoint step count does not match definition", "ERR_PRISM_SAGA_REVISION");
  }
  return record as SagaCheckpointValue;
}

export function assertCompatible(value: SagaCheckpointValue, definition: SagaDefinition, tenantId: string, runId: string): void {
  if (value.sagaId !== definition.id || value.runId !== runId || value.tenantId !== tenantId) {
    throw new WorkflowRuntimeError("Saga checkpoint identity mismatch", "ERR_PRISM_SAGA_STATE");
  }
  if (value.definitionRevision !== definition.revision) {
    throw new WorkflowRuntimeError("Saga definition revision does not match checkpoint", "ERR_PRISM_SAGA_REVISION");
  }
  if (value.stepIds.length !== definition.steps.length || value.stepIds.some((id, index) => id !== definition.steps[index]?.id)) {
    throw new WorkflowRuntimeError("Saga definition steps do not match checkpoint", "ERR_PRISM_SAGA_REVISION");
  }
}
