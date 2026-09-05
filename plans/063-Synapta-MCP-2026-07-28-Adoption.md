# Synapta MCP 2026-07-28 Adoption Blueprint

> Repository note: Synapta's MCP implementation is published here as `@arnilo/prism-mcp` under `packages/mcp/`. This blueprint uses current repository/package names when naming files and APIs.

## Objectives

- Move Synapta from `@modelcontextprotocol/sdk` 1.30.0 to TypeScript SDK 2.0.0 and explicitly support MCP protocol revision `2026-07-28`.
- Serve modern stateless MCP over Streamable HTTP and stdio while retaining a bounded legacy-2025 compatibility path.
- Preserve Synapta's existing authorization, SSRF, DNS-pinning, byte, pagination, concurrency, timeout, effect, and human-consent controls.
- Adopt modern version discovery, per-request capability envelopes, MRTR, subscriptions, cache hints, routing headers, and OAuth hardening without reimplementing SDK wire logic.
- Deprecate obsolete Synapta surfaces deliberately; do not build optional Tasks support until official TypeScript support is conformant enough to replace Synapta's existing durable lifecycle tools.

## Expected Outcome

- `@arnilo/prism-mcp` depends on modular SDK v2 packages and can negotiate either legacy (`2024-10-07` through `2025-11-25`) or modern (`2026-07-28`) protocol eras.
- HTTP servers use `createMcpHandler()` and stdio servers use `serveStdio()` through Synapta wrappers; modern requests require no handshake, transport session, sticky routing, or shared session store.
- Existing roots/sampling support remains compatibility-only and deprecated; elicitation works through SDK MRTR auto-fulfilment with current explicit-human-interaction checks.
- Modern list changes arrive through `subscriptions/listen`; cache hints and `Mcp-Method`/`Mcp-Name`/`Mcp-Param-*` behavior are SDK-owned.
- OAuth callback issuer validation, issuer-bound credential storage, scope step-up, and Client ID Metadata Documents are supported.
- Modern and legacy protocol matrices, security regressions, package checks, and official MCP conformance tests pass.

## Current-State Gap Analysis

| Area | Current Synapta state | 2026-07-28 / SDK v2 requirement | Required change |
| --- | --- | --- | --- |
| SDK packages | `packages/mcp/package.json` pins monolithic `@modelcontextprotocol/sdk` 1.30.0 | SDK v2 is split into `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, and schema/framework packages | Replace dependency and all 38 imports; keep `zod` because current `^4.4.3` satisfies SDK v2's Zod 4 requirement |
| Client negotiation | `Client` uses default 2025 `initialize` flow | Direct SDK v2 clients still default to legacy; modern requires `versionNegotiation` | Add explicit `legacy` / `auto` / `2026-07-28` selection; make Synapta bridge helpers default to `auto`, expose negotiated era |
| HTTP server | Custom per-request v1 `WebStandardStreamableHTTPServerTransport`; optional `Mcp-Session-Id` sessions | Modern HTTP must use stateless per-request serving, `server/discover`, request envelopes, and no protocol session | Put SDK `createMcpHandler(factory)` behind existing Synapta request/auth/bounds wrapper; retain sessionful path only for classified legacy requests |
| Stdio server | Consumers are told to call `server.connect()` directly | Direct `McpServer.connect()` remains legacy; modern stdio requires `serveStdio(factory)` | Add/export a small Synapta stdio serving wrapper |
| Tool listing/calls | Raw schema-based `client.request()` calls and schema notification handler | v2 method APIs own modern result codecs, `x-mcp-header`, cache, and subscriptions | Use `listTools({cursor})`, `callTool(..., {toolDefinition})`, method-string handlers, and `ClientOptions.listChanged` while retaining Synapta bounds |
| Notifications | `notifications/tools/list_changed` invalidates local TTL | Modern servers send opted-in changes only through `subscriptions/listen` | Let SDK `listChanged` open/maintain subscription; expose server `notify`/`close` handles |
| Caching | Local fixed 30-second list timestamp; server hints ignored | Cacheable results carry `ttlMs` and `cacheScope`; private caches must not cross auth contexts | Use SDK per-client response cache and server cache hints; preserve configured TTL as local ceiling/fallback and avoid shared stores by default |
| MRTR | Roots/sampling/elicitation use server-to-client request handlers | Modern clients receive `input_required`, fulfil inputs, and retry; state is untrusted | Register same callbacks with v2 method strings and SDK auto-fulfilment; cap rounds; do not add custom MRTR wire/state machinery |
| Sessions/state | Public client `sessionId`; server `sessionIdGenerator`/`maxSessions`; request contexts use transport session IDs | Modern transport has no `Mcp-Session-Id`; application state must use explicit tool arguments or integrity-protected `requestState` | Mark session fields legacy-only; modern context uses request ID unless caller supplies an explicit application handle; preserve legacy session routing during transition |
| Headers | Secure fetch preserves headers but raw call path does not request SDK tool-parameter mirroring | Modern HTTP requires `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and valid `Mcp-Param-*` mirroring | Use SDK modern transport and high-level `callTool` with bounded discovered tool definition; test header/body mismatch errors |
| OAuth client | PKCE/RFC 8707/9728 exists, but callback takes code only and credential state is not issuer-keyed | Validate callback `iss`; persist discovery across redirect; bind tokens/client registration to issuer; prefer CIMD; support scope step-up | Change callback API to `URLSearchParams`, persist/compare OAuth `state`, key stored credentials by issuer, add CIMD strategy, retain DCR as deprecated fallback |
| OAuth server | Protected-resource metadata and bearer challenge are custom | Same baseline plus correct scope challenge and host-owned audience validation | Reuse v2 metadata/challenge helpers where possible; include required scope on 401/403 and document token `aud` validation in `resolveAuthInfo` |
| Deprecated features | Roots and sampling are public; no logging surface; Streamable HTTP already used | Roots, sampling, logging, HTTP+SSE, and DCR are deprecated | Keep roots/sampling/DCR only for existing callers, add deprecation annotations/docs, add no logging or HTTP+SSE implementation |
| Extensions | MCP Apps opt-in exists; durable agent status/resume is exposed as normal tools | Apps is formal extension; Tasks moved to `io.modelcontextprotocol/tasks` extension | Revalidate Apps metadata/negotiation on v2; defer Tasks because SDK 2.0.0 exposes old task vocabulary only for interop and does not provide complete new-extension support |
| Tests | In-memory tests primarily exercise legacy behavior | `InMemoryTransport` is legacy-only; modern tests must drive `createMcpHandler.fetch` or spawn stdio | Add modern in-process HTTP matrix, spawned stdio matrix, official conformance suite, and retain legacy in-memory regression tests |

## Recommended Adoption Profile

1. **Client default:** `auto` for Synapta's long-lived bridge helpers; explicit `legacy` escape hatch and exact `2026-07-28` pin for conformance/deploy gates. Document that stdio auto mode performs one disposable probe process and can wait for probe timeout against silent legacy servers.
2. **Server default:** one factory, modern plus SDK's stateless legacy fallback. When `sessionIdGenerator` is configured, route only legacy-classified requests to existing sessionful transport and modern requests to strict `createMcpHandler({ legacy: "reject" })`.
3. **Wire ownership:** use SDK APIs for era negotiation, envelopes, `resultType`, MRTR retries, standard/custom headers, cancellation, subscriptions, and cache semantics. Keep Synapta code around trust boundaries and Prism mapping only.
4. **Deprecations:** retain roots, sampling, DCR, and legacy sessions until usage/release policy permits removal; add nothing new on those surfaces. Earliest spec removal for roots/sampling/DCR is a revision released on or after 2027-07-28.
5. **Tasks:** no implementation in this adoption. Existing `agent.<id>.status` / `agent.<id>.resume` tools remain the durable interoperability path. Revisit when an official extension package/codec passes Synapta's target conformance scenarios.

## Tasks

