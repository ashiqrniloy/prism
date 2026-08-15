import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCodingPatchAccepted,
  CodingPatchReviewError,
  createCodingPatchReviewManifest,
  type CodingPatchReview,
  type CodingReviewArtifactRecord,
} from "../review.js";

const SHA = (c: string): string => c.repeat(64);

function reviewInput(overrides?: Partial<Parameters<typeof createCodingPatchReviewManifest>[0]>): Parameters<typeof createCodingPatchReviewManifest>[0] {
  return {
    threadId: "thread-1",
    artifactId: "patch-1",
    identity: {
      repositoryId: "app",
      remoteFingerprint: SHA("a"),
      defaultBranch: "main",
      worktreePath: "worktrees/app-1",
    },
    base: "main",
    head: "feature-1",
    patch: { kind: "patch", uri: "artifacts/patch-1.patch", sha256: SHA("b"), bytes: 4096 },
    changedPaths: ["src/a.ts", "src/b.ts"],
    diffstat: [
      { file: "src/a.ts", additions: 10, deletions: 2 },
      { file: "src/b.ts", additions: 1, deletions: 0 },
    ],
    checks: [{ name: "build", exitCode: 0, summary: "ok" }],
    diagnostics: [{ file: "src/a.ts", severity: "error", count: 2, generation: 3 }],
    ...overrides,
  };
}

function recordFor(
  review: CodingPatchReview,
  overrides?: Partial<CodingReviewArtifactRecord>,
): CodingReviewArtifactRecord {
  return {
    id: review.artifactId,
    threadId: review.threadId,
    revisions: [
      {
        version: 1,
        hash: review.patch.sha256,
        uri: review.patch.uri,
        preview: { review },
      },
    ],
    approvals: [{ version: 1, state: "approved", reviewer: "user:reviewer" }],
    ...overrides,
  };
}

test("creates a bounded manifest with a digest and structural artifact input", () => {
  const { review, artifactInput } = createCodingPatchReviewManifest(reviewInput());
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.state, "pending");
  assert.match(review.reviewId, /^review-[0-9a-f]{24}$/);
  assert.match(review.digest, /^[0-9a-f]{64}$/);
  assert.equal(review.changedPaths.length, 2);
  assert.equal(review.checks.length, 1);
  assert.equal(review.diagnostics[0]?.count, 2);
  assert.equal(artifactInput.threadId, "thread-1");
  assert.equal(artifactInput.id, "patch-1");
  assert.equal(artifactInput.hash, SHA("b"));
  assert.equal(artifactInput.mime, "application/x-patch");
  const embedded = artifactInput.preview?.review as CodingPatchReview | undefined;
  assert.equal(embedded?.digest, review.digest);
  // raw patch body never embedded
  const json = JSON.stringify(artifactInput);
  assert.ok(!json.includes("diff --git"));
  assert.ok(!json.includes("content"));
});

test("digest is deterministic for identical input", () => {
  const fixed = { createdAt: "2026-08-16T00:00:00.000Z" };
  const a = createCodingPatchReviewManifest(reviewInput(fixed));
  const b = createCodingPatchReviewManifest(reviewInput(fixed));
  assert.equal(a.review.digest, b.review.digest);
  assert.equal(a.review.reviewId, b.review.reviewId);
  const changed = createCodingPatchReviewManifest(reviewInput({ ...fixed, head: "feature-2" }));
  assert.notEqual(a.review.digest, changed.review.digest);
  assert.throws(
    () => createCodingPatchReviewManifest(reviewInput({ createdAt: "not-a-timestamp" })),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_INPUT",
  );
});

