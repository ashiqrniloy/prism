# Scoped memory (`@arnilo/prism-memory/scoped`)

## What it does

`createScopedMemoryPolicy()` is a **policy and lifecycle layer** over stores a host already configured with `createMemory()` and `createMemoryFabric()`. It does not add a fifth store. It owns workspace-root identity, a conservative post-run writer, a candidate→verified promotion ladder, usage-decay GC proposals, an abstain floor plus activation budget on recall, a bounded working facts block, a git audit mirror, and a JSON usage/staging ledger at `<scopeRoot>/.memory/state.json`.

**Routing.** Source-cited knowledge belongs in [`@arnilo/prism-memory/wiki`](wiki.md) (regenerable, line-anchored). Session-derived experience belongs in scoped memory (primary fabric records with `sourceEntryIds` provenance). The post-run reviewer must not duplicate a wiki-pageable insight as a scoped fact.

## When to use it

Use it when a host wants durable facts and procedures to accumulate across sessions for one workspace without injecting the whole library into the prompt. Leave it off when an eval A/B shows no win-rate lift. Do not use it as a wiki, an observational-memory replacement, or a second vector store.

## Inputs / request

### `createScopedMemoryPolicy(options)`

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `memory` | `Memory` | yes | — | `createMemory()` instance. `scope.resourceId` must equal `resolve(scopeRoot)`; `scope.threadId` is required (stable workspace silo, not a session id). |
| `fabric` | `MemoryFabric` | yes | — | `createMemoryFabric()` over that memory. |
| `scopeRoot` | `string` | yes | — | Workspace root. Create is inert: no attach, no files. |
| `policy` | `ScopedMemoryPolicyKnobs` | no | see knobs | Tuning. Unknown fields ignored; invalid values fail closed. |

### Knobs (`policy`)

| Knob | Default | Role |
| :--- | :--- | :--- |
| `promotion.reuseThreshold` | `2` | Flip ledger `candidate` → `verified` after this many successful recall uses. No fabric rewrite. |
| `decay.tauDays` | `30` | Time constant for `score = fabricScore × exp(−ageDays/tauDays) × (1 + ln(1 + uses))`. |
| `decay.candidateArchiveDays` | `30` | Unused candidates this old become GC archive proposals. |
| `activation.topK` | `3` | Recall budget after the floor. |
| `activation.minSimilarity` | `0.35` | Abstain floor (`hit.similarity ?? hit.score`). |
| `facts.block` | `"facts"` | Working-block label for `rememberFact`. |
| `facts.maxChars` | `2200` | Overflow throws `MemoryLimitError` (`consolidate first`). |
| `approval.default` | `"off"` | `"off"` writes reviewer proposals immediately; `"staged"` queues them on `pending()`. |

### Methods

| Method | Input | Notes |
| :--- | :--- | :--- |
| `recall(query, opts?)` | query string | Wraps `fabric.recall` with oversample, floor, topK, usage increment. |
| `reviewSession(digest, { reviewer, prompt? })` | string or entry array | One fake/real reviewer call. Strict JSON: `{kind, content, sourceEntryIds}` only; `kind` is `fact` or `procedure`; `sourceEntryIds` non-empty. Garbage → zero writes, no throw. |
| `promotionPass()` | — | Ledger status only. |
| `gcPass()` | — | Proposes archives onto `pending()`. Never deletes. Skips `legal_hold`. |
| `health()` | — | Counts + conversion/activation/duplication rates. |
| `rememberFact(text)` | non-empty string | Appends the facts block after `scanScopedMemoryContent`. |
| `pending()` | — | Reviewer stages and GC archives. |
| `approve(id)` / `reject(id)` | pending id | Approve writes/forgets; reject drops the proposal (archive restore uses `prevStatus`). |
| `renderMirror()` | — | Deterministic markdown under `<scopeRoot>/.memory/`; gitignores `state.json`. |

### Eval and scan

- `runScopedMemoryEval({ fixtures, fakeProvider? })` — fixture-only. Rejects `memory` / `policy` / `fabric` / `vectorStore`. Default fake answers from recall context or `"unknown"`. Reports A/B `winRate`, Precision@3 (mean `\|relevant ∩ top3\| / 3`, alert below floor 0.5), LoCoMo (`failedClosed` when `expectedId` was never seeded), and `health()`.
- `createScopedMemoryHealthCommand({ policy })` — `scoped-memory:health`.
- `scanScopedMemoryContent(text)` — `{ ok: true }` or `{ ok: false, class: "prompt-injection" \| "exfil" \| "invisible-unicode" }`. Writes fail closed on a match.
- `scoreScopedHit(score, uses, ageDays, tauDays)` — the read-policy formula.

