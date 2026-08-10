/**
 * Non-blocking unused-code sweep (plan 015 Task 3).
 * Runs `tsc --noEmit --noUnusedLocals --noUnusedParameters` over the core
 * tsconfig and every workspace tsconfig, collects diagnostics, writes a
 * combined report to stdout and scripts/unused-sweep-report.txt, and ALWAYS
 * exits 0 (report-only; the build/test gates are untouched).
 * Zero dependencies; spawns the local tsc binary.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", ".bin", "tsc");

const tsconfigs = ["tsconfig.json"];
for (const pkg of readdirSync(join(root, "packages"))) {
  const cfg = join(root, "packages", pkg, "tsconfig.json");
  if (existsSync(cfg)) tsconfigs.push(join("packages", pkg, "tsconfig.json"));
}

const sections = [];
let totalErrors = 0;
for (const cfg of tsconfigs) {
  const result = spawnSync(tsc, ["--noEmit", "--noUnusedLocals", "--noUnusedParameters", "-p", cfg], {
    cwd: root,
    encoding: "utf8",
  });
  const out = (result.stdout || "").trim();
  const err = (result.stderr || "").trim();
  const diag = [out, err].filter(Boolean).join("\n");
  const count = diag ? diag.split("\n").filter((l) => l.includes("error TS")).length : 0;
  totalErrors += count;
  sections.push(`## ${cfg} (${count} unused-code diagnostic${count === 1 ? "" : "s"})${diag ? `\n${diag}` : " — clean"}`);
}

const report = [
  `# Unused-code sweep report (plan 015 Task 3, non-blocking)`,
  `Generated ${new Date().toISOString()} — ${tsconfigs.length} tsconfigs, ${totalErrors} unused-code diagnostics.`,
  `Triage: internal (unexported) dead code is removed in 0.1.3; public-but-unused exports are report-only`,
  `(removal is the 0.1.5 breaking cut); intentional shortcuts carry ponytail: comments and are kept.`,
  "",
  ...sections,
  "",
  `# Dead-export candidates (scripts/dead-exports.mjs, naive regex scan)`,
].join("\n");

const dead = spawnSync(process.execPath, [join(root, "scripts", "dead-exports.mjs")], {
  cwd: root,
  encoding: "utf8",
});
const deadOut = (dead.stdout || "").trim();
const full = `${report}\n${deadOut || "(scan produced no output)"}\n`;

writeFileSync(join(root, "scripts", "unused-sweep-report.txt"), full);
process.stdout.write(full);
// ponytail: report-only by design — exit 0 even with findings; upgrade to a
// blocking gate (or knip) if the report noise ever exceeds triage value.
process.exit(0);
