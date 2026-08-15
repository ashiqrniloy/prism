# Work artifacts and review

## What it does

`@arnilo/prism-server` ships a durable artifact co-work review service (Phase 9 / 0.0.14): authorized attach of source/output references with MIME/hash/version, producer-run attribution, citations/data sources, and preview metadata; revision comparison; reviewer approve/reject (request-changes) with last-validated recovery; and authorized, expiring delivery links. Core (`@arnilo/prism`) exports artifact **types only** (`ArtifactRecord`, `ArtifactRevision`, `ArtifactApproval`, `ArtifactDeliveryToken`, approval state `pending | approved | rejected`). Prism persists bounded metadata, revisions, approvals, and delivery references over the existing versioned checkpoint store — **never file bodies**; hosts own blob storage and rendering.

## When to use it

- Durable human-in-the-loop review of agent-produced outputs (drafts, exports, generated files) where users compare revisions, request changes, and approve/reject.
- Authorized, time-boxed delivery of a validated artifact revision to a downstream consumer.
- Recovering the last approved ("validated") revision after a later revision is rejected.

Not for: storing file content (use host blob storage), local Office preview/rendering (host-owned), or SaaS connector delivery (see work-connectors).

## Inputs / request

`createArtifactService(store: CheckpointStore, options)`:

| Field | Required | Meaning |
| --- | --- | --- |
| `store` | yes | Any `CheckpointStore` (sqlite/postgres `persistence.checkpoints`, or `createMemoryCheckpointStore()` for tests) |
| `options.redactor` | yes | `SecretRedactor`; records are redacted before persist and on every response |
| `options.linkSecret` | yes | Host HMAC key material for signing/verifying delivery links |
| `options.limits` | no | Frozen caps (below); each clamped to a hard maximum |
| `options.onDecision` | no | Audit seam (redacted refs) for attach/revise/approve/reject; bridge to `@arnilo/prism-policy` |

Every operation input carries `ownership` (from host `authorize`, never request JSON) plus optional verified `identity`. `attach` requires `threadId`, `uri`, `mime`, `hash`; `revise` requires `uri`, `hash` (mime defaults to the previous revision); `compare` requires two distinct revision numbers; `approve`/`reject` require a `version`; `deliveryLink` accepts optional `version` (defaults to last validated, else latest) and `ttlSeconds`.

## Outputs / response / events

| API | Result |
| --- | --- |
| `attach` | `ArtifactRecord` with revision 1, pending state (idempotent get-or-create with explicit `id`) |
| `list` | Ownership/thread-scoped `PersistencePage<ArtifactRecord>` |
| `get` | `ArtifactRecord` |
| `revise` | `ArtifactRecord` with an appended revision (new revision resets state to pending) |
| `compare` | `{ artifactId, from, to, changed: { hash, mime, uri, citations } }` — hash+metadata only |
| `approve` / `reject` | `ArtifactRecord`; approve advances `lastValidatedVersion`, reject never clears it |
| `lastValidated` | The last approved `ArtifactRevision` (fails closed before any approval) |
| `deliveryLink` | `{ link, token }` — signed expiring `ArtifactDeliveryToken` |

No package-owned agent events are emitted; `onDecision` is the audit seam (redacted actor refs only).

## Request/response example

```json
{
  "attach": { "threadId": "thread-1", "uri": "https://blob.example/doc-v1", "mime": "text/markdown", "hash": "sha256:aaa" },
  "compare": { "from": 1, "to": 2, "changed": { "hash": true, "mime": false, "uri": true, "citations": false } },
  "approve": { "version": 2, "lastValidatedVersion": 2, "approvals": [{ "version": 2, "state": "approved", "reviewer": "user:user-1" }] },
  "deliveryLink": { "link": "<base64url payload>.<base64url hmac>", "token": { "artifactId": "art_1", "version": 2, "expiresAt": "2026-07-25T04:10:00.000Z" } }
}
```

## Implementation example

```ts
import { createSecretRedactor } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import { createArtifactService, createArtifactHandler } from "@arnilo/prism-server";

const persistence = createSqlitePersistence({ filename: "prism.db" });
const artifacts = createArtifactService(persistence.checkpoints, {
  redactor: createSecretRedactor([/* host secrets */]),
  linkSecret: process.env.PRISM_ARTIFACT_LINK_SECRET!,
});

const record = await artifacts.attach({ ownership, identity, threadId: "thread-1", uri: "https://blob.example/doc", mime: "text/markdown", hash: "sha256:aaa" });
await artifacts.revise({ ownership, threadId: "thread-1", artifactId: record.id, uri: "https://blob.example/doc-v2", hash: "sha256:bbb" });
await artifacts.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 2 });
const { link } = await artifacts.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id });

// Framework-free HTTP adapter (default base /prism/artifacts); ownership only from authorize.
export const handler = createArtifactHandler({ service: artifacts, authorize: hostAuthorize, linkSecret: process.env.PRISM_ARTIFACT_LINK_SECRET! });
```

## Extension and configuration notes

