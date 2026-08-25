import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { MiddlewareNext, ToolResult } from "@arnilo/prism";
import { createExtensionKernel } from "@arnilo/prism";

import {
  createEditWatchMiddleware,
  DEFAULT_EDIT_TOOL_NAMES,
  editedPathFrom,
  repoRelative,
  summarizeBlast,
  underGraft,
} from "../edit-watch.js";

const projectDir = "/tmp/fake-repo";
const passthrough: MiddlewareNext<ToolResult> = async (value) => value;
void passthrough;

function editResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolCallId: "t1",
    name: "edit",
    content: [{ type: "text", text: "ok" }],
    metadata: { path: "/tmp/fake-repo/src/kernel.ts" },
    ...overrides,
  };
}

describe("edited path extraction (pure)", () => {
  it("matches_only_edit_tool_names", () => {
    assert.equal(editedPathFrom(editResult({ name: "read" })), undefined);
    for (const name of DEFAULT_EDIT_TOOL_NAMES) {
      assert.ok(editedPathFrom(editResult({ name, metadata: { path: "/repo/a.ts" } }), [...DEFAULT_EDIT_TOOL_NAMES]));
    }
    assert.equal(editedPathFrom(editResult({ name: "shell" })), undefined);
  });

  it("tolerates_host_metadata_shapes", () => {
    assert.equal(editedPathFrom(editResult()), "/tmp/fake-repo/src/kernel.ts"); // canonical metadata.path
    assert.equal(editedPathFrom(editResult({ metadata: { filePath: "/repo/b.ts" } })), "/repo/b.ts");
    assert.equal(editedPathFrom(editResult({ metadata: { file_path: "/repo/c.ts" } })), "/repo/c.ts");
    // graft's editedFilePath dual-shape lesson: nested object
    assert.equal(editedPathFrom(editResult({ metadata: { path: { path: "/repo/d.ts" } } })), "/repo/d.ts");
    assert.equal(editedPathFrom(editResult({ metadata: {} })), undefined);
    assert.equal(editedPathFrom(editResult({ metadata: undefined })), undefined);
  });
});

describe("graft/ filter + relativization (pure)", () => {
  it("ignores_paths_under_graft_dir", () => {
    assert.equal(underGraft(projectDir, "/tmp/fake-repo/graft/wiring.json"), true);
    assert.equal(underGraft(projectDir, "graft/INDEX.md"), true);
    assert.equal(underGraft(projectDir, "/tmp/fake-repo/src/kernel.ts"), false);
    assert.equal(underGraft(projectDir, "/tmp/fake-repo/grafter/x.ts"), false); // not the graft dir itself
  });

  it("relativizes_against_project_dir", () => {
    assert.equal(repoRelative(projectDir, "/tmp/fake-repo/src/a.ts"), "src/a.ts");
    assert.equal(repoRelative(projectDir, "src/b.ts"), "src/b.ts");
  });
});

describe("blast summary (pure)", () => {
  it("reads_tolerant_payload_keys_and_samples_bounded", () => {
    const summary = summarizeBlast({
      dependents: Array.from({ length: 9 }, (_, index) => ({ title: `c${index}` })),
    })!;
    assert.equal(summary.dependents, 9);
    assert.equal(summary.sample.length, 6); // bounded sample
    assert.deepEqual(summarizeBlast(null), undefined);
    assert.deepEqual(summarizeBlast({ unrelated: 1 }), undefined);
  });
});

describe("edit-watch middleware", () => {
  it("augments_metadata_with_dependents_on_edit_results", async () => {
    const seen: Array<{ path: string; stale?: number }> = [];
    const mw = createEditWatchMiddleware(
      {
        runBlast: async () => ({ dependents: [{ title: "a.ts" }, { title: "b.ts" }] }),
        onDirty: (path, stale) => void seen.push({ path, stale }),
      },
      { projectDir },
    );
    const out = await mw(editResult(), passthrough);
    assert.deepEqual((out.metadata as Record<string, unknown>).graftBlast, {
      path: "src/kernel.ts",
      dependents: 2,
      sample: ["a.ts", "b.ts"],
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.stale, 2);
  });

  it("no_graph_passes_result_untouched_but_marks_dirty", async () => {
    let dirty = 0;
    const mw = createEditWatchMiddleware({ runBlast: async () => null, onDirty: () => void (dirty += 1) }, { projectDir });
    const original = editResult();
    const out = await mw(original, passthrough);
    assert.equal(out, original); // same reference — untouched
    assert.equal(dirty, 1);
  });

  it("failing_lookup_degrades_silently_to_next", async () => {
    const mw = createEditWatchMiddleware(
      {
        runBlast: async () => {
          throw new Error("boom");
        },
        onDirty: () => {},
      },
      { projectDir },
    );
    const out = await mw(editResult(), passthrough);
    assert.equal((out.metadata as Record<string, unknown>).graftBlast, undefined);
  });

  it("skips_non_edit_tools_and_graft_paths_without_lookup", async () => {
    let lookups = 0;
    const mw = createEditWatchMiddleware(
      {
        runBlast: async () => {
          lookups += 1;
          return null;
        },
        onDirty: () => {},
      },
      { projectDir },
    );
    await mw(editResult({ name: "read" }), passthrough);
    await mw(editResult({ metadata: { path: "/tmp/fake-repo/graft/workspace.json" } }), passthrough);
    assert.equal(lookups, 0);
  });
});

describe("push-mode kernel wiring", () => {
  it("registered_tool_result_middleware_augments_edit_results_via_stub_cli", async () => {
    const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/graft-package-fixture");
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      (await import("../extension.js")).createGraftExtension({
        packageRoot: fixtureRoot,
        projectDir: fixtureRoot,
        mode: "push",
        quietStartup: true,
        appendEntry: async () => {},
        getEntries: () => [],
      }),
    ]);

    const edited: ToolResult = {
      toolCallId: "t9",
      name: "write",
      content: [{ type: "text", text: "wrote file" }],
      metadata: { path: resolve(fixtureRoot, "src/new-file.ts"), sessionId: "s1" },
    };
    const after = await kernel.middleware.run("tool_result", edited);
    assert.deepEqual(((after as ToolResult).metadata as Record<string, unknown>).graftBlast, {
      path: "src/new-file.ts",
      dependents: 2,
      sample: ["consumer-a.ts", "consumer-b.ts"],
    });
  });

  it("pull_mode_registers_no_tool_result_middleware", async () => {
    const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/graft-package-fixture");
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      (await import("../extension.js")).createGraftExtension({
        packageRoot: fixtureRoot,
        projectDir: fixtureRoot,
        quietStartup: true,
        appendEntry: async () => {},
        getEntries: () => [],
      }),
    ]);
    const edited: ToolResult = {
      toolCallId: "t9",
      name: "edit",
      content: [{ type: "text", text: "ok" }],
      metadata: { path: resolve(fixtureRoot, "src/x.ts") },
    };
    const after = await kernel.middleware.run("tool_result", edited);
    assert.equal((after as ToolResult).metadata?.graftBlast, undefined);
  });
});
