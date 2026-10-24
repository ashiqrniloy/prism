import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { resolveAgentChildren } from "../index.js";

const roots: string[] = [];

/** Writes `files` under a fresh temp root; the root is the `agentsRoot`. */
function agentsRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "prism-agents-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Turn {
  readonly tools: readonly string[];
  readonly models: string;
  readonly last: string;
  readonly description: string;
}

const REVIEWER = `---
name: reviewer
description: Reviews a diff for correctness bugs.
tools: Read, Grep, Glob
model: inherit
---
You review diffs. Report each bug with file:line and a one-line fix.
`;

const readTools = definePackage({
  name: "read-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    for (const name of ["read", "write"])
      prism.tools.register({
        name,
        description: `${name} tool`,
        execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name, content: [] }),
      });
  },
});

/** Parent's first turn calls `delegate`, then answers; the child turn is the one without the delegate tool. */
function scripted(seen: Turn[], child = "reviewer"): ModelProvider {
  let parentCalls = 0;
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const listed = request.tools ?? [];
      const tools = listed.map((tool) => tool.name);
      const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
      seen.push({ tools, models: request.model.model, last, description: listed.find((tool) => tool.name === "delegate")?.description ?? "" });
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", { child, input: "go" } as never));
        else yield providerTextDelta("parent done");
      } else yield providerTextDelta("child answer");
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

async function build(options: { root: string; defaultInherit: readonly string[]; seen?: Turn[]; children?: Record<string, unknown>; child?: string }) {
  const seen = options.seen ?? [];
  return createAgent({
    id: "agents-file-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [scripted(seen, options.child)]),
      readTools,
      delegate({
        children: (options.children ?? {}) as never,
        agentsRoot: options.root,
        defaultInherit: options.defaultInherit,
      } as never),
    ],
  });
}

