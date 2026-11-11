import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertGitState,
  bumpPackage,
  cmpSemver,
  detectBaselineTag,
  incrementVersion,
  loadRelease,
  publishArgs,
  runRelease,
  satisfiesInternalRange,
  validateRelease,
  validateReleaseIndependent,
  // @ts-expect-error stdlib-only release CLI intentionally ships as directly runnable JavaScript.
} from "../../scripts/release.mjs";

const VERSION = "0.0.13";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prism-release-"));
  const manifests = [
    ["", { name: "@arnilo/prism", version: VERSION }],
    ["packages/addon", { name: "@arnilo/prism-addon", version: VERSION, peerDependencies: { "@arnilo/prism": VERSION } }],
    ["packages/meta", { name: "@arnilo/prism-meta", version: VERSION, dependencies: { "@arnilo/prism-addon": VERSION } }],
  ] as const;
  const workspaces: Record<string, { name: string; version?: string }> = {};
  for (const [path, manifest] of manifests) {
    mkdirSync(join(root, path), { recursive: true });
    const complete = { ...manifest, publishConfig: { access: "public" } };
    writeFileSync(join(root, path, "package.json"), `${JSON.stringify(complete, null, 2)}\n`);
    const key = path === "" ? "" : path;
    workspaces[key] = { name: complete.name, ...(path === "" ? {} : { version: complete.version }) };
  }
  // Real bun.lock is JSONC-shaped (trailing commas) and its root entry has no version.
  const lockEntries = Object.entries(workspaces).map(([key, entry]) => `    ${JSON.stringify(key)}: ${JSON.stringify(entry)},`);
  writeFileSync(join(root, "bun.lock"), `{\n  "lockfileVersion": 2,\n  "workspaces": {\n${lockEntries.join("\n")}\n  },\n}\n`);
  writeFileSync(join(root, ".gitignore"), "release-artifacts/\n");
  return root;
}

const missing = async () => new Response("not found", { status: 404 });

