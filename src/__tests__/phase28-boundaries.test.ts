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

// ponytail: anchored extraction of the AgentEvent union block (from the union
// declaration to the next top-level `export` so unrelated comments cannot trip
// the vocabulary scan).
const unionStart = contractsText.indexOf("export type AgentEvent =");
const unionEnd = contractsText.indexOf("export interface ToolDefinition", unionStart);
const eventUnionBlock = unionStart >= 0 && unionEnd > unionStart ? contractsText.slice(unionStart, unionEnd) : "";

// ponytail: anchored extraction of the Artifact* + AgentLoop* + LoopContext
// contract block (mirrors the Phase 27 boundary anchor).
const loopBlockStart = contractsText.indexOf("// ponytail: AgentLoopStrategy");
const loopBlock = loopBlockStart >= 0 ? contractsText.slice(loopBlockStart) : "";

describe("phase 28 validation/refinement boundaries", () => {
  it("phase28_source_imports_no_synapta_packages", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The
    // artifact events + structured-output contracts must stay generic — no
    // domain vocabulary crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase28_event_and_artifact_contracts_have_no_domain_vocabulary", () => {
    // AgentEvent union + Artifact*/AgentLoop*/LoopContext carry no
    // workflow/node/step terms — the seam is generic over host T with no
    // control-flow domain vocabulary.
    assert.ok(eventUnionBlock.length > 0, "could not locate AgentEvent union block in contracts.ts");
    assert.ok(loopBlock.length > 0, "could not locate loop contract block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(eventUnionBlock), false, `AgentEvent union mentions ${term}`);
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(loopBlock), false, `loop contract block mentions ${term}`);
    }
  });

  it("phase28_public_barrel_re_exports_artifact_events_and_artifact_contracts", () => {
    const indexText = readFileSync("src/index.ts", "utf8");
    // runtime + redaction exports still present
    for (const name of ["singleShotLoop", "generateValidateReviseLoop", "resolveLoop", "isAgentLoopOptions", "redactAgentEvent"]) {
      assert.ok(new RegExp(`\\b${name}\\b`).test(indexText), `src/index.ts does not export ${name}`);
    }
    // contract types re-exported transitively via `export type * from "./contracts.js"`
    assert.ok(/export type \* from "\.\/contracts\.js"/.test(indexText), "src/index.ts does not re-export all contract types");
    // contracts.ts declares each artifact_* event type literal
    for (const type of [
      "artifact_validation_started",
      "artifact_validation_finished",
      "artifact_revision_started",
      "artifact_finished",
      "artifact_failed",
    ]) {
      assert.ok(contractsText.includes(`"${type}"`), `contracts.ts does not declare ${type}`);
    }
    // Artifact* contracts still declared
    for (const type of [
      "ArtifactValidation",
      "ArtifactContext",
      "ArtifactParseResult",
      "ArtifactParser",
      "ArtifactValidator",
      "ArtifactRepairer",
    ]) {
      assert.ok(new RegExp(`\\b${type}\\b`).test(contractsText), `contracts.ts does not declare ${type}`);
    }
  });
});
