# Work connectors

Least-privilege Microsoft 365 and Google Workspace connectors live in `@arnilo/prism-work-tools`.

## Principles

1. **Host-pinned binary** — Prism never downloads or shells an untrusted CLI path.
2. **Hard-coded argv templates** — models choose typed tool args; they never supply command strings.
3. **Draft-then-approve** — mutations create a draft; side effects run only after host approval.
4. **Idempotent retries** — `IdempotencyStore` keyed by identity + operation key.
5. **Isolated config** — per-identity `configDir` (CLI `HOME`); no credential argv.
6. **Shared result shapes** — mail/calendar/file/task list/get tools normalize onto `WorkMailMessage` / `WorkCalendarEvent` / `WorkFileItem` / `WorkTaskItem` without hiding provider-specific ops.

## Microsoft 365

See [Work tools](work-tools.md). Adapter: `createMicrosoft365CliAdapter` / subpath `@arnilo/prism-work-tools/microsoft365`.

Uses [@pnp/cli-microsoft365](https://pnp.github.io/cli-microsoft365/) commands such as `outlook message list|get`, `outlook mail send`, `outlook event list|add`, `file list|add`, `spo file sharinglink add`. To Do / Planner / Teams remain capability-gated.

## Google Workspace

See [Work tools](work-tools.md). Adapter: `createGoogleWorkspaceCliAdapter` / subpath `@arnilo/prism-work-tools/google-workspace`.

Uses [`@googleworkspace/cli` (`gws`)](https://github.com/googleworkspace/cli): `gmail users messages list|get`, `gmail +send`, `calendar events list|insert`, `drive files list|create`, `drive permissions create`, `tasks tasks *`. Docs/Sheets/Slides create remain capability-gated. Discovery `schema` and `auth`/`login`/`setup` are forbidden from Prism argv.

## Scoped OAuth establishment (0.0.14)

Hosts establish, refresh, and revoke scoped OAuth credentials for these workloads through the existing `OAuthProvider` / credential-store seams (`@arnilo/prism-credentials-node`): `createMicrosoft365OAuthProvider` / `createGoogleWorkspaceOAuthProvider` (PKCE + device code), least-privilege scope bundles per capability (`resolveMicrosoft365Scopes` / `resolveGoogleWorkspaceScopes`, read vs mutation). Connectors consume a per-identity token via a late-bound `tokenProvider` injected as an env var — never argv, never model context; revocation fails closed. See [Credential storage](credential-storage.md) and [Work tools](work-tools.md).

## Out of scope

Local Office binaries, model-controlled CLI, generic Graph/Discovery free-form calls, tenant-admin/login/debug from Prism. **Slack/Teams chat-channel adapters are not shipped** (demand-gated until web/AG-UI usage is measured); the M365 `teams` capability op is a separate gated workload op, not a channel adapter.
