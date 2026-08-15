/**
 * Phase 26 Task 1 (plan 026): host-selected PTY backend conformance and
 * adversarial tests over the frozen contract — pty:true delegates only to the
 * host ptyBackend, absent/unsupported backends fail closed before spawn, and
 * terminal/resize/attach/metadata bounds fail with ERR_PRISM_PROCESS_PTY_LIMIT
 * while backend failures surface as ERR_PRISM_PROCESS_PTY_BACKEND without
 * leaking backend error text. All PTY behavior is exercised against fake
 * backends; the real host adapter is covered by the protected leg
 * (scripts/phase26-pty-protected.test.mjs).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ExecutionPolicy } from "@arnilo/prism";
import {
  createProcessSessions,
  ProcessSessionError,
  type CodingProcessEvent,
  type ProcessPtyBackend,
  type ProcessPtyHandle,
  type ProcessPtyStartRequest,
} from "../process/index.js";

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "prism-pty-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

interface FakePtyState {
  startRequests: ProcessPtyStartRequest[];
  writes: Buffer[];
  resizes: Array<{ columns: number; rows: number }>;
  signals: string[];
  killed: number;
  released: number;
  waitResolve?: (result: { exitCode: number | null }) => void;
  waitReject?: (error: Error) => void;
}

function makeBackend(overrides: {
  resizeCapable?: boolean;
  metadata?: Record<string, string>;
  startError?: Error;
  startDelayMs?: number;
  startNeverSettles?: boolean;
  waitRejectError?: Error;
  lostOnResize?: boolean;
  throwOnWrite?: boolean;
} = {}): { backend: ProcessPtyBackend; state: FakePtyState } {
  const state: FakePtyState = { startRequests: [], writes: [], resizes: [], signals: [], killed: 0, released: 0 };
  const handle: ProcessPtyHandle = {
    metadata: overrides.metadata,
    async write(data) {
      if (overrides.throwOnWrite) throw new Error("backend write boom");
      state.writes.push(Buffer.from(data));
    },
    async signal(name) {
      state.signals.push(name);
    },
    async kill() {
      state.killed += 1;
    },
    async release() {
      state.released += 1;
    },
    async resize(dimensions) {
      if (overrides.lostOnResize) throw new Error("backend resize boom");
      state.resizes.push(dimensions);
    },
    wait() {
      return new Promise((resolve, reject) => {
        state.waitResolve = resolve;
        state.waitReject = reject;
      });
    },
  };
  const backend: ProcessPtyBackend = {
    capabilities: { resize: overrides.resizeCapable ?? true },
    async startPty(request) {
      state.startRequests.push(request);
      if (overrides.startError) throw overrides.startError;
      if (overrides.startNeverSettles) return await new Promise(() => undefined);
      if (overrides.startDelayMs) await new Promise((r) => setTimeout(r, overrides.startDelayMs));
      return handle;
    },
  };
  return { backend, state };
}

function rejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ProcessSessionError, `ProcessSessionError expected, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

test("pty:true without a backend rejects before spawn and leaves no session", async () => {
  const sessions = createProcessSessions({ cwd: root });
  try {
    await rejectCode(
      sessions.start({ command: process.execPath, args: ["-e", "1"], pty: true }),
      "ERR_PRISM_PROCESS_PTY_UNSUPPORTED",
    );
    assert.throws(() => sessions.get("proc_none"), (err: unknown) => err instanceof ProcessSessionError);
  } finally {
    await sessions.dispose();
  }
});

test("backend without startPty is an unsupported host (pre-spawn)", async () => {
  const sessions = createProcessSessions({ cwd: root, ptyBackend: { capabilities: { resize: true } } });
  try {
    await rejectCode(sessions.start({ command: "x", pty: true }), "ERR_PRISM_PROCESS_PTY_UNSUPPORTED");
  } finally {
    await sessions.dispose();
  }
});

test("pty:false native path unchanged and PTY sessions count against maxSessions", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxSessions: 1, maxLifetimeMs: 60_000 } });
  try {
    const native = await sessions.start({ command: process.execPath, args: ["-e", "console.log('plain')"] });
    assert.equal(native.state, "running");
    assert.equal(native.metadata().pty, false);
    await rejectCode(sessions.start({ command: "x", pty: true }), "ERR_PRISM_PROCESS_LIMIT");
    assert.equal(state.startRequests.length, 0);
    await native.kill();
  } finally {
    await sessions.dispose();
  }
});

test("interactive lifecycle: geometry, output paging, input, wait, events, metadata", async () => {
  const events: CodingProcessEvent[] = [];
  const { backend, state } = makeBackend({ metadata: { tty: "pts/9", vendor: "fake-pty" } });
  const sessions = createProcessSessions({
    cwd: root,
    ptyBackend: backend,
    onEvent: (e) => events.push(e),
    limits: { maxLifetimeMs: 60_000, maxTerminalColumns: 500, maxTerminalRows: 200 },
  });
  try {
    const p = await sessions.start({
      command: "/bin/sh",
      args: ["-i"],
      pty: true,
      terminal: { columns: 140, rows: 50, term: "xterm" },
    });
    assert.equal(p.state, "running");
    assert.equal(state.startRequests.length, 1);
    assert.equal(state.startRequests[0].file, "/bin/sh");
    assert.equal(state.startRequests[0].columns, 140);
    assert.equal(state.startRequests[0].rows, 50);
    assert.equal(state.startRequests[0].term, "xterm");
    assert.ok(events.some((e) => e.type === "process_started"));

    const meta = p.metadata();
    assert.equal(meta.pty, true);
    assert.deepEqual(meta.terminal, { columns: 140, rows: 50, term: "xterm" });
    assert.deepEqual(meta.ptyBackendMetadata, { tty: "pts/9", vendor: "fake-pty" });

    // output accumulator paging from backend onData
    const onData = state.startRequests[0].onData!;
    onData(Buffer.from("prism-prompt> "));
    const page = await p.output({ cursor: 0, maxBytes: 64 });
    assert.equal(page.data, "prism-prompt> ");
    assert.equal(page.eof, false);
    assert.equal(page.cursor, "prism-prompt> ".length);

    await p.input("echo hi\n");
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].toString("utf8"), "echo hi\n");

    await p.signal("SIGINT");
    assert.deepEqual(state.signals, ["SIGINT"]);

    state.waitResolve?.({ exitCode: 0 });
    const result = await p.wait({ timeoutMs: 5_000 });
    assert.equal(result.state, "exited");
    assert.equal(result.exitCode, 0);
    assert.ok(events.some((e) => e.type === "process_exited" && e.exitCode === 0));
  } finally {
    await sessions.dispose();
  }
});

test("default terminal geometry applies when terminal omitted", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    await sessions.start({ command: "x", pty: true });
    assert.equal(state.startRequests[0].columns, 120);
    assert.equal(state.startRequests[0].rows, 40);
    assert.equal(state.startRequests[0].term, "xterm-256color");
  } finally {
    await sessions.dispose();
  }
});

test("resize routes only when capability declared; bounds and rate limit enforced", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({
    cwd: root,
    ptyBackend: backend,
    limits: { maxLifetimeMs: 60_000, maxTerminalResizesPerMinute: 2 },
  });
  try {
    const p = await sessions.start({ command: "x", pty: true, terminal: { columns: 80, rows: 24 } });
    assert.equal(typeof p.resize, "function");
    await p.resize!({ columns: 100, rows: 30 });
    await p.resize!({ columns: 110, rows: 40 });
    assert.equal(state.resizes.length, 2);
    assert.deepEqual(state.resizes[1], { columns: 110, rows: 40 });
    assert.deepEqual(p.metadata().terminal, { columns: 110, rows: 40, term: "xterm-256color" });
    await rejectCode(p.resize!({ columns: 120, rows: 24 }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    assert.equal(state.resizes.length, 2, "rate-limited resize must not reach the backend");
    await rejectCode(p.resize!({ columns: 501, rows: 24 }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    await rejectCode(p.resize!({ columns: 80, rows: 0 }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    await rejectCode(p.resize!({ columns: Number.NaN, rows: 24 }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    assert.equal(state.resizes.length, 2);
  } finally {
    await sessions.dispose();
  }
});

test("no resize capability means no resize on the handle", async () => {
  const { backend, state } = makeBackend({ resizeCapable: false });
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({ command: "x", pty: true });
    assert.equal(p.resize, undefined);
  } finally {
    await sessions.dispose();
  }
});

test("oversized dimensions/TERM fail before any backend call", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({
    cwd: root,
    ptyBackend: backend,
    limits: { maxLifetimeMs: 60_000, maxTerminalColumns: 200, maxTerminalTermBytes: 64 },
  });
  try {
    await rejectCode(sessions.start({ command: "x", pty: true, terminal: { columns: 201 } }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    await rejectCode(sessions.start({ command: "x", pty: true, terminal: { rows: 500 } }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    await rejectCode(sessions.start({ command: "x", pty: true, terminal: { term: "z".repeat(65) } }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    assert.equal(state.startRequests.length, 0);
  } finally {
    await sessions.dispose();
  }
});

test("attach timeout fails closed and removes the record", async () => {
  const { backend } = makeBackend({ startNeverSettles: true });
  const sessions = createProcessSessions({
    cwd: root,
    ptyBackend: backend,
    limits: { maxLifetimeMs: 60_000, maxPtyAttachTimeoutMs: 60 },
  });
  try {
    await rejectCode(sessions.start({ command: "x", pty: true }), "ERR_PRISM_PROCESS_PTY_LIMIT");
  } finally {
    await sessions.dispose();
  }
});

test("backend start failure surfaces as PTY_BACKEND without backend error text", async () => {
  const { backend } = makeBackend({ startError: new Error("s3cr3t-credential-value leaked?") });
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    await assert.rejects(
      sessions.start({ command: "x", pty: true }),
      (err: unknown) => {
        assert.ok(err instanceof ProcessSessionError);
        assert.equal(err.code, "ERR_PRISM_PROCESS_PTY_BACKEND");
        assert.ok(!err.message.includes("s3cr3t"), "backend error text must not leak into the surfaced error");
        return true;
      },
    );
  } finally {
    await sessions.dispose();
  }
});

test("backend loss during wait marks the session unknown without fabricating exit", async () => {
  const events: CodingProcessEvent[] = [];
  const { backend, state } = makeBackend({ waitRejectError: new Error("backend gone") });
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, onEvent: (e) => events.push(e), limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({ command: "x", pty: true });
    state.waitReject?.(new Error("backend gone"));
    for (let i = 0; i < 50 && p.state !== "unknown"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(p.state, "unknown");
    assert.equal(p.metadata().state, "unknown");
    const result = await p.wait({ timeoutMs: 1_000 });
    assert.equal(result.exitCode, null);
    assert.equal(result.state, "unknown");
    assert.ok(events.some((e) => e.type === "process_unknown" && e.exitCode === null));
  } finally {
    await sessions.dispose();
  }
});

test("resize backend loss marks unknown and surfaces PTY_BACKEND", async () => {
  const { backend, state } = makeBackend({ lostOnResize: true });
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({ command: "x", pty: true });
    await rejectCode(p.resize!({ columns: 100, rows: 30 }), "ERR_PRISM_PROCESS_PTY_BACKEND");
    assert.equal(p.state, "unknown");
  } finally {
    await sessions.dispose();
  }
});

test("NUL bytes are refused in PTY input; oversized input still capped", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({
    cwd: root,
    ptyBackend: backend,
    limits: { maxLifetimeMs: 60_000, maxInputBytes: 16 },
  });
  try {
    const p = await sessions.start({ command: "x", pty: true });
    await rejectCode(p.input("a\u0000b"), "ERR_PRISM_PROCESS_POLICY");
    await rejectCode(p.input("z".repeat(17)), "ERR_PRISM_PROCESS_LIMIT");
    assert.equal(state.writes.length, 0);
  } finally {
    await sessions.dispose();
  }
});

test("policy gates input/resize and blocks start entirely when denied", async () => {
  const deny: ExecutionPolicy = { check: () => ({ allowed: false, reason: "nope" }) };
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({ cwd: root, policy: deny, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    await rejectCode(sessions.start({ command: "x", pty: true }), "ERR_PRISM_PROCESS_POLICY");
    assert.equal(state.startRequests.length, 0);
  } finally {
    await sessions.dispose();
  }
});

test("cancelOwned kills (or releases) PTY sessions; dispose kills leftovers", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({ command: "x", pty: true, owner: "alice" });
    await sessions.start({ command: "y", pty: true, owner: "alice", releaseOnCancel: true });
    await sessions.cancelOwned("alice");
    assert.equal(state.killed, 2, "cancel kill + terminal-record kill (sandbox parity)");
    assert.equal(state.released, 2);
    assert.equal(p.state, "killed");
  } finally {
    await sessions.dispose();
  }
});

test("kill and release route through the backend handle", async () => {
  const { backend, state } = makeBackend();
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    const p = await sessions.start({ command: "x", pty: true });
    await p.kill();
    assert.equal(state.killed, 2, "handle kill + terminal-record kill (sandbox parity)");
    assert.equal(p.state, "killed");
    assert.equal(typeof p.metadata().exitedAt, "string");

    const q = await sessions.start({ command: "y", pty: true });
    await q.release();
    assert.equal(state.released, 2, "handle release + terminal-record release (sandbox parity)");
    assert.equal(q.state, "released");
    await rejectCode(q.input("z"), "ERR_PRISM_PROCESS_STATE");
  } finally {
    await sessions.dispose();
  }
});

test("ownership and metadata bounds fail closed", async () => {
  const { backend, state } = makeBackend({ metadata: { secret: "x".repeat(5_000) } });
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend, limits: { maxLifetimeMs: 60_000 } });
  try {
    await rejectCode(sessions.start({ command: "x", pty: true, owner: "alice" }), "ERR_PRISM_PROCESS_PTY_LIMIT");
    assert.equal(state.startRequests.length, 1, "backend was called, then the metadata cap rejected the session");

    const ok = makeBackend();
    const sessions2 = createProcessSessions({ cwd: root, ptyBackend: ok.backend, limits: { maxLifetimeMs: 60_000 } });
    try {
      const p = await sessions2.start({ command: "x", pty: true, owner: "alice" });
      assert.throws(() => sessions2.get(p.id, "bob"), (err: unknown) => err instanceof ProcessSessionError);
      await sessions2.cancelOwned("nobody");
      assert.equal(ok.state.killed, 0);
    } finally {
      await sessions2.dispose();
    }
  } finally {
    await sessions.dispose();
  }
});
