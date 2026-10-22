import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type HostUi,
  type HostUiRequest,
  type HostUiResponse,
  type ModelProvider,
  type ToolDefinition,
} from "@arnilo/prism";
import {
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import toolsCoding, { createCodingTargets, type WorkspaceService } from "@arnilo/prism-tools-coding";
import approval, { type ApprovalMode, approvalPackage, decideApproval } from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-approval-"));
  dirs.push(dir);
  return dir;
}

const writeTool: ToolDefinition = {
  name: "note",
  effects: ["write"],
  execute: async (_args, ctx) => ({
    toolCallId: ctx.toolCallId,
    name: "note",
    content: [{ type: "text", text: "wrote" }],
  }),
};

function scriptedUi(steps: readonly HostUiResponse[]): HostUi & { kinds: string[] } {
  const kinds: string[] = [];
  let index = 0;
  return {
    kinds,
    request: (async (request: HostUiRequest) => {
      kinds.push(request.kind);
      return steps[index++] ?? { status: "dismissed" };
    }) as HostUi["request"],
  };
}

function noteCall() {
  return mockProvider(
    [
      [providerToolCall(toolCallContent("c1", "note", { path: "/tmp/a" })), providerDone()],
      [providerTextDelta("done"), providerDone()],
    ],
    { id: "mock" },
  );
}

/** A tool call on every odd generate, so each run asks once. */
function repeatingNote(): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn % 2 === 1) yield providerToolCall(toolCallContent(`c${turn}`, "note", { path: "/tmp/a" }));
      else yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

function repeatingNotePackage() {
  return definePackage({
    name: "@test/note-provider",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.providers.register(repeatingNote());
    },
  });
}