test("0.3.0 release graph is independent, publishable, and documented", () => {
  const release = loadRelease(process.cwd());
  // 50 = root + 49 workspace packages, including channels, prism-hooks, agent-sdk,
  // the twenty-one standalone provider packages under packages/providers/, the keyring package
  // under packages/credentials/ (plan 152 Tasks 3-7; the retired @arnilo/prism-providers umbrella
  // workspace was deleted in Task 8), the store packages under packages/stores/ (plan 153
  // Tasks 3-4: JSONL, codecs, SQLite), the coding, web, browser, OpenAPI, and computer-use
  // packages under packages/tools/ (plan 154 Task 3; plan 155 Tasks 2-4), the compaction,
  // observational-memory, shared memory-core, RAG, fabric, and wiki packages nested under
  // packages/memory/ (plan 157 Tasks 3-4; plan 158 Tasks 2-5), and the approval, guardrail-packs,
  // governance, context-files, and context-engineering packages under packages/policy/ and
  // packages/context/ (plan 154 Tasks 6-7; plan 158 Task 7; plan 159 Tasks 5-6; plan 160 Tasks 2-4),
  // and the ACP host library (plan 161 Task 2), plus `@arnilo/prism-hosts/driver-process` (plans 166–167) and
  // `@arnilo/prism-extensions/workflows` (plan 168 Task 2), which landed after this count was written.
  // Plan 174 Task 6 retires the core family package, so the graph is 63 packages. Plan 174
  // Task 7 retires the three 0.12 workspaces (coding-tools, agent-sdk, acp-agent), so 60.
  // Plan 182 Task 2 retires the 17 provider packages, so 43. Plan 196 adds `provider-liquid`, plan
  // 203 `provider-openrouter`, and plan 204 `provider-openai-codex`, so 46 — and the graph already loaded
  // 46 workspaces at HEAD while this line still said 43, so one earlier addition had gone uncounted.
  // Plan 204 Task 8 re-anchors the check to the loaded graph (47 = root + 46 workspaces) instead of
  // guessing which plan owned that one; from here it catches any further drift.
  // Plan 213 Task 2 adds @arnilo/prism-ai/kilo (49), plan 214 Task 2 adds
  // @arnilo/prism-ai/litellm (50), and plan 206 Task 2 adds
  // @arnilo/prism-ai/ollama-cloud (51).
  assert.equal(release.packages.length, 7);
  assert.equal(new Set(release.packages.map((pkg: { manifest: { name: string } }) => pkg.manifest.name)).size, 7);
  assert.doesNotThrow(() =>
    validateReleaseIndependent(release, {
      baseline: "HEAD",
      gitDiff: () => false,
      baselineVersion: (_root: string, _baseline: string, pkgPath: string) =>
        release.packages.find((p: { path: string; manifest: { version: string } }) => p.path === pkgPath)?.manifest.version,
    }),
  );
  for (const pkg of release.packages) {
    const changelog = readFileSync(join(process.cwd(), pkg.path, "CHANGELOG.md"), "utf8");
    if (pkg.manifest.name === "@arnilo/prism-hosts/channels") {
      assert.ok(changelog.includes("## [Unreleased] (plan 079 Task 4)"), "channels package missing extraction changelog");
    } else if ((changelog.match(/^## \[[^\]]+\]/m)?.[0] ?? "") === "## [Unreleased]") {
      // Packages added after the 0.1.0 anchor (driver-process, remote, headless, research) carry an
      // Unreleased entry until their first cut.
      assert.ok(changelog.includes("## [Unreleased]"), `${pkg.manifest.name} missing its initial unreleased entry`);
    } else {
      assert.ok(changelog.includes("## [0.1.0] - 2026-08-09"), `${pkg.manifest.name} missing 0.1.0 changelog`);
    }
  }
  const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
  assert.ok(changelog.includes("## [0.2.0] - 2026-08-13"), "root changelog missing 0.2.0 entry");
  assert.ok(changelog.includes("## [0.1.7] - 2026-08-12"), "root changelog missing 0.1.7 entry");
  // Plan 182 Task 2: 17 provider packages retired; 4 supported providers remain.
  assert.ok(
    existsSync(join(process.cwd(), "packages/providers/hyper/src/index.ts")),
    "hyper adapter must exist as a standalone provider package",
  );
  const docs = readFileSync(join(process.cwd(), "docs/history/release-handoffs.md"), "utf8");
  assert.ok(docs.includes("### 0.1.2 publish handoff (plan 014 Task 6)"));
  assert.ok(docs.includes("49 publishable manifests") || docs.includes("**49** manifests"));
});

function published(manifest: unknown) {
  return async () => Response.json(manifest);
}

test("release graph validates exact versions and uses deterministic dependency order", () => {
  const root = fixture();
  const release = loadRelease(root);
  assert.deepEqual(
    validateRelease(release, VERSION).map((pkg: { manifest: { name: string } }) => pkg.manifest.name),
    ["@arnilo/prism", "@arnilo/prism-addon", "@arnilo/prism-meta"],
  );

  const addonPath = join(root, "packages/addon/package.json");
  const addon = JSON.parse(readFileSync(addonPath, "utf8"));
  addon.peerDependencies["@arnilo/prism"] = "^0.0.9";
  writeFileSync(addonPath, JSON.stringify(addon));
  assert.throws(() => validateRelease(loadRelease(root), VERSION), /expected 0\.0\.13/);
});

test("registry preflight rejects collisions and resume skips only matching manifests", async () => {
  const root = fixture();
  const release = loadRelease(root);
  const core = release.byName.get("@arnilo/prism")!.manifest;
  await assert.rejects(runRelease({ release, version: VERSION, mode: "check", fetcher: published(core) }), /already exists/);

  const called: string[] = [];
  const fetcher = async (url: string) =>
    url.includes(`${encodeURIComponent("@arnilo/prism")}/${VERSION}`) ? Response.json(core) : new Response("missing", { status: 404 });
  const report = await runRelease({
    release,
    version: VERSION,
    mode: "publish",
    resume: true,
    dryRun: true,
    fetcher,
    publisher: async (pkg: { manifest: { name: string } }) => {
      called.push(pkg.manifest.name);
    },
  });
  assert.deepEqual(
    report.packages.map((entry: { status: string }) => entry.status),
    ["skipped", "dry-run", "dry-run"],
  );
  assert.deepEqual(called, ["@arnilo/prism-addon", "@arnilo/prism-meta"]);

  const incompatible = { ...core, dependencies: { "@arnilo/prism-addon": "0.0.3" } };
  await assert.rejects(
    runRelease({ release, version: VERSION, mode: "publish", resume: true, fetcher: published(incompatible), publisher: async () => {} }),
    /already exists/,
  );
});

test("partial publish writes resumable report and publish arguments are explicit", async () => {
  const root = fixture();
  const release = loadRelease(root);
  const reportPath = join(root, "artifacts/report.json");
  let calls = 0;
  await assert.rejects(
    runRelease({
      release,
      version: VERSION,
      mode: "publish",
      fetcher: missing,
      reportPath,
      publisher: async () => {
        if (++calls === 2) throw new Error("simulated interruption");
      },
    }),
    /simulated interruption/,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(reportPath, "utf8")).packages.map((entry: { status: string }) => entry.status),
    ["published", "failed"],
  );
  assert.deepEqual(publishArgs(release.packages[0], VERSION, { dryRun: true }), [
    "publish",
    join("release-artifacts", "arnilo-prism-0.0.13.tgz"),
    "--access",
    "public",
    "--tag",
    "latest",
    "--dry-run",
  ]);
  assert.ok(!publishArgs(release.packages[0], VERSION).includes("--provenance"), "npm provenance is retired");
  assert.equal(publishArgs(release.packages[1], VERSION)[1], join("release-artifacts", "arnilo-prism-addon-0.0.13.tgz"));
});

test("release requires clean tagged git state", () => {
  const root = fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "Release Test");
  git("add", ".");
  git("commit", "-m", "fixture");
  assert.throws(() => assertGitState(root, VERSION), /tag v0\.0\.13/);
  git("tag", `v${VERSION}`);
  assert.doesNotThrow(() => assertGitState(root, VERSION));
  mkdirSync(join(root, "release-artifacts"));
  writeFileSync(join(root, "release-artifacts/report.json"), "{}\n");
  assert.doesNotThrow(() => assertGitState(root, VERSION));
  writeFileSync(join(root, "dirty"), "x");
  assert.throws(() => assertGitState(root, VERSION), /clean git tree/);
});

