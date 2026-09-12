import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient } from "../language/client.js";
import { encodeLspFrame, LspFrameError, LspFrameReader } from "../language/framing.js";
import {
  applyTextEdits,
  createLanguageIntelligence,
  LanguageIntelligenceError,
  resolveLanguageIntelligenceLimits,
} from "../language/intelligence.js";

const FAKE_LSP = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
// Compiled tests live under dist/; fixture stays in src — fall back.
async function fakeLspPath(): Promise<string> {
  try {
    await readFile(FAKE_LSP);
    return FAKE_LSP;
  } catch {
    return fileURLToPath(new URL("../../../src/agent/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
  }
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lang-intel-"));
}

test("framing encode/decode round-trip", () => {
  const reader = new LspFrameReader(1024);
  const msg = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
  const frames = reader.push(encodeLspFrame(msg));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], msg);
});

test("framing rejects oversized and malformed", () => {
  const reader = new LspFrameReader(32);
  assert.throws(
    () => reader.push(Buffer.from(`Content-Length: 100\r\n\r\n${"x".repeat(100)}`)),
    (e: unknown) => e instanceof LspFrameError && e.code === "ERR_PRISM_LSP_LIMIT",
  );
  const r2 = new LspFrameReader(1024);
  assert.throws(
    () => r2.push(Buffer.from("Content-Length: abc\r\n\r\n{}")),
    (e: unknown) => e instanceof LspFrameError && e.code === "ERR_PRISM_LSP_FRAMING",
  );
  const r3 = new LspFrameReader(1024);
  assert.throws(
    () => r3.push(Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}")),
    (e: unknown) => e instanceof LspFrameError && e.code === "ERR_PRISM_LSP_FRAMING",
  );
});

test("applyTextEdits applies from end", () => {
  const next = applyTextEdits("foo bar foo", [
    {
      file: "a.ts",
      newText: "qux",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    },
    {
      file: "a.ts",
      newText: "baz",
      range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } },
    },
  ]);
  assert.equal(next, "qux bar baz");
});

