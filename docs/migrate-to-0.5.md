# Migrate Prism 0.4 to 0.5

> **Status: released 2026-09-06** (`v0.5.0` tag). Covers every host-visible change from plan 055 onward: new provider adapters (055), security hardening (056), the dead-export cut (058), dependency majors (062), the MCP 2026-07-28 adoption (063), the CLI real-provider contract (064), and model-aware thinking effort (065).

## What changes

Prism 0.5 is a **lockstep cut**: all 10 publishable manifests move `0.4.x` → `0.5.0` and internal first-party ranges move `^0.4.0` → `^0.5.0`. Package names and import subpaths from 0.4 stay valid; the breaking surface is (1) 27 removed unused exports, (2) the MCP SDK module move, (3) two thinking-effort wire moves, and (4) two hardening behavior changes. Everything else is additive.

## 1. New provider adapters — additive (plan 055, shipped as 0.4.1)

`@arnilo/prism-providers/hyper` and `@arnilo/prism-providers/commandcode` join the first-party catalog (Hyper with chat + `/v1/responses` passthrough + intelligent-routing metadata; Command Code with dual-route chat/Anthropic-Messages and GPT-5.6 explicit caching). No action needed for existing hosts; both adapters follow the standard provider factory contract (`factory({ apiKey })`).

## 2. Security hardening — behavior changes (plan 056)

- **Tenant-aware store factories:** session/memory/enterprise store factory signatures now require an explicit tenant scope — constructing a durable store without a tenant fails closed. Pass the tenant in the factory options (see the store pages under `docs/`).
- **Child process env allow-list:** spawned processes (shell default, LSP client, process sessions, computer-use-linux MCP transport) no longer inherit the ambient `process.env`. A deterministic allow-list (`buildChildEnv` / `DEFAULT_CHILD_ENV_INHERIT`, `src/agent/env.ts`) governs inheritance. If you relied on custom env vars reaching child tools, pass them explicitly through the session/spawn options.

## 3. Dead-export removal — 27 symbols (plan 058, breaking)

Every removed symbol was verified unused (zero in-repo references, no third-party import evidence) and carried `@deprecated` "no replacement" earlier in the same cycle. If your code compiled against 0.4 without importing any symbol below, this section does not affect you.

| package | removed export | kind |
|---|---|---|
| `@arnilo/prism` | `statusFromState` | function |
| `@arnilo/prism` | `isInitProvider` | type-guard function |
| `@arnilo/prism` | `isInitTemplate` | function |
| `@arnilo/prism` | `parseContextFile` | function |
| `@arnilo/prism` | `parseToolFile` | function |
| `@arnilo/prism` | `defaultUserSettingsPath` | function |
| `@arnilo/prism` | `resolveProviderMediaBlock` | async function |
| `@arnilo/prism` | `ProviderSecretLeakConformanceOptions` | interface |
| `@arnilo/prism` | `runToolEffectStoreConformance` | async function |
| `@arnilo/prism-core` | `OidcIdentityVerifierResult` | type alias |
| `@arnilo/prism-core` | `assertDiffLines` | function |
| `@arnilo/prism-core` | `ResolvedPromptLimits` | type alias |
| `@arnilo/prism-core` | `encodeMetadata` | function |
| `@arnilo/prism-core` | `parseListOffsetCursor` | function |
| `@arnilo/prism-core` | `nodeKindOf` | function |
| `@arnilo/prism-memory` | `DEFAULT_MAX_PROMPT_CHARS` | const |
| `@arnilo/prism-memory` | `GRAFT_RESOLVE_ERROR_CODE` | const |
| `@arnilo/prism-memory` | `LinterOptions` | interface |
| `@arnilo/prism-memory` | `ResolvedGraftExtension` | interface |
| `@arnilo/prism-memory` | `WikiCategory` | type alias |
| `@arnilo/prism-coding-tools` | `codingSha256Hex` | function |
| `@arnilo/prism-coding-tools` | `DEFAULT_MAX_REVIEW_DELTA_ENTRIES` | const |
| `@arnilo/prism-coding-tools` | `HARD_MAX_REVIEW_DELTA_ENTRIES` | const |
| `@arnilo/prism-coding-tools` | `indexErrorCode` | function |
| `@arnilo/prism-coding-tools` | `PONYTAIL_PEER_RANGE` | const |
| `@arnilo/prism-coding-tools` | `CavemanSkillName` | type alias |
| `@arnilo/prism-providers` | `withOpenRouterCacheMarker` | function |

