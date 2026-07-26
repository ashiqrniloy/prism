import { createMemoryCheckpointStore, createSecretRedactor, type OwnershipScope } from "@arnilo/prism";
import { createArtifactService } from "@arnilo/prism-server";

// Artifact co-work review: attach a redacted artifact, revise it, approve a
// revision, then mint an expiring authorized delivery link. Network-free —
// in-memory checkpoint store, no credentials, no file bodies (refs + hashes only).
export async function demo(): Promise<Record<string, unknown>> {
  const ownership: OwnershipScope = { tenantId: "tenant-a", userId: "user-1" };
  const artifacts = createArtifactService(createMemoryCheckpointStore(), {
    redactor: createSecretRedactor(["super-secret"]),
    linkSecret: "demo-delivery-link-secret",
  });

  const threadId = "thread-release-plan";
  const attached = await artifacts.attach({
    ownership,
    threadId,
    uri: "https://storage.example/release-plan.md",
    mime: "text/markdown",
    hash: "sha256:aaa111",
    title: "Release plan",
  });

  // A second revision supersedes the first; reviewers compare by revision number.
  await artifacts.revise({
    ownership,
    threadId,
    artifactId: attached.id,
    uri: "https://storage.example/release-plan.md",
    hash: "sha256:bbb222",
    changeNote: "Added rollout dates",
  });

  const approved = await artifacts.approve({ ownership, threadId, artifactId: attached.id, version: 2, reviewer: "reviewer-1" });
  const delivery = await artifacts.deliveryLink({ ownership, threadId, artifactId: attached.id });

  return {
    artifactId: attached.id,
    revisions: approved.revisions.length,
    lastValidatedVersion: approved.lastValidatedVersion,
    approvals: approved.approvals.length,
    deliveryVersion: delivery.token.version,
    linkAuthorized: delivery.link.length > 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
