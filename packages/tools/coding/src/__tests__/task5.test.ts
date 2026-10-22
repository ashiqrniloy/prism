import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";
import { createAgent, createMemorySessionStore, definePackage, type AgentEvent, type HostUi, type JsonValue } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import toolsCoding from "../index.js";
import { ASK_USER_DECISION_CUSTOM_VALUE } from "../agent/ask-user-decision.js";
import { createGitCommitTool, createGitStatusTool } from "../agent/git-tools.js";
import {
  ERR_PRISM_CODING_PRINCIPAL_MISMATCH,
  ERR_PRISM_CODING_PRINCIPAL_REQUIRED,
  withDurablePrincipal,
} from "../principal-guard.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-task5-"));
  dirs.push(dir);
  return dir;
}

function todoStep(
  id: string,
  status: "pending" | "completed",
): readonly (ReturnType<typeof providerToolCall> | ReturnType<typeof providerDone>)[] {
  return [
    providerToolCall(toolCallContent(id, "todo_write", { todos: [{ id: "1", content: "step one", status }] })),
    providerDone(),
  ];
}

const context = { sessionId: "s", runId: "r", toolCallId: "call" };

const ASK_OPTIONS = [
  { id: "sqlite", label: "SQLite", pros: ["a", "b", "c"], cons: ["d", "e", "f"] },
  { id: "postgres", label: "Postgres", pros: ["a", "b", "c"], cons: ["d", "e", "f"] },
];

function askProvider(allowCustom = false) {
  return mockProvider(
    [
      [
        providerToolCall(
          toolCallContent("c1", "ask_user_decision", {
            question: "Which database?",
            options: ASK_OPTIONS,
            ...(allowCustom ? { allowCustom: true } : {}),
          }),
        ),
        providerDone(),
      ],
      [providerTextDelta("picked"), providerDone()],
    ],
    { id: "mock" },
  );
}