test("registry failures stay attributable without leaking environment tokens", async () => {
  const token = "npm_secret_canary";
  process.env.NODE_AUTH_TOKEN = token;
  const release = loadRelease(fixture());
  await assert.rejects(
    runRelease({ release, version: VERSION, mode: "check", fetcher: async () => new Response("no", { status: 500 }) }),
    (error: Error) => error.message.includes("HTTP 500") && !error.message.includes(token),
  );
  delete process.env.NODE_AUTH_TOKEN;
});

test("release workflow publishes the lockstep cut once and package tags independently", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
  // Plan 215 Task 36 replaced the cumulative version list with two patterns (`v*` lockstep,
  // `@arnilo/<name>@<version>` independent), so no workflow edit is needed at the next cut —
  // the assertion that used to derive the current tag from the root manifest now forbids
  // any version literal in the trigger. Plan 215 Task 38 owns the publish path below.
  const tags = /tags:\s*\[([^\]]*)\]/
    .exec(workflow)?.[1]
    ?.split(",")
    .map((tag) => tag.trim());
  assert.ok(tags, "release workflow must declare a tag list");
  assert.deepEqual(tags, ['"v*"', '"@arnilo/*@*"'], `the tag trigger is pattern-only: ${tags.join(", ")}`);
  assert.ok(!tags.some((tag) => /\d+\.\d+\.\d+/.test(tag)), "no trigger names a version");
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /environment:\s*npm-publish/);
  assert.match(workflow, /release:publish -- --lockstep --version /);
  assert.match(workflow, /release:publish -- --resume/);
  assert.doesNotMatch(workflow, /publish[\s\S]*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  const releaseCli = readFileSync(join(process.cwd(), "scripts/release.mjs"), "utf8");
  assert.match(releaseCli, /spawnSync\("npm", publishArgs/);
  assert.match(releaseCli, /HEAD must have tag v\$\{version\}/);
});

