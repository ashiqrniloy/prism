import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BrowserError, createBrowserCheckpointLedger, DEFAULT_MAX_CHECKPOINTS_PER_RUN, resolveBrowserCheckpointLimits } from "../index.js";

function input(overrides: Partial<{ runId: string; url: string; domainStateHash: string; hostDataRef: string }> = {}) {
  return {
    runId: "run-1",
    url: "https://contoso.example/app",
    domainStateHash: "sha256:abc123",
    ...overrides,
  };
}

describe("resolveBrowserCheckpointLimits", () => {
  it("resolves frozen defaults and rejects caps above the hard ceiling", () => {
    const limits = resolveBrowserCheckpointLimits();
    assert.equal(limits.maxCheckpointsPerRun, DEFAULT_MAX_CHECKPOINTS_PER_RUN);
    assert.throws(() => resolveBrowserCheckpointLimits({ maxUrlBytes: 16 * 1024 + 1 }), BrowserError);
    assert.throws(() => resolveBrowserCheckpointLimits({ maxCheckpointsPerRun: 64 + 1 }), BrowserError);
  });
});

describe("createBrowserCheckpointLedger", () => {
  it("records verified state and lists per run", () => {
    const ledger = createBrowserCheckpointLedger();
    const cp = ledger.checkpoint(input());
    assert.equal(cp.verified, true);
    assert.equal(cp.runId, "run-1");
    assert.equal(ledger.list("run-1").length, 1);
    assert.equal(ledger.list("other-run").length, 0);
  });

  it("never stores browser internals — only url, hash, and host data ref", () => {
    const ledger = createBrowserCheckpointLedger();
    const cp = ledger.checkpoint(input({ hostDataRef: "host:artifact/rev-3" }));
    assert.deepEqual(Object.keys(cp).sort(), ["checkpointId", "createdAt", "domainStateHash", "hostDataRef", "runId", "url", "verified"]);
  });

  it("enforces byte caps on url, hash, and host data ref", () => {
    const ledger = createBrowserCheckpointLedger({ maxUrlBytes: 16, maxDomainStateHashBytes: 8, maxHostDataRefBytes: 8 });
    const ok = { url: "https://a.io", domainStateHash: "h" };
    assert.throws(() => ledger.checkpoint(input({ ...ok, url: "x".repeat(17) })), /url exceeds/);
    assert.throws(() => ledger.checkpoint(input({ ...ok, domainStateHash: "x".repeat(9) })), /domainStateHash exceeds/);
    assert.throws(() => ledger.checkpoint(input({ ...ok, hostDataRef: "x".repeat(9) })), /hostDataRef exceeds/);
  });

  it("evicts oldest beyond the per-run cap (bounded retention)", () => {
    const ledger = createBrowserCheckpointLedger({ maxCheckpointsPerRun: 2 });
    const a = ledger.checkpoint(input({ url: "https://a.example" }));
    ledger.checkpoint(input({ url: "https://b.example" }));
    ledger.checkpoint(input({ url: "https://c.example" }));
    const list = ledger.list("run-1");
    assert.equal(list.length, 2);
    assert.ok(!list.some((cp) => cp.checkpointId === a.checkpointId), "oldest evicted");
  });

  it("verify-before-side-effect: fresh checkpoint admits a mutating action", () => {
    const ledger = createBrowserCheckpointLedger();
    ledger.checkpoint(input());
    assert.doesNotThrow(() => ledger.assertVerifiedBeforeSideEffect("run-1"));
  });

  it("verify-before-side-effect: fails closed with no verified state", () => {
    const ledger = createBrowserCheckpointLedger();
    assert.throws(() => ledger.assertVerifiedBeforeSideEffect("run-1"), /reload \+ verify/);
  });

  it("verify-before-side-effect: resume marks state stale until reload+verify", () => {
    const ledger = createBrowserCheckpointLedger();
    ledger.checkpoint(input());
    // Interrupt/resume: browser state is now stale.
    ledger.markResumed("run-1");
    assert.throws(() => ledger.assertVerifiedBeforeSideEffect("run-1"), /reload \+ verify/);
    // Host reloads + verifies → side effects admitted again (no replay on stale state).
    ledger.verify(input({ domainStateHash: "sha256:after-reload" }));
    assert.doesNotThrow(() => ledger.assertVerifiedBeforeSideEffect("run-1"));
  });

  it("verify-before-side-effect: resuming an unknown run fails closed until verify", () => {
    const ledger = createBrowserCheckpointLedger();
    ledger.markResumed("ghost-run");
    assert.throws(() => ledger.assertVerifiedBeforeSideEffect("ghost-run"), /reload \+ verify/);
    ledger.verify(input({ runId: "ghost-run" }));
    assert.doesNotThrow(() => ledger.assertVerifiedBeforeSideEffect("ghost-run"));
  });

  it("rejects empty runId", () => {
    const ledger = createBrowserCheckpointLedger();
    assert.throws(() => ledger.checkpoint(input({ runId: "" })), BrowserError);
  });

  it("conversation-scoped: per-thread runs keep isolated state and verify gates", () => {
    const ledger = createBrowserCheckpointLedger();
    // Two conversation threads -> two runs.
    ledger.checkpoint(input({ runId: "thread-a-run" }));
    ledger.checkpoint(input({ runId: "thread-b-run" }));
    // Resuming thread A does not disturb thread B's verified state.
    ledger.markResumed("thread-a-run");
    assert.throws(() => ledger.assertVerifiedBeforeSideEffect("thread-a-run"), /reload \+ verify/);
    assert.doesNotThrow(() => ledger.assertVerifiedBeforeSideEffect("thread-b-run"));
    assert.equal(ledger.list("thread-a-run").length, 1);
    assert.equal(ledger.list("thread-b-run").length, 1);
  });
});
