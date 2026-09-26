import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "bun:test";

interface Denial {
  readonly sourceId: string;
  readonly reason: string;
  readonly hits?: number;
  readonly error?: string;
}

interface RevocationPayload {
  readonly baseline: { readonly sources: readonly string[]; readonly payrollLegs: readonly string[]; readonly hasRevokedText: boolean };
  readonly accessLoss: {
    readonly analystSources: readonly string[];
    readonly analystDenials: readonly Denial[];
    readonly auditorSources: readonly string[];
    readonly tombstones: readonly string[];
    readonly retainedRows: number;
  };
  readonly deletion: {
    readonly tombstonedIds: readonly string[];
    readonly layers: Readonly<Record<string, number>>;
    readonly dropLayers: Readonly<Record<string, number>>;
    readonly analystSources: readonly string[];
    readonly auditorSources: readonly string[];
    readonly invalidatedIds: readonly string[];
  };
  readonly context: {
    readonly beforeHasRevoked: boolean;
    readonly readPathHasRevoked: boolean;
    readonly afterDropHasRevoked: boolean;
    readonly parity: boolean;
    readonly dropObservationIds: readonly string[];
    readonly activeObservationIds: readonly string[];
  };
  readonly exposure: { readonly reportHadRevokedText: boolean; readonly postDeletionRetrievedRevoked: boolean };
  readonly midFlight: {
    readonly preRerankSources: readonly string[];
    readonly sources: readonly string[];
    readonly denials: readonly Denial[];
  };
  readonly denialPath: {
    readonly denials: readonly Denial[];
    readonly remainingSources: readonly string[];
    readonly errorCapped: boolean;
  };
}

function runExample(): RevocationPayload {
  const result = spawnSync(process.execPath, ["examples/revocation-propagation.ts"], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(result.status, 0, `example failed\n${result.stderr}`);
  const lastLine = result.stdout.trim().split("\n").at(-1);
  assert.ok(lastLine, "example must print one JSON payload line");
  return JSON.parse(lastLine) as RevocationPayload;
}

describe("cross-layer revocation composition example", () => {
  it("revoke between rerank legs excludes mid-flight", () => {
    const payload = runExample();
    assert.ok(payload.midFlight.preRerankSources.includes("plan-notes"), "candidate rows were read before the revoke landed");
    assert.ok(!payload.midFlight.sources.includes("plan-notes"), "post-rerank gate must withhold the source revoked during rerank");
    const denial = payload.midFlight.denials.find((entry) => entry.sourceId === "plan-notes");
    assert.ok(denial, "the withheld source is audited");
    assert.equal(denial.reason, "no_grant");
    assert.equal(denial.hits, 1, "the revoke landed after the hit existed, so the audit names it");
  });

  it("revoke between step runs withholds from next context via invalidatedIds", () => {
    const payload = runExample();
    assert.equal(payload.baseline.hasRevokedText, true, "the baseline run saw the authorized source");
    assert.equal(payload.context.beforeHasRevoked, true, "the pre-revocation context carried the observation");
    assert.equal(payload.context.readPathHasRevoked, false, "listInvalidatedIds + invalidatedIds withhold before the drop entry lands");
    assert.equal(payload.context.afterDropHasRevoked, false, "the drop entry keeps the revoked observation out");
    assert.equal(payload.context.parity, true, "read path and write path render the same memory");
    assert.deepEqual(payload.deletion.invalidatedIds, ["payroll-export"]);
    assert.deepEqual(payload.context.dropObservationIds.length, 1);
    assert.deepEqual(payload.context.activeObservationIds, []);
    assert.equal(payload.deletion.dropLayers.observational, 1);
  });

  it("post-report-generation revoke blocks subsequent exposure", () => {
    const payload = runExample();
    assert.equal(
      payload.exposure.reportHadRevokedText,
      true,
      "a report generated before the revoke did contain the text (prior disclosure is not erased)",
    );
    assert.equal(payload.exposure.postDeletionRetrievedRevoked, false, "no later query returns the revoked source for any principal");
    assert.equal(payload.baseline.payrollLegs.includes("hybrid") || payload.baseline.payrollLegs.includes("vector"), true);
  });

  it("principal access loss ≠ deletion: distinct outcomes", () => {
    const payload = runExample();
    // Access loss: excluded for the analyst, still served to the auditor, rows retained, no tombstone.
    assert.ok(!payload.accessLoss.analystSources.includes("payroll-export"), "the losing principal is denied");
    assert.ok(payload.accessLoss.auditorSources.includes("payroll-export"), "the retained source still serves other principals");
    assert.ok(payload.accessLoss.retainedRows > 0, "loss of access does not delete rows");
    assert.deepEqual(payload.accessLoss.tombstones, [], "loss of access writes no invalidation");
    const denial = payload.accessLoss.analystDenials.find((entry) => entry.sourceId === "payroll-export");
    assert.equal(denial?.reason, "no_grant");
    // Deletion: global, physical, and tombstoned; the auditor loses it too.
    assert.ok(!payload.deletion.auditorSources.includes("payroll-export"), "deletion is not principal-scoped");
    assert.deepEqual(payload.deletion.tombstonedIds, ["payroll-export"]);
    assert.ok((payload.deletion.layers.rag ?? 0) > 0, "the RAG handler removed the chunk rows");
  });

  it("denial path redacted and fail-closed", () => {
    const payload = runExample();
    const failed = payload.denialPath.denials.find((entry) => entry.sourceId === "vendor-contract");
    assert.ok(failed, "a thrown grant check is audited, not swallowed");
    assert.equal(failed.reason, "check_failed");
    assert.ok(failed.error, "the denial carries the redacted store error");
    assert.doesNotMatch(failed.error, /sk-live-never-persist-this/);
    assert.match(failed.error, /\[REDACTED\]/);
    assert.equal(payload.denialPath.errorCapped, true, "store errors are capped before they reach the sink");
    assert.ok(payload.denialPath.remainingSources.includes("security-guide"), "the query still completes with the remaining hits");
  });
});
