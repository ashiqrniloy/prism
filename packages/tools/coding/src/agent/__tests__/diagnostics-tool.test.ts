import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createDiagnosticsTool } from "../diagnostics-tool.js";

const FAKE_LSP = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}
function textOf(result: ToolResult): string {
  const block = result.content?.[0];
  return block && block.type === "text" ? block.text : "";
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "diagnostics-tool-"));
}

test("diagnostics_returns_normalized_lines", async () => {
  const cwd = await tmp();
  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "const foo = 1;\n");
    const { tool, dispose } = createDiagnosticsTool(cwd, {
      servers: {
        ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"], env: { FAKE_LSP_PULL: "1" } },
      },
    });
    try {
      const result = await tool.execute({ path: "src/a.ts" }, ctx());
      assert.equal(result.error, undefined);
      // LSP positions are 0-based; the tool prints 1-based `path:line:col severity message`.
      // The refresh bumps the document version, so the fake server names it `fake-error-v2`.
      assert.match(textOf(result), /^src\/a\.ts:1:1 error fake-error-v\d+$/);
      assert.deepEqual(result.value, { file: "src/a.ts", diagnostics: 1, truncated: false });
    } finally {
      await dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics_unknown_language_names_the_language", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.py"), "x = 1\n");
    const { tool, dispose } = createDiagnosticsTool(cwd, {
      servers: { ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] } },
    });
    try {
      const result = await tool.execute({ path: "a.py" }, ctx());
      assert.match(textOf(result), /No host server registered for language python/);
      assert.ok(result.error !== undefined);
    } finally {
      await dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics_server_start_failure_is_tool_error_and_one_note", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    const warnings: string[] = [];
    const { tool, dispose } = createDiagnosticsTool(cwd, {
      servers: { tsserver: { command: "/nonexistent/language-server", languages: ["typescript"] } },
      onServerFailure: (server, message) => warnings.push(`${server}: ${message}`),
    });
    try {
      const first = await tool.execute({ path: "a.ts" }, ctx());
      assert.ok(first.error !== undefined, "a server that cannot start is a tool error");
      assert.match(textOf(first), /language server "tsserver"/);
      assert.match(textOf(first), /ENOENT|stdin closed|spawn failed/);
      await tool.execute({ path: "a.ts" }, ctx());
      assert.equal(warnings.length, 1, `one warn note per server, got ${JSON.stringify(warnings)}`);
    } finally {
      await dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics_path_outside_root_is_an_error", async () => {
  const cwd = await tmp();
  try {
    const { tool, dispose } = createDiagnosticsTool(cwd, {
      servers: { ts: { command: process.execPath, args: [FAKE_LSP], languages: ["typescript"] } },
    });
    try {
      const result = await tool.execute({ path: "../escape.ts" }, ctx());
      assert.ok(result.error !== undefined);
      assert.match(textOf(result), /escapes workspace root|outside/i);
    } finally {
      await dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics_construction_starts_no_server", async () => {
  const cwd = await tmp();
  const pidFile = join(cwd, "server.pid");
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    const created = createDiagnosticsTool(cwd, {
      servers: {
        ts: {
          command: process.execPath,
          args: [FAKE_LSP],
          languages: ["typescript"],
          env: { FAKE_LSP_PULL: "1", FAKE_LSP_PID_FILE: pidFile },
        },
      },
    });
    // Constructing the tool (and the package setup that builds it) spawns nothing.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(pidFile), false, "no language server before the first call");
    await created.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("diagnostics_dispose_stops_the_server_and_the_next_call_restarts_it", async () => {
  const cwd = await tmp();
  const pidFile = join(cwd, "server.pid");
  try {
    await writeFile(join(cwd, "a.ts"), "const foo = 1;\n");
    const { tool, dispose } = createDiagnosticsTool(cwd, {
      servers: {
        ts: {
          command: process.execPath,
          args: [FAKE_LSP],
          languages: ["typescript"],
          env: { FAKE_LSP_PULL: "1", FAKE_LSP_PID_FILE: pidFile },
        },
      },
    });
    try {
      await tool.execute({ path: "a.ts" }, ctx());
      const { readFile } = await import("node:fs/promises");
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      assert.ok(pid > 0);
      await dispose();
      // The handle re-arms: a later call starts a fresh server rather than failing on a closed one.
      const again = await tool.execute({ path: "a.ts" }, ctx());
      assert.equal(again.error, undefined);
      assert.match(textOf(again), /src\/a\.ts|a\.ts:1:1 error/);
    } finally {
      await dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
