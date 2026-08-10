# Host security guide

## What it does

This guide is a fail-closed checklist for apps embedding Prism. It maps host security responsibilities to existing Prism APIs for credentials, settings, redaction, trust roots, permission policies, session and ledger persistence, extension loading, and tool validation.

Prism supplies seams and checks. The host owns policy decisions, secret sources, durable storage, approval UI, sandboxing, and which contributed capabilities become active.

## When to use it

Use this guide before exposing an agent to users, third-party extensions, durable storage, or real provider credentials.

Do not use it as a replacement for product threat modeling, process/container sandboxing, secret management, database access control, or provider-side policy. Prism does not sandbox tools/extensions and does not detect arbitrary secrets.

## Inputs / request

Start from explicit host inputs. Do not let runtime code discover security state implicitly.

| Security input | Host-owned source | Prism API / page |
| --- | --- | --- |
| Settings | app config object or caller-named files | `createStaticSettingsProvider`, `loadSettingsFiles()` |
| Credentials | runtime override, memory store, vault/env object | `createExplicitCredentialResolver`, `createEnvCredentialResolver`, `resolveCredentialValue()` |
| Redaction values | exact known credential strings | `createSecretRedactor`, `redactSecrets()` |
| Trust roots | app-selected directories/resources | `createPathTrustPolicy`, `assertTrusted()` |
| Permission decisions | allow/deny rules or approval UI result | `createStaticPermissionPolicy`, `assertPermission()` |
| Tool allow-list | active tools for this agent/session/run | `createToolRegistry`, `filterTools()`, `dispatchToolCall()` |
| Tool argument rules | host validator | `AgentConfig.validator`, `RunOptions.validate`, `ToolValidator` |
| Guardrail decisions | host callback allow/block/tripwire policy | `Guardrails`, `Guardrail`, `GuardrailError` |
| Coding execution policy | path/command approval adapter | `ExecutionPolicy`, `@arnilo/prism-coding-security` |
| Remote media policy | public/default pinned DNS or explicit trusted transport | `SsrfPolicy`, `resolveMediaContentBlock()` |
| Durable history | host database adapter | `SessionStore`, `assertSessionStoreConforms()` |
| Durable audit | host ledger adapter | `RunLedger`, `redactRunLedgerRecord()` |
| Telemetry | host OpenTelemetry SDK/exporter | metadata-only adapter, controlled metric labels, `onTraceReference` |
| Durable interruption | host checkpoint + session stores, exact ownership | `RunOptions.runState`, `resumeAgentRun()`, `createAgentRunLifecycle()`, `createSecureAgent()` |
| Extensions | explicit package imports only | `createExtensionKernel`, `ExtensionAPI` |
| Remote agent/workflow API | host authentication + ownership mapping | `@arnilo/prism-server`, `createPrismHandler()` |
| Authenticated identity | host `IdentityVerifier` → verified `AgentIdentity`; optional OIDC/JWKS reference adapter (`@arnilo/prism-credentials-node/oidc`, pinned issuer/audience/JWKS, fail closed) | [Agent identity](agent-identity.md), `assertIdentityActive`, `narrowIdentity` |
| Policy decision audit | optional redacted ledger + host WORM sink | [Policy and audit](policy-and-audit.md), `@arnilo/prism-policy` |
| Durable enterprise state | host PostgreSQL pool, TLS, exact owner/principal projection, migration/runtime database roles, backup and explicit cleanup schedule | [Enterprise PostgreSQL state](enterprise-postgres-state.md), `@arnilo/prism-enterprise-postgres` |
| MCP server exposure | host MCP auth + selected capability list | `createPrismMcpServer()`, `createPrismMcpWebHandler()` |

## Outputs / response / events

Security controls fail closed before side effects when wired at the guarded edge:

- trust denial blocks resource/extension reads before load/use
- permission denial blocks extension setup, resource loading, and tool execution
- unknown or denied tools emit `tool_execution_blocked`
- validator failures emit `tool_execution_blocked` with `validation_failed`
- configured guardrails fail closed; output stages buffer blocked provider/tool content before events, ledgers, session entries, or MCP responses
- configured redactors scrub provider requests, agent events, session entries, ledger records, tool errors, extension errors, injector context, and durable run checkpoints
- durable resume requires host-derived exact ownership and checkpoint version; coding-task resume also revalidates plan/workspace artifact hashes plus tool/policy/image fingerprints via `assertCodingResumeAllowed` before import; `createAgentRunLifecycle()` exposes only public state through explicitly selected server/MCP capabilities; never accept ownership or resume input from an approval body

