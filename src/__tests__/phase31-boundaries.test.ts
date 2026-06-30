import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createSecretRedactor, redactProviderRequest } from "../index.js";
import { createStaticTrustPolicy } from "../security.js";
import { loadSystemPromptFiles } from "../node/system-project-prompts.js";
import { createPathTrustPolicy } from "../node/trust.js";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ProviderRequest } from "../contracts.js";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

const srcFiles = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"));
const srcText = srcFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const contractsText = readFileSync("src/contracts.ts", "utf8");

// ponytail: anchored extraction of the Phase 31 system-prompt contract block so the
// vocabulary scan is limited to system-prompt types and cannot trip on unrelated text
// (e.g. the `step` in `ProviderEvent.step` or `node` in an unrelated comment).
const spBlockStart = contractsText.indexOf("export type SystemPromptMode");
const spConfigStart = contractsText.indexOf("export type SystemPromptConfig", spBlockStart);
const spBlockEnd = spConfigStart >= 0 ? contractsText.indexOf("export ", spConfigStart + 1) : contractsText.indexOf("export ", spBlockStart + 1);
const systemPromptBlock = spBlockStart >= 0 && spBlockEnd > spBlockStart
  ? contractsText.slice(spBlockStart, spBlockEnd)
  : contractsText.slice(spBlockStart);

describe("phase 31 system/project prompt boundaries", () => {
  it("phase31_source_imports_no_synapta_packages_or_mentions", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The system/project
    // prompt seam stays generic — no domain vocabulary crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase31_agents_md_and_system_md_literals_isolated_to_loader_and_cli", () => {
    // The `AGENTS.md` / `SYSTEM.md` filenames must appear only in the Node loader and the
    // CLI runner (plus tests/docs, excluded from srcFiles). Core runtime modules
    // (agents.ts/input.ts/system-prompts.ts/contracts.ts) stay filename-agnostic — they
    // only know `SystemPromptContribution` source tags, never the on-disk file names.
    const allowed = new Set([
      "src/node/system-project-prompts.ts",
      "src/node/contribution-discovery.ts",
      "src/node/agent-definitions.ts",
      "src/cli-runner.ts",
    ]);
    const offenders = srcFiles.filter((path) => /AGENTS\.md|SYSTEM\.md/.test(readFileSync(path, "utf8")) && !allowed.has(path));
    assert.deepEqual(offenders, [], `AGENTS.md/SYSTEM.md literals leaked outside loader+cli: ${offenders.join(", ")}`);

    // Belt-and-braces: explicitly assert the core runtime modules carry neither literal.
    for (const core of ["src/agents.ts", "src/input.ts", "src/system-prompts.ts", "src/contracts.ts"]) {
      const text = readFileSync(core, "utf8");
      assert.equal(/AGENTS\.md/.test(text), false, `${core} mentions AGENTS.md`);
      assert.equal(/SYSTEM\.md/.test(text), false, `${core} mentions SYSTEM.md`);
    }
  });

  it("phase31_system_prompt_contracts_have_no_domain_vocabulary", () => {
    // SystemPromptSource/Mode/Contribution/Config field names are generic
    // (id/source/mode/text/metadata) — no workflow/node/step Synapta-domain terms
    // leak into the seam. Phase 31 adds no new contract type to this block.
    assert.ok(systemPromptBlock.length > 0, "could not locate Phase 31 system-prompt contract block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(systemPromptBlock), false, `system-prompt contract mentions ${term}`);
    }
  });

  it("phase31_no_node_builtin_imports_reachable_from_core_runtime_prompt_modules", () => {
    // Filesystem I/O stays in src/node/. The core runtime modules that compose system
    // prompts must not pull `node:*` builtins (keeps the seam portable + test-host-friendly).
    for (const core of ["src/system-prompts.ts", "src/contracts.ts"]) {
      const text = readFileSync(core, "utf8");
      assert.equal(/from ["']node:/.test(text), false, `${core} imports a node:* builtin`);
    }
  });

  it("phase31_loader_never_executes_discovered_modules_and_trust_gating_is_reachable", async () => {
    // Security: the loader reads prompt text only — never `import()`s an arbitrary path
    // (no code execution from a discovered file). Trust gating is reachable: an untrusted
    // workspace AGENTS.md contributes nothing while SYSTEM.md (user-owned) still loads.
    // ponytail: strip comments first so the doc text "no import()" doesn't trip the code scan.
    const loaderText = readFileSync("src/node/system-project-prompts.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.equal(/\bimport\s*\(/.test(loaderText), false, "loader uses dynamic import() — code execution risk");
    assert.equal(/\beval\s*\(/.test(loaderText), false, "loader uses eval() — code execution risk");

    const workspace = await mkdtemp(join(tmpdir(), "phase31-bnd-ws-"));
    const global = await mkdtemp(join(tmpdir(), "phase31-bnd-glob-"));
    await mkdir(join(global, ".prism", "agent"), { recursive: true });
    await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "GLOBAL");
    await writeFile(join(workspace, "AGENTS.md"), "SHOULD NOT LOAD");

    // ponytail: createStaticTrustPolicy(false) mirrors an untrusted workspace; the path-trust
    // policy (createPathTrustPolicy) is the real CLI path and is exercised by the loader tests.
    const layers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      globalRoot: global,
      trust: createStaticTrustPolicy(false),
    });
    assert.equal(layers.length, 1, "untrusted AGENTS.md was not skipped");
    assert.equal(layers[0].source, "user", "SYSTEM.md should still load (user-owned, no trust gate)");

    // And the real path-trust policy gates correctly too (reachability of createPathTrustPolicy).
    const trustedLayers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      trust: createPathTrustPolicy({ trustedRoots: [workspace] }),
    });
    assert.ok(trustedLayers.some((l) => l.source === "app"), "trusted workspace did not load AGENTS.md via createPathTrustPolicy");
  });

  it("phase31_loader_output_is_redactable_like_any_system_instruction", async () => {
    // Belt-and-braces: a secret embedded in AGENTS.md text is redacted by the standard
    // SecretRedactor applied to a ProviderRequest assembled from loader output — the file
    // layer is treated identically to any other system instruction, no special-casing.
    const secret = "phase31-leak-token-xyz";
    const workspace = await mkdtemp(join(tmpdir(), "phase31-bnd-secret-"));
    await writeFile(join(workspace, "AGENTS.md"), `Project rule. token=${secret}`);
    const layers = await loadSystemPromptFiles({
      workspaceRoot: workspace,
      trust: createPathTrustPolicy({ trustedRoots: [workspace] }),
    });
    assert.ok(layers.some((l) => l.text.includes(secret)), "loader did not emit AGENTS.md text containing the secret");

    // ponytail: minimal representative request — the redaction pipeline is the same one
    // agents.ts applies at providers.ts:159; here we redact a synthesized request carrying
    // the loader-produced system instruction text.
    const request: ProviderRequest = {
      model: { provider: "mock", model: "m" },
      messages: [{ role: "system", content: [{ type: "text", text: layers.map((l) => l.text).join("\n") }] }],
    };
    const redacted = redactProviderRequest(request, createSecretRedactor([secret]));
    assert.equal(JSON.stringify(redacted).includes(secret), false, "AGENTS.md secret leaked past redactProviderRequest");
  });
});
