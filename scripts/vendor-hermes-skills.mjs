#!/usr/bin/env node
/**
 * Sparse-vendor NousResearch/hermes-agent productivity skills into @arnilo/prism-work.
 *
 * Copies only skills/productivity/{docx,xlsx,powerpoint,pdf} SKILL.md + LICENSE + scripts/.
 * Provenance: Jaccard token overlap on SKILL.md body vs anthropics/skills counterparts
 * must stay ≤ JACCARD_MAX (0.35). Anthropic proprietary headers or outbound-secret
 * instructions fail the script before any dest write.
 *
 *   node scripts/vendor-hermes-skills.mjs [--dry-run] [--sha SHA] [--source DIR] [--anthropic-source DIR] [--dest DIR]
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SHA = "bbaf7af5c83546d19f8060f4097d3bb25cd1a3c3";
export const REPO = "NousResearch/hermes-agent";
export const SKILL_NAMES = Object.freeze(["docx", "xlsx", "powerpoint", "pdf"]);
export const JACCARD_MAX = 0.35;
export const ANTHROPIC_NAMES = Object.freeze({ docx: "docx", xlsx: "xlsx", powerpoint: "pptx", pdf: "pdf" });

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_INSTRUCTION =
  /(?:export|process\.env)\s*[:=]?\s*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|API_KEY)|(?:curl|wget|fetch)\s[^\n]{0,120}(?:authorization|bearer |x-api-key)|(?:export|set)\s+(?:GOOGLE_|M365_)/i;
const ANTHROPIC_LICENSE = /copyright[^\n]{0,80}anthropic|source-available,\s*not open source|license[^\n]{0,40}proprietary/i;

export async function vendorHermesSkills(options = {}) {
  const sha = options.sha ?? DEFAULT_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error(`sha must be 40-hex, got ${sha}`);
  const destRoot = options.dest ?? join(REPO_ROOT, "packages/prism-work");
  const vendorDest = join(destRoot, "vendor/hermes-agent");
  const tmp = mkdtempSync(join(tmpdir(), "prism-hermes-vendor-"));
  try {
    const source = options.source ?? (await fetchHermesSource(sha, tmp));
    assertRequiredPaths(source);
    for (const name of SKILL_NAMES) {
      const text = readFileSync(join(source, skillRel(name), "SKILL.md"), "utf8");
      if (SECRET_INSTRUCTION.test(text)) throw new Error(`${name} SKILL.md instructs exporting or sending secrets`);
      if (ANTHROPIC_LICENSE.test(text)) throw new Error(`${name} SKILL.md has Anthropic proprietary license text`);
    }
    const anthropicRoot = options.anthropicSource ?? (await fetchAnthropicSkills(tmp));
    for (const name of SKILL_NAMES) {
      const hermes = readFileSync(join(source, skillRel(name), "SKILL.md"), "utf8");
      const anthropic = readFileSync(join(anthropicRoot, `${ANTHROPIC_NAMES[name]}.md`), "utf8");
      const score = jaccard(tokenize(skillBody(hermes)), tokenize(skillBody(anthropic)));
      if (score > JACCARD_MAX) {
        throw new Error(`${name} Jaccard ${score.toFixed(4)} exceeds ${JACCARD_MAX} vs anthropics/skills ${ANTHROPIC_NAMES[name]}`);
      }
    }
    const lock = { repo: REPO, sha, paths: SKILL_NAMES.map(skillRel), license: "MIT" };
    if (options.dryRun) return lock;
    const staging = join(tmp, "staging");
    mkdirSync(join(staging, "skills/productivity"), { recursive: true });
    writeFileSync(join(staging, "LICENSE"), readFileSync(join(source, skillRel("docx"), "LICENSE")));
    for (const name of SKILL_NAMES) {
      const from = join(source, skillRel(name));
      const to = join(staging, skillRel(name));
      mkdirSync(to, { recursive: true });
      cpSync(join(from, "SKILL.md"), join(to, "SKILL.md"));
      cpSync(join(from, "LICENSE"), join(to, "LICENSE"));
      cpSync(join(from, "scripts"), join(to, "scripts"), { recursive: true });
    }
    rmSync(vendorDest, { recursive: true, force: true });
    mkdirSync(dirname(vendorDest), { recursive: true });
    cpSync(staging, vendorDest, { recursive: true });
    writeFileSync(join(destRoot, "vendor-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    writeFileSync(join(destRoot, "THIRD_PARTY_NOTICES"), notices(sha));
    return lock;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function skillRel(name) {
  return `skills/productivity/${name}`;
}

function assertRequiredPaths(source) {
  for (const name of SKILL_NAMES) {
    const dir = join(source, skillRel(name));
    for (const part of ["SKILL.md", "LICENSE", "scripts"]) {
      if (!existsSync(join(dir, part))) throw new Error(`missing ${skillRel(name)}/${part}`);
    }
  }
}

async function fetchHermesSource(sha, tmp) {
  const archive = join(tmp, "hermes.tar.gz");
  await download(`https://codeload.github.com/${REPO}/tar.gz/${sha}`, archive);
  const extract = join(tmp, "hermes");
  mkdirSync(extract, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", archive, "-C", extract], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(tar.stderr || "tar extract failed");
  const prefix = join(extract, `hermes-agent-${sha}`);
  if (existsSync(prefix)) return prefix;
  throw new Error(`tarball missing hermes-agent-${sha}`);
}

async function fetchAnthropicSkills(tmp) {
  const dir = join(tmp, "anthropic");
  mkdirSync(dir, { recursive: true });
  for (const name of Object.values(ANTHROPIC_NAMES)) {
    await download(`https://raw.githubusercontent.com/anthropics/skills/main/skills/${name}/SKILL.md`, join(dir, `${name}.md`));
  }
  return dir;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": "prism-vendor-hermes-skills" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function skillBody(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === "---" || line.trim() === "..."));
  return end === -1 ? text : lines.slice(end + 1).join("\n");
}

function tokenize(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function jaccard(a, b) {
  let inter = 0;
  for (const token of a) if (b.has(token)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function notices(sha) {
  return `Hermes Agent productivity skills (docx, xlsx, powerpoint, pdf)
Source: https://github.com/${REPO}
Commit: ${sha}
License: MIT

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--sha") out.sha = argv[++i];
    else if (arg === "--source") out.source = argv[++i];
    else if (arg === "--anthropic-source") out.anthropicSource = argv[++i];
    else if (arg === "--dest") out.dest = argv[++i];
    else throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  vendorHermesSkills(parseArgs(process.argv.slice(2)))
    .then((lock) => {
      process.stdout.write(`${JSON.stringify(lock, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      process.exit(1);
    });
}
