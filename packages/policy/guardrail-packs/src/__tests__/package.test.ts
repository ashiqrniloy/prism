import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type AgentEvent, createAgent, createMemorySessionStore, definePackage, type JsonObject, type LoopStrategy, loadSuspendedRunEntry, type ModelProvider, type ToolDefinition } from "@arnilo/prism";
import { packageConformance, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import guardrailPacks, { describeGuardrailPacks, GuardrailPackError, guardrailPacksConfigSchema, resolveGuardrailPacks } from "../index.js";

function recordingTool(name: string, executed: string[]): ToolDefinition {
  return {
    name,
    parameters: { type: "object" },
    execute: (args, ctx) => {
      executed.push(name);
      return { toolCallId: ctx.toolCallId, name, value: { args } };
    },
  };
}

function failingValidationTool(name = "run_tests"): ToolDefinition {
  return {
    name,
    parameters: { type: "object" },
    execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name, error: { message: "2 tests failed" } }),
  };
}

function callingProvider(tool: string, args: JsonObject, finish = true): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield providerToolCall(toolCallContent("c1", tool, args));
        yield providerDone();
        return;
      }
      if (finish) {
        yield providerTextDelta("done");
        yield providerDone();
      }
    },
  };
}

function providerPackageFor(provider: ModelProvider) {
  return definePackage({
    name: "@test/guardrail-provider",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.providers.register(provider);
    },
  });
}

async function refusalsOf(store: ReturnType<typeof createMemorySessionStore>, sessionId: string) {
  const refusals: { tool: string; message: string; code?: string | number }[] = [];
  for (const entry of await store.list(sessionId)) {
    for (const part of entry.message?.content ?? []) {
      const block = part.type === "tool_result" ? part : undefined;
      if (block?.error?.message) refusals.push({ tool: block.name, message: block.error.message, code: block.error.code });
    }
  }
  return refusals;
}

function decisionRecords(events: readonly AgentEvent[]) {
  return events
    .filter(
      (event): event is Extract<AgentEvent, { type: "package.event" }> =>
        event.type === "package.event" && event.name === "guardrail.decision",
    )
    .map(
      (event) =>
        (event.data ?? {}) as { record: { guardrail: string; action: string; reason?: string; metadata?: Record<string, unknown> } },
    );
}

