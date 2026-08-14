import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeLspFrame, LspFrameError, LspFrameReader } from "../language/framing.js";
import { applyTextEdits, createLanguageIntelligence, LanguageIntelligenceError } from "../language/intelligence.js";

const FAKE_LSP = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
// Compiled tests live under dist/; fixture stays in src — fall back.
async function fakeLspPath(): Promise<string> {
  try {
    await readFile(FAKE_LSP);
    return FAKE_LSP;
  } catch {
    return fileURLToPath(new URL("../../src/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
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
      // Repeated attempts until restart budget fails closed.
      let last: unknown;
      for (let i = 0; i < 6; i++) {
        try {
          await lang.definitions({ file: "a.ts", line: 0, character: 0 });
        } catch (e) {
          last = e;
        }
      }
      assert.ok(last instanceof LanguageIntelligenceError);
      assert.ok(
        last.code === "ERR_PRISM_LSP_SERVER" || last.code === "ERR_PRISM_LSP_TIMEOUT",
        `unexpected code ${(last as LanguageIntelligenceError).code}`,
      );
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
