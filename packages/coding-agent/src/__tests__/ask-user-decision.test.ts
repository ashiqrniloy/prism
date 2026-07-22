import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCheckpointStore } from "@arnilo/prism";
import {
  createWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
} from "@arnilo/prism-workflows";
import {
  ASK_USER_DECISION_SUSPEND_REASON,
  ASK_USER_DECISION_TOOL_NAME,
  askUserDecisionResumeSchema,
  createAskUserDecisionResumeValidator,
  createAskUserDecisionTool,
  parseAskUserDecisionArgs,
  resolveAskUserDecisionAnswer,
  resolveAskUserDecisionLimits,
  suspendAskUserDecision,
  toAskUserDecisionSuspendData,
  validateAskUserDecisionAgentResume,
  validateAskUserDecisionResume,
} from "../ask-user-decision.js";
import { createCodingTools, createAllTools, createReadOnlyTools } from "../index.js";

const validArgs = {
  question: "Which persistence backend should we ship first?",
  options: [
    {
      id: "sqlite",
      label: "SQLite first",
      pros: ["Simple local setup", "Fast for single-host", "Already tested in CI"],
      cons: ["Weaker multi-writer", "Less ops familiarity", "Migration later to PG"],
    },
    {
      id: "postgres",
      label: "Postgres first",
      pros: ["Multi-writer ready", "Familiar ops tooling", "Matches prod shape"],
      cons: ["Heavier local setup", "Slower feedback loop", "Needs testcontainers"],
    },
  ],
};

const multiArgs = {
  ...validArgs,
  selectionMode: "multiple" as const,
  question: "Which search features should we ship?",
  options: [
    ...validArgs.options,
    {
      id: "fts",
      label: "Add FTS index",
      pros: ["Fast text query", "Native to SQLite", "Small migration"],
      cons: ["Extra storage", "Backfill cost", "Query tuning needed"],
    },
  ],
};

const decisionRequest = {
  question: validArgs.question,
  options: parseAskUserDecisionArgs(validArgs, resolveAskUserDecisionLimits()).options,
  selectionMode: "single" as const,
  allowCustom: true,
  toolCallId: "call-suspend",
};

test("createAskUserDecisionTool requires ask callback", () => {
  assert.throws(
    () => createAskUserDecisionTool({ ask: undefined as never }),
    /requires options\.ask/,
  );
});

test("parseAskUserDecisionArgs requires exactly 3 pros and 3 cons", () => {
  const limits = resolveAskUserDecisionLimits();
  assert.throws(
    () =>
      parseAskUserDecisionArgs(
        {
          question: "pick",
          options: [
            { id: "a", label: "A", pros: ["1", "2"], cons: ["1", "2", "3"] },
            { id: "b", label: "B", pros: ["1", "2", "3"], cons: ["1", "2", "3"] },
          ],
        },
        limits,
      ),
    /pros must be exactly 3/,
  );
});

test("parseAskUserDecisionArgs defaults selectionMode to single", () => {
  const parsed = parseAskUserDecisionArgs(validArgs, resolveAskUserDecisionLimits());
  assert.equal(parsed.selectionMode, "single");
});

test("ask_user_decision returns selected id via host ask()", async () => {
  let sawQuestion = "";
  const tool = createAskUserDecisionTool({
    ask: async (req) => {
      sawQuestion = req.question;
      assert.equal(req.selectionMode, "single");
      assert.equal(req.allowCustom, false);
      assert.equal(req.options.length, 2);
      assert.equal(req.options[0]!.pros.length, 3);
      assert.equal(req.options[0]!.cons.length, 3);
      return { selectedId: "postgres" };
    },
  });
  assert.equal(tool.name, ASK_USER_DECISION_TOOL_NAME);
  assert.equal(tool.exclusive, true);

  const result = await tool.execute(validArgs, {
    toolCallId: "call-1",
    sessionId: "s1",
    runId: "r1",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.metadata?.selectedId, "postgres");
  assert.deepEqual(result.metadata?.selectedIds, ["postgres"]);
  const text = result.content?.[0];
  assert.ok(text && text.type === "text");
  assert.match(text.text, /Postgres first/);
  assert.equal(sawQuestion, validArgs.question);
});

test("ask_user_decision multiple mode returns selectedIds", async () => {
  const tool = createAskUserDecisionTool({
    ask: async (req) => {
      assert.equal(req.selectionMode, "multiple");
      return { selectedIds: ["sqlite", "fts"] };
    },
  });
  const result = await tool.execute(multiArgs, {
    toolCallId: "call-multi",
    sessionId: "s1",
    runId: "r1",
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.metadata?.selectedIds, ["sqlite", "fts"]);
  assert.equal(result.metadata?.selectedId, "sqlite");
  assert.equal(result.metadata?.selectionMode, "multiple");
});

test("ask_user_decision multiple rejects empty selectedIds", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ selectedIds: [] }),
  });
  const result = await tool.execute(multiArgs, {
    toolCallId: "call-empty",
    sessionId: "s1",
    runId: "r1",
  });
  assert.match(result.error?.message ?? "", /non-empty selectedIds/);
});

