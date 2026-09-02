# Graft context-graph integration

## What it does

`@arnilo/prism-memory/graft` is an optional subpath that wires [nanonets/graft](https://github.com/nanonets/graft) — a repository context-graph CLI (`graft/` directory, INDEX.md orientation, symbol-level wiring graph) — into Prism contribution contracts.

It registers six pull tools backed by the graft CLI (`--json`, argv-safe), a push-mode retrieval-pack context provider plus first-turn orientation injector carried on the `graft` skill, commands (`graft`, `graft-build`, `graft-check`, `graft-viz`), and an edit-watch middleware that computes blast radius after mutating tool calls. Import is inert; a missing graft CLI fails closed at `setup` with a bounded redacted error.

## When to use it

Use it when a host wants agents to locate code by architecture, callers, and coupling before grep-spelunking. Three modes:

- `"pull"` (default) — register the tools; the agent decides when to query.
- `"push"` — per-turn retrieval pack (pointers only) + first-turn orientation, injected automatically.
- `"both"` — everything.

Install optional peer `@nanonets/graft@^0.16.0` **or** pass `packageRoot`/`cliPath` explicitly. Pair with progressive disclosure: the `graft` skill body stays small; tool schemas carry the details. Graft complements indexed code search (`repository_search`): graph/semantic locators vs literal search — neither replaces the other.

Zero-code alternative (L0): hosts can skip this package entirely and let agents call `graft <command> --json` through their shell tool, optionally seeding context with graft's own generated instruction files. This package exists for native-tool ergonomics, budgeted subprocesses, session persistence, and push mode.

## Inputs / request

`createGraftExtension(options)`:

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `cliPath` / `packageRoot` | `string` | no | Explicit stub/binary or checkout root with a manifest-declared bin; default resolves optional peer `@nanonets/graft`. Relative paths rejected; explicit paths existence-checked at resolve time. |
| `mode` | `"pull" \| "push" \| "both"` | no | Surface selection. Default `pull`. |
| `projectDir` | `string` | no | Directory graft operates on. Default `process.cwd()` at setup. |
| `retrievalBudgetMs` | `number` | no | Wall-clock budget per CLI child call (default 8000). |
| `maxResultBytes` | `number` | no | Stdout cap before parsing (default 512 KiB). |
| `maxPromptChars` | `number` | no | Prompts longer than this never become ask argv (default 4096). |
| `allowUpstreamTelemetry` | `boolean` | no | Default false → children run with `DO_NOT_TRACK=1`. |
| `providerEnv` | `Record<string, string>` | no | Explicit graft provider settings (`GRAFT_API_KEY`, …). Never inherited from host env; only `GRAFT_*` keys reach the child. |
| `editToolNames` | `readonly string[]` | no | Tools triggering blast-radius lookup. Default `write`, `edit`, `move`. |
| `quietStartup`, `hideStatus` | `boolean` | no | Suppress startup status events / status reporting. |
| `appendEntry` | `(entry, opts?) => Promise<void>` | yes | Host session append (OM attach pattern). |
| `getEntries` | `() => readonly SessionEntry[] \| Promise<...>` | yes | Current branch entries for state restore. |

Pull tools (mode includes `pull`): `graft_ask`, `graft_grep`, `graft_callers`, `graft_skeleton`, `graft_map`, `graft_blast`.

Push surfaces (mode includes `push`): skill `graft` carrying context provider `graft-context` (per-turn pointers-only pack, gated: ≥12-char prompt, dedup by seen node ids, 32 KiB block ceiling) and instruction injector `graft-orient` (`first_turn`, byte-capped INDEX.md cut + staleness banner).

Registered commands: `graft` (`status` \| `build` \| `check` \| `viz` dispatch), plus `graft-build`, `graft-check`, `graft-viz` aliases.

## Outputs / response / events

| Export | Purpose |
| --- | --- |
| `createGraftExtension(options)` | Returns an inert `Extension` until `kernel.load([...])`; emits `graft:loaded` on setup. |
| `resolveGraftCli(options)` | Fail-closed CLI resolution (`explicit` → command+argv, `peer-bin` → node + manifest bin). |
| `runGraftJson(cli, argv, options)` / `childEnv(options)` / `childTimeoutMs` / `DEFAULT_MAX_RESULT_BYTES` | Shared budgeted JSON runner for hosts building custom surfaces. |
| `readBoundedFile` / `redactPaths` / `GraftResolveError` | Bounded-read and redaction helpers. |

Events: `graft:status` (check/build outcomes), `graft:dirty` (post-edit, repo-relative path + optional `staleCountEstimate`), `graft:loaded` (mode + cliKind metadata).

Session custom entry shape (`data.type === "graft-state"`, CAS via `expectedParentId`):

```json
{ "kind": "custom", "data": { "type": "graft-state", "freshness": { "checkedAt": "...", "fresh": true }, "seen": ["node-a"], "savedTokensApprox": 120 } }
```

The graph never rebuilds itself mid-session (no auto-rebuild): after edits, ask/grep results may lag one turn; graft self-refreshes on the next indexed query, or run `/graft build` for an immediate refresh. The skill text states this contract to the agent.

## Request/response example

Tool call (pull):

```json
{ "name": "graft_ask", "arguments": { "query": "where is auth handled?", "count": 3 } }
→ { "nodes": [{ "id": "auth-guard", "title": "requireAuth", "path": "src/auth.ts", "line": 41 }] }
```

Status event:

```json
{ "type": "graft:status", "extension": "@arnilo/prism-memory/graft", "metadata": { "fresh": true, "missing": 0, "stale": 2 } }
```

## Implementation example

See [`examples/graft-extension.ts`](../examples/graft-extension.ts) — network-free demo against the package fixture stub: one pull-tool call, one push turn with pack injection + dedup, one simulated edit producing blast radius, and the `DO_NOT_TRACK` child-env guard.

```ts
import { createExtensionKernel, createMemorySessionStore } from "@arnilo/prism";
import { createGraftExtension } from "@arnilo/prism-memory/graft";

const store = createMemorySessionStore();
const kernel = createExtensionKernel({ errorPolicy: "throw" });
await kernel.load([
  createGraftExtension({
    packageRoot: "./vendor/graft-checkout",
    mode: "both",
    quietStartup: true,
    appendEntry: async (entry, options) => store.append(entry, options),
    getEntries: async () => store.list("s1"),
  }),
]);
// Pull: dispatch graft_ask/… tools. Push: runs assemble the skill-carried
// provider + graft-orient injector. Edits: middleware emits graft:dirty.
```

## Extension and configuration notes

- Import alone registers nothing (`sideEffects: false`); no timers, watchers, or network. The only child processes are budgeted graft CLI calls.
- Retrieval happens in-process via Prism primitives (context provider, injector, tool_result middleware) — no external hook shims.
- Ask result shape is parsed tolerantly (`nodes|results|matches|hits`) because graft is pre-1.0; formatters emit pointers (`title` + `file:line` + `[[wikilink]]`), never source bodies.
- Not included in `@arnilo/prism-code`, `@arnilo/prism-sdk`, or the `prism-all` umbrella (deliberate opt-out, like Caveman/Ponytail) — opt-in install only.
- Multi-repo layouts work as upstream graft defines them (workspaces, submodules with `--follow-submodules`, sibling repos); point `projectDir` at the graft root that owns the target repo.

## Security and performance notes

- Telemetry default-off: children always get `DO_NOT_TRACK=1` unless `allowUpstreamTelemetry` is true; child env is fixed-base — host env vars are never inherited, and only explicit `GRAFT_*` keys from `providerEnv` pass through. Route secrets like `GRAFT_API_KEY` through the host's credential resolution when populating `providerEnv`.
- Upstream output is untrusted: stdout capped (`maxResultBytes`), prompts capped (`maxPromptChars`), injected packs bounded (32 KiB), orientation cut byte-capped (8 KiB); error paths are logged redacted (absolute paths/home dirs).
- Every CLI call is wall-clock-budgeted (`retrievalBudgetMs`, minus fixed overhead for the timeout math) and every failure degrades silently: pull tools return structured errors, the push pack contributes nothing, edit-watch passes the tool result through untouched.
- No background workers; state persists through two CAS appends per turn at most (freshness patch, seen-set/saved-tokens update).

## Related APIs

- [Ponytail behavior integration](ponytail.md): same adapter pattern (optional peer/upstream path, fail-closed setup, session custom entries).
- [Caveman behavior integration](caveman.md): complementary terse-communication mode package.
- [Indexed code search](indexed-code-search.md): literal `repository_search` seam — complement, not overlap.
- [Context and skills](context-and-skills.md): progressive catalog + `load_skill`; skill-carried context providers.
- [Instruction injection](instruction-injection.md): injector seams (`graft-orient` rides `first_turn`).
- [Extension kernel and event bus](extensions.md): explicit `kernel.load`, extension events.
