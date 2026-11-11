import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createCodingTools, createReadOnlyTools } from "../index.js";
import { compileSearchPattern, createLocalRepositoryOperations, isBinaryBuffer, resolveRepositoryLimits } from "../repository.js";
import { createGrepTool } from "../grep.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
function textOf(r: ToolResult): string {
  const block = r.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "repo-"));
}

async function seedTree(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src", "util"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "README.md"), "# hello\n");
  await writeFile(join(root, "src", "index.ts"), "export const createAgent = 1;\nconst x = createAgent;\n");
  await writeFile(join(root, "src", "util", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "src", "util", "b.ts"), "export const b = 2;\n");
  await writeFile(join(root, ".hidden.txt"), "secret\n");
  await writeFile(join(root, ".git", "config"), "gitdir\n");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  await writeFile(join(root, "dist", "out.js"), "console.log(1);\n");
  await writeFile(join(root, "src", "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]));
}

test("resolveRepositoryLimits rejects values above hard caps", () => {
  assert.throws(() => resolveRepositoryLimits({ maxDepth: 10_000 }), /maxDepth/);
  assert.throws(() => resolveRepositoryLimits({ maxMatches: 0 }), /maxMatches/);
});

test("compileSearchPattern literal only", () => {
  const lit = compileSearchPattern("Agent", true, 512);
  assert.deepEqual(lit.testLine("createAgent"), { column: 7 });
  assert.equal(lit.testLine("createagent"), null);

  const litCi = compileSearchPattern("Agent", false, 512);
  assert.deepEqual(litCi.testLine("createagent"), { column: 7 });

  assert.throws(() => compileSearchPattern("x".repeat(600), true, 512), /pattern limit/);
});

test("isBinaryBuffer detects NUL prefix", () => {
  assert.equal(isBinaryBuffer(Buffer.from("hello")), false);
  assert.equal(isBinaryBuffer(Buffer.from([0x61, 0x00, 0x62])), true);
});

test("local list keeps the pagination, hidden and exclude contract the glob walk reuses", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const ops = createLocalRepositoryOperations({ maxResults: 2, exclude: [".git"] });
    const page1 = await ops.list({ root: cwd, maxResults: 2, offset: 0 });
    assert.equal(page1.truncated, true);
    assert.equal(page1.truncatedBy, "results");
    assert.equal(page1.nextOffset, 2);
    const page2 = await ops.list({ root: cwd, maxResults: 2, offset: 2 });
    assert.deepEqual(
      page2.entries.map((entry) => entry.path),
      [...page2.entries.map((entry) => entry.path)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const defaults = createLocalRepositoryOperations({ maxResults: 100 });
    const hidden = await defaults.list({ root: cwd, includeHidden: true, maxResults: 100 });
    assert.ok(hidden.entries.some((entry) => entry.path === ".hidden.txt"));
    const visible = await defaults.list({ root: cwd, maxResults: 100 });
    assert.ok(!visible.entries.some((entry) => entry.path.startsWith(".hidden")));
    assert.ok(!visible.entries.some((entry) => entry.path.startsWith("node_modules") || entry.path.startsWith("dist")));
    const scoped = await ops.list({ root: cwd, path: "src/util", maxResults: 100 });
    assert.ok(scoped.entries.some((entry) => entry.path === "src/util/a.ts"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_list is gone: directory listing is the glob walk and the repository operations", () => {
  const cwd = process.cwd();
  assert.ok(!createCodingTools(cwd).some((tool) => tool.name === "repo_list"));
  assert.ok(!createReadOnlyTools(cwd).some((tool) => tool.name === "repo_list"));
});

test("grep matches text on the main thread with ripgrep-style output, ordering and context", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "alpha\ncreateAgent here\nbeta\ngamma\n");
    const tool = createGrepTool(cwd);

    const lit = await tool.execute({ pattern: "createAgent", literal: true, context: 1 }, ctx());
    assert.equal(lit.error, undefined, textOf(lit));
    const text = textOf(lit);
    // path:line:text for a hit, path-line-text for context — no column.
    assert.match(text, /^src\/index\.ts:1:export const createAgent = 1;$/m);
    assert.match(text, /^src\/index\.ts:2:const x = createAgent;$/m); // adjacent hit stays a hit
    assert.match(text, /^src\/multi\.ts:2:createAgent here$/m);
    assert.match(text, /^src\/multi\.ts-1-alpha$/m);
    assert.match(text, /^src\/multi\.ts-3-beta$/m);
    assert.doesNotMatch(text, /binary\.bin/);
    assert.doesNotMatch(text, /node_modules/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep groups are separated by -- only across a real line gap", async () => {
  const cwd = await tmp();
  try {
    const lines = Array.from({ length: 20 }, (_, i) => (i === 0 || i === 19 ? "hit" : `line ${i + 1}`));
    await writeFile(join(cwd, "gap.txt"), `${lines.join("\n")}\n`);
    const tool = createGrepTool(cwd);
    const r = await tool.execute({ pattern: "hit", literal: true, context: 1 }, ctx());
    assert.equal(r.error, undefined, textOf(r));
    assert.match(textOf(r), /^gap\.txt:1:hit\ngap\.txt-2-line 2\n--\ngap\.txt-19-line 19\ngap\.txt:20:hit$/m);
    // A hit plus its after-context covers the next hit, so no separator there.
    const near = await createGrepTool(cwd).execute({ pattern: "line", literal: true, path: "gap.txt", context: 0 }, ctx());
    assert.doesNotMatch(textOf(near), /^--$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep runs regular expressions and rejects an invalid pattern with the engine message", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGrepTool(cwd);
    const re = await tool.execute({ pattern: String.raw`export const \w+ = 1`, path: "src" }, ctx());
    assert.equal(re.error, undefined, textOf(re));
    assert.match(textOf(re), /src\/index\.ts:1:export const createAgent = 1;/);

    const invalid = await tool.execute({ pattern: "(", path: "src" }, ctx());
    assert.ok(invalid.error, "an invalid regex is a tool error");
    assert.match(invalid.error?.message ?? "", /error|invalid|group/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep terminates a catastrophic pattern in the worker at the time limit", async () => {
  const cwd = await tmp();
  try {
    // Under the per-line byte cap, so the regex really runs.
    await writeFile(join(cwd, "evil.txt"), `${"a".repeat(40_000)}b\n`);
    const started = Date.now();
    const r = await createGrepTool(cwd, { repository: { maxTimeMs: 200 } }).execute({ pattern: "(a+)+$", path: "evil.txt" }, ctx());
    const elapsed = Date.now() - started;
    assert.equal(r.error, undefined, textOf(r));
    assert.equal(r.metadata?.truncatedBy, "time");
    assert.ok(elapsed < 5_000, `worker must cut the pattern short, took ${elapsed}ms`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep outputMode files_with_matches returns unique paths without line bodies", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "alpha\ncreateAgent here\nbeta\ncreateAgent again\n");
    const tool = createGrepTool(cwd);

    const r = await tool.execute({ pattern: "createAgent", literal: true, outputMode: "files_with_matches" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.metadata?.outputMode, "files_with_matches");
    assert.equal(r.metadata?.fileCount, 2);
    assert.equal(r.metadata?.matches, undefined);
    const text = textOf(r);
    assert.equal(text, "src/index.ts\nsrc/multi.ts");
    assert.doesNotMatch(text, /:\d+:/);
    assert.doesNotMatch(text, /binary\.bin/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep outputMode count returns totals without line bodies", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "createAgent\nline\ncreateAgent\n");
    const tool = createGrepTool(cwd);

    const r = await tool.execute({ pattern: "createAgent", literal: true, outputMode: "count" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.metadata?.outputMode, "count");
    assert.equal(r.metadata?.fileCount, 2);
    assert.equal(r.metadata?.matchCount, 4);
    assert.equal(r.metadata?.matches, undefined);
    assert.equal(textOf(r), "4 matches in 2 files");
    assert.doesNotMatch(textOf(r), /src\/index\.ts:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep outputMode count empty and invalid values fail closed", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createGrepTool(cwd);

    const empty = await tool.execute({ pattern: "zzz-not-found", literal: true, outputMode: "count" }, ctx());
    assert.equal(empty.error, undefined);
    assert.equal(textOf(empty), "0 matches in 0 files");

    const bad = await tool.execute({ pattern: "x", literal: true, outputMode: "paths_only" }, ctx());
    assert.match(bad.error?.message ?? "", /unsupported outputMode/);

    const content = await tool.execute({ pattern: "createAgent", literal: true, outputMode: "content" }, ctx());
    assert.match(textOf(content), /src\/index\.ts:\d+:.*createAgent/);
    assert.ok(Array.isArray(content.metadata?.matches));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep outputMode preserves truncation semantics across modes", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "hit\nhit\nhit\n");
    const tool = createGrepTool(cwd, { maxMatches: 2 });

    const content = await tool.execute({ pattern: "hit", literal: true, maxMatches: 2, outputMode: "content" }, ctx());
    assert.equal(content.metadata?.truncated, true);
    assert.equal(content.metadata?.matchCount, 2);

    const files = await tool.execute({ pattern: "hit", literal: true, maxMatches: 2, outputMode: "files_with_matches" }, ctx());
    assert.equal(files.metadata?.truncated, true);
    assert.match(textOf(files), /\[truncated by matches\]/);
    assert.doesNotMatch(textOf(files), /:\d+:/);

    const count = await tool.execute({ pattern: "hit", literal: true, maxMatches: 2, outputMode: "count" }, ctx());
    assert.equal(count.metadata?.truncated, true);
    assert.match(textOf(count), /^2 matches in 1 file\n\[truncated by matches\]$/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep truncates on maxMatches and aggregate scan budget", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "hit\nhit\nhit\n");
    const tool = createGrepTool(cwd, { maxMatches: 2 });
    const r = await tool.execute({ pattern: "hit", literal: true, maxMatches: 2 }, ctx());
    assert.equal(r.metadata?.truncated, true);
    assert.equal(r.metadata?.truncatedBy, "matches");
    assert.equal(r.metadata?.matchCount, 2);

    const tiny = createGrepTool(cwd, {
      repository: { maxScanBytes: 4, maxFileBytes: 1024, maxMatches: 100 },
    });
    const scan = await tiny.execute({ pattern: "hit", literal: true }, ctx());
    assert.equal(scan.metadata?.truncated, true);
    assert.equal(scan.metadata?.truncatedBy, "scan");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("grep aborts and respects custom RepositoryOperations", async () => {
  const cwd = await tmp();
  try {
    const ac = new AbortController();
    ac.abort();
    const aborted = await createGrepTool(cwd).execute({ pattern: "x" }, ctx(ac.signal));
    assert.equal(aborted.error?.message, "Operation aborted");

    let called = false;
    const custom = await createGrepTool(cwd, {
      operations: {
        list: async () => {
          throw new Error("unused");
        },
        search: async () => {
          called = true;
          return {
            matches: [{ path: "x.ts", line: 1, column: 1, text: "x", before: [], after: [] }],
            truncated: false,
            truncatedBy: null,
            scannedBytes: 1,
            scannedFiles: 1,
            scannedEntries: 1,
            filesSkippedBinary: 0,
            filesSkippedOversize: 0,
          };
        },
        glob: async () => {
          throw new Error("unused");
        },
      },
    }).execute({ pattern: "x" }, ctx());
    assert.equal(called, true);
    assert.match(textOf(custom), /x\.ts:1:x/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("local repository operations stream without materializing full trees", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const ops = createLocalRepositoryOperations({ maxResults: 3 });
    const listed = await ops.list({ root: cwd, maxResults: 3 });
    assert.equal(listed.entries.length, 3);
    assert.equal(listed.truncated, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("aggregators include list/search/glob; read-only excludes mutating tools", async () => {
  const cwd = await tmp();
  try {
    const full = createCodingTools(cwd);
    assert.deepEqual(
      full.map((t) => t.name),
      ["shell", "read", "write", "edit", "grep", "glob"],
    );
    const ro = createReadOnlyTools(cwd);
    assert.deepEqual(
      ro.map((t) => t.name),
      ["read", "grep", "glob"],
    );
    assert.ok(!ro.some((t) => t.name === "shell" || t.name === "write" || t.name === "edit"));

    await seedTree(cwd);
    // Shared repository limits reach the search tools that remain.
    const shared = createCodingTools(cwd, { repository: { exclude: [".git"], maxMatches: 1 } });
    const grep = shared.find((t) => t.name === "grep")!;
    const r = await grep.execute({ pattern: "export", literal: true, glob: "**/*.ts" }, ctx());
    assert.equal(r.error, undefined, textOf(r));
    assert.equal(r.metadata?.matchCount, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
