import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createCodingTools, createGlobTool, createReadOnlyTools } from "../index.js";
import { expandGlobBraces, matchGlobPattern, validateGlobPattern } from "../glob-match.js";
import { createLocalRepositoryOperations } from "../repository.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "glob-"));
}

async function seedTree(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src", "util"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "README.md"), "# hello\n");
  await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(join(root, "src", "util", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "src", "util", "b.ts"), "export const b = 2;\n");
  await writeFile(join(root, ".hidden.txt"), "secret\n");
  await writeFile(join(root, ".git", "config"), "gitdir\n");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  await writeFile(join(root, "dist", "out.js"), "console.log(1);\n");
}

test("matchGlobPattern supports *, ?, and **", () => {
  assert.equal(matchGlobPattern("*.md", "README.md"), true);
  assert.equal(matchGlobPattern("*.md", "src/README.md"), false);
  assert.equal(matchGlobPattern("src/**/*.ts", "src/util/a.ts"), true);
  assert.equal(matchGlobPattern("src/**/a.ts", "src/util/a.ts"), true);
  assert.equal(matchGlobPattern("src/?.ts", "src/x.ts"), true);
  assert.equal(matchGlobPattern("src/?.ts", "src/ab.ts"), false);
  assert.equal(matchGlobPattern("**", "src/util/a.ts"), true);
});

test("validateGlobPattern rejects empty and brace expansion", () => {
  assert.throws(() => validateGlobPattern("", 512), /non-empty/);
  assert.throws(() => validateGlobPattern("src/{a,b}.ts", 512), /brace expansion/);
});

