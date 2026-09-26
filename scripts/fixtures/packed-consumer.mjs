/**
 * Packed-install consumer helper for the Phase 12 e2e journey fixtures
 * (plan 012 Task 3). Packs the requested first-party packages from the
 * current workspace tree and installs the tarballs into a fresh consumer
 * project, so the journey script runs against the exact packed manifest
 * graph — never workspace source paths.
 *
 * Plan 125 Task 2: the consumer simulation is Bun. Tarballs still come from
 * `npm pack` (the release-host registry toolchain); install and execution are
 * Bun only. `--offline` cannot resolve third-party ranges from a cold cache
 * (bun needs cached manifests), so the retry is `--prefer-offline`: registry
 * metadata for externals only — first-party content always comes from the
 * tarballs, which the consumer lockfile records by path.
 *
 * `overrides` pin every packed name to its tarball: internal ranges like
 * `@arnilo/prism-core@^0.12.0` are unpublished during a readiness gate, so
 * without the pin bun resolves them from the registry and the install fails.
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
    // release-host registry toolchain — runner images ship Node; contributors never invoke npm
    const r = spawnSync("npm", ["pack", "--pack-destination", staging], {
      cwd: join(repoRoot, pkg.dir),
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}:\n${r.stdout}\n${r.stderr}`);
  }
  const tarballs = readdirSync(staging)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(staging, f));
  const overrides = Object.fromEntries(
    packages.map((pkg) => {
      const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8"));
      const tgz = `${manifest.name.replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`;
      return [pkg.name, `file:${join(staging, tgz)}`];
    }),
  );
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "prism-e2e-consumer", type: "module", overrides }, null, 2));
  let install = spawnSync("bun", ["install", ...tarballs, "--offline", "--no-audit", "--no-fund", "--no-update-notifier"], {
    cwd: consumer,
    encoding: "utf8",
  });
  if (install.status !== 0) {
    // Cold cache fallback: same tarballs, registry metadata allowed for externals only.
    install = spawnSync("bun", ["install", ...tarballs, "--prefer-offline", "--no-audit", "--no-fund", "--no-update-notifier"], {
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
  const r = spawnSync("bun", ["-e", `import('${specifier}').then(() => console.log(import.meta.resolve('${specifier}')))`], {
    cwd: consumer,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`resolve probe failed for ${specifier}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}
