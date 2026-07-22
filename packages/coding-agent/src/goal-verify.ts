/**
 * Thin goal→verify composition: plan Markdown + named checks + workflow
 * suspend/approve + bounded handoff. Not a second agent/workflow engine.
 */
import type { JsonObject, OwnershipScope, SecretRedactor } from "@arnilo/prism";
import {
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
  suspend,
  type WorkflowCheckpointAdapter,
  type WorkflowEvent,
  type WorkflowResumeValidator,
  type WorkflowRunResult,
} from "@arnilo/prism-workflows";
import {
  CODING_STATE_KEY,
  assertCodingResumeAllowed,
  buildCodingCheckpointMetadata,
  codingCheckpointStatePatch,
  codingPlanPathForTask,
  createCodingPlanMarkdown,
  fingerprintJson,
  parseCodingPlanTodos,
  readCodingCheckpointFromState,
  readCodingPlanFile,
  writeCodingPlanFile,
  type CodingCheckSummary,
  type CodingCheckpointMetadata,
  type CodingFingerprints,
  type CodingHandoffSummary,
  type CodingTodoItem,
} from "./coding-checkpoint.js";
import { DEFAULT_MAX_CHECK_SUMMARY_BYTES, DEFAULT_MAX_PR_HANDOFF_BYTES } from "./limits.js";

export const CODING_GOAL_VERIFY_WORKFLOW_ID = "coding-goal-verify" as const;
export const CODING_GOAL_VERIFY_REVISION = "1" as const;
export const CODING_GOAL_VERIFY_SUSPEND_REASON = "approve-coding-goal-verify" as const;

export class CodingGoalVerifyError extends Error {
  readonly code = "ERR_PRISM_CODING_GOAL_VERIFY";
  constructor(message: string) {
    super(message);
    this.name = "CodingGoalVerifyError";
  }
}

export interface CodingGoalVerifyApproval {
  /** Host validator; required — helper fails closed without it. */
  readonly validateResume: WorkflowResumeValidator;
  readonly reason?: string;
}

export interface RunCodingGoalVerifyOptions {
  readonly goal: string;
  readonly cwd: string;
  readonly taskId?: string;
  readonly title?: string;
  readonly baseBranch?: string;
  readonly branch?: string;
  /** Named checks to execute via `runCheck` (host-declared; no free-form shell). */
  readonly checks: readonly string[];
  readonly runCheck: (name: string) => Promise<CodingCheckSummary>;
  /** Host-owned bounded handoff; required before completion. */
  readonly buildHandoff: (input: {
    readonly coding: CodingCheckpointMetadata;
    readonly checks: readonly CodingCheckSummary[];
  }) => Promise<CodingHandoffSummary>;
  readonly approval: CodingGoalVerifyApproval;
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: WorkflowEvent) => void;
  /** Second call after suspension — mirrors workflow resume. */
  readonly resume?: {
    readonly runId: string;
    readonly decision: "approve" | "deny";
    readonly expectedVersion: number;
    readonly input?: unknown;
  };
}

function requireCoding(state: Readonly<JsonObject>): CodingCheckpointMetadata {
  const coding = readCodingCheckpointFromState(state);
  if (!coding) throw new CodingGoalVerifyError("missing state.coding");
  return coding;
}

function clipSummary(summary: string): string {
  const max = DEFAULT_MAX_CHECK_SUMMARY_BYTES;
  const bytes = Buffer.from(summary, "utf8");
  if (bytes.length <= max) return summary;
  return bytes.subarray(0, max).toString("utf8");
}

function normalizeChecks(checks: readonly CodingCheckSummary[]): CodingCheckSummary[] {
  return checks.map((check) => ({
    name: check.name,
    exitCode: check.exitCode,
    summary: clipSummary(check.summary),
  }));
}

function assertHandoffBounded(handoff: CodingHandoffSummary): void {
  const encoded = Buffer.byteLength(JSON.stringify(handoff), "utf8");
  if (encoded > DEFAULT_MAX_PR_HANDOFF_BYTES) {
    throw new CodingGoalVerifyError(
      `handoff exceeds ${DEFAULT_MAX_PR_HANDOFF_BYTES} byte limit (${encoded} bytes)`,
    );
  }
}

