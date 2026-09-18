# Prism work, sandbox, and skills primitive review

Plan 083 Task 1 freezes compatibility and security vocabulary for later tasks. This is evidence only: no public symbol, dependency, runtime path, or generated skill body changes here.

## Sources reviewed

Current contracts: [work tools](../work-tools.md), [work connectors](../work-connectors.md), [documents](../documents.md), [sheets](../sheets.md), [diagrams](../diagrams.md), [document reader](../document-reader.md), [coding security](../coding-security.md), [context and skills](../context-and-skills.md), [core](../core.md), [coding tools](../coding-tools.md), [optional peer dependencies](../peer-dependencies.md), and [host compositions](../host-compositions.md). Package topology and prior HTTP-adapter decisions were checked in [plan 054](../../plans/054-Package-Consolidation-Proposal.md) and [plan 081](../../plans/081-Connected-Apps-Mcp-Host-And-Work-Http.md).

Vendor policy sources: [Agent Skills specification](https://agentskills.io/specification), the [Hermes MIT license](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE), and the [Anthropic skills README](https://github.com/anthropics/skills). Hermes is MIT (copyright 2025 Nous Research). Anthropic calls its document skills source-available rather than open source; they are excluded from redistribution.

## Existing primitives and compatibility freeze

| Existing contract | Evidence | Later use / compatibility rule |
| --- | --- | --- |
| Work types define Microsoft 365 and Google Workspace operation/capability sets, bounded limits, identity-bound drafts, `IdempotencyStore`, token provider, structural adapters, and `WorkToolsOptions`. | `packages/prism-core/src/integrations/work/types.ts:3-365` | Move these interfaces unchanged in Task 2. New work package depends only on `@arnilo/prism` at runtime; the PostgreSQL adapter remains core-side and satisfies `IdempotencyStore` structurally. |
| `createWorkTools` joins configured adapters and centrally assigns observations versus `external_mutation` effects. | `packages/prism-core/src/integrations/work/tools.ts:806-814` | Tasks 2, 4, and 5 retain this single tool/draft/approval/idempotency path; no second work-tool framework. |
| HTTP adapters require a per-identity token provider, pin allowed origins, use fixed operation maps, and share the draft store. | `packages/prism-core/src/integrations/work/{microsoft365-http,google-workspace-http}.ts:27-191,33-179`; `http.ts:25-71` | Tasks 4-5 add fixed download/update paths only. Tokens stay in `Authorization`; model arguments never contain an arbitrary URL. |
| Drafts bind identity, revision, canonical payload digest, and approval; checkpoint-backed drafts retain the same lifecycle. | `packages/prism-core/src/integrations/work/drafts.ts:68-113,119-311,320-645`; `types.ts:111-201` | Tasks 4-5 extend existing draft payloads. Approval and ambiguous-outcome handling remain unchanged. |
| PostgreSQL idempotency atomically claims/finishes/fails/marks unknown records; enterprise composition exposes it as `workIdempotency`. | `packages/prism-core/src/enterprise/postgres/work-idempotency.ts:47-166`; `enterprise.ts:38-82`; `types.ts:153-165` | Task 2 retains the core export with type-only work coupling. Core must not runtime-import `prism-work` or `@office-open/*`. |
| Documents generate OOXML plus a SHA-256 hash, import only PK containers under caps and optional redaction, and validate every patched model. | `packages/office/src/documents/generate.ts:36-96`; `parse.ts:181-242`; `patch.ts:430-476`; `caps.ts:59-68` | Tasks 2-3 move and wrap these functions. No second document AST, ZIP parser, macro executor, filesystem path, or process runner. |
| `createDocumentReader` creates bounded PDF/DOCX literal extraction and returns `null` for unsupported bytes; coding `read` accepts its structural `DocumentReader` slot. | `packages/prism-coding-tools/src/document-reader/index.ts:168-202`; `packages/prism-coding-tools/src/agent/read.ts:199-252,472-677` | Task 2 moves implementation and optional peers to work while `DocumentReader` remains in coding tools. Task 3 adds XLSX/PPTX through the moved document parser without changing the slot. |
| Docker validates absolute executable/image/user/source, exact environment, network mode, limits, and returns one `DisposableSandbox`; sandbox compositions return shared tools plus containment metadata. | `packages/prism-coding-tools/src/security/docker-sandbox.ts:1038-1143`; `sandbox.ts:120-150`; `sandbox-coding-operations.ts:370-376` | Task 6 injects this interface into `createWorkComposition`; it does not fork Docker or claim isolation missing from sandbox capabilities. Default work network is `none`. |
| `parseSkillFile` validates frontmatter/name and preserves instructions; registry duplicate policy and active-tool checks remain host-owned. | `src/contribution-parsing.ts:87-111`; `src/skills.ts:12-45` | Task 7 parses four vendored files and overlays `toolNames` in TypeScript. No Prism-authored `SKILL.md` body, auto-activation, or permission grant. |
| Computer-use Linux loads a packaged skill synchronously, caps bytes, parses it with `parseSkillFile`, and verifies the expected name. | `packages/prism-coding-tools/src/computer-use-linux/skill.ts:10-21` | Task 7 reuses this small loader pattern: read, cap, parse, assert known name. Work scripts remain sandbox-only, unlike this host desktop bridge. |

### Frozen vocabulary

- Package: `@arnilo/prism-work`
- Subpaths: `/connectors`, `/connectors/microsoft365`, `/connectors/google-workspace`, `/connectors/drafts`, `/documents`, `/sheets`, `/diagrams`, `/document-reader`, `/tools`, `/sandbox`, `/skills`
- New names: `createOfficeTools`, `createWorkComposition`, `loadWorkSkills`, `WORK_SANDBOX_IMAGE`
- Injection seam: host supplies a `DisposableSandbox`; `prism-work` does not runtime-depend on `@arnilo/prism-coding-tools`.

The cut replaces `@arnilo/prism-office`; it does not add a twelfth publishable package or a compatibility shim. Existing hosts change imports on the next lockstep pre-1.0 cut.

## Later-task mapping

| Task | Frozen primitive or explicit boundary |
| --- | --- |
| 2 | Physical moves only: work types/tools/adapters/drafts, document libraries, and reader implementation. Preserve coding-tools `DocumentReader` interface and core PostgreSQL structural store; prohibit `prism-work` ↔ core/coding-tools runtime edges. |
| 3 | `generateDocument`, `importDocument`, `patchDocument`, `diffDocument`, preview functions, document caps, and structural reader slot. No duplicate AST or raw OOXML transcript output. |
| 4 | `createWorkHttpClient`, fixed adapter operation maps, work limits, draft store, approval, and idempotency. Explicitly out: model-supplied download URLs and generic Graph/Drive clients. |
| 5 | Existing `Microsoft365Op` / `GoogleWorkspaceOp`, capability gates, and draft lifecycle. Explicitly out: free-form `batchUpdate`, Planner/Teams tools, and a Graph Word/Excel session. |
| 6 | `DisposableSandbox`, `createDockerSandbox`, and `createSandboxCodingComposition`. Explicitly out: tokens/connectors in the sandbox, a second sandbox runtime, unrestricted egress, or an isolation claim without attested capabilities. |
| 7 | `parseSkillFile`, `createSkillRegistry`, and capped computer-use loader pattern. Explicitly out: Prism-written skill bodies, Anthropic document-skill redistribution, npm dependency on Hermes, and scripts executed on host. |
| 8 | Existing document model plus injected sandbox `execFile`. Explicitly out: in-process formula evaluation and default-test LibreOffice execution. |
| 9 | Existing XLSX/DOCX generate translation and document caps. Explicitly out: new model kinds, charts, pivots, comments, headers, and a general numbering engine. |
| 10 | Existing `isZipContainer` boundary and work sandbox. Explicitly out: an in-process OLE `.doc`/`.xls`/`.ppt` parser or macro execution. |
| 11 | Existing package/export truth and pack probes. Preserve 11 publishable names, import isolation, optional-peer failure, and history-only references to retired imports. |

## Threat model and required posture

| Threat | Current protection | Required follow-through |
| --- | --- | --- |
| Sandbox receives tenant tokens | Work HTTP resolves per-identity tokens only at request edge; Docker env is an exact allow-list and defaults to network none. | Task 6 rejects M365/Google token names, keeps connectors host-side, and reports `networkIsolated` only from injected capabilities. |
| LibreOffice macro/OLE execution | In-process document APIs never spawn a process; import reports unsupported macros/OLE as fidelity issues. | Task 6 uses headless LibreOffice with isolated profile, no macro-enable flags or socket, network none; Tasks 8/10 run it only inside that sandbox. |
| OOXML ZIP symlink/bomb escape | In-process parsing requires a PK container and document caps; Docker workspace import rejects unsafe archive entries. | Tasks 3 and 6 keep byte/element caps before parse and never extract model-supplied archives onto host. Add explicit regression coverage wherever sandbox filesystem import/export meets OOXML bytes. |
| Proprietary Anthropic skill vendoring | Anthropic labels document skills source-available, not open source. | Task 7 allows only the pinned Hermes MIT source, records `vendor-lock.json`/notice, byte-compares against Anthropic material, and fails without copying on provenance or license doubt. |
| Model-supplied Graph/Drive URL | Work HTTP client allowlists origins, pins fetch, bounds request/response, and resolves tokens late. | Tasks 4-5 expose item IDs and fixed builders only; schemas omit `url`, reject extra fields, and preserve origin tests. |
| Core runtime depends on office-open through prism-work | `PostgresEnterpriseState.workIdempotency` is structurally typed today; document imports are isolated in office. | Task 2 keeps core `workIdempotency` local, replaces value imports with local core errors/limits, and proves core ↛ prism-work at runtime. |
| Vendored skill scripts run outside sandbox | Existing skill loader reads text only; it does not execute scripts. | Tasks 6-7 bind scripts only to sandbox `execFile` with argv, require a work sandbox for registration, and never expose host shell/token env as a skill tool. |

## Task 11 baseline

Measured 2026-09-17 with `npm pack --dry-run --json` in each package. Export counts are `package.json` `exports` keys; pack values are evidence for Task 11, not new enforced budgets.

| Package | Packed bytes | Unpacked bytes | Files | Export keys |
| --- | ---: | ---: | ---: | ---: |
| `@arnilo/prism-office` | 55,373 | 247,113 | 76 | 3 |
| `@arnilo/prism-core` | 418,550 | 2,062,441 | 450 | 23 |
| `@arnilo/prism-coding-tools` | 294,501 | 1,270,634 | 275 | 10 |

Current packaging remains 11 publishable packages and includes `@arnilo/prism-office`; Task 2 replaces that name with `@arnilo/prism-work` without changing the count. Task 11 compares the moved family against this pack/export snapshot before recording a justified ceiling change.

## Existing verification evidence

- Work tool construction and HTTP adapter coverage: `packages/prism-core/src/integrations/work/__tests__/{work-tools,microsoft365-http,google-workspace-http,drafts}.test.ts`; direct callers are enumerated by `graft callers createWorkTools`.
- PostgreSQL idempotency and enterprise composition: `packages/prism-core/src/enterprise/postgres/__tests__/{stores,work-idempotency,enterprise-conformance}.test.ts`; `createPostgresEnterpriseState` wires `workIdempotency` at `enterprise.ts:66`.
- Document reader cap and reader-slot coverage: `packages/prism-coding-tools/src/document-reader/__tests__/index.test.ts` and `packages/prism-coding-tools/src/__tests__/coding-tools-conformance.test.ts`.
- Sandbox, capability, Docker, and composition coverage: `packages/prism-coding-tools/src/security/__tests__/docker-sandbox.test.ts`, `sandbox-coding-operations.test.ts`, and related security suite.
- Packaging count/export truth: `src/__tests__/packaging.test.ts` and `scripts/package-truth.json`.

## Review decision

Proceed with one physical-move family, host-injected sandbox, and four pinned Hermes skills. Reuse work drafts/idempotency, document model/caps, coding-reader seam, Docker sandbox, and skill parser/registry. Keep secrets, generic provider URLs, macro/OLE execution, unpinned or proprietary skill content, host script execution, compatibility wrappers, and new package count out of scope.