describe("tools-coding git, checks, todo, ask_user, and principal", () => {
  it("coding_check_only_when_configured", async () => {
    const root = await tempRoot();
    const without = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      assert.equal(without.tools.some((tool) => tool.name === "coding_check"), false);
    } finally {
      await without.dispose();
    }
    const withChecks = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, checks: { test: { file: "/bin/true", args: [] } } })],
    });
    try {
      assert.equal(withChecks.tools.some((tool) => tool.name === "coding_check"), true);
    } finally {
      await withChecks.dispose();
    }
  });

  it("todo_continuation_continues_while_open", async () => {
    const root = await tempRoot();
    const provider = mockProvider(
      [todoStep("c1", "pending"), [providerTextDelta("premature"), providerDone()], todoStep("c2", "completed"), [providerTextDelta("All done."), providerDone()]],
      { id: "mock" },
    );
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [provider, toolsCoding({ root })] });
    try {
      const session = await agent.session({ id: "todo-continue", create: true });
      const result = await session.run("do the task");
      assert.equal(result.status, "completed");
      assert.equal(result.text, "All done.");
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("todo_continuation_capped_by_max_continuations", async () => {
    const root = await tempRoot();
    const provider = mockProvider(
      [todoStep("c1", "pending"), [providerTextDelta("one"), providerDone()], [providerTextDelta("two"), providerDone()], [providerTextDelta("three"), providerDone()]],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      limits: { maxContinuations: 1 },
      packages: [provider, toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "todo-cap", create: true });
      const result = await session.run("do the task");
      assert.equal(result.stopReason, "hook_limit");
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("todo_continuation_disabled_registers_no_hook", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, todo: { continueOnOpen: false } })],
    });
    try {
      assert.equal(agent.tools.some((tool) => tool.name === "todo_write"), true);
      const runEnd = agent.inspect().hooks["run.end"] ?? [];
      assert.equal(runEnd.some((hook) => hook.id === "@arnilo/prism-tools-coding:run.end#todo"), false);
    } finally {
      await agent.dispose();
    }
  });

  it("durable_tool_requires_principal", async () => {
    const root = await tempRoot();
    const tool = withDurablePrincipal(createGitCommitTool(root), undefined);
    const result = await tool.execute({ paths: ["a.txt"], message: "x" }, context);
    assert.equal(result.error?.code, ERR_PRISM_CODING_PRINCIPAL_REQUIRED);
    // Read-only git needs no principal: the guard must not swallow the call.
    const status = await withDurablePrincipal(createGitStatusTool(root), undefined).execute({}, context);
    assert.notEqual(status.error?.code, ERR_PRISM_CODING_PRINCIPAL_REQUIRED);
  });

  it("durable_tool_principal_mismatch", async () => {
    const root = await tempRoot();
    const tool = withDurablePrincipal(createGitCommitTool(root), "alice");
    const result = await tool.execute({ paths: ["a.txt"], message: "x" }, { ...context, principal: { kind: "user", id: "bob" } });
    assert.equal(result.error?.code, ERR_PRISM_CODING_PRINCIPAL_MISMATCH);
  });

  it("forge_token_literal_rejected_and_never_echoed", async () => {
    const root = await tempRoot();
    await assert.rejects(
      createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, forge: { token: "ghp_literal" } })] }),
      /forge|token|pattern/i,
    );

    const envName = "PRISM_TEST_FORGE_TOKEN";
    process.env[envName] = "s3cr3t-token-value";
    try {
      let service: { resolver: { resolve(): Promise<{ value?: string } | undefined> } } | undefined;
      const probe = definePackage({
        name: "@test/forge-probe",
        version: "1.0.0",
        requires: { api: 1, services: ["coding.forge"] },
        setup: (prism) => {
          service = prism.services.require<typeof service>("coding.forge");
        },
      });
      const agent = await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsCoding({ root, forge: { token: `env:${envName}` } }), probe()],
      });
      try {
        const resolved = await service?.resolver.resolve();
        assert.equal(resolved?.value, "s3cr3t-token-value");
        assert.equal(JSON.stringify(agent.inspect()).includes("s3cr3t-token-value"), false);
        assert.equal(JSON.stringify(agent.inspect()).includes(envName), true);
      } finally {
        await agent.dispose();
      }
    } finally {
      delete process.env[envName];
    }
  });

  it("ask_user_select_answer", async () => {
    const root = await tempRoot();
    const kinds: string[] = [];
    const ui = {
      request: async (request: { kind: string }) => {
        kinds.push(request.kind);
        return { status: "answered" as const, value: "sqlite" };
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: ui as HostUi },
      packages: [askProvider(), toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "ask-select", create: true });
      const result = await session.run("pick");
      assert.equal(result.status, "completed");
      assert.equal(result.text, "picked");
      assert.deepEqual(kinds, ["select"]);
      assert.match(JSON.stringify(result.messages), /sqlite/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("ask_user_custom_uses_input", async () => {
    const root = await tempRoot();
    const kinds: string[] = [];
    const ui = {
      request: async (request: { kind: string }) => {
        kinds.push(request.kind);
        if (request.kind === "select") return { status: "answered" as const, value: ASK_USER_DECISION_CUSTOM_VALUE };
        return { status: "answered" as const, value: "because" };
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: ui as HostUi },
      packages: [askProvider(true), toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "ask-custom", create: true });
      const result = await session.run("pick");
      assert.equal(result.status, "completed");
      assert.deepEqual(kinds, ["select", "input"]);
      assert.match(JSON.stringify(result.messages), /because/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("ask_user_dismissed_declines", async () => {
    const root = await tempRoot();
    const ui = { request: async () => ({ status: "dismissed" as const }) };
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: ui as HostUi },
      packages: [askProvider(), toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "ask-dismiss", create: true });
      const result = await session.run("pick");
      assert.equal(result.status, "completed");
      assert.match(JSON.stringify(result.messages), /declined/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("ask_user_unavailable_suspends_then_resumes", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [askProvider(), toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "ask-suspend", create: true });
      const first = await session.run("pick");
      assert.equal(first.status, "suspended");
      assert.equal(first.pending?.[0]?.kind, "elicitation");
      const events: AgentEvent[] = [];
      for await (const event of session.resume(
        first.pending!.map((pending) => ({
          approvalId: pending.approvalId,
          outcome: "allow_once" as const,
          elicitation: { selectedId: "sqlite" },
        })),
      )) {
        events.push(event);
      }
      assert.equal(events.at(-1)?.type, "run.completed");
      assert.match(JSON.stringify(await session.messages()), /sqlite/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("git_tools_carry_declared_effects", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      const effects = new Map(agent.tools.map((tool) => [tool.name, tool.effects as readonly JsonValue[] | undefined]));
      assert.deepEqual(effects.get("git_status"), ["read"]);
      assert.deepEqual(effects.get("git_commit"), ["write"]);
      assert.deepEqual(effects.get("git_pr_handoff"), ["external", "network"]);
    } finally {
      await agent.dispose();
    }
  });
});
