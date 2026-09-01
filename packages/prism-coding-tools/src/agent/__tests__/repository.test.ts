import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createCodingTools, createReadOnlyTools } from "../index.js";
import { createRepoListTool } from "../list.js";
import { compileSearchPattern, createLocalRepositoryOperations, isBinaryBuffer, resolveRepositoryLimits } from "../repository.js";
import { createRepoSearchTool } from "../search.js";

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

test("repo_list returns deterministic relative paths and skips defaults", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createRepoListTool(cwd);
    const r = await tool.execute({}, ctx());
    assert.equal(r.error, undefined);
    const text = textOf(r);
    assert.match(text, /^file\tREADME\.md/m);
    assert.match(text, /^directory\tsrc$/m);
    assert.doesNotMatch(text, /\.git/);
    assert.doesNotMatch(text, /node_modules/);
    assert.doesNotMatch(text, /dist/);
    assert.doesNotMatch(text, /\.hidden/);
    const entries = r.metadata?.entries as Array<{ path: string }>;
    const paths = entries.map((e) => e.path);
    assert.deepEqual(
      paths,
      [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_list pagination, includeHidden, and path scope", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createRepoListTool(cwd, { maxResults: 2 });
    const page1 = await tool.execute({ maxResults: 2, offset: 0 }, ctx());
    assert.equal(page1.metadata?.truncated, true);
    assert.equal(page1.metadata?.truncatedBy, "results");
    assert.equal(page1.metadata?.nextOffset, 2);

    const page2 = await tool.execute({ maxResults: 2, offset: 2 }, ctx());
    assert.equal((page2.metadata?.entries as unknown[])!.length <= 2, true);

    const hidden = await tool.execute({ includeHidden: true, maxResults: 100 }, ctx());
    assert.match(textOf(hidden), /\.hidden\.txt/);

    const scoped = await tool.execute({ path: "src/util", maxResults: 100 }, ctx());
    assert.match(textOf(scoped), /util\/a\.ts/);
    assert.doesNotMatch(textOf(scoped), /README/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_list rejects symlink escape and does not follow symlink dirs", async () => {
  const cwd = await tmp();
  const outside = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(outside, "secret.txt"), "nope\n");
    await symlink(outside, join(cwd, "escape-link"));
    const tool = createRepoListTool(cwd, { maxResults: 100 });
    const r = await tool.execute({ maxResults: 100 }, ctx());
    assert.match(textOf(r), /symlink\tescape-link/);
    assert.doesNotMatch(textOf(r), /secret\.txt/);

    const escape = await tool.execute({ path: `../${outside.split("/").pop()}` }, ctx());
    assert.ok(escape.error);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("repo_list honors abort and execution policy", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const ac = new AbortController();
    ac.abort();
    const aborted = await createRepoListTool(cwd).execute({}, ctx(ac.signal));
    assert.equal(aborted.error?.message, "Operation aborted");

    let touched = false;
    const denied = await createRepoListTool(cwd, {
      executionPolicy: { check: () => ({ allowed: false, reason: "no list" }) },
      operations: {
        list: async () => {
          touched = true;
          throw new Error("should not run");
        },
        search: async () => {
          throw new Error("should not run");
        },
        glob: async () => {
          throw new Error("should not run");
        },
      },
    }).execute({}, ctx());
    assert.equal(denied.error?.message, "no list");
    assert.equal(touched, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search literal with ordering, binary skip, and context", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "alpha\ncreateAgent here\nbeta\ngamma\n");
    const tool = createRepoSearchTool(cwd);

    const lit = await tool.execute({ query: "createAgent", mode: "literal", context: 1 }, ctx());
    assert.equal(lit.error, undefined);
    assert.match(textOf(lit), /src\/index\.ts:1:14:export const createAgent/);
    assert.match(textOf(lit), /src\/multi\.ts:2:1:createAgent here/);
    assert.match(textOf(lit), /src\/multi\.ts-alpha/);
    assert.match(textOf(lit), /src\/multi\.ts\+beta/);
    assert.doesNotMatch(textOf(lit), /binary\.bin/);
    assert.doesNotMatch(textOf(lit), /node_modules/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search rejects regex mode and evil patterns stay bounded as literal", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "evil.txt"), `${"a".repeat(50_000)}!`);
    const tool = createRepoSearchTool(cwd);

    const rejected = await tool.execute({ query: "x", mode: "regex" }, ctx());
    assert.match(rejected.error?.message ?? "", /regex|literal/i);

    const start = Date.now();
    const lit = await tool.execute({ query: "(a+)+$", mode: "literal" }, ctx());
    // ponytail: wall-clock anti-block guard, ceiling 5s (~1000x actual ~ms);
    // a slower ceiling would let a regex regression hang the suite
    assert.ok(Date.now() - start < 5_000, "literal evil pattern must not block the event loop");
    assert.equal(lit.error, undefined);
    assert.equal(lit.metadata?.matchCount, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search outputMode files_with_matches returns unique paths without line bodies", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "alpha\ncreateAgent here\nbeta\ncreateAgent again\n");
    const tool = createRepoSearchTool(cwd);

    const r = await tool.execute({ query: "createAgent", outputMode: "files_with_matches" }, ctx());
    assert.equal(r.error, undefined);
    assert.equal(r.metadata?.outputMode, "files_with_matches");
    assert.equal(r.metadata?.fileCount, 2);
    assert.equal(r.metadata?.matches, undefined);
    const text = textOf(r);
    assert.equal(text, "src/index.ts\nsrc/multi.ts");
    assert.doesNotMatch(text, /:\d+:\d+:/);
    assert.doesNotMatch(text, /binary\.bin/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search outputMode count returns totals without line bodies", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(join(cwd, "src", "multi.ts"), "createAgent\nline\ncreateAgent\n");
    const tool = createRepoSearchTool(cwd);

    const r = await tool.execute({ query: "createAgent", outputMode: "count" }, ctx());
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

test("repo_search outputMode count empty and invalid values fail closed", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    const tool = createRepoSearchTool(cwd);

    const empty = await tool.execute({ query: "zzz-not-found", outputMode: "count" }, ctx());
    assert.equal(empty.error, undefined);
    assert.equal(textOf(empty), "0 matches in 0 files");

    const bad = await tool.execute({ query: "x", outputMode: "paths_only" }, ctx());
    assert.match(bad.error?.message ?? "", /unsupported outputMode/);

    const content = await tool.execute({ query: "createAgent", outputMode: "content" }, ctx());
    assert.match(textOf(content), /src\/index\.ts:\d+:\d+:/);
    assert.ok(Array.isArray(content.metadata?.matches));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search outputMode preserves truncation semantics across modes", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "hit\nhit\nhit\n");
    const tool = createRepoSearchTool(cwd, { maxMatches: 2 });

    const content = await tool.execute({ query: "hit", maxMatches: 2, outputMode: "content" }, ctx());
    assert.equal(content.metadata?.truncated, true);
    assert.equal(content.metadata?.matchCount, 2);

    const files = await tool.execute({ query: "hit", maxMatches: 2, outputMode: "files_with_matches" }, ctx());
    assert.equal(files.metadata?.truncated, true);
    assert.match(textOf(files), /\[truncated by matches\]/);
    assert.doesNotMatch(textOf(files), /:\d+:\d+:/);

    const count = await tool.execute({ query: "hit", maxMatches: 2, outputMode: "count" }, ctx());
    assert.equal(count.metadata?.truncated, true);
    assert.match(textOf(count), /^2 matches in 1 file\n\[truncated by matches\]$/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search truncates on maxMatches and aggregate scan budget", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "hit\nhit\nhit\n");
    const tool = createRepoSearchTool(cwd, { maxMatches: 2 });
    const r = await tool.execute({ query: "hit", maxMatches: 2 }, ctx());
    assert.equal(r.metadata?.truncated, true);
    assert.equal(r.metadata?.truncatedBy, "matches");
    assert.equal(r.metadata?.matchCount, 2);

    const tiny = createRepoSearchTool(cwd, {
      repository: { maxScanBytes: 4, maxFileBytes: 1024, maxMatches: 100 },
    });
    const scan = await tiny.execute({ query: "hit" }, ctx());
    assert.equal(scan.metadata?.truncated, true);
    assert.equal(scan.metadata?.truncatedBy, "scan");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search aborts and respects custom RepositoryOperations", async () => {
  const cwd = await tmp();
  try {
    const ac = new AbortController();
    ac.abort();
    const aborted = await createRepoSearchTool(cwd).execute({ query: "x" }, ctx(ac.signal));
    assert.equal(aborted.error?.message, "Operation aborted");

    let called = false;
    const custom = await createRepoSearchTool(cwd, {
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
    }).execute({ query: "x" }, ctx());
    assert.equal(called, true);
    assert.match(textOf(custom), /x\.ts:1:1:x/);
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
      ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"],
    );
    const ro = createReadOnlyTools(cwd);
    assert.deepEqual(
      ro.map((t) => t.name),
      ["read", "repo_list", "repo_search", "glob"],
    );
    assert.ok(!ro.some((t) => t.name === "shell" || t.name === "write" || t.name === "edit"));

    const shared = createCodingTools(cwd, {
      repository: { maxResults: 1, exclude: [".git"] },
    });
    const list = shared.find((t) => t.name === "repo_list")!;
    await seedTree(cwd);
    const r = await list.execute({ maxResults: 1 }, ctx());
    assert.equal(r.metadata?.returned, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
