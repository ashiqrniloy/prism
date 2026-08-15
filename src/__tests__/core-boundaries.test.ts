import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Architectural boundary invariants for the core package. These are deliberate
// forbidden-string / contract-shape scans: they assert absences and seam shapes
// that cannot be expressed as ordinary behavior tests. Consolidated from the
// former phaseNN-boundaries tests (plan 079, Task 5); redundant export-presence
// and docs-link assertions were dropped (covered by public-export-contract.test.ts
// and docs.test.ts).

function sourceFiles(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path, predicate) : predicate(path) ? [path] : [];
  });
}

// Core runtime source excludes the openai-compatible shim (a sanctioned provider seam).
const runtimeFiles = sourceFiles(
  "src",
  (path) => path.endsWith(".ts") && !path.includes("src/__tests__") && !path.includes("src/providers/openai-compatible"),
);
const runtimeText = runtimeFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const runtimeTextLower = runtimeText.toLowerCase();

const allSrcFiles = sourceFiles("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"));
const allSrcText = allSrcFiles.map((path) => readFileSync(path, "utf8")).join("\n");

// Contracts split at 0.1.4 into contracts-core / contracts-run-state / contracts-protocol
// behind the contracts.ts barrel; 0.2.5 plan 025 Task 1 split contracts-core into
// src/contracts-core/*.ts. Boundary scans read the union of the split modules
// (the barrels themselves carry no declarations) — layout-agnostic via the tree.
const contractsText = [...sourceFiles("src/contracts-core", () => true), "src/contracts-run-state.ts", "src/contracts-protocol.ts"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const toolsText = readFileSync("src/tools.ts", "utf8");

const DOMAIN_TERMS = ["workflow", "node", "step"];
const PROVIDER_LITERALS = ["openrouter", "anthropic", "zai", "kimi", "opencode", "openai-codex", "chatgpt", "moonshot"];

function anchoredBlock(startMarker: string, endMarker?: string): string {
  const start = contractsText.indexOf(startMarker);
  if (start < 0) return "";
  if (!endMarker) return contractsText.slice(start);
  const end = contractsText.indexOf(endMarker, start + 1);
  return end > start ? contractsText.slice(start, end) : contractsText.slice(start);
}

function assertNoDomainVocabulary(block: string, label: string): void {
  assert.ok(block.length > 0, `could not locate ${label} in contracts.ts`);
  for (const term of DOMAIN_TERMS) {
    assert.equal(new RegExp(`\\b${term}\\b`, "i").test(block), false, `${label} mentions ${term}`);
  }
}

describe("core source boundaries", () => {
  it("core runtime has no provider-specific literals", () => {
    for (const forbidden of PROVIDER_LITERALS) {
      assert.equal(runtimeTextLower.includes(forbidden), false, `core runtime source contains provider-specific literal ${forbidden}`);
    }
  });

  it("source imports and mentions no consuming-app packages", () => {
    // Synapta is a consuming app, never a Prism dependency; no domain vocabulary
    // crosses the boundary into any seam.
    assert.equal(/from ["']synapta/.test(allSrcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(allSrcText), false, "src/ mentions synapta");
  });

  it("core has no runtime dependencies and no first-party provider dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    for (const name of Object.keys(deps)) {
      assert.equal(name.startsWith("@arnilo/prism-provider-"), false, `core depends on first-party provider package: ${name}`);
    }
    assert.equal(Object.keys(deps).length, 0, "core has runtime dependencies (expected none)");
  });

  it("source does not import first-party provider packages", () => {
    assert.equal(/from ["']@arnilo\/prism-provider-/.test(allSrcText), false, "src/ imports a first-party provider package");
  });

  it("core does not default to optional observational memory", () => {
    assert.equal(allSrcText.includes("@arnilo/prism-compaction-observational-memory"), false);
    assert.equal(allSrcText.includes("createObservationalMemoryCompactionStrategy"), false);
    assert.equal(allSrcText.includes("observational-memory"), false);
  });

  it("prompt cache kinds are generic, not provider literals", () => {
    const kinds = ["implicit", "openai_key", "cache_control", "provider_specific", "none"];
    for (const provider of ["openai", "openrouter", "anthropic", "opencode", "zai", "kimi"]) {
      assert.equal(kinds.includes(provider), false, `cache kind is provider literal ${provider}`);
    }
  });
});

describe("core contract seams stay domain-agnostic", () => {
  it("provider resolver contract has no domain vocabulary", () => {
    const providersText = readFileSync("src/providers.ts", "utf8");
    const resolverText = [
      ...providersText.matchAll(/export[\s\S]*?(?:ProviderResolver|createProviderResolver)[\s\S]*?(?:\nexport|\n}\n|$)/g),
      ...contractsText.matchAll(/ProviderResolver[\s\S]*?(?:\nexport|\n;|\n})/g),
    ]
      .map((m) => m[0])
      .join("\n");
    for (const term of DOMAIN_TERMS) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(resolverText), false, `resolver contract mentions ${term}`);
    }
    assert.equal(/\bworkflow\b/i.test(providersText), false, "src/providers.ts mentions workflow");
    assert.equal(/\bworkflow\b/i.test(contractsText), false, "src/contracts.ts mentions workflow");
  });

  it("agent loop and artifact contracts have no domain vocabulary", () => {
    assertNoDomainVocabulary(anchoredBlock("// ponytail: AgentLoopStrategy"), "loop contract block");
    assertNoDomainVocabulary(anchoredBlock("export interface ArtifactValidation", "export "), "artifact contract block");
    assertNoDomainVocabulary(
      anchoredBlock("export interface AgentLoopStrategy", "export interface ArtifactValidation"),
      "AgentLoop* block",
    );
  });

  it("AgentEvent union has no domain vocabulary", () => {
    assertNoDomainVocabulary(anchoredBlock("export type AgentEvent =", "export interface ToolDefinition"), "AgentEvent union block");
  });

  it("instruction injector contract has no domain vocabulary", () => {
    assertNoDomainVocabulary(anchoredBlock("export type InstructionTiming", "export "), "injector contract block");
  });

  it("system-prompt contract has no domain vocabulary", () => {
    const spBlockStart = contractsText.indexOf("export type SystemPromptMode");
    const spConfigStart = contractsText.indexOf("export type SystemPromptConfig", spBlockStart);
    const block =
      spConfigStart >= 0
        ? contractsText.slice(spBlockStart, contractsText.indexOf("export ", spConfigStart + 1))
        : contractsText.slice(spBlockStart, contractsText.indexOf("export ", spBlockStart + 1));
    assertNoDomainVocabulary(block, "system-prompt contract block");
  });

  it("validators are host-shaped and not domain-narrowed", () => {
    const artifactValidatorDecl = /export type ArtifactValidator<T> = \([\s\S]*?;/.exec(contractsText)?.[0] ?? "";
    const toolValidatorDecl = /export type ToolValidator = \([\s\S]*?;/.exec(toolsText)?.[0] ?? "";
    assert.ok(artifactValidatorDecl.length > 0, "could not locate ArtifactValidator declaration");
    assert.ok(/<T>/.test(artifactValidatorDecl), "ArtifactValidator is not generic over T");
    assert.ok(/value:\s*T\b/.test(artifactValidatorDecl), "ArtifactValidator does not take value: T");
    assert.ok(/ctx:\s*ArtifactContext/.test(artifactValidatorDecl), "ArtifactValidator does not take ctx: ArtifactContext");
    assert.ok(toolValidatorDecl.length > 0, "could not locate ToolValidator declaration");
    assert.ok(/tool:\s*ToolDefinition/.test(toolValidatorDecl), "ToolValidator does not take tool: ToolDefinition");
    assert.ok(/args:\s*JsonObject/.test(toolValidatorDecl), "ToolValidator does not take args: JsonObject");
    assert.ok(/context:\s*ToolExecutionContext/.test(toolValidatorDecl), "ToolValidator does not take context: ToolExecutionContext");
    for (const term of DOMAIN_TERMS) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(toolValidatorDecl), false, `ToolValidator mentions ${term}`);
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(artifactValidatorDecl), false, `ArtifactValidator mentions ${term}`);
    }
  });

  it("instruction contribution carries no tool or privilege fields", () => {
    const decl = /export interface InstructionContribution[\s\S]*?\n}/.exec(contractsText)?.[0] ?? "";
    assert.ok(decl.length > 0, "could not locate InstructionContribution declaration");
    for (const forbidden of ["tools", "skills", "permissions", "toolsAllow", "execute"]) {
      assert.equal(new RegExp(`\\b${forbidden}\\??\\s*:`).test(decl), false, `InstructionContribution declares ${forbidden}`);
    }
    for (const allowed of ["instructions?", "contextBlocks?", "when", "predicate?"]) {
      assert.ok(new RegExp(`\\b${allowed.replace("?", "\\??")}\\s*:`).test(decl), `InstructionContribution missing ${allowed}`);
    }
  });
});

