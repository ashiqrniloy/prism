import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  type ContentBlock,
  compileGuardrailPacks,
  createAgent,
  createMemorySessionStore,
  createToolRegistry,
  describeGuardrailPacks,
  type GuardrailPackRef,
  type GuardrailRecord,
  GuardrailPackError,
  providerDone,
  providerTextDelta,
  providerToolCall,
  snapshotRunBundle,
  toolCallContent,
  type JsonObject,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";

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

type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

/**
 * A session-scoped pack harness: one agent + session per harness so pack state (the
 * `validation-respect` ledger, the `secrets-hygiene` observer) persists across calls exactly as it
 * does in a real run. Each `run` scripts one tool call and returns the resulting tool result.
 */
async function packHarness(packs: readonly GuardrailPackRef[] | undefined, tools: readonly ToolDefinition[]) {
  const events: AgentEvent[] = [];
  const executed: string[] = [];
  const wrapped = tools.map((tool) => ({
    ...tool,
    execute: (args: JsonObject, ctx: Parameters<ToolDefinition["execute"]>[1]) => {
      executed.push(tool.name);
      return tool.execute(args, ctx);
    },
  }));
  let pending: { readonly name: string; readonly args: JsonObject } | undefined;
  let turn = 0;
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1 && pending) {
          yield providerToolCall(toolCallContent(`c-${pending.name}`, pending.name, pending.args));
          yield providerDone();
          return;
        }
        yield providerTextDelta("stopped");
        yield providerDone();
      },
    },
    tools: { add: wrapped },
    slots: { store },
  });
  const sessionId = "pack-harness";
  const session = await agent.session({ id: sessionId, guardrailPacks: packs, create: true });
  const run = async (name: string, args: JsonObject = {}): Promise<ToolResult> => {
    pending = { name, args };
    turn = 0;
    // `subscribe()` is run-scoped: a fresh subscription per run collects that run's events.
    const consume = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    await session.run("go");
    await consume;
    const block = await toolResultOf(store, sessionId);
    return {
      toolCallId: block?.toolCallId ?? `c-${name}`,
      name,
      ...(block?.result !== undefined ? { value: block.result } : {}),
      ...(block?.error ? { error: block.error } : {}),
    };
  };
  return { run, executed, events };
}

async function toolResultOf(store: ReturnType<typeof createMemorySessionStore>, sessionId: string): Promise<ToolResultBlock | undefined> {
  for (const entry of [...(await store.list(sessionId))].reverse()) {
    const block = entry.message?.content.find((part): part is ToolResultBlock => part.type === "tool_result");
    if (block) return block;
  }
  return undefined;
}

