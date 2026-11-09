# Memory prefix baseline — plan 202 Task 4.11

Executed 2026-10-30, offline. No live model, embedding, network or paid request; no credential
read, campaign resume, held-out inspection, product edit or new dependency. Seven scenarios
run ten user turns each (82 answer requests), plus 13 forced-tail turns across four sessions
and two real background-extractor requests. All providers are scripted mocks.

[offline-baseline.json](offline-baseline.json) pins the dirty working tree's fabric product,
supporting kernel/core sources, probe source and the three observed source files. It hashes
the actual `request.context` array and the blocks grouped by source before discarding fixture
text. Request indices are one-based **within each scenario**, including tool follow-ups;
turn indices count user inputs. `writes` identifies intervening write paths, including settled
lifecycle tasks that can be no-ops. It is not a count of changed rows.

| Scenario | Requests | Distinct prefixes | First changed request / turn | Observation |
| --- | ---: | ---: | --- | --- |
| conversational exchange archive | 10 | 9 | 2 / 2 | Directory changes; ten exchanges persisted. Core stays identical. |
| default, cited core | 19 | 2 | 4 / 3 | Core order changes after a recorded use at turn 2. Retrieval metadata is then patched repeatedly. |
| memory.insert at turn 5 | 11 | 2 | 6 / 5 | Directory and core change on the tool follow-up. |
| working update at turn 5 | 11 | 2 | 6 / 5 | Working block and directory change on the tool follow-up. |
| background promote at turns 5 and 8 | 10 | 1 | none | Two extractions persist two candidate notes; candidates do not enter core or active directory counts. |
| memory.forget at turn 6 | 11 | 2 | 7 / 6 | Core and directory change; forgotten text is absent immediately on the tool follow-up. |
| second instance writes at 5, forgets at 6 | 10 | 1 | none | Storage confirms deletion, but the package keeps sending the forgotten core text through turn 10. |

The second-instance writer is a distinct `Memory` with a separate SQLite connection to the
same file as the package. It does not call package cache invalidation. This reproduces the
cross-process cache boundary without spawning a second agent.

## Assumptions and consequences

- **Storage strength:** recorded uses increase S from 0 to `log(2)` and deduplicate within
  the same session. A core-only citation at turn 1 records no use: `context.ts` calls
  `tracker.show` for recall/passive/cue delivery, but not core delivery. The script therefore
  recalls the same core note from turn 2 onward and cites it every turn. This distinguishes
  the missing core-citation tracking from the confirmed lifecycle effect on core ordering.
- **Tail placement:** all 13 observed tails sit after the prior transcript and **before**
  the latest user message. They are not after the whole transcript. On a first turn,
  `buildProviderMessages` can treat that leading system tail as part of its stable system
  group and place it before context blocks. Task 4.12 must check first-turn-to-second-turn
  provider-visible ordering before claiming that a volatile tail preserves cache continuity.
- **Extractor:** system segments match, tool segments differ across candidate sets. Removing
  only id enums still leaves different schema hashes: the optional presence of `contradicts`
  also depends on recalled existing notes. Task 4.13 must stabilize that shape as well.
- **Tail map:** four sessions close, four entries remain in the same live agent's map.
  Observation adds a reference to the map but never inserts an entry. This measures retained
  closed-session entries while the agent is alive, not a leak after agent disposal.
- **Not every write changes bytes:** promotion creates candidates and repeated uses dedupe.
  The baseline measures serialized prefix changes rather than assuming that each cache
  invalidation must be a cache miss.

Tasks 4.12–4.14 retain ownership of the fixes; this baseline does not change product behavior.

## Extractor size

The already cached `convaiinnovations/laya` tokenizer at Hugging Face revision
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` was loaded by the existing Laya virtual environment.
Tokenizer SHA-256: `6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30`;
`tokenizers` 0.23.2. No tokenizer was installed, downloaded or committed.

| Actual extraction | JSON bytes with / without id enums | Encoded tokens with / without id enums |
| --- | --- | --- |
| first | 5364 / 5350 | 1379 / 1374 |
| second | 5425 / 5382 | 1401 / 1384 |

Counts encode the captured system-plus-tools JSON, without special tokens or vendor chat
templates. They are measured Laya-tokenizer counts, not universal counts for all extractor
routes. Task 4.13 still needs a shipped route's documented cache minimum and matching tokenizer
or wire encoding before taking its conditional branch. Chars/4 estimates are separately labelled.

## Reproduction and verification

```sh
timeout 120 env \
  PRISM_PREFIX_PROBE_PYTHON=/home/arn/venvs/laya/bin/python \
  PRISM_PREFIX_PROBE_TOKENIZER=/home/arn/.cache/huggingface/hub/models--convaiinnovations--laya/snapshots/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/tokenizer/tokenizer.json \
  bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/202/cache-stability/offline-baseline.json
