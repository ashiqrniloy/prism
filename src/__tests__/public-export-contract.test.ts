import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: SDK surface freeze. The root `@arnilo/prism` barrel is the public
// API; these two snapshots pin every value and type export of `src/index.ts` so
// any add/remove is a deliberate test update, not silent drift. Value exports
// are additionally resolved against the built `dist/index.js` runtime module
// and type exports against `dist/index.d.ts`, so a build that drops/renames an
// export fails the gate. Update both arrays together when the surface changes.
const FROZEN_VALUE_EXPORTS: readonly string[] = [
  "PermissionDeniedError", "SESSION_APPEND_CONFLICT_CODE", "SESSION_ENTRY_KINDS",
  "SESSION_ENTRY_SCHEMA_VERSION", "SessionAppendConflictError", "TrustDeniedError",
  "applyCacheControl", "assembleProviderInput", "assertJsonObject", "assertPermission",
  "assertTrusted", "authMethodKey", "cacheHitRate", "cacheSavings", "cacheUsageReport",
  "checkPermission", "composeSystemPrompt", "createAgent", "createAgentSession",
  "createChainedCredentialResolver", "createChainedSettingsProvider",
  "createContributionRegistries", "createContributionRegistry",
  "createDefaultCompactionStrategy", "createDefaultInputBuilder",
  "createDefaultPromptBuilder", "createDefaultRetryPolicy",
  "createEnvCredentialResolver", "createExplicitCredentialResolver",
  "createExtensionEventBus", "createExtensionKernel", "createMemoryCredentialStore",
  "createMemorySessionStore", "createMiddlewareRegistry", "createMockProvider",
  "createModelRegistry", "createProviderRegistry", "createProviderRequestPolicyChain",
  "createProviderResolver", "createSecretRedactor", "createSessionCachePolicy",
  "createSessionEntry", "createSkillRegistry", "createStaticPermissionPolicy",
  "createStaticSettingsProvider", "createStaticTrustPolicy", "createToolRegistry",
  "definePrismManifest", "defineProviderPackage", "denialToErrorInfo", "description",
  "dispatchToolCall", "errorToErrorInfo", "filterTools", "generateValidateReviseLoop",
  "getSessionBranchEntries", "isAgentLoopOptions", "isCompactionEntryData",
  "isJsonObject", "isSessionAppendConflict", "isSessionEntryKind", "isTransientErrorInfo",
  "isTrusted", "listSessionBranches", "loadConfigLayers", "loadJsonResource",
  "loadManifestResource", "loadTextResource", "mapCacheRetention", "mergeConfigLayers",
  "mergeProviderRequestOptions", "mergeSystemPromptConfig", "name", "parseAgentFile",
  "parsePrismManifest", "parseSkillFile", "providerContentDelta", "providerDone",
  "providerError", "providerTextDelta", "providerThinkingDelta", "providerToolCall",
  "providerToolCallDelta", "providerUsage", "rebuildSessionContext", "redactAgentEvent",
  "redactMessage", "redactProviderRequest", "redactRunLedgerRecord", "redactSecrets",
  "redactSessionEntry", "refreshOAuthCredential", "registerDiscoveredContributions",
  "renderPromptTemplate", "resolveActiveSkills", "resolveAgentDefinition",
  "resolveContextProviders", "resolveCredentialValue", "resolveInstructionInjectors",
  "resolveLoop", "runInstructionInjectors", "sanitizeCacheKey", "singleShotLoop",
  "systemPromptContributionKey", "toolCallContent", "version", "waitForRetry",
];

