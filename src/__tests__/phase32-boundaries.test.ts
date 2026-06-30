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

const srcFiles = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"));
const srcText = srcFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const contractsText = readFileSync("src/contracts.ts", "utf8");
const toolsText = readFileSync("src/tools.ts", "utf8");
const exampleText = readFileSync("examples/synapta-style-artifact-loop.ts", "utf8");

// ponytail: anchored extraction of the Artifact* contract block and the loop-strategy
// block so vocabulary scans are limited to the boundary seam and cannot trip on
// unrelated text (e.g. the word "step" in a comment elsewhere in contracts.ts).
const artifactBlockStart = contractsText.indexOf("export interface ArtifactValidation");
const artifactBlockEnd = contractsText.indexOf("export ", artifactBlockStart + 1);
const artifactBlock =
  artifactBlockStart >= 0 && artifactBlockEnd > artifactBlockStart
    ? contractsText.slice(artifactBlockStart, artifactBlockEnd)
    : contractsText.slice(artifactBlockStart);

const loopBlockStart = contractsText.indexOf("export interface AgentLoopStrategy");
const loopBlockEnd = contractsText.indexOf("export interface ArtifactValidation", loopBlockStart + 1);
const loopBlock =
  loopBlockStart >= 0 && loopBlockEnd > loopBlockStart
    ? contractsText.slice(loopBlockStart, loopBlockEnd)
    : contractsText.slice(loopBlockStart);

const artifactValidatorDecl =
  /export type ArtifactValidator<T> = \([\s\S]*?;/ .exec(contractsText)?.[0] ?? "";
const toolValidatorDecl = /export type ToolValidator = \([\s\S]*?;/ .exec(toolsText)?.[0] ?? "";

describe("phase 32 synapta-facing integration boundaries", () => {
  it("phase32_source_imports_no_synapta_packages_or_mentions", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The artifact
    // loop seam stays generic — no domain vocabulary or package imports cross the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase32_artifact_contracts_have_no_domain_vocabulary", () => {
    // ArtifactValidation/Context/ParseResult/Parser/Validator/Repairer field names are
    // generic (ok/errors/metadata/value/path/message/text/turn/sessionId/runId/signal)
    // — no workflow/node/step Synapta-domain terms leak into the seam.
    assert.ok(artifactBlock.length > 0, "could not locate Artifact* contract block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(artifactBlock), false, `artifact contract mentions ${term}`);
    }
  });

  it("phase32_validators_are_host_shaped_and_not_domain_narrowed", () => {
    // ArtifactValidator is generic over the host-defined T and takes (value, ctx).
    assert.ok(artifactValidatorDecl.length > 0, "could not locate ArtifactValidator declaration");
    assert.ok(/<T>/.test(artifactValidatorDecl), "ArtifactValidator is not generic over T");
    assert.ok(/value:\s*T\b/.test(artifactValidatorDecl), "ArtifactValidator does not take value: T");
    assert.ok(/ctx:\s*ArtifactContext/.test(artifactValidatorDecl), "ArtifactValidator does not take ctx: ArtifactContext");
    assert.ok(/ArtifactValidation\s*\|?\s*Promise<ArtifactValidation>/.test(artifactValidatorDecl), "ArtifactValidator does not return ArtifactValidation");

    // ToolValidator is declared in src/tools.ts and uses only core Prism types
    // (ToolDefinition, JsonObject, ToolExecutionContext) — never workflow/node/step.
    assert.ok(toolValidatorDecl.length > 0, "could not locate ToolValidator declaration");
    assert.ok(/tool:\s*ToolDefinition/.test(toolValidatorDecl), "ToolValidator does not take tool: ToolDefinition");
    assert.ok(/args:\s*JsonObject/.test(toolValidatorDecl), "ToolValidator does not take args: JsonObject");
    assert.ok(/context:\s*ToolExecutionContext/.test(toolValidatorDecl), "ToolValidator does not take context: ToolExecutionContext");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(toolValidatorDecl), false, `ToolValidator mentions ${term}`);
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(artifactValidatorDecl), false, `ArtifactValidator mentions ${term}`);
    }
  });

  it("phase32_loop_options_and_strategy_have_no_domain_vocabulary", () => {
    // AgentLoopStrategy/AgentLoopOptions only know generic loop strategy names
    // (single-shot, generate-validate-revise) and ArtifactValidator/ArtifactParser/
    // ArtifactRepairer callbacks — no workflow/node/step vocabulary.
    assert.ok(loopBlock.length > 0, "could not locate AgentLoop* block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(loopBlock), false, `loop contract mentions ${term}`);
    }
  });

  it("phase32_example_imports_no_synapta_package", () => {
    // Belt-and-braces: the Synapta-facing integration example lives entirely in
    // host-owned code and Prism public exports.
    assert.equal(/from ["']synapta/.test(exampleText), false, "example imports a synapta* package");
  });
});
