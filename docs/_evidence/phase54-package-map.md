# Phase 54 — 0.3.3 Package/Export Baseline & 0.4 Import Map Evidence

Generated: `2026-09-05T18:52:36.352Z`  
Repository root version: `0.5.0`  

## 1. Executive Summary & Counts

- **Current repository manifests:** 10 (50 packages during consolidation transition)
- **Retired 0.3.x package names:** 55 (hard-frozen at final 0.3.x releases, deprecated with legacy tag)
- **Retained package names:** 7 (`@arnilo/prism`, `@arnilo/prism-providers`, `@arnilo/prism-web-tools`, `@arnilo/prism-memory`, `@arnilo/prism-mcp`, `@arnilo/prism-acp-agent`, `@arnilo/prism-ag-ui`)
- **New family packages:** 3 (`@arnilo/prism-core`, `@arnilo/prism-coding-tools`, `@arnilo/prism-office`)
- **Target active 0.4 packages:** **10** (Consolidation ratio: 62 → 10, −52 manifests net)

---

## 2. Target Active Package Topology (11 Active Packages)

| # | Active Package | Role | Status | Subpaths / Exports | Key Bins | Optional Peers / Drivers |
|---|---|---|---|---|---|---|
| 1 | `@arnilo/prism` | root | retained | ., ./providers/openai-compatible, ./providers/transport +22 more | `prism` | none |
| 2 | `@arnilo/prism-core` | family | new | /runtime/server, /runtime/supervisor, /runtime/workflows +13 more | none | `better-sqlite3`, `pg`, `@nats-io/jetstream`, `@nats-io/transport-node` |
| 3 | `@arnilo/prism-providers` | family | retained-converted | /ai-sdk, /alibaba, /anthropic +14 more | none | `@ai-sdk/provider` |
| 4 | `@arnilo/prism-coding-tools` | family | new | /agent, /security, /document-reader +6 more | `prism-dev` | `mammoth`, `pdf-parse`, `@dietrichgebert/ponytail` |
| 5 | `@arnilo/prism-web-tools` | family | retained-expanded | ., ./brave, ./exa +3 more | none | `playwright-core` |
| 6 | `@arnilo/prism-memory` | family | retained-expanded | ., /rag, /compaction/llm +3 more | `prism-wiki` | `@nanonets/graft` |
| 7 | `@arnilo/prism-mcp` | interop | retained | . | none | none |
| 8 | `@arnilo/prism-acp-agent` | interop | retained | . | `prism-acp-agent` | none |
| 9 | `@arnilo/prism-ag-ui` | interop | retained | . | none | `@arnilo/prism-mcp`, `@arnilo/prism-supervisor` |
| 10 | `@arnilo/prism-office` | family | new | /documents, /sheets, /diagrams | none | `playwright-core` |

### Subpath Breakdown for Active Packages

