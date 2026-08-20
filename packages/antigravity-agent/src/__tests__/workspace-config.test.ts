import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AntigravityWorkspaceConfigError,
  assertValidWorkspacePath,
  withEphemeralWorkspaceConfig,
  writeEphemeralWorkspaceConfig,
} from "../index.js";

test("assertValidWorkspacePath: validates directory and rejects invalid paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-agy-ws-test-"));
  try {
    const valid = assertValidWorkspacePath(dir);
    assert.equal(typeof valid, "string");
    assert.ok(valid.length > 0);

    // Empty or non-string
    assert.throws(() => assertValidWorkspacePath(""), AntigravityWorkspaceConfigError);
    assert.throws(() => assertValidWorkspacePath("   "), AntigravityWorkspaceConfigError);
    // @ts-expect-error test invalid type
    assert.throws(() => assertValidWorkspacePath(null), AntigravityWorkspaceConfigError);

    // Control characters
    assert.throws(() => assertValidWorkspacePath(`${dir}\0bad`), AntigravityWorkspaceConfigError);
    assert.throws(() => assertValidWorkspacePath(`${dir}\nbad`), AntigravityWorkspaceConfigError);

    // Non-existent path
    assert.throws(() => assertValidWorkspacePath(join(dir, "non-existent")), AntigravityWorkspaceConfigError);

    // File path instead of directory
    const filePath = join(dir, "some-file.txt");
    writeFileSync(filePath, "hello");
    assert.throws(() => assertValidWorkspacePath(filePath), AntigravityWorkspaceConfigError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeEphemeralWorkspaceConfig: creates .agents/mcp_config.json and cleans up atomically", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agy-ws-ephemeral-"));
  const globalMcpPath = join(homedir(), ".gemini", "config", "mcp_config.json");
  const globalMcpBefore = existsSync(globalMcpPath) ? readFileSync(globalMcpPath, "utf8") : null;

  try {
    const handle = writeEphemeralWorkspaceConfig({
      workspace: ws,
      serverName: "prism",
      mcpConfig: {
        command: "node",
        args: ["./mcp-server.js"],
        env: { FOO: "BAR" },
        disabledTools: ["dangerous_tool"],
      },
      allowedMcpTools: ["read_file", "edit_file"],
    });

    assert.equal(handle.workspace, ws);
    assert.ok(existsSync(handle.mcpConfigFile));
    assert.ok(existsSync(handle.settingsFile));

    const mcpConfig = JSON.parse(readFileSync(handle.mcpConfigFile, "utf8"));
    assert.deepEqual(mcpConfig.mcpServers.prism, {
      command: "node",
      args: ["./mcp-server.js"],
      env: { FOO: "BAR" },
      disabledTools: ["dangerous_tool"],
    });

    const settings = JSON.parse(readFileSync(handle.settingsFile, "utf8"));
    assert.deepEqual(settings.permissions.allow, ["mcp(prism/read_file)", "mcp(prism/edit_file)"]);

    // Restore
    await handle.restore();
    assert.equal(handle.restored, true);

    // .agents should be removed because it was empty and created by us
    assert.ok(!existsSync(handle.mcpConfigFile));
    assert.ok(!existsSync(handle.settingsFile));
    assert.ok(!existsSync(handle.agentsDir));

    // Global MCP config must remain untouched
    const globalMcpAfter = existsSync(globalMcpPath) ? readFileSync(globalMcpPath, "utf8") : null;
    assert.equal(globalMcpBefore, globalMcpAfter, "global MCP config was modified");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralWorkspaceConfig: preserves and restores pre-existing mcp_config.json and settings.json", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agy-ws-backup-"));
  const agentsDir = join(ws, ".agents");
  mkdirSync(agentsDir, { recursive: true });

  const originalMcpConfig = JSON.stringify({ mcpServers: { other: { command: "python" } } }, null, 2);
  const originalSettings = JSON.stringify({ permissions: { allow: ["run_command"] } }, null, 2);
  writeFileSync(join(agentsDir, "mcp_config.json"), originalMcpConfig);
  writeFileSync(join(agentsDir, "settings.json"), originalSettings);

  try {
    const handle = writeEphemeralWorkspaceConfig({
      workspace: ws,
      serverName: "prism",
      mcpConfig: {
        serverUrl: "http://127.0.0.1:9999/mcp",
        headers: { authorization: "Bearer token123" },
      },
    });

    // Check overwrite
    const mcpConfig = JSON.parse(readFileSync(handle.mcpConfigFile, "utf8"));
    assert.deepEqual(mcpConfig.mcpServers.prism, {
      serverUrl: "http://127.0.0.1:9999/mcp",
      headers: { authorization: "Bearer token123" },
    });

    // Restore
    await handle.restore();

    // Verify original content restored
    assert.equal(readFileSync(handle.mcpConfigFile, "utf8"), originalMcpConfig);
    assert.equal(readFileSync(handle.settingsFile, "utf8"), originalSettings);
    assert.ok(existsSync(agentsDir));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralWorkspaceConfig: prevents concurrent run collisions on the same workspace", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agy-ws-lock-"));
  try {
    const handle1 = writeEphemeralWorkspaceConfig({
      workspace: ws,
      mcpConfig: { command: "node" },
    });

    // Second write on same workspace must throw locked error
    assert.throws(
      () =>
        writeEphemeralWorkspaceConfig({
          workspace: ws,
          mcpConfig: { command: "node" },
        }),
      {
        name: "AntigravityWorkspaceConfigError",
        message: /currently locked by an active run/,
      },
    );

    // After restoring handle1, lock is released
    await handle1.restore();

    const handle2 = writeEphemeralWorkspaceConfig({
      workspace: ws,
      mcpConfig: { command: "node" },
    });
    assert.ok(handle2);
    await handle2.restore();
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralWorkspaceConfig: rejects symlink escape", () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agy-symlink-test-"));
  const outside = join(root, "outside");
  const inside = join(root, "inside");
  mkdirSync(outside, { recursive: true });
  mkdirSync(inside, { recursive: true });

  try {
    // Create .agents as a symlink pointing outside the workspace
    symlinkSync(outside, join(inside, ".agents"), "dir");

    assert.throws(
      () =>
        writeEphemeralWorkspaceConfig({
          workspace: inside,
          mcpConfig: { command: "node" },
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

test("withEphemeralWorkspaceConfig: restores backup even if consumer throws", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agy-ws-with-"));
  try {
    await assert.rejects(async () => {
      await withEphemeralWorkspaceConfig(
        {
          workspace: ws,
          mcpConfig: { command: "node" },
        },
        async (handle) => {
          assert.ok(existsSync(handle.mcpConfigFile));
          throw new Error("Consumer failure");
        },
      );
    }, /Consumer failure/);

    // Ephemeral config must be cleaned up
    assert.ok(!existsSync(join(ws, ".agents", "mcp_config.json")));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("writeEphemeralWorkspaceConfig: integrates toolPolicy to configure permissions allow and deny", async () => {
  const ws = mkdtempSync(join(tmpdir(), "prism-agy-ws-policy-"));
  try {
    const handle = writeEphemeralWorkspaceConfig({
      workspace: ws,
      serverName: "prism",
      mcpConfig: { command: "node" },
      allowedMcpTools: ["read_file", "edit_file"],
      toolPolicy: "prism-mutators",
    });

    assert.ok(existsSync(handle.settingsFile));
    const settings = JSON.parse(readFileSync(handle.settingsFile, "utf8"));

    // Scoped MCP tools allowed
    assert.ok(settings.permissions.allow.includes("mcp(prism/read_file)"));
    assert.ok(settings.permissions.allow.includes("mcp(prism/edit_file)"));

    // Mutator builtins denied
    assert.ok(settings.permissions.deny.includes("builtin(run_command)"));
    assert.ok(settings.permissions.deny.includes("builtin(write_to_file)"));
    assert.ok(settings.permissions.deny.includes("builtin(replace_file_content)"));

    await handle.restore();
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