test("ask_user_decision multiple rejects unknown ids", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ selectedIds: ["sqlite", "nope"] }),
  });
  const result = await tool.execute(multiArgs, {
    toolCallId: "call-unknown",
    sessionId: "s1",
    runId: "r1",
  });
  assert.match(result.error?.message ?? "", /unknown selectedId/);
});

test("single mode accepts selectedIds of length 1", () => {
  const limits = resolveAskUserDecisionLimits();
  const options = parseAskUserDecisionArgs(validArgs, limits).options;
  const resolved = resolveAskUserDecisionAnswer({ selectedIds: ["postgres"] }, "single", options, {
    allowCustom: false,
    maxCustomTextBytes: limits.maxCustomTextBytes,
  });
  assert.deepEqual(resolved, {
    kind: "selection",
    selectedId: "postgres",
    selectedIds: ["postgres"],
  });
});

test("single mode rejects selectedIds longer than 1", () => {
  const limits = resolveAskUserDecisionLimits();
  const options = parseAskUserDecisionArgs(validArgs, limits).options;
  assert.throws(
    () =>
      resolveAskUserDecisionAnswer({ selectedIds: ["sqlite", "postgres"] }, "single", options, {
        allowCustom: false,
        maxCustomTextBytes: limits.maxCustomTextBytes,
      }),
    /exactly one selected id/,
  );
});

test("allowCustom false rejects customText", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ customText: "do something else" }),
  });
  const result = await tool.execute(validArgs, {
    toolCallId: "call-custom-denied",
    sessionId: "s1",
    runId: "r1",
  });
  assert.match(result.error?.message ?? "", /allowCustom=false/);
});

test("allowCustom true accepts capped customText", async () => {
  const tool = createAskUserDecisionTool({
    ask: async (req) => {
      assert.equal(req.allowCustom, true);
      return { customText: "  Ship FTS later; SQLite metadata-only now  " };
    },
  });
  const result = await tool.execute(
    { ...validArgs, allowCustom: true },
    { toolCallId: "call-custom-ok", sessionId: "s1", runId: "r1" },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.metadata?.customText, "Ship FTS later; SQLite metadata-only now");
  assert.equal(result.metadata?.selectedId, undefined);
  const text = result.content?.[0];
  assert.ok(text && text.type === "text");
  assert.match(text.text, /custom answer/);
});

test("allowCustom true rejects oversize customText", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ customText: "x".repeat(3_000) }),
    maxCustomTextBytes: 64,
  });
  const result = await tool.execute(
    { ...validArgs, allowCustom: true },
    { toolCallId: "call-custom-big", sessionId: "s1", runId: "r1" },
  );
  assert.match(result.error?.message ?? "", /customText must be 1\.\./);
});

test("customText XOR selection enforced", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () =>
      ({ selectedId: "sqlite", customText: "also this" }) as never,
  });
  const result = await tool.execute(
    { ...validArgs, allowCustom: true },
    { toolCallId: "call-xor", sessionId: "s1", runId: "r1" },
  );
  assert.match(result.error?.message ?? "", /mutually exclusive/);
});

test("ask_user_decision rejects unknown selectedId from ask()", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ selectedId: "nope" }),
  });
  const result = await tool.execute(validArgs, {
    toolCallId: "call-2",
    sessionId: "s1",
    runId: "r1",
  });
  assert.match(result.error?.message ?? "", /unknown selectedId/);
});

test("ask_user_decision honors executionPolicy deny", async () => {
  let asked = 0;
  const tool = createAskUserDecisionTool({
    ask: async () => {
      asked++;
      return { selectedId: "sqlite" };
    },
    executionPolicy: {
      check: () => ({ allowed: false, reason: "no decisions" }),
    },
  });
  const result = await tool.execute(validArgs, {
    toolCallId: "call-3",
    sessionId: "s1",
    runId: "r1",
  });
  assert.equal(result.error?.message, "no decisions");
  assert.equal(asked, 0);
});

test("default aggregators omit ask_user_decision (opt-in only)", () => {
  const cwd = process.cwd();
  for (const tools of [createCodingTools(cwd), createAllTools(cwd), createReadOnlyTools(cwd)]) {
    assert.ok(!tools.some((t) => t.name === ASK_USER_DECISION_TOOL_NAME));
  }
});

