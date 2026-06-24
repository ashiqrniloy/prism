import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const docsDir = "docs";
const apiPages = [
  "docs/public-contracts.md",
  "docs/agent-session-runtime.md",
  "docs/session-stores-and-branching.md",
  "docs/compaction-and-retry.md",
  "docs/provider-layer.md",
  "docs/provider-conformance.md",
  "docs/provider-packages.md",
  "docs/input-and-prompt-assembly.md",
  "docs/system-prompts.md",
  "docs/context-and-skills.md",
  "docs/configuration-and-manifests.md",
  "docs/contribution-registries.md",
  "docs/extensions.md",
  "docs/middleware-hooks.md",
  "docs/tools.md",
  "docs/node-filesystem-config.md",
  "docs/node-jsonl-session-store.md",
  "docs/resource-loading.md",
  "docs/credentials-and-redaction.md",
  "docs/settings-auth-trust-security.md",
  "docs/cli-rpc.md",
  "docs/release-and-install.md",
];

const providerPackagePages: ReadonlyArray<[string, string]> = [
  ["docs/providers/openai.md", "packages/provider-openai/src/index.ts"],
  ["docs/providers/opencode-go.md", "packages/provider-opencode-go/src/index.ts"],
  ["docs/providers/openrouter.md", "packages/provider-openrouter/src/index.ts"],
  ["docs/providers/zai.md", "packages/provider-zai/src/index.ts"],
  ["docs/providers/kimi.md", "packages/provider-kimi/src/index.ts"],
];

function exportedIdentifiers(packageIndex: string): string[] {
  const text = readFileSync(packageIndex, "utf8");
  const ids = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (id) ids.add(id);
    }
  }
  for (const m of text.matchAll(/export\s+(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g)) {
    ids.add(m[1]);
  }
  return [...ids];
}
const requiredHeadings = [
  "## What it does",
  "## When to use it",
  "## Inputs / request",
  "## Outputs / response / events",
  "## Request/response example",
  "## Implementation example",
  "## Extension and configuration notes",
  "## Security and performance notes",
  "## Related APIs",
];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

