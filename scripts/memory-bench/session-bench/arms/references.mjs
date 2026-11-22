/**
 * Plan 218.3 Task 10: Session-Bench's reference compactors. Two production compaction prompts, the Claude Code prompt
 * and the Codex prompt, each run inside Prism's LLM compaction package (`@arnilo/prism-extensions/compaction`
 * `summaryPrompt`) with everything else as `memory-off-llm`: the same trigger (the kernel's, 80% of the input cap), the
 * same kept tail (20% of the input cap, owner call of 2026-11-18) and the same worker model. Only the summary prompt
 * differs, so the arms read "how good is Prism's own summary prompt against the prompts two production agents ship".
 *
 * The texts are not copied into the Prism tree. They are read at run time from the pinned Compact-Bench checkout
 * (arXiv 2610.31710, Apache-2.0; `harness/cb_common.py` `PROMPTS`, transcribed there from the agents' CLIs), exactly as
 * plan 218.1 Task 3 used them, and each is checked against the sha256 pinned below. A missing checkout or a drifted text
 * is refused: fetch it with `bun scripts/memory-bench/external/compact-bench/fetch.mjs`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPACT_BENCH_PIN, compactBenchPaths } from "../../external/compact-bench/fetch.mjs";

/** Arm id → the Compact-Bench `PROMPTS` key and the sha256 of its text at the pinned commit. */
export const REFERENCE_PROMPTS = Object.freeze({
  "claude-code-prompt": Object.freeze({
    key: "claude",
    sha256: "786e544ca55041f4e88bda9ea9398411caf96d936dd31af99dd2f2a1bb3f9bef",
    source: "Claude Code's /compact prompt, as transcribed by Compact-Bench",
  }),
  "codex-prompt": Object.freeze({
    key: "codex",
    sha256: "e1bbf80fab139e6b62d9f596c1e93ad47cf39b10a86efc767555bf4bfadebf95",
    source: "Codex CLI's compaction prompt, as transcribed by Compact-Bench",
  }),
});
export const REFERENCE_ARMS = Object.freeze(Object.keys(REFERENCE_PROMPTS));
/** Where the texts come from, for the report and the README. */
export const REFERENCE_SOURCE = Object.freeze({
  repository: COMPACT_BENCH_PIN.code.repository,
  commit: COMPACT_BENCH_PIN.code.commit,
  file: "harness/cb_common.py",
  licence: "Apache-2.0 (the checkout's LICENSE)",
});

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const PINNED = new Set(Object.values(REFERENCE_PROMPTS).map((row) => row.sha256));

/** True when `text` is one of the pinned reference prompts (the offline worker mock answers it as a summary request). */
export const isReferencePrompt = (text) => typeof text === "string" && PINNED.has(sha256(text));

/**
 * Read one key of the `PROMPTS = { "key": "…", … }` literal in `cb_common.py`. Each value is a single double-quoted
 * Python string with JSON-compatible escapes (`\n`, `\"`); the parsed text must match its pinned hash.
 */
export function parsePromptsLiteral(source, key) {
  const start = source.indexOf("\nPROMPTS = {");
  if (start < 0) throw new Error("SessionBenchReferences: cb_common.py has no PROMPTS literal");
  const match = new RegExp(`\\n\\s*"${key}":\\s*("(?:[^"\\\\\\n]|\\\\.)*")\\s*,`).exec(source.slice(start));
  if (!match) throw new Error(`SessionBenchReferences: PROMPTS has no "${key}" entry`);
  return JSON.parse(match[1]);
}

/** The prompt text for a reference arm, read from the pinned checkout and checked against its pin. */
export function referencePrompt(arm, { root } = {}) {
  const spec = REFERENCE_PROMPTS[arm];
  if (!spec) throw new Error(`SessionBenchReferences: unknown reference arm ${arm}`);
  const file = join(compactBenchPaths(COMPACT_BENCH_PIN, root).code, REFERENCE_SOURCE.file);
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `SessionBenchReferences: the pinned Compact-Bench checkout is missing (${file}); run bun scripts/memory-bench/external/compact-bench/fetch.mjs`,
    );
  }
  const text = parsePromptsLiteral(source, spec.key);
  if (sha256(text) !== spec.sha256)
    throw new Error(`SessionBenchReferences: ${arm}'s prompt does not match its pin (${spec.sha256.slice(0, 12)}…)`);
  return text;
}
