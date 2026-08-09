/**
 * Packed-install consumer helper for the Phase 12 e2e journey fixtures
 * (plan 012 Task 3). Packs the requested first-party packages from the
 * current workspace tree and installs the tarballs into a fresh consumer
 * project, so the journey script runs against the exact packed manifest
 * graph — never workspace source paths.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** Pack `packages` ({dir, name}) and install into a fresh consumer dir. */
export function createPackedConsumer(packages) {
  const staging = mkdtempSync(join(tmpdir(), "prism-e2e-pack-"));
  const consumer = mkdtempSync(join(tmpdir(), "prism-e2e-consumer-"));
  for (const pkg of packages) {
    const r = spawnSync("npm", ["pack", "--pack-destination", staging], {
      cwd: join(repoRoot, pkg.dir),
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}:\n${r.stdout}\n${r.stderr}`);
  }
  const tarballs = readdirSync(staging)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(staging, f));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "prism-e2e-consumer", type: "module" }, null, 2));
  let install = spawnSync("npm", ["install", ...tarballs, "--offline", "--no-audit", "--no-fund", "--no-update-notifier"], {
    cwd: consumer,
    encoding: "utf8",
  });
  if (install.status !== 0) {
    // Cold cache fallback: same tarballs, registry allowed for externals only.
    install = spawnSync("npm", ["install", ...tarballs, "--no-audit", "--no-fund", "--no-update-notifier"], {
      cwd: consumer,
      encoding: "utf8",
    });
  }
  const cleanup = () => {
    rmSync(staging, { recursive: true, force: true });
    rmSync(consumer, { recursive: true, force: true });
  };
  return {
    consumer,
    tarballNames: tarballs.map((f) => f.split("/").pop()),
    installStatus: install.status,
    installOut: install.stdout + install.stderr,
    cleanup,
  };
}

/** Installed version of a first-party package inside the consumer. */
export function installedVersion(consumer, name) {
  return JSON.parse(readFileSync(join(consumer, "node_modules", name, "package.json"), "utf8")).version;
}

/** Probe: resolved specifier path inside the consumer (must not be the repo). */
export function resolveFromConsumer(consumer, specifier) {
  const r = spawnSync(process.execPath, ["-e", `import('${specifier}').then(() => console.log(import.meta.resolve('${specifier}')))`], {
    cwd: consumer,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`resolve probe failed for ${specifier}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}
