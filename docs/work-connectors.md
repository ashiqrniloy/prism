# Work connectors

Least-privilege Microsoft 365 and Google Workspace connectors live in `@arnilo/prism-work/connectors`.

## Principles

1. **Host-pinned binary or HTTP adapter** — Prism never downloads or shells an untrusted CLI path; HTTP adapters use fixed origins and pinned fetch.
2. **Hard-coded operation maps** — models choose typed tool args; they never supply command strings or request URLs.
3. **Draft-then-approve & durable resumption** — mutations create a draft with tracked revisions and payload digests; side effects run only after host approval binds to that exact revision; durable checkpoint persistence survives process restart.
4. **Idempotent retries** — `IdempotencyStore` keyed by identity + operation key.
5. **Isolated config** — per-identity `configDir` (CLI `HOME`); no credential argv.
6. **Shared result shapes** — mail/calendar/file/task list/get tools normalize onto `WorkMailMessage` / `WorkCalendarEvent` / `WorkFileItem` / `WorkTaskItem` without hiding provider-specific ops. Binary file gets return only untrusted artifact/path metadata plus hash and byte length.

## Microsoft 365

See [Work tools](work-tools.md). Adapters: `createMicrosoft365CliAdapter` or `createMicrosoft365HttpAdapter` from `@arnilo/prism-work/connectors`.

The CLI adapter uses [@pnp/cli-microsoft365](https://pnp.github.io/cli-microsoft365/) commands such as `outlook message list|get`, `outlook mail send`, `outlook event list|add`, `file list|add|copy`, `spo file sharinglink add`. The HTTP adapter maps its fixed operation set to `graph.microsoft.com` through pinned fetch; tokens reach it only in `Authorization`. `m365_file_get` accepts only an item ID and downloads via fixed `/me/drive/items/{id}/content` into a scanned artifact and/or contained sandbox path; it never emits bytes to model context. Upload drafts accept a host path, artifact ref, or contained sandbox path and bind the content hash before approval. It requires direct Graph Drive-item URLs for one-request file list/upload/copy and rejects arbitrary SharePoint links. To Do / Planner / Teams remain capability-gated.

## Google Workspace

See [Work tools](work-tools.md). Adapters: `createGoogleWorkspaceCliAdapter` or `createGoogleWorkspaceHttpAdapter` from `@arnilo/prism-work/connectors`.

The CLI adapter uses [`@googleworkspace/cli` (`gws`)](https://github.com/googleworkspace/cli): `gmail users messages list|get`, `gmail +send`, `calendar events list|insert`, `drive files list|create`, `drive permissions create`, `tasks tasks *`, and capability-gated Docs/Sheets/Slides create and fixed update commands. The HTTP adapter maps the same typed operations to Gmail, Calendar, Drive, Tasks, Docs, Sheets, and Slides REST origins with `pinnedFetch`; `gws_file_get` accepts only an item ID and uses fixed `Drive files.get?alt=media`, returning only scanned artifact/path metadata. Its fixed allowlist excludes model-supplied URLs. Docs/Sheets/Slides updates accept only replace/insert text or string-matrix values, never a model-provided batch request array. Discovery `schema` and `auth`/`login`/`setup` are forbidden from Prism argv.

Drive **knowledge synchronization** (RAG import of file text + host-mapped ACL via `changes.list`) is not this CLI adapter. Use `createGoogleDriveConnector` / `syncKnowledge` from `@arnilo/prism-memory/rag` — see [Knowledge synchronization](knowledge-sync.md).

## Scoped OAuth establishment (0.0.14)

Hosts establish, refresh, and revoke scoped OAuth credentials for these workloads through the existing `OAuthProvider` / credential-store seams (`@arnilo/prism-core/credentials/node`): `createMicrosoft365OAuthProvider` / `createGoogleWorkspaceOAuthProvider` (PKCE + device code), least-privilege scope bundles per capability (`resolveMicrosoft365Scopes` / `resolveGoogleWorkspaceScopes`, read vs mutation). Connectors consume a per-identity token via a late-bound `tokenProvider`: CLI adapters inject it into env and HTTP adapters send it only as `Authorization` — never argv or model context; revocation fails closed. See [Credential storage](credential-storage.md) and [Work tools](work-tools.md).

## Out of scope

Local Office binaries, model-controlled CLI, generic Graph/Discovery free-form calls, tenant-admin/login/debug from Prism. **Slack/Teams chat-channel adapters are not shipped** (demand-gated until web/AG-UI usage is measured); the M365 `teams` capability op is a separate gated workload op, not a channel adapter.
