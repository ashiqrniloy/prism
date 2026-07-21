import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createGitTools } from "@arnilo/prism-coding-agent";
import {
  assertSandboxPath,
  createSandboxCodingComposition,
  createSandboxFilesystemOperations,
  createSandboxRepositoryOperations,
  SANDBOX_FS_SCRIPTS,
  SandboxFsError,
  type DisposableSandbox,
  type SandboxExecFileRequest,
  type SandboxExecRequest,
} from "../index.js";

const ROOT = "/workspace";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}

/**
 * In-memory DisposableSandbox that understands SANDBOX_FS_SCRIPTS + simple cat/echo shell.
 */
function createMemorySandbox(workspaceRoot = ROOT): DisposableSandbox & {
  readonly files: Map<string, Buffer>;
} {
  const files = new Map<string, Buffer>();

  function ensureParent(path: string): void {
    const parts = posix.dirname(path).split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur += `/${part}`;
      if (cur === workspaceRoot) continue;
      // directories are implicit; only files are stored
      void cur;
    }
  }

  function listUnder(start: string, maxDepth: number): string[] {
    const prefix = start.endsWith("/") ? start : `${start}/`;
    const out: string[] = [];
    for (const key of files.keys()) {
      if (key === start) continue;
      if (!key.startsWith(prefix) && key !== start) continue;
      const rel = key.slice(prefix.length);
      const depth = rel.split("/").filter(Boolean).length;
      if (depth < 1 || depth > maxDepth) continue;
      const base = posix.basename(key);
      if (base === ".git" || base === "node_modules" || base === "dist") continue;
      if (rel.split("/").some((p) => p === ".git" || p === "node_modules" || p === "dist")) continue;
      out.push(key);
    }
    return out.sort();
  }

  async function execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }> {
    const emit = (data: Buffer) => request.onData?.(data);

    // Git via sandbox.execFile (SAFE_GIT_CONFIG_ARGS already prepended by coding-agent).
    if (request.file === "/usr/bin/git" || request.file.endsWith("/git")) {
      const cwd = request.cwd ?? workspaceRoot;
      if (cwd !== workspaceRoot && !cwd.startsWith(`${workspaceRoot}/`)) {
        return { exitCode: 128 };
      }
      const args = request.args;
      let i = 0;
      while (i < args.length && args[i] === "-c") i += 2;
      const cmd = args[i];
      if (cmd === "status") {
        const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
        const lines = ["# branch.oid deadbeef", "# branch.head main"];
        for (const path of [...files.keys()].sort()) {
          if (!path.startsWith(prefix)) continue;
          const rel = path.slice(prefix.length);
          if (!rel || rel === ".git" || rel.startsWith(".git/")) continue;
          lines.push(`? ${rel}`);
        }
        emit(Buffer.from(`${lines.join("\0")}\0`));
        return { exitCode: 0 };
      }
      if (cmd === "diff") {
        const dash = args.indexOf("--");
        const paths = dash >= 0 ? args.slice(dash + 1) : [];
        const chunks: string[] = [];
        for (const p of paths) {
          const abs = p.startsWith("/") ? p : posix.join(cwd, p);
          const buf = files.get(abs);
          if (!buf) continue;
          chunks.push(`diff --git a/${p} b/${p}\n+${buf.toString("utf8")}`);
        }
        if (chunks.length > 0) emit(Buffer.from(chunks.join("")));
        return { exitCode: 0 };
      }
      // add/commit/etc. — cwd-bound only; pathspecs not rewritten (sandbox tree contains them).
      return { exitCode: 0 };
    }

    if (request.file !== "/bin/sh" || request.args[0] !== "-c") {
      throw new Error(`unsupported execFile: ${request.file}`);
    }
    const script = request.args[1]!;
    const positional = request.args.slice(3); // skip -c, script, $0

    if (script === SANDBOX_FS_SCRIPTS.access) {
      const path = positional[0]!;
      return { exitCode: files.has(path) ? 0 : 1 };
    }
    if (script === SANDBOX_FS_SCRIPTS.stat) {
      const path = positional[0]!;
      const buf = files.get(path);
      if (!buf) return { exitCode: 1 };
      emit(Buffer.from(String(buf.byteLength)));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.read) {
      const path = positional[0]!;
      const maxBytes = Number(positional[1]);
      const buf = files.get(path);
      if (!buf) return { exitCode: 1 };
      emit(buf.subarray(0, maxBytes));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.truncate) {
      const path = positional[0]!;
      ensureParent(path);
      files.set(path, Buffer.alloc(0));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.mkdir) {
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.write || script === SANDBOX_FS_SCRIPTS.append) {
      const b64 = positional[0]!;
      const path = positional[1]!;
      ensureParent(path);
      const chunk = Buffer.from(b64, "base64");
      if (script === SANDBOX_FS_SCRIPTS.write) files.set(path, chunk);
      else files.set(path, Buffer.concat([files.get(path) ?? Buffer.alloc(0), chunk]));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.find) {
      const start = positional[0]!;
      const maxDepth = Number(positional[1]);
      const lines = listUnder(start, maxDepth).join("\n");
      if (lines) emit(Buffer.from(`${lines}\n`));
      return { exitCode: 0 };
    }
    throw new Error(`unsupported script: ${script}`);
  }

  async function exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }> {
    const command = request.command.trim();
    const cat = /^cat(?:\s+)(.+)$/.exec(command);
    if (cat) {
      const path = cat[1]!.trim();
      const buf = files.get(path);
      if (!buf) return { exitCode: 1 };
      request.onData?.(buf);
      return { exitCode: 0 };
    }
    const printf = /^printf '%s' (.+) > (.+)$/.exec(command);
    if (printf) {
      // unused — tools use execFile for writes
      return { exitCode: 0 };
    }
    if (command.startsWith("echo ")) {
      request.onData?.(Buffer.from(`${command.slice(5)}\n`));
      return { exitCode: 0 };
    }
    return { exitCode: 0 };
  }

  return {
    files,
    id: "mem-sandbox",
    exec,
    execFile,
    status: async () => ({
      id: "mem-sandbox",
      state: "running",
      image: "memory",
      startedAt: 0,
      lastActivityAt: 0,
      commandCount: 0,
    }),
    stop: async () => undefined,
    kill: async () => undefined,
    close: async () => undefined,
  };
}

