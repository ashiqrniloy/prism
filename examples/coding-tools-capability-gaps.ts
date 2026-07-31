import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@arnilo/prism";
import {
  createDeleteTool,
  createEditTool,
  createGlobTool,
  createMoveTool,
  createReadPathSet,
  createReadTool,
  createRepoSearchTool,
  createWriteTool,
} from "@arnilo/prism-coding-agent";

function textOf(result: { content?: ReadonlyArray<{ type: string; text?: string }> }): string {
  const block = result.content?.[0];
  return block && block.type === "text" && typeof block.text === "string" ? block.text : "";
}

/**
 * Network-free smoke of Phase 4 coding-tool capabilities:
 * repo_search outputMode, glob, read-before-write, delete, move.
 */
export async function demo() {
  const cwd = await mkdtemp(join(tmpdir(), "prism-coding-tools-gaps-"));
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(join(cwd, "src", "b.ts"), "export const beta = alpha;\n", "utf8");

    const ctx: ToolExecutionContext = {
      toolCallId: "demo",
      sessionId: "demo-session",
      runId: "demo-run",
      signal: AbortSignal.timeout(15_000),
    };

    const search = createRepoSearchTool(cwd);
    const count = await search.execute({ query: "alpha", outputMode: "count" }, ctx);
    const files = await search.execute({ query: "alpha", outputMode: "files_with_matches" }, ctx);

    const glob = createGlobTool(cwd);
    const matched = await glob.execute({ pattern: "src/**/*.ts" }, ctx);

    const readPaths = createReadPathSet();
    const read = createReadTool(cwd, { readPathSet: readPaths });
    const write = createWriteTool(cwd, { requireReadBeforeWrite: true, readPathSet: readPaths });
    const edit = createEditTool(cwd, { requireReadBeforeWrite: true, readPathSet: readPaths });

    const refused = await write.execute({ path: "src/a.ts", content: "export const alpha = 2;\n" }, ctx);
    await read.execute({ path: "src/a.ts" }, ctx);
    const edited = await edit.execute({ path: "src/a.ts", edits: [{ oldText: "alpha = 1", newText: "alpha = 2" }] }, ctx);

    const move = createMoveTool(cwd);
    await move.execute({ from: "src/b.ts", to: "src/renamed.ts" }, ctx);
    const del = createDeleteTool(cwd);
    await del.execute({ path: "src/renamed.ts" }, ctx);

    const remaining = await readFile(join(cwd, "src", "a.ts"), "utf8");

    return {
      countText: textOf(count),
      filesText: textOf(files),
      globText: textOf(matched),
      writeRefused: Boolean(refused.error),
      editOk: !edited.error,
      remaining,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
