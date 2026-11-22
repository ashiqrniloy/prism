import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type ToolDefinition, type ToolResult } from "@arnilo/prism";
import toolsCoding from "../../index.js";
import { buildNativeSpawnCommand } from "../../security/native-sandbox.js";
import { createShellTool, getShellConfig } from "../shell.js";
import { createBackgroundProcesses } from "../shell-background.js";

/** A filesystem where only `present` paths are executables. */
function probe(present: readonly string[], env: NodeJS.ProcessEnv) {
  return { env, isExecutable: (path: string) => present.includes(path) };
}

function textOf(result: ToolResult): string {
  const block = result.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

const FISH = ["/usr/bin/fish", "/usr/local/bin/fish", "/bin/fish"].find((path) => existsSync(path));

test("fish_login_shell_is_not_used", () => {
  const withBinBash = getShellConfig(undefined, probe(["/usr/bin/fish", "/bin/bash"], { SHELL: "/usr/bin/fish", PATH: "/usr/bin" }));
  assert.equal(withBinBash.shell, "/bin/bash");
  assert.equal(withBinBash.family, "bash");
  // bash only on PATH still wins over a fish login shell.
  const onPath = getShellConfig(undefined, probe(["/usr/bin/fish", "/opt/b/bash"], { SHELL: "/usr/bin/fish", PATH: "/usr/bin:/opt/b" }));
  assert.equal(onPath.shell, "/opt/b/bash");
  // No bash, fish login shell: fall to sh, never fish (nor nushell).
  const noBash = getShellConfig(undefined, probe(["/usr/bin/fish", "/bin/sh"], { SHELL: "/usr/bin/fish", PATH: "/usr/bin" }));
  assert.equal(noBash.shell, "/bin/sh");
  const nu = getShellConfig(undefined, probe(["/usr/bin/nu", "/bin/sh"], { SHELL: "/usr/bin/nu", PATH: "/usr/bin" }));
  assert.equal(nu.shell, "/bin/sh");
});

test("posix_login_shell_is_accepted_when_bash_is_absent", () => {
  for (const name of ["zsh", "dash", "ksh", "sh"]) {
    const login = `/usr/bin/${name}`;
    const resolved = getShellConfig(undefined, probe([login, "/bin/sh"], { SHELL: login, PATH: "/usr/bin" }));
    assert.equal(resolved.shell, login);
    assert.equal(resolved.family, name);
  }
  // A relative or missing $SHELL is not trusted.
  assert.equal(getShellConfig(undefined, probe(["/bin/sh"], { SHELL: "zsh", PATH: "" })).shell, "/bin/sh");
  assert.equal(getShellConfig(undefined, probe(["/bin/sh"], { SHELL: "/usr/bin/zsh", PATH: "" })).shell, "/bin/sh");
  assert.equal(getShellConfig(undefined, probe([], { PATH: "" })).shell, "sh");
});

test("shell_path_overrides_and_must_exist", async () => {
  const custom = getShellConfig("/opt/shells/zsh", probe(["/opt/shells/zsh", "/bin/bash"], { SHELL: "/bin/bash" }));
  assert.equal(custom.shell, "/opt/shells/zsh");
  assert.throws(() => getShellConfig("/nope/bash", probe(["/bin/bash"], {})), /not an executable file: \/nope\/bash/);

  const root = await mkdtemp(join(tmpdir(), "shell-path-"));
  try {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsCoding({ root, shell: { path: join(root, "missing-shell") } })],
      }),
      /prism-tools-coding: invalid shell\.path/,
    );
    // A directory exists but is not an executable file.
    await assert.rejects(
      createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsCoding({ root, shell: { path: root } })] }),
      /prism-tools-coding: invalid shell\.path/,
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root, shell: { path: "/bin/sh" } })],
    });
    try {
      const shell = agent.inspect().tools.find((tool) => tool.name === "shell");
      assert.ok(shell);
      assert.match(JSON.stringify(agent.inspect().statusNotes), /shell runs commands in \/bin\/sh/);
    } finally {
      await agent.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool_description_names_the_shell_family", () => {
  const tool: ToolDefinition = createShellTool("/tmp", { shell: { shell: "/bin/bash", args: ["-c"], family: "bash" } });
  assert.match(tool.description ?? "", /POSIX shell \(bash\)/);
  const custom = createShellTool("/tmp", { operations: { exec: async () => ({ exitCode: 0 }) } });
  assert.match(custom.description ?? "", /POSIX shell \(sh\)/);
});

test.skipIf(FISH === undefined)("bash_syntax_runs_under_a_fish_login_shell (skipped where fish is not installed)", async () => {
  const saved = process.env.SHELL;
  process.env.SHELL = FISH;
  const cwd = await mkdtemp(join(tmpdir(), "shell-fish-"));
  try {
    const tool = createShellTool(cwd);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell parameter expansion the shell must see literally
    const result = await tool.execute({ command: 'export A=1 && echo "${A}$((1+1))"' }, { toolCallId: "t1", sessionId: "s", runId: "r" });
    assert.equal(result.error, undefined, textOf(result));
    // fish ≥3 accepts `export A=1 && echo "$A"`; `${A}` and `$((…))` are what it rejects.
    assert.equal(textOf(result).trim(), "12");
  } finally {
    if (saved === undefined) delete process.env.SHELL;
    else process.env.SHELL = saved;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("background_processes_use_the_same_shell", async () => {
  const shell = getShellConfig();
  const cwd = await mkdtemp(join(tmpdir(), "shell-bg-res-"));
  const background = createBackgroundProcesses({ shell });
  try {
    const started = await background.start({
      command: 'echo "$0"',
      cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      sessionId: "s",
    });
    const read = await background.read({ id: started.id, sessionId: "s", waitSeconds: 2, kill: false }).catch(() => undefined);
    const output = `${started.output}${read?.output ?? ""}`;
    assert.match(output, new RegExp(shell.shell.replaceAll("/", "\\/")));
  } finally {
    await background.killSession("s");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("native_sandbox_execs_the_resolved_shell_after_the_limits", () => {
  const limits = { memoryBytes: 1024 * 1024, wallTimeMs: 1000, maxFds: 64 } as Parameters<typeof buildNativeSpawnCommand>[1]["limits"];
  const cmd = buildNativeSpawnCommand(
    { command: "echo x", cwd: "/w" },
    { root: "/w", unshare: "/usr/bin/unshare", mode: "plain", limits, env: {}, shell: "/bin/bash" },
  );
  assert.deepEqual(cmd.args.slice(0, 3), ["--net", "/bin/sh", "-c"]);
  assert.match(cmd.args[3] as string, /; exec "\$@"$/);
  assert.deepEqual(cmd.args.slice(4), ["prism-native-sh", "/bin/bash", "-c", "echo x"]);
});
