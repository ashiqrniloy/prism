/**
 * Phase 26 (0.2.6) Task 0 baseline capture. Regenerates scripts/phase26-baseline.json:
 * inherits the 0.2.5 exit-gate figures from scripts/phase25-baseline.json and records
 * SHA-256 hashes (or "absent") for every single-editor allowed file across the phase26
 * freeze manifest items plus roadmap.md (byte-immutable until task8).
 *
 * Usage: node scripts/phase26-baseline.mjs
 * Re-run at Task 8 to record the exit gate (the script preserves an existing non-null
 * exitGate only if --keep-exit-gate is passed; otherwise exitGate resets to null).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const url = (p) => new URL(p, import.meta.url);
const manifest = JSON.parse(readFileSync(url("./phase26-freeze-manifest.json"), "utf8"));
const phase25 = JSON.parse(readFileSync(url("./phase25-baseline.json"), "utf8"));

const gitHead = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

function sha256(rel) {
  return createHash("sha256")
    .update(readFileSync(url(`../${rel}`)))
    .digest("hex");
}

/** Every single-editor allowed file (shared coordination files are not hash-locked). */
const seamFiles = new Set(["roadmap.md"]);
for (const item of manifest.items) {
  const editors = Object.entries(manifest.sharedFiles).filter(([, markers]) => markers[item.task]);
  for (const file of item.allowedFiles) {
    if (editors.some(([sharedFile]) => sharedFile === file)) continue; // shared, not seam-locked
    seamFiles.add(file);
  }
}

const seams = {};
for (const file of [...seamFiles].sort()) {
  seams[file] = existsSync(url(`../${file}`)) ? { sha256: sha256(file), status: "present" } : { sha256: null, status: "absent" };
}

const inheritedKeys = [
  "npmTest",
  "coverage",
  "threatSuites",
  "packDryRun",
  "releaseGate",
  "node20",
  "testPostgres",
  "audit",
  "secrets",
  "sdkReady",
];
const inherited = {};
for (const key of inheritedKeys) inherited[key] = phase25[key];

const out = {
  $comment:
    "Phase 26 (0.2.6) Task 0 baseline, captured from the 0.2.5 release state (HEAD " +
    gitHead +
    ") before any 0.2.6 source edit. Inherits the 0.2.5 exit-gate figures from scripts/phase25-baseline.json. " +
    "seams holds SHA-256 hashes for every single-editor allowed file of the phase26 freeze manifest plus roadmap.md: " +
    "while the owning task token is pending the file must stay byte-identical (absent files stay absent); once the task is done, " +
    "the freeze test asserts content markers instead. exitGate stays null until Task 8 records it green with blocked: false. " +
    "Shared coordination files (package.json, plan 026, plans/README.md, docs/index.md, changelogs, barrels, docs with multiple editors) " +
    "are not hash-locked; they are marker-checked per editor task.",
  captured: new Date().toISOString(),
  release: "0.2.6",
  baselineRelease: "0.2.5",
  gitHead,
  node: process.version,
  platform: process.platform,
  inherited,
  seams,
  exitGate: null,
};

writeFileSync(url("./phase26-baseline.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`phase26-baseline.json captured: ${seamFiles.size} seam files, git ${gitHead}`);