These checks are explicit function calls during load, assembly, dispatch, append, or run handling. Prism adds no background watchers, filesystem scanners, network probes, credential polling, or automatic extension discovery.

## Request/response example

```json
{
  "credentialSource": "caller-owned env object",
  "trustedRoots": ["/workspace/app"],
  "allowedActions": ["tool:notes/read:execute", "extension:acme:setup"],
  "activeTools": ["notes/read"],
  "toolValidation": "host ToolValidator",
  "persistence": "redacted SessionStore + RunLedger"
}
```

The JSON above is an app security plan, not a Prism config format. Hosts translate each field into the explicit APIs listed in this guide.

## Implementation example

```ts
import {
  createEnvCredentialResolver,
  createSecretRedactor,
  createStaticPermissionPolicy,
  createToolRegistry,
  filterTools,
  resolveCredentialValue,
  type ToolDefinition,
  type ToolValidator,
} from "@arnilo/prism";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

const workspaceRoot = "/workspace/app";
const env = { DEMO_API_KEY: "fake-demo-key" }; // docs-only placeholder
const credentials = createEnvCredentialResolver(env, { demo: "DEMO_API_KEY" });
const apiKey = await resolveCredentialValue(credentials, { provider: "demo", name: "apiKey" });

const redactor = createSecretRedactor([apiKey]);
const permission = createStaticPermissionPolicy({
  allow: ["tool:notes/read:execute", "extension:acme:setup"],
});
const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });

const readNotes: ToolDefinition = {
  name: "notes/read",
  parameters: { type: "object", properties: { id: { type: "string" } } },
  execute(args, context) {
    return { toolCallId: context.toolCallId, name: "notes/read", value: { id: args.id } };
  },
};

const validate: ToolValidator = (_tool, args) =>
  typeof args.id === "string" && args.id.length <= 100
    ? undefined
    : "id must be a short string";

const tools = createToolRegistry(filterTools([readNotes], { allow: ["notes/read"] }), { duplicate: "error" });

void { apiKey, redactor, permission, trust, tools, validate };
```

Wire those values where they matter: provider adapters receive the resolved credential, agents/runs receive `redactor`, tool dispatch receives `trust`, `permission`, and `validate`, resource/extension loaders receive `trust` and `permission`, and durable adapters receive already-redacted entries/records. `createSecureAgent()` is an opt-in shortcut that requires these agent/tool seams, strict schemas, finite limits, exact ownership, and durable approval before every tool side effect; low-level `createAgent()` stays explicit.

## Extension and configuration notes

