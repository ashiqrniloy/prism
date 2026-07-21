import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createSecretRedactor,
  type JsonObject,
} from "@arnilo/prism";
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
  type CodingCheckpointMetadata,
  type CodingFingerprints,
} from "@arnilo/prism-coding-agent";
import {
  cancelWorkflowRun,
  createWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  functionNode,
  getWorkflowRun,
  resumeWorkflow,
  runWorkflow,
  startWorkflowBackground,
  suspend,
  type WorkflowEvent,
} from "@arnilo/prism-workflows";

/**
 * Network-free durable coding-task composition.
 *
 * Plan/todos live as ordinary workspace Markdown. Workflow checkpoint state
 * stores only `state.coding` metadata (artifact URI/hash/summaries/fingerprints).
 * Foreground suspend/resume and background coordinator paths reuse existing
 * workflow primitives — no CodingRun, todo DB, or second approval engine.
 */

const WORKFLOW_REVISION = "1";
const TOOL_FINGERPRINT = fingerprintJson({
  tools: ["repo_list", "repo_search", "git_status", "git_commit", "coding_check", "git_pr_handoff"],
});
const POLICY_FINGERPRINT = fingerprintJson({
  deny: ["shell"],
  requireApproval: ["git_commit", "git_pr_handoff"],
});

function currentFingerprints(definitionHash?: string): CodingFingerprints {
  return {
    workflowRevision: WORKFLOW_REVISION,
    definitionHash,
    toolFingerprint: TOOL_FINGERPRINT,
    policyFingerprint: POLICY_FINGERPRINT,
  };
}

function requireCoding(state: Readonly<JsonObject>): CodingCheckpointMetadata {
  const coding = readCodingCheckpointFromState(state);
  if (!coding) throw new Error("missing state.coding");
  return coding;
}

