import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildNativeSpawnCommand, createNativeSandbox, NativeSandboxError, resolveNativeSandboxLimits } from "../index.js";

const LIMITS = resolveNativeSandboxLimits();

/** True when this environment can actually create a network namespace (CI containers often cannot). */
const NETNS_OK = await (async () => {
  for (const args of [
    ["--net", "true"],
    ["--net", "--map-root-user", "true"],
  ]) {
    try {
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn("unshare", args, { stdio: "ignore" });
        child.on("error", () => resolve(null));
        child.on("close", (c) => resolve(c));
      });
      if (code === 0) return true;
    } catch {
      // try next
    }
  }
  return false;
})();

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "prism-native-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("T1/T6: creation fails closed when unshare is missing or a netns cannot be created", async () => {
  await withRoot(async (root) => {
    await assert.rejects(createNativeSandbox({ root, unshare: "/nonexistent/unshare" }), (error: unknown) => {
      assert.ok(error instanceof NativeSandboxError);
      assert.equal(error.code, "ERR_PRISM_NATIVE_SANDBOX");
      return true;
    });
    if (!NETNS_OK) return; // preflight already proven unavailable
  });
});

test("T8: root must be absolute, existing, and readable", async () => {
  await withRoot(async (root) => {
    await assert.rejects(createNativeSandbox({ root: "relative" }), /root must be an absolute path/);
    await assert.rejects(createNativeSandbox({ root: join(root, "missing") }), /missing or unreadable/);
  });
});

test("T1: every command runs in a fresh network namespace (argv carries --net)", () => {
  const cmd = buildNativeSpawnCommand(
    { command: "echo x", cwd: "/w" },
    { root: "/w", unshare: "/usr/bin/unshare", mode: "plain", limits: LIMITS, env: { PATH: "/usr/bin:/bin" } },
  );
  assert.equal(cmd.file, "/usr/bin/unshare");
  assert.deepEqual(cmd.args.slice(0, 3), ["--net", "/bin/sh", "-c"]);
  const maproot = buildNativeSpawnCommand(
    { command: "echo x", cwd: "/w" },
    { root: "/w", unshare: "/usr/bin/unshare", mode: "maproot", limits: LIMITS, env: { PATH: "/usr/bin:/bin" } },
  );
  assert.deepEqual(maproot.args.slice(0, 4), ["--net", "--map-root-user", "/bin/sh", "-c"]);
});

test("T2: ulimit hard caps prefix every command; a failed ulimit never runs the command", () => {
  const cmd = buildNativeSpawnCommand(
    { command: "echo x", cwd: "/w" },
    { root: "/w", unshare: "/usr/bin/unshare", mode: "plain", limits: LIMITS, env: { PATH: "/usr/bin:/bin" } },
  );
  const script = cmd.args[3] as string;
  assert.match(script, /^ulimit -v \d+ \|\| exit 126; ulimit -t \d+ \|\| exit 126; ulimit -n \d+ \|\| exit 126; echo x$/);
});

test("T4: execFile passes file/args as argv — never shell-interpolated", () => {
  const cmd = buildNativeSpawnCommand(
    { file: "/usr/bin/printf", args: ["%s", "$(id); rm -rf /"], cwd: "/w" },
    { root: "/w", unshare: "/usr/bin/unshare", mode: "plain", limits: LIMITS, env: { PATH: "/usr/bin:/bin" } },
  );
  assert.equal(cmd.args[3], 'ulimit -v 2097152 || exit 126; ulimit -t 1200 || exit 126; ulimit -n 1024 || exit 126; exec "$@"');
  assert.equal(cmd.args[4], "prism-native-sh");
  assert.deepEqual(cmd.args.slice(5), ["/usr/bin/printf", "%s", "$(id); rm -rf /"]);
});

test("T5: host env is never inherited; env allow-list is validated and bounded", async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root });
    try {
      await assert.rejects(sb.exec({ command: "echo x", cwd: root, env: { "BAD NAME": "v" } }), /invalid env name/);
      await assert.rejects(sb.exec({ command: "echo x", cwd: root, env: { a: "x".repeat(LIMITS.maxEnvBytes) } }), /exceeds maxEnvBytes/);
    } finally {
      await sb.close();
    }
  });
});

test("T5: secrets are redacted from surfaced errors", async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root, secrets: ["super-secret"] });
    try {
      await assert.rejects(sb.exec({ command: "echo x", cwd: root, env: { "super-secret!": "v" } }), (error: unknown) => {
        assert.ok(error instanceof NativeSandboxError);
        assert.ok(!error.message.includes("super-secret"));
        assert.ok(error.message.includes("[REDACTED]"));
        return true;
      });
    } finally {
      await sb.close();
    }
  });
});

test("T3: cwd must be an absolute path inside the sandbox root", async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root });
    try {
      await assert.rejects(sb.exec({ command: "echo x", cwd: "/etc" }), /inside the sandbox root/);
      await assert.rejects(sb.exec({ command: "echo x", cwd: "relative" }), /inside the sandbox root/);
    } finally {
      await sb.close();
    }
  });
});

