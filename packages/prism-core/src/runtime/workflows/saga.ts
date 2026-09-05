import { randomUUID } from "node:crypto";
import type { LeaseRecord } from "@arnilo/prism";
import { WorkflowDefinitionError, WorkflowRuntimeError } from "./errors.js";
import { DEFAULT_MAX_CHECKPOINT_BYTES, HARD_MAX_CHECKPOINT_BYTES } from "./limits.js";
import { applyManualResolution, driveSaga } from "./saga-drive.js";
import { assertCompatible, loadCheckpoint, saveCheckpoint } from "./saga-persist.js";
import {
  boundedJson,
  boundedText,
  checkpointKey,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_MAX_ATTEMPTS,
  HARD_LEASE_TTL_MS,
  HARD_MAX_ATTEMPTS,
  isTerminal,
  type LeaseGuard,
  MAX_ID_BYTES,
  MAX_REVISION_BYTES,
  MAX_SAGA_STEPS,
  type NormalizedOptions,
  operationId,
  optionalText,
  positiveBoundedInteger,
  type Runtime,
  SAGA_NAMESPACE,
  SAGA_SCHEMA_VERSION,
  type SagaCheckpointValue,
  type SagaDefinition,
  type SagaResumeOptions,
  type SagaRunOptions,
  type SagaRunResult,
  type SagaStepRecord,
  textId,
  toResult,
} from "./saga-types.js";
import { combineSignals, nowIso, sleep } from "./util.js";

export type { SagaDefinition, SagaRunResult, SagaStep } from "./saga-types.js";

/** Validate and freeze a bounded linear saga definition. */
export function defineSaga(input: SagaDefinition): SagaDefinition {
  if (!input || typeof input !== "object") throw new WorkflowDefinitionError("Saga definition is required");
  const id = textId(input.id, "Saga id");
  const revision = boundedText(input.revision, "Saga revision", MAX_REVISION_BYTES);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new WorkflowDefinitionError("Saga must declare at least one step");
  }
  if (input.steps.length > MAX_SAGA_STEPS) {
    throw new WorkflowDefinitionError(`Saga exceeds max steps (${input.steps.length} > ${MAX_SAGA_STEPS})`);
  }
  const ids = new Set<string>();
  const steps = input.steps.map((step) => {
    if (!step || typeof step !== "object") throw new WorkflowDefinitionError("Saga step is required");
    const stepId = textId(step.id, "Saga step id");
    if (ids.has(stepId)) throw new WorkflowDefinitionError(`Saga contains duplicate step id "${stepId}"`);
    ids.add(stepId);
    if (typeof step.run !== "function") throw new WorkflowDefinitionError(`Saga step "${stepId}" requires run()`);
    if (typeof step.compensate !== "function") {
      throw new WorkflowDefinitionError(`Saga step "${stepId}" requires compensate()`);
    }
    if (typeof step.reconcile !== "function") {
      throw new WorkflowDefinitionError(`Saga step "${stepId}" requires reconcile()`);
    }
    return Object.freeze({ ...step, id: stepId });
  });
  return Object.freeze({ id, revision, steps: Object.freeze(steps) });
}

/** Start a new saga or continue the supplied run id from its durable checkpoint. */
export async function runSaga(definition: SagaDefinition, options: SagaRunOptions): Promise<SagaRunResult> {
  return executeSaga(defineSaga(definition), options, false);
}

/** Resume an existing saga, optionally recording an audited manual resolution. */
export async function resumeSaga(definition: SagaDefinition, options: SagaResumeOptions): Promise<SagaRunResult> {
  return executeSaga(defineSaga(definition), options, true);
}

async function executeSaga(definition: SagaDefinition, inputOptions: SagaRunOptions, requireExisting: boolean): Promise<SagaRunResult> {
  const options = normalizeOptions(inputOptions, requireExisting);
  const key = checkpointKey(options.tenantId, definition.id, options.runId);
  let current = await loadCheckpoint(options, key);
  if (current) assertCompatible(current.value, definition, options.tenantId, options.runId);
  const manualResolution = (inputOptions as SagaResumeOptions).manualResolution;
  if (current && isTerminal(current.value) && manualResolution === undefined) return toResult(current);
  if (manualResolution !== undefined && current?.value.status !== "manual_intervention") {
    throw new WorkflowRuntimeError("Manual resolution requires a saga in manual_intervention", "ERR_PRISM_SAGA_MANUAL_STATE");
  }

  const lease = await options.leases.tryAcquireLease({
    namespace: SAGA_NAMESPACE,
    key,
    ownerId: options.ownerId,
    ttlMs: options.leaseTtlMs,
    ...options.ownership,
    signal: options.signal,
  });
  if (!lease) {
    const observed = await loadCheckpoint(options, key);
    if (observed && isTerminal(observed.value) && manualResolution === undefined) return toResult(observed);
    throw new WorkflowRuntimeError("Saga run is already leased", "ERR_PRISM_SAGA_LEASE_BUSY");
  }

  const guard = createLeaseGuard(options, lease, key);
  try {
    current = await loadCheckpoint(options, key);
    if (current) {
      assertCompatible(current.value, definition, options.tenantId, options.runId);
    } else {
      if (requireExisting) throw new WorkflowRuntimeError("Saga checkpoint does not exist", "ERR_PRISM_SAGA_NOT_FOUND");
      const initial = createInitialCheckpoint(definition, options, lease.fencingToken);
      current = await saveCheckpoint(options, key, initial, 0, guard, lease, undefined, "forward");
    }
    if (isTerminal(current.value) && manualResolution === undefined) return toResult(current);
    const runtime: Runtime = {
      definition,
      options,
      key,
      guard,
      state: current.value,
      version: current.version,
    };
    if (manualResolution !== undefined) {
      return await applyManualResolution(runtime, manualResolution);
    }
    return await driveSaga(runtime);
  } finally {
    await guard.stop();
    await options.leases.releaseLease({
      namespace: SAGA_NAMESPACE,
      key,
      ownerId: options.ownerId,
      token: lease.token,
      ...options.ownership,
    });
  }
}

