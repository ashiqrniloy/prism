# Signed, hash-chained audit export

## What it does

`@arnilo/prism-core/governance/policy` exports tenant-scoped audit records as signed, hash-chained
batches: each record envelope is canonicalized (RFC 8785 semantics), hashed with
SHA-256 including the prior digest, so records form a tamper-evident chain. A
batch of chained records is wrapped in a manifest that a host-provided
`AuditSigner` signs; the signed artifact is written to an immutable WORM sink
which must acknowledge the exact artifact digest before the export cursor
advances, and is mirrored to an optional SIEM sink with replayable status. An
independent verifier (`verifyAuditBatch` or `scripts/verify-audit-export.mjs`)
re-derives everything from the artifact bytes and a public key — no ledger,
sink, or private key needed.

## When to use it

- You keep an append-only policy/audit ledger and must prove to auditors that
  exported records were not reordered, edited, inserted, or truncated after the
  fact.
- You need a durable WORM copy with an integrity receipt and a replayable SIEM
  mirror, without embedding cloud SDKs or key storage in Prism.
- You must export only the redacted bytes an external verifier will actually
  see, with redaction provenance and legal-hold provenance preserved.

Do not use it for exactly-once delivery claims: like the messaging outbox,
exports are at-least-once, and the exporter never proves that a record exists —
it proves that what was exported is exactly what the verifier can reproduce.

## Inputs / request

- `createAuditExporter({ source, cursorStore, signer, wormSink, siemSink?, redact? })`
  - `source` — tenant-scoped, stable-order `AuditPageSource`; page cursors are
    one-shot tokens (re-reading a cursor that already served its final page
    yields an empty page).
  - `cursorStore` — CAS-versioned `AuditCursorStore`; the exporter advances the
    cursor only on a matched version after the WORM acknowledgement.
  - `signer` — host `AuditSigner` (`sign(bytes) -> Uint8Array`, optional
    `keyId`/`algorithm`); Prism never accepts raw private keys.
  - `wormSink` — required immutable sink returning `{ batchId, digest }`; the
    exporter refuses to advance unless both match.
  - `siemSink` — optional replayable mirror.
  - `redact` — optional `AuditRedactionPolicy` applied before hashing.
- `exportNext({ tenantId, maxRecords?, maxBytes?, signal? })` — processes one
  page; returns `{ batchId, firstSequence, lastSequence, recordCount,
  wormAcked, siemStatus: "disabled" | "sent" | "pending", nextDigest,
  artifactBytes }`.
- `verifyAuditBatch({ artifactBytes, publicKey, expectedTenantId,
  previousDigest?, expectedFirstSequence?, expectedLastSequence? })`.

## Outputs / response / events

A batch artifact written to the WORM sink contains:

```json
{
  "schemaVersion": 1,
  "document": "{ ...canonical signed manifest as a single JSON string... }",
  "signature": { "algorithm": "sha256", "keyId": "k1", "value": "<base64>" }
}
```

The embedded document is the manifest: `tenantId`, `batchId`, `algorithm`,
`firstSequence`, `lastSequence`, `previousDigest`, `nextDigest`, and
`records` — each record carrying `sequence`, `priorDigest`, `digest`,
optional `legalHold`, optional `redactions` (`{ path, reason }[]`), and the
canonical `record` payload. `verifyAuditBatch` returns `{ ok, errors, batch }`.

## Request/response example

```ts
import { createAuditExporter, createMemoryAuditCursorStore } from "@arnilo/prism-core/governance/policy";

const exporter = createAuditExporter({
  source,                                 // host: tenant-scoped record pages
  cursorStore: createMemoryAuditCursorStore(), // host durable store in production
  signer,                                 // host: HSM/KMS-backed signer
  wormSink,                               // host: S3 object-lock / WORM bucket
  siemSink,                               // host: SIEM or event stream
});
const result = await exporter.exportNext({ tenantId: "acme", maxRecords: 1000 });
// result.artifactBytes -> store on WORM; result.nextDigest -> pass as
// previousDigest when verifying the next batch.
```

## Implementation example

```ts
import { readFileSync } from "node:fs";
import { verifyAuditBatch } from "@arnilo/prism-core/governance/policy";

const artifactBytes = new Uint8Array(readFileSync("./acme-000001.json"));
const verified = verifyAuditBatch({
  artifactBytes,
  publicKey: readFileSync("./audit-verification.pem", "utf8"),
  expectedTenantId: "acme",
  previousDigest: "0000000000000000000000000000000000000000000000000000000000000000",
});
if (!verified.ok) throw new Error(verified.errors.join("; "));
```

## Extension and configuration notes

- Key rotation: the artifact records the signer's `keyId`; verification fails
  explicitly under a rotated key, so consumers select the key named by the
  artifact's `signature.keyId`. Hosts own key lifecycle and the public-key
  distribution path.
- Failed batches retain their one-page payload in exporter memory and replay
  the same batch id on the next `exportNext`; WORM-failed or signer-failed
  batches are never re-read from the source. A cursor CAS race after WORM
  acknowledgment is surfaced as an explicit error and is not retried by this
  exporter (the batch is already durable).
- SIEM failures do not fail the export: the batch reaches WORM, the cursor
  advances, and a bounded `siemPending` list records what is not mirrored.
  `retryPendingSiem` replays a pending batch when the host supplies its
  artifact bytes (e.g. fetched from WORM) and verifies the digest matches.
- Legal holds: the exporter preserves a `legalHold` flag on envelope records
  and never broadens tenant access; enforcing a hold is the host source's job.
  Redaction (`redact`) strips values before hashing so the verifier sees
  exactly the exported bytes; only `{ path, reason }` provenance survives.
- Caps are frozen: 1,000 records or 10 MiB per batch, at most 8 un-mirrored
  SIEM batches retained.

## Security and performance notes

- Bytes are canonical JSON (RFC 8785 semantics: sorted keys, ECMAScript
  shortest number round-trip, `-0` collapsed, lowercase control escapes);
  non-finite numbers, BigInt, undefined, functions, symbols, and cyclic
  values are rejected rather than coerced.
- Each record digest covers `schemaVersion`, `tenantId`, `sequence`,
  `priorDigest`, `legalHold`, `redactions`, and the canonical record — a
  cross-tenant record can never enter another tenant's chain, and the verifier
  replays every envelope from the artifact's own bytes.
- The WORM acknowledgement must name the batch and match the artifact digest;
  a lying or partial acknowledgement cannot falsely advance the cursor.
- Signer keys and raw values never enter logs, records, or artifacts.
- Performance: hashing and signing are linear in record bytes; batches are
  bounded pages built without loading full history. Verification is also
  linear and stateless. Prism does not certify compliance with NIST or any
  SIEM/WORM vendor program; audit-export is the transport, hosts own the
  custody chain and compliance posture.

## Related APIs

- `createPolicyDecisionStore` / `exportPolicyDecisions` — the ledger that
  commonly backfills an `AuditPageSource`.
- `PersistenceLifecycleStore` — legal-hold and retention for lifecycle
  records the source may consult.
- `createMemoryAuditCursorStore` — reference cursor store (replace with a
  durable CAS store in production).
- `scripts/verify-audit-export.mjs` — standalone verifier CLI.