import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// @ts-expect-error stdlib-only release CLI intentionally ships as directly runnable JavaScript.
import { assertGitState, loadRelease, publishArgs, runRelease, validateRelease } from "../../scripts/release.mjs";

const VERSION = "0.0.7";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prism-release-"));
  const manifests = [
    ["", { name: "@arnilo/prism", version: VERSION }],
    ["packages/addon", { name: "@arnilo/prism-addon", version: VERSION, peerDependencies: { "@arnilo/prism": VERSION } }],
    ["packages/meta", { name: "@arnilo/prism-meta", version: VERSION, dependencies: { "@arnilo/prism-addon": VERSION } }],
  ] as const;
  const packages: Record<string, unknown> = {};
  for (const [path, manifest] of manifests) {
    mkdirSync(join(root, path), { recursive: true });
    const complete = { ...manifest, publishConfig: { access: "public" } };
    writeFileSync(join(root, path, "package.json"), `${JSON.stringify(complete, null, 2)}\n`);
    packages[path] = complete;
  }
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3, packages }, null, 2)}\n`);
  writeFileSync(join(root, ".gitignore"), "release-artifacts/\n");
  return root;
}

const missing = async () => new Response("not found", { status: 404 });

function published(manifest: unknown) {
  return async () => Response.json(manifest);
}

test("release graph validates exact versions and uses deterministic dependency order", () => {
  const root = fixture();
  const release = loadRelease(root);
  assert.deepEqual(validateRelease(release, VERSION).map((pkg: { manifest: { name: string } }) => pkg.manifest.name), [
    "@arnilo/prism",
    "@arnilo/prism-addon",
    "@arnilo/prism-meta",
  ]);

  const addonPath = join(root, "packages/addon/package.json");
  const addon = JSON.parse(readFileSync(addonPath, "utf8"));
  addon.peerDependencies["@arnilo/prism"] = "^0.0.7";
  writeFileSync(addonPath, JSON.stringify(addon));
  assert.throws(() => validateRelease(loadRelease(root), VERSION), /expected 0\.0\.7/);
});

test("registry preflight rejects collisions and resume skips only matching manifests", async () => {
  const root = fixture();
  const release = loadRelease(root);
  const core = release.byName.get("@arnilo/prism")!.manifest;
  await assert.rejects(
    runRelease({ release, version: VERSION, mode: "check", fetcher: published(core) }),
    /already exists/,
  );

  const called: string[] = [];
  const fetcher = async (url: string) => url.includes(`${encodeURIComponent("@arnilo/prism")}/${VERSION}`)
    ? Response.json(core)
    : new Response("missing", { status: 404 });
  const report = await runRelease({
    release,
    version: VERSION,
    mode: "publish",
    resume: true,
    dryRun: true,
    fetcher,
    publisher: async (pkg: { manifest: { name: string } }) => { called.push(pkg.manifest.name); },
  });
  assert.deepEqual(report.packages.map((entry: { status: string }) => entry.status), ["skipped", "dry-run", "dry-run"]);
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
      publisher: async () => { if (++calls === 2) throw new Error("simulated interruption"); },
    }),
    /simulated interruption/,
  );
  assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")).packages.map((entry: { status: string }) => entry.status), ["published", "failed"]);
  assert.deepEqual(publishArgs(release.packages[0], true), [
    "publish", ".", "--access", "public", "--provenance", "--tag", "latest", "--dry-run",
  ]);
  assert.equal(publishArgs(release.packages[1])[1], "./packages/addon");
});

test("release requires clean tagged git state", () => {
  const root = fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "Release Test");
  git("add", ".");
  git("commit", "-m", "fixture");
  assert.throws(() => assertGitState(root, VERSION), /tag v0\.0\.7/);
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

test("release workflow publishes with provenance from the exact v* tag", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
  assert.match(workflow, /tags:\s*\["v\*"\]/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm run release:publish -- --version "\$\{GITHUB_REF_NAME#v\}"/);
  assert.match(workflow, /--resume/);
  const releaseCli = readFileSync(join(process.cwd(), "scripts/release.mjs"), "utf8");
  assert.match(releaseCli, /--provenance/);
  assert.match(releaseCli, /HEAD must have tag v\$\{version\}/);
});