export function createCodingTaskWorkflow(workspaceRoot: string) {
  const planPath = codingPlanPathForTask("parser-fix");

  const planNode = functionNode({
    execute: async (ctx) => {
      const input = ctx.workflowInput as { readonly title: string; readonly baseBranch: string };
      const markdown = createCodingPlanMarkdown({
        title: input.title,
        taskId: "parser-fix",
        status: "planned",
        todos: [
          { id: "branch", text: "Create isolated branch/worktree" },
          { id: "edit", text: "Apply bounded source edit" },
          { id: "check", text: "Run named typecheck" },
          { id: "handoff", text: "Emit host-owned PR handoff" },
        ],
        notes: "Shell remains an explicit escape hatch; Git/check tools own mutations.",
      });
      const plan = await writeCodingPlanFile({ workspaceRoot, planPath, markdown });
      const metadata = buildCodingCheckpointMetadata({
        taskId: "parser-fix",
        workspaceRoot,
        baseBranch: input.baseBranch,
        branch: "codex/parser-fix",
        planPath,
        plan,
        fingerprints: currentFingerprints(),
        todos: parseCodingPlanTodos(markdown),
        status: "planned",
      });
      await ctx.updateState(codingCheckpointStatePatch(metadata), { mode: "merge" });
      return { planPath, planSha256: plan.sha256, todos: metadata.todos.length };
    },
  });

  const branchNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      const worktreePath = join(workspaceRoot, ".worktrees", "parser-fix");
      const markdown = createCodingPlanMarkdown({
        title: "Fix parser",
        taskId: "parser-fix",
        status: "editing",
        todos: coding.todos.map((todo) =>
          todo.id === "branch" ? { ...todo, done: true } : todo,
        ),
      });
      const plan = await writeCodingPlanFile({ workspaceRoot, planPath, markdown });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        worktreePath,
        plan,
        todos: parseCodingPlanTodos(markdown),
        status: "editing",
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return { branch: next.branch, worktreePath };
    },
  });

  const editNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      const target = join(workspaceRoot, "src", "parser.ts");
      await writeFile(target, "export const parse = (input: string) => input.trim();\n", {
        mode: 0o600,
      });
      const markdown = createCodingPlanMarkdown({
        title: "Fix parser",
        taskId: "parser-fix",
        status: "checking",
        todos: coding.todos.map((todo) =>
          todo.id === "branch" || todo.id === "edit" ? { ...todo, done: true } : todo,
        ),
      });
      const plan = await writeCodingPlanFile({ workspaceRoot, planPath, markdown });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        plan,
        todos: parseCodingPlanTodos(markdown),
        status: "checking",
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return { edited: "src/parser.ts" };
    },
  });

  const checkNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      // Named checks are host-declared; this demo records a bounded summary only.
      const checks = [{ name: "typecheck", exitCode: 0, summary: "typecheck passed" }];
      const markdown = createCodingPlanMarkdown({
        title: "Fix parser",
        taskId: "parser-fix",
        status: "awaiting_approval",
        todos: coding.todos.map((todo) =>
          todo.id === "check" || todo.id === "branch" || todo.id === "edit"
            ? { ...todo, done: true }
            : todo,
        ),
      });
      const plan = await writeCodingPlanFile({ workspaceRoot, planPath, markdown });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        plan,
        checks,
        todos: parseCodingPlanTodos(markdown),
        status: "awaiting_approval",
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return { checks };
    },
  });

  const reviewNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      if (!ctx.resume) {
        return suspend({
          reason: "approve-coding-handoff",
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
      const reviewer = (ctx.resume.input as { reviewer?: string } | undefined)?.reviewer ?? "unknown";
      return { approvedBy: reviewer, planSha256: coding.plan.sha256 };
    },
  });

  const handoffNode = functionNode({
    execute: async (ctx) => {
      const coding = requireCoding(ctx.state);
      // Revalidate fingerprints + plan hash before producing host-owned handoff.
      const planFile = await readCodingPlanFile({
        workspaceRoot,
        planPath: coding.planPath,
        expected: coding.plan,
      });
      assertCodingResumeAllowed({
        metadata: coding,
        expected: currentFingerprints(coding.fingerprints.definitionHash),
        expectedWorkspaceRoot: workspaceRoot,
        expectedBaseBranch: coding.baseBranch,
        planBytes: Buffer.from(planFile.markdown, "utf8"),
      });

      const handoff = {
        base: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        changedPathCount: 1,
        checkCount: coding.checks.length,
      };
      const markdown = createCodingPlanMarkdown({
        title: "Fix parser",
        taskId: "parser-fix",
        status: "completed",
        todos: coding.todos.map((todo) => ({ ...todo, done: true })),
        notes: "Host may push/open PR outside Prism using the handoff payload.",
      });
      const plan = await writeCodingPlanFile({ workspaceRoot, planPath, markdown });
      const next = buildCodingCheckpointMetadata({
        ...coding,
        plan,
        handoff,
        todos: parseCodingPlanTodos(markdown),
        status: "completed",
        updatedAt: new Date().toISOString(),
      });
      await ctx.updateState(codingCheckpointStatePatch(next), { mode: "merge" });
      return {
        handoff: {
          base: handoff.base,
          head: handoff.head,
          changedPaths: ["src/parser.ts"],
          diffstat: "1 file changed, 1 insertion(+)",
          checks: coding.checks,
        },
        codingStatus: next.status,
      };
    },
  });

  return defineWorkflow({
    revision: WORKFLOW_REVISION,
    id: "coding-task",
    nodes: {
      plan: planNode,
      branch: branchNode,
      edit: editNode,
      check: checkNode,
      review: reviewNode,
      handoff: handoffNode,
    },
    edges: [
      ["plan", "branch"],
      ["branch", "edit"],
      ["edit", "check"],
      ["check", "review"],
      ["review", "handoff"],
    ],
    limits: { maxConcurrency: 1, maxStateBytes: 64 * 1024 },
  });
}

