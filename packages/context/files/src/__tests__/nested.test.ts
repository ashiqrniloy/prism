import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Agent,
  AgentState,
  ContextDraft,
  HookContext,
  JsonValue,
  Message,
  PackageAPI,
  ProviderEvent,
  ProviderRequest,
  SessionContext,
  SessionLog,
  ToolDefinition,
} from "@arnilo/prism";
import { createAgent, createPathTrustPolicy, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { type ContextFilesConfig, contextFiles } from "../index.js";
import { projectNestedInstructions, type ResolvedNestedConfig, resolveNestedConfig } from "../nested.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-nested-"));
  dirs.push(dir);
  return dir;
}

const read: ToolDefinition = {
  name: "read",
  description: "Read a file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute: (args, context) => ({ toolCallId: context.toolCallId, name: "read", value: `contents of ${String(args.path)}` }),
};

function provider(script: readonly (readonly ProviderEvent[])[], captured: ProviderRequest[]) {
  return mockProvider(script, { onRequest: (request) => captured.push(request) });
}

function readCall(id: string, path: string) {
  return providerToolCall(toolCallContent(id, "read", { path }));
}

function nestedText(request: ProviderRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.content.flatMap((part) => (part.type === "text" && part.text.startsWith("[context-files]") ? [part.text] : [])),
  );
}

function toolMessages(request: ProviderRequest | undefined) {
  return (request?.messages ?? []).filter((message) => message.role === "tool");
}

function notes(agent: Agent): string {
  return agent
    .inspect()
    .statusNotes.map((note) => `${note.level}:${note.message}`)
    .join("\n");
}

async function run(
  root: string,
  script: readonly (readonly ProviderEvent[])[],
  config: Omit<ContextFilesConfig, "root"> = {},
): Promise<{ agent: Agent; captured: ProviderRequest[] }> {
  const captured: ProviderRequest[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [provider(script, captured), contextFiles({ root, ...config })],
    tools: { add: [read] },
  });
  return { agent, captured };
}

function draftWithRead(callId: string): ContextDraft {
  const call = { type: "tool_call" as const, id: callId, name: "read", arguments: { path: "pkg/a.ts" } };
  const tool: Message = {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: callId, name: "read", result: "file body" }],
  };
  return { messages: [{ role: "user", content: [{ type: "text", text: "go" }] }, { role: "assistant", content: [call] }, tool] };
}

