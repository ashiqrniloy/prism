# Versioned prompt registry

## What it does

The optional `@arnilo/prism-prompts` package stores prompt assets as immutable, content-hashed versions. It provides a memory store plus SQLite and PostgreSQL adapters. The registry returns prompt data; it does not compose system-prompt layers, evaluate prompt quality, discover files, or activate text.

## Inputs / request

```ts
import { createMemoryPromptStore } from "@arnilo/prism-prompts";

const store = createMemoryPromptStore();
const version = await store.put({
  tenantId: "tenant-1",
  name: "support-agent",
  body: "Answer support questions briefly.",
  labels: ["production"],
  metadata: { owner: "support" },
});
```

`put` always appends the next version for one ownership/name scope. It computes `hash` as `sha256:<64 lowercase hex>` over exact UTF-8 body bytes. Records, labels, and JSON metadata are frozen before return.

Ownership fields (`tenantId`, optional `accountId` and `userId`) are direct fields on every operation. Omitted ownership is a separate local scope, never a wildcard over tenant-owned rows.

## Outputs / response / events

```ts
const latest = await store.resolve({ tenantId: "tenant-1", name: "support-agent" });
const production = await store.resolve({ tenantId: "tenant-1", name: "support-agent", label: "production" });
const exact = await store.resolve({ tenantId: "tenant-1", name: "support-agent", version: 1 });

for (let page = await store.list({ tenantId: "tenant-1", name: "support-agent", limit: 50 });; ) {
  consume(page.items);
  if (!page.nextCursor) break;
  page = await store.list({ tenantId: "tenant-1", name: "support-agent", cursor: page.nextCursor, limit: 50 });
}

const diff = await store.diff({ tenantId: "tenant-1", name: "support-agent", fromVersion: 1, toVersion: 2 });
```

`resolve` returns the latest version by default, or the latest version carrying `label`; exact `version` can be combined with a label. `list` uses bounded keyset cursors ordered by name/version. `diff` returns bounded `context`/`add`/`remove` lines plus `added`, `removed`, and `truncated` counts. The host decides how a resolved body enters the existing `composeSystemPrompt` layers.

## Run provenance

Pass the resolved version's identity to a run so every ledger record answers "which prompt version produced this output":

```ts
const resolved = await store.resolve({ tenantId, name: "support-agent" });
await session.run(input, {
  promptVersion: { name: resolved.name, version: resolved.version, hash: resolved.hash },
});
```

The ref is opaque identity — name, version number, and the store's SHA-256 body hash — never prompt content. It rides on the start/finish `RunRecord`s, round-trips through first-party SQLite/PostgreSQL run rows (`prompt_version` column, schema migration `009_run_prompt_version`), and stays subject to the existing ledger redaction and field-policy boundaries. See [Runs and usage](runs-and-usage.md#prompt-provenance).

## Durable adapters

```ts
import { createSqlitePromptStore } from "@arnilo/prism-prompts";
const sqlite = createSqlitePromptStore({ filename: "./prompts.db" });

import { createPostgresPromptStore } from "@arnilo/prism-prompts";
const postgres = await createPostgresPromptStore({
  connectionString: process.env.DATABASE_URL,
  schema: "prism",
});
```

SQLite uses `better-sqlite3`; PostgreSQL uses a caller-supplied or adapter-owned `pg` pool. Both adapters use the package-owned `prism_prompts` and `prism_prompt_labels` tables, exact ownership predicates, bound values, and an indexed label lookup. Startup applies checked `001_init` migration history and refuses checksum drift. SQLite exposes `applySqlitePromptMigrations` for managed setup tests; PostgreSQL migration setup is guarded by `pg_advisory_xact_lock`.

## Eval-gated promotion

`assertPromptPromotion` composes [evaluations](evaluations.md) with the store to answer one question — should this candidate version replace the baseline? It resolves both versions (read-only), runs them head-to-head over a dataset through `runComparison`, and returns a typed verdict. It never promotes anything, writes nothing, and never touches a live agent:

```ts
import { assertPromptPromotion } from "@arnilo/prism-prompts";

const v = await assertPromptPromotion({
  store,
  name: "support-agent",
  candidate: { label: "candidate" },   // or an exact version
  baseline: { label: "production" },   // must resolve to a different version
  dataset,
  scorers,
  run: (prompt) => hostRunnerFactory(prompt.body), // host bridge: body → candidate
  minimumWinRate: 0.8,                 // optional; default gate is a strict win majority
  thresholds: { maximumFailures: 0 },  // optional; forwarded to assertEvaluationThreshold
});
if (v.verdict === "promote") await store.put({ ...hostInput, body: v.candidate.body, labels: ["production"] });
```

The verdict carries `promote`/`hold`, per-scorer `wins/losses/ties/failures`, `winRate`, the raw `ComparisonReport`, a redacted bounded `reportJson` (`serializeEvaluationReport`), and `reasons` on hold. The default gate holds unless the candidate wins strictly more scored comparisons than the baseline; `minimumWinRate` and `thresholds` add stricter gates, and threshold equality passes. Requires the optional peer `@arnilo/prism-evals` (install it or the helper fails closed with `ERR_PRISM_PROMPT_EVALS_PEER`). Promotion itself stays a host decision: applying the verdict means `put`-ing a new version with labels — the helper never does.

## Limits and security

Names, bodies, labels, metadata, cursors, pages, and diffs have finite defaults and hard caps. Prompt bodies are data: no evaluation, template execution, file discovery, or implicit layer injection occurs. Store body hashes are integrity checks; a durable row whose hash no longer matches its body fails closed. Never put credentials or provider clients in prompt metadata.

Threat model: the registry is **host-trusted data**. Anyone who can write versions into the store is inside the trust boundary — `put`, label management, and `assertPromptPromotion` verdicts are host operations, never agent-reachable surfaces. Untrusted prompt-injection defense stays at Prism's existing untrusted-content boundaries (tool results, attachments, and provider output), which the store neither bypasses nor weakens: a resolved body enters the system-prompt layer exactly like a host-authored constant. The optional `@arnilo/prism-evals` peer is only loaded by `assertPromptPromotion` and never makes the store itself depend on evaluation infrastructure.

## Related APIs

- [System prompts](system-prompts.md): existing explicit layering and file adapters.
- [Input and prompt assembly](input-and-prompt-assembly.md): host-controlled message/context assembly.
- [Evaluations](evaluations.md): bounded evaluation primitives; `assertPromptPromotion` composes `runComparison` + `assertEvaluationThreshold`.
- [Database persistence](database-persistence.md): persistence and ownership conventions.