const FROZEN_TYPE_EXPORTS: readonly string[] = [
  "AgentInput", "ApplyCacheControlOptions", "AssembleProviderInputOptions",
  "CacheControlValue", "CacheControlledContentBlock", "CacheControlledMessage",
  "CacheUsageReport", "ComposeSystemPromptOptions", "ConfigLayer", "ConfigLoadContext",
  "ConfigProvider", "ContributionRegistries", "ContributionRegistriesOptions",
  "ContributionRegistry", "ContributionRegistryOptions", "CreateSessionEntryOptions",
  "CredentialRecord", "CredentialValueSource", "DefaultCompactionStrategyOptions",
  "DefaultInputBuildContext", "DefaultInputBuilder", "DefaultPromptBuilder",
  "DefaultRetryPolicyOptions", "DispatchToolCallOptions", "DuplicateRegistrationOptions",
  "DuplicateRegistrationPolicy", "ExtensionErrorPolicy", "ExtensionEventBus",
  "ExtensionEventHandler", "ExtensionKernel", "ExtensionKernelOptions",
  "InputAttachment", "ManifestContributionDeclaration", "ManifestContributionKind",
  "ManifestResourceDeclaration", "MemoryCredentialStore", "Middleware",
  "MiddlewareHookName", "MiddlewareNext", "MiddlewareRegistry",
  "MiddlewareRegistryOptions", "MockProviderOptions", "ModelRegistry",
  "ModelRegistryOptions", "PermissionDecision", "PermissionPolicy",
  "PermissionRequest", "PrismManifest", "PromptInstruction", "PromptTemplateOptions",
  "ProviderRegistry", "ProviderRegistryOptions", "ProviderResolver",
  "ResolveActiveSkillsOptions", "ResolveContextOptions", "ResolveInstructionInjectorsOptions",
  "SecretRedactor", "SessionBranch", "SessionBranchOptions", "SessionCachePolicyOptions",
  "SessionContextSnapshot", "SkillRegistryOptions", "ToolFilter", "ToolFilterInput",
  "ToolRegistryOptions", "ToolValidator", "TrustDecision", "TrustPolicy", "TrustRequest",
];

// Parse `src/index.ts` into { value, type } export identifier sets. Mirrors the
// extraction used to derive FROZEN_*_EXPORTS so the snapshot stays self-checking.
function extractIndexExports(src: string): { value: Set<string>; type: Set<string> } {
  const value = new Set<string>();
  const type = new Set<string>();
  for (const m of src.matchAll(/export\s+type\s+\{([^}]*)\}\s+from/g)) {
    for (const p of m[1].split(",")) {
      const id = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (id) type.add(id);
    }
  }
  for (const m of src.matchAll(/export\s+\{([^}]*)\}/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      const isType = /^type\s+/.test(part);
      const id = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!id) continue;
      (isType ? type : value).add(id);
    }
  }
  for (const m of src.matchAll(/export\s+(function|const|class)\s+([A-Za-z0-9_]+)/g)) value.add(m[2]);
  for (const m of src.matchAll(/export\s+(interface|type)\s+([A-Za-z0-9_]+)/g)) type.add(m[2]);
  return { value, type };
}

// ponytail: data-driven contract; one entry per published package (shared shape
// with packaging.test.ts / install-smoke.test.ts). Adding a package is one line.
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
];

type Manifest = {
  exports?: Record<string, Record<string, string> | string>;
  main?: string;
  types?: string;
  bin?: string | Record<string, string>;
};

function readPkg(dir: string): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

// Collect every public surface target a package.json can point a consumer at:
// exports.* (types + default), main, types, and (core) bin. Each entry is the
// raw manifest path (e.g. "./dist/index.js").
function collectTargets(pkg: { dir: string; isCore?: boolean }): Map<string, string> {
  const manifest = readPkg(pkg.dir);
  const out = new Map<string, string>(); // label -> target path
  const exports = manifest.exports ?? {};
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target === "string") {
      out.set(`exports["${subpath}"]`, target);
      continue;
    }
    for (const field of ["types", "default"] as const) {
      if (target[field]) out.set(`exports["${subpath}"].${field}`, target[field]!);
    }
  }
  if (manifest.main) out.set("main", manifest.main);
  if (manifest.types) out.set("types", manifest.types);
  if (pkg.isCore && manifest.bin) {
    const bin = manifest.bin;
    if (typeof bin === "string") {
      out.set("bin", bin);
    } else {
      for (const [name, path] of Object.entries(bin)) out.set(`bin["${name}"]`, path);
    }
  }
  return out;
}

function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

