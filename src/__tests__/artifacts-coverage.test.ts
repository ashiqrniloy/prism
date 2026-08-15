// Plan 025 Task 5 — focused behavior regressions for the root artifact runtime helpers
// (src/artifacts.ts), which was 61% covered (the server service is tested separately; the
// core runtime helpers — approval-state, checkpoint key, typed errors — were not exercised
// by core tests). Behavior-backed: each test asserts an observable outcome (a review state,
// a checkpoint key, a typed error code), not line count. Covers the D5 artifacts weak
// branches: latest-revision approval state (pending/approved/rejected), the error-code map,
// and the thread-scoped checkpoint key.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIFACT_BODY_ERROR_CODES,
  type ArtifactApproval,
  ArtifactBodyStoreError,
  ArtifactError,
  type ArtifactRecord,
  type ArtifactRevision,
  artifactApprovalState,
  artifactCheckpointKey,
} from "../artifacts.js";

function rev(version: number): ArtifactRevision {
  return { version, uri: `u${version}`, mime: "text/plain", hash: `h${version}`, createdAt: "2026-01-01T00:00:00.000Z" };
}

function record(revisions: readonly ArtifactRevision[], approvals: readonly ArtifactApproval[] = []): ArtifactRecord {
  return {
    id: "a1",
    threadId: "t1",
    revisions,
    approvals,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("artifactCheckpointKey is thread-scoped so per-thread listing can prefix-scan", () => {
  assert.equal(artifactCheckpointKey("t1", "a1"), "t1:a1");
  assert.notEqual(artifactCheckpointKey("t1", "a1"), artifactCheckpointKey("t2", "a1"));
});

test("artifactApprovalState is pending when there are no revisions", () => {
  assert.equal(artifactApprovalState(record([])), "pending");
});

test("artifactApprovalState reflects the decision on the latest revision", () => {
  const approved: ArtifactApproval = { version: 1, state: "approved", reviewer: "r", decidedAt: "2026-01-02T00:00:00.000Z" };
  assert.equal(artifactApprovalState(record([rev(1)], [approved])), "approved");
  const rejected: ArtifactApproval = { version: 1, state: "rejected", reviewer: "r", decidedAt: "2026-01-02T00:00:00.000Z" };
  assert.equal(artifactApprovalState(record([rev(1)], [rejected])), "rejected");
});

test("artifactApprovalState is pending when the latest revision has no decision (older approvals do not count)", () => {
  const olderApproved: ArtifactApproval = { version: 1, state: "approved", reviewer: "r", decidedAt: "2026-01-02T00:00:00.000Z" };
  assert.equal(artifactApprovalState(record([rev(1), rev(2)], [olderApproved])), "pending");
});

test("ArtifactBodyStoreError maps each reason to its frozen ERR_PRISM_ARTIFACT_BODY_* code", () => {
  for (const reason of ["OWNERSHIP", "HASH_MISMATCH", "SIZE_MISMATCH", "MIME_MISMATCH", "HELD", "STORE"] as const) {
    const err = new ArtifactBodyStoreError("boom", reason);
    assert.equal(err.code, ARTIFACT_BODY_ERROR_CODES[reason]);
    assert.equal(err.code, `ERR_PRISM_ARTIFACT_BODY_${reason}`);
    assert.equal(err.reason, reason);
    assert.equal(err.name, "ArtifactBodyStoreError");
  }
});

test("ArtifactError carries the fixed ERR_PRISM_ARTIFACT code and a reason", () => {
  const err = new ArtifactBodyStoreError("x", "STORE");
  assert.equal(err instanceof Error, true);
  const artifactErr = new ArtifactError("bad artifact", "missing_revision");
  assert.equal(artifactErr.code, "ERR_PRISM_ARTIFACT");
  assert.equal(artifactErr.reason, "missing_revision");
  assert.equal(artifactErr.name, "ArtifactError");
});