describe("context-files nested instructions", () => {
  it("nested_agents_md_appended_to_first_touching_tool_result", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg", "src"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "NESTED RULE");
    const { agent, captured } = await run(root, [[readCall("c1", "pkg/src/a.ts"), providerDone()], [providerDone()]]);
    const session = await agent.session();
    try {
      await session.run("hi");
      const tool = toolMessages(captured[1])[0];
      assert.ok(tool);
      assert.equal(nestedText(captured[1]).length, 1);
      assert.match(nestedText(captured[1])[0]!, /^\[context-files\] Instructions for pkg\/ \(from pkg\/AGENTS.md\):\nNESTED RULE$/);
      assert.deepEqual(tool.metadata?.contextFiles, ["pkg/AGENTS.md"]);
      assert.equal(tool.metadata?.source, "context-files-nested");
      assert.equal(JSON.stringify(session.messages()).includes("NESTED RULE"), false, "nested instructions reached the stored transcript");
    } finally {
      await agent.dispose();
    }
  });

  it("nested_insertion_once_per_directory", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "ONE");
    const { agent, captured } = await run(root, [
      [readCall("c1", "pkg/a.ts"), readCall("c2", "pkg/b.ts"), providerDone()],
      [providerDone()],
    ]);
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(nestedText(captured[1]).length, 1, "two reads in one subtree inserted twice");
      await session.run("again");
      assert.equal(nestedText(captured[2]).length, 1, "a later turn reinserted the same directory");
    } finally {
      await agent.dispose();
    }
  });

  it("nested_insertion_bytes_frozen_after_file_change", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "OLD");
    const { agent, captured } = await run(root, [
      [readCall("c1", "pkg/a.ts"), providerDone()],
      [providerDone()],
      [readCall("c2", "pkg/b.ts"), providerDone()],
      [providerDone()],
    ]);
    const session = await agent.session();
    try {
      await session.run("one");
      const old = nestedText(captured[1]);
      assert.equal(old.length, 1);
      await writeFile(join(root, "pkg", "AGENTS.md"), "NEW");
      await session.run("two");
      assert.deepEqual(nestedText(captured[3]), old, "the frozen insertion changed after the file edit");
      assert.equal(nestedText(captured[3]).join("\n").includes("NEW"), false);
    } finally {
      await agent.dispose();
    }
  });

  it("nested_insertion_reappears_after_compaction_on_next_touch", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "BEFORE");
    const records: JsonValue[] = [];
    const insertions = {
      entries: () => records,
      append: async (_session: SessionContext, value: JsonValue) => {
        records.push(value);
      },
    } as SessionLog<JsonValue>;
    const state = { get: () => new Map(), set: () => {} } as unknown as AgentState<never>;
    const prism = { status: { note: () => {} } } as unknown as PackageAPI<ContextFilesConfig>;
    const context = { session: { id: "session" } } as unknown as HookContext;
    const plan = { root, trust: createPathTrustPolicy({ trustedRoots: [root] }) };
    const config = resolveNestedConfig(true) as ResolvedNestedConfig;

    const before = draftWithRead("c1");
    const first = await projectNestedInstructions(before, context, prism, plan, config, insertions, state);
    assert.match(JSON.stringify(first?.messages), /BEFORE/);
    assert.equal(records.length, 1);

    // Compaction drops the anchoring tool result. The directory is touched again with a new call.
    await writeFile(join(root, "pkg", "AGENTS.md"), "AFTER");
    const compacted = draftWithRead("c2");
    const second = await projectNestedInstructions(compacted, context, prism, plan, config, insertions, state);
    assert.match(JSON.stringify(second?.messages), /AFTER/);
    assert.equal(JSON.stringify(second?.messages).includes("BEFORE"), false);
    assert.equal(records.length, 2);
  });

  it("nested_claude_md_used_when_agents_md_absent", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "CLAUDE.md"), "CLAUDE RULE");
    const { agent, captured } = await run(root, [[readCall("c1", "pkg/a.ts"), providerDone()], [providerDone()]]);
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.match(nestedText(captured[1])[0]!, /from pkg\/CLAUDE\.md\):\nCLAUDE RULE/);
    } finally {
      await agent.dispose();
    }
  });

  it("nested_file_escaping_trusted_root_skipped", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const external = join(outside, "AGENTS.md");
    await writeFile(external, "ESCAPED");
    await mkdir(join(root, "pkg"), { recursive: true });
    await symlink(external, join(root, "pkg", "AGENTS.md"));
    const { agent, captured } = await run(root, [[readCall("c1", "pkg/a.ts"), providerDone()], [providerDone()]]);
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.deepEqual(nestedText(captured[1]), []);
      assert.match(notes(agent), /outside trusted roots/);
    } finally {
      await agent.dispose();
    }
  });

  it("nested_over_limits_skipped_with_note", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "123456");
    const { agent, captured } = await run(root, [[readCall("c1", "pkg/a.ts"), providerDone()], [providerDone()]], {
      nested: { maxFileBytes: 5 },
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.deepEqual(nestedText(captured[1]), []);
      assert.match(notes(agent), /maxFileBytes/);
    } finally {
      await agent.dispose();
    }
  });

  it("nested_max_files_skips_the_next_path_with_one_note", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "a"), { recursive: true });
    await mkdir(join(root, "b"), { recursive: true });
    await writeFile(join(root, "a", "AGENTS.md"), "A");
    await writeFile(join(root, "b", "AGENTS.md"), "B");
    const { agent, captured } = await run(root, [[readCall("c1", "a/x.ts"), readCall("c2", "b/y.ts"), providerDone()], [providerDone()]], {
      nested: { maxFiles: 1 },
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(nestedText(captured[1]).length, 1);
      assert.match(nestedText(captured[1])[0]!, /from a\/AGENTS.md/);
      assert.match(notes(agent), /maxFiles/);
    } finally {
      await agent.dispose();
    }
  });

  it("nested_false_restores_root_only_behavior", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "pkg", "AGENTS.md"), "DISABLED");
    const { agent, captured } = await run(root, [[readCall("c1", "pkg/a.ts"), providerDone()], [providerDone()]], { nested: false });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.deepEqual(nestedText(captured[1]), []);
    } finally {
      await agent.dispose();
    }
  });

  it("path_outside_root_ignored", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(join(outside, "AGENTS.md"), "OUTSIDE");
    const { agent, captured } = await run(root, [[readCall("c1", join(outside, "a.ts")), providerDone()], [providerDone()]]);
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.deepEqual(nestedText(captured[1]), []);
    } finally {
      await agent.dispose();
    }
  });
});
