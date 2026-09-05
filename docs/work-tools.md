# Work tools

Optional `@arnilo/prism-core/integrations/work` package: identity-scoped Microsoft 365 and Google Workspace connectors. Host-pinned CLI binaries only; hard-coded `execFile` argv templates; draft-then-approve mutations; side-effect idempotency; shared mail/calendar/file/task result shapes.

## When to use

Use when agents must read or mutate tenant mail/calendar/files/tasks through the enterprise CLI the host already operates — not through model-built shell strings or generic Graph/Discovery free-form calls.

## Install

```bash
npm install @arnilo/prism-core/integrations/work
# host separately:
#   npm i -g @pnp/cli-microsoft365
#   npm i -g @googleworkspace/cli
```

## API

```ts
import {
  createWorkTools,
  createMicrosoft365CliAdapter,
  createGoogleWorkspaceCliAdapter,
  createMemoryIdempotencyStore,
} from "@arnilo/prism-core/integrations/work";
// or: import { createGoogleWorkspaceCliAdapter } from "@arnilo/prism-core/integrations/work/google-workspace";

const microsoft365 = createMicrosoft365CliAdapter({
  binary: process.env.M365_BIN!,
  configDir: `/var/prism/m365/${tenant}/${user}`,
  identity,
  // Optional late-bound per-identity token (0.0.14): env var only, never argv/model context.
  // tokenProvider: createOAuthWorkTokenProvider({ provider: m365OAuth, store, envVar: "M365_ACCESSTOKEN" }),
});

const googleWorkspace = createGoogleWorkspaceCliAdapter({
  binary: process.env.GWS_BIN!,
  configDir: `/var/prism/gws/${tenant}/${user}`,
  identity,
  // allowedOps: add docs.create / sheets.create / slides.create when gated
});

const tools = createWorkTools({
  microsoft365,
  googleWorkspace,
  idempotencyStore: createMemoryIdempotencyStore(),
  approval: { isApproved: ({ draftId }) => hostHasApproved(draftId) },
  externalRecipients: { allow: (addr) => addr.endsWith("@contoso.com") },
});
```

List/get tools return shared `WorkPage` / `WorkMailMessage` / `WorkCalendarEvent` / `WorkFileItem` / `WorkTaskItem` shapes (`untrusted: true`) via package normalizers — provider-specific fields are not hidden; they are mapped onto the common denominator.

### Hard-coded Microsoft 365 ops

