import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importToolModule, loadReplacementToolModules, loadToolModules, PrismCodeModuleError } from "../index.js";

test("importToolModule loads tool from a valid local module", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile = join(tmp, "custom-tool.mjs");

  try {
    writeFileSync(
      toolFile,
      `
      export const defaultTool = {
        name: "custom_echo",
        description: "Echoes input",
        execute: async (args) => args,
      };
      export default defaultTool;
      `,
      "utf8",
    );

    const tools = await importToolModule("./custom-tool.mjs", tmp, { workspaceRoot: tmp });
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "custom_echo");
    assert.equal(tools[0]?.description, "Echoes input");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("importToolModule loads named export with hash fragment", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile = join(tmp, "multi-tools.mjs");

  try {
    writeFileSync(
      toolFile,
      `
      export const toolA = {
        name: "tool_a",
        description: "Tool A",
        execute: async () => "A",
      };
      export const toolB = {
        name: "tool_b",
        description: "Tool B",
        execute: async () => "B",
      };
      `,
      "utf8",
    );

    const tools = await importToolModule("./multi-tools.mjs#toolB", tmp, { workspaceRoot: tmp });
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "tool_b");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("importToolModule loads from a factory function", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile = join(tmp, "factory-tool.mjs");

  try {
    writeFileSync(
      toolFile,
      `
      export default function createTool() {
        return {
          name: "factory_tool",
          description: "Created via factory",
          execute: async () => "factory",
        };
      }
      `,
      "utf8",
    );

    const tools = await importToolModule("./factory-tool.mjs", tmp, { workspaceRoot: tmp });
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "factory_tool");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("importToolModule fails closed when module does not exist, naming specifier", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  try {
    await assert.rejects(
      async () => {
        await importToolModule("./missing.mjs", tmp, { workspaceRoot: tmp });
      },
      (err: unknown) => {
        assert(err instanceof PrismCodeModuleError);
        assert.equal(err.code, "ERR_PRISM_CODE_MODULE");
        assert(err.message.includes("./missing.mjs"));
        return true;
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("importToolModule fails closed when module escapes workspaceRoot", async () => {
  const root = join(tmpdir(), `prism-code-tools-root-${Date.now()}`);
  const inside = join(root, "inside");
  const outside = join(root, "outside");
  mkdirSync(inside, { recursive: true });
  mkdirSync(outside, { recursive: true });

  const outsideTool = join(outside, "escape.mjs");
  writeFileSync(
    outsideTool,
    `
    export default {
      name: "escape_tool",
      description: "Escapes sandbox",
      execute: async () => "escaped",
    };
    `,
    "utf8",
  );

  try {
    await assert.rejects(
      async () => {
        await importToolModule("../outside/escape.mjs", inside, { workspaceRoot: inside });
      },
      (err: unknown) => {
        assert(err instanceof PrismCodeModuleError);
        assert(err.message.includes("escapes the allowed workspace root"));
        assert(err.message.includes("../outside/escape.mjs"));
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importToolModule fails closed when absolute path or package is not in allowList", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile = join(tmp, "abs-tool.mjs");
  writeFileSync(toolFile, `export default { name: "abs", description: "abs", execute: async () => "ok" };`, "utf8");

  try {
    await assert.rejects(
      async () => {
        await importToolModule(toolFile, tmp, { workspaceRoot: tmp, allowList: [] });
      },
      (err: unknown) => {
        assert(err instanceof PrismCodeModuleError);
        assert(err.message.includes("is not in allowedModules or PRISM_TOOL_ALLOWLIST"));
        return true;
      },
    );

    // With explicit allow-listing, it succeeds
    const tools = await importToolModule(toolFile, tmp, {
      workspaceRoot: tmp,
      allowList: [toolFile],
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "abs");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadReplacementToolModules loads and maps replacement tool", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile = join(tmp, "repl-read.mjs");

  try {
    writeFileSync(
      toolFile,
      `
      export default {
        name: "read",
        description: "Custom read implementation",
        execute: async () => "custom read",
      };
      `,
      "utf8",
    );

    const replacements = await loadReplacementToolModules({ read: "./repl-read.mjs" }, tmp, { workspaceRoot: tmp });

    assert(replacements.read);
    assert.equal(replacements.read.name, "read");
    assert.equal(replacements.read.description, "Custom read implementation");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadToolModules loads multiple module specifiers sequentially", async () => {
  const tmp = join(tmpdir(), `prism-code-tools-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const toolFile1 = join(tmp, "tool-1.mjs");
  const toolFile2 = join(tmp, "tool-2.mjs");

  try {
    writeFileSync(toolFile1, `export default { name: "t1", description: "d1", execute: async () => 1 };`, "utf8");
    writeFileSync(toolFile2, `export default { name: "t2", description: "d2", execute: async () => 2 };`, "utf8");

    const tools = await loadToolModules(["./tool-1.mjs", "./tool-2.mjs"], tmp, {
      workspaceRoot: tmp,
    });
    assert.equal(tools.length, 2);
    assert.equal(tools[0]?.name, "t1");
    assert.equal(tools[1]?.name, "t2");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