test("assertSandboxPath rejects escapes", () => {
  assert.equal(assertSandboxPath(ROOT, "/workspace/a.ts"), "/workspace/a.ts");
  assert.throws(() => assertSandboxPath(ROOT, "/etc/passwd"), SandboxFsError);
  assert.throws(() => assertSandboxPath(ROOT, "/workspace/../etc/passwd"), SandboxFsError);
});

test("write via ops then shell cat sees same bytes", async () => {
  const sandbox = createMemorySandbox();
  const { write, read } = createSandboxFilesystemOperations(sandbox, { workspaceRoot: ROOT });
  await write.writeFile(`${ROOT}/note.txt`, "hello-sandbox\n", { maxBytes: 1024 });
  const viaRead = await read.readFile(`${ROOT}/note.txt`, { maxBytes: 1024 });
  assert.equal(viaRead.toString("utf8"), "hello-sandbox\n");

  const chunks: Buffer[] = [];
  const { exitCode } = await sandbox.exec({
    command: `cat ${ROOT}/note.txt`,
    cwd: ROOT,
    onData: (d) => chunks.push(d),
  });
  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "hello-sandbox\n");
});

test("shell-visible file readable via tool after composition auto-wire", async () => {
  const sandbox = createMemorySandbox();
  sandbox.files.set(`${ROOT}/seed.txt`, Buffer.from("from-shell\n"));

  const { tools, composition } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });
  assert.equal(composition.containmentClaim, true);
  assert.equal(composition.workspaceRoot, ROOT);

  const read = tools.find((t) => t.name === "read")!;
  const result = await read.execute({ path: "seed.txt" }, ctx());
  assert.equal(result.error, undefined);
  assert.match(
    String(result.content?.[0] && result.content[0].type === "text" ? result.content[0].text : ""),
    /from-shell/,
  );

  const write = tools.find((t) => t.name === "write")!;
  assert.equal((await write.execute({ path: "out.txt", content: "via-tool\n" }, ctx())).error, undefined);
  assert.equal(sandbox.files.get(`${ROOT}/out.txt`)?.toString("utf8"), "via-tool\n");

  const chunks: Buffer[] = [];
  await sandbox.exec({
    command: `cat ${ROOT}/out.txt`,
    cwd: ROOT,
    onData: (d) => chunks.push(d),
  });
  assert.equal(Buffer.concat(chunks).toString("utf8"), "via-tool\n");
});

test("list/search agree with tree contents", async () => {
  const sandbox = createMemorySandbox();
  sandbox.files.set(`${ROOT}/hit.ts`, Buffer.from("findMe\n"));
  sandbox.files.set(`${ROOT}/miss.ts`, Buffer.from("other\n"));
  const repo = createSandboxRepositoryOperations(sandbox, {
    workspaceRoot: ROOT,
    limits: { maxResults: 50 },
  });
  const listed = await repo.list({ root: ROOT });
  assert.ok(listed.entries.some((e) => e.path === "hit.ts"));
  const found = await repo.search({ root: ROOT, query: "findMe" });
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0]?.path, "hit.ts");
});

