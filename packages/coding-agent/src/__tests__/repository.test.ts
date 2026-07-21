import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createRepoListTool } from "../list.js";
import { createRepoSearchTool } from "../search.js";
import {
  createLocalRepositoryOperations,
  resolveRepositoryLimits,
  compileSearchPattern,
  isBinaryBuffer,
} from "../repository.js";
import {
  createCodingTools,
  createReadOnlyTools,
} from "../index.js";

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

test("compileSearchPattern literal and regex", () => {
  const lit = compileSearchPattern("Agent", "literal", true, 512);
  assert.deepEqual(lit.testLine("createAgent"), { column: 7 });
  assert.equal(lit.testLine("createagent"), null);

  const litCi = compileSearchPattern("Agent", "literal", false, 512);
  assert.deepEqual(litCi.testLine("createagent"), { column: 7 });

  const re = compileSearchPattern("create\\w+", "regex", true, 512);
  assert.deepEqual(re.testLine("xx createAgent yy"), { column: 4 });

  assert.throws(() => compileSearchPattern("(", "regex", true, 512), /invalid regular expression/);
  assert.throws(() => compileSearchPattern("x".repeat(600), "literal", true, 512), /pattern limit/);
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
    assert.deepEqual(paths, [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
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
    assert.equal((page2.metadata?.entries as unknown[]).length <= 2, true);

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

    const escape = await tool.execute({ path: "../" + outside.split("/").pop() }, ctx());
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
      },
    }).execute({}, ctx());
    assert.equal(denied.error?.message, "no list");
    assert.equal(touched, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("repo_search literal and regex with ordering, binary skip, and context", async () => {
  const cwd = await tmp();
  try {
    await seedTree(cwd);
    await writeFile(
      join(cwd, "src", "multi.ts"),
      "alpha\ncreateAgent here\nbeta\ngamma\n",
    );
    const tool = createRepoSearchTool(cwd);

    const lit = await tool.execute({ query: "createAgent", mode: "literal", context: 1 }, ctx());
    assert.equal(lit.error, undefined);
    assert.match(textOf(lit), /src\/index\.ts:1:14:export const createAgent/);
    assert.match(textOf(lit), /src\/multi\.ts:2:1:createAgent here/);
    assert.match(textOf(lit), /src\/multi\.ts-alpha/);
    assert.match(textOf(lit), /src\/multi\.ts\+beta/);
    assert.doesNotMatch(textOf(lit), /binary\.bin/);
    assert.doesNotMatch(textOf(lit), /node_modules/);

    const re = await tool.execute({ query: "create\\w+", mode: "regex", maxMatches: 10 }, ctx());
    assert.equal(re.error, undefined);
    assert.ok((re.metadata?.matchCount as number) >= 1);

    const bad = await tool.execute({ query: "(", mode: "regex" }, ctx());
    assert.ok(bad.error?.message.includes("invalid regular expression"));
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
            matches: [
              { path: "x.ts", line: 1, column: 1, text: "x", before: [], after: [] },
            ],
            truncated: false,
            truncatedBy: null,
            scannedBytes: 1,
            scannedFiles: 1,
            scannedEntries: 1,
            filesSkippedBinary: 0,
            filesSkippedOversize: 0,
          };
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

test("aggregators include list/search; read-only excludes mutating tools", async () => {
  const cwd = await tmp();
  try {
    const full = createCodingTools(cwd);
    assert.deepEqual(
      full.map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search"],
    );
    const ro = createReadOnlyTools(cwd);
    assert.deepEqual(
      ro.map((t) => t.name),
      ["read", "repo_list", "repo_search"],
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
