#!/usr/bin/env node
/**
 * Regenerates the credential-matrix table embedded in docs/live-testing.md.
 *
 * Single source of truth: scripts/live-matrix.json. The embedded block sits
 * between HTML markers so prose edits never collide with regeneration:
 *
 *   <!-- generated:live-matrix:start -->
 *   ...table...
 *   <!-- generated:live-matrix:end -->
 *
 * Usage:
 *   node scripts/generate-live-docs.mjs --write   regenerate docs/live-testing.md
 *   node scripts/generate-live-docs.mjs --check   exit 1 if the doc is stale (CI)
 *   (import)  liveMatrixTable(suites) -> markdown lines
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/live-testing.md";
const START = "<!-- generated:live-matrix:start -->";
const END = "<!-- generated:live-matrix:end -->";

export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, "scripts/live-matrix.json"), "utf8"));
}

function envVars(suite) {
  const all = suite.requires ?? [];
  const any = suite.requiresAny ?? [];
  if (all.length === 0 && any.length === 0) return "— (hermetic leg)";
  const parts = [];
  if (all.length > 0) parts.push(`\`${all.join("` + `")}\``);
  if (any.length > 0) parts.push(`any of: \`${any.join("` / `")}\``);
  const optional = suite.optional ?? [];
  if (optional.length > 0) parts.push(`optional: \`${optional.join("` `")}\``);
  return parts.join("; ");
}

function modelVars(suite) {
  return (suite.model ?? []).map((m) => (m.wired ? `\`${m.env}\` (default \`${m.default}\`)` : `\`${m.env}\` (not wired yet)`));
}

export function liveMatrixTable(manifest) {
  const lines = ["| suite | status | required credentials | model override | least-privilege scope | cost |", "|---|---|---|---|---|---|"];
  for (const suite of manifest.suites) {
    const model = modelVars(suite);
    lines.push(
      `| \`${suite.id}\` | ${suite.status} | ${envVars(suite)} | ${model.length > 0 ? model.join(", ") : "—"} | ${suite.scope} | ${suite.cost} |`,
    );
  }
  return lines;
}

export function regeneratedDoc(docText, manifest) {
  const table = liveMatrixTable(manifest).join("\n");
  const start = docText.indexOf(START);
  const end = docText.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${DOC}: missing ${START} / ${END} markers`);
  }
  return `${docText.slice(0, start + START.length)}\n${table}\n${docText.slice(end)}`;
}

function main() {
  const manifest = loadManifest();
  const path = join(ROOT, DOC);
  const doc = readFileSync(path, "utf8");
  const expected = regeneratedDoc(doc, manifest);
  if (process.argv.includes("--write")) {
    writeFileSync(path, expected);
    console.log(`LIVE-DOCS: regenerated ${DOC}`);
    return;
  }
  if (process.argv.includes("--check")) {
    if (doc !== expected) {
      console.error(`LIVE-DOCS: ${DOC} is stale. Run: node scripts/generate-live-docs.mjs --write`);
      process.exit(1);
    }
    console.log(`LIVE-DOCS: ${DOC} in sync with scripts/live-matrix.json`);
  }
}

if (process.argv[1]?.endsWith("generate-live-docs.mjs")) main();