describe("core prompt-file boundaries", () => {
  it("AGENTS.md / SYSTEM.md literals are isolated to the loader and CLI", () => {
    const allowed = new Set([
      "src/node/system-project-prompts.ts",
      "src/node/contribution-discovery.ts",
      "src/node/agent-definitions.ts",
      "src/cli-runner.ts",
    ]);
    const offenders = allSrcFiles.filter((path) => /AGENTS\.md|SYSTEM\.md/.test(readFileSync(path, "utf8")) && !allowed.has(path));
    assert.deepEqual(offenders, [], `AGENTS.md/SYSTEM.md literals leaked outside loader+cli: ${offenders.join(", ")}`);
    for (const core of [
      "src/agents.ts",
      "src/input.ts",
      "src/system-prompts.ts",
      "src/contracts.ts",
      "src/contracts-core.ts",
      "src/contracts-run-state.ts",
      "src/contracts-protocol.ts",
    ]) {
      const text = readFileSync(core, "utf8");
      assert.equal(/AGENTS\.md/.test(text), false, `${core} mentions AGENTS.md`);
      assert.equal(/SYSTEM\.md/.test(text), false, `${core} mentions SYSTEM.md`);
    }
  });

  it("core prompt modules import no node builtins", () => {
    for (const core of [
      "src/system-prompts.ts",
      "src/contracts.ts",
      "src/contracts-core.ts",
      ...sourceFiles("src/contracts-core", () => true),
      "src/contracts-run-state.ts",
      "src/contracts-protocol.ts",
    ]) {
      assert.equal(/from ["']node:/.test(readFileSync(core, "utf8")), false, `${core} imports a node:* builtin`);
    }
  });
});