describe("delegate subagent files", () => {
  it("claude_subagent_file_becomes_child", () => {
    const root = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER });
    const { children, notes } = resolveAgentChildren({ children: {}, agentsRoot: root, defaultInherit: ["read-tools"] });
    assert.deepEqual(notes, []);
    const reviewer = children.reviewer;
    assert.ok(reviewer);
    assert.equal(reviewer.description, "Reviews a diff for correctness bugs.");
    assert.match(reviewer.instructions ?? "", /^You review diffs\./);
    assert.deepEqual(reviewer.tools?.only, ["read", "grep", "glob"]);
    assert.equal(reviewer.model, undefined);
    assert.deepEqual(reviewer.inherit, ["read-tools"]);
  });

  it("configured_child_wins_over_file", () => {
    const root = agentsRoot({ ".agents/agents/reviewer.md": REVIEWER });
    const { children, notes } = resolveAgentChildren({
      children: { reviewer: { inherit: [], instructions: "Configured reviewer." } },
      agentsRoot: root,
      defaultInherit: ["read-tools"],
    });
    assert.equal(children.reviewer.instructions, "Configured reviewer.");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.level, "info");
    assert.match(notes[0]?.text ?? "", /already defined in config/);
  });

  it("agents_dir_wins_over_claude_dir", () => {
    const root = agentsRoot({
      ".agents/agents/reviewer.md": REVIEWER.replace("Reviews a diff", "Agents helper"),
      ".claude/agents/reviewer.md": REVIEWER.replace("Reviews a diff", "Claude helper"),
    });
    const { children, notes } = resolveAgentChildren({ children: {}, agentsRoot: root, defaultInherit: [] });
    assert.match(children.reviewer?.description ?? "", /Agents helper/);
    assert.equal(notes.length, 1);
    assert.match(notes[0]?.text ?? "", /by another file/);
  });

  it("model_inherit_uses_parent_model_and_a_ref_is_used", async () => {
    const inherit = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER });
    const seenInherit: Turn[] = [];
    const agentInherit = await createAgent({
      id: "inherit-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-provider", [scripted(seenInherit)]),
        readTools,
        delegate({ children: {}, agentsRoot: inherit, defaultInherit: ["read-tools"] } as never),
      ],
    });
    const sessionInherit = await agentInherit.session();
    await sessionInherit.run("go");
    assert.equal(seenInherit.find((turn) => !turn.tools.includes("delegate"))?.models, "m");

    const explicit = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER.replace("model: inherit", "model: mock/other") });
    const seenExplicit: Turn[] = [];
    const agentExplicit = await createAgent({
      id: "explicit-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-provider", [scripted(seenExplicit)]),
        readTools,
        delegate({ children: {}, agentsRoot: explicit, defaultInherit: ["read-tools"] } as never),
      ],
    });
    const sessionExplicit = await agentExplicit.session();
    await sessionExplicit.run("go");
    assert.equal(seenExplicit.find((turn) => !turn.tools.includes("delegate"))?.models, "other");

    await agentInherit.dispose();
    await agentExplicit.dispose();
  });

  it("unmappable_tools_file_skipped_with_note", () => {
    const root = agentsRoot({ ".claude/agents/browser.md": REVIEWER.replace("tools: Read, Grep, Glob", "tools: WebFetch, Task") });
    const { children, notes } = resolveAgentChildren({ children: {}, agentsRoot: root, defaultInherit: [] });
    assert.deepEqual(Object.keys(children), []);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.level, "warn");
    assert.match(notes[0]?.text ?? "", /cannot map \(WebFetch, Task\)/);
  });

  it("malformed_agent_file_skipped_with_note", () => {
    const root = agentsRoot({ ".claude/agents/broken.md": "---\nname: broken\n\ttools: Read\n---\nbody\n" });
    const { children, notes } = resolveAgentChildren({ children: {}, agentsRoot: root, defaultInherit: [] });
    assert.deepEqual(Object.keys(children), []);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.level, "warn");
    assert.match(notes[0]?.text ?? "", /was skipped/);
  });

  it("agents_root_requires_default_inherit", async () => {
    const root = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER });
    assert.throws(() => resolveAgentChildren({ children: {}, agentsRoot: root }), /defaultInherit is required/);
    await assert.rejects(
      () =>
        createAgent({
          id: "no-inherit-parent",
          model: { provider: "mock", model: "m" },
          slots: { store: createMemorySessionStore() },
          packages: [providerPackage("mock-provider", [scripted([])]), delegate({ children: {}, agentsRoot: root } as never)],
        }),
      /defaultInherit is required/,
    );
  });

  it("file_child_cannot_exceed_default_inherit", async () => {
    const root = agentsRoot({
      ".claude/agents/reviewer.md": REVIEWER.replace("model: inherit", 'model: inherit\ninherit: ["@arnilo/prism-delegate"]'),
    });
    const { children } = resolveAgentChildren({ children: {}, agentsRoot: root, defaultInherit: ["read-tools"] });
    assert.deepEqual(children.reviewer?.inherit, ["read-tools"]);
    await assert.rejects(() => build({ root, defaultInherit: ["@arnilo/prism-delegate"] }), /cannot include @arnilo\/prism-delegate/);
  });

  it("file_child_runs_with_its_mapped_tools_only", async () => {
    const root = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER });
    const seen: Turn[] = [];
    const agent = await build({ root, defaultInherit: ["read-tools"], seen });
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    assert.match(result.text, /parent done/);
    const childTurn = seen.find((turn) => !turn.tools.includes("delegate"));
    assert.deepEqual(childTurn?.tools, ["read"]);
    assert.match(seen[0]?.description ?? "", /- reviewer: Reviews a diff for correctness bugs\./);
    await agent.dispose();
  });

  it("unavailable_tool_names_are_dropped_at_run_time", async () => {
    const root = agentsRoot({ ".claude/agents/reviewer.md": REVIEWER.replace("tools: Read, Grep, Glob", "tools: Read, Grep") });
    const seen: Turn[] = [];
    const agent = await build({ root, defaultInherit: ["read-tools"], seen });
    const session = await agent.session();
    const result = await session.run("go");
    const notes = agent.inspect().statusNotes;
    assert.equal(result.status, "completed");
    assert.deepEqual(seen.find((turn) => !turn.tools.includes("delegate"))?.tools, ["read"]);
    assert.ok(notes.some((note) => note.level === "info" && /does not register and they were dropped: grep/.test(note.message)));
    await agent.dispose();
  });
});
