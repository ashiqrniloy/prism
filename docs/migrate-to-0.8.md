# Migrate Prism 0.7 to 0.8

> **Status: 0.8.0** (messaging channels, connected apps, work family, durable runs).

This document details migration steps, breaking import-map changes, and compatibility notes for upgrading from Prism 0.7.0 to 0.8.0.

---

## Security Tightenings and Breaking Behavioral Changes

### 1. Work family package move (the only import-map break)

`@arnilo/prism-office` is removed with no pre-1.0 shim. Install `@arnilo/prism-work` next to `@arnilo/prism` and rewrite imports:

| Old import | Replacement |
| --- | --- |
| `@arnilo/prism-office/documents` | `@arnilo/prism-work/documents` |
| `@arnilo/prism-office/sheets` | `@arnilo/prism-work/sheets` |
| `@arnilo/prism-office/diagrams` | `@arnilo/prism-work/diagrams` |
| `@arnilo/prism-core/integrations/work` | `@arnilo/prism-work/connectors` |
| `@arnilo/prism-core/integrations/work/microsoft365` | `@arnilo/prism-work/connectors/microsoft365` |
| `@arnilo/prism-core/integrations/work/google-workspace` | `@arnilo/prism-work/connectors/google-workspace` |
| `@arnilo/prism-core/integrations/work/drafts` | `@arnilo/prism-work/connectors/drafts` |
| `@arnilo/prism-coding-tools/document-reader` | `@arnilo/prism-work/document-reader` |

`createReadTool({ documentReader })` is unchanged: pass a reader from the new subpath. Core keeps the durable adapter at `@arnilo/prism-core/enterprise/postgres` (`createPostgresEnterpriseState({ pool }).workIdempotency`) with type-only structural coupling.

**Match work-idempotency conflicts by `code`, not by error class.** Portable codes stay `ERR_PRISM_WORK_IDEMPOTENCY` and `ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT`. `createMemoryIdempotencyStore()` throws `WorkToolError`; the PostgreSQL adapter throws `EnterprisePostgresError` because `@arnilo/prism-core` cannot depend on `@arnilo/prism-work` at runtime.

#### Migration Actions
- Replace every `@arnilo/prism-office` and `integrations/work` / coding-tools `document-reader` import with the table above.
- Catch work-idempotency by `error.code`.
- Install `@arnilo/prism-work@^0.8.0` (it is one of the eleven lockstep packages).

### 2. Observational-memory workers stay tool-only

Workers (`observer` / `dropper` / `reflector`) keep only `tool_call` provider events. A text-only, thinking-only, or done-only turn is a **successful no-op**: no ledger write from that turn. Mixed text+tools keep the tools. Limit and unknown-tool failures throw `MemoryError` / `MemoryLimitError` (`code`), not an English-prefix match.

#### Migration Actions
- Do not expect assistant prose from a worker turn to become an observation.
- Catch worker-limit failures with `instanceof MemoryError` (or `MemoryLimitError`) / `error.code`, not message prefix.

### 3. Channel lease release is fail-closed

`createMessagingRuntime` clears an in-memory route lease only after the lease store acknowledges `releaseLease`. A store throw increments `storageFailures`, leaves the token on the route, and retries on the next idle/`stop` path. TTL remains the cross-process backstop. An already-delivered reply is not rolled back.

#### Migration Actions
- Treat a failed release as “this process still holds the binding,” not as free.
- Do not log lease tokens.

### 4. AG-UI input authority is opt-in server-side

`CreateAgUiHandlerOptions.inputPolicy.clientState: "ignore"` validates then discards client-supplied AG-UI state and tools before projection, and stops advertising client-provided tools. Default `"honor"` is byte-identical to 0.7.0.

#### Migration Actions
- Hosts that must not trust the browser for tools/state set `inputPolicy: { clientState: "ignore" }`.
- Leave the default if the 0.7.0 honor path is intended.

### 5. Checkpoint foreign-scope reads no longer leak existence

A checkpoint or agent-run status load under a foreign ownership scope is a miss (or a generic CAS conflict), not a distinct “exists but not yours” error. `ERR_PRISM_AGENT_RUN_STATE` covers a missing run and a foreign-scope read.

#### Migration Actions
- Stop catching `Checkpoint ownership mismatch` (or equivalent) as an existence signal.

---

## Additive surfaces (inert unless wired)

### 6. Messaging channels (`@arnilo/prism-channels`)

New eleventh publishable package. Transport-neutral runtime: deny-by-default sender authorization, owned session binding, serialized turns, current-run replies, one-use durable approvals, bounded attachment refs. Official Telegram adapter (private DMs; opt-in granted groups/topics; opt-in streaming drafts in private chats; bounded media; optional voice transcription/synthesis; opt-in notices to one already-bound pair). Experimental Signal adapter (pinned signal-cli, explicit policy gate, UUID DM filtering). See [messaging channels](messaging-channels.md), [Telegram](telegram-channel.md), [Signal](signal-channel.md), [operations](messaging-channel-operations.md).

