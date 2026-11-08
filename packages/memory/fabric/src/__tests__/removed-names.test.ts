/**
 * Plan 210 Task 7: the fabric features the memory audit removed are gone repo-wide. 0.13.0 is unpublished, so a removed
 * name is deleted, not aliased. Source, packages, apps, scripts, examples and docs are scanned; the evidence, history,
 * plans, changelogs and migration pages (which must name what they removed) are not. `scripts/memory-bench` is the frozen
 * measurement harness: its ablation arms patch the pre-removal product and run only against that commit.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SCAN = ["src", "packages", "apps", "scripts", "examples", "docs", "README.md", "PRODUCT.md"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "history", "_evidence", "graft", "coverage", "memory-bench"]);
// `budgets.json` rows keep the history of why a budget moved; they name features that existed then.
const SKIP_FILES = /(^|\/)(CHANGELOG\.md|migrate-to-[0-9.]+\.md|api\.json|examples\.json|budgets\.json)$/;
const RETIRED: readonly [string, RegExp][] = [
  [
    "scoped policy layer",
    /createScopedMemoryPolicy|runScopedMemoryEval|ScopedMemory(Policy|Review|RecallResult|ApprovalMode)|MemoryFabricScopedConfig|runScopedGcPass|loadScopedLedger|scoped: \{ scopeRoot|\bscopeRoot\b/,
  ],
  [
    "hybrid retrieval",
    /memoryFabric\([^)]*retrieval: "hybrid"|retrieval hybrid|`limits\.maxVectorDimensions`|"hybrid" adds the embedding|`retrieval: "hybrid"`/,
  ],
  [
    "linker and evolution workers",
    /`linker`|linker: (false|\{|true)|`evolution`|evolution: (false|\{|true)|MemoryFabric(Linker|Evolution)Options|runFabricEvolutionWorker|resolveNoteLinks|DEFAULT_LINKER_TOP_K|linker\/evolution/,
  ],
  ["model decider", /consolidate\.decider|decider: "model"|onDeciderFailure|decide_memory|decideConsolidation|optional decider/],
  [
    "decision points P1, P2 and P6",
    /points: \[[^\]]*"P[126]"|\bP[126] (durable|supersession|applies)|SupersessionChoice|AppliesInput|SupersessionCandidate|\bP1, P3, P4 and P7/,
  ],
  [
    "state wrapper",
    /MemoryFabricStateConfig|ResolvedStateConfig|resolveStateConfig|buildStateTable|StateMem|`state\.model`|Current state \(model-generated/,
  ],
  [
    "widening and narrowing",
    /lifecycle\.widen|widenToAgent|widenPaths|narrowContradicted|crossProjectGroups|siblingGroups|narrowingCandidates|\bwidenedTo\b|ResolvedWidenConfig|MemoryFabricScopeOpenInput|\bopenScope\b|agent_scope_requires_widening|DEFAULT_WIDEN_CONFIG|contradictionsToSupersede|widening-only/,
  ],
  ["similar links", /relation: "similar"|`similar` link|similar link/],
  ["supersession hint modes", /supersessionHint|SupersessionHintMode|keyed-only/],
  [
    "exchange keyword enrichment and timeline",
    /enriched deterministically|keyword enrichment|write-time enrichment|resolveDates|from "\.\.\/dates\.js"/,
  ],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (/\.(ts|mjs|md|json|sh)$/.test(name) && stat.size < 2_000_000) yield path;
  }
}

function* files(): Generator<string> {
  for (const top of SCAN) {
    const path = join(ROOT, top);
    try {
      if (statSync(path).isDirectory()) yield* walk(path);
      else yield path;
    } catch {
      // A scan root that does not exist (for example no `apps/` in a trimmed checkout) has nothing to find.
    }
  }
}

describe("removed memory features (plan 210 Task 7)", () => {
  it("removed_memory_names_absent_repo_wide", () => {
    const hits: string[] = [];
    for (const path of files()) {
      const rel = relative(ROOT, path).split("\\").join("/");
      // The two tests that name removed fields on purpose: this scan, and the one proving they fail closed.
      if (SKIP_FILES.test(rel) || /removed-(names|config)\.test\.ts$/.test(rel)) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const [label, pattern] of RETIRED)
          if (pattern.test(line)) hits.push(`${rel}:${index + 1} [${label}] ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(hits, [], `removed names still present:\n${hits.join("\n")}`);
  });
});
