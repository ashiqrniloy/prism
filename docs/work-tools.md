# Work tools

Optional `@arnilo/prism-work-tools` package: identity-scoped Microsoft 365 and Google Workspace connectors. Host-pinned CLI binaries only; hard-coded `execFile` argv templates; draft-then-approve mutations; side-effect idempotency; shared mail/calendar/file/task result shapes.

## When to use

Use when agents must read or mutate tenant mail/calendar/files/tasks through the enterprise CLI the host already operates — not through model-built shell strings or generic Graph/Discovery free-form calls.

## Install

```bash
npm install @arnilo/prism-work-tools
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
} from "@arnilo/prism-work-tools";
// or: import { createGoogleWorkspaceCliAdapter } from "@arnilo/prism-work-tools/google-workspace";

const microsoft365 = createMicrosoft365CliAdapter({
  binary: process.env.M365_BIN!,
  configDir: `/var/prism/m365/${tenant}/${user}`,
  identity,
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

Mutation tools (`*_mail_draft_send`, `*_draft_*`) create an in-adapter draft and return `{ status: "pending_approval", draftId }` until `approval.isApproved` is true. Retries with the same `idempotencyKey` return `{ status: "duplicate" }` after first successful execute.

## Limits

| Resource | Default / hard |
| --- | ---: |
| Pagination pages | 20 / 100 |
| Items / aggregate | 50/500 ; 200/2000 |
| Body / stdout | 256 KiB–2 MiB / 2–16 MiB |
| Process wall time | 60 s / 10 min |
| Concurrent CLI / identity | 2 / 8 |

## Security

- Require host-verified `AgentIdentity`; no cross-identity configDir reuse.
- External mail recipients fail closed unless `externalRecipients.allow` returns true.
- Anonymous / `anyone` sharing denied.
- CLI stdout/stderr capped; NDJSON page streams strictly parsed and page-capped; process killed on timeout/abort/overflow.

## Related

- [Work connectors](work-connectors.md)
- [Agent identity](agent-identity.md)
- [Host security](host-security.md)
- [Credential storage](credential-storage.md)