describe("public-export contract (build-time, pre-pack)", () => {
  it("root export surface is frozen (no silent add/remove)", async () => {
    const src = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
    const { value, type } = extractIndexExports(src);
    assert.deepEqual(
      [...value].sort(),
      [...FROZEN_VALUE_EXPORTS].sort(),
      "src/index.ts value exports drifted from the frozen SDK surface; update FROZEN_VALUE_EXPORTS deliberately",
    );
    assert.deepEqual(
      [...type].sort(),
      [...FROZEN_TYPE_EXPORTS].sort(),
      "src/index.ts type exports drifted from the frozen SDK surface; update FROZEN_TYPE_EXPORTS deliberately",
    );
  });

  it("every frozen value export resolves at runtime in the built module", async () => {
    const built = (await import("../index.js")) as Record<string, unknown>;
    const missing = FROZEN_VALUE_EXPORTS.filter((name) => built[name] === undefined);
    assert.deepEqual(missing, [], `built dist/index.js is missing value exports: ${missing.join(", ")}`);
  });

  it("every frozen type export appears in the built type declarations", () => {
    const dts = readFileSync(join(repoRoot, "dist/index.d.ts"), "utf8");
    const missing = FROZEN_TYPE_EXPORTS.filter((name) => !new RegExp(`\\b${name}\\b`).test(dts));
    assert.deepEqual(missing, [], `built dist/index.d.ts is missing type exports: ${missing.join(", ")}`);
  });

  it("phase39_public_protocol_exports_and_types_do_not_drift", async () => {
    const prism = await import("../index.js") as Record<string, unknown>;
    assert.equal(typeof prism.providerToolCallDelta, "function");
    assert.ok(readFileSync(join(repoRoot, "src/contracts.ts"), "utf8").includes("export interface ToolCallDeltaContent"));
    assert.ok(readFileSync(join(repoRoot, "src/index.ts"), "utf8").includes("export type * from \"./contracts.js\""));
    assert.deepEqual(readPkg(".").exports?.["./testing/provider-conformance"], {
      types: "./dist/testing/provider-conformance.d.ts",
      default: "./dist/testing/provider-conformance.js",
    });

    const memoryRuntimeDts = readFileSync(join(repoRoot, "packages/compaction-observational-memory/dist/runtime.d.ts"), "utf8");
    assert.ok(memoryRuntimeDts.includes("appendEntry"), "observational-memory runtime d.ts missing appendEntry");
    assert.equal(memoryRuntimeDts.includes("readonly store"), false, "observational-memory runtime d.ts still exposes store option");
  });

  for (const pkg of packages) {
    describe(pkg.name, () => {
      const targets = collectTargets(pkg);
      const pkgRoot = join(repoRoot, pkg.dir);
      const distDir = join(pkgRoot, "dist");

      it("dist/ exists (run `npm run build` before this test)", () => {
        // ponytail: fail closed with a directing message instead of a cryptic ENOENT
        assert.ok(existsSync(distDir), `${pkg.name}: dist/ missing — run \`npm run build\` first`);
      });

      for (const [label, target] of targets) {
        it(`${label} (${target}) resolves to a built file under dist/`, () => {
          const rel = norm(target);
          // boundary: public targets must live under dist/ — no src/ or examples/ leak
          // via a manifest misconfiguration.
          assert.ok(
            rel.startsWith("dist/") && !rel.includes("/src/") && !rel.startsWith("examples/"),
            `${pkg.name} ${label} -> ${rel} must target dist/ (not src/ or examples/)`,
          );
          assert.ok(
            existsSync(join(pkgRoot, rel)),
            `${pkg.name} ${label} -> ${rel} missing from disk (built output not found; run \`npm run build\`)`,
          );
        });

        // types/d.ts pair check: every .js target should have a sibling .d.ts so
        // TypeScript consumers resolve types at the published specifier.
        const rel = norm(target);
        if (rel.endsWith(".js")) {
          const dts = rel.slice(0, -".js".length) + ".d.ts";
          it(`${label} has a sibling .d.ts (${dts})`, () => {
            assert.ok(
              existsSync(join(pkgRoot, dts)),
              `${pkg.name} ${label} -> ${rel} has no sibling ${dts} (types missing for the published specifier)`,
            );
          });
        }
      }

      // negative guard: NO target of any kind escapes dist/. Catches a future
      // manifest edit that points main/exports/bin at source or examples.
      it("no public target escapes dist/", () => {
        for (const [label, target] of targets) {
          const rel = norm(target);
          if (isAbsolute(target) || !rel.startsWith("dist/")) {
            assert.fail(`${pkg.name} ${label} -> ${target} escapes dist/`);
          }
          const inside = relative(join(pkgRoot, "dist"), join(pkgRoot, rel));
          assert.ok(
            !inside.startsWith(".."),
            `${pkg.name} ${label} -> ${rel} resolves outside dist/ (-> ${inside})`,
          );
        }
      });
    });
  }
});
