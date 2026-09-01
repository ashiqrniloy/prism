import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const HOOK = join(import.meta.dirname, "../../../fixtures/ponytail/upstream-full/hooks/ponytail-subagent.js");

// Hostile regex payloads that a naive `new RegExp(env)` would compile (and, with nested
// quantifiers, backtrack on catastrophically).
const CATASTROPHIC = "(a+)+$";
const CATASTROPHIC_INPUT = `${"a".repeat(30)}X`;
const OVERSIZE = "a".repeat(257);

let stateDir: string;

function runHook(matcherEnv: string | undefined, agentType: string): Promise<{ out: string; ms: number }> {
  return new Promise((resolveHook) => {
    const child = spawn(process.execPath, [HOOK], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: stateDir,
        ...(matcherEnv === undefined ? {} : { PONYTAIL_SUBAGENT_MATCHER: matcherEnv }),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const started = performance.now();
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.stdin.end(JSON.stringify({ agent_type: agentType }));
    child.on("close", () => resolveHook({ out, ms: performance.now() - started }));
  });
}

describe("ponytail-subagent safe matcher (no RegExp from environment)", () => {
  before(() => {
    stateDir = mkdtempSync(join(tmpdir(), "ponytail-subagent-test-"));
    // Activate ponytail so the hook injects when the matcher matches.
    writeFileSync(join(stateDir, ".ponytail-active"), "full", "utf8");
  });

  after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("literal_alternatives_match_case_insensitively", async () => {
    const { out } = await runHook("explore|general", "Explore");
    assert.ok(out.includes("additionalContext"), `expected injection, got: ${out}`);
  });

  it("exact_form_rejects_partial_matches", async () => {
    const hit = await runHook("^general$", "general");
    assert.ok(hit.out.includes("additionalContext"));
    const miss = await runHook("^general$", "generalist");
    assert.equal(miss.out, "", "partial match must not inject");
  });

  it("non_matching_matcher_skips_injection", async () => {
    const { out } = await runHook("general", "Explore");
    assert.equal(out, "");
  });

  it("invalid_pattern_fails_open_like_no_matcher", async () => {
    // "^$" parses to zero alternatives → invalid form → same as unset: inject.
    const { out } = await runHook("^$", "anything");
    assert.ok(out.includes("additionalContext"), "invalid form must inject (documented fallback)");
  });

  it("oversize_pattern_is_rejected_before_matching", async () => {
    const { out } = await runHook(OVERSIZE, "anything");
    assert.ok(out.includes("additionalContext"));
  });

  it("catastrophic_nested_quantifier_never_compiles_and_completes_fast", async () => {
    const { out, ms } = await runHook(CATASTROPHIC, CATASTROPHIC_INPUT);
    assert.ok(ms < 2000, `matcher must be linear, took ${ms.toFixed(0)}ms`);
    // "(a+)+$" is not a documented form: treated as an alternation literal, so no injection.
    assert.equal(out, "");
  });
});
