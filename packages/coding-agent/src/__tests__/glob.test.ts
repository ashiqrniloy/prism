import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createCodingTools, createGlobTool, createReadOnlyTools } from "../index.js";
import { matchGlobPattern, validateGlobPattern } from "../glob-match.js";
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
