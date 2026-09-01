import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { diagnosticDelta, type NormalizedDiagnostic, normalizeDiagnostics } from "../diagnostics.js";
import { createLanguageIntelligence, LanguageIntelligenceError } from "../language/intelligence.js";

const FAKE_LSP = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lang-diag-"));
}

let lspPath = FAKE_LSP;
// Compiled tests live under dist/; fixture stays in src — fall back.
if (!existsSync(FAKE_LSP)) {
  lspPath = fileURLToPath(new URL("../../../src/agent/__tests__/fixtures/fake-lsp.mjs", import.meta.url));
}

function makeLang(workspaceRoot: string, env?: Record<string, string>) {
  return createLanguageIntelligence({
    workspaceRoot,
    servers: {
      ts: {
        command: process.execPath,
        args: [lspPath],
        languages: ["typescript"],
        ...(env ? { env } : {}),
      },
    },
  });
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  ok: (value: T | undefined) => boolean,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (ok(value)) return value;
    if (Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function diag(file: string, overrides?: Partial<NormalizedDiagnostic>): NormalizedDiagnostic {
  return {
    file,
    line: 0,
    character: 0,
    endLine: 0,
    endCharacter: 1,
    severity: "error",
    message: "m",
    source: "check",
    generation: 1,
    ...overrides,
  };
}

test("normalization: bounds, containment, control characters, malformed entries", () => {
  const root = "/work";
  const out = normalizeDiagnostics(
    [
      { file: "src/a.ts", message: "ok", source: "tsc" },
      { file: "/etc/passwd", message: "outside" },
      { file: "src/b.ts", message: "ctrl\u0007char", line: 1 },
      { file: "src/c.ts", message: "bad line", line: -1 },
      { file: "src/d.ts", message: "bad range", line: 5, endLine: 2 },
      { file: "src/e.ts", message: "not a number", line: Number.NaN },
      { file: "src/f.ts", message: "" },
      { file: "src/g.ts", message: "fine", severity: "bogus" as never },
    ],
    { workspaceRoot: root, generation: 7 },
  );
  const files = out.map((d) => d.file);
  assert.ok(files.includes("src/a.ts"));
  assert.ok(!files.includes("/etc/passwd")); // out-of-workspace dropped
  const stripped = out.find((d) => d.file === "src/b.ts");
  assert.ok(stripped); // control characters are stripped, not retained
  assert.ok(!stripped.message.includes("\u0007"));
  assert.ok(!files.includes("src/c.ts")); // negative line rejected
  assert.ok(!files.includes("src/d.ts")); // inverted range rejected
  assert.ok(!files.includes("src/e.ts")); // non-finite rejected
  assert.ok(!files.includes("src/f.ts")); // empty message rejected
  assert.ok(!files.includes("src/g.ts")); // unknown severity rejected
  assert.equal(out[0]?.generation, 7);
  assert.equal(out[0]?.source, "tsc");
});

test("normalization: per-file cap and message truncation", () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({ file: "src/a.ts", message: `m${i}` }));
  const capped = normalizeDiagnostics(raw, { workspaceRoot: "/work", generation: 1, maxDiagnosticsPerFile: 5 });
  assert.equal(capped.length, 5);
  const long = normalizeDiagnostics([{ file: "src/a.ts", message: "x".repeat(100) }], {
    workspaceRoot: "/work",
    generation: 1,
    maxMessageBytes: 16,
  });
  assert.ok(long[0]!.message.length <= 17); // 16 bytes + ellipsis
});

test("diagnosticDelta: deterministic added/removed/unchanged across generations", () => {
  const g1 = [diag("src/a.ts"), diag("src/a.ts", { line: 3, message: "keep" }), diag("src/b.ts")];
  const g2 = [diag("src/a.ts"), diag("src/b.ts"), diag("src/c.ts")];
  const delta = diagnosticDelta({ next: g2, previous: g1 });
  assert.equal(delta.generation, 1);
  assert.deepEqual(
    delta.added.map((d) => d.file),
    ["src/c.ts"],
  );
  // g1-only entries: a.ts at line 3 ('keep') and b.ts (line 0 in g1) — b.ts
  // is identical in both, so only the line-3 entry is removed
  assert.deepEqual(
    delta.removed.map((d) => d.message),
    ["keep"],
  );
  assert.deepEqual(
    delta.unchanged.map((d) => d.file),
    ["src/a.ts", "src/b.ts"],
  );
  // deterministic: same inputs, same delta
  const again = diagnosticDelta({ next: g2, previous: g1 });
  assert.deepEqual(again, delta);
});

