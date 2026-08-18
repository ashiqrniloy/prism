#!/usr/bin/env node
// Client-neutrality guard: fails when any configured client name appears in the
// repo. Names come from PRISM_CLIENT_NAMES (comma-separated) so the list itself
// never lives in the repository. Wired into `npm run release:gate`.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOTS = ["src", "packages", "docs", "examples", "scripts", "plans", "CHANGELOG.md", "README.md", "prism-adoption-issues.md"];
const SKIP = new Set(["node_modules", "dist", ".git"]);

export function scanForNames(root, names) {
  const hits = [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  for (const entry of ROOTS) {
    const path = join(root, entry);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) walk(path);
    else files.push(path);
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lower = text.toLowerCase();
    for (const name of names) {
      let at = lower.indexOf(name);
      while (at !== -1) {
        hits.push(`${relative(root, file)}:${text.slice(0, at).split("\n").length}: ${name}`);
        at = lower.indexOf(name, at + 1);
      }
    }
  }
  return hits;
}

function selfCheck() {
  const dir = mkdtempSync(join(tmpdir(), "prism-neutrality-"));
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "// planted client-name marker\n");
    const hits = scanForNames(dir, ["client-name"]);
    if (hits.length !== 1 || !hits[0].includes("src/x.ts:1")) throw new Error(`expected 1 hit at src/x.ts:1, got ${JSON.stringify(hits)}`);
    if (scanForNames(dir, []).length !== 0) throw new Error("empty name list must not hit");
    console.log("check-client-neutrality: self-check ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-check")) selfCheck();
const root = process.argv[2] ?? process.cwd();
const names = (process.env.PRISM_CLIENT_NAMES ?? "")
  .split(",")
  .map((n) => n.trim().toLowerCase())
  .filter(Boolean);
const hits = scanForNames(root, names);
if (hits.length > 0) {
  console.error(`client-neutrality: ${hits.length} hit(s) — client names must not appear in the repo:`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