describe("guardrail packs package", () => {
  it("guardrail_packs_package_conformance", async () => {
    const result = await packageConformance(guardrailPacks);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("guardrail_packs_destructive_command_denied", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const agent = await createAgent({
      id: "destructive",
      model: { provider: "mock", model: "m" },
      slots: { store },
      packages: [
        providerPackageFor(callingProvider("shell", { command: "rm -rf /" })),
        guardrailPacks({ packs: ["destructive-commands"] }),
      ],
      tools: { add: [recordingTool("shell", executed)] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("clean");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.equal(result.status, "completed", "a blocked call does not fail the run");
    assert.deepEqual(executed, [], "the tool never ran");
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /pack:destructive-commands\/no-recursive-force-delete/);
    await agent.dispose();
  });

  it("guardrail_packs_coding_standard_blocks_outside_roots", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      id: "coding",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(callingProvider("write", { path: "/tmp/evil.txt", content: "x" })),
        guardrailPacks({ packs: [{ id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } }] }),
      ],
      tools: { add: [recordingTool("write", executed)] },
    });
    const events: AgentEvent[] = [];
    const session = await agent.session({ id: "s", create: true });
    const pump = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    await session.run("edit");
    await pump;
    assert.deepEqual(executed, []);
    assert.equal(
      decisionRecords(events).find((d) => d.record.action !== "allow")?.record.guardrail,
      "pack:coding-standard/no-unrelated-file-edits",
    );
    await agent.dispose();
  });

  it("guardrail_packs_secret_never_echoed", async () => {
    const store = createMemorySessionStore();
    const fakeToken = "sk-TESTONLYFAKEKEY1";
    const executed: string[] = [];
    const agent = await createAgent({
      id: "secret",
      model: { provider: "mock", model: "m" },
      slots: { store },
      packages: [
        providerPackageFor(callingProvider("write", { path: "a.txt", content: `TOKEN=${fakeToken}` })),
        guardrailPacks({ packs: ["secrets-hygiene"] }),
      ],
      tools: { add: [recordingTool("write", executed)] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("write");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.match(refusal?.message ?? "", /pack:secrets-hygiene\/no-secret-material-in-arguments/);
    assert.equal(refusal?.message.includes(fakeToken), false, "the refusal never echoes the token");
    assert.deepEqual(executed, []);
    await agent.dispose();
  });

  it("guardrail_packs_validation_state_survives_resume", async () => {
    const store = createMemorySessionStore();
    const mutations: string[] = [];
    let turn = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 1) {
          yield providerToolCall(toolCallContent("v1", "verify_build", {}));
          yield providerDone();
          return;
        }
        if (turn === 2) {
          yield providerTextDelta("validated");
          yield providerDone();
          return;
        }
        if (turn === 3) {
          // Run 2: a read-only tool behind a host ask gate suspends while the pack state is set.
          yield providerToolCall(toolCallContent("i1", "inspect", {}));
          yield providerDone();
          return;
        }
        if (turn === 4) {
          // Post-resume: the restored pack state must deny the mutation.
          yield providerToolCall(toolCallContent("w1", "write", { path: "a.txt" }));
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    };
    const agent = await createAgent({
      id: "validation",
      model: { provider: "mock", model: "m" },
      slots: { store },
      hooks: (hooks) => hooks.on("tool.call", (call) => (call.name === "inspect" ? { ask: "Approval required" } : undefined)),
      packages: [
        providerPackageFor(provider),
        guardrailPacks({ packs: [{ id: "validation-respect", options: { validationTools: ["verify_build"] } }] }),
      ],
      tools: {
        add: [
          failingValidationTool("verify_build"),
          {
            name: "inspect",
            parameters: { type: "object" },
            execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "inspect", value: "ok" }),
          },
          {
            name: "write",
            parameters: { type: "object" },
            execute: (args, ctx) => {
              mutations.push("write");
              return { toolCallId: ctx.toolCallId, name: "write", value: { args } };
            },
          },
        ],
      },
    });
    const session = await agent.session({ id: "s", create: true });
    await session.run("validate");
    const suspended = await session.run("inspect");
    assert.equal(suspended.status, "suspended");
    const stored = await loadSuspendedRunEntry(store, "s");
    assert.equal(
      JSON.stringify(stored?.state.sessionState ?? {}).includes("guardrailPacks"),
      false,
      "pack refs are config, not stored run state",
    );

    for await (const _event of session.resume(
      suspended.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      // drain: the resumed leg restores the pack state and then denies the mutation
    }
    assert.deepEqual(mutations, [], "the restored pack state still denies the mutation");
    await agent.dispose();
  });

  it("guardrail_packs_ask_rule_suspends_without_ui", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      id: "ask",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackageFor(callingProvider("deploy", { version: "prod-7" })),
        guardrailPacks({
          packs: [
            {
              id: "deploy-guard",
              rules: [
                {
                  id: "ask-prod",
                  tool: "deploy",
                  argPath: "version",
                  pattern: "^prod-",
                  action: "ask",
                  reason: "Production tags need approval",
                },
              ],
            },
          ],
        }),
      ],
      tools: { add: [recordingTool("deploy", executed)] },
    });
    const session = await agent.session({ id: "s", create: true });
    const first = await session.run("ship prod-7");
    assert.equal(first.status, "suspended");
    assert.deepEqual(executed, [], "the gated call did not dispatch");
    assert.match(first.pending?.[0]?.reason ?? "", /pack:deploy-guard\/ask-prod/);
    const resumedEvents: AgentEvent[] = [];
    for await (const event of session.resume(
      (first.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      resumedEvents.push(event);
    }
    assert.equal(resumedEvents.at(-1)?.type, "run.completed");
    assert.deepEqual(executed, ["deploy"]);
    await agent.dispose();
  });

  it("guardrail_packs_from_custom_loop", async () => {
    const store = createMemorySessionStore();
    const executed: string[] = [];
    const customLoop: LoopStrategy = {
      name: "custom-guardrail-loop",
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    };
    const agent = await createAgent({
      id: "custom-loop",
      model: { provider: "mock", model: "m" },
      slots: { store, loop: customLoop },
      packages: [
        providerPackageFor(callingProvider("shell", { command: "rm -rf /" })),
        guardrailPacks({ packs: ["destructive-commands"] }),
      ],
      tools: { add: [recordingTool("shell", executed)] },
    });
    const result = await (await agent.session({ id: "s", create: true })).run("clean");
    const refusal = (await refusalsOf(store, result.sessionId))[0];
    assert.equal(refusal?.code, "hook_denied");
    assert.match(refusal?.message ?? "", /pack:destructive-commands\/no-recursive-force-delete/);
    assert.deepEqual(executed, [], "the custom loop still routes the call through the pack rule");
    await agent.dispose();
  });

  it("session_options_reject_guardrail_packs", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [guardrailPacks({ packs: ["destructive-commands"] })],
    });
    // @ts-expect-error `guardrailPacks` is package config now, not a `SessionOptions` field (plan 159 Task 5).
    const session = await agent.session({ guardrailPacks: ["destructive-commands"] });
    assert.equal("guardrailPackRefs" in session, false, "the session carries no pack refs");
    await agent.dispose();
  });

  it("guardrail_packs_unknown_pack_fails_closed", async () => {
    assert.throws(
      () => resolveGuardrailPacks([{ id: "ghost" }]),
      (error: unknown) => error instanceof GuardrailPackError && error.code === "ERR_PRISM_GUARDRAIL_PACK",
    );
    await assert.rejects(
      () =>
        createAgent({
          model: { provider: "mock", model: "m" },
          packages: [guardrailPacks({ packs: [{ id: "ghost" }] })],
        }),
      /unknown guardrail pack/,
    );
  });

  it("guardrail_packs_describe_reports_rows", async () => {
    const rows = describeGuardrailPacks(["coding-standard"]);
    assert.deepEqual(rows, [
      { name: "pack:coding-standard/no-unrelated-file-edits", stage: "tool_input", revision: "coding-standard@1" },
      { name: "pack:coding-standard/no-test-rewrites", stage: "tool_input", revision: "coding-standard@1" },
    ]);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [guardrailPacks({ packs: ["secrets-hygiene"] })],
    });
    const output = (await agent.commands.run("guardrail-packs:describe")) as { rows: { name: string }[] };
    assert.deepEqual(output.rows, [
      { name: "pack:secrets-hygiene/no-secret-material-in-arguments", stage: "tool_input", revision: "secrets-hygiene@1" },
    ]);
    await agent.dispose();
  });

  it("guardrail_packs_config_schema_rejects_literal_deny", () => {
    assert.equal(guardrailPacksConfigSchema.type, "object");
    // A `deny` predicate is not JSON config: the schema has no such property, so it fails closed.
    const properties = (guardrailPacksConfigSchema.properties as Record<string, { items?: { oneOf?: unknown[] } }>).packs;
    assert.ok(properties?.items?.oneOf);
  });
});