#### Migration Actions
- Install `@arnilo/prism-channels@^0.8.0` only if the host wants a messaging ingress. Omitted, 0.7.0 hosts are unchanged.
- Host `authorize` stays deny-by-default. Group/topic traffic requires an explicit grant.

### 7. Connected apps and work HTTP

Identity-bound MCP connected-app sessions admit host-selected transports and register prefixed tools. Google Workspace and Microsoft 365 HTTP adapters live under `@arnilo/prism-work/connectors`. Slack MCP wrap and Open Connector sidecar remain examples, not core. See [connected apps](connected-apps.md) and [work connectors](work-connectors.md).

#### Migration Actions
- Wire `connected-apps` only with a host allow-list. Do not add Open Connector / Klavis / Nango as Prism dependencies.

### 8. Durable long runs

`AgentRunStateOptions.checkpointPolicy: "every-turn"` checkpoints at the provider-turn boundary. Host-only `decision: "continue"` resumes a crashed worker (never from AG-UI or the server boundary; rejected while an approval or ready tool call is pending). `RunOptions.turnPolicy` stops at a turn boundary with `stopReason: "host_policy"`. `snapshotRunBundle` returns a frozen redacted digest with zero store or network reads. `createClaimGroundingGuardrail` (stage `"output"`) blocks or flags numeric claims that no tool result or host evidence supports. `ErrorInfo.failureClass` types provider failures; `ModelCapabilities.toolCallStrictness` is advisory. See [durable runs](durable-runs.md), [run bundle](run-bundle.md), [guardrails](guardrails.md).

#### Migration Actions
- Omit `checkpointPolicy` / `turnPolicy` / the claim-grounding guardrail to keep 0.7.0 run behavior.
- `"continue"` is a host decision, not a client action.

### 9. Work sandbox and vendored skills

`@arnilo/prism-work/sandbox` plus `createWorkComposition` run office/exec in an injected Docker sandbox; connectors stay on the host. The package ships `docx`, `xlsx`, `powerpoint`, `pdf` skills. See [work sandbox](work-sandbox.md) and [context and skills](context-and-skills.md).

---

## Operator / release honesty (not a host API break)

- `npm run test:postgres` writes gitignored `scripts/postgres-evidence.json` bound to `git rev-parse HEAD`. `release:gate` reports the Postgres surface as pass only when that evidence matches this tree. A stale phase baseline is **blocked**.
- Coverage artifact keys must equal live workspace package names (`@arnilo/prism-work`, not `@arnilo/prism-office`).

## Upgrade steps

1. Bump every `@arnilo/*` dependency and peer to `^0.8.0` (all **eleven** manifests cut together; a range that only *satisfies* 0.8.0 is refused by the release gate). The published predecessor is 0.7.0.
2. If the host imported `@arnilo/prism-office` or `integrations/work` / coding-tools `document-reader`, apply §1 before building.
3. Adopt §6–§9 only where the host wants channels, connected apps, durable-run checkpoints, or the work sandbox. Omitted, request bytes and tool lists stay 0.7.0.
4. Re-read §2–§5 if the host runs observational-memory workers, messaging channels, AG-UI, or inspects checkpoint ownership errors.
5. Build and run the host suite. No new session-store schema version ships in 0.8.0; channel journals and work HTTP state are new stores a 0.7.0 host never opened.
6. Optional: `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` then `npm run release:gate` to reproduce this-tree Postgres evidence.

## Rollback

Pin the previous published line: `@arnilo/prism@0.7.0` and its siblings, exact pins per package. A 0.7.0 host does not load `@arnilo/prism-channels` or `@arnilo/prism-work`. Channel journal rows and work-package files written under 0.8.0 are invisible to 0.7.0, not rewritten. Session/checkpoint schema is unchanged across 0.7.0 → 0.8.0, so a pin rollback is store-safe for those adapters. Restore `@arnilo/prism-office` only from a 0.7.0 install — that package name is gone on 0.8.0.

Back up channel journals and work-sandbox volumes before a rollback if those 0.8.0 stores hold data you intend to keep.

## Related APIs

- [Migration guide](migration.md): the era index of migration cuts with replacement tables and rollback notes.
- [Migrate Prism 0.6 to 0.7](migrate-to-0.7.md): ACP MCP allow-list, model-router facade refusals, host-completeness additions.
- [Release and install](release-and-install.md): packed surfaces, install rules, support matrix, and the offline test budget.
- [Messaging channels](messaging-channels.md), [Connected apps](connected-apps.md), [Work tools](work-tools.md), [Durable runs](durable-runs.md): owning pages for the 0.8.0 additions.
