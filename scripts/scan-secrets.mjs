#!/usr/bin/env node
import { lstat, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 100_000;
const patterns = [
  ["private-key", new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----")],
  ["aws-access-key", new RegExp("AK" + "IA[0-9A-Z]{16}")],
  ["github-token", new RegExp("gh" + "[pousr]_[A-Za-z0-9]{30,}")],
  ["npm-token", new RegExp("npm" + "_[A-Za-z0-9]{30,}")],
  ["slack-token", new RegExp("xo" + "[abprs]-[A-Za-z0-9-]{20,}")],
  ["openai-key", new RegExp("sk" + "-[A-Za-z0-9_-]{20,}")],
];
const ignored = new Set([".git", "node_modules", "coverage"]);

async function* files(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) { yield path; return; }
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(path)) if (!ignored.has(entry)) yield* files(join(path, entry));
}

export async function scanSecrets(paths) {
  let scanned = 0;
  const findings = [];
  for (const root of paths) for await (const path of files(root)) {
    if (++scanned > MAX_FILES) throw new Error("Secret scan file count exceeds policy");
    const stat = await lstat(path);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Secret scan file exceeds 16 MiB: ${path}`);
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    for (const [name, pattern] of patterns) if (pattern.test(text)) findings.push(`${path}: ${name}`);
  }
  if (findings.length) throw new Error(`Secret scan rejected ${findings.slice(0, 50).join(", ")}`);
  return { files: scanned, findings: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await scanSecrets(process.argv.slice(2).length ? process.argv.slice(2) : ["."]);
  console.log(JSON.stringify(result));
}
