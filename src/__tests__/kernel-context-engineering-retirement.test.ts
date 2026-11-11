/** Plan 158 Task 8: the kernel context-engineering modules, fields, and exports are gone, and a
 *  durable run state written before the removal still restores.
 *
 *  Three legs: (1) a type-level freeze of `AgentConfig`/`RunOptions` against the five removed
 *  fields, (2) a source scan proving no kernel module or root export names a stage, and (3) the
 *  forward-compatibility leg — a 0.12 checkpoint carrying the attention frontier, fold ledger, and
 *  activated-tool names resumes with those keys ignored rather than failing the load. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig, RunOptions, StoredAgentRunState } from "../index.js";
import { AGENT_RUN_STATE_SCHEMA_VERSION, createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "../index.js";
import { parseAgentRunState } from "../agent-run-state.js";
import { restoreRunSessionState } from "../agent-run-restore.js";
import { providerPackage } from "../provider-kit/index.js";

const repoRoot = join(import.meta.dirname, "..", "..");

/** Compile-time freeze: a removed field must not be assignable, so a re-added one fails here. */
function assertNoRemovedFields(): void {
  const config: AgentConfig = { model: { provider: "mock", model: "demo" } };
  const run: RunOptions = {};
  // @ts-expect-error contextBudget moved to @arnilo/prism-extensions/context-engineering
  const withBudget: AgentConfig = { ...config, contextBudget: { maxInputTokens: 1 } };
  // @ts-expect-error toolResultFold moved to @arnilo/prism-extensions/context-engineering
  const withFold: AgentConfig = { ...config, toolResultFold: { minBytes: 1 } };
  // @ts-expect-error toolsDisclosure moved to @arnilo/prism-extensions/context-engineering
  const withDisclosure: AgentConfig = { ...config, toolsDisclosure: "search" };
  // @ts-expect-error toolsSearch moved to @arnilo/prism-extensions/context-engineering
  const withSearch: AgentConfig = { ...config, toolsSearch: { topK: 2 } };
  // @ts-expect-error attentionCompiler moved to @arnilo/prism-extensions/context-engineering
  const withAttention: AgentConfig = { ...config, attentionCompiler: true };
  // @ts-expect-error the run overlay went with the agent field
  const withRunOverlay: RunOptions = { attentionCompiler: { triggerRatio: 0.5 } };
  // @ts-expect-error the run overlay went with the agent field
  const withRunFold: RunOptions = { toolResultFold: { minBytes: 1 } };
  assert.ok(withBudget && withFold && withDisclosure && withSearch && withAttention && withRunOverlay && withRunFold && run);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("kernel context-engineering retirement (plan 158 Task 8)", () => {
  it("kernel_has_no_context_engineering_fields", () => {
    assertNoRemovedFields();
  });

  it("kernel_modules_and_exports_are_gone", () => {
    for (const file of [
      "src/attention-compiler.ts",
      "src/context-budget.ts",
      "src/tool-result-fold.ts",
      "src/tool-search.ts",
      "src/contracts-core/attention.ts",
    ]) {
      assert.equal(existsSync(join(repoRoot, file)), false, `${file} must be deleted, not shimmed`);
    }
    // The residue keeps its own home and names no stage.
    assert.equal(existsSync(join(repoRoot, "src/models/estimate.ts")), true);
    // No kernel module imports a deleted one, and the root barrel re-exports none of them.
    const offenders: string[] = [];
    for (const file of tsFiles(join(repoRoot, "src"))) {
      if (file.includes("__tests__")) continue;
      const text = readFileSync(file, "utf8");
      for (const name of [
        "attention-compiler.js",
        "context-budget.js",
        "tool-result-fold.js",
        "tool-search.js",
        "contracts-core/attention.js",
      ]) {
        if (
          text.includes(`from "${name.startsWith("contracts-core") ? "./" : ""}${name}"`) ||
          text.includes(`from "./${name}"`) ||
          text.includes(`from "../${name}"`)
        ) {
          offenders.push(`${file}: ${name}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `kernel source still imports a retired module:\n${offenders.join("\n")}`);
  });

  it("run_state_with_attention_ledger_restores", async () => {
    const provider = providerPackage("retired-state-provider", [
      {
        id: "mock",
        async *generate() {
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
    ]);
    const agent = await createAgent({
      id: "retired-attention-state",
      slots: { store: createMemorySessionStore() },
      model: { provider: "mock", model: "demo" },
      packages: [provider],
    });
    const session = await agent.session({ id: "retired-attention-session", create: true });

    // A 0.12 run state carried the attention frontier and fold ledger the kernel used to own, plus
    // the activated-tool names. None of the three is validated any more, so a malformed body cannot
    // fail the parse or the restore.
    const legacy = {
      schemaVersion: AGENT_RUN_STATE_SCHEMA_VERSION,
      agentId: "retired-attention-state",
      definitionRevision: "1",
      fingerprint: "fingerprint",
      runId: "run-legacy",
      sessionId: "retired-attention-session",
      model: { provider: "mock", model: "demo" },
      status: "suspended",
      counters: { turns: 1, providerAttempts: 1, toolRounds: 0, toolCalls: 0 },
      sessionState: {
        activatedToolNames: ["lookup"],
        attentionSticky: { schemaVersion: 1, thinking: ["not-a-hash"], toolCallIds: [""] },
        attentionFold: { schemaVersion: 1, bodies: [{ id: "", body: "" }] },
      },
    } as unknown as StoredAgentRunState;

    const parsed = parseAgentRunState(legacy);
    restoreRunSessionState(session as unknown as Parameters<typeof restoreRunSessionState>[0], parsed, {
      persistSessionState: true,
    });
    const result = await session.run("go");
    assert.equal(result.status, "completed", "the legacy keys are ignored, never a failed restore");
  });
});