Per-symbol local replacements for the two cases where 0.4 docs showed a usage pattern:

- `defaultUserSettingsPath(appName)` → build the path with stdlib:
  `join(homedir(), ".config", appName, "settings.json")` (see
  [`docs/settings-auth-trust-security.md`](settings-auth-trust-security.md)).
- `parseContextFile` / `parseToolFile` → colocated `CONTEXT.md` / tool-descriptor parsing is
  host-owned; parse frontmatter with `parseAgentFile` (kept) plus your own file reading
  (see [`docs/agent-definitions.md`](agent-definitions.md)).

## 4. Dependency majors (plan 062)

- **`pdf-parse` 1.1 → 2.4** (`@arnilo/prism-coding-tools` optional peer): v2 parses in a worker thread and transfers the `data` TypedArray — do not reuse the buffer after `extract`; requires Node ≥ 20.16 (repo engines already `>=20`). Embedded-script execution is hard-disabled (`isEvalSupported: false`). Extracted text is byte-identical to v1 modulo trailing newline.
- **`better-sqlite3` 12 → 13** (`@arnilo/prism-core` optional peer): N-API rewrite with bundled prebuilt binaries (no per-Node rebuild); unsupported platforms compile from source during install. No API removals.
- **`@napi-rs/keyring` 1.x → 2.0** (`@arnilo/prism-core`): locked/inaccessible keychain reads and deletes now **reject** with typed errors (`CredentialStoreLockedError`, `CredentialStoreUnavailableError`) instead of silently resolving `undefined`/`false`. A missing credential still resolves `undefined`. If you treated a locked keychain as an empty vault, handle the typed errors.

## 5. MCP: TypeScript SDK v2 modular adoption (plan 063, breaking for MCP hosts)

`@arnilo/prism-mcp` replaces the monolithic `@modelcontextprotocol/sdk` 1.30.0 with the modular v2 packages (`@modelcontextprotocol/client` + `@modelcontextprotocol/server` 2.0.0 exact pins). Prism's public surface (`createPrismMcpServer`, `createPrismMcpWebHandler`) keeps its shape; hosts that imported SDK types directly must move to the v2 module imports. Highlights: modern client negotiation, SDK-managed routing headers (SEP-2243), MRTR-compatible elicitation, dual-era HTTP/stdio serving, 2026-07-28-conformant OAuth (issuer-keyed storage, RFC 9207 `iss` validation). Draft-era task vocabulary fails closed. Full migration table + legacy-session timeline: [`docs/migration.md`](migration.md), canonical API in [`docs/mcp-tools.md`](mcp-tools.md).

## 6. CLI real-provider contract (plan 064)

`prism --provider <id>` runs real providers: ids resolve through the init provider catalog (`templates/init/providers.json`), the factory is imported from the installed `@arnilo/prism-providers/*` package, and the credential comes from the catalog's env var. `--mode print|json|rpc` all honor it. **Contract change:** omitting `--provider` fails with a usage error (exit 2) — the mock provider runs only on explicit `--provider mock`. The RPC session factory is async-capable (`AgentSession | Promise<AgentSession>`).

## 7. Model-aware thinking effort (plan 065, two wire moves)