function normalizeOptions(input: SagaRunOptions, requireExisting: boolean): NormalizedOptions {
  if (!input || typeof input !== "object") throw new WorkflowRuntimeError("Saga options are required");
  if (!input.checkpoints || typeof input.checkpoints.load !== "function" || typeof input.checkpoints.save !== "function") {
    throw new WorkflowRuntimeError("Saga checkpoints are required", "ERR_PRISM_SAGA_OPTIONS");
  }
  if (!input.leases || typeof input.leases.tryAcquireLease !== "function") {
    throw new WorkflowRuntimeError("Saga leases are required", "ERR_PRISM_SAGA_OPTIONS");
  }
  const tenantId = textId(input.tenantId, "Saga tenantId");
  const ownerId = boundedText(input.ownerId, "Saga ownerId", MAX_ID_BYTES);
  const accountId = optionalText(input.accountId, "accountId");
  const userId = optionalText(input.userId, "userId");
  const runId = input.runId === undefined ? `sgr_${randomUUID()}` : textId(input.runId, "Saga runId");
  if (requireExisting && input.runId === undefined) {
    throw new WorkflowRuntimeError("resumeSaga requires runId", "ERR_PRISM_SAGA_OPTIONS");
  }
  const leaseTtlMs = positiveBoundedInteger(input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS, HARD_LEASE_TTL_MS, "leaseTtlMs");
  const maxAttempts = positiveBoundedInteger(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, HARD_MAX_ATTEMPTS, "maxAttempts");
  const maxCheckpointBytes = positiveBoundedInteger(
    input.maxCheckpointBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES,
    HARD_MAX_CHECKPOINT_BYTES,
    "maxCheckpointBytes",
  );
  return {
    checkpoints: input.checkpoints,
    leases: input.leases,
    ownerId,
    tenantId,
    ...(accountId === undefined ? {} : { accountId }),
    ...(userId === undefined ? {} : { userId }),
    input: input.input,
    runId,
    leaseTtlMs,
    maxAttempts,
    maxCheckpointBytes,
    redactor: input.redactor,
    signal: input.signal,
    onEvent: input.onEvent,
    ownership: {
      tenantId,
      ...(accountId === undefined ? {} : { accountId }),
      ...(userId === undefined ? {} : { userId }),
    },
  };
}

function createInitialCheckpoint(definition: SagaDefinition, options: NormalizedOptions, fencingToken: number): SagaCheckpointValue {
  const steps: Record<string, SagaStepRecord> = {};
  for (const step of definition.steps) {
    steps[step.id] = {
      id: step.id,
      status: "pending",
      attempts: 0,
      reconcileAttempts: 0,
      compensationAttempts: 0,
      compensationReconcileAttempts: 0,
      operationId: operationId(options.tenantId, definition.id, options.runId, step.id, "forward"),
      compensationOperationId: operationId(options.tenantId, definition.id, options.runId, step.id, "compensate"),
    };
  }
  const createdAt = nowIso();
  return {
    schemaVersion: SAGA_SCHEMA_VERSION,
    sagaId: definition.id,
    runId: options.runId,
    tenantId: options.tenantId,
    definitionRevision: definition.revision,
    status: "running",
    stepIds: definition.steps.map((step) => step.id),
    nextStepIndex: 0,
    completedStepIds: [],
    compensationCursor: -1,
    steps,
    ...(options.input === undefined ? {} : { input: boundedJson(options.input, options, "Saga input") }),
    createdAt,
    updatedAt: createdAt,
    leaseFencingToken: fencingToken,
  };
}

function createLeaseGuard(options: NormalizedOptions, initialLease: LeaseRecord, key: string): LeaseGuard {
  let lease = initialLease;
  let owned = true;
  let stopped = false;
  let lostError: unknown;
  const stopController = new AbortController();
  const lostController = new AbortController();
  const signal = combineSignals([options.signal, lostController.signal])!;
  const heartbeat = (async () => {
    const intervalMs = Math.max(1, Math.floor(options.leaseTtlMs / 3));
    while (!stopped) {
      try {
        await sleep(intervalMs, stopController.signal);
      } catch {
        break;
      }
      if (stopped) break;
      try {
        const renewed = await options.leases.renewLease({
          namespace: SAGA_NAMESPACE,
          key,
          ownerId: options.ownerId,
          token: lease.token,
          ttlMs: options.leaseTtlMs,
          ...options.ownership,
        });
        if (!renewed) throw new WorkflowRuntimeError("Saga lease lost", "ERR_PRISM_SAGA_LEASE_LOST");
        lease = renewed;
      } catch (error) {
        if (stopped) break;
        owned = false;
        lostError = error;
        lostController.abort(error);
        break;
      }
    }
  })();
  return {
    get lease() {
      return lease;
    },
    signal,
    assertOwned() {
      if (!owned) throw lostError ?? new WorkflowRuntimeError("Saga lease lost", "ERR_PRISM_SAGA_LEASE_LOST");
      if (options.signal?.aborted) throw options.signal.reason ?? new WorkflowRuntimeError("Saga aborted", "ERR_PRISM_SAGA_ABORTED");
    },
    async stop() {
      stopped = true;
      stopController.abort();
      await heartbeat;
    },
  };
}