test("invalid identities fail closed with ERR_PRISM_REVIEW_INPUT", () => {
  const cases: Array<Partial<Parameters<typeof createCodingPatchReviewManifest>[0]>> = [
    { threadId: "bad thread" },
    { threadId: "-leading" },
    { artifactId: "a/b" },
    { identity: { repositoryId: "app", remoteFingerprint: "not-hex", defaultBranch: "main" } },
    { identity: { repositoryId: "app", remoteFingerprint: SHA("a"), defaultBranch: "a..b" } },
    { identity: { repositoryId: "app", remoteFingerprint: SHA("a"), defaultBranch: "main", worktreePath: "../escape" } },
    { base: "a..b" },
    { head: "has space" },
    { patch: { kind: "patch", uri: "u", sha256: "short", bytes: 1 } },
    { changedPaths: ["/abs/path"] },
    { changedPaths: ["src/../../etc/passwd"] },
    { patch: { kind: "patch", uri: "u\u0000v", sha256: SHA("b"), bytes: 1 } },
  ];
  for (const overrides of cases) {
    assert.throws(
      () => createCodingPatchReviewManifest(reviewInput(overrides)),
      (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_INPUT",
      `expected INPUT failure for ${JSON.stringify(overrides).slice(0, 80)}`,
    );
  }
});

test("caps charge before retention: diagnostics, checks, summaries, manifest bytes", () => {
  assert.throws(
    () =>
      createCodingPatchReviewManifest(
        reviewInput({
          diagnostics: Array.from({ length: 501 }, (_, i) => ({ file: `src/f${i}.ts`, severity: "warning" as const, count: 1, generation: 1 })),
        }),
      ),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_LIMIT",
  );
  assert.throws(
    () =>
      createCodingPatchReviewManifest(
        reviewInput({ checks: Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, exitCode: 1, summary: "x" })) }),
      ),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_LIMIT",
  );
  assert.throws(
    () => createCodingPatchReviewManifest(reviewInput({ checks: [{ name: "c", exitCode: 0, summary: "x".repeat(9000) }] })),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_LIMIT",
  );
  assert.throws(
    () => createCodingPatchReviewManifest(reviewInput({ checks: [{ name: "bad name", exitCode: 0, summary: "x" }] })),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_INPUT",
  );
  assert.throws(
    () => createCodingPatchReviewManifest(reviewInput({ limits: { maxManifestBytes: 64 } })),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_LIMIT",
  );
});

test("accepted: approved decision on the bound revision", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const result = assertCodingPatchAccepted({ review, artifact: recordFor(review) });
  assert.equal(result.state, "accepted");
  assert.equal(result.version, 1);
  assert.equal(result.reviewer, "user:reviewer");
});

test("rejected: rejection decision on the bound revision", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const result = assertCodingPatchAccepted({
    review,
    artifact: recordFor(review, { approvals: [{ version: 1, state: "rejected", reviewer: "user:reviewer", note: "needs fixes" }] }),
  });
  assert.equal(result.state, "rejected");
  assert.equal(result.reason, "needs fixes");
});

test("pending: no decision on the bound revision", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const result = assertCodingPatchAccepted({ review, artifact: recordFor(review, { approvals: [] }) });
  assert.equal(result.state, "pending");
});

test("superseded: no artifact revision matches the patch digest (patch changed)", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const artifact = recordFor(review, {
    revisions: [
      {
        version: 1,
        hash: SHA("z"), // different patch bytes were attached
        uri: review.patch.uri,
        preview: { review },
      },
    ],
  });
  const result = assertCodingPatchAccepted({ review, artifact });
  assert.equal(result.state, "superseded");
});

test("superseded: stale acceptance refused when a newer patch revision exists", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const artifact = recordFor(review, {
    revisions: [
      { version: 1, hash: review.patch.sha256, uri: review.patch.uri, preview: { review } },
      { version: 2, hash: SHA("z"), uri: "artifacts/patch-2.patch", preview: { review } },
    ],
    approvals: [{ version: 1, state: "approved", reviewer: "user:reviewer" }],
  });
  const result = assertCodingPatchAccepted({ review, artifact });
  assert.equal(result.state, "superseded");
});

test("superseded: review digest changed after the decision", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const tampered = { ...review, digest: SHA("d") };
  const result = assertCodingPatchAccepted({ review: tampered, artifact: recordFor(review) });
  assert.equal(result.state, "superseded");
});

test("superseded: identity changed despite matching digest (tampered preview)", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const preview: CodingPatchReview = { ...review, identity: { ...review.identity, defaultBranch: "other" } };
  const result = assertCodingPatchAccepted({
    review,
    artifact: recordFor(review, { revisions: [{ version: 1, hash: review.patch.sha256, uri: review.patch.uri, preview: { review: preview } }] }),
  });
  assert.equal(result.state, "superseded");
});

test("ownership: artifact bound to a different thread or artifact is refused", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  assert.throws(
    () => assertCodingPatchAccepted({ review, artifact: recordFor(review, { threadId: "other-thread" }) }),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_OWNERSHIP",
  );
  assert.throws(
    () => assertCodingPatchAccepted({ review, artifact: recordFor(review, { id: "other-artifact" }) }),
    (e: unknown) => e instanceof CodingPatchReviewError && e.code === "ERR_PRISM_REVIEW_OWNERSHIP",
  );
});

test("acceptance never claims to apply: state derivation only", () => {
  const { review } = createCodingPatchReviewManifest(reviewInput());
  const result = assertCodingPatchAccepted({ review, artifact: recordFor(review) });
  assert.equal(result.state, "accepted");
  assert.deepEqual(Object.keys(result).sort(), ["reviewer", "state", "version"]);
});
