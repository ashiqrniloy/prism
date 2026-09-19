import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  compileGuardrailPacks,
  createAgent,
  createToolRegistry,
  describeGuardrailPacks,
  dispatchToolCall,
  GuardrailPackError,
  providerDone,
  providerTextDelta,
  providerToolCall,
  snapshotRunBundle,
  toolCallContent,
  type Guardrails,
  type JsonObject,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";

const context = { sessionId: "s1", runId: "r1", metadata: {} };

const echo = (name: string, value: string): ToolDefinition => ({
  name,
  execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name, value }),
});

const shellTool: ToolDefinition = {
  name: "shell",
  execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "shell", value: { exitCode: 0 } }),
};

const failingValidationTool: ToolDefinition = {
  name: "run_tests",
  execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "run_tests", error: { message: "2 tests failed" } }),
};

const exitOneShellTool: ToolDefinition = {
  name: "shell",
  execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "shell", value: { exitCode: 1 } }),
};

async function dispatch(input: {
  readonly name: string;
  readonly args?: JsonObject;
  readonly guardrails?: Guardrails;
  readonly tools: readonly ToolDefinition[];
}): Promise<{ readonly result: ToolResult; readonly events: AgentEvent[]; readonly executed: readonly string[] }> {
  const events: AgentEvent[] = [];
  const executed: string[] = [];
  const tools = input.tools.map((tool) => ({
    ...tool,
    execute: (args: JsonObject, ctx: Parameters<ToolDefinition["execute"]>[1]) => {
      executed.push(tool.name);
      return tool.execute(args, ctx);
    },
  }));
  const result = await dispatchToolCall({
    call: { type: "tool_call", id: `c-${input.name}`, name: input.name, arguments: input.args ?? {} },
    registry: createToolRegistry(tools),
    context: { ...context, toolCallId: `c-${input.name}` },
    ...(input.guardrails ? { guardrails: input.guardrails } : {}),
    emit: (event) => {
      events.push(event);
    },
  });
  return { result, events, executed };
}

const decisions = (events: readonly AgentEvent[]) =>
  events.filter((event): event is Extract<AgentEvent, { type: "guardrail_decision" }> => event.type === "guardrail_decision");

/** Every evaluated rule emits a record; the terminal denial is the first non-allow record. */
const denial = (events: readonly AgentEvent[]) => decisions(events).find((event) => event.record.action !== "allow");

/** Agent whose first provider turn requests one tool call, then ends the run. */
function toolCallingAgent(
  tools: readonly ToolDefinition[],
  args: JsonObject,
): { agent: ReturnType<typeof createAgent>; executed: () => number } {
  let turns = 0;
  let executed = 0;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate() {
        turns += 1;
        if (turns === 1) {
          yield providerToolCall(toolCallContent("call-write", tools[0]!.name, args));
          yield providerDone();
          return;
        }
        yield providerTextDelta("stopped");
        yield providerDone();
      },
    },
    tools: tools.map((tool) => ({
      ...tool,
      execute: (toolArgs, ctx) => {
        executed += 1;
        return tool.execute(toolArgs, ctx);
      },
    })),
  });
  return { agent, executed: () => executed };
}

async function runSession(session: ReturnType<ReturnType<typeof createAgent>["createSession"]>, input: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const consume = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  await session.run(input);
  await consume;
  return events;
}