timeout 120 bun test scripts/memory-bench/prefix-probe.test.mjs
```

The local executable and tokenizer paths can be replaced with existing equivalents. Without
these variables the probe remains offline/deterministic and reports exact byte sizes, estimates,
and null encoded token counts. It deliberately does not fetch a tokenizer.

The measured CLI execution took **801.6 ms**, including local tokenization. Timings go to stderr
only; wall-clock values and temporary paths are excluded from deterministic JSON.

- Tests first: the named regressions initially failed because the probe did not exist.
- New regressions: seeded prefix mutation at the exact request, identical JSON across independent
  executions, and no fixture text in public evidence. They also check all scenario dispositions,
  actual persistence/deletion, tail retention, tokenizer counts when configured, and payload hash.
- Full benchmark suite: **375 pass / 2 environment skips / 0 fail** (102.97 s). Skips are the
  official Vibe image and cached BEAM annotation inventory.
- Existing fabric quiet-prefix test: **1 pass / 0 fail**.
- Repository `bun run typecheck`: **pass**. Biome on the two new scripts: **pass**.
- Documentation suite: **65 pass / 0 fail**. `git diff --check`: **pass**.

Payload SHA-256 (compact JSON, omitting `sha256`):
`fe2e72999b7e25954b4b384f8192adde3b9dce32e5c43f2e6a0002b55f092347`.

File SHA-256 (`offline-baseline.json`, including indentation, trailing newline and payload hash):
`54c2f74feb8be4c7fbcfbc5ed917a0239ff66a1142871f7c2b9255d7dc5358ef`.

## Session epochs — Task 4.12

[offline-4.12.json](offline-4.12.json) records the offline post-change probe, with product and
supporting-source fingerprints. Exchange archiving (ten persisted exchanges), recorded citation
lifecycle writes, insert, working updates and two background promotion passes each retain one
prefix hash. The forget scenario has exactly two hashes; request 7, the tool follow-up at turn 6,
is the only change and no longer shows the forgotten note. All 13 nonempty tails follow the entire
transcript. Four closed sessions leave zero entries in the tail map.

Cross-process retraction revalidation remains Task 4.14: the separate-instance scenario still
shows deleted core text until an epoch boundary. The extractor schema remains unchanged here
(Task 4.13). The empty-working-memory fixture preserves its original first-build context bytes;
the broader single-turn benchmark equivalence attestation remains Task 4.15. No paid calls ran.

## Cross-process retraction — Task 4.14

[offline-4.14.json](offline-4.14.json) re-runs the probe after revalidation. The separate-instance
scenario has two prefix hashes: the first change is request 6 (turn 6), the first request after the
other instance's forget, and the deleted core text is absent from the last request. Its additive
insert at turn 5 changes nothing. All other scenarios keep the 4.12 results (one prefix hash, or two
for forget), and four closed sessions retain zero tail entries. No paid calls ran.

## Equivalence attestation and readiness pin — Task 4.15

[equivalence.json](equivalence.json) compares every answer-phase provider request on the two fabric answer paths of the
23-cell screen (`preset-r1` = `fabric-x-tools`, `passive-only` = `fabric-x`), replayed offline on the 14 synthetic
fixture questions with a mock provider (56 requests). Ids and the clock are pinned, and each tree is captured twice with
byte-identical results. The base is a git worktree of commit `5c2570df`; its fabric product hash is
`57aa47d9…`, the product hash recorded in the screen's own manifest (`baseline/manifest.json`), so the base is the
product the 23 cells ran. Both trees ran the same (current) harness.

**Result: different, on both arms.** All 56 requests differ.

| Arm | Differing layers | Tail position, base → post |
| --- | --- | --- |
| `preset-r1` | context, system, tools, transcript, tail position | before the latest user → after it |
| `passive-only` | context, system, tail position | before the latest user → after it |

The tail relocation is Task 4.12's intended change (a first-turn system tail would otherwise be hoisted into the prefix).
The other layers also moved, because the working tree carries all Plan 202 product edits since commit `5c2570df`
(Tasks 4.10-4.14, for example the `memory.read` tool text); the comparison cannot split them by task, and it
does not need to: the product that ran the 23 cells no longer produces the same answer requests.

Consequence, by the plan's rule: the `preset-r1` and `passive-only` cells are **not** a comparison base for the Task 5-10
development screens. They are rerun under gate 2 with their budget stated there, and are never mixed with the
pre-change cells (`mergeWithPreChangeCells: false`, `rerunArms: ["preset-r1", "passive-only"]`). The comparator arms
(`full`, `full-truncated`, `lexical-topk`) install no fabric (`config` has no `fabric`), were outside the attestation,
and keep their cells. No cell was rerun and no paid call ran here.

[record.json](record.json) pins the passing 4.12-4.14 prefix suite and the SHA-256 of `equivalence.json` to the
current LTM product hash (`packages/memory/system/src/ltm`). `runCampaign` refuses a manifest whose product lacks it.
Editing that tree invalidates the record until both commands in
[the benchmark README](../../../../../scripts/memory-bench/README.md) are rerun.

**Re-attestations.** Plan 210 Task 7 re-attested the pin to the slimmed fabric product (`867f8277…`, 29 pass).
Plan 216 Task 8 (2026-11-09) re-attested it to the memory-system LTM product (`4fb60791…`, 27 pass / 0 fail: Task 7
deleted the two working-memory tests, one of them a named 4.12-4.14 test). The equivalence file is now the plan 216 one
([216/equivalence.json](../../216/equivalence.json), base `37ee1a24` on its own harness): 54 requests, `different` for
`preset-r1` (system, tools) and `passive-only` (system), all of it the Task 7 tool text; context, transcript and tail are
identical. See [216/README.md](../../216/README.md).
