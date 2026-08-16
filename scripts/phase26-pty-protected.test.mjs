/**
 * Phase 26 Task 1 (plan 026): protected host-PTY adapter leg.
 *
 * The host supplies a PTY module through PRISM_TEST_PTY_BACKEND (absolute path
 * to an ESM/CJS module). The module exports `createPtyBackend()` (named or
 * default) returning an object structurally conforming to
 * `ProcessPtyBackend` from @arnilo/prism-coding-agent — it may wrap any PTY
 * engine (e.g. node-pty); Prism never depends on that engine.
 *
 * This leg proves, against a real pseudoterminal:
 *   - TTY detection: the spawned shell sees a tty on stdin;
 *   - interactive input/output through the ProcessSessions state machine;
 *   - bounded resize reaches the live terminal (stty size when available);
 *   - kill/release/dispose cleanup and terminal state transitions;
 *   - the non-PTY native path stays unchanged when a ptyBackend is present.
 *
 * Blocked-gate semantics (frozen in scripts/phase26-freeze-manifest.json):
 * without PRISM_TEST_PTY_BACKEND this file records a named, visible BLOCKED
 * GATE failure instead of a passing skip. It is only wired into the protected
 * release profile; it is not part of `npm test`.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createProcessSessions } from "../packages/coding-agent/dist/index.js";

const backendModule = process.env.PRISM_TEST_PTY_BACKEND;
const shell = process.env.PRISM_TEST_PTY_SHELL ?? "sh";

if (!backendModule) {
  console.error(
    "BLOCKED GATE: PRISM_TEST_PTY_BACKEND is required (absolute path to a module exporting createPtyBackend()); the phase26 PTY protected leg cannot run without a host PTY engine.",
  );
  process.exit(1);
}

let root;
let backend;

before(async () => {
  const mod = await import(pathToFileURL(backendModule).href);
  const factory = mod.createPtyBackend ?? mod.default;
  assert.equal(typeof factory, "function", `${backendModule} must export createPtyBackend() or default`);
  backend = factory();
  assert.equal(typeof backend.startPty, "function", `${backendModule} backend must implement startPty`);
  root = await mkdtemp(join(tmpdir(), "prism-pty-protected-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("real PTY: shell sees a tty and interactive output/input flows", async () => {
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend });
  try {
    const p = await sessions.start({
      command: shell,
      args: ["-i"],
      pty: true,
      terminal: { columns: 120, rows: 40, term: "xterm-256color" },
    });
    assert.equal(p.state, "running");
    assert.equal(p.metadata().pty, true);

    await p.input("test -t 0 && echo PRISM_TTY_OK && exit 0 || exit 1\n");
    let saw = "";
    let cursor = 0;
    for (let i = 0; i < 200; i++) {
      const chunk = await p.output({ cursor, maxBytes: 8_192 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (saw.includes("PRISM_TTY_OK") || chunk.eof) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(saw.includes("PRISM_TTY_OK"), `interactive output missing PRISM_TTY_OK; saw: ${saw.slice(0, 500)}`);

    const result = await p.wait({ timeoutMs: 15_000 });
    assert.equal(result.exitCode, 0, `interactive shell should exit 0, got ${result.exitCode}`);
    assert.equal(p.state, "exited");
  } finally {
    await sessions.dispose();
  }
});

test("bounded resize reaches the live terminal (stty size when available)", async () => {
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend });
  try {
    const p = await sessions.start({ command: shell, args: ["-i"], pty: true, terminal: { columns: 80, rows: 24 } });
    if (!backend.capabilities?.resize) {
      assert.equal(p.resize, undefined);
      console.log("note: host backend declares no resize capability; the resize contract is not exercised on this host");
      await p.kill();
      return;
    }
    assert.equal(typeof p.resize, "function", "backend declared resize capability");

    await p.resize({ columns: 100, rows: 30 });
    // stty size prints "rows columns", so columns=100/rows=30 reads "30 100".
    // marker assembled at runtime so the shell echo of the typed line cannot self-match
    await p.input("if command -v stty >/dev/null 2>&1; then stty size; else echo PRISM_$(echo NO_)STTY; fi; exit\n");

    let saw = "";
    let cursor = 0;
    for (let i = 0; i < 200; i++) {
      const chunk = await p.output({ cursor, maxBytes: 8_192 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (saw.includes("100 30") || saw.includes("PRISM_NO_STTY") || chunk.eof) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (saw.includes("PRISM_NO_STTY")) {
      console.log("note: stty not available on this host; resize verified at the backend contract level (resize() resolved)");
    } else {
      assert.ok(saw.includes("30 100"), `stty size should report 30 100 (rows cols); saw: ${saw.slice(0, 500)}`);
    }
    await p.wait({ timeoutMs: 15_000 });
  } finally {
    await sessions.dispose();
  }
});

test("cleanup: kill and dispose leave no live session", async () => {
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend });
  try {
    const p = await sessions.start({ command: shell, args: ["-i"], pty: true });
    await p.kill();
    assert.equal(p.state, "killed");
    assert.equal(p.metadata().exitCode, undefined);
    const q = await sessions.start({ command: shell, args: ["-i"], pty: true });
    await q.release();
    assert.equal(q.state, "released");
  } finally {
    await sessions.dispose();
  }
});

test("non-PTY native path unchanged when a ptyBackend is present", async () => {
  const sessions = createProcessSessions({ cwd: root, ptyBackend: backend });
  try {
    const p = await sessions.start({ command: process.execPath, args: ["-e", "console.log('plain-ok')"] });
    assert.equal(p.state, "running");
    assert.equal(p.metadata().pty, false);
    let saw = "";
    let cursor = 0;
    for (let i = 0; i < 100 && !saw.includes("plain-ok"); i++) {
      const chunk = await p.output({ cursor, maxBytes: 8_192 });
      saw += chunk.data;
      cursor = chunk.cursor;
      if (chunk.eof) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(saw.includes("plain-ok"));
    const result = await p.wait({ timeoutMs: 5_000 });
    assert.equal(result.exitCode, 0);
  } finally {
    await sessions.dispose();
  }
});
