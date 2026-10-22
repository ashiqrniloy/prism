# @arnilo/prism-tools-research

Installing this package gives an agent four research skills, a per-session source ledger, a read-only `cite` tool, and a citation check at the end of a run.

## Install

```bash
prism add @arnilo/prism-tools-research
```

```jsonc
{
  "packages": {
    "@arnilo/prism-tools-research": {}
  }
}
```

Every config field has a default. Set `maxRepairs` or `requireCitations` only when the defaults are wrong.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceTools` | `string[]` | `web_fetch`, `web_search`, `web_extract`, `browser_observe`, `rag_search` | Tool names whose results are ledger sources. A name that is never registered is allowed and noted once. |
| `maxRepairs` | integer `0`–`3` | `1` | Extra model turns used to repair unresolved citations. `0` spends none. |
| `maxSources` | integer `1`–`5000` | `500` | Ledger size at which recording stops. |
| `requireCitations` | boolean | `false` | A report with no `[[cite:<id>]]` markers counts as unresolved. |
| `redactQuery` | `string[]` | `key`, `token`, `api_key`, `access_token`, `sig`, `signature` | Query parameter names stripped before a URL is stored. |

Unknown keys are rejected. `maxRepairs` above 3 and `maxSources` above 5000 are rejected.

## What it changes

- Tools: `cite` (`effects: []`). `cite({ id, quote? })` returns `[[cite:<id>]]` when `id` is in the ledger, or an error result `unknown_source` when it is not. `quote` is not stored.
- Skills: `research-scoping`, `source-triage`, `research-synthesis`, `research-report`, loaded from this package and progressive by default. The report skill tells the model to cite with markers from `cite`.
- Command: `research.verify` → `{ verdict, unresolved, ledgerSize }` for the given session. `verdict` is `pending` until a run ends, then `passed` or `failed`. With no session it returns `pending` and does not throw.
- Hooks: `tool.result` (transform, id `ledger`) and `run.end` (decide, id `citations`). A new source appends `ledger: S<n>` to the tool result. The transcript keeps `value` and drops text content when `value` is set, so the same line is also `value.ledger`.
- Events: `research.citations.unresolved` with `{ unresolved: string[] }` when the check fails after the repair bound.
- Session state: ledger entries `{ id, url | docId, title?, tool, toolCallId, fetchedAt }`. Ids are `S1`, `S2`, … and the same URL reuses its id. One package-state write per new source.

The ledger reads tool results by name. It does not import `tools-web`, `tools-browser`, or `memory-rag`.

## Capabilities

`session-state` — the ledger and the verdict live in per-session package state.

## Cost, security, and failure behavior

Each repair is one extra model turn, bounded by `maxRepairs` (default 1). `maxRepairs: 0` avoids it. The kernel also caps continuations (`limits.maxContinuations`, default 1). Set that ceiling at least as high as `maxRepairs`, or a repair request is dropped and the verdict stays `pending`.

`run.end` continues while repairs remain and a marker does not resolve. The first continue wins, so do not list another `run.end` package (such as `hooks-json`) on the same agent. After the bound, the verdict is `failed` and the package emits `research.citations.unresolved`. It does not throw.

A ledger at `maxSources` stops recording and writes one `warn` status note. A configured source tool that is not registered writes one `info` note. Neither throws.

Ledger entries store the URL, title, tool name, and ids only. Userinfo and the `redactQuery` parameters are stripped. Result bodies and tool arguments are not stored.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import toolsResearch from "@arnilo/prism-tools-research";

const agent = await createAgent({
  model: { provider: "mock", model: "m" },
  packages: [mockProvider(), toolsResearch({ maxRepairs: 0, requireCitations: true })],
});
const session = await agent.session({ id: "report", create: true });
await agent.commands.run("research.verify", {}, { session });
// → { verdict: "pending", unresolved: [], ledgerSize: 0 }
```
