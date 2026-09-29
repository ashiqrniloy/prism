#!/usr/bin/env bun
// Prism Code install smoke (plan 140 Task 2): install the app the way users do — a global
// `bun add -g` into a throwaway BUN_INSTALL — and exercise the installed `prism-code` bin, not the
// working tree.
//
//   bun scripts/prism-code-install-smoke.mjs                        # npm pack the first-party closure, install the tarballs
//   bun scripts/prism-code-install-smoke.mjs --packs <dir>          # reuse tarballs already packed into <dir> (release.yml)
//   bun scripts/prism-code-install-smoke.mjs --registry             # install @arnilo/prism-code@<manifest version> from npm
//   bun scripts/prism-code-install-smoke.mjs --registry --version 0.4.0
//
// Checks: `--version` (plus the cold-start budget), a headless `-p hi --mode json` run on the
// shipped mock provider, `doctor --json` (fully green with `--model mock/default`; without a model
// only the `model` check may fail), a TUI launch/exit over the plan 139 PTY harness, and a single
// `@arnilo/prism` in the installed tree (the `instanceof` split that `file:../..` dev links hide).
// Registry mode also runs `bunx @arnilo/prism-code@<version> --version`.
//
// Hermetic: temporary BUN_INSTALL, HOME, PRISM_HOME, and working directory; the child PATH holds
// only the Bun executable's directory and the system bins (never the repo); the credential store is
// seeded to `memory` and the child env has no D-Bus session address (no host Secret Service); the
// mock provider needs no key or network. Only
// the install itself touches the network (third-party dependencies, or npm in registry mode).
// Exit code 1 on any failed check.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckRecorder, createPrismCodeSandbox, runPrismCodeChecks } from "./lib/prism-code-checks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "@arnilo/prism-code";
/** Cold `prism-code --version` budget on the installed package (plan 140 Task 2). */
const VERSION_BUDGET_MS = 300;