/** A kernel `guardrail.decision` package event, with its `data` merged in for assertions. */
interface GuardrailDecisionEvent {
  readonly type: "package.event";
  readonly sessionId: string;
  readonly runId: string;
  readonly record: GuardrailRecord;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

const decisions = (events: readonly AgentEvent[]): GuardrailDecisionEvent[] =>
  events
    .filter(
      (event): event is Extract<AgentEvent, { readonly type: "package.event" }> =>
        event.type === "package.event" && event.name === "guardrail.decision",
    )
    .map((event) => ({
      type: "package.event" as const,
      sessionId: event.sessionId,
      runId: event.runId,
      ...((event.data ?? {}) as unknown as { record: GuardrailRecord; toolName?: string; toolCallId?: string }),
    }));

/** The terminal record of the latest evaluated rule (the harness accumulates events across runs). */
const denial = (events: readonly AgentEvent[]) => [...decisions(events)].reverse().find((event) => event.record.action !== "allow");

/** Agent whose first provider turn requests one tool call, then ends the run. */
async function toolCallingAgent(
  tools: readonly ToolDefinition[],
  args: JsonObject,
): Promise<{ agent: Awaited<ReturnType<typeof createAgent>>; executed: () => number }> {
  let turns = 0;
  let executed = 0;
  const agent = await createAgent({
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
    tools: {
      add: tools.map((tool) => ({
        ...tool,
        execute: (toolArgs, ctx) => {
          executed += 1;
          return tool.execute(toolArgs, ctx);
        },
      })),
    },
  });
  return { agent, executed: () => executed };
}

async function runSession(
  session: Awaited<ReturnType<Awaited<ReturnType<typeof createAgent>>["session"]>>,
  input: string,
): Promise<AgentEvent[]> {
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
    const inline: GuardrailPackRef = {
      id: "my-pack",
      version: 3,
      rules: [{ id: "no-etc", tool: "write", deny: (args) => args.path === "/etc/passwd" }],
    };
    const write = echo("write", "written");
    const harness = await packHarness([inline], [write]);

    const denied = await harness.run("write", { path: "/etc/passwd" });
    assert.equal(denied.value, undefined);
    assert.equal(denied.error?.message, "Blocked by guardrail rule pack:my-pack/no-etc");
    assert.deepEqual(harness.executed, []);
    const [record] = decisions(harness.events);
    assert.equal(record?.record.guardrail, "pack:my-pack/no-etc");
    assert.equal(record?.record.action, "block");
    assert.equal(record?.record.reason, "guardrail pack rule my-pack/no-etc");
    assert.deepEqual(record?.record.metadata, { pack: "my-pack", rule: "no-etc", version: 3 });
    // Audit event carries pack + rule + tool identity, never raw arguments.
    assert.equal(record?.toolName, "write");
    assert.equal(record?.toolCallId, "c-write");
    assert.equal(JSON.stringify(record).includes("/etc/passwd"), false);

    const allowed = await harness.run("write", { path: "src/a.ts" });
    assert.equal(allowed.value, "written");
    assert.deepEqual(harness.executed, ["write"]);
  });

  it("blocks coding-standard violations: edits outside roots and test-file rewrites", async () => {
    const harness = await packHarness(
      [{ id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }],
      [echo("write", "written"), echo("edit", "edited"), echo("move", "moved"), shellTool],
    );

    await harness.run("write", { path: "/tmp/evil.txt", content: "x" });
    assert.deepEqual(harness.executed, []);
    assert.equal(denial(harness.events)?.record.reason, "File edits are restricted to the configured workspace roots");
    assert.equal(denial(harness.events)?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");

    await harness.run("edit", { path: "src/__tests__/a.test.ts" });
    assert.equal(denial(harness.events)?.record.guardrail, "pack:coding-standard/no-test-rewrites");

    await harness.run("move", { from: "/repo/src/a.ts", to: "/repo/__tests__/a.ts" });
    assert.equal(denial(harness.events)?.record.guardrail, "pack:coding-standard/no-test-rewrites");

    await harness.run("write", { path: "src/a.ts", content: "x" });
    assert.deepEqual(harness.executed, ["write"]);
    await harness.run("shell", { command: "ls /" });
    assert.deepEqual(harness.executed, ["write", "shell"]);
  });

  it("blocks destructive shell commands from the destructive-commands pack", async () => {
    const harness = await packHarness(["destructive-commands"], [shellTool]);
    const deny = async (command: string) => {
      const before = harness.executed.length;
      await harness.run("shell", { command });
      assert.equal(harness.executed.length, before, `expected denial for: ${command}`);
      return denial(harness.events)?.record;
    };

    assert.equal((await deny("git push --force origin main"))?.guardrail, "pack:destructive-commands/no-force-push");
    assert.equal((await deny("rm -rf /tmp/x"))?.guardrail, "pack:destructive-commands/no-recursive-force-delete");
    assert.equal((await deny("rm -fr build"))?.guardrail, "pack:destructive-commands/no-recursive-force-delete");
    assert.equal((await deny("rm --recursive --force /tmp/x"))?.guardrail, "pack:destructive-commands/no-long-flag-force-delete");
    assert.equal((await deny("psql -c 'drop table users'"))?.guardrail, "pack:destructive-commands/no-destructive-sql");
    assert.equal((await deny("mkfs.ext4 /dev/sda1"))?.guardrail, "pack:destructive-commands/no-device-overwrite");

    await harness.run("shell", { command: "git push origin main && npm test" });
    assert.deepEqual(harness.executed, ["shell"]);
  });

  it("blocks secret-shaped tool arguments in any tool", async () => {
    const harness = await packHarness(["secrets-hygiene"], [echo("write", "written")]);
    const deny = async (args: JsonObject) => {
      const before = harness.executed.length;
      await harness.run("write", args);
      assert.equal(harness.executed.length, before, `expected denial for: ${JSON.stringify(args)}`);
      return denial(harness.events)?.record.guardrail;
    };
    assert.equal(
      await deny({ path: "a.txt", content: "token=ghp_abcdefghijklmnopqrstuvwx" }),
      "pack:secrets-hygiene/no-secret-material-in-arguments",
    );
    assert.equal(await deny({ path: "a.txt", content: "key sk-abcdefghijklmnop" }), "pack:secrets-hygiene/no-secret-material-in-arguments");
    // Split so this fixture does not trip the tracked-tree secret scan (scripts/scan-secrets.mjs);
    // the runtime value is the exact PEM header the pack matches. Same convention as install-smoke.test.ts.
    assert.equal(
      await deny({ path: "a.txt", content: ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("") }),
      "pack:secrets-hygiene/no-secret-material-in-arguments",
    );

    await harness.run("write", { path: "a.txt", content: "plain text" });
    assert.deepEqual(harness.executed, ["write"]);
  });

  it("denies mutations after a failed validation until one passes", async () => {
    const harness = await packHarness(["validation-respect"], [failingValidationTool, echo("write", "written")]);

    await harness.run("run_tests", {});
    assert.deepEqual(harness.executed, ["run_tests"]);

    await harness.run("write", { path: "src/a.ts" });
    assert.deepEqual(harness.executed, ["run_tests"]);
    assert.equal(denial(harness.events)?.record.guardrail, "pack:validation-respect/no-mutation-after-failed-validation");
    assert.equal(denial(harness.events)?.record.reason, "A previous validation result failed; fix it before mutating files");
  });

  it("treats a non-zero shell exit as a failed validation when shell is opted in", async () => {
    const harness = await packHarness(
      [{ id: "validation-respect", options: { validationTools: ["shell"] } }],
      [exitOneShellTool, echo("edit", "edited")],
    );
    await harness.run("shell", { command: "npm test" });
    const before = harness.executed.length;
    await harness.run("edit", { path: "src/a.ts" });
    assert.equal(harness.executed.length, before);
  });

  it("cannot widen permissions or reach stages beyond the tool seams", () => {
    const rules = compileGuardrailPacks(["coding-standard", "destructive-commands", "validation-respect", "secrets-hygiene"]);
    assert.ok(rules);
    assert.deepEqual([...new Set(rules.toolInput.map((guard) => guard.stage))], ["tool_input"]);
    assert.deepEqual([...new Set(rules.toolOutput.map((guard) => guard.stage))], ["tool_output"]);
    assert.equal(
      rules.toolOutput.every((guard) => guard.name.endsWith("/observe")),
      true,
    );
  });

  it("fails closed on malformed pack config", () => {
    const cases: readonly [string, readonly unknown[]][] = [
      ["unknown pack", [{ id: "nope" }]],
      ["inline pack options", [{ id: "inline", rules: [{ id: "r", deny: () => true }], options: { roots: [] } }]],
      ["no rules", [{ id: "inline", rules: [] }]],
      ["both pattern and deny", [{ id: "inline", rules: [{ id: "r", pattern: "a", deny: () => true }] }]],
      ["neither pattern nor deny", [{ id: "inline", rules: [{ id: "r" }] }]],
      ["ask with a deny predicate", [{ id: "inline", rules: [{ id: "r", deny: () => true, action: "ask" }] }]],
      ["unknown action", [{ id: "inline", rules: [{ id: "r", pattern: "a", action: "permit" }] }]],
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

  it("reports pack identity rows for run bundles", async () => {
    const rows = describeGuardrailPacks(["coding-standard"]);
    assert.deepEqual(rows, [
      { name: "pack:coding-standard/no-unrelated-file-edits", stage: "tool_input", revision: "coding-standard@1" },
      { name: "pack:coding-standard/no-test-rewrites", stage: "tool_input", revision: "coding-standard@1" },
    ]);
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerDone();
        },
      },
      tools: { add: [echo("write", "written")] },
    });
    const bundle = snapshotRunBundle({ agent, config: { guardrailPacks: ["secrets-hygiene"] } });
    assert.deepEqual(bundle.guardrails, [
      { name: "pack:secrets-hygiene/no-secret-material-in-arguments", stage: "tool_input", revision: "secrets-hygiene@1" },
    ]);
  });

  it("enforces session-configured packs during a run", async () => {
    const { agent, executed } = await toolCallingAgent([echo("write", "written")], { path: "/tmp/evil.txt", content: "x" });
    const session = await agent.session({ guardrailPacks: [{ id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }] });
    const events = await runSession(session, "edit a file");

    assert.equal(executed(), 0, "pack blocked the tool before execution");
    const blocks = (await session.entries()).flatMap((entry) => entry.message?.content ?? []);
    const denied = blocks.find((block): block is ToolResultBlock => block.type === "tool_result" && block.error !== undefined);
    assert.equal(denied?.error?.code, "hook_denied");
    const record = denial(events);
    assert.equal(record?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");
    assert.equal(record?.toolName, "write");
  });

  it("carries packs into a forked session instead of silently dropping them", async () => {
    const { agent, executed } = await toolCallingAgent([echo("write", "written")], { path: "/tmp/evil.txt", content: "x" });
    const session = await agent.session({ guardrailPacks: ["coding-standard"] });
    const forked = await session.fork();
    // Forking re-creates the session: the pack must be recompiled for the branch, not lost.
    const events = await runSession(forked, "edit a file");

    assert.equal(executed(), 0, "forked session still enforces the pack");
    assert.equal(denial(events)?.record.guardrail, "pack:coding-standard/no-unrelated-file-edits");
  });
});