function fingerprintsFor(checks: readonly string[]): CodingFingerprints {
  return {
    workflowRevision: CODING_GOAL_VERIFY_REVISION,
    toolFingerprint: fingerprintJson({ tools: ["coding_check", "git_pr_handoff"], checks }),
    policyFingerprint: fingerprintJson({ requireApproval: [CODING_GOAL_VERIFY_SUSPEND_REASON] }),
  };
}

function defaultTodos(checkNames: readonly string[]): CodingTodoItem[] {
  return [
    { id: "plan", text: "Write goal plan Markdown", done: false },
    ...checkNames.map((name) => ({ id: `check-${name}`, text: `Run named check ${name}`, done: false })),
    { id: "handoff", text: "Emit bounded PR handoff", done: false },
  ];
}

function markTodos(
  todos: readonly CodingTodoItem[],
  doneIds: ReadonlySet<string>,
): CodingTodoItem[] {
  return todos.map((todo) => (doneIds.has(todo.id) ? { ...todo, done: true } : todo));
}

/** Build the durable DAG used by `runCodingGoalVerify` (exported for hosts that want the definition alone). */
export function createCodingGoalVerifyWorkflow(options: {
  readonly goal: string;
  readonly cwd: string;
  readonly taskId: string;
  readonly title: string;
  readonly baseBranch: string;
  readonly branch: string;
  readonly checks: readonly string[];
  readonly runCheck: (name: string) => Promise<CodingCheckSummary>;
  readonly buildHandoff: RunCodingGoalVerifyOptions["buildHandoff"];
  readonly suspendReason: string;
}) {
  const planPath = codingPlanPathForTask(options.taskId);
  const fps = () => fingerprintsFor(options.checks);

  const planNode = functionNode({
    execute: async (ctx) => {
      const todos = defaultTodos(options.checks);
      const markdown = createCodingPlanMarkdown({
        title: options.title,
        taskId: options.taskId,
        status: "planned",
        todos,
        notes: options.goal,
      });
      const plan = await writeCodingPlanFile({
        workspaceRoot: options.cwd,
        planPath,
        markdown,
      });
      const metadata = buildCodingCheckpointMetadata({
        taskId: options.taskId,
        workspaceRoot: options.cwd,
        baseBranch: options.baseBranch,
        branch: options.branch,
        planPath,
        plan,
        fingerprints: fps(),
        todos: parseCodingPlanTodos(markdown),
        status: "planned",
      });
      await ctx.updateState(codingCheckpointStatePatch(metadata), { mode: "merge" });
      return { planPath, planSha256: plan.sha256 };
    },
  });

  const verifyNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      const checks = normalizeChecks(
        await Promise.all(options.checks.map((name) => options.runCheck(name))),
      );
      const failed = checks.some((check) => check.exitCode !== 0);
      const done = new Set<string>([
        "plan",
        ...options.checks.map((name) => `check-${name}`),
      ]);
      const todos = markTodos(coding.todos.length ? coding.todos : defaultTodos(options.checks), done);
      const markdown = createCodingPlanMarkdown({
        title: options.title,
        taskId: options.taskId,
        status: failed ? "awaiting_approval" : "ready_for_handoff",
        todos,
        notes: options.goal,
      });
      const plan = await writeCodingPlanFile({
        workspaceRoot: options.cwd,
        planPath,
        markdown,
      });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        plan,
        checks,
        todos: parseCodingPlanTodos(markdown),
        status: failed ? "awaiting_approval" : "ready_for_handoff",
        fingerprints: fps(),
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return { checks, failed };
    },
  });

  const reviewNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      const failed = coding.checks.some((check) => check.exitCode !== 0);
      if (!failed) return { approved: true, skipped: true };
      if (!ctx.resume) {
        return suspend({
          reason: options.suspendReason,
          data: {
            taskId: coding.taskId,
            branch: coding.branch,
            planSha256: coding.plan.sha256,
            checks: coding.checks,
          },
          resumeSchema: {
            type: "object",
            required: ["reviewer"],
            properties: { reviewer: { type: "string" } },
          },
        });
      }
      const reviewer =
        (ctx.resume.input as { reviewer?: string } | undefined)?.reviewer ?? "unknown";
      return { approved: true, reviewer, planSha256: coding.plan.sha256 };
    },
  });

  const handoffNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      const planFile = await readCodingPlanFile({
        workspaceRoot: options.cwd,
        planPath: coding.planPath,
        expected: coding.plan,
      });
      assertCodingResumeAllowed({
        metadata: coding,
        expected: fps(),
        expectedWorkspaceRoot: options.cwd,
        expectedBaseBranch: options.baseBranch,
        planBytes: Buffer.from(planFile.markdown, "utf8"),
      });

      const handoff = await options.buildHandoff({ coding, checks: coding.checks });
      assertHandoffBounded(handoff);

      const todos = markTodos(
        coding.todos.length ? coding.todos : defaultTodos(options.checks),
        new Set(["plan", "handoff", ...options.checks.map((name) => `check-${name}`)]),
      );
      const markdown = createCodingPlanMarkdown({
        title: options.title,
        taskId: options.taskId,
        status: "completed",
        todos,
        notes: options.goal,
      });
      const plan = await writeCodingPlanFile({
        workspaceRoot: options.cwd,
        planPath,
        markdown,
      });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        plan,
        handoff,
        todos: parseCodingPlanTodos(markdown),
        status: "completed",
        fingerprints: fps(),
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return { handoff, codingStatus: next.status };
    },
  });

  return defineWorkflow({
    revision: CODING_GOAL_VERIFY_REVISION,
    id: CODING_GOAL_VERIFY_WORKFLOW_ID,
    nodes: {
      plan: planNode,
      verify: verifyNode,
      review: reviewNode,
      handoff: handoffNode,
    },
    edges: [
      ["plan", "verify"],
      ["verify", "review"],
      ["review", "handoff"],
    ],
    limits: { maxConcurrency: 1, maxStateBytes: 64 * 1024 },
  });
}