const argv = process.argv.slice(2);
function option(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
const registry = argv.includes("--registry");
const packsDir = option("--packs");
const keep = argv.includes("--keep");
if (registry && packsDir) throw new Error("--registry and --packs are mutually exclusive");

/**
 * npm replication lag: right after `npm publish` the packument can list the version while its
 * manifest is not resolvable yet ("No version matching X found (but package exists)"). The
 * post-publish smoke is the acceptance gate for the release, so it waits for the registry instead
 * of racing it.
 */
async function waitForRegistryVersion(pkg, wanted, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = spawnSync("npm", ["view", `${pkg}@${wanted}`, "version"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim() === wanted) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${pkg}@${wanted} is not installable from the registry after ${Math.round(timeoutMs / 1000)}s: ${(probe.stderr || probe.stdout).trim()}`,
      );
    }
    console.log(`prism-code install smoke: waiting for ${pkg}@${wanted} to become installable…`);
    await Bun.sleep(10_000);
  }
}

/** Workspace manifests keyed by package name. */
function workspaceManifests() {
  const manifests = new Map();
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  manifests.set(rootManifest.name, { dir: root, manifest: rootManifest });
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    const file = join(root, "packages", entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifests.set(manifest.name, { dir: join(root, "packages", entry.name), manifest });
  }
  return manifests;
}

/** First-party packages the app needs at runtime: dependencies plus required (non-optional) peers, transitively. */
function firstPartyClosure(manifests) {
  const closure = new Set();
  const queue = [APP];
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const workspace = manifests.get(name);
    if (!workspace) throw new Error(`${name} is not a workspace package`);
    closure.add(name);
    const { dependencies = {}, peerDependencies = {}, peerDependenciesMeta = {} } = workspace.manifest;
    const requiredPeers = Object.keys(peerDependencies).filter((peer) => peerDependenciesMeta[peer]?.optional !== true);
    for (const dep of [...Object.keys(dependencies), ...requiredPeers]) {
      if (manifests.has(dep) && !closure.has(dep)) queue.push(dep);
    }
  }
  return [...closure].sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", ...options });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

/** `npm pack` file name for a scoped package: `@arnilo/prism-code@0.4.0` → `arnilo-prism-code-0.4.0.tgz`. */
function tarballName(name, version) {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

const manifests = workspaceManifests();
const version = option("--version") ?? manifests.get(APP).manifest.version;
// Child PATH: the Bun executable's directory and the system bins only (never the repo).
const sandbox = createPrismCodeSandbox("prism-code-install-smoke", {
  pathDirs: [dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"],
});
const workdir = sandbox.root;
const bunInstall = join(workdir, "bun");
const globalDir = join(bunInstall, "install", "global");
mkdirSync(globalDir, { recursive: true });
// Install-time env: only the install locations move; the host HOME keeps Bun's download cache
// warm. The global bin/dir are pinned too: images such as oven/bun set BUN_INSTALL_BIN, which
// would otherwise put the bin outside the throwaway BUN_INSTALL.
const installEnv = {
  ...process.env,
  BUN_INSTALL: bunInstall,
  BUN_INSTALL_BIN: join(bunInstall, "bin"),
  BUN_INSTALL_GLOBAL_DIR: globalDir,
};

const { check, checks, failed } = createCheckRecorder();

let failure;
try {
  // ── install ───────────────────────────────────────────────────────────────
  const installStart = performance.now();
  if (registry) {
    console.log(`prism-code install smoke: registry — ${APP}@${version}`);
    await waitForRegistryVersion(APP, version);
    run(process.execPath, ["add", "-g", `${APP}@${version}`], { cwd: workdir, env: installEnv });
  } else {
    const closure = firstPartyClosure(manifests);
    const packs = packsDir ? resolve(packsDir) : join(workdir, "packs");
    if (!packsDir) {
      mkdirSync(packs);
      for (const name of closure) {
        const workspace = name === "@arnilo/prism" ? [] : ["--workspace", name];
        // release-host registry toolchain — runner images ship Node; contributors never invoke npm
        run("npm", ["pack", "--silent", "--pack-destination", packs, ...workspace], { cwd: root, quiet: true });
      }
    }
    // Every first-party range resolves to its tarball (the SDK is not on npm before the first
    // publish, and the libraries must be the packed bytes, not the registry's previous release).
    const overrides = {};
    for (const name of closure) {
      const file = join(packs, tarballName(name, manifests.get(name).manifest.version));
      if (!existsSync(file)) throw new Error(`missing tarball for ${name}: ${file}`);
      overrides[name] = `file:${file}`;
    }
    writeFileSync(join(globalDir, "package.json"), `${JSON.stringify({ dependencies: {}, overrides }, null, 2)}\n`);
    console.log(`prism-code install smoke: local tarballs (${closure.length} packages) from ${packs}`);
    run(process.execPath, ["add", "-g", overrides[APP].slice("file:".length)], { cwd: workdir, env: installEnv });
  }
  const installMs = performance.now() - installStart;
  const bin = join(bunInstall, "bin", "prism-code");
  check("bun add -g puts prism-code on BUN_INSTALL/bin", existsSync(bin), `${(installMs / 1000).toFixed(1)} s install`);
  if (!existsSync(bin)) throw new Error(`no installed bin at ${bin}`);

  await runPrismCodeChecks({ bin, version, channel: "bun", sandbox, check, versionBudgetMs: VERSION_BUDGET_MS });

  // ── single @arnilo/prism in the installed tree ────────────────────────────
  const coreCopies = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === "node_modules") {
        const core = join(full, "@arnilo", "prism", "package.json");
        if (existsSync(core)) coreCopies.push(core);
      }
      walk(full);
    }
  };
  walk(globalDir);
  check("exactly one @arnilo/prism on disk", coreCopies.length === 1, coreCopies.map((file) => file.slice(globalDir.length)).join(", "));
  const listing = run(process.execPath, ["pm", "ls", "--all"], { cwd: globalDir, env: installEnv, quiet: true });
  const listed = new Set(listing.split("\n").flatMap((line) => line.match(/@arnilo\/prism@\S+/g) ?? []));
  check("bun pm ls shows a single @arnilo/prism", listed.size === 1, [...listed].join(", "));

  // ── bunx (registry only) ──────────────────────────────────────────────────
  if (registry) {
    const bunx = spawnSync(process.execPath, ["x", `${APP}@${version}`, "--version"], {
      cwd: sandbox.cwd,
      env: { ...installEnv, ...sandbox.env, BUN_INSTALL: bunInstall },
      encoding: "utf8",
      timeout: 120_000,
    });
    check(`bunx ${APP}@${version} --version`, bunx.status === 0 && bunx.stdout.trim() === `${version} (bun)`, bunx.stdout.trim());
  }
} catch (error) {
  failure = error;
} finally {
  if (keep) console.log(`kept ${workdir}`);
  else sandbox.cleanup();
}

if (failure) {
  console.error(`prism-code install smoke: ERROR ${failure instanceof Error ? failure.message : String(failure)}`);
  process.exit(1);
}
if (failed().length > 0) {
  console.error(`prism-code install smoke: FAIL (${failed().length}/${checks.length} checks)`);
  process.exit(1);
}
console.log(`prism-code install smoke: PASS (${checks.length} checks, ${registry ? `registry @${version}` : "local tarballs"})`);