test("suspendAskUserDecision builds workflow_suspend with request data", () => {
  const suspension = suspendAskUserDecision(decisionRequest);
  assert.equal(suspension.type, "workflow_suspend");
  assert.equal(suspension.reason, ASK_USER_DECISION_SUSPEND_REASON);
  assert.deepEqual(
    (suspension.data as { question: string }).question,
    decisionRequest.question,
  );
  assert.ok(suspension.resumeSchema);
  assert.equal(askUserDecisionResumeSchema(decisionRequest).type, "object");
});

test("validateAskUserDecisionResume accepts selection and custom", () => {
  const data = toAskUserDecisionSuspendData(decisionRequest);
  assert.equal(
    validateAskUserDecisionResume(data, { selectedId: "postgres" }).kind,
    "selection",
  );
  assert.equal(
    validateAskUserDecisionResume(data, { customText: "Ship metadata-only now" }).kind,
    "custom",
  );
  assert.throws(
    () => validateAskUserDecisionResume(data, { selectedId: "nope" }),
    /unknown selectedId/,
  );
  assert.throws(
    () =>
      validateAskUserDecisionResume(
        { ...data, allowCustom: false },
        { customText: "nope" },
      ),
    /allowCustom=false/,
  );
});

test("createAskUserDecisionResumeValidator reads suspension.data", async () => {
  const validate = createAskUserDecisionResumeValidator();
  const data = toAskUserDecisionSuspendData(decisionRequest);
  await validate({
    value: { selectedIds: ["sqlite"] },
    schema: askUserDecisionResumeSchema(data),
    suspension: {
      nodeId: "ask",
      reason: ASK_USER_DECISION_SUSPEND_REASON,
      data,
      requestedAt: new Date().toISOString(),
    },
  });
  // Omit input (deny-style) — no throw.
  await validate({
    value: undefined,
    suspension: {
      nodeId: "ask",
      reason: ASK_USER_DECISION_SUSPEND_REASON,
      data,
      requestedAt: new Date().toISOString(),
    },
  });
  await assert.rejects(
    async () => {
      await Promise.resolve(
        validate({
          value: { selectedId: "nope" },
          suspension: {
            nodeId: "ask",
            reason: ASK_USER_DECISION_SUSPEND_REASON,
            data,
            requestedAt: new Date().toISOString(),
          },
        }),
      );
    },
    /unknown selectedId/,
  );
});

test("validateAskUserDecisionAgentResume mirrors workflow validator", () => {
  const data = toAskUserDecisionSuspendData({
    ...decisionRequest,
    selectionMode: "multiple",
    allowCustom: false,
  });
  const resolved = validateAskUserDecisionAgentResume({
    request: data,
    answer: { selectedIds: ["sqlite", "postgres"] },
  });
  assert.equal(resolved.kind, "selection");
  if (resolved.kind === "selection") {
    assert.deepEqual(resolved.selectedIds, ["sqlite", "postgres"]);
  }
});

test("workflow suspend → approve resume validates answer (network-free)", async () => {
  const checkpoints = createWorkflowCheckpoints({
    store: createMemoryCheckpointStore(),
  });
  const data = toAskUserDecisionSuspendData(decisionRequest);
  const workflow = defineWorkflow({
    revision: "1",
    id: "ask-user-decision-suspend-demo",
    nodes: {
      ask: functionNode({
        execute: async (ctx) => {
          if (!ctx.resume) return suspendAskUserDecision(data);
          const resolved = validateAskUserDecisionResume(data, ctx.resume.input);
          return { resolved };
        },
      }),
    },
    edges: [],
    limits: { maxConcurrency: 1, maxStateBytes: 64 * 1024 },
  });

  const first = await runWorkflow(workflow, {}, {
    checkpoints,
    validateResume: createAskUserDecisionResumeValidator(),
  });
  assert.equal(first.status, "suspended");
  assert.equal(first.suspension?.reason, ASK_USER_DECISION_SUSPEND_REASON);

  const second = await resumeWorkflow(
    workflow,
    { runId: first.runId, workflowId: workflow.id },
    {
      checkpoints,
      validateResume: createAskUserDecisionResumeValidator(),
      resume: {
        decision: "approve",
        expectedVersion: first.version,
        input: { selectedId: "postgres" },
      },
    },
  );
  assert.equal(second.status, "succeeded");
  const output = second.outputs.ask as {
    resolved: { kind: string; selectedId?: string };
  };
  assert.equal(output.resolved.kind, "selection");
  assert.equal(output.resolved.selectedId, "postgres");
});

test("blocking ask() callback mode unchanged when ask provided", async () => {
  const tool = createAskUserDecisionTool({
    ask: async () => ({ selectedId: "sqlite" }),
  });
  const result = await tool.execute(validArgs, {
    toolCallId: "call-cb",
    sessionId: "s1",
    runId: "r1",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.metadata?.selectedId, "sqlite");
});