test("detectBaselineTag skips current release tags and resolves prior baseline", () => {
  const root = fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "Release Test");
  git("add", ".");
  git("commit", "-m", "v0.2.9 release");
  git("tag", "v0.2.9");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@arnilo/prism", version: "0.3.0" }));
  git("add", "package.json");
  git("commit", "-m", "0.3.0 cut");
  git("tag", "v0.3.0");

  // When validating 0.3.0 release, baseline must be v0.2.9 (prior tag), not v0.3.0
  const baseline = detectBaselineTag(root, undefined, "0.3.0");
  assert.equal(baseline, "v0.2.9");
});

// --- plan 215 Task 2: the experimental release line ---

const PRE = "0.13.0-experimental.0";

/** Kernel + a stable addon on 0.13.0, and two experimental packages on the prerelease that pin each other exactly. */
function experimentalFixture(experimental: unknown = ["@arnilo/prism-memory-core", "@arnilo/prism-memory-system"]) {
  const root = mkdtempSync(join(tmpdir(), "prism-release-exp-"));
  const kernelPeer = ">=0.13.0 <1.0.0";
  const manifests: Array<[string, Record<string, unknown>]> = [
    ["", { name: "@arnilo/prism", version: "0.13.0" }],
    ["packages/addon", { name: "@arnilo/prism-addon", version: "0.13.0", peerDependencies: { "@arnilo/prism": kernelPeer } }],
    ["packages/memory/core", { name: "@arnilo/prism-memory-core", version: PRE, peerDependencies: { "@arnilo/prism": kernelPeer } }],
    [
      "packages/memory/system",
      {
        name: "@arnilo/prism-memory-system",
        version: PRE,
        dependencies: { "@arnilo/prism-memory-core": PRE },
        peerDependencies: { "@arnilo/prism": kernelPeer, "@arnilo/prism-addon": "^0.13.0" },
        devDependencies: { "@arnilo/prism-memory-core": "file:../core" },
      },
    ],
  ];
  const lock: string[] = [];
  for (const [path, manifest] of manifests) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), `${JSON.stringify({ ...manifest, publishConfig: { access: "public" } }, null, 2)}\n`);
    lock.push(
      `    ${JSON.stringify(path)}: ${JSON.stringify({ name: manifest.name, ...(path === "" ? {} : { version: manifest.version }) })},`,
    );
  }
  writeFileSync(join(root, "bun.lock"), `{\n  "lockfileVersion": 2,\n  "workspaces": {\n${lock.join("\n")}\n  },\n}\n`);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "independent-packages.json"), `${JSON.stringify({ packages: [], experimental })}\n`);
  return root;
}

const unchanged = { baseline: "HEAD", gitDiff: () => false, baselineVersion: () => undefined };

test("semver_prerelease_sorts_below_release", () => {
  assert.ok(cmpSemver("0.13.0-experimental.0", "0.13.0") < 0);
  assert.ok(cmpSemver("0.13.0", "0.13.0-experimental.9") > 0);
  assert.ok(cmpSemver("0.13.0-experimental.0", "0.12.9") > 0, "the core still orders first");
  assert.equal(cmpSemver("0.13.0-experimental.0", "0.13.0-experimental.0"), 0);
});

test("semver_prerelease_identifiers_compare", () => {
  // semver 2.0.0 section 11: numeric identifiers compare as numbers, alphanumeric ones lexically,
  // numeric sorts below alphanumeric, and a shorter list sorts below a longer one with the same prefix.
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(cmpSemver(ordered[i], ordered[i + 1]) < 0, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.ok(cmpSemver(ordered[i + 1], ordered[i]) > 0, `${ordered[i + 1]} > ${ordered[i]}`);
  }
  assert.ok(cmpSemver("0.13.0-experimental.10", "0.13.0-experimental.9") > 0, "10 > 9 numerically, not lexically");
});

