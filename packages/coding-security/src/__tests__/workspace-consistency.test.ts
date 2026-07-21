/**
 * Adversarial workspace-mode consistency matrix (Plan 073 Task 5).
 * Network-free memory DisposableSandbox + host temp dirs only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import {
  createSandboxCodingComposition,
  SANDBOX_FS_SCRIPTS,
  type DisposableSandbox,
  type SandboxExecFileRequest,
  type SandboxExecRequest,
} from "../index.js";

const ROOT = "/workspace";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}

function textOf(result: { content?: readonly { type: string; text?: string }[]; error?: unknown }): string {
  const block = result.content?.[0];
  return block && block.type === "text" && typeof block.text === "string" ? block.text : "";
}

/** Minimal in-memory tree + SANDBOX_FS_SCRIPTS dialect (same as FS unit tests). */
function createMemorySandbox(workspaceRoot = ROOT): DisposableSandbox & { readonly files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();

  function listUnder(start: string, maxDepth: number): string[] {
    const prefix = start.endsWith("/") ? start : `${start}/`;
    const out: string[] = [];
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rel = key.slice(prefix.length);
      const depth = rel.split("/").filter(Boolean).length;
      if (depth < 1 || depth > maxDepth) continue;
      if (rel.split("/").some((p) => p === ".git" || p === "node_modules" || p === "dist")) continue;
      out.push(key);
    }
    return out.sort();
  }

  async function execFile(request: SandboxExecFileRequest): Promise<{ exitCode: number | null }> {
    if (request.file !== "/bin/sh" || request.args[0] !== "-c") {
      throw new Error(`unsupported execFile: ${request.file}`);
    }
    const script = request.args[1]!;
    const positional = request.args.slice(3);
    const emit = (data: Buffer) => request.onData?.(data);

    if (script === SANDBOX_FS_SCRIPTS.access) {
      return { exitCode: files.has(positional[0]!) ? 0 : 1 };
    }
    if (script === SANDBOX_FS_SCRIPTS.stat) {
      const buf = files.get(positional[0]!);
      if (!buf) return { exitCode: 1 };
      emit(Buffer.from(String(buf.byteLength)));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.read) {
      const buf = files.get(positional[0]!);
      if (!buf) return { exitCode: 1 };
      emit(buf.subarray(0, Number(positional[1])));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.truncate) {
      files.set(positional[0]!, Buffer.alloc(0));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.mkdir) return { exitCode: 0 };
    if (script === SANDBOX_FS_SCRIPTS.write || script === SANDBOX_FS_SCRIPTS.append) {
      const chunk = Buffer.from(positional[0]!, "base64");
      const path = positional[1]!;
      if (script === SANDBOX_FS_SCRIPTS.write) files.set(path, chunk);
      else files.set(path, Buffer.concat([files.get(path) ?? Buffer.alloc(0), chunk]));
      return { exitCode: 0 };
    }
    if (script === SANDBOX_FS_SCRIPTS.find) {
      const lines = listUnder(positional[0]!, Number(positional[1])).join("\n");
      if (lines) emit(Buffer.from(`${lines}\n`));
      return { exitCode: 0 };
    }
    throw new Error(`unsupported script: ${script}`);
  }

  async function exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }> {
    const command = request.command.trim();
    const cat = /^cat(?:\s+)(.+)$/.exec(command);
    if (cat) {
      let path = cat[1]!.trim().replace(/^['"]|['"]$/g, "");
      if (!path.startsWith("/")) path = posix.join(request.cwd, path);
      const buf = files.get(path);
      if (!buf) return { exitCode: 1 };
      request.onData?.(buf);
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
    id: "mem-consistency",
    exec,
    execFile,
    status: async () => ({
      id: "mem-consistency",
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

test("adversarial: edit then shell cat share sandbox tree", async () => {
  const sandbox = createMemorySandbox();
  sandbox.files.set(`${ROOT}/edit-me.txt`, Buffer.from("before\n"));
  const { tools, composition } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });
  assert.equal(composition.containmentClaim, true);

  const edit = tools.find((t) => t.name === "edit")!;
  const edited = await edit.execute(
    { path: "edit-me.txt", oldText: "before", newText: "after-edit" },
    ctx(),
  );
  assert.equal(edited.error, undefined);
  assert.equal(sandbox.files.get(`${ROOT}/edit-me.txt`)?.toString("utf8"), "after-edit\n");

  const shell = tools.find((t) => t.name === "shell")!;
  const cat = await shell.execute({ command: `cat ${ROOT}/edit-me.txt` }, ctx());
  assert.equal(cat.error, undefined);
  assert.match(textOf(cat), /after-edit/);
});

test("adversarial: list then edit then search agree on sandbox tree", async () => {
  const sandbox = createMemorySandbox();
  sandbox.files.set(`${ROOT}/a.ts`, Buffer.from("const marker = 1;\n"));
  const { tools } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });

  const list = tools.find((t) => t.name === "repo_list")!;
  const listed = await list.execute({}, ctx());
  assert.equal(listed.error, undefined);
  assert.match(textOf(listed), /a\.ts/);

  const edit = tools.find((t) => t.name === "edit")!;
  assert.equal(
    (await edit.execute({ path: "a.ts", oldText: "marker = 1", newText: "marker = 42" }, ctx())).error,
    undefined,
  );

  const search = tools.find((t) => t.name === "repo_search")!;
  const found = await search.execute({ query: "marker = 42" }, ctx());
  assert.equal(found.error, undefined);
  assert.match(textOf(found), /a\.ts/);
  const miss = await search.execute({ query: "marker = 1" }, ctx());
  assert.equal(miss.error, undefined);
  assert.doesNotMatch(textOf(miss), /a\.ts/);
});

test("adversarial: host mode write lands on host cwd; no containment claim", async () => {
  const hostRoot = await mkdtemp(join(tmpdir(), "prism-host-ws-"));
  try {
    const { tools, composition } = createSandboxCodingComposition(hostRoot, {
      workspaceMode: "host",
    });
    assert.equal(composition.containmentClaim, false);
    assert.equal(composition.workspaceRoot, hostRoot);

    const write = tools.find((t) => t.name === "write")!;
    assert.equal(
      (await write.execute({ path: "host-mut.txt", content: "on-host\n" }, ctx())).error,
      undefined,
    );
    assert.equal(await readFile(join(hostRoot, "host-mut.txt"), "utf8"), "on-host\n");
  } finally {
    await rm(hostRoot, { recursive: true, force: true });
  }
});

test("adversarial: sandbox write does not mutate host cwd", async () => {
  const hostRoot = await mkdtemp(join(tmpdir(), "prism-sandbox-iso-"));
  try {
    await writeFile(join(hostRoot, "preexisting.txt"), "host-only\n");
    const sandbox = createMemorySandbox();
    const { tools, composition } = createSandboxCodingComposition(hostRoot, {
      workspaceMode: "sandbox",
      sandbox,
      workspaceRoot: ROOT,
    });
    assert.equal(composition.containmentClaim, true);

    const write = tools.find((t) => t.name === "write")!;
    assert.equal(
      (await write.execute({ path: "sand-only.txt", content: "in-tree\n" }, ctx())).error,
      undefined,
    );
    assert.equal(sandbox.files.get(`${ROOT}/sand-only.txt`)?.toString("utf8"), "in-tree\n");
    await assert.rejects(() => readFile(join(hostRoot, "sand-only.txt"), "utf8"), /ENOENT/);
    assert.equal(await readFile(join(hostRoot, "preexisting.txt"), "utf8"), "host-only\n");
  } finally {
    await rm(hostRoot, { recursive: true, force: true });
  }
});

test("adversarial: mixed wiring escape hatch never claims containment", async () => {
  const hostRoot = await mkdtemp(join(tmpdir(), "prism-mixed-"));
  try {
    const sandbox = createMemorySandbox();
    // Hatch + no custom ops: keep host FS defaults (explicit split-brain); no containment claim.
    const { tools, composition } = createSandboxCodingComposition(hostRoot, {
      workspaceMode: "sandbox",
      sandbox,
      allowMixedWorkspaceWiring: true,
    });
    assert.equal(composition.containmentClaim, false);
    assert.ok(composition.warnings.some((w) => /mixed/i.test(w)));

    const write = tools.find((t) => t.name === "write")!;
    assert.equal(
      (await write.execute({ path: "mixed-host.txt", content: "host\n" }, ctx())).error,
      undefined,
    );
    assert.equal(await readFile(join(hostRoot, "mixed-host.txt"), "utf8"), "host\n");
    assert.equal(sandbox.files.has(`${ROOT}/mixed-host.txt`), false);
  } finally {
    await rm(hostRoot, { recursive: true, force: true });
  }
});

test("adversarial: path escape on sandbox read/write still fails closed", async () => {
  const sandbox = createMemorySandbox();
  const { tools } = createSandboxCodingComposition("/host/ignored", {
    workspaceMode: "sandbox",
    sandbox,
    workspaceRoot: ROOT,
  });
  const read = tools.find((t) => t.name === "read")!;
  const write = tools.find((t) => t.name === "write")!;
  assert.ok((await read.execute({ path: "/etc/passwd" }, ctx())).error);
  assert.ok((await write.execute({ path: "/tmp/escape.txt", content: "x\n" }, ctx())).error);
  assert.equal(sandbox.files.has("/etc/passwd"), false);
  assert.equal(sandbox.files.has("/tmp/escape.txt"), false);
});
