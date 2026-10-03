import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, createMockProvider, PackageLoadError, providerDone } from "@arnilo/prism";
import {
  compileMatcher,
  createContextQueue,
  estimateContextTokens,
  HooksConfigError,
  hookCommandHash,
  type HooksJsonConfig,
  hooksJson,
  tokenizeCommand,
} from "../index.js";

async function load(config: object) {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerDone()]),
    packages: [hooksJson({ config: { ...(config as HooksJsonConfig), allowCommands: "all" } })],
  });
}

async function invalid(config: object): Promise<void> {
  await assert.rejects(
    load(config),
    (error: unknown) => error instanceof PackageLoadError && (error.code === "config_invalid" || error.code === "config_unknown_key"),
  );
}

describe("hooks.json schema", () => {
  it("accepts the flat Claude shape", async () => {
    const agent = await load({
      PreToolUse: [{ matcher: "Bash|Write", hooks: [{ type: "command", command: "node audit.js", timeout: 5 }] }],
      Stop: [{ hooks: [{ type: "command", command: "node debt.js", async: true }] }],
      additionalContextLimit: 0,
    });
    const names = Object.keys(agent.inspect().hooks);
    assert.ok(names.includes("tool.call"));
    assert.ok(names.includes("run.end"));
    await agent.dispose();
  });

  it("accepts the Codex nested shape with bare handlers", async () => {
    const agent = await load({
      hooks: {
        SessionStart: [{ type: "command", command: "node start.js" }],
        PostToolUse: [{ type: "mcp_tool", server: "audit", tool: "record", input: { path: "${tool_input.file_path}" } }],
      },
    });
    const names = Object.keys(agent.inspect().hooks);
    assert.ok(names.includes("session.opened"));
    assert.ok(names.includes("tool.result"));
    await agent.dispose();
  });

  it("rejects an unknown event name loudly instead of ignoring it", async () => {
    await invalid({ PreToolUsee: [{ hooks: [{ type: "command", command: "node x.js" }] }] });
  });

  it("rejects shell interpolation, bad timeouts, and unknown handler types", async () => {
    await invalid({ Stop: [{ hooks: [{ type: "command", command: "echo x", shell: true }] }] });
    await invalid({ Stop: [{ hooks: [{ type: "command", command: "echo x", timeout: 0 }] }] });
    await invalid({ Stop: [{ hooks: [{ type: "webhook", url: "https://x" }] }] });
    await invalid({ Stop: [{ hooks: [{ type: "command", command: "" }] }] });
    await invalid({ additionalContextLimit: -1 });
  });
});

describe("compileMatcher", () => {
  it("matches literal tokens and pipe/comma separated alternatives", () => {
    const matcher = compileMatcher("Bash|Write");
    assert.equal(matcher("Bash"), true);
    assert.equal(matcher("Write"), true);
    assert.equal(matcher("Read"), false);
    assert.equal(compileMatcher(" mcp__server__tool ").call(null, "mcp__server__tool"), true);
    assert.equal(compileMatcher(undefined)("anything"), true);
    assert.equal(compileMatcher("*")("anything"), true);
  });

  it("treats metacharacter patterns as unanchored regexes and never substitutes captures", () => {
    const matcher = compileMatcher("^mcp__.*__(read|write)$");
    assert.equal(matcher("mcp__fs__read"), true);
    assert.equal(matcher("run_mcp__fs__read_extra"), false);
    const unanchored = compileMatcher("Bash.*");
    assert.equal(unanchored("run-Bash-tool"), true);
    assert.throws(() => {
      const broken = compileMatcher("([");
      broken("anything");
    }, HooksConfigError);
  });
});

describe("command tokenization and trust hashing", () => {
  it("splits a command string without expanding anything", () => {
    assert.deepEqual(tokenizeCommand('node "audit script.js" --flag x'), ["node", "audit script.js", "--flag", "x"]);
    assert.deepEqual(tokenizeCommand("node one\\ two.js"), ["node", "one two.js"]);
    assert.deepEqual(tokenizeCommand("node x.js --a=$HOME"), ["node", "x.js", "--a=$HOME"]);
    assert.throws(() => tokenizeCommand('node "unterminated'), /unterminated quote/);
  });

  it("hashes the effective argv, so extra args invalidate a trusted entry", () => {
    const base = { type: "command", command: "node audit.js" } as const;
    const hash = hookCommandHash(base);
    assert.match(hash, /^sha256-[0-9a-f]{64}$/);
    assert.equal(hash, hookCommandHash({ type: "command", command: "node audit.js" }));
    assert.notEqual(hash, hookCommandHash({ type: "command", command: "node audit.js", args: ["--extra"] }));
    assert.match(hookCommandHash(base, { algorithm: "sha512" }), /^sha512-[0-9a-f]{128}$/);
    assert.throws(() => hookCommandHash(base, { algorithm: "nope" }), HooksConfigError);
  });
});

describe("context queue", () => {
  it("delivers once, in order, and spills per item over the inline limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-hooks-"));
    try {
      // Codex applies the cap per handler, so a small item next to a large one stays inline.
      const oversized = "oversized ".repeat(4).trim();
      const queue = createContextQueue(2, dir);
      queue.add("");
      queue.add(oversized);
      queue.add("ok");
      const drained = queue.drain();
      assert.match(drained, /exceeded the inline context limit and was written to /);
      const file = drained.match(/(\S+\.txt)/)?.[1];
      assert.ok(file);
      assert.equal(readFileSync(file, "utf8"), oversized);
      assert.match(drained, /\n\nok$/, "the small item is still inlined");
      assert.equal(queue.drain(), "");

      const inline = createContextQueue(100, dir);
      inline.add("small");
      assert.equal(inline.drain(), "small");

      // A per-item limit beats the queue default in both directions.
      const overridden = createContextQueue(1, dir);
      overridden.add("x".repeat(400), 0);
      assert.equal(overridden.drain(), "x".repeat(400));
      const tightened = createContextQueue(100, dir);
      tightened.add("y".repeat(400), 1);
      assert.match(tightened.drain(), /exceeded the inline context limit/);

      const unlimited = createContextQueue(0, dir);
      unlimited.add("x".repeat(12));
      assert.equal(unlimited.drain(), "x".repeat(12));
      assert.equal(estimateContextTokens("x".repeat(12)), 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
