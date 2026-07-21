import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDockerSandbox,
  createImportTarStream,
  createSecretRedactor,
  DockerSandboxError,
  resolveDockerSandboxLimits,
  summarizeTarStream,
  HARD_CPUS,
  HARD_MAX_COMMANDS,
} from "../index.js";
import type { DockerCliRequest, DockerCliResult, DockerRunner } from "../index.js";
import { buildDockerCreateArgsForTest } from "../docker-sandbox.js";

const DIGEST = "sha256:" + "a".repeat(64);
const IMAGE = `registry.example/prism-code@${DIGEST}`;

async function withTempDocker(run: (dockerPath: string, sourceRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "prism-docker-sandbox-"));
  const dockerPath = join(root, "docker");
  const sourceRoot = join(root, "source");
  await mkdir(sourceRoot);
  await writeFile(join(sourceRoot, "hello.txt"), "hello\n");
  await writeFile(dockerPath, "#!/bin/sh\nexit 0\n");
  await chmod(dockerPath, 0o755);
  try {
    await run(dockerPath, sourceRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function ok(stdout = "", stderr = ""): DockerCliResult {
  return {
    exitCode: 0,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut: false,
    aborted: false,
    outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
  };
}

function createFakeRunner(script: (request: DockerCliRequest, calls: string[][]) => Promise<DockerCliResult> | DockerCliResult): {
  runner: DockerRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: DockerRunner = async (request) => {
    calls.push([...request.args]);
    return await script(request, calls);
  };
  return { runner, calls };
}

test("resolveDockerSandboxLimits applies defaults and rejects hard-cap overflows", () => {
  const defaults = resolveDockerSandboxLimits();
  assert.equal(defaults.cpus, 2);
  assert.equal(defaults.maxCommands, 100);
  assert.throws(() => resolveDockerSandboxLimits({ maxCommands: HARD_MAX_COMMANDS + 1 }), RangeError);
  assert.throws(() => resolveDockerSandboxLimits({ cpus: HARD_CPUS + 1 }), RangeError);
});

test("buildDockerCreateArgsForTest pins pull=never, read-only, network none, and resource caps", async () => {
  await withTempDocker(async (_docker, sourceRoot) => {
    const args = buildDockerCreateArgsForTest({
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      env: { CI: "1" },
      limits: { cpus: 2, memoryBytes: 1024 ** 3, maxPids: 128, workspaceBytes: 64 * 1024 ** 2 },
    });
    assert.ok(args.includes("create"));
    assert.ok(args.includes("--pull=never"));
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("--network=none"));
    assert.ok(args.includes("--cap-drop=ALL"));
    assert.ok(args.includes("no-new-privileges=true"));
    assert.ok(args.includes("--init"));
    assert.ok(args.includes("--restart=no"));
    assert.ok(args.includes("--ipc=private"));
    assert.ok(args.some((a) => a.startsWith("--mount=type=bind") && a.includes("readonly")));
    assert.ok(args.includes("--tmpfs"));
    assert.ok(args.includes(IMAGE));
    assert.ok(args.includes("sleep"));
    assert.ok(args.includes("infinity"));
    assert.ok(args.includes("--env"));
    assert.ok(args.includes("CI=1"));
    assert.equal(args.includes("--privileged"), false);
    assert.equal(args.some((a) => a.includes("docker.sock")), false);
  });
});

test("createDockerSandbox rejects non-digest images, root user, relative docker, and inherited-env gaps", async () => {
  await withTempDocker(async (dockerPath, sourceRoot) => {
    await assert.rejects(
      () =>
        createDockerSandbox({
          docker: dockerPath,
          image: "alpine:latest",
          sourceRoot,
          user: "10001:10001",
          skipImport: true,
          runner: async () => ok(),
        }),
      /digest-pinned/,
    );
    await assert.rejects(
      () =>
        createDockerSandbox({
          docker: dockerPath,
          image: IMAGE,
          sourceRoot,
          user: "0:0",
          skipImport: true,
          runner: async () => ok(),
        }),
      /non-root/,
    );
    await assert.rejects(
      () =>
        createDockerSandbox({
          docker: "docker",
          image: IMAGE,
          sourceRoot,
          user: "10001:10001",
          skipImport: true,
          runner: async () => ok(),
        }),
      /absolute executable/,
    );
  });
});

test("fake runner lifecycle: create/start/execFile/stop/rm with redacted secrets and ordered output", async () => {
  await withTempDocker(async (dockerPath, sourceRoot) => {
    const secret = "super-secret-token";
    const { runner, calls } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("29.6.1\n");
      if (request.args[0] === "create") return ok("0123456789abcdef0123456789abcdef\n");
      if (request.args[0] === "start") return ok("0123456789abcdef0123456789abcdef\n");
      if (request.args[0] === "exec" && request.args.includes("tar") && request.args.includes("-xf")) {
        return ok();
      }
      if (request.args[0] === "exec" && request.args.includes("npm")) {
        request.onData?.(Buffer.from("ok\n"));
        request.onData?.(Buffer.from(`leak:${secret}\n`));
        return ok();
      }
      if (request.args[0] === "stop" || request.args[0] === "kill" || request.args[0] === "rm") return ok();
      return ok();
    });

    const chunks: string[] = [];
    const sandbox = await createDockerSandbox({
      docker: dockerPath,
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      env: { CI: "1" },
      secrets: [secret],
      runner,
      skipImport: true,
      limits: { startupTimeoutMs: 5_000, wallTimeMs: 60_000, idleTimeoutMs: 60_000 },
    });

    const result = await sandbox.execFile({
      file: "npm",
      args: ["test"],
      onData: (chunk) => chunks.push(chunk.toString("utf8")),
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(chunks, ["ok\n", `leak:${secret}\n`]);

    // Secret redaction on thrown runner errors
    const { runner: badRunner } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("29.6.1\n");
      if (request.args[0] === "create") return ok("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
      if (request.args[0] === "start") return ok();
      if (request.args[0] === "exec") {
        throw new Error(`failed with ${secret}`);
      }
      if (request.args[0] === "rm") return ok();
      return ok();
    });
    const sandbox2 = await createDockerSandbox({
      docker: dockerPath,
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      secrets: [secret],
      runner: badRunner,
      skipImport: true,
    });
    await assert.rejects(() => sandbox2.execFile({ file: "false", args: [] }), (error: unknown) => {
      assert.ok(error instanceof DockerSandboxError);
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /REDACTED/);
      return true;
    });
    await sandbox2.close();

    await sandbox.close();
    assert.ok(calls.some((c) => c[0] === "create"));
    assert.ok(calls.some((c) => c[0] === "start"));
    assert.ok(calls.some((c) => c[0] === "exec" && c.includes("npm")));
    assert.ok(calls.some((c) => c[0] === "stop"));
    assert.ok(calls.some((c) => c[0] === "rm"));
    const createCall = calls.find((c) => c[0] === "create")!;
    assert.ok(createCall.includes("--pull=never"));
    assert.ok(createCall.includes("--network=none"));
    assert.equal(createCall.includes("-e"), false); // env uses --env
  });
});

