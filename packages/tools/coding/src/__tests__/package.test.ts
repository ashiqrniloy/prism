import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "@arnilo/prism";
import {
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import toolsCoding from "../index.js";
import { createNativeSandbox } from "../security/native-sandbox.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-tools-coding-"));
  dirs.push(dir);
  return dir;
}

const EXPECTED_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  read: ["read"],
  grep: ["read"],
  glob: ["read"],
  write: ["write"],
  edit: ["write"],
  shell: ["execute"],
  shell_output: ["execute"],
  git_status: ["read"],
  git_diff: ["read"],
  git_commit: ["write"],
  git_pr_handoff: ["external", "network"],
  todo_write: [],
  ask_user_decision: [],
};

describe("@arnilo/prism-tools/coding package", () => {
  it("tools_coding_package_conformance", async () => {
    const root = await tempRoot();
    const result = await packageConformance(toolsCoding({ root }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_coding_registers_file_tools_with_effects", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), Object.keys(EXPECTED_EFFECTS).sort());
      for (const tool of agent.tools) {
        assert.deepEqual(tool.effects, EXPECTED_EFFECTS[tool.name], `${tool.name} must declare its effects`);
        assert.equal(tool.package, "@arnilo/prism-tools/coding");
      }
    } finally {
      await agent.dispose();
    }
  });

  it("default_tool_set_is_the_documented_list", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), [
        "ask_user_decision",
        "edit",
        "git_commit",
        "git_diff",
        "git_pr_handoff",
        "git_status",
        "glob",
        "grep",
        "read",
        "shell",
        "shell_output",
        "todo_write",
        "write",
      ]);
    } finally {
      await agent.dispose();
    }
  });

  it("background_is_absent_without_a_process_capable_sandbox", async () => {
    const root = await tempRoot();
    // The native backend implements one-shot exec only, so it cannot start a long-running process.
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, sandbox: "native" })],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      // Hosts that refuse unprivileged user namespaces (GitHub's Ubuntu runners) fail the unshare
      // preflight; the sandbox then fails closed and shell is not registered at all.
      const nativeAvailable = await createNativeSandbox({ root }).then(
        async (sandbox) => (await sandbox.close(), true),
        () => false,
      );
      assert.equal(names.includes("shell"), nativeAvailable, `shell registered iff native works, got ${names.join(", ")}`);
      assert.equal(names.includes("shell_output"), false, "no process backend, no shell_output");
    } finally {
      await agent.dispose();
    }
  });

  it("diagnostics_absent_without_language_config", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root })] });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name === "diagnostics"),
        false,
        "no language.servers config, no diagnostics tool",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("diagnostics_registers_with_language_servers_and_starts_nothing", async () => {
    const root = await tempRoot();
    const pidFile = join(root, "fake-lsp.pid");
    const fakeLsp = fileURLToPath(new URL("../agent/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsCoding({
          root,
          language: {
            servers: {
              ts: {
                command: process.execPath,
                args: [fakeLsp],
                languages: ["typescript"],
                env: { FAKE_LSP_PULL: "1", FAKE_LSP_PID_FILE: pidFile },
              },
            },
          },
        }),
      ],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.equal(names.includes("diagnostics"), true, `diagnostics registers, got ${names.join(", ")}`);
      // Loading the package and registering the tool starts no server (the plan's load-cost check).
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(pidFile), false, "no language server before the first call");
    } finally {
      await agent.dispose();
    }
  });

  it("language_servers_stop_when_the_last_session_closes", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "a.ts"), "const a = 1;\n");
    const pidFile = join(root, "fake-lsp.pid");
    const fakeLsp = fileURLToPath(new URL("../agent/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("c1", "diagnostics", { path: "a.ts" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      ownership: { tenantId: "local" },
      packages: [
        provider,
        toolsCoding({
          root,
          language: {
            servers: {
              ts: {
                command: process.execPath,
                args: [fakeLsp],
                languages: ["typescript"],
                env: { FAKE_LSP_PULL: "1", FAKE_LSP_PID_FILE: pidFile },
              },
            },
          },
        }),
      ],
    });
    try {
      const session = await agent.session({ id: "diagnostics-session", create: true });
      await session.run("check the file");
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      assert.ok(pid > 0, "the language server started on the first call");
      process.kill(pid, 0); // throws when it never started
      await session.close();
      const deadline = Date.now() + 3000;
      let dead = false;
      while (!dead && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          dead = true;
        }
      }
      assert.equal(dead, true, "the language server must not outlive the last session");
    } finally {
      await agent.dispose();
    }
  }, 20_000);

  it("tools_coding_read_only_registers_read_subset", async () => {
    const root = await tempRoot();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, readOnly: true })] });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["glob", "grep", "read"]);
    } finally {
      await agent.dispose();
    }
  });

  it("tools_coding_shell_disabled_omits_shell", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, shell: { enabled: false } })],
    });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name === "shell"),
        false,
      );
      // shell gone => delete and move take its place.
      assert.deepEqual(
        agent.tools
          .map((tool) => tool.name)
          .filter((name) => name === "delete" || name === "move")
          .sort(),
        ["delete", "move"],
      );
      assert.equal(agent.tools.length, 13);
    } finally {
      await agent.dispose();
    }
  });

  it("tools_coding_unknown_config_key_fails_closed", async () => {
    const root = await tempRoot();
    await assert.rejects(
      createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, bogus: 1 } as never)] }),
      /bogus/,
    );
  });

  it("tools_coding_edit_round_trip_on_mock_provider", async () => {
    const root = await tempRoot();
    const path = join(root, "file.txt");
    await writeFile(path, "before\n");
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("call-1", "edit", { path, edits: [{ oldText: "before", newText: "after" }] })), providerDone()],
        [providerTextDelta("ok"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [provider, toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "edit-round-trip", create: true });
      await session.run("edit the file");
      await session.close();
      assert.equal(await readFile(path, "utf8"), "after\n");
    } finally {
      await agent.dispose();
    }
  });

  it("tools_coding_loads_no_heavy_dependency", async () => {
    const script = [
      'const pkg = (await import("@arnilo/prism-tools/coding")).default;',
      'const { createAgent } = await import("@arnilo/prism");',
      'const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [pkg({ root: process.cwd() })] });',
      "const names = agent.tools.map((tool) => tool.name);",
      "await agent.dispose();",
      "console.log(JSON.stringify({ names }));",
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { names: string[] };
    assert.equal(probe.names.includes("shell"), true);
  });

  it("coding_unsandboxed_shell_warns", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root })],
    });
    try {
      const inspect = agent.inspect();
      const warnNote = inspect.statusNotes.find(
        (n) =>
          n.package === "@arnilo/prism-tools/coding" &&
          n.level === "warn" &&
          n.message === "shell runs on the host without a sandbox; pair it with @arnilo/prism-extensions/approval or set sandbox",
      );
      assert.ok(warnNote, "warn note emitted when shell runs on the host without sandbox");
    } finally {
      await agent.dispose();
    }
  });

  it("coding_sandboxed_shell_no_warn", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, sandbox: "docker" })],
    });
    try {
      const inspect = agent.inspect();
      const warnNote = inspect.statusNotes.find(
        (n) => n.level === "warn" && n.message.includes("shell runs on the host without a sandbox"),
      );
      assert.equal(warnNote, undefined, "no unsandboxed shell warning when sandbox is configured");
    } finally {
      await agent.dispose();
    }
  });

  it("coding_shell_disabled_no_warn", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, shell: { enabled: false } })],
    });
    try {
      const inspect = agent.inspect();
      const warnNote = inspect.statusNotes.find(
        (n) => n.level === "warn" && n.message.includes("shell runs on the host without a sandbox"),
      );
      assert.equal(warnNote, undefined, "no unsandboxed shell warning when shell is disabled");
    } finally {
      await agent.dispose();
    }
  });
});
