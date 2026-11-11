import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HostUi,
  type HostUiRequest,
  type HostUiRequestKind,
  type HostUiResponse,
  createAgent,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  ASK_USER_DECISION_CUSTOM_VALUE,
  ASK_USER_DECISION_TOOL_NAME,
  askUserDecisionResumeSchema,
  createAskUserDecisionTool,
  parseAskUserDecisionArgs,
  resolveAskUserDecisionAnswer,
  resolveAskUserDecisionLimits,
  toAskUserDecisionSuspendData,
} from "../ask-user-decision.js";
import { createAllTools, createCodingTools, createReadOnlyTools } from "../index.js";
import toolsCoding from "../../index.js";

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

const context = { toolCallId: "call-1", sessionId: "s1", runId: "r1" };

/** One scripted answer per `request`; the last answer repeats. */
function scriptedUi(answers: readonly HostUiResponse[]): HostUi {
  let index = 0;
  return {
    async request<K extends HostUiRequestKind>(_request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
      const answer = answers[Math.min(index, answers.length - 1)] as HostUiResponse<K> | undefined;
      index += 1;
      if (answer === undefined) throw new Error("scriptedUi exhausted");
      return answer;
    },
  };
}

test("ask_user_decision_accepts_zero_to_three_pros_cons", () => {
  const limits = resolveAskUserDecisionLimits();
  const parsed = parseAskUserDecisionArgs(
    {
      question: "pick",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B", pros: ["one"], cons: ["one", "two"] },
        { id: "c", label: "C", pros: ["1", "2", "3"], cons: ["1", "2", "3"] },
      ],
    },
    limits,
  );
  assert.deepEqual(
    parsed.options.map((option) => [option.pros, option.cons]),
    [
      [[], []],
      [["one"], ["one", "two"]],
      [
        ["1", "2", "3"],
        ["1", "2", "3"],
      ],
    ],
  );
});

test("ask_user_decision_rejects_four_pros", () => {
  const limits = resolveAskUserDecisionLimits();
  assert.throws(
    () =>
      parseAskUserDecisionArgs(
        {
          question: "pick",
          options: [
            { id: "a", label: "A", pros: ["1", "2", "3", "4"] },
            { id: "b", label: "B" },
          ],
        },
        limits,
      ),
    /pros must be 0\.\.3 strings/,
  );
  // The schema says the same bounds and makes both fields optional.
  const schema = createAskUserDecisionTool({}).parameters as {
    properties: { options: { items: { properties: Record<string, { minItems?: number; maxItems?: number }>; required: string[] } } };
  };
  const item = schema.properties.options.items;
  assert.equal(item.properties.pros?.minItems, 0);
  assert.equal(item.properties.pros?.maxItems, 3);
  assert.equal(item.properties.cons?.maxItems, 3);
  assert.deepEqual(item.required, ["id", "label"]);
});

test("parseAskUserDecisionArgs defaults selectionMode to single", () => {
  assert.equal(parseAskUserDecisionArgs(validArgs, resolveAskUserDecisionLimits()).selectionMode, "single");
});

test("ask_user_select_answer returns the host choice", async () => {
  const tool = createAskUserDecisionTool({ ui: scriptedUi([{ status: "answered", value: "postgres" }]) });
  assert.equal(tool.name, ASK_USER_DECISION_TOOL_NAME);
  assert.equal(tool.exclusive, true);
  const result = await tool.execute(validArgs, context);
  assert.equal(result.error, undefined);
  assert.equal(result.metadata?.selectedId, "postgres");
  assert.deepEqual(result.metadata?.selectedIds, ["postgres"]);
});

test("ask_user_multiple_select_answer returns selectedIds", async () => {
  const tool = createAskUserDecisionTool({ ui: scriptedUi([{ status: "answered", value: ["sqlite", "fts"] }]) });
  const result = await tool.execute(multiArgs, context);
  assert.deepEqual(result.metadata?.selectedIds, ["sqlite", "fts"]);
  assert.equal(result.metadata?.selectionMode, "multiple");
});