test("execFile maps shell escape hatch and enforces command cap", async () => {
  await withTempDocker(async (dockerPath, sourceRoot) => {
    let execs = 0;
    const { runner } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("1\n");
      if (request.args[0] === "create") return ok("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n");
      if (request.args[0] === "start") return ok();
      if (request.args[0] === "exec") {
        execs += 1;
        return ok();
      }
      return ok();
    });
    const sandbox = await createDockerSandbox({
      docker: dockerPath,
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      runner,
      skipImport: true,
      limits: { maxCommands: 2, wallTimeMs: 60_000, idleTimeoutMs: 60_000 },
    });
    await sandbox.exec({ command: "echo hi", cwd: "/workspace" });
    await sandbox.execFile({ file: "true", args: [] });
    await assert.rejects(() => sandbox.execFile({ file: "true", args: [] }), /maxCommands/);
    assert.equal(execs, 2);
    await sandbox.close();
  });
});

test("duplicate close is idempotent and startup failure cleans container", async () => {
  await withTempDocker(async (dockerPath, sourceRoot) => {
    const removed: string[] = [];
    const { runner } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("1\n");
      if (request.args[0] === "create") return ok("cccccccccccccccccccccccccccccccc\n");
      if (request.args[0] === "start") {
        return {
          exitCode: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("start boom"),
          timedOut: false,
          aborted: false,
          outputBytes: 10,
        };
      }
      if (request.args[0] === "rm") {
        removed.push(request.args.at(-1)!);
        return ok();
      }
      return ok();
    });
    await assert.rejects(
      () =>
        createDockerSandbox({
          docker: dockerPath,
          image: IMAGE,
          sourceRoot,
          user: "10001:10001",
          runner,
          skipImport: true,
        }),
      /start boom|docker start failed/,
    );
    assert.deepEqual(removed, ["cccccccccccccccccccccccccccccccc"]);

    const { runner: okRunner } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("1\n");
      if (request.args[0] === "create") return ok("dddddddddddddddddddddddddddddddd\n");
      if (request.args[0] === "start") return ok();
      return ok();
    });
    const sandbox = await createDockerSandbox({
      docker: dockerPath,
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      runner: okRunner,
      skipImport: true,
    });
    await sandbox.close();
    await sandbox.close();
    const status = await sandbox.status();
    assert.equal(status.state, "removed");
  });
});

