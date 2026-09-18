# Connected apps and work-HTTP primitive review

Plan 081 Task 1 freezes the compatibility and security vocabulary for later tasks. This is evidence only: it adds no public symbol, network path, dependency, or runtime work.

## Sources reviewed

Current contracts: [MCP tools](../mcp-tools.md), [tool effects](../tool-effects.md), [work tools](../work-tools.md), [work connectors](../work-connectors.md), [host compositions](../host-compositions.md), [credential storage](../credential-storage.md), [credentials and redaction](../credentials-and-redaction.md), [host security](../host-security.md), [Obscura](../obscura.md), [computer-use-linux](../computer-use-linux.md), [messaging channels](../messaging-channels.md), and [ACP](../acp.md). The pinned MCP SDK v2 transport/OAuth API was checked against [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/).

## Existing primitives and compatibility freeze

| Existing contract | Evidence | Later use / compatibility rule |
| --- | --- | --- |
| MCP bridge connects only host-supplied `serverId` + transport, lists before returning, and exposes `refresh`/`close`. | `packages/mcp/src/bridge.ts:49-97`; `packages/mcp/src/types.ts:265-296,354-364` | Task 2 composes `connectMcpTools`; it does not fork transport, discovery, list caching, naming, limits, or bridge lifecycle. |
| Effect policy receives only host-configured `serverId` and `remoteName`; descriptions/annotations are deliberately unavailable. Omission resolves to `external_mutation` / `unsupported`. | `packages/mcp/src/types.ts:256-263`; `packages/mcp/src/bridge.ts:267-288` | `ConnectedAppSelect` controls admission; optional app/session effect policy can only narrow known remote names. Never infer effects from remote metadata. |
| Stdio is an explicit host `command`/`args`/`env`/`cwd` transport. Streamable HTTP requires exact origins and uses pinned, redirect-free, byte-bounded fetch; OAuth discovery uses the same boundary and strips bearer credentials from discovery GETs. | `packages/mcp/src/types.ts:34-59`; `packages/mcp/src/transport.ts:37-237`; `src/pinned-fetch.ts:50-82` | Task 2 accepts already host-built `McpTransportConfig`; no command construction, path search, credential resolution, or alternate HTTP client. HTTP adapters in Tasks 4–5 reuse `pinnedFetch`, not a weaker fetch path. |
| ACP requires an `mcp.select` seam before client MCP config is admitted, applies server/config/header caps, rejects unstable `acp`, and its launcher separately matches explicit stdio/origin allow entries. | `packages/ag-ui/src/acp/mcp-config.ts:17-54`; `packages/acp-agent/src/index.ts:78-125` | `ConnectedAppSelect` follows this fail-closed host-admission shape but remains MCP-package-local; Tasks 2–3 do not couple ACP to connected apps. |
| Work adapters are structural `Microsoft365Adapter` / `GoogleWorkspaceAdapter` contracts: identity, allowed ops, readiness, `runOp`, and common draft lifecycle. The CLI adapters are additive existing implementations. | `packages/prism-core/src/integrations/work/types.ts:304-365`; `packages/prism-core/src/integrations/work/google-workspace.ts:215-360`; `packages/prism-core/src/integrations/work/microsoft365.ts:281-434` | Tasks 4–5 add HTTP implementations only. Existing CLI factories and argv maps remain byte-compatible. |
| Work mutations are draft-then-approve, identity/revision/digest-bound, claim before external effect, and become unknown rather than replayed after ambiguous dispatch. Reads and mutations are classified centrally. | `packages/prism-core/src/integrations/work/drafts.ts:68-113`; `packages/prism-core/src/integrations/work/tools.ts:69-286,806-814` | HTTP adapters must feed these adapters/contracts; they must not own a second draft, approval, idempotency, or result-normalization system. |
| `WorkTokenProvider` returns a late-bound per-identity environment map or `undefined`; OAuth token resolution rejects account and tenant mismatches. | `packages/prism-core/src/integrations/work/types.ts:304-309`; `packages/prism-core/src/credentials/node/work-token.ts:24-68` | Tasks 4–5 require this provider at request edge. Tokens stay out of model arguments, URLs, argv, reports, and logs. |
| Composition inspection derives identifiers and readiness synchronously; it has no connector import or I/O. | `src/host-composition.ts:181-331`; `src/__tests__/host-composition.test.ts:299-320` | Task 3 reports only bounded app/server identifiers supplied by host. It never accepts transport, headers, `env`, tokens, bridge objects, or a live MCP check. |
| Obscura is a thin bridge wrapper with injected `connect` test seam and an explicit read-effect override; unclassified tools retain MCP mutation default. | `packages/web-tools/src/obscura/mcp.ts:63-72` | Task 6 copies this direct composition. Do not add a generic read/write wrapper until a third production caller exists. |
| computer-use-linux validates device admission before bridging, uses an allow-listed child environment, filters known tools, serializes mutations, and classifies unknown/mutating work conservatively. | `packages/prism-coding-tools/src/computer-use-linux/create.ts:56-123` | This is evidence that specialized MCP wrappers remain package-local policy layers, not a reason to generalize a connector framework. |
| Channels are authenticated inbound execution/delivery transports; work tools are high-trust typed draft/approval tools; MCP maps selected remote tools. | `packages/prism-channels/src/runtime.ts:1-80`; [messaging channels](../messaging-channels.md); [work connectors](../work-connectors.md#out-of-scope) | Tasks 2–7 preserve three planes: MCP tools != work tools != channels. Slack/Teams inbound adapters are out of scope; M365 `teams` capability is not a channel. |

### Frozen vocabulary

Later tasks use these exact names:

- `ConnectedAppBinding`, `ConnectedAppSession`, `createConnectedAppSession`
- `bind`, `unbind`, `list`, `tools`, `refresh`, `close`
- `ConnectedAppSelect`
- `createGoogleWorkspaceHttpAdapter`, `createMicrosoft365HttpAdapter`

`ConnectedAppSession` is the one new generic primitive. It belongs in `@arnilo/prism-mcp`; no twelfth package, catalog abstraction, generic remote proxy, or second OAuth stack is justified. Its transport admission is mandatory and deny-by-default. Its effect policy keeps the MCP default when it returns `undefined`.

## Later-task mapping

| Task | Frozen primitive or explicit boundary |
| --- | --- |
| 2 | `connectMcpTools`, `McpTransportConfig`, `McpToolEffectPolicy`, `assertValidServerId`, bounded MCP limits. New session only orchestrates host-approved bridges. |
| 3 | `inspectHostComposition` / `assertHostCompositionReadiness`; identifiers-only report with no MCP dependency or network. |
| 4 | `GoogleWorkspaceAdapter`, `WorkTokenProvider`, work drafts, idempotency, normalizers, `pinnedFetch`. Google REST implementation is additive. |
| 5 | `Microsoft365Adapter`, same shared work primitives, `pinnedFetch`. Graph implementation is additive. |
| 6 | `createObscuraMcpTools` direct `connect` + `effect` composition. Example only; no Slack dependency or work-tool provider. |
| 7 | Explicitly out of core: Open Connector remains a sibling sidecar recipe/mock. No dependency, vendoring, catalog discovery, or first-class `execute_action` tool. |
| 8 | Documentation/verification only. Refresh graph and verify budgets after implementation; no version bump here. |

## Threat model and required posture

| Threat | Current protection | Requirement for 081 |
| --- | --- | --- |
| MCP auto-discovery | Bridge requires explicit `serverId` and transport; docs prohibit auto-discovery. | No catalog URL, discovery scan, or implicit bind. `select` must approve every bind. |
| Remote effect annotations or descriptions | Policy input excludes them; missing policy is nonrecoverable mutation. | Host classifies exact server/name only. Unknown remote stays `external_mutation` / `unsupported`. |
| Stdio command injection / ambient secrets | Host supplies argv; specialized wrapper shows allow-listed child env. | Session receives a complete host-built transport only; model cannot choose command, args, cwd, or env. |
| HTTP SSRF, DNS rebinding, redirect, credential forwarding | Exact origins, DNS pinning, public-address checks, redirect rejection, byte caps, loopback-only plaintext exception. | Connected HTTP binds and work HTTP factories deny origins by default and retain `pinnedFetch`; model never supplies a request URL. |
| Cross-identity token reuse | Work OAuth token provider loads exact account and rejects mismatched tenant. | Bind identity must equal session identity; resolve tokens at connect/request edge per identity; do not retain secrets in inspection/listing. |
| `execute_action` exposed as harmless model action | Unclassified MCP tool is a nonrecoverable external mutation. | Open Connector example keeps it unclassified and allowlisted only after host `select`; no model-facing provider catalog. |
| In-process catalog sidecar compromise | Prism packages have explicit imports and no catalog dependency. | Sidecars run separately over an explicitly allowed loopback MCP transport; never vendor Open Connector, Klavis, or Nango. |
| Slack/Teams confused with inbound channels | Channel and work documentation distinguish channel adapters from M365 capability operations. | Slack example is an outbound MCP-tool wrap; no inbound Slack/Teams channel is introduced. |

## Current verification evidence

- MCP bridge default-effect coverage: `packages/mcp/src/__tests__/bridge.test.ts` exercises the bridge contract; the invariant is implemented at `packages/mcp/src/bridge.ts:267-288`.
- Zero-network composition probe: `src/__tests__/host-composition.test.ts:299-320` replaces `globalThis.fetch` and proves `inspectHostComposition` does not call it.
- Cross-account and wrong-tenant token probes: `packages/prism-core/src/credentials/node/__tests__/oauth.test.ts:369-391` expect `undefined` from `createOAuthWorkTokenProvider`.
- Work classification is centralized at `packages/prism-core/src/integrations/work/tools.ts:69-86,806-814`; coverage is in `packages/prism-core/src/integrations/work/__tests__/work-tools.test.ts`.

## Task 8 budget baseline

`scripts/budgets.json` has an explicit root packed-byte budget only. Task 8 must retain its 1,247,731-byte baseline with 5% tolerance (ceiling 1,310,118 bytes) and must not add a blanket package-size budget. Current `npm pack --dry-run --json` measurements are `@arnilo/prism-mcp` 46,060 bytes (32 files), `@arnilo/prism-core` 412,206 bytes (444 files), and `@arnilo/prism` 1,279,372 bytes (495 files). Public export counts exactly match their ceilings: `@arnilo/prism-mcp` 134, `@arnilo/prism-core` 1,474, and `@arnilo/prism` 1,347 (`scripts/budgets.json:3-67`; `scripts/budget-gates.mjs:151-163`). The two package-specific packed measurements are evidence, not a new ceiling.

## Review decision

Proceed with the thin MCP session and additive HTTP adapters. Reuse existing MCP transport/effect, work draft/idempotency/token, and host-inspection primitives. Keep catalogs, remote effect trust, command construction, generic Graph/Discovery calls, and Slack/Teams inbound channels out of scope.
