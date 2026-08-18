import { randomUUID } from "node:crypto";
import {
  type AgentIdentity,
  assertIdentityActive,
  type LeaseRecord,
  type LeaseStore,
  type OwnershipScope,
  type SecretRedactor,
} from "@arnilo/prism";
import { WorkflowDefinitionError, WorkflowRuntimeError } from "./errors.js";
import { DEFAULT_MAX_CHECKPOINT_BYTES, HARD_MAX_CHECKPOINT_BYTES } from "./limits.js";
import type { WorkflowCheckpointAdapter, WorkflowCheckpointRecord, WorkflowCheckpointValue } from "./types.js";
import { combineSignals, errorCode, errorMessage, nowIso, sleep, stableStringify, utf8ByteLength } from "./util.js";

const SAGA_NAMESPACE = "prism.workflow.saga";
const SAGA_SCHEMA_VERSION = 1 as const;
const DEFAULT_LEASE_TTL_MS = 30_000;
const HARD_LEASE_TTL_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 10;
const MAX_SAGA_STEPS = 100;
const MAX_ID_BYTES = 256;
const MAX_REVISION_BYTES = 256;
const MAX_REASON_BYTES = 2 * 1024;
const MAX_ERROR_BYTES = 2 * 1024;
const SAGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const AUDIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

type SagaStatus = "running" | "compensating" | "completed" | "compensated" | "manual_intervention";
type SagaStepStatus = "pending" | "running" | "succeeded" | "failed" | "unknown";
type SagaCompensationStatus = "pending" | "running" | "succeeded" | "unknown";
type SagaPhase = "forward" | "compensation";
type SagaReconcileStatus = "succeeded" | "failed" | "unknown";

