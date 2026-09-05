// One-off Task 1 helper: diff a package's built dist surface against its checked-in baseline.
// Usage: node scripts/phase25-compat-diff.mjs [pkgPath]   (default ".")
// Stdlib-only; reuses release-gates.mjs surface extraction.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_DIR, baselineName, diffSurface, extractDeclaredSurface, parseSurface } from "./release-gates.mjs";

const root = process.cwd();
const pkgPath = process.argv[2] ?? ".";
// Resolve the manifest to get the package name for the baseline file.
const manifest = JSON.parse(readFileSync(join(root, pkgPath, "package.json"), "utf8"));
const distDir = join(root, pkgPath, "dist");
if (!existsSync(distDir)) {
  console.error(`no dist/ at ${pkgPath} — run build first`);
  process.exit(2);
}
const surface = extractDeclaredSurface(distDir);
const baselinePath = join(root, BASELINE_DIR, baselineName(manifest.name));
if (!existsSync(baselinePath)) {
  console.error(`no baseline at ${baselinePath}`);
  process.exit(2);
}
const baseline = parseSurface(readFileSync(baselinePath, "utf8"));
const diff = diffSurface(surface, baseline);
const out = [];
if (diff.removed.length) out.push(`REMOVED (${diff.removed.length}):\n  ${diff.removed.join("\n  ")}`);
if (diff.changed.length)
  out.push(
    `CHANGED (${diff.changed.length}):\n  ` +
      diff.changed.map((n) => `  ${n}\n    base: ${baseline.get(n)}\n    now:  ${surface.get(n)}`).join("\n"),
  );
if (diff.added.length) out.push(`ADDED (${diff.added.length}):\n  ${diff.added.join("\n  ")}`);
if (!out.length) {
  console.log(`${manifest.name}: zero breaking deltas (${surface.size} symbols, ${diff.added.length} added)`);
  process.exit(0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`=== ${manifest.name} (${pkgPath}) ===`);
  console.log(out.join("\n\n"));
  process.exit(diff.removed.length || diff.changed.length ? 1 : 0);
}
