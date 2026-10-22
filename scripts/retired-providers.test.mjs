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
  "commandcode",
  "deepseek",
  "google",
  "kimi",
  "neuralwatt",
  "ollama",
  "openai",
  "openrouter",
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
  const pattern = `prism-provider-(${RETIRED_PROVIDERS.join("|")})\\b`;
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
  const globExclusions = [
    "-g",
    "!dist",
    "-g",
    "!docs/history",
    "-g",
    "!docs/_evidence",
    "-g",
    "!plans",
  ];

  const result = spawnSync(
    "rg",
    ["-l", pattern, ...searchDirs, ...globExclusions],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );

  const matchedFiles = (result.stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const disallowed = matchedFiles.filter((file) => !ALLOWLIST.has(file));
  assert.deepEqual(
    disallowed,
    [],
    `Found live tree references to retired providers in non-allowlisted files: ${disallowed.join(", ")}`,
  );
});

test("deprecation_messages_name_supported_providers", () => {
  const deprecations = JSON.parse(
    readFileSync(join(ROOT, "scripts/deprecations-0.13.json"), "utf8"),
  );

  const retiredPkgNames = new Set(
    RETIRED_PROVIDERS.map((p) => `@arnilo/prism-provider-${p}`),
  );

  const providersUmbrella = deprecations.names.find(
    (d) => d.name === "@arnilo/prism-providers",
  );
  assert.ok(providersUmbrella, "Missing @arnilo/prism-providers deprecation entry");
  assert.ok(
    providersUmbrella.successor.includes("@arnilo/prism-provider-{hyper,opencode-go,typesafe,laya}") &&
      providersUmbrella.successor.includes("@arnilo/prism/provider-kit"),
    "@arnilo/prism-providers successor must name the 4 supported packages and provider-kit",
  );

  for (const entry of deprecations.names) {
    if (retiredPkgNames.has(entry.name)) {
      assert.ok(
        entry.message.includes("https://github.com/ashiqrniloy/prism") ||
          entry.message.includes("docs/"),
        `Deprecation message for ${entry.name} must include a docs link`,
      );
      assert.equal(
        entry.successor,
        "@arnilo/prism/provider-kit",
        `Successor for ${entry.name} must be @arnilo/prism/provider-kit`,
      );
      for (const retired of RETIRED_PROVIDERS) {
        assert.ok(
          !entry.successor.includes(`prism-provider-${retired}`),
          `Successor for ${entry.name} must not name retired provider ${retired}`,
        );
      }
    }
  }
});