test("diagnosticDelta: duplicate keys dedupe, stale previous entries ignored", () => {
  const dup = [diag("src/a.ts"), diag("src/a.ts")];
  const delta = diagnosticDelta({ next: dup, previous: [diag("src/z.ts", { generation: 9 })] });
  assert.equal(delta.added.length, 1); // dedupe
  assert.equal(delta.removed.length, 0); // stale previous (gen 9 >= 1) ignored
  assert.equal(delta.truncated, true);
});

test("diagnosticDelta: identity key includes source and code", () => {
  const next = [diag("src/a.ts"), diag("src/a.ts", { source: "lsp", code: 101 })];
  const delta = diagnosticDelta({ next, previous: [diag("src/a.ts"), diag("src/a.ts", { source: "lsp", code: 101 })] });
  assert.equal(delta.added.length, 0);
  assert.equal(delta.unchanged.length, 2);
});

test("syncDocument sends full-content didChange with monotonic versions", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "let x = 1;\n");
    const lang = makeLang(cwd);
    try {
      // first touch opens the document (didOpen version 1)
      await lang.diagnostics("a.ts");
      const v1 = await lang.syncDocument("a.ts");
      assert.equal(v1.version, 2);
      const v2 = await lang.syncDocument("a.ts");
      assert.equal(v2.version, 3);
      // push diagnostics carry the versioned message from the fake server
      // (async publish — poll briefly for the latest version)
      const after = await waitFor(
        async () => {
          const diags = await lang.diagnostics("a.ts");
          return diags[0]?.message;
        },
        (message) => message === "fake-error-v3",
        2000,
      );
      assert.equal(after, "fake-error-v3");
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnosticDelta: push path replacement and delta across generations", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "let x = 1;\n");
    const lang = makeLang(cwd);
    try {
      await lang.diagnostics("a.ts"); // open, push diags (v1)
      await lang.syncDocument("a.ts"); // v2: server replaces the set
      // The fake server's v2 push publish is async — poll for it like the
      // syncDocument test above (load-sensitive guard, ponytail: ceiling is
      // the 2000ms waitFor deadline).
      await waitFor(
        async () => {
          const diags = await lang.diagnostics("a.ts");
          return diags[0]?.message;
        },
        (message) => message === "fake-error-v2",
        2000,
      );
      const delta = await lang.diagnosticDelta({ files: ["a.ts"] });
      const file = delta.files["a.ts"]!;
      assert.equal(delta.generation, 2);
      assert.equal(file.added[0]?.message, "fake-error-v2");
      // same generation again: deterministic unchanged delta
      const again = await lang.diagnosticDelta({
        files: ["a.ts"],
        previous: { "a.ts": { generation: 2, diagnostics: file.added } },
      });
      assert.equal(again.files["a.ts"]?.added.length, 0);
      assert.equal(again.files["a.ts"]?.removed.length, 0);
      assert.equal(again.files["a.ts"]?.unchanged.length, 1);
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnosticDelta: stale previous view never overwrites newer results", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "let x = 1;\n");
    const lang = makeLang(cwd);
    try {
      await lang.diagnostics("a.ts");
      await lang.syncDocument("a.ts"); // version 2
      const delta = await lang.diagnosticDelta({
        files: ["a.ts"],
        previous: { "a.ts": { generation: 5, diagnostics: [diag("a.ts", { generation: 5 })] } },
      });
      assert.equal(delta.files["a.ts"], undefined); // stale previous dropped
      assert.equal(delta.generation, 2); // refresh still ran at version 2
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnosticDelta: pull path uses resultId full/unchanged reuse", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "let x = 1;\n");
    const lang = makeLang(cwd, { FAKE_LSP_PULL: "1" });
    try {
      await lang.diagnostics("a.ts"); // open (version 1, rid-1 cached)
      const first = await lang.diagnosticDelta({ files: ["a.ts"] });
      assert.equal(first.files["a.ts"]?.added.length, 1);
      assert.equal(first.generation, 1);
      // unchanged reuse: server answers kind=unchanged for the same resultId
      const second = await lang.diagnosticDelta({
        files: ["a.ts"],
        previous: { "a.ts": { generation: 1, diagnostics: first.files["a.ts"]!.added } },
      });
      assert.equal(second.files["a.ts"]?.added.length, 0);
      assert.equal(second.files["a.ts"]?.unchanged.length, 1);
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("LSP stays opt-in: no server spawns without an explicit createLanguageIntelligence", async () => {
  const cwd = await tmp();
  try {
    // construct-only must not spawn (existing contract), and unhandled
    // languages fail closed without starting any server
    const lang = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers: {
        ts: { command: "/nonexistent/lsp", languages: ["typescript"] },
      },
    });
    try {
      await assert.rejects(
        () => lang.syncDocument("src/other.py"),
        (e: unknown) => e instanceof LanguageIntelligenceError && e.code === "ERR_PRISM_LSP_UNSUPPORTED",
      );
    } finally {
      await lang.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