test("internal_range_into_prerelease_is_exact_only", () => {
  assert.equal(satisfiesInternalRange(PRE, PRE), true);
  assert.equal(satisfiesInternalRange("^0.13.0-experimental.0", "0.13.0-experimental.1"), false, "a caret never reaches a prerelease");
  assert.equal(satisfiesInternalRange("~0.13.0-experimental.0", PRE), false);
  assert.equal(satisfiesInternalRange("^0.13.0", PRE), false);
  assert.equal(satisfiesInternalRange("0.13.0-experimental.0", "0.13.0-experimental.1"), false, "an exact pin to another prerelease");
  // release targets are classified exactly as before
  assert.equal(satisfiesInternalRange("^0.13.0", "0.13.4"), true);
  assert.equal(satisfiesInternalRange("^0.13.1", "0.13.0"), false);
  assert.equal(satisfiesInternalRange("^0.12.0", "0.13.0"), false);
});

test("increment_prerelease", () => {
  assert.equal(incrementVersion("0.13.0-experimental.0", "prerelease"), "0.13.0-experimental.1");
  assert.equal(incrementVersion("0.13.0-experimental.9", "prerelease"), "0.13.0-experimental.10");
  assert.equal(incrementVersion("0.13.0-experimental", "prerelease"), "0.13.0-experimental.0");
  assert.throws(() => incrementVersion("0.13.0", "prerelease"), /needs a prerelease version/);
  assert.equal(incrementVersion("0.13.0", "patch"), "0.13.1", "release bumps are unchanged");
  assert.throws(() => incrementVersion("0.13.0", "weekly"), /patch\|minor\|major\|prerelease/);
});

test("bump_prerelease_rewrites_dependent_pins", () => {
  const root = experimentalFixture();
  const release = loadRelease(root);
  const result = bumpPackage(release, "@arnilo/prism-memory-core", "prerelease");
  assert.deepEqual([result.from, result.to, result.repinned], [PRE, "0.13.0-experimental.1", ["@arnilo/prism-memory-system"]]);
  const read = (path: string) => JSON.parse(readFileSync(join(root, path, "package.json"), "utf8"));
  assert.equal(read("packages/memory/core").version, "0.13.0-experimental.1");
  const system = read("packages/memory/system");
  assert.equal(system.dependencies["@arnilo/prism-memory-core"], "0.13.0-experimental.1");
  assert.equal(system.devDependencies["@arnilo/prism-memory-core"], "file:../core", "dev file: links are left alone");
  assert.equal(system.peerDependencies["@arnilo/prism-addon"], "^0.13.0", "a loose range into a stable package is left alone");
  // the bumped graph still validates once the lockfile follows (the CLI regenerates it)
  assert.throws(
    () => validateReleaseIndependent(loadRelease(root), unchanged),
    /bun\.lock packages\/memory\/core version is 0\.13\.0-experimental\.0/,
  );
  // an experimental package bumps with prerelease only, and a stable package never takes it
  assert.throws(() => bumpPackage(release, "@arnilo/prism-memory-system", "patch"), /is experimental: bump it with prerelease/);
  assert.throws(() => bumpPackage(release, "@arnilo/prism-addon", "prerelease"), /needs a prerelease version/);
});

test("publish_args_use_experimental_tag", () => {
  const release = loadRelease(experimentalFixture());
  const [kernel, addon, core] = ["@arnilo/prism", "@arnilo/prism-addon", "@arnilo/prism-memory-core"].map((name) =>
    release.byName.get(name),
  );
  const tag = (args: string[]) => args[args.indexOf("--tag") + 1];
  assert.equal(tag(publishArgs(core, PRE)), "experimental");
  assert.equal(tag(publishArgs(addon, "0.13.0")), "latest");
  assert.equal(tag(publishArgs(kernel, "0.13.0")), "latest");
  for (const args of [publishArgs(core, PRE), publishArgs(core, PRE, { dryRun: true })]) {
    assert.ok(!args.includes("latest"), "an experimental package never publishes under latest");
  }
  assert.deepEqual(publishArgs(core, PRE, { dryRun: true }), [
    "publish",
    join("release-artifacts", "arnilo-prism-memory-core-0.13.0-experimental.0.tgz"),
    "--access",
    "public",
    "--tag",
    "experimental",
    "--dry-run",
  ]);
  // OIDC provenance is a CI-only flag: a local bootstrap publish has no id-token to exchange.
  assert.deepEqual(publishArgs(core, PRE, { provenance: true }), [
    "publish",
    join("release-artifacts", "arnilo-prism-memory-core-0.13.0-experimental.0.tgz"),
    "--access",
    "public",
    "--tag",
    "experimental",
    "--provenance",
  ]);
  assert.ok(!publishArgs(core, PRE, { provenance: true, dryRun: true }).includes("--provenance"), "a dry run never asks for provenance");
});