describe("docs", () => {
  it("index links point to existing local markdown files", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const links = [...index.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]);

    assert.ok(links.length > 0);
    for (const link of links) {
      assert.equal(existsSync(normalize(join(docsDir, link))), true, `missing docs link: ${link}`);
    }
  });

  // ponytail: guard against plan-022 regression — the buggy pattern
  // `const { api } = createExtensionKernel(); api.registerProviderPackage(...)`
  // throws on copy-paste because createExtensionKernel() returns
  // { registries, middleware, events, load } with no `api` property.
  it("no broken createExtensionKernel() destructure with api.registerProviderPackage", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.ok(
        !text.includes("const { api } = createExtensionKernel()"),
        `${file} still has the broken 'const { api } = createExtensionKernel()' snippet`,
      );
    }
  });

  // ponytail: plan 023 Task 4 guard — no bare `prism` import/install specifiers
  // remain in shipped docs; core is `@arnilo/prism`. The `prism` CLI bin name and
  // `~/.prism` paths are allowed (brand/path, not specifiers).
  it("no bare 'prism' import/install specifiers in README or docs", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const offenders = [
        ...text.matchAll(/from "prism"(?!\b)/g),
        ...text.matchAll(/from "prism\//g),
        ...text.matchAll(/npm install prism\b(?![-.])/g),
        ...text.matchAll(/"prism":(?!\"\/cli\.js")/g),
      ];
      assert.equal(offenders.length, 0, `${file} has bare 'prism' specifier(s)`);
    }
  });

  // ponytail: plan 023 Task 7 guard — no old-scope `@prism/` specifiers remain
  // after the re-scope to `@arnilo/`. Double regression guard against re-scoping drift.
  it("no old-scope '@prism/' specifiers in README or docs", () => {
    const files = ["README.md", ...markdownFiles("docs")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const offenders = [...text.matchAll(/@prism\//g)];
      assert.equal(offenders.length, 0, `${file} has old-scope '@prism/' specifier(s)`);
    }
  });

  it("api pages include required headings", () => {
    const pages = [...apiPages, ...markdownFiles("docs/providers")];
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      for (const heading of requiredHeadings) assert.ok(text.includes(heading), `${page} missing ${heading}`);
    }
  });

  it("provider docs document a real export from their package", () => {
    for (const [page, packageIndex] of providerPackagePages) {
      const text = readFileSync(page, "utf8");
      const ids = exportedIdentifiers(packageIndex);
      assert.ok(ids.length > 0, `${packageIndex} has no exports`);
      assert.ok(
        ids.some((id) => text.includes(id)),
        `${page} does not document any export from ${packageIndex}`,
      );
    }
  });

  it("phase 3 docs are linked from the docs index", () => {
    const index = readFileSync("docs/index.md", "utf8");

    for (const page of ["configuration-and-manifests.md", "node-filesystem-config.md", "resource-loading.md"]) {
      assert.ok(index.includes(`(${page})`), `docs/index.md does not link ${page}`);
    }
  });

  it("phase 2 and 3 docs reference existing root exports", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const documentedExports = [
      ["docs/configuration-and-manifests.md", "mergeConfigLayers"],
      ["docs/configuration-and-manifests.md", "definePrismManifest"],
      ["docs/configuration-and-manifests.md", "parsePrismManifest"],
      ["docs/resource-loading.md", "loadTextResource"],
      ["docs/resource-loading.md", "loadJsonResource"],
      ["docs/resource-loading.md", "loadManifestResource"],
      ["docs/contribution-registries.md", "createContributionRegistry"],
      ["docs/contribution-registries.md", "createContributionRegistries"],
      ["docs/extensions.md", "createExtensionKernel"],
      ["docs/extensions.md", "createExtensionEventBus"],
      ["docs/middleware-hooks.md", "createMiddlewareRegistry"],
      ["docs/tools.md", "createToolRegistry"],
      ["docs/tools.md", "filterTools"],
      ["docs/tools.md", "dispatchToolCall"],
      ["docs/input-and-prompt-assembly.md", "createDefaultInputBuilder"],
      ["docs/input-and-prompt-assembly.md", "assembleProviderInput"],
      ["docs/input-and-prompt-assembly.md", "renderPromptTemplate"],
      ["docs/context-and-skills.md", "resolveContextProviders"],
      ["docs/context-and-skills.md", "createSkillRegistry"],
      ["docs/context-and-skills.md", "resolveActiveSkills"],
      ["docs/agent-session-runtime.md", "createAgent"],
      ["docs/agent-session-runtime.md", "createAgentSession"],
      ["docs/session-stores-and-branching.md", "createSessionEntry"],
      ["docs/session-stores-and-branching.md", "createMemorySessionStore"],
      ["docs/session-stores-and-branching.md", "rebuildSessionContext"],
      ["docs/compaction-and-retry.md", "createDefaultCompactionStrategy"],
      ["docs/compaction-and-retry.md", "createDefaultRetryPolicy"],
    ] as const;

    for (const [page, exportName] of documentedExports) {
      assert.ok(readFileSync(page, "utf8").includes(exportName), `${page} does not document ${exportName}`);
      assert.match(rootExports, new RegExp(`\\b${exportName}\\b`), `src/index.ts does not export ${exportName}`);
    }
  });

  it("phase 5 and 6 docs are linked from the docs index", () => {
    const index = readFileSync("docs/index.md", "utf8");

    assert.ok(index.includes("(input-and-prompt-assembly.md)"));
    assert.ok(index.includes("(context-and-skills.md)"));
    assert.ok(index.includes("(agent-session-runtime.md)"));
    assert.ok(index.includes("(session-stores-and-branching.md)"));
    assert.ok(index.includes("(compaction-and-retry.md)"));
  });

  it("compaction and retry docs cover public surfaces and safety boundaries", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const compactionRetry = readFileSync("docs/compaction-and-retry.md", "utf8");
    const index = readFileSync("docs/index.md", "utf8");
    const registries = readFileSync("docs/contribution-registries.md", "utf8");
    const extensions = readFileSync("docs/extensions.md", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");
    const middleware = readFileSync("docs/middleware-hooks.md", "utf8");
    const provider = readFileSync("docs/provider-layer.md", "utf8");

    for (const exportName of [
      "createDefaultCompactionStrategy",
      "isCompactionEntryData",
      "createDefaultRetryPolicy",
      "isTransientErrorInfo",
      "waitForRetry",
    ]) {
      assert.match(rootExports, new RegExp(`\\b${exportName}\\b`), `src/index.ts does not export ${exportName}`);
      assert.ok(compactionRetry.includes(exportName), `docs/compaction-and-retry.md does not document ${exportName}`);
    }

    for (const phrase of [
      "compaction_started",
      "compaction_finished",
      "retry_scheduled",
      "AgentConfig.compaction",
      "RunOptions.compaction",
      "AgentConfig.retry",
      "RunOptions.retry",
      "RetryMiddlewarePayload",
      "provider request messages/content",
      "credential resolvers",
      "Raw session entries are never deleted",
    ]) {
      assert.ok(compactionRetry.includes(phrase), `compaction/retry docs missing ${phrase}`);
    }

    assert.ok(index.includes("retry transient provider failures"));
    assert.ok(registries.includes("retryPolicies"));
    assert.ok(extensions.includes("registerRetryPolicy"));
    assert.ok(manifests.includes("retryPolicy"));
    assert.ok(middleware.includes("invokes `retry`"));
    assert.ok(provider.includes("ErrorInfo.code"));
  });

  it("phase 3 docs state explicit non-goals", () => {
    const combined = [
      "docs/configuration-and-manifests.md",
      "docs/node-filesystem-config.md",
      "docs/resource-loading.md",
    ].map((page) => readFileSync(page, "utf8")).join("\n");

    for (const phrase of ["package discovery", "dynamic import", "trust policy", "agent/session runtime"]) {
      assert.match(combined, new RegExp(phrase), `phase 3 docs do not mention ${phrase}`);
    }
  });

  it("node docs reference existing package subpaths", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };
    const configDocs = readFileSync("docs/node-filesystem-config.md", "utf8");
    const jsonlDocs = readFileSync("docs/node-jsonl-session-store.md", "utf8");

    assert.ok(configDocs.includes("@arnilo/prism/node/config"));
    assert.deepEqual(packageJson.exports["./node/config"], {
      types: "./dist/node/config.d.ts",
      default: "./dist/node/config.js",
    });
    assert.ok(jsonlDocs.includes("@arnilo/prism/node/session-store-jsonl"));
    assert.deepEqual(packageJson.exports["./node/session-store-jsonl"], {
      types: "./dist/node/session-store-jsonl.d.ts",
      default: "./dist/node/session-store-jsonl.js",
    });
  });

  it("phase 10 docs link security auth trust surfaces", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const docs = readFileSync("docs/settings-auth-trust-security.md", "utf8");
    const rootExports = readFileSync("src/index.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };

    assert.ok(index.includes("(settings-auth-trust-security.md)"));
    for (const name of ["createStaticSettingsProvider", "createMemoryCredentialStore", "assertTrusted", "assertPermission", "createSecretRedactor"]) {
      assert.ok(docs.includes(name), `security docs missing ${name}`);
      assert.match(rootExports, new RegExp(`\\b${name}\\b`), `src/index.ts does not export ${name}`);
    }
    for (const phrase of ["does not sandbox", "does not read environment variables", "no persistent secret store", "auto-load project-local"]) {
      assert.ok(docs.includes(phrase), `security docs missing ${phrase}`);
    }
    assert.deepEqual(packageJson.exports["./node/settings"], { types: "./dist/node/settings.d.ts", default: "./dist/node/settings.js" });
    assert.deepEqual(packageJson.exports["./node/trust"], { types: "./dist/node/trust.d.ts", default: "./dist/node/trust.js" });
  });

  it("docs_index_links_cli_rpc_page", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("(cli-rpc.md)"));
  });

  it("release_and_install_page_is_linked_from_index", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const docs = readFileSync("docs/release-and-install.md", "utf8");
    assert.ok(index.includes("(release-and-install.md)"), "docs/index.md does not link release-and-install.md");
    for (const phrase of ["required `@arnilo/prism` peer", "map-retention knob", "offline test budget", "sideEffects", "peerDependencies"]) {
      assert.ok(docs.includes(phrase), `docs/release-and-install.md missing ${phrase}`);
    }
  });

  it("release_and_install_docs_list_every_live_test_gate_env_var", () => {
    const docs = readFileSync("docs/release-and-install.md", "utf8");
    // Every opt-in gate var read by a live.test.ts must be enumerated here.
    for (const gate of [
      "PRISM_LIVE_PROVIDER_TESTS",
      "PRISM_LIVE_COMPACTION_TESTS",
      "PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS",
    ]) {
      assert.ok(docs.includes(gate), `docs/release-and-install.md does not document ${gate}`);
    }
    // The default suite must be stated as network-free so the opt-in status is unambiguous.
    assert.ok(/network-free/.test(docs), "docs/release-and-install.md must state default suite is network-free");
    // The guarded bodies are fake-safe placeholders and never read real provider keys.
    assert.ok(docs.includes("placeholder"), "docs/release-and-install.md must mark live tests as placeholder");
  });

  it("cli_rpc_docs_cover_modes_flags_and_rpc_commands", () => {
    const docs = readFileSync("docs/cli-rpc.md", "utf8");
    for (const phrase of ["--mode print", "--provider", "--model", "prompt", "abort", "compact", "cloneSession", "No built-in app tools", "No full TUI"]) {
      assert.ok(docs.includes(phrase), `cli/rpc docs missing ${phrase}`);
    }
  });

  it("auth docs cover explicit resolver order and no hidden env", () => {
    const docs = readFileSync("docs/credentials-and-redaction.md", "utf8");
    for (const phrase of ["createExplicitCredentialResolver", "createEnvCredentialResolver", "refreshOAuthCredential", "runtime override", "Prism does not read `process.env`"]){
      assert.ok(docs.includes(phrase), `credential docs missing ${phrase}`);
    }
  });

  it("system prompt docs cover layers and secret warning", () => {
    const docs = readFileSync("docs/system-prompts.md", "utf8");
    for (const phrase of ["composeSystemPrompt", "package`, `app`, `user`, then `run`", "RunOptions.systemPrompt: false", "Do not put secrets in prompts"]){
      assert.ok(docs.includes(phrase), `system prompt docs missing ${phrase}`);
    }
  });

  it("provider conformance docs cover testing subpath and no network", () => {
    const docs = readFileSync("docs/provider-conformance.md", "utf8");
    for (const phrase of ["@arnilo/prism/testing/provider-conformance", "assertAbortIsObserved", "assertToolCallDeltasReconstruct", "No credentials", "network calls"]){
      assert.ok(docs.includes(phrase), `provider conformance docs missing ${phrase}`);
    }
  });

  it("provider request policy docs cover runtime timing and cache usage", () => {
    const combined = [
      "docs/provider-packages.md",
      "docs/provider-layer.md",
      "docs/middleware-hooks.md",
      "docs/agent-session-runtime.md",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const phrase of ["createSessionCachePolicy", "ProviderRequest.options", "cacheRetention", "provider_request", "cache read/write"]){
      assert.ok(combined.includes(phrase), `provider request docs missing ${phrase}`);
    }
  });

  it("docs avoid real-looking secret examples", () => {
    for (const file of markdownFiles(docsDir)) {
      const text = readFileSync(file, "utf8");
      assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(text), false, `${file} has real-looking secret`);
    }
  });

  it("docs_provider_conformance_lists_new_helpers", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };
    const docs = readFileSync("docs/provider-conformance.md", "utf8");

    assert.deepEqual(packageJson.exports["./testing/provider-conformance"], {
      types: "./dist/testing/provider-conformance.d.ts",
      default: "./dist/testing/provider-conformance.js",
    });
    for (const helper of ["assertSerializedRequestCoversContent", "assertNoSecretLeak"]) {
      assert.ok(docs.includes(helper), `docs/provider-conformance.md does not document ${helper}`);
    }
  });

  it("docs_middleware_hooks_match_runtime_supported_hooks", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const middlewareTs = readFileSync("src/middleware.ts", "utf8");
    const docs = readFileSync("docs/middleware-hooks.md", "utf8");
    const supported = [
      "provider_request",
      "input_assembly",
      "prompt_build",
      "context",
      "tool_call",
      "tool_result",
      "retry",
      "compaction",
      "session_start",
      "session_shutdown",
    ];

    assert.match(rootExports, /\bMiddlewareHookName\b/, "src/index.ts does not export MiddlewareHookName");
    for (const hook of supported) {
      assert.ok(middlewareTs.includes(`"${hook}"`), `src/middleware.ts missing hook ${hook}`);
      assert.ok(docs.includes(hook), `docs/middleware-hooks.md missing hook ${hook}`);
    }
    assert.ok(!middlewareTs.includes('"provider_response"'), "src/middleware.ts still contains removed provider_response hook");
    assert.ok(docs.includes("There is no `provider_response` hook"), "docs/middleware-hooks.md does not state provider_response is removed");
  });

  it("docs_manifest_kinds_include_current_provider_primitives", () => {
    const rootExports = readFileSync("src/index.ts", "utf8");
    const manifests = readFileSync("docs/configuration-and-manifests.md", "utf8");

    assert.match(rootExports, /\bManifestContributionKind\b/, "src/index.ts does not export ManifestContributionKind");
    for (const kind of [
      "providerPackage",
      "authMethod",
      "providerRequestPolicy",
      "systemPromptContribution",
    ]) {
      assert.ok(manifests.includes(kind), `docs/configuration-and-manifests.md does not document ${kind}`);
    }
  });

  it("provider_packages_docs_cover_cache_policy_and_request_options", () => {
    const docs = readFileSync("docs/provider-packages.md", "utf8");
    for (const phrase of ["cache policy", "createSessionCachePolicy", "ProviderRequest.options", "cacheRetention"]) {
      assert.ok(docs.includes(phrase), `docs/provider-packages.md missing ${phrase}`);
    }
  });

  it("readme_describes_current_runtime_provider_packages_cli_and_examples", () => {
    const readme = readFileSync("README.md", "utf8");
    for (const name of ["createAgent", "createAgentSession"]) {
      assert.ok(readme.includes(name), `README.md does not mention ${name}`);
    }
    for (const pkg of [
      "@arnilo/prism-provider-openai",
      "@arnilo/prism-provider-opencode-go",
      "@arnilo/prism-provider-openrouter",
      "@arnilo/prism-provider-zai",
      "@arnilo/prism-provider-kimi",
    ]) {
      assert.ok(readme.includes(pkg), `README.md does not mention ${pkg}`);
    }
    for (const mode of ["--mode print", "--mode json", "--mode rpc"]) {
      assert.ok(readme.includes(mode), `README.md does not document CLI ${mode}`);
    }
    assert.ok(readme.includes("examples/"), "README.md does not reference examples/");
  });

  it("examples_files_exist_and_index_links_examples", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(index.includes("examples/"), "docs/index.md does not mention examples/");
    assert.ok(existsSync("examples/README.md"), "missing examples/README.md");
    const exampleFiles = [
      "examples/sdk-basics.ts",
      "examples/provider-registration.ts",
      "examples/api-key-auth.ts",
      "examples/oauth-login.ts",
      "examples/openrouter-model-cache-override.ts",
      "examples/tools.ts",
      "examples/context.ts",
      "examples/skills.ts",
      "examples/extensions.ts",
      "examples/manifests.ts",
      "examples/config-settings.ts",
      "examples/system-prompts.ts",
      "examples/jsonl-stores-branching.ts",
      "examples/compaction.ts",
      "examples/observational-memory-recall-status-view.ts",
      "examples/cli.ts",
      "examples/rpc.ts",
    ];
    for (const file of exampleFiles) {
      assert.equal(existsSync(file), true, `missing example file: ${file}`);
    }
  });

  it("examples_demos_run_to_completion_and_emit_no_secret", () => {
    // Node 24 strips TypeScript types natively; building core (the test suite
    // already built dist/) is enough for the `prism` and @arnilo/prism-* resolvers.
    const demos = [
      "examples/provider-registration.ts",
      "examples/compaction.ts",
      "examples/observational-memory-recall-status-view.ts",
      "examples/cli.ts",
      "examples/rpc.ts",
    ];
    const secret = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;
    for (const file of demos) {
      const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
      assert.equal(result.status, 0, `${file} exited ${result.status}\n${result.stderr}`);
      const out = `${result.stdout}\n${result.stderr}`;
      assert.ok(out.trim().length > 0, `${file} produced no output`);
      assert.ok(!secret.test(out), `${file} emitted a real-looking secret`);
    }
  });

  it("readme_has_no_real_looking_secrets", () => {
    const readme = readFileSync("README.md", "utf8");
    assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(readme), false, "README.md has real-looking secret");
  });
});