- Artifact records are versioned checkpoint values (namespace `prism.artifact`, key `threadId:artifactId`). The checkpoint `version` is the CAS counter for concurrent reviewers, distinct from revision numbers. Any `CheckpointStore` works; sqlite/postgres persistence already expose `.checkpoints`, so there is no separate artifact schema or migration.
- `createArtifactHandler` mounts attach/list/get/revise/compare/approve/reject/last-validated/delivery-link plus `GET /prism/artifacts/download?link=…`. Download verifies the link signature + expiry, then **reauthorizes** against the token's ownership (mismatch fails closed), and returns the authorized revision reference only — the host fetches the body.
- Delivery links are `base64url(payload).base64url(HMAC-SHA256)` over `{ artifactId, threadId, version, ownership, issuedAt, expiresAt }`; they are reauthorized per download and are not bearer secrets.
- **Blob storage (0.0.28)**: `createArtifactService` accepts an optional `bodies: ArtifactBodyStore` (core contract in `src/artifacts.ts`: `put`/`get`/`delete`/`presign` by opaque, ownership-scoped `ArtifactBodyRef`). When wired, `deliveryLink` resolves through `bodies.presign` and returns an additional `url` (bounded-TTL, single-object presigned URL) beside the signed link/token; revisions must carry a recorded `size` (optional on attach/revise) or delivery fails closed. The reference adapter is `@arnilo/prism-server/artifact-bodies` `createS3ArtifactBodyStore` (hand-rolled SigV4 over native fetch + WebCrypto, path-style, single-chunk PUT with verified `x-amz-content-sha256`; works with AWS S3, MinIO, Cloudflare R2). Hosts may substitute any store; the contract is storage-free in core.
- Body stores verify ownership on every operation, verify size/SHA-256/MIME on put and get (fail closed), refuse delete under legal hold (host `isHeld` callback), and are idempotent on delete (retention sweeps delete bodies with metadata). Credentials come only from the host resolver; bucket/path/key never appear in errors, telemetry, or artifact records (the object key is derived from the ref).
- Review loops driven by an agent consume the shared `RunLimits` at the host's agent layer; the artifact service itself is a passive, bounded record store.

## Security and performance notes

- Every operation requires authenticated identity + thread ownership derived from host `authorize`; cross-ownership access fails closed as `not_found` (never leaks existence).
- Concurrent reviewer conflicts resolve via checkpoint CAS (`expectedVersion`); the loser gets a retryable `conflict` and no approval is lost or duplicated. A throw before commit persists nothing, so failed updates roll back.
- Local filesystem paths are rejected in `uri`/citations (`file:`, absolute, or drive paths); records are redacted before persist and on response, so paths/secrets/document-private data never enter records, events, or exports.
- Frozen caps (default / hard): artifacts per thread 64/256; revisions per artifact 32/128; record 8/64 KiB; preview 16/64 KiB; citations 32/128 and 2/8 KiB each; MIME 128/512 B; hash 256/1 KiB; compare exactly 2 revisions; delivery TTL 5 min/24 h; delivery token 4/16 KiB. Raising the revision cap may require raising `recordBytes` (aggregate backstop).
- Compare is hash+metadata-bounded (hosts render content); no file bodies are persisted or transferred. With a wired body store, bodies live in the host's object store and are streamed through the adapter (bounded by `maxBodyBytes` 64 MiB/512 MiB, concurrent transfers 4/16, presign TTL 10 min/24 h); object-store outages surface typed `ERR_PRISM_S3_*` / `ERR_PRISM_ARTIFACT_BODY_*` errors, never silent success.

## Coding patch review composition (0.2.6, plan 026)

`@arnilo/prism-coding-agent` composes over this service for the coding patch review workflow: `createCodingPatchReviewManifest` builds a bounded manifest (repository/worktree identity, base/head, patch digest, changed paths, diffstat, check and diagnostic summaries) and returns a structural `ArtifactAttachInput` whose `preview.review` embeds the manifest and whose `hash` is the patch SHA-256; `assertCodingPatchAccepted` derives `pending|accepted|rejected|superseded` from the returned `ArtifactRecord` by binding to the exact artifact revision, digest, and identity — any patch/repository/worktree/base/head change supersedes a prior acceptance (a newer revision attached after approval makes the old acceptance stale and refused). Decisions never apply/commit/push/merge; the manifest never embeds a raw patch body. Full contract: [Coding review and diagnostics](coding-review-and-diagnostics.md).

## Related APIs

- [Server](server.md): `createArtifactService` / `createArtifactHandler` mount alongside the Prism handler; ownership only from `authorize`.
- [Conversations](conversations.md): artifact threads reuse conversation thread ownership scoping.
- [Database persistence](database-persistence.md): artifact records persist as versioned checkpoint values (sqlite/postgres `.checkpoints`).
- [Workflows](workflows.md): durable suspend/approve seam; hosts may gate revisions behind `tool_approval`.
- [Policy and audit](policy-and-audit.md): `onDecision` events bridge here for an auditable review ledger.
- [Host security](host-security.md): identity/ownership, redaction, and expiring-link boundaries.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): projects artifact progress/approval/download-link as redacted co-work events over the durable-resume stream.