describe("approval package", () => {
  it("approval_package_conformance", async () => {
    const result = await packageConformance(approval);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("approval_mode_table", () => {
    const modes: ApprovalMode[] = ["deny", "ask", "edits", "auto"];
    const cells: Array<{ effects: readonly string[]; inside: boolean; expected: Record<ApprovalMode, "allow" | "ask" | "deny"> }> = [
      { effects: ["read"], inside: true, expected: { deny: "allow", ask: "allow", edits: "allow", auto: "allow" } },
      { effects: ["write"], inside: true, expected: { deny: "deny", ask: "ask", edits: "allow", auto: "allow" } },
      { effects: ["write"], inside: false, expected: { deny: "deny", ask: "ask", edits: "ask", auto: "allow" } },
      { effects: ["execute"], inside: true, expected: { deny: "deny", ask: "ask", edits: "ask", auto: "allow" } },
      { effects: ["network"], inside: false, expected: { deny: "deny", ask: "ask", edits: "ask", auto: "allow" } },
    ];
    for (const mode of modes) {
      for (const cell of cells) {
        assert.equal(
          decideApproval({ mode, effects: cell.effects, inside: cell.inside, granted: false }),
          cell.expected[mode],
          `${mode} ${cell.effects.join("+")} inside=${cell.inside}`,
        );
      }
    }
    assert.equal(decideApproval({ mode: "deny", effects: ["write"], inside: true, granted: true }), "deny");
    assert.equal(decideApproval({ mode: "ask", effects: ["write"], inside: false, granted: true }), "allow");
  });

  it("approval_ask_inline_confirm", async () => {
    const yes = scriptedUi([
      { status: "answered", value: true },
      { status: "answered", value: "once" },
    ]);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: yes },
      tools: { add: [writeTool] },
      packages: [noteCall(), approvalPackage({ mode: "ask" })],
    });
    try {
      const session = await agent.session({ id: "ask-yes", create: true });
      const result = await session.run("write");
      assert.equal(result.status, "completed");
      assert.match(JSON.stringify(result.messages), /wrote/);
      assert.deepEqual(yes.kinds, ["confirm", "select"]);
      await session.close();
    } finally {
      await agent.dispose();
    }

    const no = scriptedUi([{ status: "answered", value: false }]);
    const denied = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: no },
      tools: { add: [writeTool] },
      packages: [noteCall(), approvalPackage({ mode: "ask" })],
    });
    try {
      const session = await denied.session({ id: "ask-no", create: true });
      const result = await session.run("write");
      assert.equal(result.status, "completed");
      assert.match(JSON.stringify(result.messages), /hook_denied|denied/);
      assert.equal(no.kinds.length, 1);
      await session.close();
    } finally {
      await denied.dispose();
    }
  });

  it("approval_ask_suspends_without_ui", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      tools: { add: [writeTool] },
      packages: [noteCall(), approvalPackage({ mode: "ask" })],
    });
    try {
      const session = await agent.session({ id: "ask-suspend", create: true });
      const first = await session.run("write");
      assert.equal(first.status, "suspended");
      assert.equal(first.pending?.[0]?.kind, "tool_approval");
      const events: AgentEvent[] = [];
      for await (const event of session.resume(
        (first.pending ?? []).map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
      )) {
        events.push(event);
      }
      assert.equal(events.at(-1)?.type, "run.completed");
      assert.match(JSON.stringify(await session.messages()), /wrote/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("approval_always_grant_is_per_session", async () => {
    const ui = scriptedUi([
      { status: "answered", value: true },
      { status: "answered", value: "always" },
      { status: "answered", value: true },
      { status: "answered", value: "once" },
    ]);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui },
      tools: { add: [writeTool] },
      packages: [repeatingNotePackage(), approvalPackage({ mode: "ask" })],
    });
    try {
      const session = await agent.session({ id: "grant-session", create: true });
      await session.run("write");
      assert.equal(ui.kinds.length, 2);
      await session.run("write again");
      assert.equal(ui.kinds.length, 2, "a session grant skips the next prompt");
      const other = await agent.session({ id: "grant-other", create: true });
      await other.run("write");
      assert.equal(ui.kinds.length, 4, "a new session asks again");
      await session.close();
      await other.close();
    } finally {
      await agent.dispose();
    }
  });

  it("approval_auto_cannot_override_hard_deny", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", "outside.txt");
    await writeFile(join(root, "inside.txt"), "a");
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("c1", "edit", { path: outside, edits: [{ oldText: "a", newText: "b" }] })), providerDone()],
        [providerTextDelta("ok"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [provider, toolsCoding({ root }), approvalPackage({ mode: "auto" })],
    });
    try {
      const session = await agent.session({ id: "auto-deny", create: true });
      await session.run("edit");
      await session.close();
      const text = JSON.stringify(await session.entries());
      assert.match(text, /hook_denied/);
      assert.match(text, /outside coding roots/);
    } finally {
      await agent.dispose();
    }
  });

  it("approval_missing_targets_counts_as_outside", async () => {
    const ui = scriptedUi([
      { status: "answered", value: true },
      { status: "answered", value: "once" },
    ]);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui },
      tools: { add: [writeTool] },
      packages: [noteCall(), approvalPackage({ mode: "edits" })],
    });
    try {
      const session = await agent.session({ id: "missing-targets", create: true });
      await session.run("write");
      assert.deepEqual(ui.kinds, ["confirm", "select"], "edits asks when targets are missing");
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("approval_dismissed_never_allows", async () => {
    const ui = scriptedUi([{ status: "dismissed" }]);
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui },
      tools: { add: [writeTool] },
      packages: [noteCall(), approvalPackage({ mode: "ask" })],
    });
    try {
      const session = await agent.session({ id: "dismissed", create: true });
      const result = await session.run("write");
      assert.equal(result.status, "completed");
      assert.doesNotMatch(JSON.stringify(result.messages), /wrote/);
      assert.match(JSON.stringify(result.messages), /dismissed|hook_denied/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("approval_auto_from_project_scope_fails_closed", async () => {
    // PackageAPI exposes no manifest scope (src/packages/api.ts PackageAPI has config, not source).
    // A code instance may select auto. Project-scope rejection stays in the lab.
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [noteCall(), approvalPackage({ mode: "auto" })],
    });
    try {
      const hooks = agent.inspect().hooks["tool.call"] ?? [];
      assert.ok(hooks.some((hook) => hook.id === "@arnilo/prism-approval:tool.call"));
    } finally {
      await agent.dispose();
    }
  });

  it("approval_inside_roots_follow_the_session", async () => {
    const root = await tempRoot();
    const worktree = await tempRoot();
    // `createCodingTargets` reads only `worktree.bound`; the real service is covered by the
    // tools-coding routing tests.
    const workspace = {
      worktree: { bound: (sessionId: string) => (sessionId === "bound-session" ? { path: worktree } : undefined) },
    } as unknown as WorkspaceService;
    const targetsPackage = () =>
      definePackage({
        name: "@test/coding-targets",
        version: "0.0.0",
        requires: { api: 1 },
        setup(prism) {
          prism.services.provide("coding.targets", createCodingTargets(root, [], workspace));
        },
      })();
    const codingWrite: ToolDefinition = {
      name: "write",
      effects: ["write"],
      execute: async (_args, ctx) => ({
        toolCallId: ctx.toolCallId,
        name: "write",
        content: [{ type: "text", text: "wrote" }],
      }),
    };
    const writeCall = (path: string) =>
      mockProvider(
        [
          [providerToolCall(toolCallContent("c1", "write", { path })), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ],
        { id: "mock" },
      );

    // Inside the bound session's worktree: `edits` allows the write with no prompt.
    const insideUi = scriptedUi([]);
    const insideAgent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: insideUi },
      tools: { add: [codingWrite] },
      packages: [writeCall("a.txt"), targetsPackage(), approvalPackage({ mode: "edits" })],
    });
    try {
      const session = await insideAgent.session({ id: "bound-session", create: true });
      const result = await session.run("write inside");
      assert.equal(result.status, "completed");
      assert.deepEqual(insideUi.kinds, [], "a write inside the bound worktree needs no approval");
      assert.match(JSON.stringify(result.messages), /wrote/);
      await session.close();
    } finally {
      await insideAgent.dispose();
    }

    // The main root is outside the bound session's roots, so the same call asks.
    const outsideUi = scriptedUi([
      { status: "answered", value: true },
      { status: "answered", value: "once" },
    ]);
    const outsideAgent = await createAgent({
      model: { provider: "mock", model: "m" },
      host: { ui: outsideUi },
      tools: { add: [codingWrite] },
      packages: [writeCall(join(root, "a.txt")), targetsPackage(), approvalPackage({ mode: "edits" })],
    });
    try {
      const session = await outsideAgent.session({ id: "bound-session", create: true });
      const result = await session.run("write outside");
      assert.equal(result.status, "completed");
      assert.deepEqual(outsideUi.kinds, ["confirm", "select"], "the main root is outside the bound roots");
      await session.close();
    } finally {
      await outsideAgent.dispose();
    }
  });
});
