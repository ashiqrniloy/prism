import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { oneShotGolden } from "../scenarios/one-shot-golden.js";

/**
 * Kernel-minted ids the host cannot inject. The session id is injected. The scenario pins `Date`,
 * which does not cover `latencyMs` (not a `Date` read). Replacement is by key, never a regex over the line.
 */
const VOLATILE_KEYS = new Set(["runId", "latencyMs"]);

function normalize(line: string): string {
  return JSON.stringify(walk(JSON.parse(line) as unknown));
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = VOLATILE_KEYS.has(key) ? `<${key}>` : walk(item);
  return out;
}

test("one_shot_jsonl_matches_golden", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-golden-"));
  try {
    const live = (await oneShotGolden(root)).map(normalize);
    const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/one-shot.golden.jsonl");
    const pinned = readFileSync(fixture, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map(normalize);
    assert.deepEqual(live, pinned);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