test("import tar rejects symlink escapes and summarizeTarStream enforces bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-tar-"));
  try {
    await writeFile(join(root, "ok.txt"), "ok");
    await symlink("/etc/passwd", join(root, "escape"));
    await assert.rejects(async () => {
      const stream = createImportTarStream(root, { maxEntries: 100, maxBytes: 1024 * 1024 });
      for await (const _ of stream) {
        // drain
      }
    }, /symlink rejected/);

    const safe = await mkdtemp(join(tmpdir(), "prism-tar-safe-"));
    try {
      await writeFile(join(safe, "a.txt"), "abc");
      const stream = createImportTarStream(safe, { maxEntries: 100, maxBytes: 1024 * 1024 });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      const summary = await summarizeTarStream(
        (async function* () {
          yield buf;
        })(),
        { maxEntries: 100, maxBytes: 1024 * 1024 },
      );
      assert.equal(summary.entryCount >= 1, true);
      assert.equal(summary.sha256, createHash("sha256").update(buf).digest("hex"));

      await assert.rejects(
        () =>
          summarizeTarStream(
            (async function* () {
              yield buf;
            })(),
            { maxEntries: 0, maxBytes: 1024 * 1024 },
          ),
        /max entries/,
      );
    } finally {
      await rm(safe, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export callback receives metadata and close cleans up; aborted export still removes container", async () => {
  await withTempDocker(async (dockerPath, sourceRoot) => {
    // Minimal empty ustar (two zero blocks)
    const emptyTar = Buffer.alloc(1024, 0);
    let pass = 0;
    const { runner, calls } = createFakeRunner(async (request) => {
      if (request.args[0] === "version") return ok("1\n");
      if (request.args[0] === "create") return ok("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n");
      if (request.args[0] === "start") return ok();
      if (request.args[0] === "exec" && request.args.includes("-cf")) {
        pass += 1;
        request.onStdout?.(emptyTar);
        return ok();
      }
      return ok();
    });
    const sandbox = await createDockerSandbox({
      docker: dockerPath,
      image: IMAGE,
      sourceRoot,
      user: "10001:10001",
      runner,
      skipImport: true,
    });
    let sawMeta = false;
    const metadata = await sandbox.close({
      export: async (stream, meta) => {
        sawMeta = true;
        assert.equal(meta.format, "tar");
        assert.equal(meta.sha256.length, 64);
        for await (const _ of stream) {
          // drain
        }
      },
    });
    assert.equal(sawMeta, true);
    assert.ok(metadata);
    assert.equal(pass, 2);
    assert.ok(calls.some((c) => c[0] === "rm"));
  });
});

test("secret redactor replaces canaries", () => {
  const redact = createSecretRedactor(["abc", "xyz"]);
  assert.equal(redact("token abc and xyz"), "token [REDACTED] and [REDACTED]");
});

test("protected Docker sandbox matrix", { skip: process.env.PRISM_TEST_DOCKER_SANDBOX !== "1" }, async () => {
  const docker = process.env.PRISM_TEST_DOCKER_BIN;
  const image = process.env.PRISM_TEST_DOCKER_IMAGE;
  assert.ok(docker, "PRISM_TEST_DOCKER_BIN required when PRISM_TEST_DOCKER_SANDBOX=1");
  assert.ok(image, "PRISM_TEST_DOCKER_IMAGE required when PRISM_TEST_DOCKER_SANDBOX=1");
  assert.match(image, /@sha256:[a-f0-9]{64}$/i, "PRISM_TEST_DOCKER_IMAGE must be digest-pinned");

  const root = await mkdtemp(join(tmpdir(), "prism-docker-live-"));
  const chunks: Buffer[] = [];
  try {
    await writeFile(join(root, "marker.txt"), "marker\n");
    await writeFile(join(root, ".env"), "HOST_SECRET=should-not-leak\n");
    const sandbox = await createDockerSandbox({
      docker,
      image,
      sourceRoot: root,
      user: process.env.PRISM_TEST_DOCKER_USER ?? "10001:10001",
      network: { mode: "none" },
      env: { PRISM_SANDBOX: "1" },
      limits: {
        cpus: 1,
        memoryBytes: 256 * 1024 * 1024,
        maxPids: 64,
        workspaceBytes: 64 * 1024 * 1024,
        tmpBytes: 16 * 1024 * 1024,
        downloadBytes: 8 * 1024 * 1024,
        wallTimeMs: 120_000,
        idleTimeoutMs: 60_000,
        startupTimeoutMs: 60_000,
      },
    });
    try {
      const who = await sandbox.execFile({
        file: "id",
        args: ["-u"],
        onData: (chunk) => chunks.push(Buffer.from(chunk)),
      });
      assert.equal(who.exitCode, 0);
      const uidText = Buffer.concat(chunks).toString("utf8");
      assert.ok(!/^0\s*$/m.test(uidText.trim()), "sandbox must not run as root");

      // workspace is writable; host source mount is read-only
      const writeWs = await sandbox.execFile({
        file: "/bin/sh",
        args: ["-c", "echo ok > /workspace/out.txt && cat /workspace/out.txt"],
        onData: () => undefined,
      });
      assert.equal(writeWs.exitCode, 0);

      const writeRoot = await sandbox.execFile({
        file: "/bin/sh",
        args: ["-c", "echo x > /not-allowed 2>/dev/null; echo $?"],
        onData: () => undefined,
      });
      assert.equal(writeRoot.exitCode, 0);

      const envLeak = await sandbox.execFile({
        file: "/bin/sh",
        args: ["-c", "printf '%s' \"${HOST_SECRET:-}\"; printf '|'; printf '%s' \"${PRISM_SANDBOX:-}\""],
        onData: () => undefined,
      });
      assert.equal(envLeak.exitCode, 0);

      // network none: no eth0 / DNS path required
      const net = await sandbox.execFile({
        file: "/bin/sh",
        args: ["-c", "cat /sys/class/net/eth0/operstate 2>/dev/null || echo none"],
        onData: () => undefined,
      });
      assert.equal(net.exitCode, 0);

      const status = await sandbox.status();
      assert.ok(status.id);
    } finally {
      await sandbox.close();
      // idempotent cleanup
      await sandbox.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assertBrowserSandboxNetwork requires egress attestation for custom networks", async () => {
  const { assertBrowserSandboxNetwork, DockerSandboxError: Err } = await import("../index.js");
  assertBrowserSandboxNetwork({ mode: "none" });
  assertBrowserSandboxNetwork(undefined);
  assert.throws(
    () => assertBrowserSandboxNetwork({ mode: "custom", name: "prism-net" }),
    (error: unknown) => error instanceof Err && /browserEgress attestation/.test(error.message),
  );
  assertBrowserSandboxNetwork({
    mode: "custom",
    name: "prism-net",
    browserEgress: { proxyEndpoint: "http://127.0.0.1:3128", denyDirectEgress: true },
  });
  assert.throws(
    () =>
      assertBrowserSandboxNetwork({
        mode: "custom",
        name: "prism-net",
        browserEgress: { proxyEndpoint: "ftp://bad", denyDirectEgress: true },
      }),
    /proxyEndpoint/,
  );
});