Thinking/reasoning effort is now model-aware, declared, and snapped: every reasoning-capable model in a first-party catalog declares `capabilities.thinkingLevels` and a `compat.thinkingFamily` stamp, and one adapter resolves, snaps, and merges the level.

Breaking / behavior changes:

1. **Anthropic Messages: `effort` → `output_config.effort`.** Prism emits `output_config: { effort }` (the `output_config_effort` family). Hosts hand-building `compat.effort` / `compat.reasoning_effort` keep working (resolver reads the aliases); hosts *reading* emitted bodies must look at `output_config.effort`. Thinking is generation-aware: 4.6+ models map bare `enabled` to `adaptive`; legacy 4.5 models get `enabled` + `budget_tokens` default 10000 (bare `enabled` without a budget is rejected upstream).
2. **xAI now sends `reasoning_effort`** (previously dropped): grok-4.6 `low/medium/high/xhigh`, grok-4.5 `low/medium/high`, grok-4.3 `none/low/medium/high`; out-of-set values snap. `grok-build` and unknown models pass through verbatim. `reasoning_content` replay is unchanged.
3. **Snapping replaces silent drop** on declared models: out-of-set portable levels snap to the nearest declared level (ladder distance, ties up; below-minimum snaps up). Provider-documented tables (DeepSeek, Z.AI GLM-5.2/5.3, Kimi K3, ClinePass slot maps) remain wire authority. Opaque strings on reasoning-capable models still pass through.
4. **Azure / Vertex / Bedrock forward thinking compat** through a sanitized forwarder (`reasoning_effort` + aliases, or `reasoning` object with `summary` preserved). Unrecognized compat keys are dropped, not leaked. Hand-built `options.extra` workarounds can become `compat`.

New surface on `@arnilo/prism`:

| Export | Purpose |
|---|---|
| `applyThinkingLevelForModel(base, level, model)` | One-call adapter: family resolution + snap + merge — prefer over `applyThinkingLevel` |
| `parseThinkingLevel(value)` | Known level → canonical; other string → opaque passthrough; empty/non-string → `undefined` (fail closed) |
| `isSupportedThinkingLevel(model, level)` | Is the level in the model's declared set |
| `thinkingLevelsForModel(model)` | Declared set or `undefined` |
| `snapThinkingLevel(model, level)` | Snap to the declared set (nearest, ties up) |

New compat families: `google` (`{ thinkingLevel }`) and `output_config_effort` (`{ output_config: { effort } }`). Family inference is stamp-first via `compat.thinkingFamily`.

What to do:

1. Replace `applyThinkingLevel(base, level, family)` call sites with `applyThinkingLevelForModel(base, level, model)`.
2. Gate level pickers on `model.capabilities?.thinkingLevels` when present.
3. Update any body assertion reading Anthropic top-level `effort` to `output_config.effort`.
4. Remove xAI "never send reasoning_effort" workarounds.
5. Nothing else: `mergeProviderRequestOptions`, `RunOptions`, and persisted shapes are unchanged.

Contract reference: [`docs/thinking-and-reasoning.md`](thinking-and-reasoning.md); per-provider declared levels + wire fields on each `docs/providers/*.md` page.

## Upgrade steps

1. Bump every `@arnilo/*` dependency/peer to `^0.5.0`.
2. Build; if the compiler flags a removed symbol above, apply the replacement from the table.
3. If you host MCP: move SDK imports to the v2 modular packages (section 5).
4. If you spawn child processes with ambient env: pass env explicitly (section 2).
5. If you construct durable stores: pass the tenant scope (section 2).
6. If you set thinking levels: move to `applyThinkingLevelForModel` (section 7).
7. Run your suite. No persisted-data migration exists or is needed.

## Rollback

Pin the previous version: `@arnilo/prism@0.4.x` (exact pins per package). Nothing persisted
changes under 0.5, so a pin rollback is safe. The MCP module move (section 5) is the only
migration that touches host import code — keep a 0.4 pin if you need the monolithic SDK.