test("ask_user_custom_input asks select then input", async () => {
  const ui = scriptedUi([
    { status: "answered", value: ASK_USER_DECISION_CUSTOM_VALUE },
    { status: "answered", value: "  Ship metadata-only now  " },
  ]);
  const tool = createAskUserDecisionTool({ ui });
  const result = await tool.execute({ ...validArgs, allowCustom: true }, context);
  assert.equal(result.error, undefined);
  assert.equal(result.metadata?.customText, "Ship metadata-only now");
  assert.equal(result.metadata?.selectedId, undefined);
});

test("ask_user_dismissed_never_allows", async () => {
  const tool = createAskUserDecisionTool({ ui: scriptedUi([{ status: "dismissed" }]) });
  const result = await tool.execute(validArgs, context);
  assert.match(result.error?.message ?? "", /declined/);
  assert.equal(result.metadata, undefined);
});

test("ask_user_unavailable_fails_closed", async () => {
  const tool = createAskUserDecisionTool({ ui: scriptedUi([{ status: "unavailable" }]) });
  const result = await tool.execute(validArgs, context);
  assert.match(result.error?.message ?? "", /not available/);
});

test("ask_user_no_ui_fails_closed", async () => {
  const tool = createAskUserDecisionTool({});
  const result = await tool.execute(validArgs, context);
  assert.match(result.error?.message ?? "", /suspend for an answer/);
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

test("customText XOR selection enforced", () => {
  const limits = resolveAskUserDecisionLimits();
  const options = parseAskUserDecisionArgs(validArgs, limits).options;
  assert.throws(
    () =>
      resolveAskUserDecisionAnswer({ selectedId: "sqlite", customText: "also this" } as never, "single", options, {
        allowCustom: true,
        maxCustomTextBytes: limits.maxCustomTextBytes,
      }),
    /mutually exclusive/,
  );
});

test("elicitation schema carries the choice payload and defaults allowCustom to false", () => {
  const data = toAskUserDecisionSuspendData({
    question: validArgs.question,
    options: parseAskUserDecisionArgs(validArgs, resolveAskUserDecisionLimits()).options,
    selectionMode: "single",
  });
  assert.equal(data.allowCustom, false);
  assert.equal(askUserDecisionResumeSchema(data).type, "object");
});

test("default aggregators omit ask_user_decision (opt-in only)", () => {
  const cwd = process.cwd();
  for (const tools of [createCodingTools(cwd), createAllTools(cwd), createReadOnlyTools(cwd)]) {
    assert.ok(!tools.some((t) => t.name === ASK_USER_DECISION_TOOL_NAME));
  }
});

test("ask_user_unavailable_suspends_then_resumes", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-ask-suspend-"));
  try {
    let turn = 0;
    const agent = await createAgent({
      id: "ask-suspend",
      model: { provider: "mock", model: "m" },
      ownership: { tenantId: "local" },
      packages: [
        toolsCoding({ root }),
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (turn === 1) {
                yield { type: "tool_call" as const, call: toolCallContent("call-ask", ASK_USER_DECISION_TOOL_NAME, validArgs) };
                yield providerDone();
                return;
              }
              yield providerTextDelta("finished");
              yield providerDone();
            },
          },
        ]),
      ],
    });
    try {
      const session = await agent.session({ id: "ask-suspend-session", create: true });
      const first = await session.run("go");
      assert.equal(first.status, "suspended");
      const pending = first.pending?.[0];
      assert.equal(pending?.kind, "elicitation");
      assert.equal(pending?.reason, validArgs.question);
      const ux = pending?.elicitationSchema?.["x-prism-ask-user-decision"] as { options?: unknown[] } | undefined;
      assert.equal(ux?.options?.length, 2);

      const events: string[] = [];
      for await (const event of session.resume([
        { approvalId: pending!.approvalId, outcome: "allow_once", elicitation: { selectedId: "postgres" } },
      ])) {
        events.push(event.type);
      }
      const entries = await session.entries();
      const toolResult = entries
        .flatMap((entry) => (entry.kind === "message" && entry.message ? entry.message.content : []))
        .find((block) => block.type === "tool_result" && block.name === ASK_USER_DECISION_TOOL_NAME);
      assert.ok(toolResult && toolResult.type === "tool_result");
      assert.match(JSON.stringify(toolResult.result), /postgres/);
      assert.equal(events.includes("run.completed"), true);
      await session.close();
    } finally {
      await agent.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