describe("guardrail packs", () => {
  it("denies on an inline predicate match and passes otherwise", async () => {
    const guardrails = compileGuardrailPacks(
      [{ id: "my-pack", version: 3, rules: [{ id: "no-etc", tool: "write", deny: (args) => args.path === "/etc/passwd" }] }],
      new Map(),
    );
    assert.ok(guardrails);
    const write = echo("write", "written");

    const denied = await dispatch({ name: "write", args: { path: "/etc/passwd" }, guardrails, tools: [write] });
    assert.equal(denied.result.value, undefined);
    assert.equal(denied.result.error?.message, "Tool call blocked by guardrail");
    assert.deepEqual(denied.executed, []);
    const [record] = decisions(denied.events);
    assert.equal(record?.record.guardrail, "pack:my-pack/no-etc");
    assert.equal(record?.record.action, "block");
    assert.equal(record?.record.reason, "guardrail pack rule my-pack/no-etc");
    assert.deepEqual(record?.record.metadata, { pack: "my-pack", rule: "no-etc", version: 3 });
    // Audit event carries pack + rule + tool identity, never raw arguments.
    assert.equal(record?.toolName, "write");
    assert.equal(record?.toolCallId, "c-write");
    assert.equal(JSON.stringify(record).includes("/etc/passwd"), false);

    const allowed = await dispatch({ name: "write", args: { path: "src/a.ts" }, guardrails, tools: [write] });
    assert.equal(allowed.result.value, "written");
    assert.deepEqual(allowed.executed, ["write"]);
  });

  it("blocks coding-standard violations: edits outside roots and test-file rewrites", async () => {
    const guardrails = compileGuardrailPacks([{ id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }]);
    assert.ok(guardrails);
    const tools = [echo("write", "written"), echo("edit", "edited"), echo("move", "moved")];

    const outside = await dispatch({ name: "write", args: { path: "/tmp/evil.txt", content: "x" }, guardrails, tools });
    assert.deepEqual(outside.executed, []);
    assert.equal(denial(outside.events)?.record.reason, "File edits are restricted to the configured workspace roots");
    assert.equal(denial(outside.events)?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");

    const testRewrite = await dispatch({ name: "edit", args: { path: "src/__tests__/a.test.ts" }, guardrails, tools });
    assert.equal(denial(testRewrite.events)?.record.guardrail, "pack:coding-standard/no-test-rewrites");

    const testMove = await dispatch({ name: "move", args: { from: "/repo/src/a.ts", to: "/repo/__tests__/a.ts" }, guardrails, tools });
    assert.equal(denial(testMove.events)?.record.guardrail, "pack:coding-standard/no-test-rewrites");

    const inside = await dispatch({ name: "write", args: { path: "src/a.ts", content: "x" }, guardrails, tools });
    assert.deepEqual(inside.executed, ["write"]);
    const unrelatedTool = await dispatch({ name: "shell", args: { command: "ls /" }, guardrails, tools: [shellTool] });
    assert.deepEqual(unrelatedTool.executed, ["shell"]);
  });

  it("blocks destructive shell commands from the destructive-commands pack", async () => {
    const guardrails = compileGuardrailPacks(["destructive-commands"]);
    assert.ok(guardrails);
    const deny = async (command: string) => {
      const run = await dispatch({ name: "shell", args: { command }, guardrails, tools: [shellTool] });
      assert.deepEqual(run.executed, [], `expected denial for: ${command}`);
      return denial(run.events)?.record;
    };

    assert.equal((await deny("git push --force origin main"))?.guardrail, "pack:destructive-commands/no-force-push");
    assert.equal((await deny("rm -rf /tmp/x"))?.guardrail, "pack:destructive-commands/no-recursive-force-delete");
    assert.equal((await deny("rm -fr build"))?.guardrail, "pack:destructive-commands/no-recursive-force-delete");
    assert.equal((await deny("rm --recursive --force /tmp/x"))?.guardrail, "pack:destructive-commands/no-long-flag-force-delete");
    assert.equal((await deny("psql -c 'drop table users'"))?.guardrail, "pack:destructive-commands/no-destructive-sql");
    assert.equal((await deny("mkfs.ext4 /dev/sda1"))?.guardrail, "pack:destructive-commands/no-device-overwrite");

    const allowed = await dispatch({
      name: "shell",
      args: { command: "git push origin main && npm test" },
      guardrails,
      tools: [shellTool],
    });
    assert.deepEqual(allowed.executed, ["shell"]);
  });

  it("blocks secret-shaped tool arguments in any tool", async () => {
    const guardrails = compileGuardrailPacks(["secrets-hygiene"]);
    assert.ok(guardrails);
    const deny = async (args: JsonObject) => {
      const run = await dispatch({ name: "write", args, guardrails, tools: [echo("write", "written")] });
      assert.deepEqual(run.executed, [], `expected denial for: ${JSON.stringify(args)}`);
      return denial(run.events)?.record.guardrail;
    };
    assert.equal(
      await deny({ path: "a.txt", content: "token=ghp_abcdefghijklmnopqrstuvwx" }),
      "pack:secrets-hygiene/no-secret-material-in-arguments",
    );
    assert.equal(await deny({ path: "a.txt", content: "key sk-abcdefghijklmnop" }), "pack:secrets-hygiene/no-secret-material-in-arguments");
    assert.equal(
      await deny({ path: "a.txt", content: "-----BEGIN RSA PRIVATE KEY-----" }),
      "pack:secrets-hygiene/no-secret-material-in-arguments",
    );

    const allowed = await dispatch({
      name: "write",
      args: { path: "a.txt", content: "plain text" },
      guardrails,
      tools: [echo("write", "written")],
    });
    assert.deepEqual(allowed.executed, ["write"]);
  });

  it("denies mutations after a failed validation until one passes", async () => {
    const guardrails = compileGuardrailPacks(["validation-respect"]);
    assert.ok(guardrails);
    const tools = [failingValidationTool, echo("write", "written")];

    const failed = await dispatch({ name: "run_tests", args: {}, guardrails, tools });
    assert.deepEqual(failed.executed, ["run_tests"]);

    const afterFailure = await dispatch({ name: "write", args: { path: "src/a.ts" }, guardrails, tools });
    assert.deepEqual(afterFailure.executed, []);
    assert.equal(denial(afterFailure.events)?.record.guardrail, "pack:validation-respect/no-mutation-after-failed-validation");
    assert.equal(denial(afterFailure.events)?.record.reason, "A previous validation result failed; fix it before mutating files");

    const passing = await dispatch({
      name: "run_tests",
      args: {},
      guardrails,
      tools: [echo("run_tests", "2 passed"), echo("write", "written")],
    });
    assert.deepEqual(passing.executed, ["run_tests"]);
    const afterPass = await dispatch({
      name: "write",
      args: { path: "src/a.ts" },
      guardrails,
      tools: [echo("run_tests", "2 passed"), echo("write", "written")],
    });
    assert.deepEqual(afterPass.executed, ["write"]);
  });

  it("treats a non-zero shell exit as a failed validation when shell is opted in", async () => {
    const guardrails = compileGuardrailPacks([{ id: "validation-respect", options: { validationTools: ["shell"] } }]);
    assert.ok(guardrails);
    const tools = [exitOneShellTool, echo("edit", "edited")];
    await dispatch({ name: "shell", args: { command: "npm test" }, guardrails, tools });
    const afterFailure = await dispatch({ name: "edit", args: { path: "src/a.ts" }, guardrails, tools });
    assert.deepEqual(afterFailure.executed, []);
  });

  it("cannot widen permissions or reach stages beyond the tool seams", async () => {
    const guardrails = compileGuardrailPacks(["coding-standard", "destructive-commands", "validation-respect", "secrets-hygiene"]);
    assert.ok(guardrails);
    assert.equal(guardrails.input, undefined);
    assert.equal(guardrails.output, undefined);
    assert.deepEqual([...new Set(guardrails.toolInput?.map((guard) => guard.stage))], ["tool_input"]);
    assert.deepEqual([...new Set(guardrails.toolOutput?.map((guard) => guard.stage))], ["tool_output"]);
    assert.equal(
      guardrails.toolOutput?.every((guard) => guard.name.endsWith("/observe")),
      true,
    );

    // A tool the registry does not have stays denied with packs present.
    const unknown = await dispatch({ name: "write", args: { path: "src/a.ts" }, guardrails, tools: [] });
    assert.equal(unknown.result.error?.message, "Unknown tool: write");

    // Recorders never deny: an observe-only pack allows the result through.
    const guarded = await dispatch({ name: "run_tests", args: {}, guardrails, tools: [failingValidationTool] });
    assert.deepEqual(guarded.executed, ["run_tests"]);
    assert.equal(guarded.result.error?.message, "2 tests failed");
  });

  it("fails closed on malformed pack config", () => {
    const cases: readonly [string, readonly unknown[]][] = [
      ["unknown pack", [{ id: "nope" }]],
      ["inline pack options", [{ id: "inline", rules: [{ id: "r", deny: () => true }], options: { roots: [] } }]],
      ["no rules", [{ id: "inline", rules: [] }]],
      ["both pattern and deny", [{ id: "inline", rules: [{ id: "r", pattern: "a", deny: () => true }] }]],
      ["neither pattern nor deny", [{ id: "inline", rules: [{ id: "r" }] }]],
      ["ask action", [{ id: "inline", rules: [{ id: "r", pattern: "a", action: "ask" }] }]],
      ["invalid pattern", [{ id: "inline", rules: [{ id: "r", pattern: "([unclosed" }] }]],
      [
        "duplicate rule id",
        [
          {
            id: "inline",
            rules: [
              { id: "r", pattern: "a" },
              { id: "r", pattern: "b" },
            ],
          },
        ],
      ],
      ["duplicate pack id", ["coding-standard", { id: "coding-standard", options: { roots: ["/repo"] } }]],
      ["too many packs", Array.from({ length: 9 }, (_, index) => ({ id: `inline-${index}`, rules: [{ id: "r", pattern: "a" }] }))],
    ];
    for (const [label, refs] of cases) {
      assert.throws(
        () => compileGuardrailPacks(refs as never),
        (error: unknown) => error instanceof GuardrailPackError && error.code === "ERR_PRISM_GUARDRAIL_PACK",
        `expected fail-closed compile for: ${label}`,
      );
    }
    assert.equal(compileGuardrailPacks(undefined), undefined);
    assert.equal(compileGuardrailPacks([]), undefined);
  });

  it("reports pack identity rows for run bundles", () => {
    const rows = describeGuardrailPacks(["coding-standard"]);
    assert.deepEqual(rows, [
      { name: "pack:coding-standard/no-unrelated-file-edits", stage: "tool_input", revision: "coding-standard@1" },
      { name: "pack:coding-standard/no-test-rewrites", stage: "tool_input", revision: "coding-standard@1" },
    ]);
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerDone();
        },
      },
      tools: [echo("write", "written")],
    });
    const bundle = snapshotRunBundle({ agent, config: { guardrailPacks: ["secrets-hygiene"] } });
    assert.deepEqual(bundle.guardrails, [
      { name: "pack:secrets-hygiene/no-secret-material-in-arguments", stage: "tool_input", revision: "secrets-hygiene@1" },
    ]);
  });

  it("enforces session-configured packs during a run", async () => {
    const { agent, executed } = toolCallingAgent([echo("write", "written")], { path: "/tmp/evil.txt", content: "x" });
    const session = agent.createSession({ guardrailPacks: [{ id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }] });
    const events = await runSession(session, "edit a file");

    assert.equal(executed(), 0, "pack blocked the tool before execution");
    assert.equal(events.filter((event) => event.type === "tool_execution_blocked").length, 1);
    const record = denial(events);
    assert.equal(record?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");
    assert.equal(record?.toolName, "write");
  });

  it("carries packs into a forked session instead of silently dropping them", async () => {
    const { agent, executed } = toolCallingAgent([echo("write", "written")], { path: "/tmp/evil.txt", content: "x" });
    const session = agent.createSession({ guardrailPacks: ["coding-standard"] });
    const forked = session.fork();
    // Forking re-creates the session: the pack must be recompiled for the branch, not lost.
    const events = await runSession(forked, "edit a file");

    assert.equal(executed(), 0, "forked session still enforces the pack");
    assert.equal(denial(events)?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");
  });
});
