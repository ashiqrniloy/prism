import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ExecutionPolicy } from "@arnilo/prism";
import { type CodingProcessEvent, createProcessSessions, type ProcessSandboxBackend, ProcessSessionError } from "../process/index.js";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "prism-proc-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("no timers or processes on createProcessSessions construction", () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({ cwd: root, onEvent: (e) => events.push(e) });
  assert.equal(events.length, 0);
  void sessions;
});

test("child env is an allow-list: unlisted host vars never leak (P1)", async () => {
  process.env.PRISM_ENV_LEAK_CANARY = "top-secret-2";
  const sessions = createProcessSessions({
    cwd: root,
    onEvent: () => {},
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "console.log(process.env.PRISM_ENV_LEAK_CANARY ?? '<absent>'); process.exit(0)"],
      lifetimeMs: 30_000,
    });
    const result = await p.wait({ timeoutMs: 5_000 });
    let cursor = 0;
    let saw = "";
    for (let i = 0; i < 50; i++) {
      const chunk = await p.output({ cursor, maxBytes: 64 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (saw.includes("absent") || saw.includes("top-secret")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(result.state, "exited");
    assert.match(saw, /<absent>/, "unlisted env var must not reach process child");
  } finally {
    delete process.env.PRISM_ENV_LEAK_CANARY;
    await sessions.dispose();
  }
});

test("start → output paging → input → wait exit", async () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({
    cwd: root,
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data',d=>{if(d.includes('q'))process.exit(0)}); console.log('hello'); setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    assert.equal(p.state, "running");
    assert.ok(events.some((e) => e.type === "process_started"));

    let cursor = 0;
    let saw = "";
    for (let i = 0; i < 50; i++) {
      const chunk = await p.output({ cursor, maxBytes: 64 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (saw.includes("hello")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.match(saw, /hello/);

    await p.input("q\n");
    const result = await p.wait({ timeoutMs: 5_000 });
    assert.equal(result.state, "exited");
    assert.equal(result.exitCode, 0);
    assert.ok(events.some((e) => e.type === "process_exited"));
    assert.equal(typeof p.metadata().commandFingerprint, "string");
    assert.equal(p.metadata().commandFingerprint.length, 64);
  } finally {
    await sessions.dispose();
  }
});

test("signal/kill terminates; release detaches and forbids re-attach", async () => {
  const sessions = createProcessSessions({ cwd: root, limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    await p.signal("SIGTERM");
    // Give it a moment; if still running, kill.
    try {
      await p.wait({ timeoutMs: 500 });
    } catch {
      await p.kill();
      const killed = await p.wait({ timeoutMs: 2_000 });
      assert.equal(killed.state, "killed");
    }

    const q = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    await q.release();
    assert.equal(q.state, "released");
    await assert.rejects(
      () => q.output(),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_STATE");
        return true;
      },
    );
    await assert.rejects(
      () => q.input("x"),
      (err: unknown) => err instanceof ProcessSessionError,
    );
  } finally {
    await sessions.dispose();
  }
});

test("cancelOwned kills; releaseOnCancel releases", async () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({
    cwd: root,
    ownership: { tenantId: "t1", userId: "u1" },
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const a = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    const b = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
      releaseOnCancel: true,
    });
    await sessions.cancelOwned(a.owner);
    assert.equal(a.state, "killed");
    assert.equal(b.state, "released");
    assert.ok(events.some((e) => e.type === "process_killed"));
    assert.ok(events.some((e) => e.type === "process_released"));
  } finally {
    await sessions.dispose();
  }
});

test("expiry sweep after lifetime; wrong-owner fails closed", async () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({
    cwd: root,
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000, maxSessions: 4 },
  });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      owner: "owner-a",
      lifetimeMs: 80,
    });
    await new Promise((r) => setTimeout(r, 120));
    // Access triggers sweep
    const state = sessions.get(p.id, "owner-a").state;
    assert.equal(state, "expired", `expected expired, got ${state}`);
    assert.ok(events.some((e) => e.type === "process_expired"));

    assert.throws(
      () => sessions.get(p.id, "owner-b"),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_OWNERSHIP");
        return true;
      },
    );
  } finally {
    await sessions.dispose();
  }
});

test("policy denial and PTY unsupported and input/session caps", async () => {
  const deny: ExecutionPolicy = {
    check: () => ({ allowed: false, reason: "nope" }),
  };
  const sessions = createProcessSessions({
    cwd: root,
    policy: deny,
    limits: { maxSessions: 1, maxInputBytes: 8, maxLifetimeMs: 60_000 },
  });
  try {
    await assert.rejects(
      () => sessions.start({ command: process.execPath, args: ["-e", "1"] }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_POLICY");
        return true;
      },
    );
  } finally {
    await sessions.dispose();
  }

  const open = createProcessSessions({
    cwd: root,
    limits: { maxSessions: 1, maxInputBytes: 4, maxLifetimeMs: 60_000 },
  });
  try {
    await assert.rejects(
      () => open.start({ command: process.execPath, args: ["-e", "1"], pty: true }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_PTY_UNSUPPORTED");
        return true;
      },
    );

    const p = await open.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    await assert.rejects(
      () => p.input("too-long"),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_LIMIT");
        return true;
      },
    );
    await assert.rejects(
      () => open.start({ command: process.execPath, args: ["-e", "1"], lifetimeMs: 30_000 }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_LIMIT");
        return true;
      },
    );
    await p.kill();
  } finally {
    await open.dispose();
  }
});

