import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const REASON = /^(env-gated|network|interactive|long-running|known-broken:\S+)$/;
const SPAWN = /spawnSync\(\s*process\.execPath\s*,\s*\[\s*["'](examples\/[^"']+\.ts)["']/g;
const TIMEOUT_MS = 60_000;

export function childEnv(base) {
  return { ...base, NODE_ENV: "test" };
}

export function assertReason(reason) {
  if (!REASON.test(reason)) throw new Error(`invalid skip reason: ${reason}`);
}

export function assertSkipStillNeeded(file, status) {
  if (status === 0) throw new Error(`stale skip ${file} exited 0`);
}

export function envGatedShouldRun(envName, env) {
  return typeof envName === "string" && envName !== "" && env[envName] !== undefined && env[envName] !== "";
}

function exampleFiles() {
  return readdirSync(join(ROOT, "examples"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `examples/${name}`)
    .sort();
}

function demos() {
  const docs = readFileSync(join(ROOT, "src/__tests__/docs.test.ts"), "utf8");
  const start = docs.indexOf("const demos = [");
  if (start < 0) throw new Error("docs.test.ts demos array missing");
  const end = docs.indexOf("];", start);
  return [...docs.slice(start, end).matchAll(/"(examples\/[^"]+\.ts)"/g)].map((match) => match[1]);
}

function dedicatedSpawns() {
  const found = new Set();
  for (const dir of ["src/__tests__", "scripts"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!/\.test\.(ts|mjs)$/.test(name) || name === "examples-execution.test.mjs") continue;
      const text = readFileSync(join(ROOT, dir, name), "utf8");
      if (!text.includes("spawnSync")) continue;
      for (const match of text.matchAll(SPAWN)) found.add(match[1]);
    }
  }
  return found;
}

function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, "scripts/examples-manifest.json"), "utf8"));
}

function partition(examples, demoList, dedicated, skips) {
  const demo = new Set(demoList);
  const skip = new Set(Object.keys(skips).map((name) => `examples/${name}`));
  const overlap = [...skip].filter((file) => demo.has(file) || dedicated.has(file));
  const unknown = [...skip].filter((file) => !examples.includes(file));
  const spawned = examples.filter((file) => !demo.has(file) && !dedicated.has(file) && !skip.has(file));
  return { spawned, overlap, unknown, skip };
}

function runExample(file) {
  return spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: childEnv(process.env),
  });
}

test("skip vocabulary rejects an unknown reason and a green skip", () => {
  assert.throws(() => assertReason("because"), /invalid skip reason/);
  assert.doesNotThrow(() => assertReason("env-gated"));
  assert.doesNotThrow(() => assertReason("known-broken:placeholder-image"));
  assert.throws(() => assertSkipStillNeeded("examples/x.ts", 0), /stale skip/);
  assert.doesNotThrow(() => assertSkipStillNeeded("examples/x.ts", 1));
  assert.equal(envGatedShouldRun("DOCKER_PATH", { DOCKER_PATH: "/usr/bin/docker" }), true);
  assert.equal(envGatedShouldRun("DOCKER_PATH", {}), false);
  const added = Object.keys(childEnv({ PATH: "/usr/bin" })).filter((key) => key !== "PATH");
  assert.deepEqual(added, ["NODE_ENV"]);
});

test("every example exits 0 or is a manifest skip", () => {
  const examples = exampleFiles();
  const demoList = demos();
  const dedicated = dedicatedSpawns();
  const manifest = loadManifest();
  for (const reason of Object.values(manifest.skips)) assertReason(reason);
  const { spawned, overlap, unknown } = partition(examples, demoList, dedicated, manifest.skips);
  assert.deepEqual(overlap, [], `skip overlaps an already-executed example: ${overlap.join(", ")}`);
  assert.deepEqual(unknown, [], `skip names a missing example: ${unknown.join(", ")}`);
  assert.ok(spawned.length > 0, "expected uncovered examples to spawn");
  for (const file of spawned) assert.equal(dedicated.has(file) || demoList.includes(file), false, file);

  const started = Date.now();
  const failures = [];
  for (const file of spawned) {
    const result = runExample(file);
    if (result.status === 0) continue;
    const tail = `${result.stderr ?? result.error?.message ?? ""}`.slice(-300);
    failures.push(`${file} exited ${result.status ?? "timeout"} ${tail}`);
  }
  for (const [name, reason] of Object.entries(manifest.skips)) {
    const file = `examples/${name}`;
    if (reason === "env-gated") {
      const envName = manifest.env?.[name];
      if (!envGatedShouldRun(envName, process.env)) continue;
      const result = runExample(file);
      if (result.status !== 0) failures.push(`${file} env-gated re-run exited ${result.status}`);
      continue;
    }
    if (!reason.startsWith("known-broken") && process.env.PRISM_EXAMPLES_AUDIT_SKIPS !== "1") continue;
    if (reason === "network") continue;
    const result = runExample(file);
    if (result.status === 0) failures.push(`stale skip ${file} exited 0`);
  }
  const ms = Date.now() - started;
  console.log(`examples-execution: ${spawned.length} spawned, ${Object.keys(manifest.skips).length} skipped, ${ms}ms`);
  assert.equal(failures.length, 0, failures.join("\n"));
});
