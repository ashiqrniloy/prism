import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import {
  createSandboxBashOperations,
  createSandboxCodingTools,
  createSandboxReadOnlyTools,
  type SandboxAdapter,
} from "../index.js";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sandbox-coding-"));
}

test("createSandboxCodingTools wires shell to sandbox and keeps list/search local", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "note.txt"), "hello from workspace\n");
    await writeFile(join(cwd, "hit.ts"), "findMe\n");

    let shellCommands = 0;
    const sandbox: SandboxAdapter = {
      exec: async (request) => {
        shellCommands++;
        assert.equal(request.cwd, cwd);
        assert.match(request.command, /echo/);
        request.onData?.(Buffer.from("sandboxed\n"));
        return { exitCode: 0 };
      },
    };

    const tools = createSandboxCodingTools(cwd, {
      sandbox,
      repository: { maxResults: 50, exclude: [".git"] },
    });
    assert.deepEqual(
      tools.map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search"],
    );

    const shell = tools.find((t) => t.name === "shell")!;
    const list = tools.find((t) => t.name === "repo_list")!;
    const search = tools.find((t) => t.name === "repo_search")!;
    const read = tools.find((t) => t.name === "read")!;

    const shellResult = await shell.execute({ command: "echo hi" }, ctx());
    assert.equal(shellResult.error, undefined);
    assert.equal(shellCommands, 1);

    const listResult = await list.execute({}, ctx());
    assert.equal(listResult.error, undefined);
    assert.match(String(listResult.content?.[0] && listResult.content[0].type === "text" ? listResult.content[0].text : ""), /hit\.ts/);

    const searchResult = await search.execute({ query: "findMe" }, ctx());
    assert.equal(searchResult.error, undefined);
    assert.equal(searchResult.metadata?.matchCount, 1);

    const readResult = await read.execute({ path: "note.txt" }, ctx());
    assert.equal(readResult.error, undefined);
    assert.match(
      String(readResult.content?.[0] && readResult.content[0].type === "text" ? readResult.content[0].text : ""),
      /hello from workspace/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createSandboxReadOnlyTools excludes mutating tools and still searches", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "marker\n");
    const sandbox: SandboxAdapter = {
      exec: async () => {
        throw new Error("shell must not run in read-only composition");
      },
    };
    const tools = createSandboxReadOnlyTools(cwd, { sandbox });
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read", "repo_list", "repo_search"],
    );
    const search = tools.find((t) => t.name === "repo_search")!;
    const result = await search.execute({ query: "marker" }, ctx());
    assert.equal(result.error, undefined);
    assert.equal(result.metadata?.matchCount, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createSandboxBashOperations remains compatible with explicit shell wiring", async () => {
  const calls: string[] = [];
  const adapter: SandboxAdapter = {
    exec: async ({ command }) => {
      calls.push(command);
      return { exitCode: 0 };
    },
  };
  const ops = createSandboxBashOperations(adapter);
  await ops.exec("true", "/workspace", { onData: () => undefined });
  assert.deepEqual(calls, ["true"]);
});
