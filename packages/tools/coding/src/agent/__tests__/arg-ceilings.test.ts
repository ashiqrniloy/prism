// Plan 239 Task 5: a value the model passes as a tool argument is bounded by a host-set ceiling, never by the model.
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createCodingTools, DEFAULT_CODING_ARG_CEILINGS, resolveCodingArgCeilings } from "../index.js";

const ctx = (): ToolExecutionContext => ({ sessionId: "s", runId: "r", toolCallId: "t", toolName: "x" }) as ToolExecutionContext;

async function withTools(
  ceilings: Parameters<typeof resolveCodingArgCeilings>[0],
  run: (tools: ReturnType<typeof createCodingTools>) => Promise<void>,
) {
  const cwd = await mkdtemp(join(tmpdir(), "arg-ceilings-"));
  try {
    await writeFile(join(cwd, "a.txt"), "needle\n");
    await run(createCodingTools(cwd, ceilings === undefined ? {} : { ceilings }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const tool = (tools: ReturnType<typeof createCodingTools>, name: string) => {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, name);
  return found;
};

test("model arguments above the default ceilings are refused", async () => {
  await withTools(undefined, async (tools) => {
    const grep = await tool(tools, "grep").execute({ pattern: "needle", maxMatches: DEFAULT_CODING_ARG_CEILINGS.searchMatches + 1 }, ctx());
    assert.match(String(grep.error?.message), /maxMatches must be a positive safe integer at most 10000/);
    const glob = await tool(tools, "glob").execute({ pattern: "*", maxDepth: DEFAULT_CODING_ARG_CEILINGS.repoDepth + 1 }, ctx());
    assert.match(String(glob.error?.message), /maxDepth must be a positive safe integer at most 128/);
    const shell = await tool(tools, "shell").execute(
      { command: "true", timeout: DEFAULT_CODING_ARG_CEILINGS.shellTimeoutSeconds + 1 },
      ctx(),
    );
    assert.match(String(shell.error?.message), /timeout must be a positive safe integer at most 3600/);
  });
});

test("the host raises and lowers each ceiling; the model cannot", async () => {
  await withTools({ searchMatches: 50_000, repoDepth: 4, shellTimeoutSeconds: 4 * 3_600 }, async (tools) => {
    const grep = await tool(tools, "grep").execute({ pattern: "needle", maxMatches: 20_000 }, ctx());
    assert.equal(grep.error, undefined);
    const glob = await tool(tools, "glob").execute({ pattern: "*", maxDepth: 5 }, ctx());
    assert.match(String(glob.error?.message), /at most 4/);
    // The schema names the host's ceiling, so the model sees what it may ask for.
    assert.match(JSON.stringify(tool(tools, "shell").parameters), /max 14400/);
  });
  assert.throws(() => resolveCodingArgCeilings({ searchMatches: 0 }), /ceilings.searchMatches/);
  assert.throws(() => resolveCodingArgCeilings({ unknown: 1 } as never), /not a coding argument ceiling/);
});
