#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INTERNAL_SCOPE = "@arnilo/";
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function loadRelease(root = process.cwd()) {
  const paths = ["."];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json"))) paths.push(`packages/${entry.name}`);
    }
  }
  const packages = paths.map((path) => ({ path, manifest: JSON.parse(readFileSync(join(root, path, "package.json"), "utf8")) }));
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  return { root, packages, byName };
}

export function validateRelease(release, version) {
  const errors = [];
  for (const pkg of release.packages) {
    if (pkg.manifest.private) errors.push(`${pkg.manifest.name} is private`);
    if (pkg.manifest.version !== version) errors.push(`${pkg.manifest.name} version is ${pkg.manifest.version}, expected ${version}`);
    if (pkg.manifest.publishConfig?.access !== "public") errors.push(`${pkg.manifest.name} must set publishConfig.access to public`);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
        if (release.byName.has(name) && range !== version) errors.push(`${pkg.manifest.name} ${field}.${name} is ${range}, expected ${version}`);
      }
    }
  }

  const lock = JSON.parse(readFileSync(join(release.root, "package-lock.json"), "utf8"));
  for (const pkg of release.packages) {
    const locked = lock.packages?.[pkg.path === "." ? "" : pkg.path];
    if (!locked) errors.push(`package-lock.json missing ${pkg.path}`);
    else if (locked.version !== version) errors.push(`package-lock.json ${pkg.path} version is ${locked.version}, expected ${version}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return topologicalOrder(release);
}

export function topologicalOrder(release) {
  const remaining = new Map();
  for (const pkg of release.packages) {
    const dependencies = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(pkg.manifest[field] ?? {})) if (release.byName.has(name)) dependencies.add(name);
    }
    remaining.set(pkg.manifest.name, dependencies);
  }

  const order = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([name]) => name).sort();
    if (!ready.length) throw new Error(`internal dependency cycle: ${[...remaining.keys()].sort().join(", ")}`);
    for (const name of ready) {
      order.push(release.byName.get(name));
      remaining.delete(name);
      for (const dependencies of remaining.values()) dependencies.delete(name);
    }
  }
  return order;
}

export function assertGitState(root, version, { allowDirty = false, allowUntagged = false } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (!allowDirty && git("status", "--porcelain")) throw new Error("release requires a clean git tree");
  if (!allowUntagged) {
    const tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
    if (!tags.includes(`v${version}`)) throw new Error(`HEAD must have tag v${version}`);
  }
}

function releaseFields(manifest) {
  return Object.fromEntries(DEPENDENCY_FIELDS.map((field) => [field, Object.fromEntries(Object.entries(manifest[field] ?? {}).filter(([name]) => name.startsWith(INTERNAL_SCOPE)))]) );
}

export function samePublishedManifest(local, published) {
  return published?.name === local.name && published?.version === local.version && JSON.stringify(releaseFields(published)) === JSON.stringify(releaseFields(local));
}

export async function registryManifest(pkg, version, registry = "https://registry.npmjs.org", fetcher = fetch) {
  const response = await fetcher(`${registry.replace(/\/$/, "")}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`registry preflight failed for ${pkg}: HTTP ${response.status}`);
  return response.json();
}

function saveReport(path, report) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

export function publishArgs(pkg, dryRun = false) {
  const args = ["publish", pkg.path === "." ? "." : `./${pkg.path}`, "--access", "public", "--provenance", "--tag", "latest"];
  if (dryRun) args.push("--dry-run");
  return args;
}

export async function runRelease({ release, version, mode, resume = false, dryRun = false, registry, fetcher = fetch, reportPath, publisher }) {
  const order = validateRelease(release, version);
  const report = { version, dryRun, order: order.map((pkg) => pkg.manifest.name), packages: [] };
  const publish = publisher ?? ((pkg) => {
    const result = spawnSync("npm", publishArgs(pkg, dryRun), { cwd: release.root, encoding: "utf8", stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`npm publish failed for ${pkg.manifest.name}`);
  });

  for (const pkg of order) {
    const published = await registryManifest(pkg.manifest.name, version, registry, fetcher);
    if (published) {
      if (mode === "publish" && resume && samePublishedManifest(pkg.manifest, published)) {
        report.packages.push({ name: pkg.manifest.name, status: "skipped" });
        saveReport(reportPath, report);
        console.log(`skipped ${pkg.manifest.name}@${version} (already published)`);
        continue;
      }
      throw new Error(`${pkg.manifest.name}@${version} already exists on the registry`);
    }
    if (mode === "check") {
      report.packages.push({ name: pkg.manifest.name, status: "available" });
    } else {
      try {
        await publish(pkg);
        report.packages.push({ name: pkg.manifest.name, status: dryRun ? "dry-run" : "published" });
      } catch (error) {
        report.packages.push({ name: pkg.manifest.name, status: "failed" });
        saveReport(reportPath, report);
        throw error;
      }
    }
    saveReport(reportPath, report);
  }
  return report;
}

function parseArgs(argv) {
  const options = { mode: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resume") options.resume = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--allow-untagged") options.allowUntagged = true;
    else if (["--version", "--root", "--registry", "--report"].includes(arg)) options[arg.slice(2).replace("report", "reportPath")] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["check", "publish"].includes(options.mode)) throw new Error("usage: release.mjs <check|publish> --version <version> [--resume] [--dry-run]");
  if (!options.version) throw new Error("--version is required");
  if (options.mode === "publish" && !options.dryRun && (options.allowDirty || options.allowUntagged)) {
    throw new Error("real publication cannot bypass clean tagged git checks");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root ?? process.cwd());
  const release = loadRelease(root);
  assertGitState(root, options.version, options);
  const report = await runRelease({ ...options, release, reportPath: options.reportPath ? resolve(root, options.reportPath) : undefined });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