test("glob finds TypeScript files with default excludes", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGlobTool(cwd);
    const r = await tool.execute({ pattern: "src/**/*.ts" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(textOf(r), "src/index.ts\nsrc/util/a.ts\nsrc/util/b.ts");
    assert.equal(r.metadata?.returned, 3);
    assert.doesNotMatch(textOf(r), /node_modules/);
    assert.doesNotMatch(textOf(r), /\.git/);
    assert.doesNotMatch(textOf(r), /dist/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("glob pagination, includeHidden, and path scope", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGlobTool(cwd, { maxResults: 2 });

    const page1 = await tool.execute({ pattern: "src/**/*.ts", maxResults: 2, offset: 0 }, ctx());
    assert.equal(page1.metadata?.truncated, true);
    assert.equal(page1.metadata?.truncatedBy, "results");
    assert.equal(page1.metadata?.nextOffset, 2);
    assert.equal((page1.metadata!.paths as string[]).length, 2);

    const hidden = await tool.execute({ pattern: ".hidden.txt", includeHidden: true }, ctx());
    assert.equal(textOf(hidden), ".hidden.txt");

    const scoped = await createGlobTool(cwd).execute({ pattern: "**/*.ts", path: "src" }, ctx());
    assert.equal(textOf(scoped), "src/index.ts\nsrc/util/a.ts\nsrc/util/b.ts");
    assert.doesNotMatch(textOf(scoped), /README/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("glob rejects symlink escape and does not follow symlink dirs", async () => {
  const cwd = await tmp();
  const outside = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(outside, "secret.ts"), "export const s = 1;\n");
    await symlink(outside, join(cwd, "escape-link"));
    const tool = createGlobTool(cwd, { maxResults: 100 });
    const r = await tool.execute({ pattern: "**/*.ts", maxResults: 100 }, ctx());
    assert.doesNotMatch(textOf(r), /secret\.ts/);

    const escape = await tool.execute({ path: `../${outside.split("/").pop()}` }, ctx());
    assert.ok(escape.error);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("glob honors abort, execution policy, and custom RepositoryOperations", async () => {
  const cwd = await tmp();
  try {
    const ac = new AbortController();
    ac.abort();
    const aborted = await createGlobTool(cwd).execute({ pattern: "*.md" }, ctx(ac.signal));
    assert.equal(aborted.error?.message, "Operation aborted");

    let called = false;
    const custom = await createGlobTool(cwd, {
      operations: {
        list: async () => {
          throw new Error("unused");
        },
        search: async () => {
          throw new Error("unused");
        },
        glob: async () => {
          called = true;
          return {
            paths: ["x.ts"],
            truncated: false,
            truncatedBy: null,
            scannedEntries: 1,
            scannedFiles: 1,
            offset: 0,
          };
        },
      },
    }).execute({ pattern: "*.ts" }, ctx());
    assert.equal(called, true);
    assert.equal(textOf(custom), "x.ts");

    let touched = false;
    const denied = await createGlobTool(cwd, {
      executionPolicy: { check: () => ({ allowed: false, reason: "no glob" }) },
      operations: {
        list: async () => {
          touched = true;
          throw new Error("should not run");
        },
        search: async () => {
          throw new Error("should not run");
        },
        glob: async () => {
          touched = true;
          throw new Error("should not run");
        },
      },
    }).execute({ pattern: "*.md" }, ctx());
    assert.equal(denied.error?.message, "no glob");
    assert.equal(touched, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("glob truncates on maxResults and scan budget", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "a\n");
    await writeFile(join(cwd, "src", "b.ts"), "b\n");
    await writeFile(join(cwd, "src", "c.ts"), "c\n");
    const limited = createGlobTool(cwd, { maxResults: 2 });
    const r = await limited.execute({ pattern: "src/*.ts", maxResults: 2 }, ctx());
    assert.equal(r.metadata?.truncated, true);
    assert.equal(r.metadata?.truncatedBy, "results");

    const ops = createLocalRepositoryOperations({ maxEntries: 1 });
    const scan = await ops.glob({ root: cwd, pattern: "src/*.ts" });
    assert.equal(scan.truncated, true);
    assert.equal(scan.truncatedBy, "entries");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aggregators include glob; read-only excludes mutating tools", async () => {
  const cwd = await tmp();
  try {
    const full = createCodingTools(cwd);
    assert.deepEqual(
      full.map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"],
    );
    const ro = createReadOnlyTools(cwd);
    assert.deepEqual(
      ro.map((t) => t.name),
      ["read", "repo_list", "repo_search", "glob"],
    );
    assert.ok(!ro.some((t) => t.name === "shell" || t.name === "write" || t.name === "edit"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("expandGlobBraces expands {a,b} groups with bounds", () => {
  assert.deepEqual(expandGlobBraces("{a,b}.ts"), ["a.ts", "b.ts"]);
  assert.deepEqual(expandGlobBraces("src/{a,b}/**.ts"), ["src/a/**.ts", "src/b/**.ts"]);
  assert.deepEqual(expandGlobBraces("x{a,b}{1,2}y"), ["xa1y", "xa2y", "xb1y", "xb2y"]);
  assert.deepEqual(expandGlobBraces("no-braces.ts"), ["no-braces.ts"]);
  assert.deepEqual(expandGlobBraces("{a,b}", { maxAlternatives: 4 }), ["a", "b"]);
});

test("expandGlobBraces fails closed on overflow and malformed input", () => {
  assert.throws(() => expandGlobBraces("{a,b,c}", { maxAlternatives: 2 }), /alternative limit/);

  assert.throws(() => expandGlobBraces("x{a"), /unbalanced/);
  assert.throws(() => expandGlobBraces("{a,{b,c}}"), /nested/);
  assert.throws(() => expandGlobBraces("{}"), /empty brace/);
});

test("validateGlobPattern: braces reject by default, expand when opted in", () => {
  assert.throws(() => validateGlobPattern("src/{a,b}.ts", 512), /brace expansion/);
  assert.doesNotThrow(() => validateGlobPattern("src/{a,b}.ts", 512, { braceExpansion: true }));
  assert.doesNotThrow(() => validateGlobPattern("plain.ts", 512, { braceExpansion: true }));
  // Default expansion bounds still fail closed under the opt-in flag.
  const bomb = Array.from({ length: 200 }, (_, i) => `n${i}`).join(",");
  assert.throws(() => expandGlobBraces(`{${bomb}}`), /alternative limit/);
  assert.throws(() => expandGlobBraces("{aaaa,bbbb}", { maxExpandedBytes: 3 }), /byte limit/);
});

test("glob brace expansion is opt-in: per-call flag, host option, and default rejection", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    // Default (no flag): braces rejected.
    const refused = await createGlobTool(cwd).execute({ pattern: "src/{index,util/a}.ts" }, ctx());
    assert.match(refused.error?.message ?? "", /brace expansion/);
    // Per-call opt-in.
    const r = await createGlobTool(cwd).execute({ pattern: "src/{index,util/a}.ts", braceExpansion: true }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(textOf(r), "src/index.ts\nsrc/util/a.ts");
    // Host option default + per-call override both directions.
    const host = createGlobTool(cwd, { braceExpansion: true });
    const viaHost = await host.execute({ pattern: "src/{index,util/a}.ts" }, ctx());
    assert.equal(viaHost.error, undefined);
    assert.equal(textOf(viaHost), "src/index.ts\nsrc/util/a.ts");
    const overridden = await host.execute({ pattern: "src/{index,util/a}.ts", braceExpansion: false }, ctx());
    assert.match(overridden.error?.message ?? "", /brace expansion/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("glob brace expansion respects the path scope", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGlobTool(cwd, { braceExpansion: true });
    // Patterns match workspace-relative full paths even under a `path` scope.
    const r = await tool.execute({ pattern: "src/{index,util/a}.ts", path: "src", braceExpansion: true }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(textOf(r), "src/index.ts\nsrc/util/a.ts");
    // Expansion never widens the scope: matches outside `path` stay out.
    const narrowed = await tool.execute({ pattern: "src/{index,util/a}.ts", path: "src/util", braceExpansion: true }, ctx());
    assert.equal(narrowed.error, undefined);
    assert.equal(textOf(narrowed), "src/util/a.ts");
    // A brace pattern that only matches outside the scope yields no matches.
    const outside = await tool.execute({ pattern: "src/{index,util/a}.ts", path: "node_modules", braceExpansion: true }, ctx());
    assert.equal(outside.error, undefined);
    assert.equal(textOf(outside), "(no matches)");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("glob expansion bomb refuses via the tool boundary", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGlobTool(cwd, { braceExpansion: true });
    // 129 single-char alternatives: over the 128-alternative cap, under the 512-byte pattern cap.
    const bomb = Array.from({ length: 129 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(",");
    const r = await tool.execute({ pattern: `{${bomb}}`, braceExpansion: true }, ctx());
    assert.match(r.error?.message ?? "", /alternative limit/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