test("oversized write fails closed without retaining", async () => {
  const sandbox = createMemorySandbox();
  const { write } = createSandboxFilesystemOperations(sandbox, { workspaceRoot: ROOT });
  await assert.rejects(
    () => write.writeFile(`${ROOT}/big.txt`, "x".repeat(100), { maxBytes: 8 }),
    SandboxFsError,
  );
  assert.equal(sandbox.files.has(`${ROOT}/big.txt`), false);
});

test("path escape on write fails closed", async () => {
  const sandbox = createMemorySandbox();
  const { write } = createSandboxFilesystemOperations(sandbox, { workspaceRoot: ROOT });
  await assert.rejects(() => write.writeFile("/tmp/escape.txt", "nope\n"), SandboxFsError);
});

function textOf(result: { content?: readonly { type: string; text?: string }[]; error?: unknown }): string {
  const block = result.content?.[0];
  return block && block.type === "text" && typeof block.text === "string" ? block.text : "";
}

test("sandbox write then git_status/diff via execFile share workspaceRoot tree", async () => {
  const sandbox = createMemorySandbox();
  const { tools, composition } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });
  assert.equal(composition.containmentClaim, true);
  assert.equal(composition.workspaceRoot, ROOT);

  const write = tools.find((t) => t.name === "write")!;
  assert.equal((await write.execute({ path: "added.txt", content: "tracked-soon\n" }, ctx())).error, undefined);
  assert.equal(sandbox.files.get(`${ROOT}/added.txt`)?.toString("utf8"), "tracked-soon\n");

  // Same tree/cwd as coding tools: composition.workspaceRoot + sandbox.execFile (no binder — <2 non-test sites).
  const gitTools = createGitTools(composition.workspaceRoot, {
    gitPath: "/usr/bin/git",
    execFile: (request) => sandbox.execFile(request),
    commitIdentity: { name: "bot", email: "bot@example.com" },
    checks: {
      noop: { file: "/bin/true", args: [] },
    },
  });
  assert.ok(gitTools.some((t) => t.name === "coding_check"));

  const status = gitTools.find((t) => t.name === "git_status")!;
  const statusResult = await status.execute({}, ctx());
  assert.equal(statusResult.error, undefined);
  assert.match(textOf(statusResult), /added\.txt/);
  assert.match(textOf(statusResult), /dirty=true/);

  const diff = gitTools.find((t) => t.name === "git_diff")!;
  const diffResult = await diff.execute({ paths: ["added.txt"] }, ctx());
  assert.equal(diffResult.error, undefined);
  assert.match(textOf(diffResult), /tracked-soon/);
});

test("host mode Git stays on host cwd; composition does not claim containment", async () => {
  const hostRoot = await mkdtemp(join(tmpdir(), "prism-host-git-"));
  try {
    await writeFile(join(hostRoot, "host-only.txt"), "host\n");
    const { composition } = createSandboxCodingComposition(hostRoot, {
      workspaceMode: "host",
    });
    assert.equal(composition.containmentClaim, false);
    assert.equal(composition.workspaceRoot, hostRoot);

    const calls: { cwd: string; args: readonly string[] }[] = [];
    const gitTools = createGitTools(composition.workspaceRoot, {
      gitPath: "/usr/bin/git",
      runner: async (request) => {
        calls.push({ cwd: request.cwd, args: request.args });
        const payload = ["# branch.oid abc", "# branch.head main", "? host-only.txt"].join("\0") + "\0";
        return {
          exitCode: 0,
          stdout: Buffer.from(payload),
          stderr: Buffer.alloc(0),
          timedOut: false,
          aborted: false,
          outputBytes: payload.length,
        };
      },
    });
    const status = await gitTools.find((t) => t.name === "git_status")!.execute({}, ctx());
    assert.equal(status.error, undefined);
    assert.equal(calls[0]?.cwd, hostRoot);
    assert.match(textOf(status), /host-only\.txt/);
  } finally {
    await rm(hostRoot, { recursive: true, force: true });
  }
});

test("sandbox Git pathspecs stay cwd-bound (escape path still runs under workspaceRoot)", async () => {
  const sandbox = createMemorySandbox();
  const { composition } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });

  const seen: { cwd: string; args: readonly string[] }[] = [];
  const gitTools = createGitTools(composition.workspaceRoot, {
    gitPath: "/usr/bin/git",
    execFile: async (request) => {
      seen.push({ cwd: request.cwd ?? "", args: request.args });
      return sandbox.execFile(request);
    },
    commitIdentity: { name: "bot", email: "bot@example.com" },
  });

  // Absolute escape pathspec: existing Git rules pass after `--`; containment is cwd + sandbox tree.
  const diff = gitTools.find((t) => t.name === "git_diff")!;
  const result = await diff.execute({ paths: ["/etc/passwd"] }, ctx());
  assert.equal(result.error, undefined);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.cwd, ROOT);
  assert.ok(seen[0]?.args.includes("--"));
  assert.ok(seen[0]?.args.includes("/etc/passwd"));
});
