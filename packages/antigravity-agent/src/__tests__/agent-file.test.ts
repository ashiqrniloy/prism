import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AntigravityWorkspaceConfigError, buildCustomAgentMarkdown, withEphemeralAgentFile, writeEphemeralAgentFile } from "../index.js";

test("buildCustomAgentMarkdown: generates YAML frontmatter and body", () => {
  const md = buildCustomAgentMarkdown({
    agentName: "prism-agent",
    description: "Custom agent for testing",
    systemPrompt: "Do helpful coding",
    mainAgent: true,
    inheritMcp: true,
  });

  assert.match(md, /^---\nname: prism-agent\ndescription: Custom agent for testing\nmainAgent: true\ninheritMcp: true\n---/);
  assert.match(md, /## System Instructions\nDo helpful coding/);

  // Invalid agent name throws
  assert.throws(() => buildCustomAgentMarkdown({ agentName: "invalid name with spaces" }), AntigravityWorkspaceConfigError);
  assert.throws(() => buildCustomAgentMarkdown({ agentName: "invalid/slash" }), AntigravityWorkspaceConfigError);
  assert.throws(() => buildCustomAgentMarkdown({ agentName: "" }), AntigravityWorkspaceConfigError);
});

test("writeEphemeralAgentFile: creates agent.md and cleans up atomically", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agent-file-test-"));
  try {
    const handle = writeEphemeralAgentFile({
      workspace: ws,
      agentName: "prism-worker",
      systemPrompt: "Worker instructions",
    });

    assert.equal(handle.workspace, ws);
    assert.equal(handle.agentName, "prism-worker");
    assert.ok(existsSync(handle.agentFile));

    const content = readFileSync(handle.agentFile, "utf8");
    assert.match(content, /^---\nname: prism-worker/);
    assert.match(content, /Worker instructions/);

    // Restore
    await handle.restore();
    assert.equal(handle.restored, true);

    // .agents/agents/prism-worker should be cleaned up
    assert.ok(!existsSync(handle.agentFile));
    assert.ok(!existsSync(handle.agentDir));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralAgentFile: preserves and restores pre-existing agent.md", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agent-backup-"));
  const agentDir = join(ws, ".agents", "agents", "prism-existing");
  mkdirSync(agentDir, { recursive: true });

  const originalContent = "---\nname: prism-existing\n---\nOriginal content\n";
  const agentFile = join(agentDir, "agent.md");
  writeFileSync(agentFile, originalContent);

  try {
    const handle = writeEphemeralAgentFile({
      workspace: ws,
      agentName: "prism-existing",
      systemPrompt: "Overwritten instructions",
    });

    // Content should be overwritten
    const newContent = readFileSync(handle.agentFile, "utf8");
    assert.match(newContent, /Overwritten instructions/);

    // Restore
    await handle.restore();

    // Verify original content restored
    assert.equal(readFileSync(agentFile, "utf8"), originalContent);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralAgentFile: rejects symlink escape outside workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-symlink-"));
  const outside = join(root, "outside");
  const inside = join(root, "inside");
  mkdirSync(outside, { recursive: true });
  mkdirSync(inside, { recursive: true });

  try {
    // Create .agents pointing outside workspace
    symlinkSync(outside, join(inside, ".agents"), "dir");

    assert.throws(
      () =>
        writeEphemeralAgentFile({
          workspace: inside,
          agentName: "prism-escape",
        }),
      {
        name: "AntigravityWorkspaceConfigError",
        message: /escapes workspace boundary/,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withEphemeralAgentFile: restores file even if consumer throws", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agent-with-"));
  try {
    await assert.rejects(async () => {
      await withEphemeralAgentFile(
        {
          workspace: ws,
          agentName: "prism-throw",
          systemPrompt: "Test instructions",
        },
        async (handle) => {
          assert.ok(existsSync(handle.agentFile));
          throw new Error("Consumer failed in withEphemeralAgentFile");
        },
      );
    }, /Consumer failed/);

    // Ephemeral agent file must be cleaned up
    assert.ok(!existsSync(join(ws, ".agents", "agents", "prism-throw", "agent.md")));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
