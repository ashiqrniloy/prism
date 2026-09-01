import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { JsonObject, ToolResult } from "@arnilo/prism";
import { createExtensionKernel, dispatchToolCall } from "@arnilo/prism";

import { createGraftExtension } from "../extension.js";
import { defineGraftTools } from "../tools.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/graft-package-fixture");

async function loadKernel(mode?: string) {
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([
    createGraftExtension({
      packageRoot: fixtureRoot,
      projectDir: fixtureRoot,
      quietStartup: true,
      ...(mode ? { mode } : {}),
    } as never),
  ]);
  return kernel;
}

function call(kernel: ReturnType<typeof createExtensionKernel>, name: string, args: JsonObject): Promise<ToolResult> {
  return dispatchToolCall({
    call: { type: "tool_call", id: `call_${name}`, name, arguments: args },
    registry: kernel.registries.tools as never,
    context: { sessionId: "s1", runId: "r1", toolCallId: `call_${name}` },
  }) as Promise<ToolResult>;
}

function text(result: ToolResult): string {
  return result.content?.[0]?.type === "text" ? result.content[0].text : "";
}

describe("graft pull tools", () => {
  it("registers_all_six_tools_in_pull_mode_default", async () => {
    const kernel = await loadKernel();
    for (const name of ["graft_ask", "graft_grep", "graft_callers", "graft_skeleton", "graft_map", "graft_blast"]) {
      assert.ok(kernel.registries.tools.get(name), `missing ${name}`);
    }
  });

  it("maps_arguments_to_cli_argv_one_to_one_via_stub_echo", async () => {
    const kernel = await loadKernel();
    const ask = await call(kernel, "graft_ask", {
      query: "where is auth handled?",
      scope: "src/auth",
      count: 5,
      source: true,
    });
    assert.deepEqual(ask.value, { args: ["ask", "where is auth handled?", "--in", "src/auth", "-n", "5", "--source", ".", "--json"] });

    const grep = await call(kernel, "graft_grep", { pattern: "createSessionEntry\\(", ignoreCase: true, fixed: false });
    assert.deepEqual(grep.value, { args: ["grep", "createSessionEntry\\(", "-i", ".", "--json"] });

    const callers = await call(kernel, "graft_callers", { symbol: "createExtensionKernel", direction: "out", depth: 2 });
    assert.deepEqual(callers.value, { args: ["callers", "createExtensionKernel", "--direction", "out", "-d", "2", ".", "--json"] });

    const skeleton = await call(kernel, "graft_skeleton", { path: "src/tools.ts" });
    assert.deepEqual(skeleton.value, { args: ["skeleton", "src/tools.ts", ".", "--json"] });

    const map = await call(kernel, "graft_map", {});
    assert.deepEqual(map.value, { args: ["map", ".", "--json"] });

    const blast = await call(kernel, "graft_blast", { path: "docs/cli.md", base: "main" });
    assert.deepEqual(blast.value, { args: ["blast", "docs/cli.md", "--base", "main", ".", "--json"] });
  });

  it("rejects_unknown_enum_values_without_spawning", async () => {
    const tools = defineGraftTools({
      cli: { kind: "explicit", command: "/nonexistent-should-not-spawn", args: [] },
      projectDir: fixtureRoot,
      timeoutMs: 4000,
      maxResultBytes: 65536,
      childEnv: {},
    });
    const tool = Object.fromEntries(tools.map((definition) => [definition.name, definition]));
    const bad = await tool.graft_callers!.execute(
      { symbol: "x", direction: "sideways" },
      {
        sessionId: "s",
        runId: "r",
        toolCallId: "c1",
      },
    );
    assert.equal(bad.error?.code, "invalid_arguments");
    assert.match(bad.error!.message, /direction must be one of/);
  });

  it("maps_unbuilt_graph_stderr_to_graft_not_built_hint", async () => {
    const kernel = await loadKernel();
    const result = await call(kernel, "graft_skeleton", { path: "src/__UNBUILT__.ts" });
    assert.equal(result.error?.code, "graft_not_built");
    assert.match(text(result), /\/graft build/);
    assert.equal(result.metadata?.source, "graft-graph");
  });

  it("metadata_reports_command_latency_and_readonly_effect", async () => {
    const kernel = await loadKernel();
    const result = await call(kernel, "graft_map", {});
    const graftMeta = result.metadata?.graft as { command: string; ms: number };
    assert.equal(graftMeta.command, "map");
    assert.ok(Number.isFinite(graftMeta.ms) && graftMeta.ms >= 0);
    assert.equal(result.metadata?.source, "graft-graph");
    assert.deepEqual(kernel.registries.tools.get("graft_map")!.effect, { kind: "none", idempotency: "none" });
  });

  it("push_only_mode_registers_no_pull_tools", async () => {
    const kernel = await loadKernel("push");
    assert.equal(kernel.registries.tools.list().length, 0);
  });
});
