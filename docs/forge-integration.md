# GitHub forge integration

## What it does

`createGitHubForge` is an optional host-activated adapter in `@arnilo/prism-coding-agent` for the six **proven** GitHub operations: issue context read, authenticated push, pull-request create/update, review comments, and check/status retrieval, plus bounded handoff reconciliation. It is GitHub-first by freeze decision — there is no multi-forge generic abstraction, and no octokit dependency: HTTP uses Node's global `fetch` with a bounded streaming reader, timeout, and rate-limit backoff; push reuses the existing `BoundGitRunner` with the token injected via `GIT_CONFIG_*` environment variables (`http.extraHeader`) — never argv, never persisted, never in logs/events. Every mutation flows through Phase 8 approval (`ExecutionPolicy`) and Phase 7 `ToolEffectStore` idempotency keys; a retry after a completed call returns the existing record instead of duplicating the PR or comment.

| Export | Purpose |
| --- | --- |
| `createGitHubForge(options)` | Build a `ForgeOperations` adapter bound to one `"owner/repo"`. |
| `ForgeOperations` | `issueContext` / `push` / `createPullRequest` / `updatePullRequest` / `createReviewComment` / `checks` / `reconcileHandoff`. |
| `ForgeIssueContext` / `ForgePullRequest` / `ForgeCheck` | Bounded response shapes (state, head/base, url, check status/conclusion). |
| `ForgeHandoffReport` | Push/PR/check state, commits, changed paths, diffstat, warnings; never auto-merges. |
| `ForgeError` | Typed failures: `ERR_PRISM_FORGE_AUTH` / `_API` / `_STALE` / `_RATE_LIMIT` / `_LIMIT` / `_OWNERSHIP`. |
| `resolveForgeLimits` / `DEFAULT_MAX_FORGE_*` / `HARD_MAX_FORGE_*` | Pages per operation, payload bytes, comments, concurrency ceiling, request timeout. |

## When to use it

Use when a coding agent needs to open/update PRs, comment on reviews, push a branch with scoped credentials, or verify handoff state against GitHub before deciding the next step. Do not use as a general GitHub SDK, an auto-merge engine (`reconcileHandoff` never merges), or a replacement for host-owned App installation flows — the adapter resolves credentials through the host's `CredentialResolverSource`-compatible resolver and never stores them.

```ts
import { createGitHubForge } from "@arnilo/prism-coding-agent";

const forge = createGitHubForge({
  credentials: { name: "github", resolver: myCredentialResolver }, // App installation token preferred; PAT allowed
  repository: "acme/repo",
  cwd: workspaceRoot, // local checkout for push
  git: { gitPath: "/usr/bin/git" },
  policy, // mutations gated here; denials propagate as ERR_PRISM_EXECUTION_DENIED, no request attempted
  effectStore, // REQUIRED: idempotency + unknown-outcome recovery
  identity, ownership, sessionId, runId, // durable context for mutation effect keys
});
const pr = await forge.createPullRequest({ head: "feature/x", base: "main", title: "Add x", body: "Closes #1" });
const report = await forge.reconcileHandoff({ base: "main", head: "feature/x" });
```

## Inputs / request

`createGitHubForge` options:

| Field | Type | Purpose |
| --- | --- | --- |
| `credentials` | `ForgeCredentialResolverSource` | `{ name, resolver }`; resolver is called per request with `provider: "github"` and `metadata.repository`. |
| `repository` | `string` | `"owner/repo"`, validated at construction and immutable per instance. |
| `cwd` | `string` | Local checkout the adapter pushes from. |
| `git` | `CreateGitRunnerOptions \| BoundGitRunner` | Reused for authenticated push (`git push origin <ref>`). |
| `policy?` | `ExecutionPolicy` | Every mutation is gated (`kind: "forge"`, risk `high`) before any network or git call. |
| `effectStore` | `ToolEffectStore` | **Required.** `begin → markDispatched → execute → complete/fail` per mutation. |
| `identity?` / `ownership?` / `sessionId?` / `runId?` | durable context | Required for mutations; without them mutations fail closed with `ERR_PRISM_FORGE_LIMIT`. Tenant mismatch fails at construction with `ERR_PRISM_FORGE_OWNERSHIP`. |
| `limits?` | `ForgeLimits` | Pages per operation (default 10, hard 100), payload bytes (1 MiB / 8 MiB), comments per review (100 / 1000), request concurrency ceiling (4 / 8), timeout (30 s / 120 s). |
| `fetch?` | `typeof fetch` | Host-injectable fetch (defaults to `globalThis.fetch`); route through an egress proxy or inject a mock in tests. |

Mutation inputs are validated before any request: refs must not start with `-` or contain NUL/newlines and fit the git ref cap; numbers must be positive integers; PR title/body and comment body are required and bounded by `payloadBytes`. `updatePullRequest` with no fields to change fails closed.

## Outputs / response / events

