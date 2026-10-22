#!/usr/bin/env node
// Plan 113 Task 2: the one reader for bun.lock.
//
// Bun 1.2+ writes `bun.lock` as JSONC-shaped text: trailing commas before `}`/`]`,
// no comments (measured in docs/_evidence/phase113-bun-inventory.md §3.1). npm's
// `packages` map is gone — workspace versions live under `workspaces[<path>]`, and
// the root entry (`workspaces[""]`) carries `name` but no `version`.
//
// Three callers share this reader: `scripts/release.mjs`,
// `scripts/version-literal-gate.test.mjs`, and `scripts/truth-current.test.mjs`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Remove trailing commas from JSON text without touching commas inside strings.
 * ponytail: an in-string scanner, not a regex — this file holds sha512 integrity
 * strings, and a regex that ate a comma inside one would silently drop a version
 * check. Upgrade to a real JSONC parser only if Bun starts emitting comments or
 * escapes this scanner misses.
 */
export function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let next = i + 1;
      while (/\s/.test(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    out += char;
  }
  return out;
}

/**
 * Keys that appear more than once in the same JSON object. Bun refuses a lockfile
 * with a duplicate package path (`Duplicate package path`, `InvalidLockfile`), so
 * the gate must fail closed before it packs anything. One scanner, string-aware,
 * shared by every reader: JSON.parse silently keeps the last duplicate.
 */
export function duplicateLockKeys(text) {
  const duplicates = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "{") stack.push(new Set());
    else if (char === "}") stack.pop();
    else if (char === "[") stack.push(null);
    else if (char === "]") stack.pop();
    else if (char === '"') {
      let value = "";
      let escaped = false;
      let j = i + 1;
      for (; j < text.length; j += 1) {
        const c = text[j];
        if (escaped) {
          value += c;
          escaped = false;
        } else if (c === "\\") escaped = true;
        else if (c === '"') break;
        else value += c;
      }
      i = j + 1;
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      const keys = stack[stack.length - 1];
      if (text[k] === ":" && keys) {
        if (keys.has(value)) duplicates.push(value);
        else keys.add(value);
      }
      continue;
    }
    i += 1;
  }
  return duplicates;
}

export function parseBunLock(text) {
  const duplicates = duplicateLockKeys(text);
  if (duplicates.length) throw new Error(`bun.lock has duplicate keys: ${[...new Set(duplicates)].sort().join(", ")}`);
  return JSON.parse(stripTrailingCommas(text));
}

export function readBunLock(root) {
  return parseBunLock(readFileSync(join(root, "bun.lock"), "utf8"));
}

/** Locked entry for a release package path (`"."` root, else `packages/<name>`). */
export function lockWorkspace(lock, pkgPath) {
  return lock.workspaces?.[pkgPath === "." ? "" : pkgPath];
}