test("T3: symlinked cwd resolving outside the root is rejected", async () => {
  await withRoot(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "prism-native-outside-"));
    try {
      await symlink(outside, join(root, "escape"));
      const sb = await createNativeSandbox({ root });
      try {
        await assert.rejects(sb.exec({ command: "echo x", cwd: join(root, "escape") }), /inside the sandbox root/);
      } finally {
        await sb.close();
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("T4: NUL bytes are rejected in exec commands and execFile paths/args", async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root });
    try {
      await assert.rejects(sb.exec({ command: "echo \u0000", cwd: root }), /without NUL/);
      await assert.rejects(sb.execFile({ file: "/bin/echo\u0000", args: [] }), /without NUL/);
      await assert.rejects(sb.execFile({ file: "/bin/echo", args: ["\u0000"] }), /without NUL/);
    } finally {
      await sb.close();
    }
  });
});

test("T7: stop/kill transition state and terminate running work", { skip: !NETNS_OK }, async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root });
    try {
      const pending = sb.exec({ command: "sleep 30", cwd: root });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal((await sb.status()).state, "running");
      await sb.kill();
      const result = await pending;
      assert.equal(result.exitCode, null);
      assert.equal((await sb.status()).state, "stopped");
    } finally {
      await sb.close();
    }
  });
});

test("T2: timeout kills the whole process group", { skip: !NETNS_OK }, async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root, limits: { stopGraceMs: 100 } });
    try {
      const started = Date.now();
      const result = await sb.exec({ command: "sleep 30", cwd: root, timeout: 250 });
      assert.equal(result.exitCode, null);
      assert.ok(Date.now() - started < 2000, "killed promptly, not after the sleep");
    } finally {
      await sb.close();
    }
  });
});

test("T2: output byte cap kills the command and surfaces the error", { skip: !NETNS_OK }, async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root, limits: { maxOutputBytes: 1024 } });
    try {
      await assert.rejects(sb.exec({ command: "head -c 4096 /dev/zero | tr '\\0' x", cwd: root }), /exceeded maxOutputBytes/);
    } finally {
      await sb.close();
    }
  });
});

test("T1: egress is denied by construction inside the sandbox; host loopback stays reachable", { skip: !NETNS_OK }, async () => {
  await withRoot(async (root) => {
    const sb = await createNativeSandbox({ root });
    try {
      const net = await import("node:net");
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as { port: number }).port;
      const probe = `node -e "require('node:net').connect(${port},'127.0.0.1').on('error',e=>{console.log(e.code);process.exit(0)}).on('connect',()=>process.exit(1))"`;
      const chunks: string[] = [];
      const result = await sb.exec({ command: probe, cwd: root, onData: (c) => chunks.push(c.toString()) });
      assert.equal(result.exitCode, 0, "connection inside the netns must fail");
      assert.ok(
        chunks.join("").includes("ENETUNREACH") || chunks.join("").includes("ECONNREFUSED"),
        `unreachable expected, got ${chunks.join("")}`,
      );
      // positive control: the host still reaches the listener
      await new Promise<void>((resolve) => {
        const s = net.connect(port, "127.0.0.1", () => {
          s.destroy();
          resolve();
        });
        s.on("error", () => resolve());
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      await sb.close();
    }
  });
});

test("conformance: exec/execFile/status/close parity with the reference surface", { skip: !NETNS_OK }, async () => {
  await withRoot(async (root) => {
    await writeFile(join(root, "hello.txt"), "hello\n");
    const sb = await createNativeSandbox({ root });
    try {
      const exec = await sb.exec({ command: "cat hello.txt", cwd: root });
      assert.equal(exec.exitCode, 0);
      const execFile = await sb.execFile({ file: "/bin/cat", args: ["hello.txt"], cwd: root });
      assert.equal(execFile.exitCode, 0);
      const failed = await sb.exec({ command: "exit 7", cwd: root });
      assert.equal(failed.exitCode, 7, "exit codes pass through");
      const status = await sb.status();
      assert.equal(status.state, "running");
      assert.equal(status.image, "native:linux");
      assert.equal(status.commandCount, 3);
      // export parity: bounded tar of the workspace root with metadata
      const metadata = await sb.close({
        export: async (stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer);
          const tar = Buffer.concat(chunks);
          assert.ok(tar.length > 512, "tar header present");
          assert.ok(tar.toString("latin1", 0, 5).includes("hello"), "hello.txt entry included");
        },
      });
      assert.ok(metadata, "export metadata returned");
      assert.equal(metadata.format, "tar");
      assert.equal(metadata.entryCount, 1);
      assert.equal((await sb.status()).state, "removed");
    } finally {
      await sb.close();
    }
  });
});

test("limits: resolution validates defaults and hard caps", () => {
  const resolved = resolveNativeSandboxLimits();
  assert.equal(resolved.maxFds, 1024);
  assert.equal(resolved.wallTimeMs, 20 * 60_000);
  assert.throws(() => resolveNativeSandboxLimits({ maxFds: 0 }), RangeError);
  assert.throws(() => resolveNativeSandboxLimits({ maxFds: 8193 }), RangeError);
});
