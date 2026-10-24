import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, definePackage, type ToolCallDecision } from "@arnilo/prism";
import {
  loopConformance,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
  twoTurnProvider,
} from "@arnilo/prism/testing";
import toolsCoding, { createCodingTargets, createEditTool, createHardDenyHook, createReadTool } from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-hard-deny-"));
  dirs.push(dir);
  return dir;
}

/** Assert a deny decision and return its reason. */
function denyReason(decision: ToolCallDecision | undefined): string {
  assert.ok(
    decision !== undefined && typeof decision === "object" && "deny" in decision,
    `expected a deny, got ${JSON.stringify(decision)}`,
  );
  return decision.deny;
}

function toolResults(entries: readonly { kind: string; message?: { content: readonly unknown[] } }[]) {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? (entry.message.content.filter(
          (block): block is { type: "tool_result"; error?: { code: string; message: string } } =>
            (block as { type: string }).type === "tool_result",
        ) as { type: "tool_result"; error?: { code: string; message: string } }[])
      : [],
  );
}

describe("tools-coding hard denies", () => {
  it("hard_deny_root_escape_in_auto_mode", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", "outside.txt");
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
      packages: [provider, toolsCoding({ root })],
      hooks: (hooks) => hooks.on("tool.call", () => "allow"),
    });
    try {
      const session = await agent.session({ id: "hard-deny-escape", create: true });
      await session.run("edit it");
      await session.close();
      const denied = toolResults(await session.entries()).find((block) => block.error !== undefined);
      assert.ok(denied, "root escape was not denied");
      assert.equal(denied.error?.code, "hook_denied");
      assert.match(denied.error?.message ?? "", /outside coding roots/);
      assert.match(denied.error?.message ?? "", /edit/);
    } finally {
      await agent.dispose();
    }
  });

  it("hard_deny_symlink_escape", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", `outside-${Date.now()}.txt`);
    await writeFile(outside, "secret");
    const link = join(root, "link.txt");
    await symlink(outside, link);
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: false });
    const decision = await deny({ name: "read", args: { path: link }, effects: ["read"], callId: "c", sessionId: "s", runId: "r" });
    assert.match(denyReason(decision), /outside coding roots/);
    assert.match(denyReason(decision), /read/);
  });

  it("hard_deny_grep_path_outside_roots", async () => {
    const root = await tempRoot();
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: false });
    const decision = await deny({
      name: "grep",
      args: { pattern: "x", path: ".." },
      effects: ["read"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.match(denyReason(decision), /outside coding roots/);
    assert.match(denyReason(decision), /grep/);
    const inside = await deny({
      name: "grep",
      args: { pattern: "x", path: "." },
      effects: ["read"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.equal(inside, undefined, "a search inside the roots is not a hard deny");
  });

  it("diagnostics_path_outside_roots_is_hard_denied", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "const a = 1;\n");
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: false });
    const decision = await deny({
      name: "diagnostics",
      args: { path: "../outside.ts" },
      effects: ["read"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.match(denyReason(decision), /outside coding roots/);
    assert.match(denyReason(decision), /diagnostics/);
    const inside = await deny({
      name: "diagnostics",
      args: { path: "src/a.ts" },
      effects: ["read"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.equal(inside, undefined, "a file inside the roots is not a hard deny");
  });

  it("hard_deny_holds_under_rewrite", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", `outside-rewritten-${Date.now()}.txt`);
    const targets = createCodingTargets(root, []);
    const { result, session } = await loopConformance({
      tools: [createEditTool(root)],
      provider: twoTurnProvider({ id: "c1", name: "edit", args: { path: join(root, "a.txt"), edits: [{ oldText: "a", newText: "b" }] } }),
      hooks: (hooks) => {
        // A host hook rewrites the call outside the roots after the first gate pass.
        hooks.on("tool.call", (call) => ({ rewrite: { ...call.args, path: outside } }));
        hooks.on("tool.call", createHardDenyHook({ targets, readOnly: false }));
      },
    });
    assert.equal(result?.status, "completed");
    const denied = toolResults(await session.entries()).find((block) => block.error !== undefined);
    assert.ok(denied, "a rewrite escaped the hard deny");
    assert.equal(denied.error?.code, "hook_denied");
    assert.match(denied.error?.message ?? "", /outside coding roots/);
    assert.equal(existsSync(outside), false, "the rewritten path must never execute");
  });

  it("hard_deny_from_custom_loop", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", "outside-loop.txt");
    const targets = createCodingTargets(root, []);
    const { result, session } = await loopConformance({
      tools: [createEditTool(root)],
      provider: twoTurnProvider({ id: "c1", name: "edit", args: { path: outside, edits: [{ oldText: "a", newText: "b" }] } }),
      hooks: (hooks) => {
        hooks.on("tool.call", createHardDenyHook({ targets, readOnly: false }));
        hooks.on("tool.call", () => "allow");
      },
    });
    assert.equal(result?.status, "completed");
    const denied = toolResults(await session.entries()).find((block) => block.error !== undefined);
    assert.ok(denied, "custom loop ran a root-escape tool");
    assert.equal(denied.error?.code, "hook_denied");
  });

  it("hard_deny_command_rule", async () => {
    const root = await tempRoot();
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({
      targets,
      readOnly: false,
      commandRules: [{ pattern: "rm -rf /", action: "deny", reason: "destructive" }],
    });
    const decision = await deny({
      name: "shell",
      args: { command: "rm -rf / --no-preserve-root" },
      effects: ["execute"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.match(denyReason(decision), /destructive/);
    const allowed = await deny({ name: "shell", args: { command: "ls" }, effects: ["execute"], callId: "c", sessionId: "s", runId: "r" });
    assert.equal(allowed, undefined);
  });

  it("hard_deny_read_only_denies_mutation", async () => {
    const root = await tempRoot();
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: true });
    const decision = await deny({
      name: "write",
      args: { path: join(root, "a.txt"), content: "x" },
      effects: ["write"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.match(denyReason(decision), /read-only/);
  });

  it("hard_deny_ignores_foreign_tools", async () => {
    const root = await tempRoot();
    const outside = join(root, "..", "foreign.txt");
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: true });
    const decision = await deny({
      name: "host_edit",
      args: { path: outside },
      effects: ["write"],
      callId: "c",
      sessionId: "s",
      runId: "r",
    });
    assert.equal(decision, undefined);
  });

  it("hard_deny_decision_budget", async () => {
    const root = await tempRoot();
    const file = join(root, "inside.txt");
    await writeFile(file, "x");
    const targets = createCodingTargets(root, []);
    const deny = createHardDenyHook({ targets, readOnly: false });
    const payload = { name: "read", args: { path: file }, effects: ["read"] as const, callId: "c", sessionId: "s", runId: "r" };
    // Best of three batches: the budget catches a realpath-per-root or directory-walk regression,
    // so a single preempted batch under a loaded test runner must not fail it.
    let best = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      for (let i = 0; i < 1_000; i += 1) await deny(payload);
      best = Math.min(best, performance.now() - started);
    }
    assert.ok(best < 50, `1000 decisions took ${best.toFixed(1)}ms`);
  });

  it("read_under_skill_dir_outside_root_allowed_and_write_denied", async () => {
    const root = await tempRoot();
    const skillDir = join(await tempRoot(), "pdf");
    await mkdir(join(skillDir, "references"), { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(skillPath, "---\nname: pdf\ndescription: PDFs\n---\nRead references.");
    const reference = join(skillDir, "references", "forms.md");
    await writeFile(reference, "secret reference\n");

    let consume: (() => unknown) | undefined;
    const probe = definePackage({
      name: "@test/coding-skill-roots-probe",
      version: "0.0.1",
      requires: { api: 1 },
      setup: (prism) => {
        consume = () => prism.services.consume("coding.targets");
      },
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root }), probe],
      skills: { add: [{ name: "pdf", instructions: "Use pdf.", path: skillPath }] },
    });
    try {
      const targets = consume?.() as ReturnType<typeof createCodingTargets>;
      assert.ok(targets);
      assert.deepEqual(targets("read", { path: reference })?.roots, [root, skillDir]);
      assert.deepEqual(targets("write", { path: reference })?.roots, [root]);
      assert.deepEqual(targets("shell", { command: "ls" })?.roots, [root]);

      const deny = createHardDenyHook({ targets, readOnly: false });
      assert.equal(
        await deny({ name: "read", args: { path: reference }, effects: ["read"], callId: "c1", sessionId: "s", runId: "r" }),
        undefined,
        "a skill reference is readable",
      );
      assert.match(
        denyReason(
          await deny({
            name: "write",
            args: { path: reference, content: "x" },
            effects: ["write"],
            callId: "c2",
            sessionId: "s",
            runId: "r",
          }),
        ),
        /outside coding roots/,
      );

      const read = await createReadTool(root).execute({ path: reference }, { sessionId: "s", runId: "r", toolCallId: "c3" });
      assert.equal(read.error, undefined);
      assert.match(JSON.stringify(read.content), /secret reference/);
    } finally {
      await agent.dispose();
    }
  });

  it("skill_dir_symlink_escape_denied", async () => {
    const root = await tempRoot();
    const skillDir = join(await tempRoot(), "pdf");
    await mkdir(join(skillDir, "references"), { recursive: true });
    const secret = join(await tempRoot(), "secret.txt");
    await writeFile(secret, "do not read\n");
    const link = join(skillDir, "references", "leak.md");
    await symlink(secret, link);
    const targets = createCodingTargets(root, [], undefined, () => [{ name: "pdf", path: join(skillDir, "SKILL.md") }]);
    const deny = createHardDenyHook({ targets, readOnly: false });
    assert.match(
      denyReason(await deny({ name: "read", args: { path: link }, effects: ["read"], callId: "c", sessionId: "s", runId: "r" })),
      /outside coding roots/,
    );
  });

  it("targets_roots_follow_skill_list_changes", async () => {
    const root = await tempRoot();
    const first = await tempRoot();
    const second = await tempRoot();
    let skills: readonly { name: string; path: string }[] = [];
    const targets = createCodingTargets(root, [], undefined, () => skills);
    assert.deepEqual(targets("read", { path: "a" })?.roots, [root]);
    skills = [{ name: "one", path: join(first, "SKILL.md") }];
    assert.deepEqual(targets("read", { path: "a" })?.roots, [root, first]);
    skills = [...skills, { name: "two", path: join(second, "SKILL.md") }];
    for (const name of ["read", "glob", "grep", "diagnostics"]) {
      assert.deepEqual(targets(name, { pattern: "x", path: "a" })?.roots, [root, first, second], name);
    }
    for (const name of ["write", "edit", "delete", "move", "shell", "shell_output"]) {
      assert.deepEqual(targets(name, { path: "a", from: "a", to: "b", command: "ls" })?.roots, [root], name);
    }
    skills = [];
    assert.deepEqual(targets("read", { path: "a" })?.roots, [root]);
  });

  it("coding_targets_service_reports_paths", async () => {
    const root = await tempRoot();
    const targets = createCodingTargets(root, [join(root, "shared")]);
    const edit = targets("edit", { path: "a.txt" });
    assert.deepEqual(edit?.paths, [join(root, "a.txt")]);
    assert.deepEqual(edit?.roots, [root, join(root, "shared")]);
    assert.deepEqual(targets("move", { from: "a", to: "b" })?.paths, [join(root, "a"), join(root, "b")]);
    assert.deepEqual(targets("shell", { command: "ls" }), { paths: [], roots: [root, join(root, "shared")] });
    assert.equal(targets("unknown_tool", {}), undefined);

    let consume: (() => unknown) | undefined;
    const probe = definePackage({
      name: "@test/coding-targets-probe",
      version: "0.0.1",
      requires: { api: 1 },
      setup: (prism) => {
        consume = () => prism.services.consume("coding.targets");
      },
    });
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root }), probe] });
    try {
      const service = consume?.() as typeof targets;
      assert.ok(service);
      assert.deepEqual(service("edit", { path: "b.txt" })?.paths, [join(root, "b.txt")]);
    } finally {
      await agent.dispose();
    }
  });
});