Verified against [CLI for Microsoft 365](https://pnp.github.io/cli-microsoft365/) (2026-07-23):

| Prism op | CLI |
| --- | --- |
| `mail.list` | `m365 outlook message list --output json` |
| `mail.get` | `m365 outlook message get --output json --id …` |
| `mail.send` | `m365 outlook mail send --output json --to … --subject … --bodyContents …` |
| `calendar.list` | `m365 outlook event list --output json` |
| `calendar.add` | `m365 outlook event add --output json --subject … --start … --end …` |
| `file.list` | `m365 file list --output json --webUrl … --folderUrl …` |
| `file.add` | `m365 file add --output json --folderUrl … --filePath …` |
| `file.share` | `m365 spo file sharinglink add` (`--scope organization` only) |
| `todo.*` / `planner.*` | capability-gated via `allowedOps` |

### Hard-coded Google Workspace ops

Verified against [`@googleworkspace/cli` / `gws`](https://github.com/googleworkspace/cli) (2026-07-24):

| Prism op | CLI |
| --- | --- |
| `mail.list` | `gws gmail users messages list --params … --fields …` |
| `mail.get` | `gws gmail users messages get --params …` |
| `mail.send` | `gws gmail +send --to … --subject … --body …` |
| `calendar.list` | `gws calendar events list --params … --fields …` |
| `calendar.add` | `gws calendar events insert --params … --json …` |
| `file.list` | `gws drive files list --params … [--page-all]` (NDJSON when paginated) |
| `file.add` | `gws drive files create --json … --upload …` |
| `file.share` | `gws drive permissions create` (`type=domain\|user` only; `anyone` denied) |
| `task.*` | `gws tasks tasks list\|insert\|patch` |
| `docs.create` / `sheets.create` / `slides.create` | capability-gated via `allowedOps` |

Startup: M365 `version --output json`; GWS `--version`. Forbidden: `login`, `setup`, `auth`, `schema`, `doctor`, `--debug`, `--verbose`, credentials in argv, anonymous share, model-supplied command strings / free-form Discovery.

### Draft → approve → execute

Mutation tools (`*_mail_draft_send`, `*_draft_*`) create an in-adapter draft and return `{ status: "pending_approval", draftId }` until `approval.isApproved` is true.

### Durable idempotency (0.0.23)

`createMemoryIdempotencyStore()` remains for tests and a single process. For production replicas, use `createPostgresEnterpriseState({ pool }).workIdempotency`. It changes the old `get`/`put` replay abstraction to explicit async state transitions:

| Observable state | Meaning / host action |
| --- | --- |
| absent | `begin()` atomically acquires the first claim. |
| `in_progress` | Another worker owns the claim; do not dispatch a second connector effect. |
| `completed` | Return the bounded stored `{ draftId, resourceId? }` duplicate summary. |
| `failed_retryable` | A later `begin()` may reclaim it within the capped attempt policy. |
| `failed_terminal` | Do not retry; surface the bounded failure. |
| `unknown` | External result is ambiguous; reconcile with the connector/operator through `resolveUnknown()`. Never auto-replay. |

Call `begin({ identity, key, op })` **before** the external effect. After it succeeds, call `complete`, `fail`, or `markUnknown` with the returned claim token and version. The connector effect stays outside the database transaction, so this is claim-before-effect/deduplication—not exactly-once delivery. Claims default to 15 minutes (hard 60 minutes); expired claims transition to `unknown`; attempts default to 3 (hard 5). Stored rows contain no request body, token, raw provider response, or unrestricted payload.

## Subprocess environment isolation (0.2.0, plan 020 Task 3)

`createCliRunner` never inherits the host environment. The child process receives only:

1. **Fixed platform base** — allow-listed locale/system keys copied from the host: `PATH`, `LANG`, `LC_ALL`, `TZ`, `SYSTEMROOT`/`SystemRoot`, `TEMP`, `TMP`, `PATHEXT`, `COMSPEC`. Nothing else from `process.env` crosses the boundary, so unrelated ambient variables (e.g. `PRISM_PROOF_SECRET`) cannot reach the CLI. Additions to the list are deliberate one-line allow-list changes.
2. **Explicit host env** — non-secret values passed via the `env` option (e.g. `{ LANG: "C.UTF-8" }`).
3. **Late-bound per-identity token env** — the `tokenProvider` result, merged per call; never argv, never model context.
4. **Forced reserved controls** — `HOME` is always the isolated `configDir` and `CLIMICROSOFT365_DISABLETELEMETRY` is always `"1"`; neither the explicit map nor the token layer can override them (any attempt fails closed with `ERR_PRISM_WORK_ENV` before spawn).

Environment maps are validated before spawn: NUL-free, `[A-Za-z_][A-Za-z0-9_]*` names, string values, no case-insensitive duplicate or reserved keys (Windows canonicalizes PATH/system key casing so Node's first-lexicographic-key behavior cannot select an attacker-controlled duplicate), and fixed caps of 64 names / 64 KiB total (`ERR_PRISM_WORK_LIMIT`).

### Host-pinned absolute paths

`binary` and `configDir` must be **absolute** paths (`path.isAbsolute`); empty, relative, or NUL-containing values are rejected at construction with `ERR_PRISM_WORK_BINARY` / `ERR_PRISM_WORK_CONFIG` before any spawn.

### Migration (0.1.7 → 0.2.0)

- Any host env your CLI needed beyond the fixed base must move into the explicit `env` map (non-secret) or the per-identity token layer (secrets).
- Relative `binary`/`configDir` values now fail at construction; resolve them to absolute paths.
- Per-call `runOpts.env` keys colliding case-insensitively with `HOME` or the telemetry-disable control now fail closed instead of being silently overridden.
- Output capture is linear: chunks are accumulated in an array with one final `Buffer.concat`, and the process is killed/rejected before bytes beyond the stdout/stderr caps are retained.

## Limits

| Resource | Default / hard |
| --- | ---: |
| Pagination pages | 20 / 100 |
| Items / aggregate | 50/500 ; 200/2000 |
| Body / stdout | 256 KiB–2 MiB / 2–16 MiB |
| Process wall time | 60 s / 10 min |
| Concurrent CLI / identity | 2 / 8 |

## Tool effects

Approved mutations require core-derived `context.idempotencyKey` and a configured store (`effect: external_mutation/tool_managed`). Model-supplied idempotency keys are ignored. Ambiguous connector outcomes stay `unknown` — never auto-replayed (not exactly-once). See [tool effects](tool-effects.md).

## Security

- Require host-verified `AgentIdentity`; no cross-identity configDir reuse.
- Connector tokens (0.0.14): an optional `tokenProvider` resolves a per-identity access token into an env var per call — never argv, never model context. A missing/expired/revoked/cross-identity/wrong-tenant token fails the call closed before any exec. Refresh is late-bound and single-flighted per account (no refresh storm under reconnect). Build one with `createOAuthWorkTokenProvider()` from `@arnilo/prism-core/credentials/node`.
- External mail recipients fail closed unless `externalRecipients.allow` returns true.
- Anonymous / `anyone` sharing denied.
- CLI stdout/stderr capped (linear chunk capture, killed/rejected before bytes beyond the cap are retained); NDJSON page streams strictly parsed and page-capped; process killed on timeout/abort/overflow.
- Subprocess environment isolated (0.2.0): fixed allow-listed base + explicit `env` + late-bound token env; `HOME`/telemetry controls forced; reserved/duplicate/NUL/over-cap env and non-absolute binary/configDir fail before spawn. See [Subprocess environment isolation](#subprocess-environment-isolation-020-plan-020-task-3).

## Related

- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable claim/CAS store, cleanup, and operator reconciliation.
- [Work connectors](work-connectors.md)
- [Agent identity](agent-identity.md)
- [Host security](host-security.md)
- [Credential storage](credential-storage.md)
