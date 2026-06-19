import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path.includes("src/__tests__") || path.includes("src/providers")) return [];
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("phase 11 boundaries", () => {
  it("public_contracts_import_phase_11_exports", () => {
    const root = readFileSync("src/index.ts", "utf8");
    for (const name of [
      "defineProviderPackage",
      "createExplicitCredentialResolver",
      "createEnvCredentialResolver",
      "refreshOAuthCredential",
      "createProviderRequestPolicyChain",
      "createSessionCachePolicy",
      "mergeProviderRequestOptions",
      "composeSystemPrompt",
      "mergeSystemPromptConfig",
    ]) assert.ok(root.includes(name), `missing root export ${name}`);

    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/provider-conformance"], "missing provider conformance subpath");
  });

  it("docs_index_links_phase_11_pages", () => {
    const index = readFileSync("docs/index.md", "utf8");
    for (const page of ["provider-packages.md", "system-prompts.md", "provider-conformance.md", "credentials-and-redaction.md"])
      assert.ok(index.includes(`(${page})`), `docs/index.md missing ${page}`);
  });

  it("core_runtime_has_no_requested_provider_specific_behavior", () => {
    const text = files("src").map((file) => readFileSync(file, "utf8")).join("\n").toLowerCase();
    for (const forbidden of ["openrouter", "zai", "kimi", "opencode", "openai-codex", "chatgpt", "moonshot"])
      assert.equal(text.includes(forbidden), false, `core source contains provider-specific literal ${forbidden}`);
  });
});