interface SagaForwardContext {
  readonly sagaId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly operationId: string;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

interface SagaCompensationContext extends SagaForwardContext {
  readonly output: unknown;
}

interface SagaReconcileContext extends SagaCompensationContext {
  readonly phase: SagaPhase;
}

interface SagaReconcileResult {
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

interface SagaEvent {
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

interface SagaRunOptions {
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

interface SagaManualResolutionInput {
  readonly status: "completed" | "compensated";
  readonly expectedVersion: number;
  readonly reason: string;
  readonly auditRef: string;
  readonly actor: AgentIdentity;
}

interface SagaResumeOptions extends SagaRunOptions {
  readonly runId: string;
  readonly manualResolution?: SagaManualResolutionInput;
}

interface SagaManualResolutionRecord {
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

interface SagaErrorRecord {
  readonly message: string;
  readonly code?: string | number;
}

interface SagaStepRecord {
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

interface SagaCheckpointValue {
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

interface SagaCheckpoint {
  readonly value: SagaCheckpointValue;
  readonly version: number;
}

interface NormalizedOptions {
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

interface LeaseGuard {
  readonly signal: AbortSignal;
  readonly lease: LeaseRecord;
  readonly assertOwned: () => void;
  stop(): Promise<void>;
}

interface Runtime {
  readonly definition: SagaDefinition;
  readonly options: NormalizedOptions;
  readonly key: string;
  readonly guard: LeaseGuard;
  state: SagaCheckpointValue;
  version: number;
}

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

async function driveSaga(runtime: Runtime): Promise<SagaRunResult> {
  while (true) {
    runtime.guard.assertOwned();
    if (runtime.state.status === "manual_intervention" || isTerminal(runtime.state)) {
      return toResult({ value: runtime.state, version: runtime.version });
    }
    if (runtime.state.status === "running") {
      if (runtime.state.nextStepIndex >= runtime.definition.steps.length) {
        await persist(runtime, { ...runtime.state, status: "completed" }, undefined, "forward");
        continue;
      }
      const step = runtime.definition.steps[runtime.state.nextStepIndex];
      const record = runtime.state.steps[step.id];
      if (!record) throw new WorkflowRuntimeError(`Missing saga step record "${step.id}"`, "ERR_PRISM_SAGA_STATE");
      if (record.status === "succeeded") {
        await persist(runtime, { ...runtime.state, nextStepIndex: runtime.state.nextStepIndex + 1 }, step.id, "forward");
        continue;
      }
      if (record.status === "running") {
        await persist(
          runtime,
          updateStep(runtime.state, step.id, { status: "unknown", error: { message: "Forward step was interrupted before commit" } }),
          step.id,
          "forward",
        );
        continue;
      }
      if (record.status === "unknown") {
        await reconcileForward(runtime, step);
        continue;
      }
      if (record.status === "failed") {
        await beginCompensation(runtime, record.error);
        continue;
      }
      await attemptForward(runtime, step);
      continue;
    }
    if (runtime.state.status === "compensating") {
      if (runtime.state.compensationCursor < 0) {
        await persist(runtime, { ...runtime.state, status: "compensated" }, undefined, "compensation");
        continue;
      }
      const stepId = runtime.state.completedStepIds[runtime.state.compensationCursor];
      const step = runtime.definition.steps.find((candidate) => candidate.id === stepId);
      const record = step ? runtime.state.steps[step.id] : undefined;
      if (!step || !record) {
        await enterManual(runtime, undefined, "compensation", {
          message: "Compensation cursor references an unknown completed step",
        });
        continue;
      }
      if (record.compensationStatus === "succeeded") {
        await persist(runtime, { ...runtime.state, compensationCursor: runtime.state.compensationCursor - 1 }, step.id, "compensation");
        continue;
      }
      if (record.compensationStatus === "running") {
        await persist(
          runtime,
          updateStep(runtime.state, step.id, {
            compensationStatus: "unknown",
            error: { message: "Compensation was interrupted before commit" },
          }),
          step.id,
          "compensation",
        );
        continue;
      }
      if (record.compensationStatus === "unknown") {
        await reconcileCompensation(runtime, step);
        continue;
      }
      await attemptCompensation(runtime, step);
      continue;
    }
    throw new WorkflowRuntimeError(`Unsupported saga status ${runtime.state.status}`, "ERR_PRISM_SAGA_STATE");
  }
}

async function attemptForward(runtime: Runtime, step: SagaStep): Promise<void> {
  const current = runtime.state.steps[step.id]!;
  if (current.attempts >= runtime.options.maxAttempts) {
    await beginCompensation(runtime, current.error ?? { message: "Forward attempts exhausted" });
    return;
  }
  const nextRecord: SagaStepRecord = {
    ...current,
    status: "running",
    attempts: current.attempts + 1,
    error: undefined,
  };
  await persist(runtime, updateStep(runtime.state, step.id, nextRecord), step.id, "forward");
  try {
    const output = await step.run(forwardContext(runtime, current.operationId));
    runtime.guard.assertOwned();
    const safeOutput = boundedJson(output, runtime.options, `Saga step ${step.id} output`);
    const completed = runtime.state.completedStepIds.includes(step.id)
      ? runtime.state.completedStepIds
      : [...runtime.state.completedStepIds, step.id];
    await persist(
      runtime,
      updateStep(
        {
          ...runtime.state,
          nextStepIndex: runtime.state.nextStepIndex + 1,
          completedStepIds: completed,
        },
        step.id,
        { status: "succeeded", output: safeOutput, error: undefined },
      ),
      step.id,
      "forward",
    );
  } catch (error) {
    runtime.guard.assertOwned();
    const snapshot = errorSnapshot(error, runtime.options);
    if (isUnknownError(error)) {
      await persist(runtime, updateStep(runtime.state, step.id, { status: "unknown", error: snapshot }), step.id, "forward");
      return;
    }
    if (current.attempts < runtime.options.maxAttempts) {
      await persist(runtime, updateStep(runtime.state, step.id, { status: "pending", error: snapshot }), step.id, "forward");
      return;
    }
    await persist(
      runtime,
      updateStep(
        {
          ...runtime.state,
          status: "compensating",
          compensationCursor: runtime.state.completedStepIds.length - 1,
          lastError: snapshot,
        },
        step.id,
        { status: "failed", error: snapshot },
      ),
      step.id,
      "forward",
    );
  }
}

async function reconcileForward(runtime: Runtime, step: SagaStep): Promise<void> {
  const current = runtime.state.steps[step.id]!;
  if (current.reconcileAttempts >= runtime.options.maxAttempts) {
    await enterManual(runtime, step.id, "forward", current.error ?? { message: "Forward outcome could not be reconciled" });
    return;
  }
  const nextRecord: SagaStepRecord = {
    ...current,
    reconcileAttempts: current.reconcileAttempts + 1,
  };
  await persist(runtime, updateStep(runtime.state, step.id, nextRecord), step.id, "forward");
  try {
    const result = normalizeReconcileResult(
      await step.reconcile({
        ...forwardContext(runtime, current.operationId),
        output: current.output,
        phase: "forward",
      }),
    );
    runtime.guard.assertOwned();
    if (result.status === "succeeded") {
      const output =
        result.output === undefined ? current.output : boundedJson(result.output, runtime.options, `Saga step ${step.id} output`);
      const completed = runtime.state.completedStepIds.includes(step.id)
        ? runtime.state.completedStepIds
        : [...runtime.state.completedStepIds, step.id];
      await persist(
        runtime,
        updateStep(
          {
            ...runtime.state,
            nextStepIndex: runtime.state.nextStepIndex + 1,
            completedStepIds: completed,
          },
          step.id,
          { status: "succeeded", output, error: undefined },
        ),
        step.id,
        "forward",
      );
      return;
    }
    if (result.status === "failed") {
      await persist(
        runtime,
        updateStep(
          {
            ...runtime.state,
            status: "compensating",
            compensationCursor: runtime.state.completedStepIds.length - 1,
            lastError: result.error === undefined ? current.error : errorSnapshot(result.error, runtime.options),
          },
          step.id,
          { status: "failed", error: result.error === undefined ? current.error : errorSnapshot(result.error, runtime.options) },
        ),
        step.id,
        "forward",
      );
      return;
    }
    await persist(
      runtime,
      updateStep(runtime.state, step.id, {
        status: "unknown",
        error: result.error === undefined ? current.error : errorSnapshot(result.error, runtime.options),
      }),
      step.id,
      "forward",
    );
  } catch (error) {
    runtime.guard.assertOwned();
    await persist(
      runtime,
      updateStep(runtime.state, step.id, { status: "unknown", error: errorSnapshot(error, runtime.options) }),
      step.id,
      "forward",
    );
  }
}

async function beginCompensation(runtime: Runtime, error?: SagaErrorRecord): Promise<void> {
  await persist(
    runtime,
    {
      ...runtime.state,
      status: "compensating",
      compensationCursor: runtime.state.completedStepIds.length - 1,
      ...(error === undefined ? {} : { lastError: error }),
    },
    undefined,
    "compensation",
  );
}

async function attemptCompensation(runtime: Runtime, step: SagaStep): Promise<void> {
  const current = runtime.state.steps[step.id]!;
  if (current.compensationAttempts >= runtime.options.maxAttempts) {
    await enterManual(runtime, step.id, "compensation", current.error ?? { message: "Compensation attempts exhausted" });
    return;
  }
  const nextRecord: SagaStepRecord = {
    ...current,
    compensationStatus: "running",
    compensationAttempts: current.compensationAttempts + 1,
    error: undefined,
  };
  await persist(runtime, updateStep(runtime.state, step.id, nextRecord), step.id, "compensation");
  try {
    await step.compensate(compensationContext(runtime, current));
    runtime.guard.assertOwned();
    await persist(
      runtime,
      {
        ...updateStep(runtime.state, step.id, { compensationStatus: "succeeded", error: undefined }),
        compensationCursor: runtime.state.compensationCursor - 1,
      },
      step.id,
      "compensation",
    );
  } catch (error) {
    runtime.guard.assertOwned();
    const snapshot = errorSnapshot(error, runtime.options);
    if (isUnknownError(error)) {
      await persist(
        runtime,
        updateStep(runtime.state, step.id, { compensationStatus: "unknown", error: snapshot }),
        step.id,
        "compensation",
      );
      return;
    }
    if (current.compensationAttempts < runtime.options.maxAttempts) {
      await persist(
        runtime,
        updateStep(runtime.state, step.id, { compensationStatus: "pending", error: snapshot }),
        step.id,
        "compensation",
      );
      return;
    }
    await enterManual(runtime, step.id, "compensation", snapshot);
  }
}

async function reconcileCompensation(runtime: Runtime, step: SagaStep): Promise<void> {
  const current = runtime.state.steps[step.id]!;
  if (current.compensationReconcileAttempts >= runtime.options.maxAttempts) {
    await enterManual(runtime, step.id, "compensation", current.error ?? { message: "Compensation outcome could not be reconciled" });
    return;
  }
  await persist(
    runtime,
    updateStep(runtime.state, step.id, { compensationReconcileAttempts: current.compensationReconcileAttempts + 1 }),
    step.id,
    "compensation",
  );
  try {
    const result = normalizeReconcileResult(
      await step.reconcile({
        ...forwardContext(runtime, current.compensationOperationId),
        output: current.output,
        phase: "compensation",
      }),
    );
    runtime.guard.assertOwned();
    if (result.status === "succeeded") {
      await persist(
        runtime,
        {
          ...updateStep(runtime.state, step.id, { compensationStatus: "succeeded", error: undefined }),
          compensationCursor: runtime.state.compensationCursor - 1,
        },
        step.id,
        "compensation",
      );
      return;
    }
    if (result.status === "failed") {
      await persist(
        runtime,
        updateStep(runtime.state, step.id, {
          compensationStatus: "pending",
          error: result.error === undefined ? current.error : errorSnapshot(result.error, runtime.options),
        }),
        step.id,
        "compensation",
      );
      return;
    }
    await persist(
      runtime,
      updateStep(runtime.state, step.id, {
        compensationStatus: "unknown",
        error: result.error === undefined ? current.error : errorSnapshot(result.error, runtime.options),
      }),
      step.id,
      "compensation",
    );
  } catch (error) {
    runtime.guard.assertOwned();
    await persist(
      runtime,
      updateStep(runtime.state, step.id, { compensationStatus: "unknown", error: errorSnapshot(error, runtime.options) }),
      step.id,
      "compensation",
    );
  }
}

async function enterManual(runtime: Runtime, stepId: string | undefined, phase: SagaPhase, error: SagaErrorRecord): Promise<void> {
  await persist(
    runtime,
    {
      ...runtime.state,
      status: "manual_intervention",
      lastError: error,
    },
    stepId,
    phase,
  );
}

async function applyManualResolution(runtime: Runtime, resolution: SagaManualResolutionInput): Promise<SagaRunResult> {
  runtime.guard.assertOwned();
  if (!Number.isSafeInteger(resolution.expectedVersion) || resolution.expectedVersion !== runtime.version) {
    throw new WorkflowRuntimeError(
      `Manual resolution revision ${resolution.expectedVersion} does not match current checkpoint ${runtime.version}`,
      "ERR_PRISM_SAGA_REVISION",
    );
  }
  assertIdentityActive(resolution.actor, { expectedTenantId: runtime.options.tenantId });
  const reason = boundedText(
    runtime.options.redactor?.redact(resolution.reason) ?? resolution.reason,
    "Manual resolution reason",
    MAX_REASON_BYTES,
  );
  const auditRef = boundedText(resolution.auditRef, "Manual resolution auditRef", MAX_REASON_BYTES);
  if (!AUDIT_REF_PATTERN.test(auditRef)) {
    throw new WorkflowRuntimeError("Manual resolution auditRef has invalid characters", "ERR_PRISM_SAGA_AUDIT_REF");
  }
  const record: SagaManualResolutionRecord = {
    status: resolution.status,
    revision: resolution.expectedVersion,
    reason,
    auditRef,
    actor: {
      tenantId: resolution.actor.tenantId,
      principalKind: boundedText(resolution.actor.principal.kind, "Manual actor kind", MAX_ID_BYTES),
      principalId: boundedText(resolution.actor.principal.id, "Manual actor id", MAX_ID_BYTES),
    },
  };
  let next: SagaCheckpointValue = {
    ...runtime.state,
    status: resolution.status,
    manualResolution: record,
  };
  if (resolution.status === "compensated") {
    const steps: Record<string, SagaStepRecord> = {};
    for (const [id, step] of Object.entries(runtime.state.steps)) {
      steps[id] = runtime.state.completedStepIds.includes(id) ? { ...step, compensationStatus: "succeeded" } : step;
    }
    next = { ...next, steps, compensationCursor: -1 };
  }
  await persist(runtime, next, undefined, "manual");
  return toResult({ value: runtime.state, version: runtime.version });
}

function forwardContext(runtime: Runtime, operationId: string): SagaForwardContext {
  return {
    sagaId: runtime.definition.id,
    runId: runtime.options.runId,
    tenantId: runtime.options.tenantId,
    operationId,
    input: runtime.state.input,
    outputs: outputs(runtime.state),
    signal: runtime.guard.signal,
  };
}

function compensationContext(runtime: Runtime, step: SagaStepRecord): SagaCompensationContext {
  return {
    ...forwardContext(runtime, step.compensationOperationId),
    output: step.output,
  };
}

function outputs(state: SagaCheckpointValue): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const stepId of state.completedStepIds) {
    const output = state.steps[stepId]?.output;
    if (output !== undefined) result[stepId] = output;
  }
  return Object.freeze(result);
}

async function persist(
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

async function saveCheckpoint(
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

async function loadCheckpoint(options: NormalizedOptions, key: string): Promise<SagaCheckpoint | null> {
  const record = await options.checkpoints.load({
    workflowId: storageWorkflowId(key),
    runId: options.runId,
    ownership: options.ownership,
    signal: options.signal,
  });
  if (!record) return null;
  return { value: extractSagaState(record, options), version: record.version };
}

async function writeCheckpoint(
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

function storageWorkflowId(key: string): string {
  return `__prism_saga__/${key}`;
}

function toWorkflowCheckpointValue(value: SagaCheckpointValue, options: NormalizedOptions, workflowId: string): WorkflowCheckpointValue {
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

function extractSagaState(record: WorkflowCheckpointRecord, options: NormalizedOptions, definition?: SagaDefinition): SagaCheckpointValue {
  const metadata = record.value.metadata;
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).sagaState : undefined;
  const state = parseCheckpointValue(raw, definition, options.tenantId, options.runId, definition?.steps.length === 0);
  if (record.fencingToken !== undefined && record.fencingToken !== state.leaseFencingToken) {
    throw new WorkflowRuntimeError("Saga checkpoint fencing metadata mismatch", "ERR_PRISM_SAGA_STATE");
  }
  return state;
}

function parseCheckpointValue(
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

function assertCompatible(value: SagaCheckpointValue, definition: SagaDefinition, tenantId: string, runId: string): void {
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

function updateStep(state: SagaCheckpointValue, id: string, patch: Partial<SagaStepRecord>): SagaCheckpointValue {
  const current = state.steps[id];
  if (!current) throw new WorkflowRuntimeError(`Unknown saga step "${id}"`, "ERR_PRISM_SAGA_STATE");
  return { ...state, steps: { ...state.steps, [id]: { ...current, ...patch } } };
}

function normalizeReconcileResult(result: SagaReconcileStatus | SagaReconcileResult): SagaReconcileResult {
  if (result === "succeeded" || result === "failed" || result === "unknown") return { status: result };
  if (!result || typeof result !== "object" || !isReconcileStatus(result.status)) {
    throw new WorkflowRuntimeError("Saga reconcile handler returned an invalid status", "ERR_PRISM_SAGA_RECONCILE");
  }
  return result;
}

function isUnknownError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { readonly unknown?: unknown; readonly outcome?: unknown; readonly code?: unknown };
  return value.unknown === true || value.outcome === "unknown" || value.code === "ERR_PRISM_SAGA_UNKNOWN";
}

function errorSnapshot(error: unknown, options: NormalizedOptions): SagaErrorRecord {
  const rawMessage = errorMessage(error);
  const message = boundedText(options.redactor?.redact(rawMessage) ?? rawMessage, "Saga error", MAX_ERROR_BYTES);
  const code = errorCode(error);
  return { message, ...(code === undefined ? {} : { code }) };
}

function boundedJson(value: unknown, options: NormalizedOptions, label: string): unknown {
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

function toResult(checkpoint: SagaCheckpoint): SagaRunResult {
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

function isTerminal(value: SagaCheckpointValue): boolean {
  return value.status === "completed" || value.status === "compensated" || value.status === "manual_intervention";
}

function operationId(tenantId: string, sagaId: string, runId: string, stepId: string, phase: "forward" | "compensate"): string {
  return [tenantId, sagaId, runId, stepId, phase].map((value) => encodeURIComponent(value)).join("/");
}

function checkpointKey(tenantId: string, sagaId: string, runId: string): string {
  return [tenantId, sagaId, runId].map((value) => encodeURIComponent(value)).join("/");
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

function isSagaStatus(value: unknown): value is SagaStatus {
  return (
    value === "running" || value === "compensating" || value === "completed" || value === "compensated" || value === "manual_intervention"
  );
}

function isStepStatus(value: unknown): value is SagaStepStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "unknown";
}

function isReconcileStatus(value: unknown): value is SagaReconcileStatus {
  return value === "succeeded" || value === "failed" || value === "unknown";
}

function textId(value: unknown, label: string): string {
  const text = boundedText(value, label, MAX_ID_BYTES);
  if (!SAGA_ID_PATTERN.test(text)) throw new WorkflowDefinitionError(`${label} has invalid characters`);
  return text;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string") throw new WorkflowRuntimeError(`${label} is required`, "ERR_PRISM_SAGA_OPTIONS");
  const text = value.trim();
  if (!text || utf8ByteLength(text) > maxBytes) throw new WorkflowRuntimeError(`${label} is empty or too large`, "ERR_PRISM_SAGA_BOUNDS");
  return text;
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : boundedText(value, label, MAX_ID_BYTES);
}

function positiveBoundedInteger(value: unknown, hardCap: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > hardCap) {
    throw new WorkflowRuntimeError(`${label} must be a positive safe integer at most ${hardCap}`, "ERR_PRISM_SAGA_BOUNDS");
  }
  return value as number;
}
