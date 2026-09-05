import { assertIdentityActive } from "@arnilo/prism";
import { WorkflowRuntimeError } from "./errors.js";
import { persist } from "./saga-persist.js";
import {
  AUDIT_REF_PATTERN,
  boundedJson,
  boundedText,
  errorSnapshot,
  isTerminal,
  isUnknownError,
  MAX_ID_BYTES,
  MAX_REASON_BYTES,
  normalizeReconcileResult,
  type Runtime,
  type SagaCheckpointValue,
  type SagaCompensationContext,
  type SagaCompensationStatus,
  type SagaErrorRecord,
  type SagaForwardContext,
  type SagaManualResolutionInput,
  type SagaManualResolutionRecord,
  type SagaPhase,
  type SagaRunResult,
  type SagaStep,
  type SagaStepRecord,
  type SagaStepStatus,
  toResult,
  updateStep,
} from "./saga-types.js";

type StepAction = (runtime: Runtime, step: SagaStep, record: SagaStepRecord) => Promise<void>;

const FORWARD: Record<SagaStepStatus, StepAction> = {
  succeeded: async (runtime, step) => {
    await persist(runtime, { ...runtime.state, nextStepIndex: runtime.state.nextStepIndex + 1 }, step.id, "forward");
  },
  running: async (runtime, step) => {
    await persist(
      runtime,
      updateStep(runtime.state, step.id, { status: "unknown", error: { message: "Forward step was interrupted before commit" } }),
      step.id,
      "forward",
    );
  },
  unknown: (runtime, step) => reconcileForward(runtime, step),
  failed: (runtime, _step, record) => beginCompensation(runtime, record.error),
  pending: (runtime, step) => attemptForward(runtime, step),
};

const COMPENSATION: Record<SagaCompensationStatus, StepAction> = {
  succeeded: async (runtime, step) => {
    await persist(runtime, { ...runtime.state, compensationCursor: runtime.state.compensationCursor - 1 }, step.id, "compensation");
  },
  running: async (runtime, step) => {
    await persist(
      runtime,
      updateStep(runtime.state, step.id, {
        compensationStatus: "unknown",
        error: { message: "Compensation was interrupted before commit" },
      }),
      step.id,
      "compensation",
    );
  },
  unknown: (runtime, step) => reconcileCompensation(runtime, step),
  pending: (runtime, step) => attemptCompensation(runtime, step),
};

export async function driveSaga(runtime: Runtime): Promise<SagaRunResult> {
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
      await FORWARD[record.status](runtime, step, record);
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
      await COMPENSATION[record.compensationStatus ?? "pending"](runtime, step, record);
      continue;
    }
    throw new WorkflowRuntimeError(`Unsupported saga status ${runtime.state.status}`, "ERR_PRISM_SAGA_STATE");
  }
}

export async function attemptForward(runtime: Runtime, step: SagaStep): Promise<void> {
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

export async function reconcileForward(runtime: Runtime, step: SagaStep): Promise<void> {
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

export async function beginCompensation(runtime: Runtime, error?: SagaErrorRecord): Promise<void> {
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

export async function attemptCompensation(runtime: Runtime, step: SagaStep): Promise<void> {
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

export async function reconcileCompensation(runtime: Runtime, step: SagaStep): Promise<void> {
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

export async function enterManual(runtime: Runtime, stepId: string | undefined, phase: SagaPhase, error: SagaErrorRecord): Promise<void> {
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

export async function applyManualResolution(runtime: Runtime, resolution: SagaManualResolutionInput): Promise<SagaRunResult> {
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

export function forwardContext(runtime: Runtime, operationId: string): SagaForwardContext {
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

export function compensationContext(runtime: Runtime, step: SagaStepRecord): SagaCompensationContext {
  return {
    ...forwardContext(runtime, step.compensationOperationId),
    output: step.output,
  };
}

export function outputs(state: SagaCheckpointValue): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const stepId of state.completedStepIds) {
    const output = state.steps[stepId]?.output;
    if (output !== undefined) result[stepId] = output;
  }
  return Object.freeze(result);
}
