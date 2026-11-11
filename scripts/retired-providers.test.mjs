// scripts/retired-providers.test.mjs
// Plan 182 Task 2: Assert no live references to the 17 retired providers exist outside the allowlist.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const RETIRED_PROVIDERS = [
  "ai-sdk",
  "alibaba",
  "anthropic",
  "azure",
  "bedrock",
  "clinepass",
  "deepseek",
  "google",
  "kimi",
  "neuralwatt",
  "ollama",
  "openai",
  "vertex",
  "xai",
  "zai",
];

const ALLOWLIST = new Set([
  "CHANGELOG.md",
  "scripts/deprecations-0.13.json",
  "scripts/phase14-baseline.json",
  "scripts/phase29-freeze-manifest.json",
  "scripts/phase54-package-map.mjs",
  "scripts/phase54-package-map.test.mjs",
  "scripts/retired-providers.test.mjs",
]);

test("no_live_tree_reference_to_retired_provider", () => {
  // `(?:-[a-z0-9]+)*` closes the alternation so a live package whose name starts with a retired one
  // (`@arnilo/prism-ai/openai-codex`, plan 204 Task 5) is not read as the retired provider.
  const pattern = `prism-provider-(${RETIRED_PROVIDERS.join("|")})(?![a-z0-9-])`;
  const searchDirs = [
    "src",
    "packages",
    "apps",
    "scripts",
    "examples",
    "docs",
    "templates",
    ".github",
    "README.md",
    "PRODUCT.md",
    "roadmap.md",
  ];
  const globExclusions = ["-g", "!dist", "-g", "!docs/history", "-g", "!docs/_evidence", "-g", "!plans"];

  const result = spawnSync("rg", ["-l", pattern, ...searchDirs, ...globExclusions], {
    cwd: ROOT,
    encoding: "utf8",
  });

  const matchedFiles = (result.stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const disallowed = matchedFiles.filter((file) => !ALLOWLIST.has(file));
  assert.deepEqual(disallowed, [], `Found live tree references to retired providers in non-allowlisted files: ${disallowed.join(", ")}`);
});

test("ollama_deprecation_points_to_cloud_successor", () => {
  const deprecations = JSON.parse(readFileSync(join(ROOT, "scripts/deprecations-0.13.json"), "utf8"));
  const ollama = deprecations.names.find((entry) => entry.name === "@arnilo/prism-provider-ollama");
  assert.ok(ollama);
  assert.ok(ollama.message.includes("For Ollama Cloud use @arnilo/prism-ai/ollama-cloud"));
  assert.equal(ollama.successor, "@arnilo/prism/provider-kit");
});

test("deprecation_messages_name_supported_providers", () => {
  const deprecations = JSON.parse(readFileSync(join(ROOT, "scripts/deprecations-0.13.json"), "utf8"));

  const retiredPkgNames = new Set(RETIRED_PROVIDERS.map((p) => `@arnilo/prism-provider-${p}`));

  // Plan 203 Task 2: derive the shipped set from the tree, so a new adapter cannot
  // drift out of the umbrella message the way `liquid` did after plan 196.
  // "Shipped" means it has a manifest: plan 204 Task 4 adds the sign-in client before the shell, and
  // an unpublished directory must not be promised as a replacement package.
  const bundle = JSON.parse(readFileSync(join(ROOT, "scripts/bundles.json"), "utf8")).bundles.find(
    (bundle) => bundle.dir === "packages/providers",
  );
  const providersUmbrella = deprecations.names.find((d) => d.name === "@arnilo/prism-providers");
  assert.ok(providersUmbrella.successor.includes(`${bundle.name}/<provider>`));
  assert.ok(providersUmbrella.successor.includes("@arnilo/prism/provider-kit"), "@arnilo/prism-providers successor must name provider-kit");

  for (const entry of deprecations.names) {
    if (retiredPkgNames.has(entry.name)) {
      assert.ok(
        entry.message.includes("https://github.com/ashiqrniloy/prism") || entry.message.includes("docs/"),
        `Deprecation message for ${entry.name} must include a docs link`,
      );
      assert.equal(entry.successor, "@arnilo/prism/provider-kit", `Successor for ${entry.name} must be @arnilo/prism/provider-kit`);
      for (const retired of RETIRED_PROVIDERS) {
        assert.ok(
          !entry.successor.includes(`prism-provider-${retired}`),
          `Successor for ${entry.name} must not name retired provider ${retired}`,
        );
      }
    }
  }

  // Plan 204 Task 8: the retired `openai` name points at the Sign in with ChatGPT
  // package in its message. The successor stays provider-kit: the retired list must
  // never name another provider as a replacement.
  const retiredOpenai = deprecations.names.find((d) => d.name === "@arnilo/prism-provider-openai");
  assert.ok(retiredOpenai, "Missing @arnilo/prism-provider-openai deprecation entry");
  assert.ok(
    retiredOpenai.message.includes("@arnilo/prism-ai/openai-codex"),
    "openai deprecation message must point ChatGPT-plan users at @arnilo/prism-ai/openai-codex",
  );
  assert.equal(
    retiredOpenai.successor,
    "@arnilo/prism/provider-kit",
    "openai successor stays provider-kit even though its message names the ChatGPT-plan package",
  );

  // Plan 224: the former npm name retires; OpenRouter ships through the bundle.
  const openrouter = deprecations.names.find((d) => d.name === "@arnilo/prism-provider-openrouter");
  assert.ok(openrouter);
  assert.equal(openrouter.range, "*");
  assert.equal(openrouter.reused, false);
  assert.equal(openrouter.successor, `${bundle.name}/openrouter`);
  assert.ok(openrouter.message.includes("docs/migrate-to-0.13.md"), "openrouter deprecation message must include a docs link");
});
