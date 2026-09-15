import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  type ArtifactCitation,
  type ArtifactRevision,
  approvalEvidenceIntact,
  checkCitationIntegrity,
  citationBindingDigest,
  HARD_CITATION_EXCERPT_BYTES,
} from "../artifacts.js";

const body = "alpha beta gamma";
const hash = createHash("sha256").update(body, "utf8").digest("hex");

function citation(overrides: Partial<ArtifactCitation> = {}): ArtifactCitation {
  return {
    uri: "https://example.test/doc",
    sourceId: "s1",
    revision: "r1",
    contentHash: hash,
    excerpt: "beta",
    span: { start: 6, end: 10 },
    ...overrides,
  };
}

test("citation integrity: match, missing, hash, span, acl, tenant, excerpt cap", () => {
  const live = { contentHash: hash, revision: "r1", body, authorized: true, tenantId: "t1" };
  assert.equal(checkCitationIntegrity(citation({ tenantId: "t1" }), live).reason, "ok");
  assert.equal(checkCitationIntegrity(citation(), undefined).reason, "missing_source");
  assert.equal(checkCitationIntegrity(citation({ contentHash: undefined }), live).reason, "missing_source");
  assert.equal(checkCitationIntegrity(citation(), { ...live, contentHash: "00".repeat(32) }).reason, "hash_mismatch");
  assert.equal(checkCitationIntegrity(citation({ excerpt: "nope" }), live).reason, "span_mismatch");
  assert.equal(checkCitationIntegrity(citation(), { ...live, authorized: false }).reason, "revoked_acl");
  assert.equal(checkCitationIntegrity(citation({ tenantId: "t1" }), { ...live, tenantId: "t2" }).reason, "cross_tenant");
  assert.equal(checkCitationIntegrity(citation({ revision: "r0" }), live).reason, "revision_changed");
  assert.equal(checkCitationIntegrity(citation(), live, { boundRevision: "r0" }).reason, "revision_changed");
  const huge = "x".repeat(HARD_CITATION_EXCERPT_BYTES + 1);
  assert.equal(checkCitationIntegrity(citation({ excerpt: huge }), live).reason, "excerpt_too_large");
  assert.equal(checkCitationIntegrity(citation(), live).ok, true);
});

test("citation integrity ignores semantic support", () => {
  const live = { contentHash: "aa", revision: "r1", authorized: false };
  const result = checkCitationIntegrity(citation({ contentHash: "aa", support: "supported", excerpt: undefined, span: undefined }), live);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "revoked_acl");
});

test("approval digest binds citations; live revoke fails intact check", () => {
  const citations = [citation({ excerpt: undefined, span: undefined })];
  const digest = citationBindingDigest(citations);
  const revision: ArtifactRevision = {
    version: 1,
    uri: "https://blob.example/a",
    mime: "text/plain",
    hash: "sha256:aaa",
    createdAt: "2026-01-01T00:00:00.000Z",
    citations,
  };
  const approval = {
    version: 1,
    state: "approved" as const,
    reviewer: "user:u1",
    decidedAt: "2026-01-01T00:00:00.000Z",
    evidenceDigest: digest,
  };
  assert.equal(approvalEvidenceIntact(approval, revision).ok, true);
  assert.equal(
    approvalEvidenceIntact(approval, { ...revision, citations: [{ ...citations[0]!, revision: "r2" }] }).reason,
    "revision_changed",
  );
  assert.equal(
    approvalEvidenceIntact(approval, revision, { s1: { contentHash: hash, revision: "r1", authorized: false } }).reason,
    "revoked_acl",
  );
});
