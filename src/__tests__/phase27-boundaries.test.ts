import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

const srcText = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"))
  .map((path) => readFileSync(path, "utf8")).join("\n");

const contractsText = readFileSync("src/contracts.ts", "utf8");

// Extract the Artifact* + AgentLoop* + LoopContext contract block from contracts.ts
// (from the first loop-related export to the end of the artifact section).
const loopBlockStart = contractsText.indexOf("// ponytail: AgentLoopStrategy");
const loopBlock = loopBlockStart >= 0 ? contractsText.slice(loopBlockStart) : "";

describe("phase 27 agent loop strategy boundaries", () => {
  it("phase27_source_imports_no_synapta_packages", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The
    // loop seam + Artifact* contracts must stay generic — no domain vocabulary
    // crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase27_loop_and_artifact_contracts_have_no_domain_vocabulary", () => {
    // Artifact*/AgentLoop*/LoopContext carry no workflow/node/step terms —
    // the seam is generic over host T with no control-flow domain vocabulary.
    assert.ok(loopBlock.length > 0, "could not locate loop contract block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(loopBlock), false, `loop contract block mentions ${term}`);
    }
  });

  it("phase27_public_barrel_exports_loops_and_artifact_contracts", () => {
    const indexText = readFileSync("src/index.ts", "utf8");
    // loop runtime functions/objects exported
    for (const name of ["singleShotLoop", "generateValidateReviseLoop", "resolveLoop", "isAgentLoopOptions"]) {
      assert.ok(new RegExp(`\\b${name}\\b`).test(indexText), `src/index.ts does not export ${name}`);
    }
    // Artifact* + loop contract types exported via `export type * from "./contracts.js"`
    assert.ok(/export type \* from "\.\/contracts\.js"/.test(indexText), "src/index.ts does not re-export all contract types");
    for (const type of [
      "ArtifactValidation",
      "ArtifactContext",
      "ArtifactParseResult",
      "ArtifactParser",
      "ArtifactValidator",
      "ArtifactRepairer",
      "AgentLoopStrategy",
      "AgentLoopOptions",
      "LoopContext",
      "ProviderTurnResult",
    ]) {
      assert.ok(new RegExp(`\\b${type}\\b`).test(contractsText), `contracts.ts does not declare ${type}`);
    }
  });
});