export async function demo() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "prism-coding-task-"));
  const events: WorkflowEvent[] = [];
  try {
    await mkdir(join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "src", "parser.ts"),
      "export const parse = (s: string) => s;\n",
      { mode: 0o600 },
    );

    const workflow = createCodingTaskWorkflow(workspaceRoot);
    const redactor = createSecretRedactor([]);
    const checkpoints = createWorkflowCheckpoints({
      store: createMemoryCheckpointStore(),
      redactor,
    });
    const ownership = { tenantId: "demo", userId: "coder-1" };

    const validateResume = async (input: {
      readonly value: unknown;
      readonly schema?: JsonObject;
      readonly suspension: { readonly reason: string };
    }) => {
      if (input.suspension.reason !== "approve-coding-handoff") {
        throw new Error("unexpected suspension");
      }
      const value = input.value as { reviewer?: string } | undefined;
      if (!value || typeof value.reviewer !== "string" || value.reviewer.length < 1) {
        throw new Error("reviewer required");
      }
    };

    const validateState = async (input: { readonly value: JsonObject }) => {
      if (CODING_STATE_KEY in input.value) {
        readCodingCheckpointFromState(input.value);
      }
    };

    const suspended = await runWorkflow(
      workflow,
      { title: "Fix parser", baseBranch: "main" },
      {
        checkpoints,
        redactor,
        ownership,
        validateState,
        signal: AbortSignal.timeout(30_000),
        onEvent: (event) => events.push(event),
      },
    );

    if (suspended.status !== "suspended") {
      throw new Error(`expected suspension, got ${suspended.status}`);
    }

    // Simulate process restart: reload checkpoint, verify plan artifact, resume once.
    const reloaded = await getWorkflowRun(checkpoints, {
      workflowId: workflow.id,
      runId: suspended.runId,
      ownership,
    });
    if (!reloaded) throw new Error("missing checkpoint after restart");
    const coding = requireCoding(reloaded.value.state ?? {});
    const planFile = await readCodingPlanFile({
      workspaceRoot,
      planPath: coding.planPath,
      expected: coding.plan,
    });
    assertCodingResumeAllowed({
      metadata: coding,
      expected: currentFingerprints(coding.fingerprints.definitionHash),
      expectedWorkspaceRoot: workspaceRoot,
      expectedBaseBranch: "main",
      planBytes: Buffer.from(planFile.markdown, "utf8"),
    });

    const completed = await resumeWorkflow(
      workflow,
      { runId: suspended.runId },
      {
        checkpoints,
        redactor,
        ownership,
        validateState,
        validateResume,
        resume: {
          decision: "approve",
          expectedVersion: suspended.version,
          input: { reviewer: "alice" },
        },
        onEvent: (event) => events.push(event),
      },
    );

    // Background branch: enqueue + coordinator claim, then cancel before work starts.
    const leases = createMemoryLeaseStore();
    const backgroundCheckpoints = createWorkflowCheckpoints({
      store: createMemoryCheckpointStore(),
      redactor,
    });
    const backgroundWorkflow = defineWorkflow({
      revision: WORKFLOW_REVISION,
      id: "coding-task-background",
      nodes: {
        work: functionNode({
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return "should-not-finish";
          },
        }),
      },
      edges: [],
    });
    const queued = await startWorkflowBackground(
      backgroundWorkflow,
      { title: "bg" },
      { checkpoints: backgroundCheckpoints, ownership },
    );
    await cancelWorkflowRun({
      workflowId: backgroundWorkflow.id,
      runId: queued.runId,
      workflow: backgroundWorkflow,
      checkpoints: backgroundCheckpoints,
      ownership,
    });
    const coordinator = createWorkflowCoordinator({
      coordinatorId: "coding-demo",
      workflows: { [backgroundWorkflow.id]: backgroundWorkflow },
      checkpoints: backgroundCheckpoints,
      leases,
      ownership,
      maxConcurrentRuns: 1,
    });
    const claims = await coordinator.pollOnce();
    const cancelled = await getWorkflowRun(backgroundCheckpoints, { ...queued, ownership });

    const handoff = completed.outputs.handoff as
      | { handoff?: { changedPaths?: string[] }; codingStatus?: string }
      | undefined;
    const finalPlan = await readCodingPlanFile({
      workspaceRoot,
      planPath: coding.planPath,
    });

    return {
      status: completed.status,
      suspendedAt: suspended.suspension?.reason,
      codingStatus: handoff?.codingStatus,
      changedPaths: handoff?.handoff?.changedPaths,
      planTodosDone: finalPlan.todos.every((todo) => todo.done),
      eventTypes: [...new Set(events.map((event) => event.type))],
      background: {
        queued: queued.runId,
        claims,
        cancelStatus: cancelled?.value.status,
      },
      noCredentialsInState: !JSON.stringify(reloaded.value.state ?? {}).includes("password"),
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
