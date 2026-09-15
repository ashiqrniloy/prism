# 077 — Work-scope primitive review

Status: complete. This is Task 1 evidence, not an API page.

## Decision

Keep observational memory as an append-only episode ledger. Add an opt-in sibling
index over `om.scope.*` custom entries; join it only when projecting context. Do
not add scope fields to observations/reflections, alter `runWorkflow`, add a
package, or change attach-off behavior.

## Documentation reviewed

- `docs/compaction-observational-memory.md`
- `docs/working-and-semantic-memory.md`
- `docs/workflows.md`
- `docs/api-page-template.md`
- `.agents/skills/create-plan/references/prism-wiki.md`
- `plans/076-Observational-Memory-Mastra-Parity.md` (superseded; rejected design)

## Current primitive inventory

| Primitive | Current contract | Covers |
| --- | --- | --- |
| OM custom entries | `om.observations.recorded`, `om.reflections.recorded`, `om.observations.dropped`; compaction stores `om.folded` under `data.memory`. | `packages/memory/src/compaction/observational-memory/types.ts:3-6,28-53,89-132` |
| Episode records | `MemoryObservation` and `MemoryReflection` have immutable ids, content, source/support ids, and token counts; neither has membership metadata. | `packages/memory/src/compaction/observational-memory/types.ts:12-26,62-87` |
| Ledger fold | Folds custom/compacted data into observations, reflections, dropped ids, and coverage markers. | `packages/memory/src/compaction/observational-memory/ledger.ts:22-67` |
| Existing projection | Separates full/visible active data at compaction boundary and honors invalidation; it is not a work-scope query. | `packages/memory/src/compaction/observational-memory/projection.ts:27-51` |
| Render | One OM renderer outputs reflections before observations, redacts secrets, and applies rendered-memory byte cap. | `packages/memory/src/compaction/observational-memory/render.ts:18-37` |
| Context blocks | One `observational-memory` block plus one recent-message block, using existing projection then renderer. | `packages/memory/src/compaction/observational-memory/recent-messages.ts:52-68` |
| Attach | OM activation is explicit through `attach`; it supplies the existing context provider and runtime. No attach means no OM runtime/context path. | `packages/memory/src/compaction/observational-memory/compose.ts:113-301` |
| Flush | Observe → append redacted observations → reflect → append redacted reflections → drop active observations over target. | `packages/memory/src/compaction/observational-memory/runtime.ts:132-258` |
| Dropper | Model or deterministic dropper selects only active observation ids; it does not provide membership/query semantics. | `packages/memory/src/compaction/observational-memory/runtime.ts:210-248`; `packages/memory/src/compaction/observational-memory/workers/dropper.ts:45-75` |
| Append ownership seam | `appendCustom` uses current leaf as `expectedParentId`, checks the appended entry is current-branch leaf, restores previous leaf, then fails closed. | `packages/memory/src/compaction/observational-memory/runtime.ts:315-328` |
| Exact-id recall | Recall folds whole supplied branch and looks up exact observation/reflection id; it does not consume a context projection. | `packages/memory/src/compaction/observational-memory/recall.ts:48-131` |
| Existing bounds/redaction | Worker messages are bounded; folded payload is bounded; rendered OM text is redacted and bounded. | `packages/memory/src/compaction/observational-memory/limits.ts:59-128`; `packages/memory/src/compaction/observational-memory/memory-bounds.ts:21-63`; `packages/memory/src/compaction/observational-memory/render.ts:18-37` |
| Observer seam | Observer accepts only source ids from supplied entries, and builds its prompt under worker byte limits. | `packages/memory/src/compaction/observational-memory/workers/observer.ts:25-61`; `packages/memory/src/compaction/observational-memory/limits.ts:107-115` |

### Scope names already in Prism

| Name | Meaning | Why it is not `WorkScope` | Covers |
| --- | --- | --- | --- |
| `MemoryScope` | Durable memory tenancy: `tenantId`, `resourceId`, optional `threadId`. | It isolates stored working/semantic memory; it must not select an OM working set. | `packages/memory/src/types.ts:5-9` |
| `OwnershipScope` | Persistence/authority identity: optional tenant, account, user. | It authorizes access; it must not become host work-tree membership. | `src/contracts-core/persistence.ts:25-29`; `packages/prism-core/src/sessions/codecs/ownership.ts:10-14` |
| Workflow ids | A node context carries `runId` and `nodeId`; loop contexts add stable `iterationId`. | Useful host-provided scope ids only. Runner remains unaware of OM scopes. | `packages/prism-core/src/runtime/workflows/types.ts:82-105`; `packages/prism-core/src/runtime/workflows/run/node-execution.ts:31-244`; `packages/prism-core/src/runtime/workflows/util.ts:104-109` |
| Coding `taskId` | Durable coding checkpoint metadata identifies a host coding task. | Useful host-provided scope id only; it is not OM ontology. | `packages/prism-coding-tools/src/agent/coding-checkpoint.ts:125-143,380-490` |