test("markUnknown never fabricates exitCode; cwd escape fails closed", async () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({
    cwd: root,
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    await assert.rejects(
      () =>
        sessions.start({
          command: process.execPath,
          args: ["-e", "1"],
          cwd: join(root, "..", "outside"),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_POLICY");
        return true;
      },
    );

    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    await sessions.markUnknown(p.id, p.owner);
    assert.equal(p.state, "unknown");
    const result = await p.wait();
    assert.equal(result.exitCode, null);
    assert.equal(result.state, "unknown");
    assert.ok(events.some((e) => e.type === "process_unknown"));
  } finally {
    await sessions.dispose();
  }
});

function createFakeSandbox(opts?: { startProcess?: boolean; statusState?: () => string }): ProcessSandboxBackend {
  const children = new Set<ReturnType<typeof spawn>>();
  const backend: ProcessSandboxBackend = {
    async status() {
      return { state: opts?.statusState?.() ?? "running" };
    },
  };
  if (opts?.startProcess === false) return backend;

  backend.startProcess = async (request) => {
    const child = spawn(request.file, [...request.args], {
      cwd: request.cwd,
      env: { ...process.env, ...(request.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    children.add(child);
    const onData = (buf: Buffer) => request.onData?.(buf);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    let exitCode: number | null = null;
    let exited = false;
    const waiters: Array<() => void> = [];
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      for (const w of waiters) w();
      waiters.length = 0;
      children.delete(child);
    });
    return {
      async write(data) {
        await new Promise<void>((resolveWrite, rejectWrite) => {
          child.stdin!.write(Buffer.from(data), (err) => (err ? rejectWrite(err) : resolveWrite()));
        });
      },
      async signal(name) {
        if (child.pid) process.kill(child.pid, name as NodeJS.Signals);
      },
      async kill() {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            try {
              process.kill(child.pid, "SIGKILL");
            } catch {
              // best effort
            }
          }
        }
      },
      async release() {
        child.unref();
      },
      async wait(waitOpts) {
        if (exited) return { exitCode };
        return await new Promise<{ exitCode: number | null }>((resolveWait, rejectWait) => {
          const done = () => {
            cleanup();
            resolveWait({ exitCode });
          };
          const onAbort = () => {
            cleanup();
            rejectWait(new Error("aborted"));
          };
          let timer: NodeJS.Timeout | undefined;
          const cleanup = () => {
            if (timer) clearTimeout(timer);
            waitOpts?.signal?.removeEventListener("abort", onAbort);
            const idx = waiters.indexOf(done);
            if (idx >= 0) waiters.splice(idx, 1);
          };
          waiters.push(done);
          if (waitOpts?.timeoutMs !== undefined) {
            timer = setTimeout(() => {
              cleanup();
              rejectWait(new Error("timeout"));
            }, waitOpts.timeoutMs);
          }
          if (waitOpts?.signal) {
            if (waitOpts.signal.aborted) onAbort();
            else waitOpts.signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      },
    };
  };
  return backend;
}

test("sandbox startProcess: output/input/kill parity", async () => {
  const events: CodingProcessEvent[] = [];
  const sessions = createProcessSessions({
    cwd: root,
    sandbox: createFakeSandbox(),
    identity: {
      tenantId: "t-sandbox",
      userId: "u1",
      principal: { kind: "user", id: "u1" },
      scopes: [],
      issuedAt: new Date().toISOString(),
      verified: true,
    },
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data',d=>{if(d.includes('q'))process.exit(0)}); console.log('sbx'); setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    assert.equal(p.owner, "t-sandbox::u1");
    let cursor = 0;
    let saw = "";
    for (let i = 0; i < 50; i++) {
      const chunk = await p.output({ cursor, maxBytes: 64 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (saw.includes("sbx")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.match(saw, /sbx/);
    await p.input("q\n");
    const result = await p.wait({ timeoutMs: 5_000 });
    assert.equal(result.state, "exited");
    assert.equal(result.exitCode, 0);
    assert.ok(events.some((e) => e.type === "process_started"));
    assert.ok(events.some((e) => e.type === "process_exited"));
  } finally {
    await sessions.dispose();
  }
});

test("one-shot sandbox without startProcess fails closed", async () => {
  const sessions = createProcessSessions({
    cwd: root,
    sandbox: createFakeSandbox({ startProcess: false }),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    await assert.rejects(
      () => sessions.start({ command: process.execPath, args: ["-e", "1"] }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_UNSUPPORTED");
        return true;
      },
    );
  } finally {
    await sessions.dispose();
  }
});

test("sandbox loss and reconcile mark unknown; no fabricated exitCode", async () => {
  const events: CodingProcessEvent[] = [];
  let state = "running";
  const sessions = createProcessSessions({
    cwd: root,
    sandbox: createFakeSandbox({ statusState: () => state }),
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const p = await sessions.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    state = "removed";
    await p.output({ cursor: 0 });
    assert.equal(p.state, "unknown");
    assert.equal((await p.wait()).exitCode, null);
    assert.ok(events.some((e) => e.type === "process_unknown"));

    const q = await sessions
      .start({
        command: process.execPath,
        args: ["-e", "setInterval(()=>{}, 1000)"],
        lifetimeMs: 30_000,
      })
      .then(
        () => null,
        (err: unknown) => err,
      );
    assert.ok(q instanceof ProcessSessionError);
    assert.equal(q.code, "ERR_PRISM_PROCESS_UNSUPPORTED");
  } finally {
    await sessions.dispose();
  }

  const resume = createProcessSessions({
    cwd: root,
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000 },
  });
  try {
    const p = await resume.start({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{}, 1000)"],
      lifetimeMs: 30_000,
    });
    const { markedUnknown } = await resume.reconcile();
    assert.equal(markedUnknown, 1);
    assert.equal(p.state, "unknown");
    assert.equal((await p.wait()).exitCode, null);
  } finally {
    await resume.dispose();
  }
});