test("publish_args_reject_mislabeled_versions", async () => {
  const release = loadRelease(experimentalFixture());
  const addon = release.byName.get("@arnilo/prism-addon");
  const core = release.byName.get("@arnilo/prism-memory-core");
  assert.throws(() => publishArgs(core, "0.13.0"), /experimental_version_mismatch: @arnilo\/prism-memory-core@0\.13\.0/);
  assert.throws(() => publishArgs(addon, PRE), /stable_version_prerelease: @arnilo\/prism-addon@0\.13\.0-experimental\.0/);
  // the check runs before any registry call, in check mode too
  const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("not found", { status: 404 });
  };
  addon.manifest.version = PRE;
  await assert.rejects(
    runRelease({ release, independent: true, independentOptions: { ...unchanged, gitDiff: () => true }, mode: "check", fetcher }),
    /stable_version_prerelease/,
  );
  assert.deepEqual(calls, [], "no registry request before the line check");
});

test("lockstep_cut_excludes_experimental", () => {
  const root = experimentalFixture();
  const release = loadRelease(root);
  const order = validateRelease(release, "0.13.0").map((pkg: { manifest: { name: string } }) => pkg.manifest.name);
  assert.deepEqual(order, ["@arnilo/prism", "@arnilo/prism-addon"], "the memory packages are left out of the publish order");
  assert.equal(release.byName.get("@arnilo/prism-memory-core").experimental, true);
  assert.equal(release.byName.get("@arnilo/prism-addon").experimental, false);
  // a stable pin into the experimental line is not a lockstep claim, and the cut still ignores the prerelease versions
  const lockstepOnly = experimentalFixture([]);
  assert.throws(
    () => validateRelease(loadRelease(lockstepOnly), "0.13.0"),
    /@arnilo\/prism-memory-core version is 0\.13\.0-experimental\.0, expected 0\.13\.0/,
  );
});

test("independent_validate_accepts_exact_prerelease_pins", () => {
  const root = experimentalFixture();
  assert.doesNotThrow(() => validateReleaseIndependent(loadRelease(root), unchanged));
  // a caret into the prerelease fails closed
  const manifestPath = join(root, "packages/memory/system/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies["@arnilo/prism-memory-core"] = "^0.13.0-experimental.0";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => validateReleaseIndependent(loadRelease(root), unchanged),
    /@arnilo\/prism-memory-system dependencies\.@arnilo\/prism-memory-core range \^0\.13\.0-experimental\.0 does not satisfy @arnilo\/prism-memory-core@0\.13\.0-experimental\.0/,
  );
});

test("experimental_list_rejects_unknown_workspace", () => {
  const root = experimentalFixture(["@arnilo/prism-memory-core", "@arnilo/prism-memory-ghost"]);
  assert.throws(() => loadRelease(root), /unknown experimental package @arnilo\/prism-memory-ghost/);
});

test("release_tag_is_never_latest_for_an_experimental_package_in_the_real_graph", () => {
  const release = loadRelease(process.cwd());
  const experimental = release.packages.filter((pkg: { experimental: boolean }) => pkg.experimental);
  assert.deepEqual(experimental.map((pkg: { manifest: { name: string } }) => pkg.manifest.name).sort(), [
    "@arnilo/prism-knowledge",
    "@arnilo/prism-memory-system",
  ]);
  for (const pkg of experimental) {
    const args = publishArgs(pkg, pkg.manifest.version);
    assert.equal(args[args.indexOf("--tag") + 1], "experimental");
  }
  const lockstep = validateRelease(release, release.byName.get("@arnilo/prism").manifest.version);
  assert.ok(
    lockstep.every((pkg: { experimental: boolean }) => !pkg.experimental),
    "a lockstep cut publishes none of them",
  );
});