- `issueContext({ number })` → `ForgeIssueContext` (title, state, body, labels, author, updatedAt, url). Read-only; no policy gate, no effect record.
- `push({ refspec? })` → `{ remoteRef }` (`refs/heads/<branch>`). Resolves the current branch with `git rev-parse` when no refspec is given. Token reaches git as `GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic <base64(x-access-token:<token>)>"`; argv carries only `git push origin <ref>`.
- `createPullRequest({ head, base, title, body })` → `ForgePullRequest`. Idempotent twice over: the effect key replays completed results, and a 422 `"already exists"` response fetches and returns the open PR instead of failing.
- `updatePullRequest({ number, title?, body?, state? })` → `ForgePullRequest`. 422 (stale head/base) maps to `ERR_PRISM_FORGE_STALE`.
- `createReviewComment({ number, path, line, body })` → `{ id }`. Retry with identical args replays the completed effect — no duplicate comment.
- `checks({ ref })` → `ForgeCheck[]`: check-runs plus commit statuses, deduped by name, paginated up to `pagesPerOperation`.
- `reconcileHandoff({ base, head })` → `ForgeHandoffReport`: `pushed`, `aheadBy`/`behindBy`, `alreadyUpToDate`, `alreadyMerged`, `pullRequest?`, `checks`, bounded `commits`/`changedPaths`/`diffstat`, `warnings`. A missing head ref reports `pushed: false` with a warning. Never pushes, opens, or merges — the host decides next steps from the report.

Every mutation result is recorded in the `effectStore` with a stable key derived from tenant + session + run + operation + canonical arguments. Replay of a completed record returns the stored result; replay of a `dispatched`/`unknown` record fails closed (`ERR_PRISM_FORGE_API`, "requires reconciliation") so a crash mid-mutation never duplicates work — verify actual state via `reconcileHandoff`, then resolve through the store.

## Request/response example

```json
{
  "action": { "kind": "forge", "operation": "create_pull_request", "risk": "high", "metadata": { "repository": "acme/repo", "head": "feature/x", "base": "main" } },
  "decision": { "allowed": true }
}
```

## Implementation example

```ts
import { createGitHubForge } from "@arnilo/prism-coding-agent";

const forge = createGitHubForge({
  credentials: { name: "github-app", resolver },
  repository: "acme/repo",
  cwd: "/srv/jobs/task-1/checkout",
  git: { gitPath: "/usr/bin/git" },
  policy,
  effectStore,
  identity, ownership, sessionId, runId,
});

await forge.push({ refspec: "feature/x" });
await forge.createPullRequest({ head: "feature/x", base: "main", title: "Add x", body: "Closes #1" });
const checks = await forge.checks({ ref: "feature/x" });
const report = await forge.reconcileHandoff({ base: "main", head: "feature/x" });
if (!report.alreadyMerged && report.pushed) {
  // host decides: update PR, comment, or stop — the adapter never auto-merges
}
```

## Extension and configuration notes

Credentials resolve per call through the host resolver; GitHub App installation tokens and PATs are both supported (same `Bearer` REST header and `x-access-token` git header). Least-privilege guidance: App installation tokens with `contents: write` + `pull_requests: write` + `issues: read` cover the six operations; PATs should be fine-grained to the single repository and read/write scope needed. Policy denials propagate as the core `ExecutionDeniedError` (`ERR_PRISM_EXECUTION_DENIED`) — no forge request is attempted — so hosts can distinguish refusal from forge failure. Pagination is sequential (per-request `pagesPerOperation` cap); `requestConcurrency` is a validated ceiling, not a target. The adapter performs no DNS/egress control itself — sandboxed hosts route forge traffic through the Phase 9 egress policy (Task 6).

## Security and performance notes

Tokens never appear in argv, git config files, logs, model context, or stored events: REST uses the `Authorization` header on a bounded `fetch`, and git uses `GIT_CONFIG_*` environment variables scoped to the single push process. Request bodies and responses are bounded by `payloadBytes` (streamed, content-length pre-checked); timeouts and rate-limit backoff respect `requestTimeoutMs` and `Retry-After`; page fetches stop at `pagesPerOperation`. Repository binding is fixed at construction; tenant binding is checked per mutation; ownership mismatch fails closed. Rate-limit responses map to `ERR_PRISM_FORGE_RATE_LIMIT`, 404 to `ERR_PRISM_FORGE_API`, 422 to `ERR_PRISM_FORGE_STALE`, 401/403 to `ERR_PRISM_FORGE_AUTH`, and cap violations to `ERR_PRISM_FORGE_LIMIT`.

## Related APIs

- [Tool effects](tool-effects.md): `ToolEffectStore` idempotency and unknown-outcome recovery used by every forge mutation
- [Coding agent tools](coding-agent-tools.md): `createGitTools`, `createBoundGitRunner`, `createGitOperations` (push rides the same runner)
- [Coding execution approval and sandboxing](coding-security.md): `ExecutionPolicy` gates, egress policy (Phase 9)
- [Host security guide](host-security.md)
- [Performance limits](performance.md)
