# Coding review and diagnostics

## What it does

Bounded patch-review manifests plus normalized LSP/check diagnostics for the coding agent runtime (plan 026 Task 6). The review side composes over the existing server `ArtifactService` — no second approval engine, no review database, no raw patch bodies persisted. The diagnostics side normalizes LSP push/pull results and host-parsed check output into one bounded shape with deterministic added/removed/unchanged deltas.

| Export | Purpose |
| --- | --- |
| `createCodingPatchReviewManifest(input)` | Build a bounded review manifest + structural artifact input (`preview.review` embeds the manifest). |
| `assertCodingPatchAccepted({ review, artifact })` | Derive `pending\|accepted\|rejected\|superseded` from the artifact record — digest/revision/identity checked. |
| `CodingPatchReviewError` | Typed fail-closed errors (`ERR_PRISM_REVIEW_*`). |
| `normalizeDiagnostics(raw, options)` | Validate/bound host-parsed check diagnostics into `NormalizedDiagnostic[]`. |
| `diagnosticDelta({ next, previous })` | Deterministic `added` / `removed` / `unchanged` across generations. |
| `diagnosticIdentity(diagnostic)` | Stable per-diagnostic key (`file:source:line:character:code`). |
| `LanguageIntelligence.syncDocument(file)` / `.diagnosticDelta({ files, previous })` | LSP document re-sync and bounded diagnostic refresh. |

## Review lifecycle

A review is created per patch handoff. The manifest binds: repository identity (credential-free remote fingerprint + default branch + optional worktree path), `base`/`head`, the patch artifact reference (`kind`, `uri`, `sha256`, `bytes`), changed paths, diffstat, named-check summaries, and diagnostic summaries. The `digest` is SHA-256 over the canonical manifest JSON; the structural artifact input carries the manifest in `preview.review` and the patch SHA-256 as the artifact hash.

```ts
import { createCodingPatchReviewManifest, assertCodingPatchAccepted } from "@arnilo/prism-coding-agent";
import { createArtifactService } from "@arnilo/prism-server";

const { review, artifactInput } = createCodingPatchReviewManifest({
  threadId: "thread-1",
  artifactId: "patch-1",
  identity: { repositoryId: "app", remoteFingerprint: sha256Fingerprint, defaultBranch: "main" },
  base: "main",
  head: "feature-1",
  patch: { kind: "patch", uri: "artifacts/patch-1.patch", sha256: patchSha, bytes: 4096 },
  changedPaths: ["src/a.ts"],
  diffstat: [{ file: "src/a.ts", additions: 10, deletions: 2 }],
  checks: [{ name: "build", exitCode: 0, summary: "ok" }],
});
const record = await artifacts.attach({ ...artifactInput, ownership, identity });

// later, after a human approve/reject on the artifact:
const outcome = assertCodingPatchAccepted({ review, artifact: record });
// outcome.state: "accepted" | "rejected" | "pending" | "superseded"
```

State derivation rules:

- `pending` — no decision recorded for the bound revision.
- `accepted` — an `approved` decision exists for the exact artifact revision whose hash equals the patch digest, the revision is still the latest, and the embedded review digest and repository/worktree/base/head identity still match. Acceptance is a state assertion only — it never applies, commits, pushes, or merges automatically.
- `rejected` — a `rejected` decision exists for the bound revision (bounded reviewer reason).
- `superseded` — any change invalidates a prior acceptance: a new patch digest (no revision matches), a newer patch revision attached after the decision (stale acceptance refused), a changed review digest (patch/identity/base/head changed), or a tampered identity in the preview.

Caps (default / hard): review revisions 8/32, diagnostic summaries 500/5000, manifest bytes 64 KiB/256 KiB, delta entries 2000/10000; check summaries 8 KiB each; artifact URIs 2048 bytes. Every identity field is validated at manifest creation (`ERR_PRISM_REVIEW_INPUT`); caps charge before retention (`ERR_PRISM_REVIEW_LIMIT`); a record bound to another thread/artifact is refused (`ERR_PRISM_REVIEW_OWNERSHIP`). Raw patch bodies, commands, env, and secrets are never embedded in the manifest or artifact preview — the artifact hash is the patch digest, the body stays in the host artifact store.

## Diagnostics

`normalizeDiagnostics` accepts host-parsed raw diagnostics (hosts own the check parsers; there is no language/tool-specific parser catalog). Each entry is validated: workspace-relative path (absolute paths must stay inside the workspace root), non-negative finite positions, valid severity, non-empty message. Control characters are stripped, messages are UTF-8-truncated at the byte cap (4 KiB default / 16 KiB hard), and the per-file cap charges before retention (500 default / 5000 hard). Malformed entries are dropped fail-closed — never partially normalized.

`diagnosticDelta` computes a deterministic `added` / `removed` / `unchanged` view between generations using `diagnosticIdentity`. Duplicate identities in one side dedupe; previous views with a generation newer than the incoming view are treated as stale and ignored (a stale-version response never overwrites newer results). Same-generation views diff normally, so repeated refreshes yield `unchanged` without churn.

## LSP synchronization (opt-in)

`LanguageIntelligence` stays a standalone host-activated factory — no LSP server is spawned by construction and nothing is baked into `createCodingTools`/`createAllTools` or any agent assembly. Hosts wire it explicitly:

```ts
const lang = createLanguageIntelligence({ workspaceRoot, servers: { ts: {...} }, policy });
await lang.syncDocument("src/app.ts"); // full-content didChange, monotonic version
const delta = await lang.diagnosticDelta({ files: ["src/app.ts", "src/lib.ts"], previous });
```

- `syncDocument(file)` reads the file and sends a full-content `textDocument/didChange` (protocol-valid LSP 3.17; no diff engine). Versions are monotonic per document: didOpen stamps 1, each didChange increments.
- `diagnosticDelta({ files, previous })` refreshes each changed file: pull diagnostics (`textDocument/diagnostic` with `previousResultId` reuse, `kind: full|unchanged`) when the server advertises `diagnosticProvider`, otherwise the push cache (`textDocument/publishDiagnostics`, which always replaces the full set — publish `[]` to clear). Results are normalized, generation-stamped with the document version, and diffed against `previous`. Stale views (previous generation newer than the refresh) are dropped per file.
- Refresh is bounded to the requested files (never a whole-workspace pull) and to the standard LSP caps (message bytes, diagnostics/file, pending requests, results/query, timeout, servers).

## Related APIs

- `docs/work-artifacts-and-review.md`: artifact revisions and approve/reject semantics the manifest composes over.
- `docs/language-intelligence.md`: full LSP contract.
- `docs/coding-agent-tools.md`: `coding_check` named checks the manifest summarizes.
