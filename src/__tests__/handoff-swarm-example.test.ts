import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// In-session handoff (swarm) recipe smoke: the triage → specialist example must
// run offline (mock provider) with the full transfer visible in one transcript.
test("handoff_swarm_example_runs_offline_with_fail_closed_transfer_and_narrowed_permissions", () => {
  const result = spawnSync(process.execPath, ["examples/handoff-swarm.ts"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `handoff-swarm.ts exited ${result.status}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
    unknownTargetError: string | undefined;
    handoffTarget: string | undefined;
    specialistBlockedReason: string;
    contextCarried: boolean;
    swapProviderCalls: number;
    swapMs: number;
    transcript: readonly string[];
  };

  // Fail-closed: an untrusted target name is rejected by the host allow-list.
  assert.match(payload.unknownTargetError ?? "", /Unknown handoff target: payroll/);
  // Explicit model-initiated transfer, host-authorized via the allow-list tool.
  assert.equal(payload.handoffTarget, "billing");
  // Narrowed permissions: the specialist may not re-handoff — standard blocked reason.
  assert.equal(payload.specialistBlockedReason, "unknown_tool");
  // Context carried: the specialist's own prompt contains the original complaint.
  assert.equal(payload.contextCarried, true);
  // Fixture timing: the definition swap performs zero provider calls; wall time is
  // reported as evidence it adds no runtime cost beyond a normal tool round.
  assert.equal(payload.swapProviderCalls, 0);
  assert.equal(typeof payload.swapMs, "number");
  assert.ok(payload.swapMs < 500, `swap took ${payload.swapMs}ms — expected a registry-level swap, not a provider round`);

  // One continuous transcript: triage turn → handoff tool call → (blocked re-handoff)
  // → specialist answer, in the same session chain.
  assert.equal(payload.transcript[0], "user: My last invoice was charged twice.");
  assert.ok(payload.transcript.some((line) => line.includes("handoff()")));
  assert.ok(payload.transcript.some((line) => line.startsWith("tool:")));
  const final = payload.transcript.at(-1)!;
  assert.match(final, /^assistant: Refund issued/);
});