#### `@arnilo/prism` (root)
- **Description:** Root contracts, runtime API, CLI, providers/*, testing/*, node/* exports. Dependency-free.
- **Declared Subpaths:**
  - `@arnilo/prism`
  - `@arnilo/prism/./providers/openai-compatible`
  - `@arnilo/prism/./providers/transport`
  - `@arnilo/prism/./providers/openai`
  - `@arnilo/prism/./providers/schema`
  - `@arnilo/prism/./providers/media`
  - `@arnilo/prism/./testing/provider-conformance`
  - `@arnilo/prism/./testing/agent-event-source-conformance`
  - `@arnilo/prism/./testing/state-concurrency-conformance`
  - `@arnilo/prism/./testing/session-store-conformance`
  - `@arnilo/prism/./testing/compaction-conformance`
  - `@arnilo/prism/./testing/tool-conformance`
  - `@arnilo/prism/./testing/tool-effect-store-conformance`
  - `@arnilo/prism/./testing/extension-conformance`
  - `@arnilo/prism/./testing/persistence-schema`
  - `@arnilo/prism/./testing/run-ledger-conformance`
  - `@arnilo/prism/./testing/feedback`
  - `@arnilo/prism/./node/config`
  - `@arnilo/prism/./node/settings`
  - `@arnilo/prism/./node/trust`
  - `@arnilo/prism/./node/session-store-jsonl`
  - `@arnilo/prism/./node/contribution-discovery`
  - `@arnilo/prism/./node/instruction-injectors`
  - `@arnilo/prism/./node/system-prompts`
  - `@arnilo/prism/./node/agent-definitions`
- **Retained Executables (bin):** `prism`
- **Security & Trust Boundaries:**
  - Root dependency freedom: zero runtime dependencies; strict trust boundary at root.

#### `@arnilo/prism-core` (family)
- **Description:** Unified Prism core: runtime (server/supervisor/workflows), sessions, governance, credentials, enterprise postgres, work integrations, and schema validation.
- **Declared Subpaths:**
  - `@arnilo/prism-core/runtime/server`
  - `@arnilo/prism-core/runtime/supervisor`
  - `@arnilo/prism-core/runtime/workflows`
  - `@arnilo/prism-core/sessions/codecs`
  - `@arnilo/prism-core/sessions/sqlite`
  - `@arnilo/prism-core/sessions/postgres`
  - `@arnilo/prism-core/sessions/nats`
  - `@arnilo/prism-core/governance/policy`
  - `@arnilo/prism-core/governance/evals`
  - `@arnilo/prism-core/governance/prompts`
  - `@arnilo/prism-core/governance/model-router`
  - `@arnilo/prism-core/governance/observability`
  - `@arnilo/prism-core/credentials/node`
  - `@arnilo/prism-core/enterprise/postgres`
  - `@arnilo/prism-core/integrations/work`
  - `@arnilo/prism-core/validation/json-schema`
- **Optional Peers / Host Drivers:** `better-sqlite3`, `pg`, `@nats-io/jetstream`, `@nats-io/transport-node`
- **Security & Trust Boundaries:**
  - /sessions/postgres & /enterprise/postgres: PostgreSQL transaction isolation, schema migrations, and parameterized query execution.
  - /sessions/sqlite: SQLite file locking, synchronous journal modes, and path containment.
  - /governance/policy: Fail-closed capability admission, tool authorization, and audit log tamper detection.
  - /governance/evals: Evaluation run isolation, dataset curation redaction, and metric integrity.
  - /governance/prompts: Versioned prompt promotion gating, rollback protection, and evaluation score thresholds.
  - /credentials/node: OS keychain integration via @napi-rs/keyring; credentials never leak to logs or memory dumps.

#### `@arnilo/prism-providers` (family)
- **Description:** Unified provider code family containing all 17 provider adapters.
- **Declared Subpaths:**
  - `@arnilo/prism-providers/ai-sdk`
  - `@arnilo/prism-providers/alibaba`
  - `@arnilo/prism-providers/anthropic`
  - `@arnilo/prism-providers/azure`
  - `@arnilo/prism-providers/bedrock`
  - `@arnilo/prism-providers/clinepass`
  - `@arnilo/prism-providers/deepseek`
  - `@arnilo/prism-providers/google`
  - `@arnilo/prism-providers/kimi`
  - `@arnilo/prism-providers/neuralwatt`
  - `@arnilo/prism-providers/ollama`
  - `@arnilo/prism-providers/openai`
  - `@arnilo/prism-providers/opencode-go`
  - `@arnilo/prism-providers/openrouter`
  - `@arnilo/prism-providers/vertex`
  - `@arnilo/prism-providers/xai`
  - `@arnilo/prism-providers/zai`
- **Optional Peers / Host Drivers:** `@ai-sdk/provider`
- **Security & Trust Boundaries:**
  - Credential handling: API keys and auth headers passed only to declared upstream endpoints; zero cross-provider key leakage.
  - Lazy activation: Importing one adapter never evaluates or activates another.

#### `@arnilo/prism-coding-tools` (family)
- **Description:** Unified coding agent tools, security sandboxing, document parsing, OpenAPI tools, Linux desktop integration, Dev inspector, and persona extensions.
- **Declared Subpaths:**
  - `@arnilo/prism-coding-tools/agent`
  - `@arnilo/prism-coding-tools/security`
  - `@arnilo/prism-coding-tools/document-reader`
  - `@arnilo/prism-coding-tools/openapi`
  - `@arnilo/prism-coding-tools/computer-use-linux`
  - `@arnilo/prism-coding-tools/dev`
  - `@arnilo/prism-coding-tools/caveman`
  - `@arnilo/prism-coding-tools/ponytail`
  - `@arnilo/prism-coding-tools/impeccable`
- **Retained Executables (bin):** `prism-dev`
- **Optional Peers / Host Drivers:** `mammoth`, `pdf-parse`, `@dietrichgebert/ponytail`
- **Security & Trust Boundaries:**
  - /security: Docker/OCI disposable sandbox containment, execution approval policies, and workspace path containment.
  - /document-reader: Bounded byte parsing, XML entity expansion defense, redaction of sensitive spans, fail-closed on missing parser peers.
  - /openapi: SSRF protection, loopback/private IP filtering, allowlist domain enforcement.
  - /computer-use-linux: Linux device access policy, screen capture bounds, rate-limited mouse/keyboard inputs.
  - /dev: Loopback-only binding (127.0.0.1), no external host exposure.
  - Persona extensions (/caveman, /ponytail, /impeccable): Pure prompt/behavior modifiers; zero implicit host privilege escalation.

#### `@arnilo/prism-web-tools` (family)
- **Description:** Unified web tools family: root Brave/Exa/Firecrawl search plus /browser and /obscura subpaths.
- **Declared Subpaths:**
  - `@arnilo/prism-web-tools`
  - `@arnilo/prism-web-tools/./brave`
  - `@arnilo/prism-web-tools/./exa`
  - `@arnilo/prism-web-tools/./firecrawl`
  - `@arnilo/prism-web-tools/browser`
  - `@arnilo/prism-web-tools/obscura`
- **Optional Peers / Host Drivers:** `playwright-core`
- **Security & Trust Boundaries:**
  - /browser: BrowserNetworkPolicy URL allowlist/blocklist, private IP egress blocking, quarantined download/upload budgets, CDP access isolation.
  - /obscura: Strict SSRF protection, loopback gating, CDP sandboxing, host binary integrity verification.
  - Lazy dependency probe: Generic root web-tools import never requires Playwright or Obscura host binary.

#### `@arnilo/prism-memory` (family)
- **Description:** Unified memory and context family: working/vector memory, RAG, LLM compaction, observational memory, Graft context graph, and Wiki knowledge system.
- **Declared Subpaths:**
  - `@arnilo/prism-memory`
  - `@arnilo/prism-memory/rag`
  - `@arnilo/prism-memory/compaction/llm`
  - `@arnilo/prism-memory/compaction/observational-memory`
  - `@arnilo/prism-memory/graft`
  - `@arnilo/prism-memory/wiki`
- **Retained Executables (bin):** `prism-wiki`
- **Optional Peers / Host Drivers:** `@nanonets/graft`
- **Security & Trust Boundaries:**
  - /rag: Chunk/query input size bounds, scope containment, embedder dimension mismatch prevention.
  - /graft: Subprocess execution timeout, stdout/stderr size bounds, graph traversal depth limits.
  - /wiki: Workspace path containment, local file boundaries, untrusted markdown link sanitization.

#### `@arnilo/prism-mcp` (interop)
- **Description:** Model Context Protocol client/server/OAuth bridge.
- **Declared Subpaths:**
  - `@arnilo/prism-mcp`
- **Security & Trust Boundaries:**
  - MCP transport security: Local stdio process bounds, SSE URL allowlist, OAuth token redaction in errors.

#### `@arnilo/prism-acp-agent` (interop)
- **Description:** Agent Client Protocol adapter and CLI.
- **Declared Subpaths:**
  - `@arnilo/prism-acp-agent`
- **Retained Executables (bin):** `prism-acp-agent`
- **Security & Trust Boundaries:**
  - Protocol framing: Strict JSON-RPC validation, message size bounds, connection termination on error.

#### `@arnilo/prism-ag-ui` (interop)
- **Description:** AG-UI / A2A / A2UI streaming UI adapter.
- **Declared Subpaths:**
  - `@arnilo/prism-ag-ui`
- **Optional Peers / Host Drivers:** `@arnilo/prism-mcp`, `@arnilo/prism-supervisor`
- **Security & Trust Boundaries:**
  - Streaming sanitization: UI event payload bounds, sensitive state masking, loopback connection restriction.

#### `@arnilo/prism-office` (family)
- **Description:** Unified office documents suite: Word/PowerPoint documents, Excel spreadsheets, and Mermaid/SVG diagram generation.
- **Declared Subpaths:**
  - `@arnilo/prism-office/documents`
  - `@arnilo/prism-office/sheets`
  - `@arnilo/prism-office/diagrams`
- **Optional Peers / Host Drivers:** `playwright-core`
- **Security & Trust Boundaries:**
  - /documents: Document byte limits, XML entity expansion defense, safe archive decompression.
  - /sheets: Formula injection escaping, workbook size bounds, malicious macro neutralization.
  - /diagrams: Playwright rendering sandbox, SVG script stripping, rasterization memory limits.

---

## 3. Complete 0.3.3 → 0.4 Import Migration Map (54 Retired Packages)

| Current Package (0.3.3) | Category | Final Version | 0.4 Successor Import Specifier | Exported Symbols | Optional Peers / Bins |
|---|---|---|---|---|---|
| `@arnilo/prism-base` | profile | `0.3.3` | `@arnilo/prism` | 0 symbols | none |
| `@arnilo/prism-code` | profile | `0.3.3` | `@arnilo/prism-coding-tools` | 0 symbols | none |
| `@arnilo/prism-sdk` | profile | `0.3.3` | `@arnilo/prism-core` | 0 symbols | none |
| `@arnilo/prism-compaction` | profile | `0.3.3` | `@arnilo/prism-memory/compaction/*` | 0 symbols | none |
| `@arnilo/prism-all` | profile | `0.3.3` | `None (Profile Deleted)` | 0 symbols | none |
| `@arnilo/prism-provider-ai-sdk` | provider | `0.3.3` | `@arnilo/prism-providers/ai-sdk` | 12 symbols | none |
| `@arnilo/prism-provider-alibaba` | provider | `0.3.3` | `@arnilo/prism-providers/alibaba` | 25 symbols | none |
| `@arnilo/prism-provider-anthropic` | provider | `0.3.3` | `@arnilo/prism-providers/anthropic` | 21 symbols | none |
| `@arnilo/prism-provider-azure` | provider | `0.3.3` | `@arnilo/prism-providers/azure` | 7 symbols | none |
| `@arnilo/prism-provider-bedrock` | provider | `0.3.3` | `@arnilo/prism-providers/bedrock` | 8 symbols | none |
| `@arnilo/prism-provider-clinepass` | provider | `0.3.3` | `@arnilo/prism-providers/clinepass` | 16 symbols | none |
| `@arnilo/prism-provider-deepseek` | provider | `0.3.3` | `@arnilo/prism-providers/deepseek` | 20 symbols | none |
| `@arnilo/prism-provider-google` | provider | `0.3.3` | `@arnilo/prism-providers/google` | 18 symbols | none |
| `@arnilo/prism-provider-kimi` | provider | `0.3.3` | `@arnilo/prism-providers/kimi` | 24 symbols | none |
| `@arnilo/prism-provider-neuralwatt` | provider | `0.3.3` | `@arnilo/prism-providers/neuralwatt` | 43 symbols | none |
| `@arnilo/prism-provider-ollama` | provider | `0.3.3` | `@arnilo/prism-providers/ollama` | 15 symbols | none |
| `@arnilo/prism-provider-openai` | provider | `0.3.3` | `@arnilo/prism-providers/openai` | 29 symbols | none |
| `@arnilo/prism-provider-opencode-go` | provider | `0.3.3` | `@arnilo/prism-providers/opencode-go` | 28 symbols | none |
| `@arnilo/prism-provider-openrouter` | provider | `0.3.3` | `@arnilo/prism-providers/openrouter` | 21 symbols | none |
| `@arnilo/prism-provider-vertex` | provider | `0.3.3` | `@arnilo/prism-providers/vertex` | 5 symbols | none |
| `@arnilo/prism-provider-xai` | provider | `0.3.3` | `@arnilo/prism-providers/xai` | 28 symbols | none |
| `@arnilo/prism-provider-zai` | provider | `0.3.3` | `@arnilo/prism-providers/zai` | 19 symbols | none |
| `@arnilo/prism-server` | core | `0.3.3` | `@arnilo/prism-core/runtime/server` | 217 symbols | none |
| `@arnilo/prism-supervisor` | core | `0.3.3` | `@arnilo/prism-core/runtime/supervisor` | 48 symbols | none |
| `@arnilo/prism-workflows` | core | `0.3.3` | `@arnilo/prism-core/runtime/workflows` | 209 symbols | none |
| `@arnilo/prism-session-store-codecs` | core | `0.3.3` | `@arnilo/prism-core/sessions/codecs` | 22 symbols | none |
| `@arnilo/prism-session-store-sqlite` | core | `0.3.3` | `@arnilo/prism-core/sessions/sqlite` | 24 symbols | none |
| `@arnilo/prism-session-store-postgres` | core | `0.3.3` | `@arnilo/prism-core/sessions/postgres` | 31 symbols | none |
| `@arnilo/prism-session-store-nats` | core | `0.3.3` | `@arnilo/prism-core/sessions/nats` | 11 symbols | none |
| `@arnilo/prism-policy` | core | `0.3.3` | `@arnilo/prism-core/governance/policy` | 99 symbols | none |
| `@arnilo/prism-evals` | core | `0.3.3` | `@arnilo/prism-core/governance/evals` | 106 symbols | none |
| `@arnilo/prism-prompts` | core | `0.3.3` | `@arnilo/prism-core/governance/prompts` | 88 symbols | none |
| `@arnilo/prism-model-router` | core | `0.3.3` | `@arnilo/prism-core/governance/model-router` | 28 symbols | none |
| `@arnilo/prism-observability-opentelemetry` | core | `0.3.3` | `@arnilo/prism-core/governance/observability` | 25 symbols | none |
| `@arnilo/prism-credentials-node` | core | `0.3.3` | `@arnilo/prism-core/credentials/node` | 106 symbols | none |
| `@arnilo/prism-enterprise-postgres` | core | `0.3.3` | `@arnilo/prism-core/enterprise/postgres` | 64 symbols | none |
| `@arnilo/prism-work-tools` | core | `0.3.3` | `@arnilo/prism-core/integrations/work` | 60 symbols | none |
| `@arnilo/prism-tool-validator-json-schema` | core | `0.3.3` | `@arnilo/prism-core/validation/json-schema` | 4 symbols | none |
| `@arnilo/prism-coding-agent` | coding | `0.3.3` | `@arnilo/prism-coding-tools/agent` | 594 symbols | none |
| `@arnilo/prism-coding-security` | coding | `0.3.3` | `@arnilo/prism-coding-tools/security` | 156 symbols | none |
| `@arnilo/prism-document-reader` | coding | `0.3.3` | `@arnilo/prism-coding-tools/document-reader` | 10 symbols | none |
| `@arnilo/prism-openapi-tools` | coding | `0.3.3` | `@arnilo/prism-coding-tools/openapi` | 16 symbols | none |
| `@arnilo/prism-computer-use-linux` | coding | `0.3.3` | `@arnilo/prism-coding-tools/computer-use-linux` | 14 symbols | none |
| `@arnilo/prism-dev` | coding | `0.3.3` | `@arnilo/prism-coding-tools/dev` | 18 symbols | none |
| `@arnilo/prism-caveman` | coding | `0.3.3` | `@arnilo/prism-coding-tools/caveman` | 32 symbols | none |
| `@arnilo/prism-ponytail` | coding | `0.3.3` | `@arnilo/prism-coding-tools/ponytail` | 31 symbols | none |
| `@arnilo/prism-impeccable` | coding | `0.3.3` | `@arnilo/prism-coding-tools/impeccable` | 13 symbols | none |
| `@arnilo/prism-browser` | web | `0.3.3` | `@arnilo/prism-web-tools/browser` | 194 symbols | none |
| `@arnilo/prism-obscura` | web | `0.3.3` | `@arnilo/prism-web-tools/obscura` | 40 symbols | none |
| `@arnilo/prism-rag` | memory | `0.3.3` | `@arnilo/prism-memory/rag` | 120 symbols | none |
| `@arnilo/prism-compaction-llm` | memory | `0.3.3` | `@arnilo/prism-memory/compaction/llm` | 32 symbols | none |
| `@arnilo/prism-compaction-observational-memory` | memory | `0.3.3` | `@arnilo/prism-memory/compaction/observational-memory` | 145 symbols | none |
| `@arnilo/prism-graft` | memory | `0.3.3` | `@arnilo/prism-memory/graft` | 55 symbols | none |
| `@arnilo/prism-wiki` | memory | `0.3.3` | `@arnilo/prism-memory/wiki` | 60 symbols | none |
| `@arnilo/prism-antigravity-agent` | interop | `0.3.3` | `@arnilo/prism-coding-tools/agent` | 0 symbols | none |

---

## 4. Draft Office Manifests Consolidation

The three draft office manifests created in plans 051–053 consolidate into `@arnilo/prism-office`:

| Draft Workspace Manifest | 0.4 Successor Subpath | Exported Symbols |
|---|---|---|
| `@arnilo/prism-documents` | `@arnilo/prism-office/documents` | 0 symbols |
| `@arnilo/prism-sheets` | `@arnilo/prism-office/sheets` | 0 symbols |
| `@arnilo/prism-diagrams` | `@arnilo/prism-office/diagrams` | 0 symbols |

---

## 5. Retained CLI / Binaries

| Executable Name | 0.3 Package Origin | 0.4 Home Package | Invocation / Entrypoint |
|---|---|---|---|
| `prism` | `@arnilo/prism` | `@arnilo/prism` | `dist/cli.js` (Root CLI) |
| `prism-dev` | `@arnilo/prism-dev` | `@arnilo/prism-coding-tools` | `dist/dev/cli.js` (Dev Inspector) |
| `prism-wiki` | `@arnilo/prism-wiki` | `@arnilo/prism-memory` | `dist/wiki/cli.js` (LLM Wiki & Context7 CLI) |
| `prism-acp-agent` | `@arnilo/prism-acp-agent` | `@arnilo/prism-acp-agent` | `dist/cli.js` (ACP Protocol CLI) |

---

## 6. Optional Peers and Host Binary Requirements

| Subpath / Family | Requirement | Category | Failure Mode / Enforcement |
|---|---|---|---|
| `@arnilo/prism-core/sessions/sqlite` | `better-sqlite3` | Optional Peer | Fail-closed before opening SQLite db; emits install hint |
| `@arnilo/prism-core/sessions/postgres` | `pg` | Optional Peer | Fail-closed before pool connection; emits install hint |
| `@arnilo/prism-core/sessions/nats` | `@nats-io/jetstream`, `@nats-io/transport-node` | Optional Peer | Fail-closed before NATS client connect |
| `@arnilo/prism-core/credentials/node` | `@napi-rs/keyring` | Hard Dependency | Native keyring backend for secure token storage |
| `@arnilo/prism-coding-tools/document-reader` | `mammoth`, `pdf-parse` | Optional Peer | Fail-closed when parsing .docx or .pdf if parser missing |
| `@arnilo/prism-coding-tools/computer-use-linux` | `xdotool` / desktop MCP | Host Binary | Probed at device initialization; fails before action dispatch |
| `@arnilo/prism-coding-tools/ponytail` | `@dietrichgebert/ponytail` | Optional Peer | Optional persona peer |
| `@arnilo/prism-web-tools/browser` | `playwright-core` | Optional Peer | Fail-closed before browser launch/connect |
| `@arnilo/prism-web-tools/obscura` | `obscura` CLI / binary | Host Binary | SSRF-checked loopback probe; fails before session start |
| `@arnilo/prism-memory/graft` | `@nanonets/graft` | Optional Peer | Process probe before running graph queries |
| `@arnilo/prism-office/diagrams` | `playwright-core` | Optional Peer | Fail-closed when rendering raster PNG diagrams if missing |

---

## 7. Security Trust Boundaries

| Subpath / Domain | Primary Threat / Risk | Boundary Mechanism & Enforcement | Preserved Test Suites |
|---|---|---|---|
| `coding-tools/security` | Host filesystem destruction, unauthorized command execution | Disposable Docker/OCI container isolation, path traversal checks, execution approval ledger | `packages/coding-security/src/__tests__/*` |
| `web-tools/browser` | Intranet probing, data exfiltration, drive-by downloads | URL allowlist/blocklist, private IP egress block, quarantine directories for uploads/downloads | `packages/browser/src/__tests__/*` |
| `web-tools/obscura` | SSRF, loopback forgery, unauthorized CDP session manipulation | Strict loopback pinning, token auth, process isolation | `packages/obscura/src/__tests__/*` |
| `core/sessions/postgres` | SQL injection, schema corruption, multi-tenant state bleed | Parameterized queries, migration locking, transaction savepoints | `packages/session-store-postgres/src/__tests__/*` |
| `coding-tools/document-reader` | Billion laughs XML bomb, out-of-memory denial of service | Byte limits, entity expansion limits, memory-bounded parsing | `packages/document-reader/src/__tests__/*` |
| `memory/rag` | Cross-tenant document leak, vector dimension mismatch | Scope containment, strict namespace isolation, embedder ID check | `packages/rag/src/__tests__/*` |
| `memory/graft` | Infinite recursion, command hanging | Process execution timeout, bounded stdout/stderr buffers | `packages/prism-graft/src/__tests__/*` |

---

## 8. Legacy Registry Plan & Deprecation Commands (55 Packages)

```bash
# @arnilo/prism-base (profile)
npm dist-tag add @arnilo/prism-base@0.3.3 legacy
npm deprecate @arnilo/prism-base@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#removed-profile-packages"

# @arnilo/prism-code (profile)
npm dist-tag add @arnilo/prism-code@0.3.3 legacy
npm deprecate @arnilo/prism-code@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#removed-profile-packages"

# @arnilo/prism-sdk (profile)
npm dist-tag add @arnilo/prism-sdk@0.3.3 legacy
npm deprecate @arnilo/prism-sdk@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#removed-profile-packages"

# @arnilo/prism-compaction (profile)
npm dist-tag add @arnilo/prism-compaction@0.3.3 legacy
npm deprecate @arnilo/prism-compaction@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/compaction/*. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-all (profile)
npm dist-tag add @arnilo/prism-all@0.3.3 legacy
npm deprecate @arnilo/prism-all@"<0.4.0" "Legacy 0.3 profile. Prism 0.4+: Install explicit family packages. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#removed-profile-packages"

# @arnilo/prism-provider-ai-sdk (provider)
npm dist-tag add @arnilo/prism-provider-ai-sdk@0.3.3 legacy
npm deprecate @arnilo/prism-provider-ai-sdk@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/ai-sdk. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-alibaba (provider)
npm dist-tag add @arnilo/prism-provider-alibaba@0.3.3 legacy
npm deprecate @arnilo/prism-provider-alibaba@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/alibaba. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-anthropic (provider)
npm dist-tag add @arnilo/prism-provider-anthropic@0.3.3 legacy
npm deprecate @arnilo/prism-provider-anthropic@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/anthropic. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-azure (provider)
npm dist-tag add @arnilo/prism-provider-azure@0.3.3 legacy
npm deprecate @arnilo/prism-provider-azure@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/azure. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-bedrock (provider)
npm dist-tag add @arnilo/prism-provider-bedrock@0.3.3 legacy
npm deprecate @arnilo/prism-provider-bedrock@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/bedrock. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-clinepass (provider)
npm dist-tag add @arnilo/prism-provider-clinepass@0.3.3 legacy
npm deprecate @arnilo/prism-provider-clinepass@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/clinepass. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-deepseek (provider)
npm dist-tag add @arnilo/prism-provider-deepseek@0.3.3 legacy
npm deprecate @arnilo/prism-provider-deepseek@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/deepseek. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-google (provider)
npm dist-tag add @arnilo/prism-provider-google@0.3.3 legacy
npm deprecate @arnilo/prism-provider-google@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/google. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-kimi (provider)
npm dist-tag add @arnilo/prism-provider-kimi@0.3.3 legacy
npm deprecate @arnilo/prism-provider-kimi@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/kimi. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-neuralwatt (provider)
npm dist-tag add @arnilo/prism-provider-neuralwatt@0.3.3 legacy
npm deprecate @arnilo/prism-provider-neuralwatt@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/neuralwatt. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-ollama (provider)
npm dist-tag add @arnilo/prism-provider-ollama@0.3.3 legacy
npm deprecate @arnilo/prism-provider-ollama@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/ollama. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-openai (provider)
npm dist-tag add @arnilo/prism-provider-openai@0.3.3 legacy
npm deprecate @arnilo/prism-provider-openai@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/openai. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-opencode-go (provider)
npm dist-tag add @arnilo/prism-provider-opencode-go@0.3.3 legacy
npm deprecate @arnilo/prism-provider-opencode-go@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/opencode-go. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-openrouter (provider)
npm dist-tag add @arnilo/prism-provider-openrouter@0.3.3 legacy
npm deprecate @arnilo/prism-provider-openrouter@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/openrouter. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-vertex (provider)
npm dist-tag add @arnilo/prism-provider-vertex@0.3.3 legacy
npm deprecate @arnilo/prism-provider-vertex@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/vertex. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-xai (provider)
npm dist-tag add @arnilo/prism-provider-xai@0.3.3 legacy
npm deprecate @arnilo/prism-provider-xai@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/xai. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-provider-zai (provider)
npm dist-tag add @arnilo/prism-provider-zai@0.3.3 legacy
npm deprecate @arnilo/prism-provider-zai@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-providers/zai. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers"

# @arnilo/prism-server (core)
npm dist-tag add @arnilo/prism-server@0.3.3 legacy
npm deprecate @arnilo/prism-server@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/runtime/server. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-supervisor (core)
npm dist-tag add @arnilo/prism-supervisor@0.3.3 legacy
npm deprecate @arnilo/prism-supervisor@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/runtime/supervisor. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-workflows (core)
npm dist-tag add @arnilo/prism-workflows@0.3.3 legacy
npm deprecate @arnilo/prism-workflows@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/runtime/workflows. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-session-store-codecs (core)
npm dist-tag add @arnilo/prism-session-store-codecs@0.3.3 legacy
npm deprecate @arnilo/prism-session-store-codecs@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/sessions/codecs. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-session-store-sqlite (core)
npm dist-tag add @arnilo/prism-session-store-sqlite@0.3.3 legacy
npm deprecate @arnilo/prism-session-store-sqlite@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/sessions/sqlite. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-session-store-postgres (core)
npm dist-tag add @arnilo/prism-session-store-postgres@0.3.3 legacy
npm deprecate @arnilo/prism-session-store-postgres@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/sessions/postgres. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-session-store-nats (core)
npm dist-tag add @arnilo/prism-session-store-nats@0.3.3 legacy
npm deprecate @arnilo/prism-session-store-nats@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/sessions/nats. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-policy (core)
npm dist-tag add @arnilo/prism-policy@0.3.3 legacy
npm deprecate @arnilo/prism-policy@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/governance/policy. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-evals (core)
npm dist-tag add @arnilo/prism-evals@0.3.3 legacy
npm deprecate @arnilo/prism-evals@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/governance/evals. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-prompts (core)
npm dist-tag add @arnilo/prism-prompts@0.3.3 legacy
npm deprecate @arnilo/prism-prompts@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/governance/prompts. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-model-router (core)
npm dist-tag add @arnilo/prism-model-router@0.3.3 legacy
npm deprecate @arnilo/prism-model-router@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/governance/model-router. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-observability-opentelemetry (core)
npm dist-tag add @arnilo/prism-observability-opentelemetry@0.3.3 legacy
npm deprecate @arnilo/prism-observability-opentelemetry@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/governance/observability. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-credentials-node (core)
npm dist-tag add @arnilo/prism-credentials-node@0.3.3 legacy
npm deprecate @arnilo/prism-credentials-node@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/credentials/node. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-enterprise-postgres (core)
npm dist-tag add @arnilo/prism-enterprise-postgres@0.3.3 legacy
npm deprecate @arnilo/prism-enterprise-postgres@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/enterprise/postgres. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-work-tools (core)
npm dist-tag add @arnilo/prism-work-tools@0.3.3 legacy
npm deprecate @arnilo/prism-work-tools@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/integrations/work. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-tool-validator-json-schema (core)
npm dist-tag add @arnilo/prism-tool-validator-json-schema@0.3.3 legacy
npm deprecate @arnilo/prism-tool-validator-json-schema@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-core/validation/json-schema. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#runtime-sessions-governance-and-work-integration"

# @arnilo/prism-coding-agent (coding)
npm dist-tag add @arnilo/prism-coding-agent@0.3.3 legacy
npm deprecate @arnilo/prism-coding-agent@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/agent. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-coding-security (coding)
npm dist-tag add @arnilo/prism-coding-security@0.3.3 legacy
npm deprecate @arnilo/prism-coding-security@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/security. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-document-reader (coding)
npm dist-tag add @arnilo/prism-document-reader@0.3.3 legacy
npm deprecate @arnilo/prism-document-reader@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/document-reader. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-openapi-tools (coding)
npm dist-tag add @arnilo/prism-openapi-tools@0.3.3 legacy
npm deprecate @arnilo/prism-openapi-tools@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/openapi. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-computer-use-linux (coding)
npm dist-tag add @arnilo/prism-computer-use-linux@0.3.3 legacy
npm deprecate @arnilo/prism-computer-use-linux@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/computer-use-linux. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-dev (coding)
npm dist-tag add @arnilo/prism-dev@0.3.3 legacy
npm deprecate @arnilo/prism-dev@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/dev. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-caveman (coding)
npm dist-tag add @arnilo/prism-caveman@0.3.3 legacy
npm deprecate @arnilo/prism-caveman@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/caveman. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-ponytail (coding)
npm dist-tag add @arnilo/prism-ponytail@0.3.3 legacy
npm deprecate @arnilo/prism-ponytail@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/ponytail. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-impeccable (coding)
npm dist-tag add @arnilo/prism-impeccable@0.3.3 legacy
npm deprecate @arnilo/prism-impeccable@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/impeccable. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#coding-tools-and-personas"

# @arnilo/prism-browser (web)
npm dist-tag add @arnilo/prism-browser@0.3.3 legacy
npm deprecate @arnilo/prism-browser@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-web-tools/browser. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#web-browser-and-obscura"

# @arnilo/prism-obscura (web)
npm dist-tag add @arnilo/prism-obscura@0.3.3 legacy
npm deprecate @arnilo/prism-obscura@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-web-tools/obscura. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#web-browser-and-obscura"

# @arnilo/prism-rag (memory)
npm dist-tag add @arnilo/prism-rag@0.3.3 legacy
npm deprecate @arnilo/prism-rag@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/rag. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-compaction-llm (memory)
npm dist-tag add @arnilo/prism-compaction-llm@0.3.3 legacy
npm deprecate @arnilo/prism-compaction-llm@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/compaction/llm. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-compaction-observational-memory (memory)
npm dist-tag add @arnilo/prism-compaction-observational-memory@0.3.3 legacy
npm deprecate @arnilo/prism-compaction-observational-memory@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/compaction/observational-memory. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-graft (memory)
npm dist-tag add @arnilo/prism-graft@0.3.3 legacy
npm deprecate @arnilo/prism-graft@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/graft. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-wiki (memory)
npm dist-tag add @arnilo/prism-wiki@0.3.3 legacy
npm deprecate @arnilo/prism-wiki@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-memory/wiki. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#memory-rag-compaction-and-context"

# @arnilo/prism-antigravity-agent (interop)
npm dist-tag add @arnilo/prism-antigravity-agent@0.3.3 legacy
npm deprecate @arnilo/prism-antigravity-agent@"<0.4.0" "Legacy 0.3 package. Prism 0.4+: @arnilo/prism-coding-tools/agent. https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#removed-profile-packages"

```

---

## 9. Baseline Export Symbol Snapshot Summary

Total declared exports across all packages are frozen in `scripts/compat-baseline/*.txt`:

| Package Name | Declared Public Exports | Snapshot Baseline File |
|---|---|---|
| `@arnilo/prism` | 901 | `scripts/compat-baseline/arnilo__prism.txt` |
| `@arnilo/prism-mcp` | 123 | `scripts/compat-baseline/arnilo__prism-mcp.txt` |
| `@arnilo/prism-providers` | 470 | `scripts/compat-baseline/arnilo__prism-providers.txt` |
| `@arnilo/prism-memory` | 551 | `scripts/compat-baseline/arnilo__prism-memory.txt` |
| `@arnilo/prism-core` | 1174 | `scripts/compat-baseline/arnilo__prism-core.txt` |
| `@arnilo/prism-coding-tools` | 888 | `scripts/compat-baseline/arnilo__prism-coding-tools.txt` |
| `@arnilo/prism-office` | 169 | `scripts/compat-baseline/arnilo__prism-office.txt` |
| `@arnilo/prism-ag-ui` | 297 | `scripts/compat-baseline/arnilo__prism-ag-ui.txt` |
| `@arnilo/prism-web-tools` | 290 | `scripts/compat-baseline/arnilo__prism-web-tools.txt` |
| `@arnilo/prism-acp-agent` | 7 | `scripts/compat-baseline/arnilo__prism-acp-agent.txt` |
