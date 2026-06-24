import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const packages = ["openai", "opencode-go", "openrouter", "zai", "kimi"] as const;
const packageFactories = [
  ["openai", "createOpenAIProviderPackage", { apiKey: "fake-openai-key" }],
  ["opencode-go", "createOpenCodeGoProviderPackage", { apiKey: "fake-opencode-key" }],
  ["openrouter", "createOpenRouterProviderPackage", { apiKey: "fake-openrouter-key" }],
  ["zai", "createZaiProviderPackage", { apiKey: "fake-zai-key" }],
  ["kimi", "createKimiProviderPackage", { kimiApiKey: "fake-kimi-key" }],
] as const;

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

describe("phase 12 provider package boundaries", () => {
  it("phase12_provider_packages_import_from_public_entrypoints", async () => {
    for (const [name, factory] of packageFactories) {
      const mod = await import(`../../packages/provider-${name}/dist/index.js`) as Record<string, unknown>;
      assert.equal(typeof mod[factory], "function", `missing ${factory}`);
    }
  });

  it("phase12_provider_packages_setup_without_network_and_register_auth", async () => {
    for (const [name, factory, options] of packageFactories) {
      let fetchCalls = 0;
      const registered: unknown[] = [];
      const specifier = `../../packages/provider-${name}/dist/index.js`;
      const mod = await import(specifier) as Record<string, (options: unknown) => { setup(api: unknown): unknown }>;
      await mod[factory]!({ ...options, fetch: (() => { fetchCalls++; throw new Error("network disabled"); }) as typeof fetch }).setup({
        registerProvider: (item: unknown) => registered.push(item),
        registerModel: (item: unknown) => registered.push(item),
        registerAuthMethod: (item: unknown) => registered.push(item),
      });
      assert.equal(fetchCalls, 0, `${specifier} setup called fetch`);
      assert(registered.some((item: any) => item.kind === "api_key" || item.kind === "oauth"), `${specifier} did not register auth`);
    }
  });

  it("phase12_live_tests_are_skipped_by_default", () => {
    for (const name of packages) {
      const text = readFileSync(`packages/provider-${name}/src/__tests__/live.test.ts`, "utf8");
      assert.ok(text.includes("PRISM_LIVE_PROVIDER_TESTS"));
      assert.ok(text.includes("skip:"));
    }
  });

  it("phase12_docs_index_links_all_provider_pages", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const providerDocs = readFileSync("docs/provider-packages.md", "utf8");
    for (const name of packages) {
      const link = `providers/${name}.md`;
      assert.ok(existsSync(`docs/${link}`), `missing docs/${link}`);
      assert.ok(index.includes(`(${link})`), `docs/index.md does not link ${link}`);
      assert.ok(providerDocs.includes(`(${link})`), `docs/provider-packages.md does not link ${link}`);
    }
  });

  it("phase12_package_exports_files_are_minimal", () => {
    for (const name of packages) {
      const pkg = JSON.parse(readFileSync(`packages/provider-${name}/package.json`, "utf8"));
      assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
      assert.deepEqual(pkg.files, ["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]);
      assert.deepEqual(pkg.dependencies ?? {}, {});
      assert.equal(pkg.scripts.postinstall, undefined);
    }
  });

  it("phase12_no_real_secrets_in_docs_or_fixtures", () => {
    const text = [
      ...files("docs", (path) => path.endsWith(".md")),
      ...files("packages", (path) => /(__tests__|README\.md|docs)/.test(path) && /\.(ts|md)$/.test(path)),
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    assert.equal(/sk-[A-Za-z0-9]{20,}/.test(text), false);
    assert.equal(/Bearer\s+[A-Za-z0-9._-]{24,}/.test(text), false);
  });

  it("phase12_core_has_no_new_requested_provider_runtime_behavior", () => {
    const text = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__") && !path.includes("src/providers/openai-compatible"))
      .map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n");
    for (const forbidden of ["openrouter", "zai", "kimi", "opencode", "openai-codex", "chatgpt", "moonshot"])
      assert.equal(text.includes(forbidden), false, `core runtime source contains provider-specific literal ${forbidden}`);
  });
});
