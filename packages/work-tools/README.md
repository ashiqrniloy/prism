# @arnilo/prism-work-tools

Optional identity-scoped Microsoft 365 / Google Workspace connectors for Prism.

## Install

```bash
npm install @arnilo/prism-work-tools
```

Host must install CLIs separately (`@pnp/cli-microsoft365`, `@googleworkspace/cli`) and pass pinned **absolute** binary paths (`path.isAbsolute`; relative/empty/NUL values fail at construction). Prism never shells model-built commands.

**Isolated subprocess environment (0.2.0):** children never inherit the host environment. They receive a fixed allow-listed base (`PATH`, `LANG`, `LC_ALL`, `TZ`, `SYSTEMROOT`/`SystemRoot`, `TEMP`, `TMP`, `PATHEXT`, `COMSPEC`), your explicit non-secret `env` map, and the late-bound per-identity token env. `HOME` is forced to the isolated `configDir` and `CLIMICROSOFT365_DISABLETELEMETRY` to `"1"`; overrides, duplicates, NUL, and over-cap (64 names / 64 KiB) env fail closed before spawn. `configDir` must also be absolute. See [Subprocess environment isolation](../../docs/work-tools.md#subprocess-environment-isolation-020-plan-020-task-3) for the migration from 0.1.7 ambient-env behavior.

## Microsoft 365

```ts
import { createWorkTools, createMicrosoft365CliAdapter, createMemoryIdempotencyStore } from "@arnilo/prism-work-tools";
// or: import { createMicrosoft365CliAdapter } from "@arnilo/prism-work-tools/microsoft365";

const microsoft365 = createMicrosoft365CliAdapter({
  binary: "/usr/local/bin/m365",
  configDir: "/var/prism/m365/tenant-a/user-1",
  identity,
});
```

## Google Workspace

```ts
import { createGoogleWorkspaceCliAdapter } from "@arnilo/prism-work-tools/google-workspace";

const googleWorkspace = createGoogleWorkspaceCliAdapter({
  binary: "/usr/local/bin/gws",
  configDir: "/var/prism/gws/tenant-a/user-1",
  identity,
});

const tools = createWorkTools({
  microsoft365,
  googleWorkspace,
  idempotencyStore: createMemoryIdempotencyStore(),
  approval: { isApproved: async ({ draftId }) => hostApproved(draftId) },
  externalRecipients: { allow: (addr) => addr.endsWith("@contoso.com") },
});
```

Hard-coded GWS ops (docs-verified): Gmail list/get/+send, Calendar list/insert, Drive list/create/permissions, Tasks list/insert/patch; Docs/Sheets/Slides create gated. `--page-all` NDJSON strictly parsed. `auth`/`schema`/anonymous share rejected.

Shared normalizers map both providers onto `WorkMailMessage` / `WorkCalendarEvent` / `WorkFileItem` / `WorkTaskItem`.

Mutations create drafts first; CLI side effects run only after `approval.isApproved`. Credentials never appear in argv. Optionally pass a `tokenProvider` (0.0.14, e.g. `createOAuthWorkTokenProvider()` from `@arnilo/prism-credentials-node`) to inject a late-bound per-identity token via env var per call — never argv/model context; a missing/expired/revoked/cross-identity token fails the call closed before any exec.

## Durable idempotency (0.0.23)

`createMemoryIdempotencyStore()` is a single-process/test adapter. For replicas, pass `createPostgresEnterpriseState({ pool }).workIdempotency` to `createWorkTools`. It atomically claims before connector dispatch and exposes `begin` → `complete` / `fail` / `markUnknown` transitions guarded by claim token plus version. Only `completed` mutations replay their bounded summary. `unknown` is an ambiguous external effect and must be reconciled with `resolveUnknown`; never auto-replay it. This is deduplication, not exactly-once delivery.

See [Work tools](../../docs/work-tools.md) and [Enterprise PostgreSQL state](../../docs/enterprise-postgres-state.md).

## Limits

Defaults / hard caps match Phase 8 freeze (pagination 20/100, stdout 2/16 MiB, timeout 60s/10min, concurrency 2/8).
