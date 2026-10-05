import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import * as root from "../index.js";
import * as testing from "../testing/index.js";

/**
 * Phase 3 freeze (plan 149 Task 6, roadmap Phase 3 Done). Everything a host or a package author needs is
 * a root export of `@arnilo/prism`, and the member names of the host-facing types are pinned so Phase 4
 * builds on a surface that cannot move silently. A failure names `docs/next/agent.md` ("Frozen for Phase 4"):
 * change that page and this list together, deliberately.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOC = "docs/next/agent.md (Frozen for Phase 4)";

/** Type names a host or package author imports from the root (roadmap §2.3, §2.5, §2.6). */
const ROOT_TYPES = [
  // §2.3 host API. `UiRequest` / `UiResponse` of the roadmap are the shipped `HostUiRequest` / `HostUiResponse`.
  "AgentConfig",
  "Agent",
  "AgentInspection",
  "Session",
  "SessionOptions",
  "RunOptions",
  "RunResult",
  "Decision",
  "PendingDecision",
  "HostPort",
  "HostUi",
  "HostUiRequest",
  "HostUiResponse",
  "AgentEvent",
  "Principal",
  "RunLimits",
  "ToolInfo",
  "SkillInfo",
  "SessionIndex",
  "ModelIndex",
  // §2.5 loop primitives
  "LoopStrategy",
  "RunController",
  // §2.6 package authoring
  "PackageAPI",
  "SessionContext",
  "ToolDefinition",
  "Skill",
  "CommandDefinition",
] as const;

const ROOT_VALUES = ["createAgent", "definePackage"] as const;
const TESTING_VALUES = ["createMockProvider", "mockProvider", "packageConformance", "loopConformance", "createScriptedHostUi"] as const;

/** Member names pinned for the Phase 4 build. A new or renamed member is a deliberate edit here and in the doc. */
const FROZEN_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  Agent: ["id", "config", "commands", "tools", "skills", "sessions", "models", "session", "subscribe", "dispose", "inspect"],
  AgentInspection: ["packages", "tools", "skills", "commands", "hooks", "slots", "store", "disabled", "statusNotes"],
  Session: [
    "id",
    "guardrailPackRefs",
    "leafId",
    "run",
    "steer",
    "stream",
    "compact",
    "subscribe",
    "close",
    "abort",
    "resume",
    "messages",
    "entries",
    "checkout",
    "contextMeter",
    "fork",
    "getLoadedSkillNames",
    "restoreLoadedSkills",
  ],
  RunOptions: [
    "signal",
    "model",
    "limits",
    "providerOptions",
    "thinkingLevel",
    "systemPrompt",
    "compaction",
    "retry",
    "metadata",
    "interactive",
    "redactor",
    "runLedger",
    "effectStore",
    "ownership",
    "principal",
    "idempotencyKey",
    "validate",
    "tools",
    "toolsDisclosure",
    "allowHiddenToolCalls",
    "toolsSearch",
    "toolResultFold",
    "attentionCompiler",
    "inputLayout",
    "runState",
    "promptVersion",
  ],
  RunResult: [
    "sessionId",
    "runId",
    "status",
    "leafId",
    "text",
    "content",
    "message",
    "messages",
    "usage",
    "limit",
    "attribution",
    "error",
    "abortReason",
    "stopReason",
    "stopDetail",
    "pending",
    "runState",
  ],
  HostUi: ["request"],
  HostPort: ["ui", "log"],
};

const union = (names: readonly string[]) => names.map((name) => JSON.stringify(name)).join(" | ");

/** Compile a generated probe against the root's declarations; the diagnostics are the answer. */
function probe(source: string): string {
  const dir = mkdtempSync(join(repoRoot, "node_modules", ".prism-freeze-"));
  try {
    writeFileSync(join(dir, "probe.ts"), source);
    const result = spawnSync(
      join(repoRoot, "node_modules", ".bin", "tsc"),
      [
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--types",
        "node",
        "--typeRoots",
        join(repoRoot, "node_modules", "@types"),
        "--target",
        "es2022",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        join(dir, "probe.ts"),
      ],
      { encoding: "utf8", cwd: repoRoot },
    );
    return `${result.stdout}${result.stderr}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("agent surface freeze (Phase 3)", () => {
  it("host_and_package_author_types_import_from_root", () => {
    const rootPath = join(repoRoot, "src", "index.js").replaceAll("\\", "/");
    const output = probe(
      `import type { ${ROOT_TYPES.join(", ")} } from ${JSON.stringify(rootPath)};\nexport type All = [${ROOT_TYPES.join(", ")}];\n`,
    );
    const missing = [...output.matchAll(/has no exported member '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(missing, [], `@arnilo/prism must export these types from its root; see ${DOC}`);
    assert.equal(output.trim(), "", `the root type probe must compile cleanly; see ${DOC}\n${output}`);
    for (const name of ROOT_VALUES) {
      assert.equal(typeof (root as Record<string, unknown>)[name], "function", `@arnilo/prism must export ${name}; see ${DOC}`);
    }
    for (const name of TESTING_VALUES) {
      assert.equal(typeof (testing as Record<string, unknown>)[name], "function", `@arnilo/prism/testing must export ${name}; see ${DOC}`);
    }
  });

  it("agent_surface_is_frozen_for_phase_4", () => {
    const rootPath = join(repoRoot, "src", "index.js").replaceAll("\\", "/");
    const names = Object.keys(FROZEN_MEMBERS);
    const lines = [
      `import type { ${names.join(", ")} } from ${JSON.stringify(rootPath)};`,
      "type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;",
      ...names.map((name) => `export const ${name}Members: Exactly<keyof ${name}, ${union(FROZEN_MEMBERS[name]!)}> = true;`),
    ];
    const output = probe(`${lines.join("\n")}\n`);
    const drifted = [...output.matchAll(/probe\.ts\(\d+,\d+\): error TS2322: Type 'true' is not assignable to type 'false'/g)];
    assert.equal(
      drifted.length,
      0,
      `a frozen member list drifted (${drifted.length} type(s)); update ${DOC} and FROZEN_MEMBERS together\n${output}`,
    );
    assert.equal(output.trim(), "", `the member probe must compile cleanly; see ${DOC}\n${output}`);
  });

  it("no_test_seam_is_a_root_export", () => {
    for (const seam of ["createAgentWith", "CreateAgentInternals", "agentRuntime", "registerAgentRuntime", "tryAgentRuntime"]) {
      assert.equal(seam in root, false, `${seam} is a test seam and must stay off the @arnilo/prism root; see ${DOC}`);
    }
  });
});