## Outputs / response / events

Create returns a frozen `ScopedMemoryPolicy` (`scopeRoot`, `settings`, methods). No events; fabric/memory events are unchanged.

`recall` → `{ hits, abstained, explain }`. Empty hits + `abstained: true` when nothing clears the floor.

`reviewSession` → `{ proposed, written, staged, status: { candidate } }`.

`promotionPass` → `{ promoted }`. `gcPass` → `{ proposed, archived }` (`archived` stays 0 until the host `approve`s).

`health` → `{ notes: { candidate, verified, archived }, conversionRate, activationRate, duplicationRate }`.

`rememberFact` → `void` or `MemoryLimitError` / `MemoryValidationError`. `renderMirror` writes `notes/<id>.md`, `facts.md`, `.gitignore`.

## Request/response example

```json
{
  "scopeRoot": "/tmp/workspace",
  "policy": {
    "promotion": { "reuseThreshold": 2 },
    "decay": { "tauDays": 30, "candidateArchiveDays": 30 },
    "activation": { "topK": 3, "minSimilarity": 0.35 },
    "facts": { "block": "facts", "maxChars": 2200 },
    "approval": { "default": "off" }
  },
  "recall": {
    "hits": [{ "id": "aaaaaaaaaaaa", "kind": "fact", "content": "SSH listens on 2222", "score": 0.91 }],
    "abstained": false
  }
}
```

## Implementation example

```ts
import { createHashEmbedder, createMemory } from "@arnilo/prism-memory";
import { createMemoryFabric } from "@arnilo/prism-memory/fabric";
import { createScopedMemoryPolicy } from "@arnilo/prism-memory/scoped";

const memory = createMemory({
  tenantId: "host",
  resourceId: workspaceRoot,
  threadId: "scoped",
  embedder: createHashEmbedder({ dimensions: 8 }),
});
const fabric = createMemoryFabric({ memory, consolidate: false });
const policy = createScopedMemoryPolicy({ memory, fabric, scopeRoot: workspaceRoot });

await policy.rememberFact("SSH jump host listens on 2222");
await policy.reviewSession(digest, { reviewer });
const { hits, abstained } = await policy.recall("SSH 2222");
await policy.promotionPass();
await policy.gcPass();
await policy.renderMirror();
```

Runnable walk (scope guard → overflow → review → recall → promotion → GC approve → mirror): `examples/scoped-memory.ts`.

Inject only the facts block: `fabric.createContextProvider({ includeWorking: true, includeSemantic: false })`.

## Extension and configuration notes

The policy is off until the host constructs it. `reviewer` is host-supplied (LLM or fake). `approval.default: "staged"` makes reviewer writes host-gated. `createScopedMemoryHealthCommand` follows the observational `om:status` command factory. Eval fixtures live next to the runner; import eval APIs from `@arnilo/prism-memory/scoped` (no `./scoped/eval` subpath).

## Security and performance notes

- **Scope identity:** create throws if `resourceId !== resolve(scopeRoot)` or `threadId` is missing. Observational session mismatch stays `fabric.attach`.
- **Writes fail closed:** `scanScopedMemoryContent` then the memory redactor. Matches name a class; payloads are not logged.
- **GC never silently deletes.** `legal_hold` notes are not proposed. Host `approve` calls `fabric.forget`.
- **Sizing:** one reviewer call per run; ledger I/O per recall; off by default. Activation is top-3 after the floor, not the whole library.
- **Mirror** skips scan failures. `state.json` is gitignored; markdown is the audit copy, not a second engine.

## Related APIs

- [Memory fabric](memory-fabric.md): typed notes this policy writes and recalls through.
- [Working and semantic memory](working-and-semantic-memory.md): `createMemory`, consent, redaction, `exportMemory`.
- [Observational memory](compaction-observational-memory.md): episodic ledger; scoped facts keep `sourceEntryIds`.
- [LLM wiki](wiki.md): source-cited knowledge compiler — not session-derived experience.
- [Scoped agent memory design concept](scoped-agent-memory.md): rationale, Hermes case study, research basis.
- [Evaluations](evaluations.md): trajectory/outcome scorers; scoped eval is fixture-only on this subpath.