- [x] 1. Migrate MCP package to TypeScript SDK v2 modular dependencies and APIs
  - **Completed 2026-09-05.** Dependency swap, import migration, and legacy-behavior verification are done; this task's test cases and acceptance criteria are green in the workspace (see results below). Modern-era behavior (negotiation, subscriptions, cache hints, headers, MRTR, createMcpHandler, stdio helper, OAuth v2 provider surface) is deliberately NOT enabled here — it lands in tasks 2-5.
  - Results:
    - `packages/mcp/package.json`: `@modelcontextprotocol/sdk 1.30.0` → `@modelcontextprotocol/client 2.0.0` + `@modelcontextprotocol/server 2.0.0` (exact pins); `zod ^4.4.3` unchanged (satisfies SDK v2's `zod ^4.2.0`). `@modelcontextprotocol/core` was NOT added: v2 method-keyed `request()`/`callTool()`/method-string handlers removed every v1 schema import, so core rides only as client/server's transitive dependency. Lockfile purged of `@modelcontextprotocol/sdk`.
    - Source migration: `bridge.ts` (method-keyed `tools/list`/`resources/list`/`resources/read` requests, `client.callTool()`, `setNotificationHandler("notifications/tools/list_changed")`, dropped v1-only `CompatibilityCallToolResultSchema`/`toolResult` wire branch), `capabilities.ts` (method-string handlers `roots/list`/`sampling/createMessage`/`elicitation/create`, `ctx.mcpReq.signal`), `transport.ts` (client package subpaths), `auth.ts` (client package auth exports + `IssuerMismatchError` mapped onto `ERR_PRISM_MCP_OAUTH_ORIGIN` so the public taxonomy is unchanged), `server.ts` (server package, `ctx.mcpReq.id`/`ctx.mcpReq.signal`/`ctx.http?.authInfo`, `z.object(argsSchema)` instead of the deprecated raw-shape prompt overload), `types.ts` (`AuthInfo` from server package).
    - Test/example/script migration: all 8 `__tests__` files, `examples/mcp-server.ts` (+ stale ignored `.js` twin), `scripts/{phase11-conformance,obscura-host-conformance,phase12-freeze}.test.mjs`, `scripts/benchmark-scenarios/phase11-auth.mjs`, `src/__tests__/install-smoke.test.ts` (packed-consumer import), `scripts/phase12-freeze-manifest.json` (protocolSdks pins + deviation dev-005).
    - Harness updates only where v2 upstream behavior intentionally differs (recorded, not silently worked around): (a) v2 `McpServer` answers unknown tools with a JSON-RPC `-32602` error instead of an `isError` result → server test asserts the rejection; (b) v2 403 step-up skips refresh for strict-superset scopes (RFC 6749 §6) → auth tests assert the v2 refresh-bypass and same-scope bounded step-up retry (`maxStepUpRetries` default 1); (c) SDK owns RFC 8414 §3.3 issuer-echo validation during discovery → `runAuth` maps `IssuerMismatchError` onto `ERR_PRISM_MCP_OAUTH_ORIGIN`.
    - Performance measured (recorded for the release): mcp own tarball unchanged (packed 36.7 kB / unpacked 153.5 kB, 30 files); v2 dependency closure is larger than v1 — installed `@modelcontextprotocol/{client,server,core}` ≈ 14.3 MB (client 6.6, server 6.4, core 1.3) vs v1 sdk ~2.6 MB, tarball delta ≈ 572 kB → 3.1 MB; cold `import` of mcp dist 149.9 ms. No framework adapter added: client deps are `cross-spawn`, `eventsource`, `eventsource-parser`, `jose`, `pkce-challenge`, `zod`, `core`; server deps `zod`, `core`; the AJV validator is bundled inside the client package.
    - Gates green: mcp typecheck/build, 64/64 mcp tests, `phase12-freeze.test.mjs` 11/11, `phase11-conformance` 5/5, `obscura-host-conformance` 8/8, root packaging gates 67/67, `phase24-truth` + `e2e-coding-journey` 15/15, `install-smoke` 10/10, `examples/mcp-server` (ts+js) run, ag-ui typecheck, generated declarations contain only v2 package paths. Pre-existing unrelated failures in the working tree are NOT caused by this task: `scripts/phase23-{coverage,security}.test.mjs` (coverage-thresholds.json drift on `@arnilo/prism-providers`, file modified before this task) and `scripts/benchmark-scenarios/phase11-auth.mjs` (references `@arnilo/prism-openapi-tools`, a package absent from this checkout; only its import line was migrated).
    - Deprecation note recorded for task 5/7: legacy `toolResult` (pre-`structuredContent` draft wire shape) is no longer decoded — v2's `callTool` owns result codecs. Roots/sampling/elicitation continue through deprecated v2 method-string handlers as required by task 3.
  - Acceptance Criteria:
    - Functional: all production, test, example, and script imports resolve from SDK v2 packages; no source or manifest references `@modelcontextprotocol/sdk`; existing legacy-era bridge/server tests still pass before modern behavior is enabled.
    - Performance: package install and bundle size are measured; no framework adapter is added to the runtime dependency graph because Synapta exposes Web Standard `Request`/`Response`.
    - Code Quality: use SDK v2 high-level methods and method-string handlers; remove v1-only schemas, double casts, and transport plumbing where v2 owns behavior; no imports from private `@modelcontextprotocol/core-internal`.
    - Security: Zod stays at `>=4.2.0`; migration does not bypass current schema/result/transport bounds; dependency versions and lockfile are pinned consistently.
  - Approach:
    - Documentation Reviewed:
      - TypeScript SDK v2, “Upgrading from v1.x to v2”: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
      - SDK v2 package/API docs: https://ts.sdk.modelcontextprotocol.io/v2/
      - Published package metadata checked for `@modelcontextprotocol/client`, `server`, `core`, and `node` 2.0.0; Node `>=20`.
    - Options Considered:
      - Run codemod over repository: rejected as primary path because only 38 indexed imports exist and repository has unrelated uncommitted work.
      - Dry-run codemod for inventory, then edit MCP-owned files manually: chosen; smallest controlled diff.
      - Add `@modelcontextprotocol/node`: rejected unless a Node `IncomingMessage` adapter becomes a requested public feature; current handler is fetch-shaped.
    - Chosen Approach:
      - Replace monolithic dependency with `@modelcontextprotocol/client` and `@modelcontextprotocol/server` 2.0.0. Add `@modelcontextprotocol/core` only if an unavoidable public schema parser remains after high-level API conversion.
      - Run `npx @modelcontextprotocol/codemod@latest v1-to-v2 packages/mcp --dry-run`, use its report as checklist, then update exact imports and manual behavior.
    - API Notes and Examples:
      ```ts
      import { Client, type Transport } from "@modelcontextprotocol/client";
      import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
      import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
      ```
    - Files to Create/Edit:
      - `packages/mcp/package.json`: replace SDK v1 dependency.
      - `package-lock.json`: lock modular SDK v2 packages.
      - `packages/mcp/src/{auth,bridge,capabilities,server,transport,types}.ts`: migrate imports and v2 API signatures.
      - `packages/mcp/src/__tests__/*.test.ts`, `examples/mcp-server.ts`, `scripts/{phase11-conformance.test.mjs,benchmark-scenarios/phase11-auth.mjs}`, `src/__tests__/install-smoke.test.ts`: migrate SDK imports/test harnesses.
      - `scripts/package-truth.json` and dependency/package checks: update only where v1 package literal is asserted.
    - References:
      - Current imports: `packages/mcp/src/server.ts:12-14`, `bridge.ts:2-10`, `capabilities.ts:1-3`, `transport.ts:2-4`, `auth.ts:1-13`, `types.ts:19`.
      - Current dependency: `packages/mcp/package.json` (`@modelcontextprotocol/sdk` 1.30.0).
  - Test Cases to Write:
    - Package typecheck/build: modular imports resolve in ESM and generated declarations contain no v1 package paths.
    - Legacy smoke: existing in-memory tool list/call, resources/prompts, and OAuth tests remain green.
    - Package dry run/install smoke: packed package imports under Node 20 and current CI Node version.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — consumers importing leaked SDK types see new module identities.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `packages/mcp/README.md`, and `docs/migration.md` in final documentation task.
    - `docs/index.md` update: no; existing MCP page remains canonical.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Adopt modern client negotiation, subscriptions, cache hints, and HTTP routing headers
  - **Completed 2026-09-05.** Negotiation, subscriptions, SEP-2549 cache-hint honoring, and SEP-2243 header mirroring are implemented and green (76/76 package tests, incl. the new 12-case modern matrix).
  - Results:
    - Negotiation: new public option `protocolVersion?: McpProtocolNegotiation = "legacy" | "auto" | { pin: string }` on `ConnectMcpToolsOptions` (hence capabilities); bridge-owned clients default to `auto` (one bounded `server/discover` probe per connect; unrecognized/deadline responses fall back to the plain legacy handshake; `{ pin }` fails loudly). `protocolEra` (`"legacy"`/`"modern"`) and `protocolVersion` (negotiated revision) are exposed on `McpToolBridge`. Auto is verified modern against `createMcpHandler`, legacy against a 2025-only stateless streamable-HTTP fixture, and pin rejects the legacy fixture while accepting the modern one; explicit `"legacy"` against a modern server stays byte-identical 2025.
    - Subscriptions: `ClientOptions.listChanged.tools` configured on bridge-owned clients with `autoRefresh: false` so SDK-owned change delivery (legacy `notifications/tools/list_changed` handler, or the auto-opened `subscriptions/listen` stream on 2026-07-28) triggers the bounded explicit-pagination refresh instead of the SDK's uncapped aggregate. The pre-existing manual notification handler remains as the no-listChanged-capability fallback (SDK replaces it per-method when it engages). Capability clients get the same hook via a `WeakMap` refresh registration in `attachMcpCapabilities`. Verified: a published `toolsChanged` invalidates exactly the affected bridge (untouched bridge performs zero list traffic) and `close()` tears the subscription down without hanging.
    - Cache hints: `listAllMcpTools` now reads the SEP-2549 hint (top-level `ttlMs`/`cacheScope` — the SDK wire shape — or the draft `_meta.cacheHint` variant) defensively; the local list cache TTL is `min(hint, listCacheTtlMs)` for positive hints, 0 for zero hints, and refetch-always when absent/malformed. The cache is per-bridge, so private-scoped hints never cross principals by construction.
    - Headers/routing: `callTool` now receives the retained discovered `toolDefinition`, so SEP-2243 `Mcp-Param-*` mirroring and output-schema validation use the same bounded schema; `refresh()` honors hinted caching. Malformed `x-mcp-header` tools are excluded by the serving SDK before retention (asserted). Header-mismatch `-32020` responses surface as bounded tool errors with no evict-refetch-retry loop (toolDefinition present), verified against a hostile raw fixture.
  - Deviations from plan text (recorded honestly): (a) the first page of the bounded list walk sends the opaque empty cursor (`{ cursor: "" }`) because the no-cursor form is the SDK's auto-aggregate path, which reads/writes its own response cache and applies its own page cap — the per-page path is keyed on `params.cursor !== undefined`; (b) hint-less servers refetch on every `refresh()` (spec: absent/≤0 ttlMs is immediately stale) rather than the pre-adoption fixed 30 s local TTL — correctness is preserved because listChanged/subscription invalidation now drives refreshes (ponytail: revival of hint-less TTL caching is a documented knob); (c) `transport.ts` was not edited — v1 session assumptions on the modern path are SDK-owned and the sessionful legacy routing stays until task 4.
  - Core fix found by the modern tests (applies to every pinned fetch user): `requestPinned` no longer passes the caller signal as `http.request`'s `signal` option (Node's internal abort wiring destroys an already-resolved keep-alive socket with the abort reason, surfacing as an unhandled socket `AbortError` when SDK transports abort on close) and its response-stream `cancel()` destroys without propagating the abort reason. The `src/pinned-fetch.ts` change is covered by the existing core pinned-fetch suite (8/8).
  - Budgets: `scripts/budgets.json` mcp baseline rebased 122 → 123 for the new `McpProtocolNegotiation` type export (reason entry). `docs/release-and-install.md` protocol-SDK matrix updated to the modular pins (phase-12 docs gate requires manifest agreement); `docs/_evidence/phase54-package-map.md` regenerated.
  - Performance recorded: auto negotiation is one extra `server/discover` round trip per HTTP connect (stdio uses the SDK's disposable sibling probe); tool calls add no round trips beyond the mirror headers; cached `refresh()` skips list traffic entirely (ceiling verified: 60 s hint + 200 ms ceiling refetches after 250 ms); no cache is shared across principals.
  - Gates green: mcp 76/76 (incl. 12 modern legacy/header/cache/subscription tests), root dist suite (docs gate now agrees with the manifest), pinned-fetch 8/8, packaging/truth/budget/dead-export/import-hygiene/phase54 (evidence regenerated), phase12-freeze 11/11, phase11-conformance, obscura-host-conformance, phase24-truth, install-smoke 10/10. Pre-existing unrelated failures unchanged (phase23 coverage/security gate drift on prism-providers; phase11-auth benchmark references a package absent from this checkout).
  - Acceptance Criteria:
    - Functional: `connectMcpTools()` and `connectMcpCapabilities()` support `legacy`, `auto`, and exact `2026-07-28` pinning; bridge exposes negotiated `protocolEra`; modern tool calls emit SDK-managed standard headers and valid `Mcp-Param-*` mirrors; legacy fallback remains operational.
    - Performance: auto negotiation adds one bounded discovery probe per connection; list pagination remains capped; list caching honors server hints without exceeding Synapta's configured TTL ceiling; no cache is shared across principals by default.
    - Code Quality: SDK `ClientOptions.listChanged`, explicit-cursor list APIs, and `callTool(..., { toolDefinition })` replace custom wire handling; atomic refresh and existing immutable tool-array semantics remain.
    - Security: tool definitions are byte/depth/property bounded before retention; malformed `x-mcp-header` tools are excluded; private cache entries cannot cross bridge/auth contexts; existing SSRF/DNS/origin/redirect response caps still wrap every HTTP probe and request.
  - Approach:
    - Documentation Reviewed:
      - Protocol versions: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
      - Supporting 2026-07-28, client negotiation, subscriptions, headers, cache: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
      - Spec changelog items 1-5 and 9: https://modelcontextprotocol.io/specification/2026-07-28/changelog
      - Tools and `x-mcp-header`: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
    - Options Considered:
      - Keep raw `client.request()` and manually implement headers/cache/subscriptions: rejected; duplicates protocol and misses SDK correction behavior.
      - Use no-argument auto-aggregating lists: rejected because Synapta's tighter page/item/schema limits and atomic refresh are public security behavior.
      - Use explicit-cursor SDK list calls plus high-level tool calls: chosen.
    - Chosen Approach:
      - Add a small Synapta `protocolVersion` option mapped to SDK `versionNegotiation`; default bridge-owned clients to `auto`.
      - Configure `listChanged.tools.onChanged` to invalidate/refresh Synapta's mapped list in both eras.
      - Preserve explicit pagination loop, but call SDK v2 methods; pass retained remote definition to `callTool` so output validation and header mirroring use the same schema.
    - API Notes and Examples:
      ```ts
      const client = new Client(info, {
        versionNegotiation: { mode: "auto" },
        listChanged: { tools: { onChanged: () => void refresh() } },
      });
      await client.callTool({ name, arguments: args }, { toolDefinition: discoveredTool });
      client.getProtocolEra(); // "legacy" | "modern"
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/types.ts`: negotiation option and bridge era result.
      - `packages/mcp/src/bridge.ts`: v2 list/call/subscription/cache integration.
      - `packages/mcp/src/capabilities.ts`: pass negotiation and expose era.
      - `packages/mcp/src/transport.ts`: remove v1 session assumptions from modern path while preserving secure fetch.
      - `packages/mcp/src/__tests__/{bridge,capabilities,transport}.test.ts`: dual-era and header/cache/subscription cases.
    - References:
      - Current client construction: `packages/mcp/src/bridge.ts:219-224`, `capabilities.ts:110-167`.
      - Current raw list/call: `packages/mcp/src/bridge.ts:92-165`, `305-390`.
      - Current list invalidation: `packages/mcp/src/bridge.ts:226-251`.
  - Test Cases to Write:
    - Auto mode chooses modern against `createMcpHandler` and legacy against a 2025-only in-memory/server fixture; pin rejects legacy.
    - Modern call sends matching protocol/method/name and `x-mcp-header` headers through secure fetch; mismatch response is surfaced safely.
    - Modern `subscriptions/listen` list change invalidates exactly affected bridge; close tears down subscription.
    - Public/private cache hints, zero TTL, configured TTL ceiling, repeated cursor, malformed header annotation, schema limits, and cancellation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new negotiation option, default probe, era field, and cache behavior.
    - Docs pages to create/edit: `docs/mcp-tools.md` and `packages/mcp/README.md`.
    - `docs/index.md` update: no; existing MCP entry remains.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Move client callbacks to MRTR-compatible v2 handlers and mark deprecated capabilities
  - **Completed 2026-09-05.** Client callbacks are fulfilled by the SDK's MRTR driver on the modern era and by direct dispatch on legacy, with roots/sampling marked deprecated.
  - Results:
    - Method-string handlers (`"roots/list"`, `"sampling/createMessage"`, `"elicitation/create"`) registered on the capability client are the ONE implementation for both eras: legacy server-to-client dispatch and modern `input_required` auto-fulfilment funnel through the same `setRequestHandler` registrations (SDK `_getRequestHandler`). No hand-written `resultType`/`inputResponses`/retry state machine — `ClientOptions.inputRequired = { autoFulfill: true, maxRounds }` and the SDK driver (`runInputRequiredFlow`) dispatch, retry, and bound everything.
    - New option `maxMrtrRounds?: number` on `ConnectMcpCapabilitiesOptions`: defaults to 10 (the SDK's own default) and the hard cap is 10, so it can only tighten; out-of-range values fail fast via `validateMcpLimit` (`maxMrtrRounds must be a positive safe integer <= 10`). The call timeout stays the outer ceiling — driver retry legs inherit the caller signal and a shrinking `maxTotalTimeout`.
    - Bounds/security confirmed by the new 7-case modern suite (20/20 in the modern matrix): accepted elicitation content reaches the retried operation under a fresh wire request id with the `humanInteraction` marker stripped (`inputResponses.confirm` carries only `{action, content}`); decline/cancel propagate as discriminated responses and the tool fails closed; a server cannot emit `input_required` against a client that never declared the capability (SDK-validated, bounded error); malformed/oversized callback results are rejected before any retry (`Invalid MCP elicitation result`, `MCP elicitation result exceeds N bytes` via `bounded()` with `maxCapabilityBytes`); rounds are capped exactly (`original + 3 retries` at `maxMrtrRounds: 3`); an aborted in-flight round surfaces the abort reason; URL-mode elicitation reaches the host callback (`mode: "url"` + URL) and no outbound navigation ever leaves the client (all fixture traffic stays on the `/mcp` origin).
    - Deprecations: `ConnectMcpCapabilitiesOptions.roots` / `.sampling`, `McpRoot`, and `PrismMcpSamplingRequest` carry `@deprecated` annotations (MCP 2026-07-28, SEP-2577) with migration text (explicit tool arguments; host-side model calls); elicitation remains the active capability. No logging capability was added.
    - Docs: `docs/mcp-tools.md` gains the deprecation block + MRTR paragraph and its capability-matrix line now refers to the modular SDK v2 packages; `docs/migration.md` migration entry (2.0.0 drop-in) updated with the deprecation/MRTR note (`maxMrtrRounds` ceiling, call timeout as outer ceiling).
    - Budgets: `scripts/budgets.json` mcp baseline 123 → 125 (+`DEFAULT_MAX_MRTR_ROUNDS`/`HARD_MAX_MRTR_ROUNDS`, source-level export consts in `limits.ts`); phase54 evidence regenerated.
  - Test Cases (from the plan) covered in `modern-bridge.test.ts` suite "modern MRTR auto-fulfilment (plan 063 task 3)":
    - ✔ Modern tool returning `input_required` invokes form elicitation and completes after retry (fresh ids asserted on the wire).
    - ✔ Decline/cancel (propagated, fail-closed), missing capability (server refuses against a non-declaring client), malformed/oversized response (rejected pre-retry), round cap (typed `INPUT_REQUIRED_ROUNDS_EXCEEDED` "still required input after N rounds"), abort, URL mode without automatic navigation — all covered.
    - ✔ Legacy elicitation/sampling/roots behavior remains compatible (pre-existing `capabilities.test.ts`/`elicitation.test.ts` suites unchanged and green; full package suite 84/84).
  - Gates green: mcp 84/84 (incl. 7 new MRTR tests), root dist suite 1639/1639 (docs gate included), budget/perf 20/20 (rebaselined), compat-baseline, packaging/truth/dead-export/import-hygiene, phase54 (evidence regenerated), phase12-freeze 11/11, phase11-conformance, obscura-host-conformance, phase24-truth, install-smoke 10/10. Pre-existing unrelated failures unchanged (phase23 coverage/security drift on prism-providers; phase11-auth benchmark references a package absent from this checkout).
  - Notes: server-side MRTR (a Synapta server tool issuing `input_required`, `requestState`, `createRequestStateCodec`) was NOT built — plan says add only if it becomes a concrete requirement; the SDK's `inputRequired()`/`acceptedContent()` surface is available and already exercised by the test fixtures' server side.

- [x] 4. Replace HTTP/stdio server entry points with dual-era SDK v2 serving
  - **Completed 2026-09-05.** HTTP and stdio serving run on the SDK v2 dual-era entries with Prism security gates in front; legacy stateless and session traffic stay compatible.
  - Results:
    - `createPrismMcpWebHandler()` default (factory, no `sessionIdGenerator`): the entire request path is SDK `createMcpHandler` — one fresh `McpServer` per request, SDK-generated `server/discover`, `resultType` result metadata, cancellation and modern headers, with the SDK stateless legacy fallback answering 2025-era traffic. Verified end-to-end over real HTTP: a pinned-modern SDK Client connects (era `modern`), lists and calls tools, and no response ever carries `Mcp-Session-Id`; a default legacy Client gets the stateless fallback (era `legacy`, list/call green).
    - With `sessionIdGenerator` configured, classified legacy session traffic routes via SDK `isLegacyRequest` to the sessionful `WebStandardStreamableHTTPServerTransport` (identity-bound POST/GET/DELETE/SSE, non-disclosing 404 on principal mismatch) beside a strict modern handler (`legacy: 'reject'`); a pinned-modern client calls tools against the same handler in the same test. A bare `McpServer` instance with sessions keeps documented legacy-only behavior (no modern leg can exist without a factory); stateless mode still requires a factory.
    - Security gates run in front of the SDK entries (which intentionally provide none): exact Host/Origin allowlist checks execute **before body parsing, auth, and dispatch** (evil Origin + oversized body returns 403, not 413); bounded body parsing feeds `parsedBody` (raw bytes rebuild the request so content-length stays exact); verified `AuthInfo` is passed explicitly (`resolveAuthInfo` → handler `authInfo`, asserted reaching `authorize`); authorization/identity checks run on every request; modern serving state never trusts a transport session id.
    - Handler lifecycle: the return value stays callable for source compatibility and now carries `fetch` (same function), `close()` (tears down modern in-flight exchanges + the legacy session transport/server), `notify.toolsChanged()/promptsChanged()/resourcesChanged()/resourceUpdated(uri)`, and `bus`. Legacy-only handlers (bare instance + sessions) get a notifier facading the shared server's `send*ListChanged` calls. New bounded options: `maxSubscriptions` (1..4096, SDK default 1024) and `keepAliveMs` (0..300000, SDK default 15000); subscription/keepalive bounds ride `CreateMcpHandlerOptions`.
    - `servePrismMcpStdio(factory, options)` added as a thin SDK `serveStdio` wrapper (era pinned by the opening exchange, one factory instance per connection, `legacy: 'serve' | 'reject'`, `maxSubscriptions` bound). Spawned-child tests verify a modern auto connection probes to era `modern` and a default legacy client pins a legacy instance, both listing/calling correctly — stdout stays protocol-only. Direct `server.connect()` remains documented as legacy-only.
    - `createPrismMcpServer({ cacheHints })` passes per-method SEP-2549 cache hints into the `McpServer` constructor (default `ttlMs: 0`/`private` unchanged); registration order still gives deterministic lists. Existing request/result/concurrency/time limits untouched.
    - Types: `PrismMcpWebHandler` (callable + lifecycle props), `PrismMcpCacheableMethod`/`PrismMcpCacheHints`, `ServePrismMcpStdioOptions`/`PrismMcpStdioHandle`, `maxSubscriptions`/`keepAliveMs` on handler options — all exported from the package entry. `relayStatelessBody` and the obsolete sse-relay tests were deleted (SDK transport internals replace the custom modern wire code).
    - Examples/docs: `examples/mcp-server.ts` is factory-based (in-memory demo, `--stdio` mode, commented modern HTTP wiring, verified running); `docs/mcp-tools.md` server section rewritten for dual-era serving + gates + lifecycle; `packages/mcp/README.md`, `docs/migration.md`, `examples/README.md` updated. Budgets mcp baseline 125 → 129 (+4 serving exports); phase54 evidence regenerated.
  - Test Cases (from the plan) covered in `server.test.ts` suite "dual-era MCP serving (plan 063 task 4)":
    - ✔ In-process modern `server/discover`, list, tool calls, SDK result metadata, no `Mcp-Session-Id`; legacy stateless initialize/list/call remains green; configured legacy session POST binding + modern-beside-legacy routing green (pre-existing binding test unchanged and green).
    - ✔ Host/origin rejection before parsing, auth pass-through, request/response size bounds (pre-existing), concurrency/timeout bounds (pre-existing), option validation, handler close/notify/bus.
    - ✔ Spawned stdio auto-modern and legacy-fallback connections; stdout protocol-only.
  - Gates green: mcp 87/87 (7 new dual-era tests, 4 obsolete relay tests removed), root dist suite 1639/1639, budget/perf 20/20 (rebaselined), compat-baseline, packaging/truth/dead-export/import-hygiene, phase54 (regenerated), phase12-freeze 11/11, phase11-conformance, obscura-host-conformance, phase24-truth, install-smoke 10/10. Pre-existing unrelated failures unchanged (phase23 coverage/security drift on prism-providers; phase11-auth benchmark references a package absent from this checkout).
  - Notes: modern SSE upgrade semantics (`responseMode: 'auto'`) are SDK-owned; `boundResponse` still buffers non-SSE responses to `maxResponseBytes` and passes SSE streams through unbounded. The SDK owns per-request instance lifetime on the modern leg (no host-side close relay needed).
    - Functional: modern HTTP uses `createMcpHandler` with one fresh `McpServer` per request; modern stdio uses `serveStdio`; `server/discover`, required result metadata, `resultType`, cancellation, and modern headers are SDK-generated; legacy stateless traffic remains default-compatible and configured legacy sessions still route correctly.
    - Performance: modern HTTP needs no sticky routing/shared protocol state; existing request/result/concurrency/time limits remain; subscription count and keepalive are bounded.
    - Code Quality: `createPrismMcpWebHandler` remains callable for source compatibility and gains `fetch`, `close`, `notify`, and `bus`; server definitions are registered once per factory invocation; SDK transport internals replace custom modern wire code.
    - Security: host/origin validation runs before parsing/auth/dispatch because SDK `createMcpHandler` intentionally provides none; bounded body parsing passes `parsedBody`; verified `AuthInfo` is passed explicitly; authorization and identity checks run on every request; modern state never trusts a transport session ID.
  - Approach:
    - Documentation Reviewed:
      - Serve HTTP: https://ts.sdk.modelcontextprotocol.io/v2/serving/http
      - Serve stdio: https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio
      - Streamable HTTP spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
      - SDK dual-era server migration: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28#server-over-http-createmcphandler
    - Options Considered:
      - Keep constructing `WebStandardStreamableHTTPServerTransport` for all traffic: rejected; direct server instances remain legacy and do not serve modern era.
      - Delete legacy session support: rejected during initial adoption because it is current documented public behavior.
      - Route classified legacy session traffic separately and use strict modern handler beside it: chosen when sessions are configured; otherwise use SDK's dual-era stateless fallback.
    - Chosen Approach:
      - Wrap `createMcpHandler(factory)` behind existing request-size, timeout, concurrency, auth, host, and origin gates.
      - Preserve callable handler via a function object carrying SDK lifecycle/notification properties.
      - Add `servePrismMcpStdio(factory, options)` as a thin `serveStdio` wrapper. Direct `server.connect()` remains documented as legacy-only.
      - Add server cache-hint options; rely on registration order for deterministic lists.
    - API Notes and Examples:
      ```ts
      const handleMcp = await createPrismMcpWebHandler(
        () => createPrismMcpServer(serverOptions),
        { resolveAuthInfo, allowedHosts, allowedOrigins },
      );
      await handleMcp(request);
      handleMcp.notify.toolsChanged();
      await handleMcp.close();
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/server.ts`: modern handler composition, legacy routing, handler lifecycle, v2 callback context.
      - `packages/mcp/src/types.ts`: factory/handler, era, cache, subscriptions, and legacy-only session docs.
      - `packages/mcp/src/index.ts`: export stdio helper and handler types.
      - `packages/mcp/src/__tests__/{server,sse-relay,auth}.test.ts`: dual-era server/security tests; remove obsolete replay expectations.
      - `examples/mcp-server.ts`: factory-based modern HTTP and stdio examples.
    - References:
      - Current server registration: `packages/mcp/src/server.ts:40-339`.
      - Current custom HTTP/session implementation: `packages/mcp/src/server.ts:380-515`.
      - Current handler options: `packages/mcp/src/types.ts:141-158`.
  - Test Cases to Write:
    - In-process modern `server/discover`, list, tool/resource/prompt calls, modern result metadata, required headers, and no `Mcp-Session-Id`.
    - Legacy stateless initialize/list/call remains green; configured legacy session POST/GET/DELETE principal binding remains green.
    - Host/origin rejection, auth pass-through, body/response/concurrency/subscription/timeout limits, client disconnect, and handler close.
    - Spawned stdio auto/pin modern connection and legacy fallback; stdout remains protocol-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — modern serving, handler lifecycle properties, stdio helper, and session semantics.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `packages/mcp/README.md`, `docs/migration.md`, and `examples/README.md`.
    - `docs/index.md` update: no; existing MCP page remains canonical.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Make OAuth client/server behavior conform to 2026-07-28 security requirements
  - **Completed 2026-09-05.** OAuth client callback/persistence now follows the SDK v2 2026-07-28 conformance model; the server challenge carries the required scope; DCR is deprecated with CIMD preferred.
  - Results:
    - `finishAuth` accepts the full callback `URLSearchParams` (`finishAuth(new URL(callbackUrl).searchParams)`): the persisted OAuth `state` round-trip record (state + AS origin, persisted at `redirectToAuthorization` time through an optional `McpClientAuthState.saveAuthorizationState`/`loadAuthorizationState` seam) is validated first and fails closed (`ERR_PRISM_MCP_OAUTH_STATE`) when absent or mismatched; the RFC 9207 `iss` parameter is then checked against the persisted AS origin, and only after both pass are callback `error` fields surfaced (bare code, never `error_description`). The code + `iss` are passed to the SDK, which validates `iss` against the recorded issuer (RFC 9207 §2.4, including the required-issuer-absent case via `authorization_response_iss_parameter_supported`) and the callback-leg AS binding (SEP-2352). A bare code string remains as the documented legacy form. `IssuerMismatchError` and `AuthorizationServerMismatchError` both map to `ERR_PRISM_MCP_OAUTH_ORIGIN`.
    - Issuer-keyed persistence: `McpClientAuthState` credential methods now use SDK v2 `StoredOAuthTokens`/`StoredOAuthClientInformation` and take the validated `issuer` (source-compatible optional parameter; single-slot implementations ignore it). The provider re-validates every record: a record stamped for a different issuer is never served, and an ambiguous un-stamped pre-upgrade record is refused on issuer-keyed reads rather than guessed (fail-closed migration; ctx-less bearer reads still return the most-recent set per the SDK contract). Saves assert the record stamp matches the active issuer. `revoke()`/`getTokens()` read through the provider (most-recent set), fixing the keyed-store read path.
    - Registration strategies: CIMD (SEP-991) added via provider `clientMetadataUrl` (validated with SDK `validateClientMetadataUrl` — https + non-root pathname — at construction) and preferred in docs; `static` unchanged; `dcr` carries `@deprecated` (MCP 2026-07-28 / SEP-991) and now defaults `application_type: "native"` when the host metadata omits it (static fallback metadata also sets it).
    - Explicit insufficient-scope policy: `McpClientAuthOptions.onInsufficientScope: "reauthorize" | "throw"` maps onto the SDK transport option — `"reauthorize"` (default) keeps the bounded step-up flow, `"throw"` surfaces the typed SDK `InsufficientScopeError` (with the challenge scope) without any silent redirect; verified end-to-end with zero refresh/authorization grants on the throw path.
    - Server: the 401 `WWW-Authenticate` challenge now includes `scope="<configured scopes>"` alongside `resource_metadata`; scope values are validated against the RFC 6749 scope-token charset (RFC 7235 quoted-string injection safety). Protected-resource metadata and the host-owned token verification (audience validation documented as the host verifier's duty) are unchanged.
    - Security posture preserved: exact issuer comparison on Prism pre-checks; discovery still SSRF-checked/https-pinned/bounded; credentials never cross issuer/resource/origin (RFC 8707 audience binding + issuer stamps + origin allowlists); encrypted/keychain storage documented for refresh tokens.
    - Docs: `docs/mcp-tools.md` OAuth section rewritten (callback params contract, issuer-keyed storage, CIMD/static/DCR guidance, insufficient-scope policy, server challenge scope + host audience duty); `docs/credential-storage.md` gained an "MCP OAuth records" note (issuer-keyed rows, encrypted/keychain requirement); `docs/migration.md` documents the callback/persistence contract changes and the one-time re-authorization for pre-upgrade stores.
  - Test Cases (from the plan) — new suite "2026-07-28 OAuth conformance (plan 063 task 5)" in `auth.test.ts` (8 cases):
    - ✔ Valid callback state+iss → single code exchange, tokens issuer-stamped; state mismatch → `ERR_PRISM_MCP_OAUTH_STATE` with zero token-endpoint requests; issuer mismatch → `ERR_PRISM_MCP_OAUTH_ORIGIN` with callback `error`/`error_description` never surfaced; required issuer absent (`authorization_response_iss_parameter_supported: true`, no `iss`) → `ERR_PRISM_MCP_OAUTH_ORIGIN`.
    - ✔ Credentials never cross issuers (foreign-stamped record unserved; own record served) and ambiguous legacy records are refused while ctx-less reads keep the most-recent set.
    - ✔ CIMD: no registration POST, url-based `client_id` on authorize + token requests, construction rejects http/root-path metadata URLs. ✔ DCR `application_type` defaults to `native`.
    - ✔ Typed `InsufficientScopeError` under `"throw"` policy with the challenge scope and no grants. Pre-existing matrix coverage retained: CIMD-less 401/403 step-up flows, scope union, redirect denial, SSRF/rebinding, audience mismatch, revocation, bounded records (all green, 23/23 auth tests).
    - ✔ Protected-resource metadata + `WWW-Authenticate` scope/resource_metadata values (challenge assertion updated, invalid-scope charset guarded).
  - Gates green: mcp 95/95 (8 new conformance tests; memoryState upgraded to an issuer-aware dual-slot store), root dist suite 1639/1639, budget-gate/compat-baseline/packaging/truth/dead-export/import-hygiene/phase54/phase12-freeze/phase11-conformance/obscura-host-conformance/phase24-truth 103/103, install-smoke 10/10, `tsc --noEmit` clean. No new top-level exports, so the mcp budget stays at 129. Pre-existing unrelated failures unchanged (phase23 coverage/security drift on prism-providers; phase11-auth benchmark).
  - Notes: discovery caching is unchanged (bounded TTL, single entry per client, issuer/origin-coherence revalidated on save; one discovery per in-flight flow via the existing `inflight` single-flight).
    - Functional: OAuth callback completion accepts full `URLSearchParams`; validates stored `state` before SDK exchange; SDK validates callback `iss`; token/client records are selected and saved by validated issuer; CIMD is preferred, static registration remains supported, and DCR is marked deprecated; insufficient-scope challenges reauthorize or return typed errors by explicit policy.
    - Performance: validated discovery remains cached within current bounded TTL and issuer partition; no duplicate discovery/registration occurs during one in-flight flow.
    - Code Quality: use SDK v2 `StoredOAuthTokens`, `StoredOAuthClientInformation`, `OAuthDiscoveryState`, and provider context instead of parallel issuer bookkeeping; preserve Synapta error taxonomy only around Synapta policy boundaries.
    - Security: issuer comparison is exact; callback error fields are not surfaced after issuer mismatch; credentials never cross issuer/resource/origin; token endpoints require TLS except explicit loopback; refresh tokens remain encrypted/keychain-hosted; server challenges include required scope and host token verifier validates audience.
  - Approach:
    - Documentation Reviewed:
      - MCP authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
      - SDK v2 auth migration, issuer mix-up, DCR defaults, step-up: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2#auth
      - 2026 conformance opt-ins: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28#auth-on-2026-07-28
    - Options Considered:
      - Keep code-only callback and origin-only issuer checks: rejected; cannot satisfy RFC 9207 validation.
      - Rewrite OAuth flow locally: rejected; SDK v2 already implements discovery, issuer validation, resource binding, step-up, and typed errors.
      - Adapt Synapta persistence/policy seams to SDK v2: chosen.
    - Chosen Approach:
      - Change `finishAuth` to accept callback `URLSearchParams`; compare persisted state, then pass params to SDK.
      - Make OAuth state methods issuer-aware and store SDK issuer-stamped records; provide migration handling that refuses ambiguous old records rather than guessing an issuer.
      - Add CIMD strategy via provider `clientMetadataUrl`; preserve static strategy; retain DCR with deprecation annotation and correct `application_type` defaults.
      - Reuse SDK protected-resource metadata/challenge helpers where they preserve Synapta bounds; keep host-owned token verification.
    - API Notes and Examples:
      ```ts
      const params = new URL(callbackUrl).searchParams;
      await auth.finishAuth(params); // validates state, then SDK validates iss
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/auth.ts`: v2 provider/state types, issuer-keyed persistence, callback/state/CIMD flow.
      - `packages/mcp/src/transport.ts`: v2 auth provider and insufficient-scope policy.
      - `packages/mcp/src/server.ts`: protected-resource metadata and scope challenge integration.
      - `packages/mcp/src/types.ts` and `packages/mcp/src/index.ts`: revised public auth/server types.
      - `packages/mcp/src/__tests__/{auth,transport,server}.test.ts`: OAuth threat matrix.
      - Credential adapter call sites discovered during implementation: update only if public `McpClientAuthState` implementations exist.
    - References:
      - Current provider/state: `packages/mcp/src/auth.ts:76-328`.
      - Current code-only callback: `packages/mcp/src/auth.ts:338-412`.
      - Current protected-resource server: `packages/mcp/src/server.ts:380-515`, `735-778`.
  - Test Cases to Write:
    - Valid callback state+issuer; state mismatch; issuer mismatch; required issuer absent; callback error after mismatch stays undisclosed.
    - Two authorization issuers cannot read/reuse each other's tokens/client registrations; ambiguous legacy state fails closed.
    - CIMD, static client, deprecated DCR `application_type`, refresh, revocation, 401, 403 `insufficient_scope`, scope union, redirect denial, SSRF/rebinding, and audience mismatch.
    - Protected-resource metadata and `WWW-Authenticate` scope/resource metadata values.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — callback and persistence contracts change; CIMD and step-up are added; DCR is deprecated.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `docs/credential-storage.md`, and `docs/migration.md`.
    - `docs/index.md` update: no; existing MCP and credential pages remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Revalidate MCP Apps and record Tasks/deprecation boundaries
  - **Completed 2026-09-05.** Apps revalidated end-to-end on both eras over the SDK v2 high-level resource APIs; the Tasks boundary is recorded as an explicit, dated non-feature.
  - Results:
    - **Apps on v2 high-level APIs** (`bridge.ts`): `listMcpAppResources` now walks pages via `client.listResources` (page-0 empty-cursor form forces the SDK per-page path — the no-cursor form is the uncapped aggregate/response-cache path, same as the task-2 tools/list walk) and `readMcpAppResource` uses `client.readResource`. Envelope `measureBoundedJson` was dropped for the decoded-v2-result reason recorded in task 2 (undefined-valued optional members); its protections were re-expressed per item: `resourceDescriptor` gained a description byte bound (`maxToolDescriptionBytes`) and `resources/read` gained a contents-count ceiling (`maxJsonProperties`), while the HTML body byte bound, HTML5 shape check, one-body rule, exact MIME check, and content-metadata-over-list-default precedence are unchanged.
    - **Apps negotiation revalidated both eras** (new tests in `modern-bridge.test.ts`): modern pinned client against a raw 2026-07-28 fixture — the bridge advertises `extensions: { "io.modelcontextprotocol/ui": {} }` in the discover `params._meta["io.modelcontextprotocol/clientCapabilities"]`, never `io.modelcontextprotocol/tasks`; the server ui acknowledgement still gates the `apps` facade; list/read/callTool behavior unchanged. Legacy era against a real SDK `McpServer` advertising the ui extension + registered `text/html;profile=mcp-app` resource — same assertions on the initialize wire capture. The raw fixture gained optional `resourcesList`/`resourcesRead`/`extensions` handlers (the client short-circuits `resources/list` unless the server advertises the `resources` capability — fixture now declares it).
    - **Tasks fail-closed**: `callRemoteTool` rejects draft-era `task` members on decoded tool results in both eras (`McpBridgeError("MCP tool returned a deprecated task result")`, surfaced as `ToolResult.error` with no `value` — the bridge's call-failure contract); modern `resultType: "task"` already fails SDK decode with `Unsupported result type 'task'` before the bridge sees it. Server side: `createPrismMcpServer` advertises only tools/resources/prompts `listChanged` (+ optional cacheHints) — asserted in `server.test.ts` that `getServerCapabilities()` carries no `tasks` capability and no `io.modelcontextprotocol/tasks` extension.
    - **Cross-package compatibility** (`packages/ag-ui/src/__tests__/mcp-apps-effect.test.ts`): new case proving the AG-UI app handler treats the bridge's deprecated-task refusal (`McpBridgeError` imported from `@arnilo/prism-mcp`) like any call failure — 400 + `failed_retryable` effect record with `ERR_PRISM_AG_UI_CALL_FAILED`; no task payload is read as an app result.
    - **Docs** (`docs/mcp-tools.md`): dated extension-status note — Apps revalidated on both eras over v2 resource APIs with unchanged bounds; Tasks intentionally not advertised (client + server), draft vocabulary fails closed, task handles not accepted without a supported extension codec and durable ownership model; re-evaluate when the official TS client/server extension codec ships task result dispatch, polling/update/cancel, and subscription notifications with green conformance.
    - No public API changes: `McpAppsBridge`/`McpAppTool`/`McpAppResource` types untouched; no new exports (budget stays at 129).
  - Test Cases (from the plan): modern + legacy Apps negotiation with wire-level ui/tasks capability assertions ✔; app-only visibility and model exclusion (existing suite retained, green) ✔; UI resource metadata precedence (existing nested-over-flat test retained) ✔; CSP/URI/MIME/size rejection (existing suite retained, plus new description-byte and contents-count bounds) ✔; app mutation approval unchanged (ag-ui effect-recording suite retained + new refusal case) ✔; client/server capabilities advertise no Tasks and old task results fail closed ✔.
  - Gates green: mcp 98/98 (3 new), ag-ui 225/225 (1 new), `tsc --noEmit` clean for both packages. Deliberately rejected: building Tasks over the deprecated core task schemas or replacing the agent lifecycle tools (status/resume) with Tasks now — the working bounded lifecycle contract stays until the SDK extension codec is real.
    - Functional: existing MCP Apps opt-in still negotiates `io.modelcontextprotocol/ui` in modern and legacy eras; current model/app visibility, linked resource, MIME, CSP, permission, and same-server tool-call behavior remains; no `io.modelcontextprotocol/tasks` capability is advertised.
    - Performance: Apps list/resource reads retain current pagination and byte/depth/property limits; no additional polling/stream is opened unless Apps or list-change subscriptions are requested.
    - Code Quality: Apps stays on existing bridge types and AG-UI sandbox path; no generic extension framework or speculative Tasks abstraction is added.
    - Security: UI HTML remains unexecuted in MCP package; AG-UI origin/sandbox/approval gates remain; task handles are not accepted without a supported extension codec and durable ownership model.
  - Approach:
    - Documentation Reviewed:
      - MCP Apps extension: https://modelcontextprotocol.io/extensions/apps/overview
      - Tasks extension: https://modelcontextprotocol.io/extensions/tasks/overview
      - SDK v2 task compatibility notes: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28#tasks-deprecated-wire-vocabulary
      - Deprecated registry: https://modelcontextprotocol.io/specification/2026-07-28/deprecated
    - Options Considered:
      - Build Tasks over deprecated core task schemas/custom methods: rejected; conflicts with new extension vocabulary and current SDK typed-method exclusions.
      - Replace existing agent lifecycle tools with Tasks immediately: rejected; loses a working bounded contract for incomplete SDK support.
      - Verify Apps and explicitly defer Tasks: chosen.
    - Chosen Approach:
      - Migrate Apps calls to v2 high-level resource/tool APIs where available and retain existing validation.
      - Add a dated compatibility note: reevaluate Tasks when official TS client/server extension codec supports task result dispatch, polling/update/cancel, and subscription notifications with green conformance.
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpTools({ serverId: "weather", transport, mcpApps: true });
      const app = await bridge.apps!.readResource("ui://weather/card");
      // Tasks intentionally not advertised in this release.
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/bridge.ts` and `packages/mcp/src/types.ts`: v2 Apps adaptation only.
      - `packages/mcp/src/__tests__/bridge.test.ts`: dual-era Apps coverage.
      - `packages/ag-ui/src/__tests__/mcp-apps-effect.test.ts`: cross-package compatibility.
      - `docs/mcp-tools.md`: extension/deprecation decision.
    - References:
      - Current Apps bridge: `packages/mcp/src/bridge.ts:411-668` and `types.ts:164-209`.
      - Current agent lifecycle tools: `packages/mcp/src/server.ts:169-247`.
  - Test Cases to Write:
    - Modern/legacy Apps negotiation; model-only/app-only visibility; UI resource metadata precedence; CSP/URI/MIME/size rejection; app mutation approval unchanged.
    - Assert client/server capabilities do not advertise Tasks and old task results fail closed rather than being misread as tool results.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no Apps API redesign; documented support/deprecation boundary changes.
    - Docs pages to create/edit: `docs/mcp-tools.md`; no new page.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Run protocol/security conformance matrix and release the migration documentation
  - **Completed 2026-09-05.** Official conformance run against the real dual-era serving stack, full security/performance verification, release documentation published.
  - Conformance matrix (official `@modelcontextprotocol/conformance` CLI):
    - New deterministic runner `scripts/mcp-conformance-2026.mjs`: boots the real `createPrismMcpWebHandler` + `createPrismMcpServer` stack (loopback, exact-host allowlists for the DNS-rebinding scenario) with the suite's well-known fixture surface, runs the official server suite, exits with the CLI code. Recorded result: **20/20 expressible scenarios pass; the 14 failing scenarios are all documented Prism boundaries**, baselined in `scripts/mcp-conformance-2026-baseline.yaml` (server-initiated sampling/elicitation/logging/progress from tool callbacks, `resources/subscribe`/`unsubscribe`, completion capability, session-based SSE polling SEP-1699, non-text tool content blocks — Prism flattens MCP tool content to one bounded text block by design). CLI exit 0.
    - **Upstream gap recorded, no silent waiver:** the CLI's newest spec version is **2025-11-25** — no 2026-07-28 scenarios exist upstream yet; the run is repeated when they ship.
    - **Two real defects found and fixed by the matrix:** (a) no-argument prompts failed `-32602` because the SDK passes `undefined` args — prompt `argsSchema` now defaults to `{}` (`server.ts`, required args still enforced); (b) tool `inputSchema` lost `$schema`/`$defs`/`$ref`/`additionalProperties` through the zod `z.fromJSONSchema` round-trip — registration now uses the SDK's `fromJsonSchema` so declared schemas reach the wire verbatim (AJV-backed validation; host `ToolValidator` remains the dispatch owner).
  - Security regression coverage (all green): malformed envelope/header, auth mix-up (`ERR_PRISM_MCP_OAUTH_ORIGIN`), SSRF/DNS rebinding (incl. the conformance Host/Origin 4xx check), oversized JSON/schema/result bounds, MRTR round/replay caps, subscription exhaustion (`maxSubscriptions`), cross-principal cache/session isolation, timeouts, cancellation, redaction — package suites (mcp 98/98) plus the root dist suite (1639/1639) and root gates (103/103).
  - Performance record (loopback fixture, single process): legacy connect ~60ms; auto connect ~40ms (one bounded `server/discover` probe — the only added connect cost vs 1.x, plus SDK codec work); pinned modern connect ~20ms; steady-state bridge tool call ~4ms; uncached list walk ~5ms; cached list refresh ~2ms (hit/miss honored via SEP-2549 hints). No regression beyond the probe.
  - Packaging: `npm run pack:dry-run -w @arnilo/prism-mcp` 30 files; install-smoke fresh offline tarball install 10/10 (consumer imports every documented specifier); no stale `@modelcontextprotocol/sdk` import remains in source/manifests/tests.
  - Release documentation published: `docs/mcp-tools.md` (canonical API, era matrix, auth, MRTR, cache/subscription, extension boundaries + conformance/performance record), `docs/migration.md` (monolithic SDK 1.x → Synapta v2 migration table + legacy-session timeline with the deprecation path for `sessionIdGenerator`), `docs/index.md` (MCP entry updated off SDK 1.30.0 wording), `packages/mcp/CHANGELOG.md` + root `CHANGELOG.md` (Unreleased 2026-07-28 adoption entry), `packages/mcp/README.md`/`examples/README.md` verified current from tasks 4–6.
  - Notes: fixed an unrelated pre-existing docs-gate break (plans/README.md missing the 064 plan link) to keep the docs gate green.
  - Gates green: mcp 98/98, root dist suite 1639/1639, root gates 103/103, docs gate 149/149, install-smoke 10/10, conformance runner exit 0, `tsc --noEmit` clean (mcp + ag-ui). No new exports, budget stays at 129.

## Compromises Made

- Official 2026-07-28 conformance cannot be run yet (CLI publishes 2025-11-25 at latest); the deterministic runner is pinned to the newest published version and re-runs when 2026-07-28 scenarios ship. The 14 baselined failures are Prism's deliberate surface boundaries (bounded text-only tool results, no server-initiated requests from tool callbacks, no session-based SSE), not SDK gaps — each maps to a documented design decision, and the baseline file is the audit trail.
- Performance numbers are recorded as one-process loopback measurements rather than a committed perf gate; the budget gates cover export/declaration surface instead. Add a CI perf scenario only if connect-probe cost regressions become actionable.

## Further Actions

- Re-run `node scripts/mcp-conformance-2026.mjs` when the CLI publishes 2026-07-28 scenarios; shrink the baseline as SDK extension codecs land (Tasks re-evaluation per task 6).
- Collapse the OAuth state round-trip into the codeVerifier record if hosts object to two persisted records (task 5 note).
- Add `resources/subscribe` + server-initiated sampling/elicitation surfaces only behind a concrete host need; each requires new Prism capability advertisement and bounded dispatch wiring.
- Publish the Unreleased changelog entries as the next lockstep release cut.
    - Functional: package tests, modern/legacy HTTP and stdio matrices, official MCP client/server conformance for `2026-07-28`, and repository package/install checks pass; any upstream expected failure is recorded with exact SDK issue/version and no silent waiver.
    - Performance: record connect probe cost, steady-state tool call overhead, list-cache hit/miss behavior, and subscription resource use; no regression beyond one negotiation probe and SDK codec work.
    - Code Quality: package exports, generated declarations, examples, changelog, and migration guide match implemented APIs; no stale v1 import or session claim remains.
    - Security: run malformed envelope/header, auth mix-up, SSRF/DNS rebinding, oversized JSON/schema/result, MRTR round/replay, subscription exhaustion, cross-principal cache/session, timeout, cancellation, and redaction regressions.
  - Approach:
    - Documentation Reviewed:
      - Official conformance repository: https://github.com/modelcontextprotocol/conformance
      - SDK testing guide: https://ts.sdk.modelcontextprotocol.io/v2/testing
      - 2026-07-28 specification changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
      - Prism documentation structure: `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Treat SDK unit tests as protocol proof: rejected; Synapta wrappers alter transport, auth, bounds, and mapping behavior.
      - Run official suite plus focused repository regressions: chosen.
    - Chosen Approach:
      - Add deterministic local conformance fixtures; run 2026 suite separately from legacy tests.
      - Update canonical docs only after behavior is green; preserve existing `docs/mcp-tools.md` index location.
    - API Notes and Examples:
      ```bash
      npx @modelcontextprotocol/conformance list --requirements 2026-07-28
      npx @modelcontextprotocol/conformance server --url http://127.0.0.1:3000/mcp --suite all --spec-version 2026-07-28
      npm run typecheck -w @arnilo/prism-mcp
      npm test -w @arnilo/prism-mcp
      npm run pack:dry-run -w @arnilo/prism-mcp
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/__tests__/*.test.ts`: final dual-era/security coverage.
      - `scripts/mcp-conformance-2026.mjs` and package/root scripts: deterministic conformance runner only if direct commands cannot express required fixture lifecycle.
      - `docs/mcp-tools.md`: canonical API, era matrix, auth, MRTR, cache/subscription, extension boundaries.
      - `docs/migration.md`: v1 SDK/current Synapta API migration table and legacy-session timeline.
      - `packages/mcp/README.md`, `examples/mcp-server.ts`, `examples/README.md`, `CHANGELOG.md`: public release guidance.
      - `docs/index.md`: verify existing MCP entry remains accurate; edit description only if needed.
      - `plans/063-Synapta-MCP-2026-07-28-Adoption.md`: mark completed tasks and record actual deviations/follow-ups.
    - References:
      - Existing tests: `packages/mcp/src/__tests__/{auth,bridge,capabilities,content,elicitation,server,sse-relay,transport}.test.ts`.
      - Existing canonical docs: `docs/mcp-tools.md`, `packages/mcp/README.md`.
  - Test Cases to Write:
    - Official 2026 server/client required scenarios plus explicit legacy regression suite.
    - Packed-package consumer imports all public exports and runs one modern in-process tool call.
    - Full repository typecheck/test/package-truth gates after package-local success.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this is final public contract and migration publication task.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `docs/migration.md`, `packages/mcp/README.md`, `examples/README.md`, and `CHANGELOG.md`.
    - `docs/index.md` update: verify existing “MCP client/server exposure” entry; update description if it still names SDK 1.x/session-first behavior, but add no duplicate entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
