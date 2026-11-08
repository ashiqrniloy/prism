import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import type { ModelProvider, ProviderRequest } from "../contracts.js";
import { createBuiltinProvider } from "../models/builtin.js";
import * as kit from "../provider-kit/index.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { exports: Record<string, unknown> };

/** `openai` and `anthropic` name protocols here (OpenAI-compatible, Anthropic Messages), not just vendors. */
const PROTOCOL_NAMES = new Set(["openai", "anthropic"]);

/** Non-test TypeScript files under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Every provider package directory that ships a `src/index.ts`, under both the family and the group. */
function providerPackageDirs(): string[] {
  const groupRoot = "packages/providers";
  if (!existsSync(groupRoot)) return [];
  return readdirSync(groupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(groupRoot, entry.name, "src/index.ts")))
    .map((entry) => join(groupRoot, entry.name))
    .sort();
}

/** Every module reachable from `entry` through static relative imports and re-exports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    // Type-only imports and re-exports are erased at build, so they load nothing.
    const valueText = text.replace(/\b(?:import|export)\s+type\b[^;]*?from\s*"[^"]+";?/gs, "");
    for (const match of valueText.matchAll(/(?:\bfrom|^import)\s*"(\.[^"]+)"/gm)) {
      const target = normalize(join(dirname(file), match[1].replace(/\.js$/, ".ts")));
      if (existsSync(target)) queue.push(target);
    }
  }
  return seen;
}

describe("provider-kit", () => {
  it("provider_kit_exports_wire_helpers_package_helper_and_conformance", () => {
    for (const name of [
      "readSseEvents",
      "readBoundedResponseText",
      "ProviderTransportError",
      "createOpenAICompatibleProvider",
      "serializeOpenAIChatMessage",
      "canonicalizeJsonSchema",
      "resolveProviderMediaMessages",
      "anthropicMessagesBody",
      "anthropicMessagesEvents",
      "ProviderRequirementError",
      "providerPackage",
      "defineProviderPackage",
      "providerPackageInstance",
      "refSource",
      "optionalRefSource",
      "secretRefProperty",
      "baseUrlProperty",
      "modelsProperty",
      "providerConformance",
      "assertNoSecretLeak",
    ]) {
      assert.equal(typeof (kit as Record<string, unknown>)[name], "function", `provider-kit must export ${name}`);
    }
    assert.deepEqual(pkg.exports["./provider-kit"], "./src/provider-kit/index.ts");
  });

  it("provider_kit_exports_match_inventory", () => {
    const expected = [
      "anthropicAdaptiveThinking",
      "DEFAULT_MAX_ARGUMENT_BYTES",
      "DEFAULT_MAX_BUFFER_BYTES",
      "DEFAULT_MAX_EVENT_BYTES",
      "DEFAULT_MAX_RESPONSE_BODY_BYTES",
      "DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH",
      "DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES",
      "DEFAULT_MAX_SYSTEMONE_STATE_BYTES",
      "DEFAULT_OWNED_COMPAT_KEYS",
      "DEFAULT_PROVIDER_MEDIA_ITEM_BYTES",
      "DEFAULT_PROVIDER_UPLOAD_CACHE_ENTRIES",
      "DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX",
      "DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD",
      "DEFAULT_SYSTEMONE_MAX_RETRIES",
      "DEFAULT_SYSTEMONE_PATH",
      "MAX_SYSTEMONE_CHOICE_OPTIONS",
      "MAX_SYSTEMONE_QUESTIONS",
      "MAX_SYSTEMONE_SCORE_LEVELS",
      "OMITTED_TOOL_RESULT_IMAGE_NOTE",
      "OPENAI_RESPONSES_MIN_OUTPUT_TOKENS",
      "OPENAI_RESPONSES_UNSUPPORTED_FIELDS",
      "ProviderRequirementError",
      "ProviderTransportError",
      "RETRYABLE_STATUSES",
      "ResponsesMaxOutputTokensError",
      "StructuredOutputError",
      "SystemOneAbortedError",
      "SystemOneAuthError",
      "SystemOneError",
      "SystemOneInvalidRequestError",
      "SystemOneRetryExhaustedError",
      "SystemOneSchemaError",
      "THINKING_LEVELS",
      "anthropicCacheEnabled",
      "anthropicMessagesBody",
      "anthropicMessagesEvents",
      "applyCacheControl",
      "applyDefaultProviderRequestOptions",
      "applyOpenAIChatStructuredOutput",
      "applyThinkingLevel",
      "applyThinkingLevelForModel",
      "artifactStructuredOutputRequest",
      "askSystemOneDecisions",
      "assertAbortIsObserved",
      "assertAuthDescriptorsWellFormed",
      "assertCanonicalToolParameters",
      "assertModelsListValid",
      "assertNoFetches",
      "assertNoForeignCacheFields",
      "assertNoSecretLeak",
      "assertNotAborted",
      "assertOpenAIChatMessage",
      "assertProviderMediaCapability",
      "assertProviderOwnedHeadersWin",
      "assertProviderStreamConforms",
      "assertRecordedStreamConforms",
      "assertSerializedRequestCoversContent",
      "assertStructuredOutputRequestSupported",
      "assertToolCallDeltasReconstruct",
      "assertUsageAccounting",
      "baseUrlProperty",
      "buildOpenAIChatBody",
      "buildOpenAIResponsesBody",
      "bytesToBase64",
      "cacheHitRate",
      "cacheSavings",
      "cacheUsageReport",
      "canonicalizeJsonSchema",
      "classifyProviderFailure",
      "collectProviderEvents",
      "compileSystemOneQuestions",
      "compileSystemOneState",
      "createBoundedUploadCache",
      "createOpenAICompatibleProvider",
      "createRoutedProvider",
      "createToolNameMap",
      "createSystemOneDecisionProvider",
      "defaultProviderFilename",
      "defineProviderPackage",
      "httpStatusError",
      "isContextOverflowMessage",
      "isLoopbackHost",
      "isPdfMediaType",
      "isPlaintextRemote",
      "isRetryableSystemOneStatus",
      "isSupportedThinkingLevel",
      "isSystemOneAnswer",
      "isSystemOneResponse",
      "isThinkingLevel",
      "mapCacheRetention",
      "mapOpenAIChatUsage",
      "mapOpenAIResponsesUsage",
      "mapSystemOneUsage",
      "mediaFingerprint",
      "mergeProviderRequestOptions",
      "modelEntrySchema",
      "modelSupportsStructuredOutput",
      "modelsProperty",
      "normalizeSystemOnePath",
      "normalizeThinkingLevel",
      "normalizeUsage",
      "openAIChatBody",
      "openAIChatEvents",
      "openAIResponsesBody",
      "openAIResponsesEvents",
      "optionalRefSource",
      "parseErrorBody",
      "parseJsonObjectArguments",
      "parseRetryAfterMs",
      "parseThinkingLevel",
      "plaintextRemoteOrigin",
      "postSystemOne",
      "preserveThinking",
      "productToolName",
      "providerConformance",
      "providerHttpError",
      "providerPackage",
      "providerPackageInstance",
      "providerUploadCacheKey",
      "readBoundedResponseJson",
      "readBoundedResponseText",
      "readRetryAfterMs",
      "readSseData",
      "readSseEvents",
      "reasoningEffort",
      "reasoningObject",
      "refSource",
      "rejectProviderMediaBlock",
      "renderSystemOneOutput",
      "replayFetch",
      "resolveBreakpoint",
      "resolvePreserveThinking",
      "resolvePromptCachePlan",
      "resolveProviderApiKey",
      "resolveProviderMediaMessages",
      "resolveReasoningEffort",
      "resolveReasoningObject",
      "resolveRunProviderOptions",
      "resolveThinkingObject",
      "runEmbeddingsConformance",
      "sanitizeCacheKey",
      "secretRefProperty",
      "serializeOpenAIChatMessage",
      "serializeOpenAIChatStructuredOutput",
      "serializeOpenAITool",
      "serializePdfDocumentWireBlock",
      "serializeResponsesTool",
      "serializeToolResultText",
      "snapThinkingLevel",
      "stripOwnedCompat",
      "systemCacheControlField",
      "systemOneConformance",
      "systemOneProviderPackage",
      "thinkingCompatFor",
      "thinkingFamilyForModel",
      "thinkingLevelsForModel",
      "thinkingObject",
      "tryParseJsonObjectArguments",
      "validateStructuredOutputOptions",
      "warnIfPlaintextRemote",
      "wireToolName",
      "withoutStructuredOutput",
    ];
    assert.deepEqual(Object.keys(kit).sort(), [...expected].sort());
  });

  it("provider_package_registers_providers_in_order", () => {
    const providers: ModelProvider[] = ["a", "b"].map((id) => ({ id, async *generate() {} }));
    const instance = kit.providerPackage("acme-models", providers);
    assert.equal(instance.definition.name, "acme-models");
  });

  it("provider_kit_exports_moved_helpers", async () => {
    const kit = await import("../provider-kit/index.js");
    const root = await import("../index.js");
    for (const name of [
      "normalizeThinkingLevel",
      "applyCacheControl",
      "applyDefaultProviderRequestOptions",
      "validateStructuredOutputOptions",
    ]) {
      assert.equal(typeof (kit as Record<string, unknown>)[name], "function", `${name} missing from provider-kit`);
      assert.equal(Object.hasOwn(root, name), false, `${name} still on the root barrel`);
    }
  });

  it("root_entry_does_not_load_provider_kit", () => {
    // Files under provider-kit/ are loaded by the built-in openai-compatible provider.
    // The barrel must not be. A file import such as ../provider-kit/transport.js is allowed.
    const seen = new Set<string>();
    const queue = ["src/index.ts"];
    const hits: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
        const spec = match[1]!;
        if (spec === "@arnilo/prism/provider-kit" || /(?:^|\/)provider-kit(?:\/index)?\.js$/.test(spec)) {
          hits.push(`${file}: ${spec}`);
        }
        if (!spec.startsWith(".")) continue;
        const target = join(file, "..", spec.replace(/\.js$/, ".ts"));
        queue.push(existsSync(target) ? target : join(file, "..", spec.replace(/\.js$/, ""), "index.ts"));
      }
    }
    assert.deepEqual(hits, []);
  });

  it("provider_kit_import_does_not_load_agent_runtime", () => {
    const files = [...reachable("src/provider-kit/index.ts")];
    assert.ok(files.length > 8 && files.some((file) => file.endsWith("models/events.ts")), "the walk must follow real imports");
    const runtime = files.filter((file) => /src\/(agent-session|agent|loop|host)\//.test(file) || /src\/(agent|session)\.ts$/.test(file));
    assert.deepEqual(runtime, []);
  });

  it("provider_kit_names_no_vendor", () => {
    // `openai` and `anthropic` name protocols here (OpenAI-compatible, Anthropic
    // Messages) as much as vendors, so their wire modules are sanctioned
    // (plan 152 Task 2). `codex` is a vendor product name and stays banned.
    // Vendors still in the family and already moved to the group both count.
    const vendorDirs = new Set<string>();
    for (const dir of providerPackageDirs()) vendorDirs.add(dir.slice("packages/providers/".length));
    const vendors = [...vendorDirs].filter((name) => !PROTOCOL_NAMES.has(name)).sort();
    assert.ok(vendors.length >= 4, `expected every non-protocol vendor, got ${vendors.length}: ${vendors.join(", ")}`);
    // The invariant is about code, not prose: strip comments first. A `x-`-prefixed
    // extension key (e.g. a legacy schema alias) is a protocol token, not vendor behavior.
    const pattern = new RegExp(`(?<!x-)\\b(${[...vendors, "z\\.ai", "codex"].map((v) => v.replace(/-/g, "[- ]?")).join("|")})\\b`, "i");
    const stripComments = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\/.*$/gm, "");
    // Plan 204 Task 3: the walk descends into `codecs/`, so a route format cannot hide a vendor
    // name one directory below the files the check used to read.
    for (const path of sourceFiles("src/provider-kit")) {
      const file = { name: path.slice("src/provider-kit/".length) };
      let source = stripComments(readFileSync(path, "utf8"));
      // thinking.ts keeps two pre-move wire tokens: the `google` family id and the
      // neuralwatt provider-id fallback. They are family inference, not a vendor import.
      if (file.name === "thinking.ts") source = source.replace(/\bgoogle\b/g, "").replace(/\bneuralwatt\b/g, "");
      assert.doesNotMatch(source, pattern, `${file.name} names a vendor`);
    }
  });

  it("no_vendor_imports_a_sibling_vendor", () => {
    // Plan 152 Task 8: every adapter lives in its own package under packages/providers/.
    const groupRoot = "packages/providers";
    const roots: string[] = [];
    for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(groupRoot, entry.name, "src"))) roots.push(join(groupRoot, entry.name, "src"));
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(path);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
      });
    for (const root of roots) {
      const siblings = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !["__tests__", "decisions", "model-discovery"].includes(entry.name))
        .map((entry) => entry.name);
      for (const file of walk(root)) {
        for (const match of readFileSync(file, "utf8").matchAll(/from "\.\.\/([a-z0-9-]+)\//g)) {
          assert.equal(siblings.includes(match[1]), false, `${file} imports sibling provider ${match[1]}`);
        }
      }
    }
  });

  it("provider_packages_spawn_no_process_and_open_no_browser", () => {
    // The host owns `open-url`; a provider package must never reach outside its own process.
    const banned = /child_process|xdg-open|from "open"|require\("open"\)|spawnSync\(|execSync\(|execFileSync\(/;
    const stripComments = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\/.*$/gm, "");
    const dirs = providerPackageDirs();
    const scanned = dirs.flatMap((dir) => sourceFiles(join(dir, "src")));
    assert.ok(
      dirs.length > 0 && scanned.length >= dirs.length,
      `expected the provider source tree, scanned ${scanned.length} files in ${dirs.length} packages`,
    );
    for (const file of scanned) {
      assert.doesNotMatch(stripComments(readFileSync(file, "utf8")), banned, `${file} spawns a process or opens a browser`);
    }
  });

  it("loading_one_provider_package_never_evaluates_another", () => {
    const dirs = providerPackageDirs();
    assert.ok(dirs.length >= 2, "the walk needs provider packages to compare");
    const scratch = mkdtempSync(join(tmpdir(), "prism-provider-graph-"));
    try {
      for (const dir of dirs) {
        const name = dir.slice("packages/providers/".length);
        const out = join(scratch, `${name}.js`);
        const built = spawnSync("bun", ["build", "--target=bun", join(dir, "src/index.ts"), `--outfile=${out}`], { encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr);
        const text = readFileSync(out, "utf8");
        for (const other of dirs) {
          const sibling = other.slice("packages/providers/".length);
          if (sibling === name) continue;
          assert.equal(text.includes(`/packages/providers/${sibling}/`), false, `${name} bundle evaluated ${sibling}`);
        }
        for (const retired of ["anthropic", "openai"]) {
          if (retired === name) continue;
          assert.equal(text.includes(`/prism-providers/src/${retired}/`), false, `${name} bundle evaluated the retired ${retired} adapter`);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("old_providers_subpaths_are_not_exported", () => {
    const keys = Object.keys(pkg.exports);
    assert.deepEqual(
      keys.filter((key) => key.startsWith("./providers/") || key === "./testing/provider-conformance"),
      [],
    );
    assert.equal(existsSync("src/providers"), false);
    assert.equal(existsSync("src/oauth-device-code.ts"), false);
  });

  it("no_workspace_imports_prism_providers", () => {
    // Plan 152 Task 8 deleted the @arnilo/prism-providers workspace. Live code must not import the
    // retired package, and only frozen records (history/evidence/baselines/changelogs/migration
    // pages) or explicit negative guards may even name it. `rg` equivalent:
    //   rg -n "@arnilo/prism-providers" src packages scripts examples docs templates
    const frozenDir = /^(docs\/history|docs\/_evidence|scripts\/compat-baseline|dist|node_modules)(\/|$)/;
    const allowedFiles = new Set([
      "scripts/budgets.json", // historical export-budget reason text
      "scripts/coverage-thresholds.json", // frozen coverage note text
      "scripts/deprecations-0.13.json", // the live 0.13 registry deprecation ledger: it must name every retired package and its successor
      "scripts/phase24-truth.test.mjs", // asserts the umbrella key is absent
      "scripts/phase29-freeze-manifest.json", // freeze history
      "scripts/phase29-freeze.test.mjs",
      "scripts/phase54-package-map.mjs", // 0.3-era consolidation baseline map
      "scripts/phase54-package-map.test.mjs",
      "scripts/retired-providers.test.mjs",
      "src/__tests__/provider-kit.test.ts", // this scan's own allow-list and guards
      "src/__tests__/core-boundaries.test.ts", // asserts src/ never imports the family
      "src/__tests__/docs.test.ts", // retired-name sweep + umbrella guard
      "src/__tests__/host-composition-compat.test.ts", // asserts the packed consumer has no family
      "src/__tests__/install-smoke.test.ts",
      "src/__tests__/packaging.test.ts",
      "src/__tests__/release.test.ts",
    ]);
    const allowedDocs = new Set([
      "docs/provider-caching.md", // `formerly` alias annotations
      "docs/thinking-and-reasoning.md", // `formerly` alias annotations
      "docs/providers/decisions.md", // records the retired /decisions subpath
      // The host-builder skill's 0.12 → 0.13 replacement table, the skill-side twin of docs/migrate-to-0.13.md.
      "packages/hosts/host-builder/skills/prism-host-builder/references/upgrading.md",
    ]);
    const allowed = (path: string): boolean =>
      allowedFiles.has(path) || allowedDocs.has(path) || /\/CHANGELOG\.md$/.test(path) || /^docs\/migrate-to-[^/]+\.md$/.test(path);

    const hits: string[] = [];
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mjs|cjs|js|json|md)$/.test(entry.name)) continue;
        const text = readFileSync(path, "utf8");
        if (!text.includes("@arnilo/prism-providers")) continue;
        if (frozenDir.test(path)) continue;
        hits.push(path);
        if (/\bfrom\s+"@arnilo\/prism-providers|import\(\s*"@arnilo\/prism-providers|require\(\s*"@arnilo\/prism-providers/.test(text)) {
          importers.push(path);
        }
      }
    };
    for (const root of ["src", "packages", "apps", "scripts", "examples", "docs", "templates"]) {
      if (existsSync(root)) walk(root);
    }

    assert.deepEqual(importers, [], `no live file may import the retired @arnilo/prism-providers package: ${importers.join(", ")}`);
    assert.deepEqual(
      hits.filter((path) => !allowed(path)),
      [],
      "only frozen records and explicit negative guards may name the retired @arnilo/prism-providers package",
    );
    // Positive controls: the retired workspace and its manifest are gone, and the scan really looked.
    assert.equal(existsSync("packages/prism-providers"), false, "the retired workspace must stay deleted");
    assert.ok(hits.length > 0, "the scan must find the frozen-record mentions it allows");
  });
});

const KEY = "sk-conformance-canary-0123456789";
const request: ProviderRequest = {
  model: { provider: "openai-compatible", model: "m", baseUrl: "http://fake.test/v1", credential: "env:KEY" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};
const sse = (chunks: readonly unknown[]) =>
  new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

function fake() {
  let captured: Headers | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    captured = new Headers(init.headers);
    return sse([
      { choices: [{ delta: { content: "hello" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "lookup", arguments: '{"q":1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ]);
  }) as unknown as typeof fetch;
  return { fetchImpl, captured: () => captured };
}

const options = (captured: () => Headers | undefined) => ({
  request,
  secrets: [KEY],
  headers: {
    owned: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    caller: { authorization: "Bearer hijack", "x-trace": "1" },
    captured,
  },
  expect: { text: "hello", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
  toolCalls: [{ index: 0, id: "c1", name: "lookup", arguments: { q: 1 } }],
});

describe("providerConformance", () => {
  it("builtin_openai_compatible_passes_provider_conformance", async () => {
    const { fetchImpl, captured } = fake();
    await kit.providerConformance(
      () => createBuiltinProvider({ fetch: fetchImpl, resolveCredential: () => ({ type: "api_key", value: KEY }) }),
      options(captured),
    );
  });

  it("provider_conformance_requires_a_secret_to_check", async () => {
    const { fetchImpl, captured } = fake();
    await assert.rejects(
      kit.providerConformance(
        () => createBuiltinProvider({ fetch: fetchImpl, resolveCredential: () => ({ type: "api_key", value: KEY }) }),
        {
          ...options(captured),
          secrets: [],
        },
      ),
      /at least one secret/,
    );
  });

  it("provider_conformance_fails_a_provider_that_lets_the_caller_override_auth", async () => {
    const { fetchImpl, captured } = fake();
    const leaky = (): ModelProvider =>
      kit.createOpenAICompatibleProvider({
        baseUrl: "http://fake.test",
        fetch: fetchImpl,
        extraHeaders: (r) => ({ ...(r.options?.headers as Record<string, string>) }),
        apiKey: async () => KEY,
        authStyle: "none",
      });
    await assert.rejects(kit.providerConformance(leaky, options(captured)), /overrode provider-owned|got/);
  });

  it("provider_conformance_fails_a_provider_that_leaks_its_secret", async () => {
    const seen = new Headers({ authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-trace": "1" });
    const factory = (): ModelProvider => ({
      id: "leaky",
      async *generate() {
        yield { type: "content_delta", text: `echo ${KEY}` } as never;
        yield { type: "done" } as never;
      },
    });
    await assert.rejects(
      kit.providerConformance(factory, { ...options(() => seen), expect: undefined, toolCalls: undefined }),
      /Secret leaked/,
    );
  });

  it("provider_conformance_rejects_malformed_auth_and_models", async () => {
    await assert.rejects(
      kit.assertModelsListValid({
        id: "p",
        generate: async function* () {},
        models: async () => [
          { provider: "p", model: "a" },
          { provider: "p", model: "a" },
        ],
      } as ModelProvider),
      /twice/,
    );
    assert.throws(
      () =>
        kit.assertAuthDescriptorsWellFormed({
          id: "p",
          generate: async function* () {},
          auth: [{ kind: "api-key", ref: "literal-secret" }],
        } as ModelProvider),
      /env: or keyring:/,
    );
    assert.throws(
      () =>
        kit.assertAuthDescriptorsWellFormed({
          id: "p",
          generate: async function* () {},
          auth: [{ kind: "oauth", id: "x" } as never],
        } as ModelProvider),
      /login/,
    );
    kit.assertAuthDescriptorsWellFormed({
      id: "p",
      generate: async function* () {},
      auth: [{ kind: "api-key", ref: "env:K" }],
    } as ModelProvider);
  });
});