- Keep security state explicit. Settings and credentials are host-owned outside `AgentConfig`; `createAgent()` and `session.run()` do not automatically call `settings.get()` or `credentials.resolve()`.
- Resolve credentials at the provider/request edge, as late as possible. Do not put resolved credentials in configs, manifests, registries, prompts, messages, events, session entries, run ledgers, idempotency keys, cache keys, or logs.
- Use `createExplicitCredentialResolver()` to document source order such as runtime override → stored credential → caller-supplied env object → fallback.
- Use `createEnvCredentialResolver()` only with an object the host passes in. Prism does not read `process.env` for credentials.
- Do not treat a local vendor CLI credential file, setup token, browser session, or consumer subscription as a Prism credential source. In 0.0.12 only OpenAI Codex has a first-party subscription OAuth flow; Anthropic and Google providers remain API-key-only under their published third-party restrictions. See [Credentials and redaction](credentials-and-redaction.md#subscription-oauth-eligibility).
- Use `createPathTrustPolicy()` for workspace/resource roots and fail closed on symlink escapes.
- Use `createContributionRegistries({ duplicate: "error" })` and prefixed names for third-party packages to prevent silent shadowing.
- Extension contributions are inert until selected. Loading an extension package runs its `setup(api)` code, so hosts should load only trusted packages or isolate untrusted code outside Prism.
- Skills and instruction injectors grant no tools, permissions, validators, or resource access. Host-active tools and permission policies still decide execution.
- Optional ledger batching accepts runtime-redacted records only. Prefer `flush_on_terminal`; `buffered` explicitly permits crash-before-flush loss. Flush failures propagate; hosts can call `dispose({ flush: false })` to clear queued objects when deliberately discarding an aborted buffered workload.
- Session snapshot cache holds one session-local leaf for at most one second and invalidates after committed mutation, checkout, compaction, and resume; it never crosses session/branch/ownership.
- For production persistence, implement a database-backed `SessionStore`/`RunLedger`, run `assertSessionStoreConforms()` against the store, and follow the database schema guidance. Do not ship provider instances, credential resolvers, or secrets into durable rows.

## Security and performance notes

- Fail closed: unknown providers, unknown tools, denied tools, invalid tool arguments, missing skill tool dependencies, trust failures, permission failures, append conflicts, and validator failures should stop the unsafe action.
- Prism does not sandbox host tools, extensions, provider adapters, credential resolvers, or custom middleware. Use OS/container/process isolation when code is untrusted.
- Redaction is exact known-secret replacement only. It is not arbitrary secret detection, entropy scanning, or DLP.
- Known secrets must be passed into redactors before data is emitted or persisted. Redact again in host adapters if they transform records after Prism redaction.
- OpenAI Realtime sessions require a stable host owner identifier, use header-only credentials, and bind to the server `session.created` id. Treat returned audio/transcripts as untrusted; use a `SecretRedactor`, retain finite event/byte/wall caps, and close on disconnect or an identity/budget breach.
- Tool `parameters` metadata is not validated by default. Add a `ToolValidator`, use `createToolParameterValidator()` with a schema adapter, or install `@arnilo/prism-tool-validator-json-schema` before side effects. Its untrusted-schema adapter rejects non-local refs, forbidden keys/cycles/non-finite values and bounds bytes/depth/properties/keywords/refs plus its LRU cache before Ajv compilation; do not raise caps above documented hard limits.
- RAG `replaceSource()` only accepts a store with scoped `getBySource()` plus a real transaction; it stages bounded embeddings before mutation and otherwise fails closed. `deleteSource()` rechecks returned tenant/resource/corpus/source metadata. `createResourceDocumentLoader()` receives only a host-authorized `ResourceLoader`; `createWebFetchDocumentLoader()` never opens I/O and rejects local/private/IP-literal URLs before delegating to host-configured web-tools. HTML scripts/styles are stripped, PDF parsing has byte/page/time caps and rejects compressed PDFs.
- RAG retrieval always emits `trust: { untrusted: true, inert: true, injectionCapable: true }` plus attributable citation provenance. Context blocks repeat this metadata and never gain tool authority. Host `Reranker`s see redacted finite candidates, are hard-capped by bytes/time/concurrency, must return only a permutation of candidate IDs, and cannot overwrite provenance/trust. Ingestion status errors are redacted; status storage/listing stays exact-scope and capped.
- Treat embeddings as untrusted numeric input. `@arnilo/prism-memory` rejects empty, non-number, NaN, and infinite vectors before in-memory similarity, pgvector parameters, export, or rebuild; custom `Embedder`/`VectorStore` implementations must retain the same boundary. Memory entries carry consent/source/visibility; revoked/invisible entries never enter prompts, events, exports, or telemetry. `exportMemory()` additionally excludes consent-less legacy records regardless of recall mode and requires exact host identity equal to its tenant/resource/thread scope. Save rebuild cursors only in host-authorized storage; `rebuildIndex()` is one abortable capped page, never an implicit corpus job. `forget`/`applyRetention` are real bounded deletes.
- Evaluation trace readers require exact supplied ownership plus session/run identity, reject cursor/identity drift, and redact before bounded scorer/judge input. Model-judge callbacks receive no credential resolver, tools, or workspace; keep live judges outside default CI and redact report artifacts.
- Prism-generated session/run/tool/workflow/evaluation IDs use Node cryptographic UUIDs. Keep host-provided IDs authorization-scoped and validate them as untrusted identifiers; do not substitute timestamps or `Math.random()` for durable/security-relevant IDs.
- MCP client tools from `@arnilo/prism-mcp` are untrusted remote servers. Stdio remains an explicit host executable. Streamable HTTP requires exact HTTPS origins, rejects credentials/fragments/redirects/private or mixed DNS, pins a validated address on every SDK request/reconnect, and bounds each response; plaintext is explicit loopback-only development mode. Discovery has finite page/tool/cursor/metadata/schema totals and commits atomically. Every result branch shares byte/depth/property bounds before core dispatch; supply a known-secret `SecretRedactor`, `PermissionPolicy`, and `ToolValidator` there. MCP server direction exposes only passed tools/commands/resources/prompts, requires per-operation `authorize`, and retains core gates. Sampling, roots, model/credential selection, and elicitation consent stay host-owned; URL elicitation is never opened automatically. Stateful web mode requires host `resolveAuthInfo` plus `resolveIdentity`, exact origin policy, and binds every POST/GET/DELETE/SSE request to one non-secret principal; mismatches return 404. Handler still needs TLS and edge rate limiting. See [MCP client/server exposure](mcp-tools.md).
- AG-UI fields stay untrusted after schema validation. `input.project` returns host-selected messages/handoffs only; never merge state/tools/context/props into ownership, identity, permissions, provider options, or media policy. Apply Prism media SSRF/MIME bounds before resolution; output projectors are bounded allow-lists; interrupt edits deny rather than mutate persisted calls.
- AG-UI MCP Apps requires negotiated `mcpApps`, exact proxy origin/auth, owned-run context, approval, one bridge, separate-origin sandbox (`allow-scripts allow-same-origin`), and no-wider CSP. Never execute HTML in host origin or retry a UI mutation; Task 4 adds recovery.
- AG-UI A2A requires exact-origin verified client, host-owned task selection/correlation, explicit data/tool/A2UI projection, and reauthorized follow/cancel.
- `@arnilo/prism-server` exposes no agent/workflow by default and requires `authorize()` for every matched operation. Derive complete tenant/account/user ownership from validated host identity, never request JSON. Workflow active identity and cancellation compare exact ownership; a tenant-only scope intentionally cannot cancel a checkpoint/run carrying account or user identity. The artifact review service (`createArtifactService`) requires authenticated identity + thread ownership on every attach/revise/compare/approve/reject/download, resolves concurrent reviewers via checkpoint CAS (no lost approvals), rejects local filesystem paths in `uri`/citations, redacts records before persist and on response, and serves downloads only through signed expiring links that are reauthorized against the token's ownership per request. When a blob store is wired (`bodies: ArtifactBodyStore`, 0.0.28), delivery links additionally resolve through `bodies.presign`; the reference `createS3ArtifactBodyStore` verifies ownership on every operation, verifies size/SHA-256/MIME on put and get (fail closed), refuses delete under legal hold (host `isHeld` callback), keeps credentials host-resolved, and never discloses bucket/path/key in errors, telemetry, or artifact records. Pass the current explicitly revised workflow definition so recursive hash mismatch fails before abort or durable mutation. Configure exact host/origin allow-lists where needed, wire redaction before execution, retain tool/workflow policy checks, and adapt the Web handler behind host TLS/rate limits. Disconnect abort is default; persistent reconnect/status belongs to durable workflow checkpoints, not an invented in-memory agent result cache.
- Coding tools from `@arnilo/prism-coding-agent` accept an optional `ExecutionPolicy` checked inside each tool before side effects; shared policy propagation includes `createReadOnlyTools()`. They enforce finite text-scan/image/edit/write/shell limits, repository list/search depth/entry/match/scan/time caps, structured Git path/ref/message/output/patch/worktree caps, named-check concurrency/output caps, a 600-second default shell wall time, and a 64 MiB default total-output ceiling. Opt-in `createGitTools()` uses argument arrays with hooks/credential prompts/external diff disabled, requires host `commitIdentity` for commits, and never pushes or opens PRs. Successful truncated shell output leaves a host-owned exclusive `0600` temp file; delete `metadata.fullOutputPath` after use. Error/abort/timeout/overflow removes unpublished spills. Custom read/edit/shell/repository backends must honor supplied caps/signals. Use `@arnilo/prism-coding-security` for path roots, command rules, identity-scoped approval caching, required `workspaceMode` on `createSandboxCodingComposition()` / `createSandboxCodingTools()`, and the optional `createDockerSandbox()` reference adapter. **Host mode is never contained execution** (`containmentClaim: false`). Sandbox mode claims containment only when FS backends target the disposable tree; mixed wiring requires `allowMixedWorkspaceWiring` and still does not claim containment. Limits alone are not containment: construct the Docker adapter (absolute CLI, digest-pinned image, network none by default) or an equivalent host sandbox before treating coding execution as production-safe. Docker daemon/image trust, egress firewall/proxy, and artifact retention remain host-owned.
- Allow-list egress (0.0.26, `@arnilo/prism-coding-security`): `createEgressPolicy()` is deny-all with exact host/port/protocol rules and frozen `npm-registry`/`github` presets; `createAllowListEgressProxy()` is an HTTP forward proxy + CONNECT tunnel that pins DNS answers and verifies the connected address (rebinding defense), denies private/link-local/metadata ranges unless a rule opts in, re-validates every redirect hop against policy, and cuts oversized/slow transfers at frozen byte/time caps. TLS passes through without interception. Every allow/deny writes an audit record with no secrets. The proxy is inert until `start()`; `reloadPolicy()` is the only rule change path. `composeEgressSandboxNetwork(proxy.attestation(), name)` records validated attestation as `prism.egress.*` container labels — evidence, not enforcement: the host must restrict the Docker network so the proxy is the only reachable path, and `denyDirectEgress: true` is a claim the host makes true by topology. The proxy is not a firewall and cannot stop a container whose network reaches the internet directly.
- Optional `@arnilo/prism-browser` requires a host-supplied Playwright Browser (`playwright-core@1.61.0` peer). Import is inert. One non-persistent context belongs to one run; actions serialize; refs are snapshot-scoped; CSS/evaluate/CDP/persistent profiles are denied. Context routing + `serviceWorkers: "block"` deny file/data/blob/devtools/private/loopback by default and require contained-proxy attestation for external egress (Playwright routing is defense in depth, not DNS containment). Uploads are realpath-rooted; downloads quarantine with hash/MIME until host `approveRelease`; screenshots return bounded `ImageContent`. Observation vs mutation/high-impact actions map to `ExecutionPolicy`. Treat snapshot/page text as untrusted external content. Close contexts with `browser_close` or `manager.closeRun(runId)` on abort/terminal. Browser control endpoint, binary/image pin, and real egress firewall/proxy remain host-owned. Shared sandbox: `createSharedSandboxBrowserOptions()` + `assertBrowserSandboxNetwork()`.
- Browser verified-state checkpoints (0.0.14, `createBrowserCheckpointLedger()`) store URL + domain-state hash + host data refs only — never serialized browser internals (cookies/storage/contexts). After any resume/interruption the ledger fails closed (`assertVerifiedBeforeSideEffect`) until the host reloads + verifies, so side effects never replay on stale state.
- Device adapters (0.0.14, `resolveDevicePolicy`/`assertDeviceAdmit`) are deny-by-default: admission fails closed without explicit `enabled`, an explicit sandbox, approval (when required), an under-budget session count, and shared `RunLimits`. Stream chunks over the frozen cap are dropped with a marker; telemetry is redacted before emit/persist. No vendor voice/desktop package ships in 0.0.14 (demand-gated 0.1.x); device adapters cannot broaden consent/memory/network/file/browser/connector/tool permissions (gate 8).
- `@arnilo/prism-credentials-node` rejects oversized/malformed envelopes and excessive scrypt work before KDF allocation, uses async scrypt, and requires restrictive existing/new Unix vault modes. Keep vault ownership and parent-directory access host-controlled; review before `chmod 600`, never auto-weaken a file policy. Keychain calls use abort-aware native async work with finite timeout/payload caps and sanitized errors. OS prompts, service availability, and whether a native backend promptly honors cancellation remain host/platform boundaries; no plaintext fallback is attempted.
- LLM compaction always sends finite summary `maxTokens`, retains bounded deltas/events, and bounds/redacts provider/factory/policy error detail. Observational-memory workers cap turns, calls, arguments, results, transcript, and surfaced errors; unknown tools fail before execution, while invalid results can only be rejected after a host tool returns and may therefore follow side effects. Pass all known provider/credential/tool secrets into compaction/runtime options; exact replacement is not secret discovery.
- Default remote-media loading resolves every DNS answer, rejects the hostname if any address is non-public, and pins one validated address through the request. Explicit `allowedHostnames` can trust private destinations. A host-supplied `fetch` owns DNS/rebinding/proxy/redirect safety; a custom `requestUrl` must connect to its supplied validated address.
- Permission checks happen before tool validation and before `tool.execute()`. Middleware cannot grant permission by renaming a tool.
- Session stores and ledgers receive redacted values when a redactor is active, but durable storage remains host-owned. Enforce tenant/account/user ownership, retention, legal hold, and quotas via `ProductionPersistenceStore.lifecycle` (or host-equivalent DB controls). Hold always blocks delete.
- `@arnilo/prism-enterprise-postgres` request paths require exact tenant scope plus principal for work/router state, use bound SQL values, and retain no prompts, connector request bodies, raw provider results, tokens, or credentials. Configure TLS/credential rotation/connection limits with the host `pg` pool. Run checksum/catalog migration setup with a controlled migration principal; keep request-path SQL least-privilege (`USAGE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` on six state tables) and do not grant request workers `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`, or `COPY PROGRAM`. Back up and restore-test the schema; run bounded owner-scoped `state.cleanup()` from an authorized host job. `unknown` connector outcomes require reconciliation and must never auto-replay.
- Prefer `createExtensionKernel({ loadPolicy })` allow-list/signature checks before loading third-party extension packages.
- Provider-owned auth/content/session/cache/security headers win over caller headers in adapters that merge headers.
- Security checks are bounded explicit calls on the active path. Prism adds no hidden global middleware, background workers, watchers, network calls, or filesystem scans.

### 0.0.4 release security audit (2026-07-14)

- `npm audit --audit-level=high`: 0 vulnerabilities at every severity.
- Lockfile: 162 registry dependency records, all with `resolved` provenance URL and integrity hash; `npm ls --all` reports a clean graph.
- License inventory: 160 locked third-party packages; all declare permissive MIT, ISC, BSD, Apache-2.0, or compatible dual licenses. No GPL, AGPL, SSPL, or missing lockfile license metadata.
- Install scripts: only `better-sqlite3@12.11.1` runs an install script (`prebuild-install || node-gyp rebuild --release`), required by the explicitly installed SQLite adapter. Core and other optional packages add no install hook.
- Secret scan: source, tests, docs, workflow files, package metadata, built tests, packed-install canary, and tarball deny-list checks found no private-key block or common live-token prefix. Runtime redaction fixtures cover requests, events, ledgers, stores, checkpoints, provider/OAuth errors, and credential ciphertext.
- Threat suites pass for parameterized SQL/tenant isolation, HTTP URL/SSRF rejection, realpath/symlink containment, shell-metacharacter approval, schema prototype-pollution/remote-reference bounds, OAuth polling/abort/redaction, credential tamper/wrong-key/KDF floors, MCP result bounds/timeouts, and coding approval/path policy.

PostgreSQL TLS/network policy, MCP endpoint trust/credentials and egress policy beyond package origin/DNS pinning, provider base URLs, OS keychain availability, process sandboxing, workflow tenant identity, and ANSI/control-sequence sanitization in any host terminal renderer remain host boundaries. Prism 0.0.4 ships JSON-line RPC, not an interactive TUI; hosts must render untrusted model/tool text safely. Credential-gated PostgreSQL/provider/keychain tests are separate operator/CI gates, not silently replaced by mocks.

## Supervisor and A2A boundaries

- Register children explicitly. AND-compose parent/child/hook permissions; never let a delegation hook replace broader parent policy.
- Build each child's context/memory with supervisor-provided `resourceId`/`threadId`; resolve provider credentials inside that child factory.
- Keep depth, active children, input, turn/tool/token, timeout, and queue ceilings finite; propagate abort through nested calls.
- Expose A2A only behind per-request authentication/authorization, TLS, edge rate limits, and replay policy. Public card discovery grants no invoke access.
- Remote A2A endpoints/card URLs require exact HTTPS origin allow-lists and redirect rejection. Pin ES256 card keys/expiry; never auto-fetch untrusted `jku`.
- Treat cards, rich parts, task status/history, errors, artifacts, and SSE replay frames as untrusted bounded input and redact before logs/hooks/events. URL parts require host public/pinned-network policy and are never auto-fetched. Durable task/push adapters repeat exact-owner checks; foreign/missing records share not-found responses.
- Push delivery remains host-owned: validate every attempt/redirect against SSRF/rebinding policy, cap retries/time/output, authenticate webhook payloads, deduplicate event IDs, and keep token/auth credentials out of configs returned over A2A. Client streaming uses fatal UTF-8 decoding and rejects partial/post-terminal frames.

## Web research boundaries

- Construct `@arnilo/prism-web-tools` with one host-selected Brave or Exa adapter; never expose adapter/provider/credential/schema selection to model arguments.
- Construct `@arnilo/prism-work-tools` with host-pinned CLI binary + isolated `configDir` + verified `AgentIdentity` (M365 and/or GWS). Never pass model-built command strings, `login`/`setup`/`auth`/`schema`/`--debug`, or credentials in argv. Mutations require draft approval; external recipients and anonymous/`anyone` shares fail closed.
- Provider API origins are fixed exact HTTPS origins and redirects fail. Credentials resolve immediately before I/O; remote bodies and secrets are excluded from errors/results/telemetry.
- Firecrawl targets reject userinfo, non-HTTP(S), private literals, and policy-denied hosts. Supply `validateUrl` for host DNS/rebinding/egress checks. Firecrawl performs remote retrieval, so Prism cannot pin target DNS after handoff.
- Treat every snippet, highlight, Markdown byte, metadata field, and extracted JSON value as prompt-injection-capable untrusted data. Never elevate it into system instructions or let it modify tools, permissions, trust, credentials, routing, or extraction schema.
- Keep counts/bytes/retries/rate delays/polling/concurrency/wall time finite. Live credentials belong only in explicit protected `PRISM_LIVE_WEB=1` runs.

## Supply-chain and live-canary boundaries

- Require `security / codeql`, `security / supply-chain`, PR dependency review, release readiness, and PostgreSQL integration in protected-branch rules. Enable GitHub secret scanning and push protection as repository settings; checked-in workflows cannot enable those service controls.
- Actions are pinned to full commit revisions. Dependabot proposes weekly npm/action revision changes; review upstream release notes before merge rather than replacing pins with moving tags.
- `scripts/verify-sbom.mjs` accepts only bounded SPDX 2.3 inventory with exact checked-in permissive licenses. Any missing/new expression fails until reviewed; do not widen policy merely to unblock CI.
- `scripts/scan-secrets.mjs` checks tracked source and unpacked public tarballs for high-confidence credential/private-key forms without printing matched values. It complements GitHub secret scanning; it is not entropy scanning or DLP.
- Tag publication alone receives npm/OIDC/attestation permissions. Untrusted pull-request code receives no canary, npm, or OIDC secret and no workflow uses `pull_request_target`.
- Scheduled/manual canaries run only in protected `live-canaries` environment. Use dedicated read-only/low-quota credentials and provider account spend limits. Runner performs four probes, at most one MCP cleanup, one provider output token, one Brave result, 64-KiB responses, and finite timeouts; report excludes endpoints, headers, bodies, credentials, and MCP session IDs.
- Scheduled/manual coding/browser containment checks run in protected `sandbox-browser` environment (`.github/workflows/sandbox-browser.yml`). They receive no provider/npm/OIDC secrets; Docker/Playwright enablement is variable-gated with host-preloaded digest-pinned images/binaries; uploads are redacted aggregate status only.
- Live endpoint operators own TLS, egress allow-lists, account-dollar budget, cleanup beyond MCP session DELETE, and revocation. Failed canaries log only operation kind plus status/timeout; inspect provider-side audit logs for details.
- **Security-support boundary.** Audit fixes, dependency updates, and security patches land only for the supported Node/PostgreSQL/platform lines frozen in the 0.1.x compatibility matrix ([release and install](release-and-install.md), `scripts/phase12-freeze-manifest.json`). Unsupported combinations receive no fixes.

### 0.1.0 security evidence (plan 012 Task 6)

- **Audit policy.** `npm audit --audit-level=moderate` is enforced in both `security.yml` and the `release.yml` supply-chain job (freeze-manifest `releasePolicy.auditLevelTarget`); recorded 0.1.0 tree: 0 vulnerabilities at every severity (317 locked dependencies, MCP SDK at the 1.30.0 fix baseline).
- **Named threat-suites leg.** `npm run security:threat-suites` aggregates the Phase 8–11 conformance suites (durable-loop/HITL approval, coding sandbox/egress/forge, ACP protocol, OIDC/OPA/MCP-OAuth/OpenAPI/artifact) into one named 0.1.0 security evidence leg — same scripts as `npm test`, no rewrite; the Phase 7 tenant-isolation suite is its protected counterpart under `npm run test:postgres` (missing `PRISM_TEST_POSTGRES_URL` is a named blocked gate).
- **Supply-chain negative fixtures.** `scripts/release-gate.test.mjs` verifies the tarball deny list rejects tampered content (plans/reviews/maps/tests), unexpected file types and credential material (native binaries, `.pem`/`.key`/`.p12`), and that a provenance flag suppressed in CI is detectable in the `release.mjs` publish dry-run arguments (`--provenance` mandatory under `GITHUB_ACTIONS`, never claimed on local OIDC-less publishes).
- **Mandatory gate stack.** CodeQL/SAST, PR dependency review (fail on high), secret scan (source + unpacked tarballs), SPDX SBOM + license policy, tarball allow/deny content checks, and provenance (npm OIDC + GitHub build attestations on tarballs and SBOM) all run in `security.yml`/`release.yml`; evidence for the 0.1.0 tree is recorded in [0.1.0 readiness](0.1.0-readiness.md).
- **Live canaries are blocked gates, not skips.** The `live-canaries` and `sandbox-browser` workflows always set their gate env (`PRISM_LIVE_CANARIES=1`), so absent credentials fail the job loudly with a named owner (the workflow + dispatching operator) and retained `canary-report.json` evidence; the local silent-skip path exists only when the gate env is not set.

## Distributed events and tool effects

Every durable `AgentEventSource` page/subscribe and tool-effect claim rechecks exact ownership. Opaque cursors never select tenants. Oversized events/effects fail closed. Ambiguous tool outcomes stay `unknown` until operator reconciliation — never silent replay. Request-path SQL stays DML-only; migration/listener principals stay separate. See [tool effects](tool-effects.md) and [agent events](agent-events.md).

## Related APIs

- [Web-standard server handler](server.md): remote agent/workflow route, ownership, limits, abort, and deployment boundary.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): authorize every protocol selector/operation; full AG-UI input/output only through bounded host allow-lists; exact interrupt/version resume; redacted, ownership-scoped replay. [ACP coding-host interop](acp.md): untrusted client fs/terminal/paths/MCP configs are boundary-validated (caps + host seams); client MCP servers never auto-connect; mode switches only narrow or host-authorized widen; updates are redacted and never carry raw tool I/O; host-persisted modes/config MUST be ownership-scoped — cross-tenant restore rejects (`ERR_PRISM_ACP_INPUT`, [acp.md Persistence and ownership](acp.md#persistence-and-ownership)).
- [Supervisor delegation](supervisors.md): local child permission/memory/budget boundary.
- [A2A interoperability](a2a.md): remote card/auth/origin/signature boundary.
- [Settings, auth, trust, and security controls](settings-auth-trust-security.md): low-level helpers and boundary hardening table.
- [Credentials and redaction](credentials-and-redaction.md): credential resolver order, caller-supplied env objects, OAuth refresh, exact redaction, and no persistent secret store.
- [Tools](tools.md): active tool registry, allow/deny filters, permission order, validator order, blocked events, and no sandbox.
- [Extension authoring guide](extension-authoring.md): inert contribution package boundary and extension loading security notes.
- [Extension kernel and event bus](extensions.md): `createExtensionKernel`, setup error redaction/rethrow, and permission-gated extension setup.
- [Contribution discovery](contribution-discovery.md): opt-in realpath-contained scanner that imports nothing and activates nothing.
- [Instruction injection](instruction-injection.md): redacted injector context and no capability grants.
- [Session stores](session-stores.md): durable session store contract and secret/persistence boundaries.
- [Runs and usage ledger](runs-and-usage.md): redacted run/event/tool/usage ledger records.
- [Database persistence](database-persistence.md): production schema, ownership, indexes, retention, and adapter readiness checklist.
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable policy/evaluation/work/router state and database-role boundary.
- [Provider caching](provider-caching.md): cache keys and provider-owned header safety rules.