/**
 * Run (or resume) a thin goal→verify coding composition.
 * Fails closed when `approval` / `approval.validateResume` is missing.
 */
export async function runCodingGoalVerify(
  options: RunCodingGoalVerifyOptions,
): Promise<WorkflowRunResult> {
  if (!options.approval?.validateResume) {
    throw new CodingGoalVerifyError("approval.validateResume is required");
  }
  if (!Array.isArray(options.checks) || options.checks.length < 1) {
    throw new CodingGoalVerifyError("checks must declare at least one named check");
  }
  for (const name of options.checks) {
    if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new CodingGoalVerifyError(`invalid check name: ${String(name)}`);
    }
  }
  if (typeof options.runCheck !== "function") {
    throw new CodingGoalVerifyError("runCheck is required");
  }
  if (typeof options.buildHandoff !== "function") {
    throw new CodingGoalVerifyError("buildHandoff is required");
  }
  if (typeof options.goal !== "string" || options.goal.trim().length < 1) {
    throw new CodingGoalVerifyError("goal is required");
  }
  if (typeof options.cwd !== "string" || options.cwd.length < 1) {
    throw new CodingGoalVerifyError("cwd is required");
  }

  const taskId = options.taskId ?? "goal";
  const title = options.title ?? options.goal.slice(0, 120);
  const baseBranch = options.baseBranch ?? "main";
  const branch = options.branch ?? `codex/${taskId}`;
  const suspendReason = options.approval.reason ?? CODING_GOAL_VERIFY_SUSPEND_REASON;

  const workflow = createCodingGoalVerifyWorkflow({
    goal: options.goal,
    cwd: options.cwd,
    taskId,
    title,
    baseBranch,
    branch,
    checks: options.checks,
    runCheck: options.runCheck,
    buildHandoff: options.buildHandoff,
    suspendReason,
  });

  const validateState = async (input: { readonly value: JsonObject }) => {
    if (CODING_STATE_KEY in input.value) {
      readCodingCheckpointFromState(input.value);
    }
  };

  const shared = {
    checkpoints: options.checkpoints,
    redactor: options.redactor,
    ownership: options.ownership,
    validateState,
    validateResume: options.approval.validateResume,
    signal: options.signal,
    onEvent: options.onEvent,
  };

  if (options.resume) {
    return resumeWorkflow(
      workflow,
      { runId: options.resume.runId, workflowId: workflow.id },
      {
        ...shared,
        resume: {
          decision: options.resume.decision,
          expectedVersion: options.resume.expectedVersion,
          input: options.resume.input,
        },
      },
    );
  }

  return runWorkflow(workflow, { goal: options.goal, baseBranch }, shared);
}