test("no spawn on createLanguageIntelligence construction", async () => {
  const cwd = await tmp();
  try {
    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: "/nonexistent/lsp", languages: ["typescript"] },
      },
    });
    await lang.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("definitions/references/symbols/hover/diagnostics via fake LSP", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "const foo = 1;\n");

    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: {
          command: process.execPath,
          args: [lsp],
          languages: ["typescript"],
        },
      },
      limits: { requestTimeoutMs: 10_000 },
    });

    try {
      const defs = await lang.definitions({ file: "src/a.ts", line: 0, character: 6 });
      assert.ok(defs.length >= 1);
      assert.equal(defs[0]?.file, "src/a.ts");

      const refs = await lang.references({ file: "src/a.ts", line: 0, character: 6 });
      assert.ok(refs.length >= 1);

      const syms = await lang.workspaceSymbols("foo");
      assert.ok(syms.some((s) => s.name.includes("foo") || s.name.startsWith("sym")));

      const hover = await lang.hover({ file: "src/a.ts", line: 0, character: 6 });
      assert.equal(hover?.text, "hover:fake");

      // Wait briefly for publishDiagnostics after didOpen.
      await new Promise((r) => setTimeout(r, 50));
      const diags = await lang.diagnostics("src/a.ts");
      assert.ok(diags.length >= 1);
      assert.equal(diags[0]?.severity, "error");
      assert.equal(diags[0]?.message, "fake-error");
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics normalize across dialects and cap per file", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "const foo = 1;\n");
    await writeFile(join(cwd, "src", "b.ts"), "const foo = 2;\n");

    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        primary: {
          command: process.execPath,
          args: [lsp],
          languages: ["typescript"],
          env: { FAKE_LSP_DIAG_DIALECT: "default" },
        },
      },
      limits: { maxDiagnosticsPerFile: 1, requestTimeoutMs: 10_000 },
    });

    try {
      await lang.definitions({ file: "src/a.ts", line: 0, character: 0 });
      await new Promise((r) => setTimeout(r, 50));
      const diags = await lang.diagnostics("src/a.ts");
      assert.equal(diags.length, 1);

      // Second dialect server for js files — still normalizes severity names.
      const lang2 = createLanguageIntelligence({
        workspaceRoot: cwd,
        servers: {
          alt: {
            command: process.execPath,
            args: [lsp],
            languages: ["typescript"],
            env: { FAKE_LSP_DIAG_DIALECT: "alt" },
          },
        },
        limits: { requestTimeoutMs: 10_000 },
      });
      try {
        await lang2.definitions({ file: "src/b.ts", line: 0, character: 0 });
        await new Promise((r) => setTimeout(r, 50));
        const alt = await lang2.diagnostics("src/b.ts");
        assert.equal(alt[0]?.severity, "warning");
        assert.equal(alt[0]?.source, "fake-alt");
      } finally {
        await lang2.dispose();
      }
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rename applies through policy and atomic write; denial fails closed", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "const foo = 1;\n");

    let denied = false;
    const langDeny = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: process.execPath, args: [lsp], languages: ["typescript"] },
      },
      policy: {
        check: () => {
          denied = true;
          return { allowed: false, reason: "nope" };
        },
      },
      limits: { requestTimeoutMs: 10_000 },
    });
    try {
      await assert.rejects(
        () => langDeny.rename({ file: "src/a.ts", line: 0, character: 6, newName: "bar" }),
        (e: unknown) => e instanceof LanguageIntelligenceError,
      );
      assert.equal(denied, true);
      assert.equal(await readFile(join(cwd, "src", "a.ts"), "utf8"), "const foo = 1;\n");
    } finally {
      await langDeny.dispose();
    }

    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: process.execPath, args: [lsp], languages: ["typescript"] },
      },
      limits: { requestTimeoutMs: 10_000 },
    });
    try {
      const edit = await lang.rename({ file: "src/a.ts", line: 0, character: 6, newName: "bar" });
      assert.ok(edit.edits.length >= 1);
      assert.equal(await readFile(join(cwd, "src", "a.ts"), "utf8"), "const bar = 1;\n");
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("out-of-workspace URI and missing language fail closed", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    await writeFile(join(cwd, "a.py"), "foo = 1\n");
    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: process.execPath, args: [lsp], languages: ["typescript"] },
      },
      limits: { requestTimeoutMs: 5_000 },
    });
    try {
      await assert.rejects(
        () => lang.definitions({ file: "../escape.ts", line: 0, character: 0 }),
        (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_WORKSPACE",
      );
      await assert.rejects(
        () => lang.definitions({ file: "a.py", line: 0, character: 0 }),
        (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_UNSUPPORTED",
      );
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("timeout/abort and pending-request limit", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: process.execPath, args: [lsp], languages: ["typescript"] },
      },
      limits: { requestTimeoutMs: 5_000, maxPendingRequests: 1 },
    });
    try {
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(
        () => lang.definitions({ file: "a.ts", line: 0, character: 0 }, { signal: ac.signal }),
        (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_TIMEOUT",
      );
    } finally {
      await lang.dispose();
    }

    // maxServers construction bound
    assert.throws(
      () =>
        createLanguageIntelligence({
          workspaceRoot: cwd,
          servers: {
            a: { command: "x", languages: ["typescript"] },
            b: { command: "x", languages: ["javascript"] },
          },
          limits: { maxServers: 1 },
        }),
      (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_LIMIT",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("socket loss on the write path is classified, never a raw EPIPE", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    const pidFile = join(cwd, "lsp.pid");
    const limits = resolveLanguageIntelligenceLimits({ requestTimeoutMs: 3_000 });
    const client = new LspClient(
      {
        name: "probe",
        command: process.execPath,
        args: [lsp],
        cwd,
        rootUri: pathToFileURL(cwd).href,
        env: { FAKE_LSP_PID_FILE: pidFile },
      },
      limits,
    );
    try {
      await client.ensureStarted();
      // Negative control: a typed failure keeps its own classification instead of becoming socket loss.
      assert.throws(
        () => client.notify("probe", { blob: "x".repeat(limits.maxMessageBytes + 200) }),
        (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_LIMIT",
      );
      // Deterministic repro (plan 071 Task 13): SIGKILL the server and spin synchronously until the
      // kernel has reaped it, so the write below lands on a dead pipe while the socket still reads as
      // writable and the 'exit' event has not been delivered. Node then reports the failed write as
      // an async socket 'error'; before the fix that was an uncaught `write EPIPE`, and this test
      // fails on the uncaught exception rather than on the assertion below.
      const pid = Number(await readFile(pidFile, "utf8"));
      process.kill(pid, "SIGKILL");
      const tick = new Int32Array(new SharedArrayBuffer(4));
      for (let i = 0; i < 500; i++) {
        try {
          process.kill(pid, 0);
        } catch {
          break;
        }
        Atomics.wait(tick, 0, 0, 2);
      }
      const error = await client
        .request("textDocument/definition", {
          textDocument: { uri: pathToFileURL(join(cwd, "a.ts")).href },
          position: { line: 0, character: 0 },
        })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      assert.ok(error instanceof LanguageIntelligenceError, `expected a typed error, got ${String(error)}`);
      assert.equal(error.code, "ERR_PRISM_LSP_SERVER");
    } finally {
      await client.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("server crash after init exhausts restart budget", async () => {
  const cwd = await tmp();
  const lsp = await fakeLspPath();
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: {
          command: process.execPath,
          args: [lsp],
          languages: ["typescript"],
          env: { FAKE_LSP_CRASH_AFTER_INIT: "1" },
        },
      },
      limits: { requestTimeoutMs: 3_000, maxRestartsPerServer: 3 },
    });
    try {
      // Await the restart-budget transition (plan 071 Task 13): attempts keep failing as typed
      // transport errors while the budget lasts, and the budget error is the transition under test.
      // Every attempt's error must be typed — a raw socket error here means the write path leaked.
      const seen: unknown[] = [];
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        try {
          await lang.definitions({ file: "a.ts", line: 0, character: 0 });
        } catch (e) {
          seen.push(e);
          if (e instanceof LanguageIntelligenceError && /exceeded restart budget/.test(e.message)) break;
        }
      }
      const last = seen.at(-1);
      for (const error of seen) {
        assert.ok(error instanceof LanguageIntelligenceError, `attempt error must be typed, got ${String(error)}`);
      }
      assert.ok(last instanceof LanguageIntelligenceError, `expected a typed error, got ${String(last)}`);
      assert.match(last.message, /exceeded restart budget/);
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