## Reuse/gap matrix

| Requirement | Reuse | Gap for follow-up task |
| --- | --- | --- |
| S1 opt-in/unscoped compatibility | Existing fold, active pool, attach, context blocks, and dropper remain path when no `om.scope.*` exists. | Sibling fold supplies implicit `session` root and returns existing active pool unchanged when host scopes are absent. |
| S2 work-scope shape | Existing `SessionEntry.kind: "custom"` and opaque custom `data` payloads. | Define `WorkScope` beside OM types: bounded host id, optional parent/kind/label, open/closed; no enum. |
| S3 tree lifecycle | Append-only custom-entry log and leaf ownership append. | Fold open/close state and controller validation for parent, duplicate, depth, close/pop. |
| S4 many-to-many binds | `MemoryId`, observation/reflection guards, and full ledger are existing id authority. | Add scope-to-`om:`/`reflection:` join entries; reject unknown scopes or ids, retain records on unbind. |
| S5 active stack | Session has a current branch leaf; custom entries preserve chronology. | Add entered/left entries and root-to-leaf stack recomputation; `session` never leaves. |
| S6 leaf-only auto-bind | Flush already knows newly appended observations/reflections and appends custom data through ownership seam. | Batch-bind only ids written by one flush to current work-scope leaf. |
| S7 work projection | Existing fold/projection/filter shape and exact-id recall independent of context selection. | Join ledger + scope map for self/ancestor/descendant/lineage, closed policy, kind filter, and default leaf/ancestor view. |
| S8 scoped dropper policy | Current dropper invocation is isolated in `flush`; folded payload bound remains separate compaction safety cap. | Gate that invocation on absence of host-opened scopes; never repurpose storage cap as work-set GC. |
| S9 helper | No existing helper; workflow contexts expose host ids. | Add memory-package `withWorkScope` as open-if-missing + enter + `try/finally leave`; do not close or patch runner. |
| S10 fail-closed caps/redaction | `appendCustom` ownership check, worker/render redaction, and existing byte bounds. | Validate scope ids/count/depth/stack/binds/label; redact label/kind before append/render and keep them inside existing worker/render/folded-payload caps. |
| S11 scoped render order | Existing single renderer already has reflection then observation sections. | Add optional scope outline before those sections; no second context provider or renderer. |
| S12 observer tightening | `runObserver`, default instruction, and bounded `joinWorkerText` are isolated seams. | Tighten only observer text and pass bounded active observations; no `record_current_task`, schema rewrite, reflector, or dropper change. |

## Locked rejections

| Rejected design | Reason |
| --- | --- |
| Resource-scoped OM | `MemoryScope` is tenant/resource/thread isolation. Reusing it would leak unfinished work across threads rather than index one OM ledger. |
| Budget/KEEP drop as working set | Current dropper permanently marks observations dropped; projection must select retained episode ids without deleting task-local history. |
| `om.current_task` | Current leaf scope id/label is host-controlled and queryable; a singleton task field cannot express promotion or nested work. |
| `runWorkflow` auto-enter | Workflows are optional and domain-neutral. Hosts may pass `ctx.nodeId`, `ctx.runId`, or `ctx.iterationId` to `withWorkScope`; runner stays untouched. |
| Bind targets beyond OM observations/reflections | Day-one join remains type-safe and exact-id recallable; arbitrary session/resource ids expand trust and query semantics without need. |
| New npm package/subpath | Work scopes extend one OM ledger and reuse its append/render/runtime seams; same observational-memory subpath is smaller. |
| `scopeId` on `MemoryObservation` | One mutable membership blocks many-to-many promotion and requires log rewrite. Keep record and index separate. |

## Implementation seams and security result

1. `foldWorkScopeMap` is a sibling fold over the same branch entries as
   `foldObservationalMemoryLedger`; neither mutates the ledger or episode types.
2. `projectWorkMemory` joins folded ledger ids to the folded index. Context calls
   it before existing rendering; exact-id recall remains on full ledger.
3. Controller writes follow `appendCustom` ownership/leaf verification. Labels and
   kinds use the same `redactSecrets` path and bounded rendered/folded payloads as
   observations; the new 512-character label cap is an additional fail-closed
   input cap, not a new unbounded channel.
4. Flush is the only auto-bind seam. It will append one batch bind after writes;
   its existing dropper call is skipped whenever host-opened scopes exist.
5. Attach-off remains inert. This review adds no runtime code, imports, provider
   calls, network operation, workflow-runner patch, or public export.

Task 1 introduces no ledger types. Tasks 2–6 implement only the gaps above.
