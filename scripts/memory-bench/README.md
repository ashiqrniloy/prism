> Current Task 4 screen is **closed by owner with 23 accepted completed cells** (2026-10-30). The original 25-cell Muse 1.3 draw stays preserved. BEAM-1M full-truncated (15 partial questions) and lexical-topk are excluded from the final analysis. Accepted artifacts: `docs/_evidence/memory-bench/202/muse13-screen-final/`; closure: `muse13-screen-closure.json`. `screenComplete` in the accepted manifest means 23/23 accepted cells, not 25/25 original coverage or full Task 4 completion. A closure blocks refreshed readiness and further automatic model calls. Missing usage reservations remain held; the broader multi-model baseline is deferred. Older run instructions below are historical and must not override the owner closure.

> Current Task 4 execution scope (2026-10-29): owner stopped the 75-cell campaign and selected a **25-cell Muse Spark 1.3 Contributor development screen**: five frozen suites × five configurations, MiniMax M3.1 Flash + GLM 5.3 Flash judges unchanged. Its separate journal is `.cache/memory-bench/202-muse13-screen/journal.json`; reports go to `baseline/muse13-screen/`. The stopped campaign retains its completed/partial reports and all charges, including the interrupted attempt's full reservation. Completing this screen sets `screenComplete`, never `baselineComplete`; cross-model confirmation and full Task 4 remain deferred. Older model-set notes below are historical.

> Current Task 4 panel (2026-10-29): owner-selected Command Code MiniMax M3.1 Flash + GLM 5.3 Flash. The MiniMax free route returned HTTP 403 (free window ended); paid judges are authorized. `--readiness-v6 --score-only` runs from `.cache/memory-bench/frozen-panel-v6/` and uses all 42 immutable Muse v5 answers, without regeneration. `graded.mjs --commandcode-panel-controls` checks the new panel against eight development rubrics, 36 existing borderline/paraphrase variants plus eight wrong-answer controls; no new answers or paraphrases. Historical Lightning scores stay preserved but cannot be reused under the changed panel: the old all-phase reports have no answer checkpoints. Broad jobs use `--free-product-only --bounded-wire` for free answerers with paid judges, and a separate `202-commandcode-panel-baseline` journal. Global `--free-only` still rejects every paid route. Only a current source-matched readiness pass permits the broad campaign.

# Memory benchmark (0.13.0)

This opt-in runner measures Prism on pinned public datasets. It never runs as a
live test during `bun run test`; the offline smoke needs only Bun.

```sh
timeout 60 bun scripts/memory-bench/run.mjs --offline
timeout 900 bun scripts/memory-bench/trust-scan-audit.mjs --output docs/_evidence/memory-bench/188.11/trust-scan.json
timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs

# Live benchmark tooling, isolated from all Prism packages:
timeout 60 python3 -m venv /tmp/memory-bench-python
timeout 180 /tmp/memory-bench-python/bin/pip install -r scripts/memory-bench/requirements.txt
export PRISM_MEMORY_BENCH_PYTHON=/tmp/memory-bench-python/bin/python

timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config full \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5
timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --config om \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5

timeout 30 bun scripts/memory-bench/report.mjs --compare a.json b.json
```

The suites are `longmemeval-s`, `locomo`, and `memoryagentbench-cr`; configurations
are `full`, `om`, `fabric`, `fabric-hybrid`, `fabric-agentic`, `om+fabric`, and the
product-ingestion arms `fabric-x`, `fabric-xc` and `fabric-xc-agentic` (below).
`fabric-hybrid` requires an embeddings model via `--embeddings <provider/model>`.
Supported live transports are the existing Hyper and OpenCode Go providers.
The judge can use a different provider or model. Credentials use the existing
live matrix dotenv parser and default to `~/.config/prism/live.env`;
`PRISM_LIVE_ENV_FILE` overrides it. Existing environment values win. Keys and
dataset/answer/memory text are never written to reports.

The benchmark-only Python requirements are PyArrow 23.0.1 for the pinned Parquet
artifact and NLTK 3.9.2 for LoCoMo's Porter-stemmed F1. No corpus downloads are
needed. No kernel or memory package depends on either library.

## Measurement repair protocol

New runs use `product-phases-delivery-v3`; old answer/reuse fingerprints are incompatible. The owner-closed 23-cell screen stays closed, and its report bytes and scores remain historical evidence.

MemoryAgentBench is explicitly a `fact-list` source. Product-ingestion arms write each original source line as a distinct typed `fact` through `createMemoryFabric().remember`, preserving source ids, order and synthetic `tRef` dates, with deterministic ids and no model call, extraction or fabricated assistant replies. Its recorded ingestion is `product-source-facts-v1`, and its resolved injection kinds explicitly include facts. This corpus adapter is an override of the conversational preset, so its future results cannot be presented as an unchanged exchange-only preset. Trust refusals are counted. Conversation archives continue to require completed user/assistant pairs; an unsupported user-only corpus or unexplained empty archive stops before answering and is never scored as 0% quality.

Ingestion reports record source-message counts, eligible exchanges or imported facts, refusals, unpaired messages and actual persisted source coverage. Product snapshots retain `ingest-report.json` and the note-to-round index. Missing proof, changed source identity or changed persisted coverage refuses reuse.

Evidence accounting maps message annotations to round ids for every suite, including LoCoMo. Unresolved annotations make completeness/fine rates unavailable. The private observer records ranked valid candidates before top-k/budget selection, separately from returned ids. Public candidate counts include direct reads; selected counts include only ids actually present in a model request. `memory.read` works by id or a complete indexed OKF note path; directory listings are not evidence. Non-fabric candidate observations are unavailable. These metrics measure **round presence**, not survival of every labelled sentence inside an excerpt. Exact private requests permit that finer audit. Failed retry attempts remain in the trace but do not credit the final attempt's evidence. Explicit and automatic recall calls are reported separately.

Every answer in `--phase all` or `--phase answer` is cached **before judging**, with a verdict-free checkpoint. A judge failure preserves it, and `--phase all --resume <report>` scores a pending conversational answer without regenerating it. Coding tasks retain their existing workspace-based regeneration/grading path. Run-limit answers retain their disposition. Failed answer attempts retain a separate diagnostic key. Private cache entries contain answers, query/options/ranks, tool-call ids and arguments, tool results/excerpts, exact agent provider-view messages/context and retry-attempt ids. Files are atomically replaced with mode `0600` under the gitignored answer cache (default `.cache/memory-bench/answers`); this adds local disk writes and can retain a full context per turn, but no model requests. Public JSON/Markdown contains keys, ids, hashes and counts, never these texts. Keep `--answers-dir` private and outside committed evidence.

The offline regressions are `timeout 90 bun test scripts/memory-bench/measurement-repairs.test.mjs`. Repaired evidence does not retroactively change historical scores or authorize a new live campaign.

## Offline memory-prefix probe (plan 202 Task 4.11)

```sh
timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/202/cache-stability/offline-baseline.json
timeout 120 bun test scripts/memory-bench/prefix-probe.test.mjs
```

Runs seven ten-turn sessions through `createAgent`, `mockProvider`, real fabric tools,
background consolidation and disposable SQLite stores. A second connection exercises writes
and forgetting outside the package's in-process caches. A further four sessions measure the
private tail-map size after close and force passive delivery with core disabled. Reports contain
hashes, counts, request/turn indices and verdicts only. Temporary stores are removed in `finally`;
the probe reads no credentials and blocks `fetch`.

Run it in a fresh Bun process. Process-local loader observation exposes the existing tail map
without changing its entries; fixed clock/nonce inputs make actual context hashes repeatable.
Package files remain untouched. `writes` names the intervening settled write paths and explicit
tool/external operations; a completed lifecycle task can be a no-op. A changed cache key does
not necessarily produce different prefix bytes (promoted candidates, for example, stay out of core).

Exact token counts are optional: set `PRISM_PREFIX_PROBE_PYTHON` to an existing Python executable
with Hugging Face `tokenizers`, and `PRISM_PREFIX_PROBE_TOKENIZER` to an already cached
`tokenizer.json`. Nothing is downloaded or installed. Evidence records the tokenizer SHA-256,
library version and actual encoded system-plus-tools sizes before/after removing id enums.
Without these variables, `encodedTokens` is null; the separately labelled chars/4 estimates
must not decide a provider's cache threshold. These are JSON projection counts, excluding a
vendor's chat template. The payload's `sha256` hashes compact JSON with that field omitted;
the evidence README also pins the pretty-printed file's SHA-256.

See [baseline findings](../../docs/_evidence/memory-bench/202/cache-stability/README.md).
This command measures existing behavior; it does not enable a campaign or repair caching.

## Cache-stability pin, equivalence and cache probe (plan 202 Task 4.15)

Three offline pieces and one live, informational one make the cache-stable product (Tasks 4.11-4.14) a
precondition of every further paid run.

```sh
# Equivalence attestation: the same answer paths on a pre-change worktree and on this tree, twice each.
git worktree add --detach .cache/memory-bench/202/cache-stability-base <pre-change commit>
timeout 600 bun scripts/memory-bench/prefix-probe.mjs --equivalence --base .cache/memory-bench/202/cache-stability-base \
  --out docs/_evidence/memory-bench/202/cache-stability/equivalence.json [--keep-text <private dir>]
# Pin: run the 4.12-4.14 prefix suite and bind it, with the equivalence file, to the current product hash.
timeout 900 bun scripts/memory-bench/audit/readiness.mjs --cache-stability
# Live, informational; only under gate 2 (once per development-screen answer route) or gate 3 (once per acceptance route).
timeout 900 bun scripts/memory-bench/cache-probe.mjs --model <provider/model> --turns 12 \
  --out docs/_evidence/memory-bench/202/<campaign evidence>/cache-probe.<route>.json
```

**Equivalence.** `--equivalence` replays every synthetic-fixture question on the `preset-r1` (`fabric-x-tools`)
and `passive-only` (`fabric-x`) answer paths with a mock provider and hashes every answer-phase provider request.
`equivalence-preload.mjs` pins kernel-minted ids and the clock so two captures are byte-identical; each tree is
captured twice and the run refuses if either tree differs from itself. `--base` must be a separate git worktree:
the command gives it its own `node_modules` (relative workspace links, so it never resolves the base's packages
through this tree) and overlays this tree's `scripts/memory-bench`, so only the product differs; the file records
both harness hashes and refuses unequal ones. Per request it hashes the system messages, tools, context, transcript
and tail separately, and records where the tail sits, so a differing request names the layer that moved. If every
request is identical the 23-cell screen stays the comparison base. If any differs, the file lists the differing
arms in `rerunArms` with `mergeWithPreChangeCells: false`: those cells are rerun under gate 2 with their budget
stated there and are never mixed with pre-change cells. `--keep-text` writes the request text to a private
directory for diagnosis; the report itself holds hashes and counts only.

**Pin.** `readiness.mjs --cache-stability` runs `prefix-stability.test.ts` and `prefix-probe.test.mjs` and writes
`cache-stability/record.json`: the suite result (the ten named 4.12-4.14 tests must be among the passing ones),
the fabric product hash (`PREFIX_PRODUCT_PATHS`, the hash every manifest carries) and the SHA-256 of
`equivalence.json`. `runCampaign` calls `assertCacheStabilityPin(manifest)` right after the manifest is built, so a
campaign of any mode is refused with a named blocker (`cache-stability-record-missing`, `-suite-failed`,
`-product-changed`, `-equivalence-missing`, `-manifest-unpinned`) when the product changed after the record, the
equivalence file was edited, or a manifest carries another product hash. Re-run both commands after any change to
`packages/memory/fabric/src`.

**Cache probe.** One scripted 12-turn `conversational` session through the wire proxy on one route, at most 12
wire attempts (the bound is enforced in the fetch hook, retries included). A second memory instance over the same
SQLite store makes an additive insert before turn 4 (the cache must survive it) and a forget of the core note before
turn 9 (the one request that may miss). The writes are host-side because a live model cannot be scripted to call the
tools; that is also the cross-process case Task 4.14 revalidates. Per request it reports `inputTokens`,
`cacheReadTokens`, `cacheWriteTokens`, the cache-read share and the cacheable-prefix share (bytes the request body
shares with the previous one). `status` is `as-expected` when every request after the first reads from the cache
except the forget request, which should read less than its predecessor. The campaign summary lists any
`cache-probe.*.json` in its evidence directory under `cacheStability` with `informational: true`; it is never a
criterion. Fixture text only; the report holds numbers and body hashes.

**Write-side accounting.** The wire proxy logs the affinity key a route sent (`x-session-id`, `session_id`,
`x-client-request-id`, `x-opencode-session` or `prompt_cache_key`). `roleUsage` moves product exchanges whose key
starts with the extractor's `prism-fabric-extract` into a separate `product-extract` role, so the screens report the
extractor's `cacheReadTokens` apart from answers. The registered cost criterion still counts every product-side
call: `productMeasurementVerdict` adds `product-extract` to `product`. `robustness-criteria.json` and its hash are
unchanged; a test pins the hash.

## Pinned data and draw

`datasets.mjs` records immutable revisions, byte sizes, SHA-256 hashes, license
names and source URLs. Files download into
`${PRISM_CACHE_DIR:-~/.cache/prism}/memory-bench/`. Both downloaded and cached bytes
are verified before parsing; a mismatch raises `MemoryBenchDatasetError` and
requires explicitly removing the corrupt file. Each cache file has a license
notice sidecar. Dataset contents are never vendored.

- LongMemEval-S cleaned: MIT, 500 questions. Base: ten ordinary questions of each
  of its six types, excluding `_abs` ids, plus ten abstentions: **70 questions**.
  `--subset targeted --ability knowledge-update` draws thirty of that type,
  including its ten base ids. All six targeted sets are recorded in `subsets.json`.
- LoCoMo: **CC BY-NC 4.0**, noncommercial use only. All **386 QA** from the seeded
  conversations `conv-47` and `conv-49`, with all five QA categories. Its
  `adversarial_answer` is a distractor, not the gold answer.
- MemoryAgentBench Conflict_Resolution: MIT, eight context rows. Forty fixed
  `(row, question-index)` pairs, twenty from each single-/multi-hop stratum.
  Decoded source names are `factconsolidation_sh_*` and `factconsolidation_mh_*`;
  rows retain their different context sizes. Each ordered fact line is an
  incremental ingestion unit. Dates are explicitly synthetic, starting at
  2000-01-01 UTC and advancing a minute per line.

`subsets.json` records the seed and ids. Ranking is ascending SHA-256 of seed,
colon, and id. MAB ids for the draw use the Python tuple spelling `(row, index)`.
`--subset all` bypasses the release draw. It can cost substantially more.
`--max-questions N` is an explicitly partial diagnostic, never a full baseline.

## Robustness suite and frozen partitions (plan 202 Task 2)

`robustness-criteria.json` holds the pre-registered definitions of **better than
full context** and **robust**, the owner decisions, and the suite list. Every later
report and campaign manifest pins `criteriaHash` (SHA-256 of the canonical JSON), so
no campaign can be scored against a changed definition.

Pinned suites (all pins are URL + byte size + SHA-256 + licence, verified
2026-10-27):

| Suite | Source | Licence | Role |
| --- | --- | --- | --- |
| `longmemeval-m` | `xiaowu0162/longmemeval-cleaned@98d7416c`, 2,737,100,077 bytes | MIT | beyond-window |
| `beam-100k` / `beam-500k` / `beam-1m` | `Mohammadta/BEAM@3205395e` | CC BY-SA 4.0 | in-window / optional / beyond-window |
| `beam-10m` | `Mohammadta/BEAM-10M@9b209619`, two parquet parts | CC BY-SA 4.0 | optional, not drawn |
| `locomo` | already pinned | CC BY-NC 4.0 | in-window, noncommercial accepted |
| `memoryagentbench-cr` | already pinned | MIT | in-window |
| `memorycode` | `CohereLabsCommunity/memorycode@32d888b1` | Apache-2.0 | coding, latest instruction |
| `coding-longitudinal` | project-owned generator, 12 personas | none | coding lifecycle |
| `vibemembench`, `dreambench-swe` | already pinned | Apache-2.0 | coding, licence-gated |

`statemembench` is **unavailable** (no released dataset or code as of 2026-10-27);
state tracking is mapped to `memoryagentbench-cr`, LongMemEval-M knowledge-update and
BEAM-1M contradiction_resolution.

BEAM normalization `beam-source-annotations-v1` preserves each message's original
`sourceId` alongside its normalized id. Question-only `sourceAnnotations` retain
`source_chat_ids` (lists or keyed groups), validated mappings and rubrics for
private grading diagnostics. A missing or ambiguous id stays unresolved; mapping
never guesses a message position or crosses a plan. Resolved ids enter the existing
`evidence` path and are graded as rounds. Annotated BEAM evidence does not fall
back to answer-text matches; incomplete annotations cannot claim all required
evidence was retrieved. Gold metadata never enters ingestion, retrieval queries,
or product-arm prompts.

BEAM reports pin the normalization version and adapter source hash in both resume
and reuse fingerprints. Pre-annotation checkpoints must be rerun under this protocol.
The original seven exploratory cells are preserved byte-for-byte with their
manifest, summaries, hashes and protocol provenance in
[`exploratory-original-2026-10-28`](../../docs/_evidence/memory-bench/202/exploratory-original-2026-10-28/PROVENANCE.md).
They remain exploratory evidence and cannot support corrected-protocol acceptance
or final lever decisions. The text-free development annotation inventory is
[`beam-source-inventory.json`](../../docs/_evidence/memory-bench/202/beam-source-inventory.json).

Each drawn suite has `robustness-<suite>.json` holding three disjoint, stratified
partitions: `dev`, `heldout-a` and `heldout-b`. The draw reads ids and ability labels
only and orders ids by `SHA-256("prism-202-memory-bench-<suite>:" + id)`. Every
ability, including abstention and preference, has items in both held-out partitions.
`heldout-b` exists only for the single remediation round after a Task 18 miss.
The diagnostic entry points refuse `heldout-a`/`heldout-b`, and `selectQuestions`
fails closed on an id the dataset does not contain.

LongMemEval-M keeps LongMemEval-S's question ids and ability labels and only extends
the haystack, so its draw is taken from the pinned S ids without downloading 2.7 GB.
When the M file is cached, `verifyLongMemEvalMItems` re-checks every id and ability
before a run. LongMemEval-S is development-only from now on.

Render a draw (reads only `id` and `ability`):

```sh
timeout 900 bun scripts/memory-bench/robustness-draw.mjs              # all downloadable suites
timeout 1800 bun test scripts/memory-bench/robustness.test.mjs        # frozen-draw and criteria checks
timeout 900 bun scripts/memory-bench/run.mjs --suite beam-100k --subset dev --config preset-r1 ...
```

A larger JSON array is read incrementally (`parseJsonArrayIncremental`), so
LongMemEval-M never goes through `JSON.parse` on the whole file. Parquet decoding
still needs benchmark-only `pyarrow==23.0.1` (`PRISM_MEMORY_BENCH_PYTHON`); the
buffer and timeout now cover the 1M/10M tracks.

## Measurement (plan 202 Task 3)

A scored live arm needs a judge panel, not one judge: `--judges <ref>,<ref>[,<ref>]`
with at least two **model families** (family is read from the model name, so two
resellers of one family do not count) and never the answer model. Verdicts are
combined by majority; a tie is incorrect. Every result keeps its per-judge verdicts
(`judgeVerdicts`), and `summarize` reports per-judge agreement and pairwise
Cohen's κ plus Fleiss' κ for three or more judges. `compareJudges(a, b)` reports the
paired arm difference under each judge separately (ids both arms and that judge
scored), so the panel's majority is never the only view.

Human calibration is a separate, local artifact. Build a balanced 150-item review
page, label it in a browser, then derive the audit:

```sh
timeout 600 bun scripts/memory-bench/audit/build.mjs --report <answer-phase report> --out .cache/memory-bench/audit/run1
# open review.html, label every item, download judge-audit-labels.json
timeout 600 bun scripts/memory-bench/audit/calibrate.mjs --report <scored report> --labels judge-audit-labels.json --output .cache/memory-bench/judge-audit.json
timeout 7200 bun scripts/memory-bench/run.mjs --suite beam-100k --subset dev --config fabric-x --judges hyper/qwen3.7-plus,opencode-go/mimo-v2.5 --judge-audit .cache/memory-bench/judge-audit.json ...
```

The review page and the answer cache hold text; the labels file holds ids and
verdicts only, `--judge-audit` drops every judge below κ 0.8, and fewer than two
remaining judges fails the run. The owner still has to label the 150 items; until
that audit exists, a live report records `judgeCalibration: null` and must not be
used for the BFC gate. The owner waived the human labels for plan 202 (2026-10-27):
baseline reports keep `judgeCalibration: null`, and any BFC claim is labelled
**not human-calibrated**. An optional third-model proxy may label the same 150 ids,
but it is not human κ.

### Development baseline (plan 202 Task 4)

**Muse Contributor continuation (owner decision 2026-10-29):** the owner authorized
`commandcode/meta/muse-spark-1.3-contributor` for Task 4. The separately frozen
`--readiness-v5` pilot uses the same ten development ids, 52 dispositions, judges,
8192-token output cap and eight-turn stop as v4. Existing v4 and broad Lightning
results remain intact. Run `PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python3
timeout 60 bun scripts/memory-bench/audit/pilot.mjs --readiness-v5 --freeze`, then
`PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python3 timeout 14400 bun
scripts/memory-bench/audit/pilot.mjs --readiness-v5 --answers-only`.
Answers are retained privately and the existing free panel scores those same
checkpoints with `--score-only`; no judge calls occur in the answer phase.
The completed v5 answers use the exact scoring scripts preserved at
`.cache/memory-bench/frozen-muse-v5`. After successful original-panel admission,
score from that directory with
`PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python3 timeout 14400 bun scripts/memory-bench/audit/pilot.mjs --readiness-v5 --score-only`.
Its shared SDK/product and copied harness must pass the original hashes; no
source-pin exception or answer regeneration is allowed. Keep this snapshot and
the original cache/journal intact while scoring is pending.
The declaration holds one reservation across phases, caps execution at four
active hours, allows 24 elapsed hours to cover the observed daily reset, and
retains the 300-call / 50M-input / 1M-output bounds. At the checked official rates
($0.10 input / $0.20 output / $0.002 cache-read per million), the uncached
input/output ceiling is $5.20; measured costs use reported cache usage.
This authorizes only the named paid answer route, with the existing free judges;
no other paid model or fallback is selected. Passing answer generation alone does
not establish broad readiness, scored baseline completion or a lever verdict.

**Task 4.8 readiness:** the authoritative verdict is
[`readiness.json`](../../docs/_evidence/memory-bench/202/readiness.json).
Recheck with `timeout 180 bun scripts/memory-bench/audit/readiness.mjs`.
The gate now requires a fresh accounted Muse pilot, successful authorized model/tool and
judge-control probes, unexpired operational evidence, source-matched green
checks, and a bounded frozen manifest. `campaign.mjs --baseline-202
--parallel-arms 1` loads that manifest and refuses missing/stale evidence.
It uses a separate journal, retains historical reservation debt, applies each
job's wall cap, and stops on unavailable quota without assuming a future reset.

The selected answer routes are paid Command Code `meta/muse-spark-1.3-contributor`, plus
OpenRouter `nvidia/nemotron-3.5-lightning:free` and
`nvidia/nemotron-3-ultra-550b-a55b:free`. Judges are OpenRouter Dots Note Preview
and Cohere North Mini Code, both `:free`. All arms use temperature zero, 8192
output tokens, provider-default reasoning and the unchanged eight-turn stop.
Injection-utility annotation calls are off for this development screen, matching
the pilot; source-id evidence attribution remains on. Task 18 keeps its own
frozen annotation requirement.
Only the named Muse route may be paid. Its `--bounded-wire` flag enforces the
same per-physical-request context/output reservations as free routes, retaining
unknown usage. `--free-only` still refuses unknown/paid routes for the other models, and
`--max-output-tokens 8192` pins the answer cap in run/checkpoint identity.
Muse uses Responses. The new `.cache/memory-bench/202-muse-baseline/journal.json`
carries the original campaign's spend once, plus the new pilot charge. Four
byte-pinned completed Lightning cells are retained without new reservations;
the interrupted lexical cell resumes its 25 saved results and charges only new
reported usage. Old report paths are never overwritten: new reports go under
`docs/_evidence/memory-bench/202/baseline/muse-campaign/`. Aggregation follows the
selected manifest and journal, excluding unrelated historical directory entries.
Retention verifies the original shared product/proxy identity, frozen draws,
grading/pairing rules, unchanged analysis function bodies/dependencies, generation,
input caps and report bytes. An orchestration hash change does not authorize
changing a statistical rule or reusing a different cell.
Beam
passes native tool follow-ups on Chat after the reasoning-replay fix, but still
rejects imported assistant history without nonempty reasoning traces; that
upstream limitation excludes it from this raw-history baseline. The local wire proxy disables Bun's ten-second idle cutoff; caller/run deadlines still apply. Wire accounting
reads Responses terminal usage and logs failed transports. Admission includes
in-flight allocations; unknown calls keep their full declared context/output
bounds rather than freeing budget from missing measurements.

Freeze a separate replacement pilot with `timeout 180 env
PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun
scripts/memory-bench/audit/pilot.mjs --readiness-v3 --freeze`, then run it with
`timeout 14500 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python
bun scripts/memory-bench/audit/pilot.mjs --readiness-v3 --answers-only`.
Score only those checkpoints with the same command and `--score-only` after
free admission is verified. Both phases retain one journal attempt/reservation;
scoring refuses missing answers and subtracts all prior calls, tokens and active
wall time. The v3 declaration is eight hours overall including the announced
quota wait and four active execution hours; the earlier four-hour attempts
remain unchanged.
Its 52 dispositions, 300-attempt / 50M-input / 1M-output / declared wall-time limits,
private checkpoints and free-only configuration are fixed before calls. No old
answer/score is reused. The original pilot's missing usage, reservation debt and
elapsed overrun remain historical deviations; no refund or retrospective pass.
All seven historical broad cells still require rerunning. Broad Task 4 stays
unchecked until the entire baseline and lever report finish. No BFC/Robust,
acceptance, small-model or default claim follows from these readiness checks.
The historical configuration and quota notes below are retained for provenance;
readiness supersedes their estimates and resume instructions.


Task 4.6 registers paired reporting and prospective sizing in
[`paired-analysis-sizing.md`](../../docs/_evidence/memory-bench/202/paired-analysis-sizing.md)
and its JSON companion. Reproduce it without provider calls:

```sh
timeout 60 bun scripts/memory-bench/paired-sizing.mjs
```

Baseline gaps join unique question ids and matching conversation clusters/abilities.
Missing, duplicate, unscored or mismatched pairs produce `incomplete`, with no gap;
operational failures retain their end-to-end zero. Reports show candidate minus
comparator, whole-conversation bootstrap 95% CIs, wins/losses, independent cluster
counts and Holm p-values across all emitted overall, ability-binary and
ability-graded tests in that summary. CIs are pointwise. Overlapping marginal CIs
are not a significance test. Equivalent complete-history comparator repeats are
still counted once. Missing provenance is labelled historical; mismatched pins
are refused. New checkpoint/reuse fingerprints include the analysis revision
and binary/graded template versions; manifests pin source hashes, frozen dataset
bytes/draws, normalization and context policy.

Task 4 is descriptive screening. Ordering and summarization use the registered
graded primary alongside binary secondary; oracle scores only bound the sizing
exercise and never enter product gaps or lever rankings. Their development draws
contain only 3 and 4 independent conversations. Even an ideal paired improvement
cannot reach two-sided .05 with the registered sign-flip analysis, so both are
**not lever-discriminating at this sample**. Do not silently use these zeros to
open or close a lever; retain descriptive scores and failure-stage evidence.

Task 18 retains binary scoring and the 3-point non-inferiority margin. Sizing
declares H0: candidate-comparator <= -.03, true difference 0, one-sided alpha .025
and target power .8. Its sensitivity grid varies discordance (.1/.25/.5) and
within-conversation paired-difference ICC (0/.5/1), using the frozen cluster
sizes rather than independent-arm `powerForDiff`. Every grid row is underpowered
at current supply; the claim stays unresolved. Repeats add no independent
histories. These are normal planning approximations, not acceptance verdicts;
small-cluster coverage and LongMemEval haystack cluster counts still need checking
before acceptance. BFC is a conjunction of required rows; selectable subset
claims require prospective multiplicity registration. Criteria and old evidence
stay frozen. Tasks 4.7 and 4.8 still control the pilot and broad resumption.

`campaign.mjs --plan 202-baseline --manifest` (or `baseline.mjs --manifest`) writes
the gate pack to `docs/_evidence/memory-bench/202/baseline/`: the owner gate text,
the pre-registered `criteriaHash`, product and harness hashes, 75 jobs (5 suites ×
3 models × 5 arms), per-job token reservations and per-suite wall-time caps. The
jobs are `preset-r1` (`fabric-x-tools`), `passive-only` (`fabric-x`), `full`,
`full-truncated` and `lexical-topk` on every `dev` partition.

Answerers are `opencode-go/beam-free` (200k context, free on the subscription),
`opencode-go/minimax-m3` (1M) and `opencode-go/mimo-v2.5` (1M); judges are
`opencode-go/qwen3.7-plus` and `opencode-go/kimi-k3` — two families, neither an
answer model, neither sharing a family with one, both plain-text. Everything runs
on the owner's OpenCode Go subscription, so the USD figure in the manifest is the
list-price equivalent, not a charge; a cross-provider claim is out of reach for
this grid and stays a Task 18 criterion.

**Why not the OpenRouter free models or Hyper.** They were in the gate pack of 2026-10-27 and
are not any more: the key hit `free-models-per-day-high-balance` (1000 free requests
per day, `x-ratelimit-remaining: 0`, reset 2026-10-29), so every arm failed at its
first answer with `MemoryBenchAnswerError:429`. The 2026-10-27 runs are archived
under `docs/_evidence/memory-bench/202/baseline-openrouter-2026-10-28/` and are not
evidence: they ran a different model set. Hyper ran out of credits mid-grid
(`402 Payment Required` on every answer and judge call), so
`docs/_evidence/memory-bench/202/baseline-hyper-exhausted-2026-10-28/` is archived
for the same reason.

**Tool names on the wire.** The fabric registers dotted tool names (`memory.recall`), which OpenAI
rejects as a function name; `createRoutedProvider` encodes them per request (`memory.recall` →
`memory_recall`) and decodes the model's call back, so a fabric arm runs on any Chat endpoint. A
dotted name failing with `400 invalid_value tools0.function.name` means a route is calling a codec
directly without the shared `toolNames` map.

**Gateway quotas are the real budget.** Hyper allows 1000 requests/hour and 10 000/day per judge
model, and the free answer pools are shared and rate-limited. The harness honors a gateway's
`retry_after_ms` hint (up to 8 attempts, then the cell fails) and the campaign's per-job attempt
limit is 8, because an earlier attempt may have been spent on a quota window rather than on the arm.
Full judging volume is 5 suites × 40 questions × 5 arms × 3 answer models × 2 judges = 6000 calls
(3000 per judge model), so at least three hours of wall time is quota-bound before any answer cost.
The harness also paces judge calls per model (`PRISM_MEMORY_BENCH_JUDGE_RATE`, default 450/hour) so a
burst cannot spend an hourly window on 429s instead of verdicts.

**A 4xx that names an input problem is not retried.** `campaign.mjs:permanentFailure` classifies
`context length`, `invalid_request`/`unsupported` and `model_not_found` as `failed-permanent`: the
attempt keeps its report and the journal records the cause (`context-exceeds-model`,
`unsupported-by-provider`, `model-unavailable`), and the job is never re-run. Quota (`429`) and
transport (5xx) failures stay retryable.

**Billing is subscription, not per token.** The manifest records token totals to
size plan quotas and `maxInputTokens` reservations; the USD figure is list-price
equivalent for comparison only. Wall time is capped per job (6 h BEAM-100K/LoCoMo,
6 h MemoryAgentBench, 48 h BEAM-1M, 144 h LongMemEval-M) and measured by the first
real write arm, never assumed zero.

After the arms finish, place each report as `report-<job-id>.json` beside the
manifest and run `baseline.mjs --aggregate`; it writes per-cell accuracy/CI/stage
counts, comparator gaps and the lever table. Only `fabric-x-tools` (preset-r1)
and `fabric-x` (passive-only) can open a product lever. The unchanged 5% rule
uses **all unique product failures within each suite × model × arm** as its
denominator, including run limits, transport/setup errors and unknown evidence.
Comparator failures never contribute. Each decision names that cell and reports
attribution coverage, unknown/operational counts and label provenance.

Outcomes take precedence over diagnoses: `run_limit`, `transport_setup_error`
and `comparator_ineligible` remain distinct from judged incorrect answers.
Validated source annotations and unresolved-reference counts accompany evidence
counts; heuristics and historical stage-only evidence are labelled separately.
Recall visibility is a heuristic for stage attribution: the answer path does not
measure a separate candidate ranking or prove that recalled text was used.
No source/gold/answer text enters the derived stage report. Diagnostics and
restaging refuse held-out partitions. Resume/reuse fingerprints include the
updated attribution measurement version, so old checkpoints cannot bypass it.

A stage identifies a candidate lever, never a promised recovery. Within-cell ids
are deduplicated; conflicting duplicate outcomes/diagnoses remain unknown.
`candidateFailures` counts unique suite/model/question combinations across
eligible arms; `failureOccurrences` and `sharedFailures` expose overlap. These
counts also overlap between levers and must not be summed as unique recoveries.
Unknown or missing stage measurements yield `insufficient-evidence`; a stage
that the classifier cannot measure stays `unmeasurable`. Neither closes a task.
The judge audit (150 human labels) is required before a BFC verdict.

The [Task 4.4 correction](../../docs/_evidence/memory-bench/202/failure-attribution.md)
recomputes saved outcomes and product-only counts offline. Historical labels
remain heuristic and cannot establish final corrected-protocol lever decisions;
original exploratory files and scores are preserved.

## Replay, accounting, and limits

### Paired development comparison manifest (plan 202 Task 5.2)

`timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest` freezes the
paired development comparison without making a provider call. It writes the
text-free [manifest](../../docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json)
and its readable summary, both pinned by `manifestHash`;
`assertTask5ComparisonManifest` refuses product/cohort drift, held-out ids or
content, and cells whose budgets or evidence protocol differ.

The treatment is the product only. One control cell per development suite runs
`preset-r1` (`fabric-x-tools`) from a revision-1 git worktree that carries the
unchanged current harness; the candidate cell runs the same harness on the
current product. Both roles share the frozen development question ids, the
repaired note-to-round mapping, one free answer model, two free plain-text
judges, `maxInputTokens`, 8192 output tokens, eight turns, serial concurrency and
wall caps. `--answers-dir` and `--judge-cache-dir` keep the roles' answer and
judge checkpoints separate, so a control answer can never be reused as the
candidate's; write-side snapshots are already keyed by product hash.

The candidate-gap numerator/denominator, the 50% halving rule, zero-gap baseline
handling, failure/missingness treatment, the 0.03 ability non-regression margin
and the paired cluster analysis are hashed into `criteriaHash` before any
outcome exists. Changing them after the freeze is refused, not re-scored.

`timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at <date>`
records the owner gate as [owner-gate.json](../../docs/_evidence/memory-bench/202/task5/owner-gate.json)
after re-auditing the frozen manifest. It binds `manifestHash`, the campaign
journal identity, the 10-cell scope and the caps; `assertTask5OwnerGate` refuses
an unapproved gate, a changed manifest/journal, a paid estimate or any route that
is not a free OpenRouter `:free` model. The owner restriction for Task 5 is free
OpenRouter products only, with no paid fallback. Task 5.4 executes only under a
passing gate.

`timeout 518400 bun scripts/memory-bench/campaign.mjs --task5` executes the
gated proposal. Do not narrow the cohort or swap models without a new manifest
and gate.

### Control r2: arms differ only in the product paths

The candidate is a commit, not the working tree. The control is a derived overlay
commit `r2`: the candidate tree with `TASK5_PRODUCT_PATHS` replaced by the bytes
from `TASK5_CONTROL_PRODUCT_SOURCE` (`5c2570df`, the closed screen's revision-1
commit). `task5ControlRevision(candidate)` builds it in a temporary git index with
fixed author/committer metadata, so the same inputs always produce the same sha;
`ensureTask5ControlRef` points `refs/heads/task5-control-r2` at it, and
`prepareTask5Control` checks out that sha, never a branch tip or a dirty tree.
The control product hash must still be `ad25add4…` and the fabric-only hash
`57aa47d9…`.

Fail-closed checks before any cell runs (`preflightTask5`):

- no uncommitted path outside `.cache/` (a dirty tree could enter the candidate arm);
- the working-tree product hash equals the pinned candidate commit's product hash;
- the overlay recomputes to the pinned control revision, and `git diff --name-only`
  between the arms lists only paths under `TASK5_PRODUCT_PATHS`;
- commits after the candidate pin touch only `docs/_evidence/memory-bench/202/task5/`
  or the plan; anything else requires a re-freeze and a new gate;
- the control worktree `HEAD` is the pinned r2, its harness is byte-identical to
  the frozen harness, and `bun test --concurrency=1 packages/memory/fabric
  packages/memory/core` plus `bun run typecheck` pass inside it.

The serial test flag is deliberate: those suites share temp state across files and
flake in parallel. Preflight is local only — it makes no provider call.

### Calls: a measured estimate, one shared free pacer, daily quota halts

The campaign's `expectedPhysicalCalls` is a measured rate, not the per-question turn
cap: the frozen `preset-r1` `beam-100k` report for the same free answer family records
3.175 solver and 2.25 judge calls per question (`labelInjections: "off"`, so no
injection-label calls), so 420 question-runs estimate 2,289 calls with a high end of
2,625 at the slower `beam-free` solver rate. The 16,800 hard cap does not move.

`:free` routes are one account-wide pool (20 requests/minute, 1,000/day once 10 credits
have been purchased), so the solver, the product's workers and both judges call a single
`createFreeRoutePace` instance (`state.pace` plus each judge's `pace`), never one pacer
per role. `PRISM_MEMORY_BENCH_FREE_PACE_PER_MINUTE` overrides the 20; a value above 20 is
refused. Paid routes keep the per-model `PRISM_MEMORY_BENCH_JUDGE_RATE` pacer.

A daily free-model 429 (`free-models-per-day*`) is classified by the diagnostic harness's
own `rateLimitDisposition`, so there is one 429 classifier in the tree. The campaign
writes the attempt as `quota-daily`, halts the journal with `status: "quota-daily"` and
`resumeAfter` (next UTC midnight, or `PRISM_MEMORY_BENCH_DAILY_RESET_HOUR_UTC`), and
returns without the 15-minute pause. That attempt does not count against the job's two
attempts: rerunning the same command resumes the cell from its answer and judge
checkpoints, so no completed answer is requested twice.

Preflight reads `GET https://openrouter.ai/api/v1/key`, records the reduced tier
(`paidTier`, `dailyFreeRequests`, remaining/used credits — never the key) to
`docs/_evidence/memory-bench/202/task5/free-key.json`, and refuses to start below the
1,000-requests/day tier.

## Replay, accounting, and limits

Source messages are linked session entries with stable source-derived ids, original role, source id,
and source-session timestamp. The final provider view prefixes retained source messages with their dates; worker input uses the shipped OM serializer. LongMemEval dates and LoCoMo dates without timezone
are interpreted as UTC. OM receives source messages incrementally in approximately
10k-token checkpoints and runs its shipped workers and compaction policy. An empty-input
run triggers the package's normal background hook; it makes no main model call
and appends no synthetic user instruction. The runner waits for each
worker before ingesting the next chunk. It never supplies gold answers during
replay. Each question has a fresh agent/session and memory state.

`full` qualifies as complete history only when the rendered request removes no
source messages. An oversized history produces an unscored `comparator_ineligible`
row before the answer provider call; it also skips judging in split answer/judge
runs. `full-truncated` explicitly drops oldest complete dialogue turns to fit.
Both use the same selection implementation, preserving system blocks and the
question. Reports record `comparatorContext` (effective input cap, safe model
configuration and policy) and per-question `contextEligibility` (message cap,
source/message removal counts, estimated tokens removed, completeness and a
context hash). The cap comes from the existing provider catalog and
`resolveInputCap`; output reservations stay in place, with another 1,024 tokens
plus rendered context blocks reserved before message selection. Character-based
estimates govern selection; they do not prove provider tokenization or delivery.
A provider context refusal remains an error, never evidence of complete delivery.
Baseline full-context gaps require proven completeness on every scored row and no
unscored/ineligible questions. Historical rows without this evidence are unproven.
When both arms render identical contexts for every question on the same model
configuration, the baseline marks `full-truncated` as `repeatOf: "full"` and omits
its independent comparator gap. This is a repeat, not a truncation treatment. Request and
response byte caps remain Prism's defaults. The benchmark owns a separate total
wire token ceiling, so the ordinary 40k-input/50k-total per-run policy caps are
disabled for this opt-in harness. Provider calls and multi-call background worker passes have ten-minute deadlines; the input-token ceiling remains the cost bound. The benchmark transport uses Prism’s existing transient-error retry policy with three attempts for all model calls, including workers. It also retries the observed empty SSE gateway error (`HTTP 400`, `event: error` / `data: {}`); ordinary validation errors are never retried. `calls.gatewayRetries` and wire exchanges include this overhead; memory-package logic stays unchanged.

A stream that ends without completion evidence is re-asked at most twice with
2s/10s backoff. Each re-ask forks the same pre-answer branch (or starts a fresh
session when the arm has no session history), so it never sees partial output;
a completed wrong answer is never retried. Arms with coding tools or any
mutating memory tool are not replayed at all. Judge verdicts get up to two
re-asks (1s/2s), each in a fresh one-shot session; malformed/truncated output is
retryable, while auth, permanent-request, usage/budget and run-limit failures
keep their original code and are never retried. `calls.judge` counts logical
judge requests and `calls.judgeAttempts` counts provider attempts. The report
protocol records retry limits and `maxTurns`; changing either is a new arm, not
a comparable old one.

An answer ending with `ERR_PRISM_RUN_LIMIT` is scored `correct: false, outcome: "run_limit"`;
the arm continues without retrying or judging that answer. The result keeps the bounded tool-name
trace (64 names, 80 characters each; no arguments), tool/recall counts and usage accounting.
JSON summaries include `runLimitRate` overall, per ability and per ability group; Markdown tables
show it per ability. Transport and other answer failures still fail the arm. The standard
`maxTurns` remains 8; raising it requires a separate arm.

Public-suite reports use `protocolVersion: 2`. Every arm submits question-only
user text with `metadata.sourceDate`; the harness stores new answer entries at
the question date, including retry branches. It renders `[<date>] <question>`
after fabric builds its passive query, so date-prefix terms never enter recall.
Named months and relative periods resolve against the question date. History
and causal cutoffs stay unchanged. The protocol fingerprint rejects v1
checkpoints; rerun those arms under v2 instead of resuming them.

**Default cost ceiling: 15,000,000 input tokens per suite × configuration**,
including memory workers and both answer and injection judging. Usage is read
from plan 182's loopback wire proxy, including cache-read tokens; raw exchanges
are never recorded. Billing fields are not inferred from character counts.
Live replay uses four independent question sessions at a time (offline uses one). Up to four requests already in flight can cross the ceiling; no following request starts,
and the runner writes a partial report with `status: token-ceiling`. Reports also
include output tokens and model/judge ids. A setup error or missing wire usage
fails the run, never becomes zero billing usage.

The manual `release/memory-bench` row always runs `full`, then `om`, `fabric`, and
`om+fabric`. Its maximum is 60M input tokens across four configs. To trigger it, manually dispatch `.github/workflows/live-matrix.yml`
with filter `release/memory-bench` and a selected `memory_suite`; scheduling cannot
start this job. Local equivalent:

```sh
PRISM_LIVE_MEMORY_BENCH_MANUAL=1 timeout 21000 bun scripts/memory-bench/live.mjs
```

### Fabric configurations (`fabric`, `fabric-hybrid`, `fabric-agentic`)

The `fabric` baseline arm (188.8 shape) ingests the haystack directly into a fresh per-question markdown store (in an OS scratch directory cleaned up after the question finishes), one `episode` note per dialogue round with the source date, session id, and round id; reports label that path `legacy-direct-ingest`. This matches LongMemEval's round-value evaluation design and avoids coupling retrieval evaluation to OM worker promotion:
- **`fabric`**: Lexical (BM25) retrieval over the markdown store. Answers with passive injection on (`inject: { query: "task" }`) and filters out `memory.*` tools from model requests. Ingestion makes zero model calls.
- **`fabric-hybrid`**: Hybrid (BM25 + vector reciprocal rank fusion) retrieval over the markdown store. Requires an embeddings model via `--embeddings <provider/model>` (fails at startup if missing). Ingestion batches embedding calls at 64 items per page; answering uses passive injection with no memory tools.
- **`fabric-agentic`**: Agentic retrieval with passive injection disabled (`inject: false`) and `memory.*` tools enabled, letting the agent search and recall memories dynamically within turn and token budgets.
- **`om+fabric`**: Runs OM background workers over the dated session history **and** ingests the same causal corpus into the disposable fabric store. Both channels see the same pre-question records; passive injection stays on.

### Product-ingestion arms (`fabric-x`, `fabric-xc`, `fabric-xc-agentic`)

These arms measure the write path the product actually ships instead of a direct upsert
(plan 188.9 Task 9, finding M5). Each causal haystack session becomes its own product
session: its messages are appended with their timestamps, the shipped `memory:archive`
command back-fills the session's completed exchanges, `memory:consolidate` runs for the
`xc` arms, and the session closes. The answer session is fresh: memory survives in the
per-question store, the transcript does not. Reports label the path `product-per-session`
(`ingestion`), and `--phase write` builds only the store:

```sh
# local write side: 140 development questions, no model call, no paid guard
timeout 1800 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset development \
  --config fabric-x --phase write --write-snapshot .cache/memory-bench/write/fabric-x \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 \
  --max-input-tokens 200000 --output .cache/memory-bench/fabric-x-write.json
```

- **`fabric-x`**: exchanges only, LLM-free write side, passive injection of `exchange` notes with Task 5's evidence-sized renderer.
- **`fabric-xc`**: the same exchanges plus consolidation, so the extractor turns archived exchanges into dated, keyed `fact` notes that link back to them; injection reads facts first, then exchanges.
- **`fabric-xc-agentic`**: the `fabric-xc` store, `inject: false`, `memory.*` tools on (recall then read).
- **`fabric-x-tools`** / **`fabric-xc-tools`**: the product's shipping shape (plan 188.10 Task 4) —
  passive injection on with the same kinds and defaults as the matching passive arm, and the
  `memory.*` tools left visible, so the agent can widen a selection the block disclosed as partial.
  Their write sides are the existing `fabric-x`/`fabric-xc` snapshots. Metrics record tool calls,
  recall calls, reads, writes and the run limit exactly as for agentic arms; the solver protocol is
  unchanged (`maxTurns` 8, output 4,096). A local (free) check that the arm is wired:
  `bun scripts/memory-bench/run.mjs --offline --config fabric-x-tools --max-input-tokens 200000`
  reports `fabric-tool` and `fabric-semantic` in `visibleChannels` (28 tool calls, 14 recalls and no
  write on the synthetic 14-question fixture).

The `xc` write side is the one paid write path: it makes exactly one extractor call per
haystack session (an empty pass costs nothing), so it runs as its own `writeSide` job in
the campaign and every read arm reuses its snapshot. Its extractor generation is a separate
knob from the answer's (plan 188.10 Task 5):

```sh
# budget the extractor only; answer and judge generation stay at 4,096
timeout 1800 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset development \
  --config fabric-xc --phase write --write-output-tokens 8192 --write-thinking low \
  --write-snapshot .cache/memory-bench/write/fabric-xc-8192 \
  --max-input-tokens 200000 --output .cache/memory-bench/fabric-xc-8192-write.json
```

- **`--write-output-tokens`** (256–32,768) sets `promote.maxOutputTokens` on arms that promote;
  `fabric-x` has no extractor, so it is ignored there rather than given one.
- **`--write-thinking`** (`none`…`max`) sets `promote.thinkingLevel`.
- The manifest records `writeGeneration` beside `generation`, and `writeSideKey`/`writeSideCacheDir`
  hash it: two extractor budgets never share a snapshot, while answer and judge comparability is
  untouched. The write side also reports `consolidationFailuresByReason`, `extractorCallsAtMaxOutput`
  and `extractorInputPerSession`, so a truncated or failing extractor is a number, not a reading of
  the notes. A read arm never re-ingests and
refuses to run without the snapshot (`--seed-snapshot`); snapshots also carry the
producer's exchange-note → round map, so evidence stages stay round-grained. Diagnose a
product store offline with `retrieval-diagnostics.mjs --store-from <snapshot dir>`, which
folds exchange hits back to their round and reports `storeSource: "product-snapshot"`.

## Metrics and comparability

LongMemEval judge templates are copied verbatim into `judge-prompts.json` from
[commit 9e0b455](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py)
under the accompanying MIT license. LoCoMo reports the same judge plus its
[upstream QA F1](https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/task_eval/evaluation.py):
Porter stemming, comma-separated sub-answer scoring for multi-hop, first-answer
selection for open-domain, and the upstream phrase-based adversarial metric. The LoCoMo agent is instructed to use the accepted “no information available” phrase when abstaining.
MAB uses normalized substring exact match against any alternative gold answer,
[upstream protocol](https://github.com/HUST-AI-HYZ/MemoryAgentBench/blob/538026089d1a8a8eff05121d0db89b388f360eba/utils/eval_other_utils.py).

Reports keep question ids, per-question scores, per-ability accuracy, token usage,
worker counts, truncation, and injection ids/labels. They exclude original text,
model answers and judge responses. The bench-only package captures memory from
`model.request`. In addition to QA accuracy, reports record retrieval diagnostics:
- **`toolCallsPerQuestion`**: Mean tool invocations per question (informative for `fabric-agentic`).
- **`recallCalls`**: Total memory recall operations across passive injection passes and agentic tool calls.
- **`retrievedSnippetTokens`**: Labeled character-derived token estimates (`ceil(chars/4)`) of memory snippets injected or returned by memory tools.
- **`retrievalRecallAtK`**: Fraction of questions with ground-truth evidence where at least one evidence round ID was present in recalled memory item IDs.

### Final paid acceptance (188.7)

The frozen acceptance manifest is `docs/_evidence/memory-bench/188.7/acceptance-manifest.json`;
it is dry-run only and records the owner-approved 106M input-token cap, the 140-question
confirmatory split (20 per ability, seed 1887, disjoint from the 70-question development set),
12 independent lifecycle personas and every required arm.

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance --manifest
timeout 43200 bun scripts/memory-bench/campaign.mjs --acceptance
timeout 300 bun scripts/memory-bench/acceptance-report.mjs
```

The 2026-10-22 run stopped **incomplete** at 80,067,335 charged tokens: 6 of 56 required jobs
completed, and the missing `om`, `om+fabric`, `fabric-agentic`, full LoCoMo and 12-persona
lifecycle safety arms prevent an acceptance or default-enablement claim. See
`docs/_evidence/memory-bench/188.7/README.md`.

Every attempt reserves its cap plus one-question overshoot in
`docs/_evidence/memory-bench/188.7/spend-journal.json` before the child starts. A crashed or
killed attempt keeps its reservation until its own report reconciles it; prior phase spend is kept
as `priorReservation` rather than refunded by renaming. The acceptance runner allows one extra
whole-arm attempt for acceptance because a harness-only ingestion fix can invalidate an unfinished
arm; that exception is journaled and budgeted, not an open retry loop. No pre-fix fabric arm is
claimed: the fix history is uncommitted, so the outcome matrix marks that question unresolved.

Retrieval failures can be attributed without publishing text:

```sh
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs \
  --failed-report docs/_evidence/memory-bench/task6/v2-rerun-longmemeval-s-fabric.json \
  --output docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json
```

The report replays the lexical fabric through the real package and records ids, ranks, counts and
one stage per selected question: `correct` for a correct answer, `candidate_gap` (no labelled answer-session round in the candidate
pool), `selection_gap` (candidate exists but the passive budget/topK shows none), `fine_selection_gap`
(the answer session is shown but none of its labelled message rounds is), `partial_evidence` (some
but not all labelled message rounds are visible), `answer_gap` (every labelled round is visible and
the answer is still wrong), or `gold_unknown` (no usable gold). Corrected 2026-10-23: before
`partial_evidence` existed, one visible round among several was reported as `answer_gap`, which
overstated synthesis failures. Gold stays offline; queries and reports never carry
source text. The generated [retrieval diagnostics](../../docs/_evidence/memory-bench/188.7/retrieval-diagnostics.json)
show 21 `answer_gap`, 13 `fine_selection_gap` and 13 `selection_gap` of 47 failed fabric questions;
the old 70-question arm stays diagnostic/development evidence.

### Development and held-out v2 (188.8)

The post-acceptance diagnosis used gold labels from all 140 `confirmatory.json` ids;
for 188.8 these are **development** data (`--subset development`, or the frozen
`confirmatory` name). The original ids and 188.7 results stay unchanged.
`heldout-v2.json` freezes 100 unused LongMemEval-S ids: 20 each for knowledge-update,
multi-session, temporal-reasoning, single-session-user and single-session-assistant.
`drawHeldoutV2` sorts SHA-256(`prism-188.8-memory-bench-v2:` + id), excludes every
base, confirmatory and targeted id, and refuses a short or duplicated stratum.
The draw uses only cached pinned id/ability metadata. Preference and abstention
have no unused ids and remain development-only non-regression checks.

```sh
timeout 1800 bun scripts/memory-bench/retrieval-diagnostics.mjs \
  --suite longmemeval-s --subset development \
  --failed-report docs/_evidence/memory-bench/188.7/final-accept-lme-fabric.json \
  --output docs/_evidence/memory-bench/188.8/delivery-diagnostics-dev-after.json
```

Despite its historical name, `--failed-report` now annotates correctness for the
**whole selected partition**, including correct answers. The offline diagnostic
requires the pinned dataset in cache and makes no provider calls or downloads.
It records query term counts and non-question share, every fine evidence round's
one-based rank (`null` outside the 32 candidates), all-needed@1/3/5/10/20,
all-needed-visible and answer-message-visible. Visibility requires the complete
trimmed text of at least one `has_answer` message in a rendered line; comparison
uses offsets in memory and only the Boolean is published. `allNeeded` requires
nonempty fine evidence. Dataset `has_answer` flags are retained even on abstention;
these are visibility diagnostics, not answer scores.

The v2 shipped-query measure uses question-only text, `recallPeriod` referenced
to each question date, and the 0.35 coverage floor. The committed pre-fix v1
baseline retains its frozen wall-clock reference `2026-10-22T00:00:00.000Z`
and date-prefixed query; rerunning the command above produces v2 evidence. Injection
visibility comes from the product's own rendering decision (`fitInjection` in
`packages/memory/fabric/src/excerpt.ts`), not a copy: whole notes by rank until the
budget runs out, a skipped note rather than a truncated one, the best hit excerpted
only when it alone exceeds the budget, and time-ordered delivery. Diagnosis uses the
shipped defaults (plan 188.9 Task 5: `budgetTokens 4000`, `topK 12`,
`minSimilarity 0.2`), so a diagnostic cell describes what an opted-in host receives. A
regression compares its ids and rendered lines with the real `createFabricContext`
output. Gold never enters a
query. Two separate date-free ranking ablations retain and remove the coverage
floor: the investigation's original ranking table used **no floor**. Its counts
must not be mistaken for what the shipped floor delivers. The committed
[development baseline](../../docs/_evidence/memory-bench/188.8/delivery-diagnostics-dev-before.json)
contains only ids, counts, ranks, Booleans and protocol/hash metadata.

The diagnostic also accepts `--subset heldout-v2` for later retrieval-only checks;
no held-out diagnostic was run to select these fixes. It refuses `--subset heldout-v3`:
a diagnostic reads gold evidence, and the live held-out draw must stay unread until the
paid campaign finishes. Paid runner/manifest support belongs to 188.8 Task 5. Task 3's evidence is the
[after-renderer report](../../docs/_evidence/memory-bench/188.8/delivery-diagnostics-dev-after.json),
its [whole-note protocol-v2 control](../../docs/_evidence/memory-bench/188.8/delivery-diagnostics-dev-protocol-v2.json)
and the [rejected equal-share excerpt run](../../docs/_evidence/memory-bench/188.8/delivery-diagnostics-dev-rejected-equal-share.json).

Token allocations use `ceil(characters/4)`; they are labeled estimates and separate from billing.
`used`/`irrelevant` labels are judge decisions, not causal evidence. Cited-id rates require the later citation
instructions and metadata; absence is not proof the model ignored a memory.

### Held-out v3 and the multi-session development screen (188.10)

`heldout-v3.json` is the live held-out draw for 188.10: 100 LongMemEval-S ids — 40
multi-session, 20 knowledge-update, 20 temporal-reasoning, 14 single-session-user and 6
single-session-assistant — sorted by SHA-256(`prism-188.10-memory-bench-v3:` + id) and
excluded from base, targeted, confirmatory and held-out v2. The file records the dataset
SHA-256, the ids hash, a hash of the manifest itself (minus that hash) and the residual pool
each stratum was drawn from (71 / 22 / 77 / 14 / 6), so an exhausted stratum is visible
before a spend. Preference and abstention have no unused ids. `drawHeldoutV3` reads `id` and
`ability` only and refuses a short or duplicated stratum; a diagnostic, a ceiling scan or a
screen never runs on it.

`screen-ms-v1.json` is development data and gates that spend: all 20 held-out v2
multi-session ids (their labels were read after 188.9), 10 more multi-session ids drawn by
SHA-256(`prism-188.10-memory-bench-screen-ms-v1:` + id) from the 30-id development pool, and
screen-v1's 30 non-multi-session ids — 60 ids, five per ability outside multi-session. A job
naming a held-out draw (`heldout-v2`, `heldout-v3`) is refused by the screen profile.

```sh
timeout 1800 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset screen-ms-v1 \
  --config fabric-x --phase all --label-injections off \
  --provider opencode-go --model <id> --judge opencode-go/<id> \
  --max-input-tokens 3000000 --output .cache/memory-bench/screen-ms-v1.json
```

### Multi-session diagnostic (188.10)

`retrieval-diagnostics.mjs --multi-session --store-from <snapshot>` reads one product store per
multi-session id and reports, per needed fine round, its 1-based rank in the uncapped
question-only lexical ranking and whether it is `lexicallyReachable` (shares at least one stemmed
non-stopword term with the question); per question, the rounds and sessions spanned, all-needed
within the top 10, 20 and uncapped, and shipped passive coverage; and stage counts with
`partial_evidence`. That separates the three levers: unreachable needs write-time category terms,
reachable-but-ranked-late needs read-time phrasings, and a needed round whose only linked fact is
superseded or retired needs instance-safe keys. The fact view reads note metadata only (relations,
status, `supersedes`), so it is reported whenever the store holds facts; `fabric-x` stores
exchanges only and correctly reports zeros for it. It refuses `heldout-v3`, requires `--store-from`,
and fails closed on a missing snapshot. Ids, ranks, counts and booleans only: no question, gold,
round or note text.

```sh
# local, free: fabric-x makes no model call, so this needs no paid-attempt guard
timeout 900 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset screen-ms-v1 \
  --config fabric-x --phase write --write-snapshot .cache/memory-bench/write/188.10-fabric-x-screen-ms-v1 \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 \
  --max-input-tokens 200000 --output .cache/memory-bench/188.10/write-x.json
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset screen-ms-v1 --multi-session \
  --store-from .cache/memory-bench/write/188.10-fabric-x-screen-ms-v1 \
  --output docs/_evidence/memory-bench/188.10/ms-diagnostics-x.json
```

### Paid held-out acceptance (188.8)

Task 5's campaign measures the plan's product changes against a held-out draw, not the diagnosed
development ids. The manifest freezes five arms, the 30M owner-approved ceiling for this campaign
only, protocol version 2, the 100 held-out ids, both product source hashes and the shared harness
hash:

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.8 --manifest   # spends nothing
timeout 50000 bun scripts/memory-bench/campaign.mjs --acceptance-188.8
timeout 300 bun scripts/memory-bench/acceptance-report.mjs --plan 188.8
```

Arms: pre-fix `fabric` (an isolated worktree at the plan's start commit carrying the post-fix
harness only, so the product is the treatment), post-fix `fabric`, post-fix `fabric-agentic`, a
`full` reference, and a development `fabric` non-regression arm for preference and abstention.
`prefixArmAudit` hashes the worktree's harness and product before any spend and refuses a run whose
harness differs or whose product is identical to the treatment. The child's journal path and output
are absolute, so a worktree child reads and writes this repo's journal and evidence.

The report answers two separate questions and never merges them: the predeclared primary family is
post-fix versus pre-fix `fabric` on knowledge-update, multi-session, temporal-reasoning and
single-session-user (Holm across four), and the substitution question is each fabric arm against
`full` under a 3-point non-inferiority margin. `statisticallyPowered` gates quality verdicts on
paired clusters and simulated power; `confirmatory` also demands complete wire-usage accounting, so
an arm with one usage-less exchange can still support a quality verdict while `costClaim` stays
false. The F13 vocabulary in `findings.json` follows the substitution verdict only: an improvement
alone never marks a finding fixed.

The 2026-10-23 run completed all five arms. Post-fix `fabric` scored 47/100 against pre-fix 46/100
(overall +0.01, 95% CI [-0.05, 0.07], Holm p 1.0; no primary ability changed), `fabric-agentic`
38/100 with an 18% eight-turn run-limit rate, `full` 79/100, and development `fabric` 65/140 with
preference 5/20 and abstention 17/20. Post-fix fabric is -0.32 against full context, so the verdict
is an unresolved F13, not a substitution. See
[the evidence README](../../docs/_evidence/memory-bench/188.8/README.md) and
`acceptance-comparisons.json`.

A per-question product error (for example a round above the core 64,384-character entry limit) is
now scored as a wrong answer with `outcome: "error"`, `errorCode` and `errorRate`, and the arm
continues; a provider failure carrying a cause still ends the arm, and more than `max(3, 5%)`
errored questions fails it. A run whose child writes no report at all stops the campaign rather than
charging every remaining arm's reservation.

Delivery stages are measured per arm with the renderer that arm shipped: `--renderer whole` mirrors
the pre-fix rule from `1400917`'s `context.ts`, and `--renderer excerpt` uses the product's
`fitInjection`. A question whose rounds cannot be stored is reported as `store_error` with no
visibility instead of aborting the diagnostic.

`acceptance-report.mjs --plan 188.8` re-derives per-arm stage counts with the current classifier
(it never repeats a stage a committed diagnostic recorded under an older one) and emits a
conditional-accuracy table: accuracy when every labelled message round is visible versus when it is
not. That table is the delivery-versus-synthesis split; the same numbers are in
[`docs/_evidence/memory-bench/188.9/stage-correction-188.8.json`](../../docs/_evidence/memory-bench/188.9/stage-correction-188.8.json),
which re-buckets the committed 188.8 diagnostics from stored ids and flags only.

### Re-bucketing a committed diagnostic (no recall, no spend)

```sh
timeout 60 bun scripts/memory-bench/retrieval-diagnostics.mjs \
  --restage docs/_evidence/memory-bench/188.8/delivery-diagnostics-heldout-postfix.json \
  --output docs/_evidence/memory-bench/188.9/stage-correction-188.8.json
```

`--restage` takes a comma-separated list and writes one entry per source. Every stage is recomputed
with `stageFromCounts` from the stored counts, so a classifier change never needs a re-run. Only ids,
stages, counts and flags are written.

### Delivery ceiling grid (development only)

```sh
timeout 3600 bun scripts/memory-bench/retrieval-diagnostics.mjs \
  --suite longmemeval-s --subset development --ceiling \
  --output docs/_evidence/memory-bench/188.9/ceiling-development.json
```

`--ceiling` refuses any subset other than `development` (and `confirmatory`, its frozen alias) with
`MemoryBenchDatasetError`, before any dataset read, so no cell can be chosen on held-out evidence.
The grid is frozen in `CEILING_GRID`: `budgetTokens` 600/1500/2000/3000/4000/6000, `topK`
3/6/8/12/16, `minSimilarity` 0/0.2/0.35, renderer `excerpt`/`whole` — 180 cells. One ingestion per
question and one recall per similarity floor feed every cell (three recalls per question), which is
why 140 development questions finish in under a minute. Each cell reports all-needed-visible,
answer-message-visible, mean and p95 injected tokens, and mean injected tokens on the abstention
stratum, plus per-ability medians.

The report also carries two reproduction blocks with explicit definitions, because the original
ceiling probe was never committed:

- `evidenceBudget`: all needed rounds inside the top-32 candidate ranking (floor 0.35) and the
  whole-note tokens of ranks 1..deepest needed round at most the budget. Medians and per-budget
  counts per ability.
- `candidateCoverage`: every needed round inside the top-32 candidate ranking, per similarity floor.
  This reproduces investigation M3 exactly (multi-session 6 vs 10, temporal 9 vs 14, preference
  8 vs 18, knowledge-update 17 vs 19 at floor 0.35 vs 0).

## Fast experimentation (188.9 Task 3)

Speed comes from three independent things: questions run in parallel, an answer is judged in a
separate phase, and an identical verdict is never paid for twice. None of them changes what a paid
acceptance arm measures — the protocol hash, the journal reservation and the judge prompt are the
same as before.

```sh
# Answer phase: solver only, no judge call. Writes the arm's checkpoint plus an answer cache.
timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset development --config fabric \
  --concurrency 8 --phase answer --output .cache/memory-bench/screen/fabric.json

# Judge phase: scores that checkpoint, at its own concurrency, spending against the same attempt.
timeout 3600 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset development --config fabric \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 \
  --phase judge --resume .cache/memory-bench/screen/fabric.json --concurrency 16
```

`--phase all` (the default) is the old behaviour: replay, judge and label per question. The judge
phase needs `--resume`, because it scores that checkpoint and nothing else; it refuses a row with no
cached answer text instead of silently re-running the solver. `--phase answer` ends with status
`answers` and every row `outcome: "answered"`, no `correct` field, and an `answerKey`; `summarize`
divides accuracy by scored rows, so an answer-only checkpoint reports `accuracy: null` rather than 0.
Coding suites grade with executable tests and only support `--phase all`.

`--concurrency 1-32` (default 4, offline 1) bounds the question pool. A `429`, `503` or `529` from a
provider halves the arm's active ceiling (never below 1) and increments
`calls.concurrencyHalvings`; `timing.concurrency` records `{initial, active, floor}` so a report says
which ceiling it actually ran at. Passing `--concurrency` with `--offline` is a harness-timing aid
only: the mock shares one state object, so parallel offline questions are not a scored configuration.

`--label-injections off` skips the per-item injection labels — one judge call per injected item — and
records `injectionPrecision: null` with `injectionPrecisionReason: "not-labelled"`. It is refused for
any job in an acceptance manifest (`campaign.mjs` throws before reserving), because precision is part
of that evidence. With labels on, a question's items are labelled in parallel up to the arm's
concurrency.

Caches live under `.cache/` (gitignored) with mode `0600`:

- `.cache/memory-bench/answers/<sha256(protocolHash, questionId)>.json` holds the answer text and the
  injection texts a later judge phase needs. Evidence keeps only `answerKey`.
- `.cache/memory-bench/judge/<sha256(templateVersion, judge, generation, suite, ability, questionId,
  answerText)>.json` holds the verdict. A hit makes no provider call and counts in
  `calls.judgeCacheHits`; a changed template, judge model, generation or answer is a miss. The
  template version is a hash of `judge-prompts.json`, so editing a prompt invalidates every verdict.

Every report carries campaign `timing.wallMs`, end-to-end `questions.wallMs`, concurrency,
per-call `roles`, and per-question `phaseTiming` with independently measured phase summaries:

- `ingestion`: cold setup and history ingestion, including extraction/OM workers. A seeded store
  records `restore` instead; its original ingestion time and cost are not remeasured.
- `answer`: after ingestion, immediately before the question run, through the final answer,
  including tools, transport retries, rate-limit backoff and answer retries. Final background
  settlement, disposal, scoring and injection labels happen after this interval.
- `evaluation`: post-answer grading and injection annotation, including judge pacing and retries.
  Annotation is enabled by default and makes one additional judge call per injected item;
  `--label-injections off` disables it. A judge-cache hit makes no grading call.

Each phase publishes its own **p50, p95 and mean** in milliseconds, with a sample count. No
percentile is subtracted from another. Pool queue wait is excluded; concurrency and the judge
calls/hour setting are recorded in `measurementPolicy`. Split judging keeps the saved ingestion
and answer timings. Historical reports without phase measurements show `n/a`, never a relabelled
wall-time estimate. The new measurement version invalidates older resume/reuse fingerprints.

Live product and evaluation traffic use isolated wire logs, including when they share a provider
or model. `roleUsage` reconciles product + evaluation + unknown historical usage to campaign token
and exchange totals. The existing token ceiling and journal still consume **all** traffic. Each
route uses its own model price; missing rates or successful exchanges missing usage produce an
unknown cost. Mixed-model product routes without wire model identity remain unpriced.

Product cost reports measured billing, cold input repriced at uncached rates, and warm
cache-adjusted billing. The warm `full` simulation prices all input as cache reads (a favourable
cached-prefix assumption); other arms use reported cache reads/writes. `inputCold`/`inputWarm`
exclude output for the registered input-cost-per-question criterion. Evaluation cost and total
campaign cost remain visible separately. Seeded read runs exclude their separately executed
write-side cost and cannot establish a cost pass alone. Zero subscription prices remain zero USD,
but a zero or unknown comparator denominator cannot establish a relative cost pass.

Baseline evidence labels answer p50/p95/mean separately from ingestion and evaluation. Its
registered measurement comparison consumes matched product input cost per question and answer
p95 only, under the criteria file's thresholds; historical, incomplete-usage or ineligible full
comparators cannot supply a pass. Timing and role accounting carry counts, durations and billing
numbers only; prompt, question, answer and credential text stays out.

## Paid campaign cycle (188.9 Task 4)

The order is: an offline diagnostic, then a paid screen on development ids, then held-out
acceptance. Each step costs less than the next and none of them re-measures the same thing twice.

```sh
# 0. Free: the deterministic replay suite (one process, mock provider).
timeout 600 bun test --timeout=0 scripts/memory-bench

# 1. Paid screen: the frozen 35-id development draw, 5 per LongMemEval ability.
timeout 5400 bun scripts/memory-bench/campaign.mjs --screen --parallel-arms 3

# 2. Held-out acceptance: a manifest whose jobs name their evidence and their write side.
timeout 7200 bun scripts/memory-bench/campaign.mjs --acceptance-188.9 --parallel-arms 2
```

Wall time is proportional to `questions × calls / concurrency`, and every report states its own
`timing.wallMs`, per-question p50/p95 and per-role latency, so plan the next arm from measurement
rather than a constant in this file. The 35-id screen at concurrency 8 with three parallel arms is
the cheapest paid step; a held-out acceptance arm is the most expensive and runs last.

`--parallel-arms <1-8>` (default 1) runs that many arms at once. Each arm still reserves
`cap + 500k` in the journal *before* its child starts, so the ceiling holds even when every running
arm hits its cap, and a blocked reservation stops new launches while the running arms finish and
reconcile. A failed arm never cancels a sibling's accounting: the sibling reconciles its own
reservation, and the summary names both. Ctrl-C still kills every owned child.

`--screen` applies one profile to every job: `--subset screen-v1 --phase all
--label-injections off --concurrency 8`. The draw is frozen in `screen-v1.json`
(`sha256("prism-188.9-memory-bench-screen-v1:" + id)`, ascending, 5 per ability) and is taken from
the development pool, so it can never contain a held-out id. The profile is refused for a held-out
subset, for any non-LongMemEval suite, and for any acceptance manifest.

### Reuse

A job may declare `reuse: { from: "<evidence report>", fallback: "run" | "refuse" }`. The child
computes `runPathFingerprint` — `sha256` over the arm's id set, `inputCap`, generation, provider,
model, judge, judge protocol, the judge prompt template hash, dataset, seed, ablations, memory
config, protocol block, and content hashes of `replay.mjs`, `judge.mjs`, `judge-prompts.json` and
`datasets.mjs` — and compares it to the source report's own `runPathFingerprint`. `sourceRevision`
is deliberately not used: a whole-repo git HEAD necessarily differs between plans, which would
refuse every legitimate reuse or prove nothing.

When the fingerprint matches, the source report is `completed` with complete usage and the same ids,
the run copies its verdict rows into this arm's results marked `reused: true` and spends nothing
(`inputTokens: 0`, no provider call). Any mismatch throws `MemoryBenchReuseMismatch`; with
`fallback: "run"` the arm records `reuseRefusal` and runs normally instead. A partial checkpoint is
never reused, and reuse requires the local model catalog, so credentials must still be present.

### Write-side cache

Ingesting a 500-round haystack is the expensive half of a fabric arm and depends on nothing the
answer phase produces. A read-side job may therefore name a producer:

```json
{ "id": "accept-fabric", "writeSide": "accept-fabric-write" },
{ "id": "accept-fabric-write", "config": "fabric-agentic" }
```

The producer runs with `--write-snapshot` and stores each question's fabric store at
`.cache/memory-bench/write/<key>/<questionId>/`. The key is
`sha256(dataset ‖ product write-path source hash ‖ extractor model and generation ‖ consolidation
prompt template hash ‖ harness ingest hash)`, so a product, prompt, model or dataset change is a
miss. Read-side arms run with `--seed-snapshot`, copy the stored tree into their temp root and skip
ingestion; the pool always runs producers first. A missing snapshot fails the arm closed
(`MemoryBenchWriteSideMissing`) — it is never re-written silently — and a read-side arm never
starts unless its producer's attempt is `completed` and the cache directory is non-empty.
Snapshots hold the disposable benchmark store only; no credentials, and the same `.cache/` gitignore
and `0600` rules as the other caches.

## Development screen (plan 188.9 Task 10)

The screen is the pre-registered development gate before any held-out spend. It runs only
the frozen 35-id `screen-v1` draw (5 ids per LongMemEval ability, taken from the development
pool; a held-out id is refused), never tunes a parameter, and can only drop an arm.

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.9-probe --manifest
set -a; . ~/.config/prism/live.env; set +a
timeout 2400 bun scripts/memory-bench/campaign.mjs --acceptance-188.9-probe --parallel-arms 1
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.9-screen --manifest
timeout 14400 bun scripts/memory-bench/campaign.mjs --acceptance-188.9-screen --parallel-arms 1
```

- **Probe first.** Four passive-baseline jobs on 8 screen ids at question concurrency 4, 8,
  16 and 24, run one at a time. Each records per-question p50/p95 wall time and the number
  of provider overloads (`calls.overloads` counts every 429/503/529, not just gate halvings).
  `chooseConcurrency` picks the highest step with zero overloads and a p95 under 1.5x the
  step-4 p95; a step that did not finish is ignored. The probe's own reservation is a pool,
  not a spend target: the journal charges 250k for every request in flight, so a 24-question
  step reserves 13M even though it spends a few tens of thousands.
- **The screen.** `fabric` baseline, `fabric-x`, `fabric-xc` and `fabric-xc-agentic` on the
  35 ids, with injection labels off, plus two `writeSide` producers: `fabric-x` (local, free)
  and `fabric-xc` (the one paid write path). The agentic arm reuses the `fabric-xc` snapshot.
  Snapshots are cached under `.cache/memory-bench/write/<key>`, keyed by config as well as
  product/extractor/ingest hashes, and a read arm refuses to run without its producer's snapshot.
- **Held-out arms are declared, not skipped.** The 188.9 screen holds `fabric-xc` (and so its
  agentic reader) out of the verdict until its write-side cost is measured; the verdict marks those
  arms `missing` instead of scoring them as failures. A measured write side (1 development question,
  51 sessions, concurrency 1) came to 1.26 extractor calls and 8,185 input tokens per session, with
  half the sessions failing consolidation at the 4,096-token output cap.
- **The baseline arm pins 188.8's delivery by variant.** `fabric.delivery=188.8` sets the passive
  injection defaults back to 600 tokens / top 3 / similarity 0.35 and restores 188.8's whole-note
  renderer, so a screen or acceptance baseline on the current tree reproduces 188.8 post-fix rather
  than the 4,000-token delivery 188.9 Task 5 shipped. The shipped-delivery arm runs beside it as
  `baseline-new-delivery`, descriptive only.
- **Verdict.** The campaign writes `verdict.json` itself from the manifest's rule: `fabric-x`
  and `fabric-xc` proceed when they gain at least 3 of 35 questions over the baseline and no
  ability loses more than 1; `fabric-xc-agentic` proceeds when its run-limit rate is at most
  5%. Evidence holds ids, counts, tokens, timings and reasons only.

## Gate 1 and Stage A (plan 188.10 Task 7)

The cheapest plausible lever first: passive injection *plus* the read tools, on the same exchange
store, against the pre-registered development target `T_dev`. Gate 1's owner-approved cap covers this
screen, the iteration allowance and Task 9 on the Stage A path; while `GATE_1_APPROVAL` in
`acceptance.mjs` still says "pending owner approval", `--manifest` and the campaign both refuse, so
no paid call can run on an unapproved cap.

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.10-screen-a --manifest
set -a; . ~/.config/prism/live.env; set +a
timeout 7200 bun scripts/memory-bench/campaign.mjs --acceptance-188.10-screen-a --parallel-arms 1
```

- **Draw and arms.** The frozen 60-id `screen-ms-v1` development draw (30 multi-session ids + 5 per
  other ability), labels off, concurrency 4 from 188.9's probe. `fabric-x` is the reference with its
  local LLM-free write side; `fabric-x-tools` reuses that snapshot with `memory.*` visible next to
  passive injection, so the two arms differ only in tool visibility.
- **`T_dev`, pre-registered in the manifest.** Multi-session at least 18/30, every other ability down
  at most one question against `fabric-x`, run-limit rate at most 5%. An arm that answered fewer than
  30 multi-session questions cannot claim the absolute target.
- **Verdict by campaign.** `writeScreenAVerdict` applies `T_dev` to the two reports and writes
  `screen-a/verdict.json`: `selected` names the tools arm when it met the target, and `next` is
  `{ skipStageB: true, heldoutArm }` — otherwise `"stage-b"`. Nothing here can tune a parameter.
- **Diagnostics.** Task 3's `--multi-session` diagnostic runs over the reference snapshot into
  `screen-a/ms-diagnostics-x.json` (ids, ranks, counts, stages only), so a Stage B iteration starts
  from measured failure stages rather than a guess.

Measured (2026-10-23, gate 1): the writer took 40 s and charged 0, `fabric-x` scored 28/60 with
239,050 input tokens, `fabric-x-tools` 50/60 with 1,399,977 — 1,639,027 in total against the 8M
ceiling and ≈ 19 min against the 60-min limit. Multi-session went 8/30 → 22/30 and no ability lost a
question, so `T_dev` was met: `verdict.json` selects `x-tools`, Stage B is skipped, and the residual
failures are `partial_evidence` 17 with 3 lexically unreachable rounds. The gate-1 cap, the target and
the two arms are frozen in `docs/_evidence/memory-bench/188.10/screen-a/screen-a-manifest.json`.

## Live held-out acceptance (plan 188.10 Task 9)

One paid run of Stage A's selected configuration on ids nobody had read. The manifest is built from
`screen-a/verdict.json` and refused when the product hash differs from Stage A's, so the run is the
screened configuration or it does not happen.

```sh
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.10 --manifest
set -a; . ~/.config/prism/live.env; set +a
timeout 14400 bun scripts/memory-bench/campaign.mjs --acceptance-188.10
timeout 300 bun scripts/memory-bench/acceptance-report.mjs --plan 188.10
```

- **Arms.** `write-x` (local, LLM-free exchange snapshot over the 100 held-out v3 ids), `x`
  (`fabric-x`, the passive reference, reading that snapshot), `x-tools` (`fabric-x-tools`, the
  selected arm on the same snapshot) and `full` (whole history, run fresh — no v3 reference exists).
  Labels are on, because injection precision is part of a held-out report.
- **Pre-registered criteria, held in the manifest as data.** Multi-session ≥ 24/40; a paired
  multi-session improvement over `fabric-x` with a 95% CI lower bound above 0; non-regression (net
  loss ≤ 2 for knowledge-update and temporal-reasoning, ≤ 1 for single-session-user and
  single-session-assistant) and an overall paired difference ≥ 0. `acceptance18810Verdict` applies
  exactly these, and `--plan 188.10` writes the verdict with the comparisons.
- **Caps are reservation pools, not spend targets.** The kernel reserves 250,000 tokens per request
  in flight, and a labelled question holds an answer plus its label and judge calls. Size a cap for
  that headroom: at concurrency 4 a 1M passive cap died after 4 questions and a 5M tools cap after
  79. The accepted manifest uses 3M (`x`, concurrency 2), 9M (`x-tools`) and 14M (`full`).
- **Resume.** A completed attempt is reused, so a failed arm can be rerun alone. Changing only a
  job's `concurrency` keeps the journal's manifest fingerprint and resumes; changing a cap or the
  ceiling does not, and the old journal is archived beside the new one (Task 7's rule).

Measured (2026-10-23, gate 1): `x` 49/100 (637,815 tokens), `x-tools` **76/100** (2,966,891, 152 tool
calls), `full` 69/100 (11,295,518). Multi-session 10 → 28 of 40 with a paired +0.45 (CI 0.275..0.625),
no ability regressed, and the selected arm is +0.07 over full context (CI -0.03..0.17): a
full-context substitute at 26% of the tokens. Gate 1 total 23,216,343 of 34,000,000.

## Statistics

```sh
timeout 30 bun scripts/memory-bench/report.mjs --compare baseline.json candidate.json
# One ablation family: every candidate versus baseline, across all abilities.
timeout 30 bun scripts/memory-bench/report.mjs --compare baseline.json candidate-a.json candidate-b.json
timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs scripts/memory-bench/stats.test.mjs
```

The comparison refuses missing, duplicate, differently categorized, unscored or
unpaired question ids, mismatched judges, inconsistent cluster keys, a different
`metricVersion`, and reports from different frozen `protocolHash`/dataset. Each
ability reports the registered metric definition, unit, direction, both raw
means, `diff` (B minus A raw value), `improvementDelta` (direction-adjusted, so
positive always means better), `ci95`, raw `p`, `pHolm`, discordant counts,
cluster unit/count, method and paired-design power. A group is `confirmatory` only
for metric version 2, two completed usage-complete arms, a registered metric and
at least 8 independent clusters; historical or partial reports are descriptive.
Multiple candidates produce an array in CLI argument order; one candidate keeps
the existing object shape. Holm correction covers every candidate × ability
comparison in the supplied family. Declare families before inspecting results;
separate CLI calls constitute separate families. The 95% CIs are pointwise,
without multiplicity adjustment.

`stats.mjs` exports pure functions; its `mcnemar` export reuses `mcnemarExact` from the workspace `@arnilo/prism-evals` package:

- `clusterBootstrap(items, { cluster, metric, iterations, seed })` resamples whole
  clusters with replacement and returns `{ estimate, ci95 }`. `metric(row)` is a
  finite numeric per-item value (default: boolean `correct` converted to 0/1).
  The estimate is the item-weighted mean, including unequal cluster sizes;
  the percentile CI uses linearly interpolated 2.5% and 97.5% quantiles.
- `pairedClusterPermutation(a, b, { cluster, iterations, seed })` pairs raw
  metric values by unique `id`, requiring matching cluster keys, and returns
  `{ diff, ci95, p }`. It flips the sign of every paired difference in a cluster
  together. Up to 16 nonzero clusters use all sign assignments; larger samples
  use Monte Carlo with `(extreme + 1) / (iterations + 1)`. The CI bootstraps paired
  differences by whole cluster. Positive differences favour B on the raw scale;
  use `improvementDelta` when the metric is lower-is-better.
- `holm(pValues)` returns step-down Holm–Bonferroni adjusted p-values in input
  order, with monotone cumulative maxima and a cap of 1.
- `powerForDiff({ baseline, diff, clusters, icc, clusterSize = 1 })` estimates
  two-sided alpha=0.05 normal-approximation power for independent equal-size arms.
  With alternative `q = baseline + diff`, variance is
  `[baseline*(1-baseline) + q*(1-q)] / effectiveN`, where
  `effectiveN = clusters*clusterSize / [1 + (clusterSize-1)*icc]`.
  `clusters` is a positive integer per arm, ICC lies in [0,1], and cluster size
  is the mean items per cluster (default one, where ICC has no effect).
  It is historical only: do not use it to justify a paired claim.
- `pairedPowerSimulation({ baseline, diff, clusters, clusterSize, icc, simulations, seed })`
  simulates paired cluster differences and re-runs the same exact sign-flip test
  that `compare` uses, so the reported power matches the analysis design.
  `powerAssumptions.method` is `paired-cluster-signflip-simulation` and
  `independentArms` is false. With very few clusters the exact test cannot reach
  alpha, and the simulation reports power 0 rather than an optimistic number.
- `compare(a, b, { iterations, seed, icc = 1, simulations = 200 })` preserves exact two-sided
  McNemar only for unclustered Boolean results. If any row has `cluster`, every row
  must have a matching valid key and inference uses cluster sign-flips. Reported
  power is simulated under the same paired design. Observed power does not
  establish that an ablation was adequately powered.
- `compareFamily(baseline, candidates, options)` in `report.mjs` applies Holm
  jointly over the entire supplied family.

Resampling defaults to 10,000 iterations and integer seed 7, using a local PRNG
without global random state. The same ordered data/options produce byte-identical
comparison JSON. Cluster defaults to `row.cluster`; callbacks can instead select
persona/project pairs, for example:

```js
pairedClusterPermutation(armA, armB, {
  cluster: row => `${row.persona}/${row.project}`,
  iterations: 10000,
  seed: 7,
});
```

Clusters must be independent. The lifecycle suite uses the **persona** as its
cluster because its three project stores share one user/agent store; project-level
clusters would manufacture replication. Public questions cluster by shared
haystack session set (LongMemEval), conversation (LoCoMo) or source context
(MemoryAgentBench-CR). Few clusters and all-identical outcomes can produce
discrete p-values or degenerate percentile intervals. Small strata have low
power. Different models/judges, truncated context, synthetic dates and the small
fixed subset limit comparison with published scores. Offline accuracy exercises
wiring only.

Methods: [Field & Welsh (2007), cluster bootstrap](https://doi.org/10.1111/j.1467-9868.2007.00593.x)
and [Holm (1979), sequential multiple testing](https://www.ime.usp.br/~abe/lista/pdf4R8xPVzCnX.pdf).

The default test chain includes `run.test.mjs` as an offline gate smoke; it never downloads datasets or calls a live provider.

## Markdown store scale (offline, opt-in)

```sh
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
```

The runner prints JSON lines (machine metadata, then one result per corpus size).
It seeds synthetic OKF files using the production codec in a fresh OS scratch
directory, measures the production markdown store, and removes the directory in
`finally`. No provider, credentials, download, or embeddings are used. The
200-note subprocess smoke is included in `run.test.mjs`; the full scale run is
not part of `bun run test`. See
[`memory-markdown-scale-0.13.0.md`](../../docs/_evidence/memory-markdown-scale-0.13.0.md)
for the workload, numbers, and filesystem caveats.

## Lifecycle replay

Record once, replay promotion and retention policies through the published fabric
`consolidate`, `maintain`, `recall`, and `recordUses` APIs. Nothing changes package
defaults. The component runner does not run an agent or measure delivery tiers;
end-to-end delivery and default calibration belong to the later lifecycle suite.

```bash
timeout 600 bun scripts/memory-bench/lifecycle/synth.mjs --personas 4 --projects 3 --sessions 8 --seed 7 --out .cache/memory-bench/lifecycle/ledgers
timeout 1200 bun scripts/memory-bench/run.mjs --replay .cache/memory-bench/lifecycle/ledgers --policy scripts/memory-bench/lifecycle/policies/gated.json --offline --output .cache/memory-bench/lifecycle/report.json
# The standalone entry point accepts --ledgers instead of --replay.
timeout 1200 bun scripts/memory-bench/lifecycle/replay.mjs --ledgers .cache/memory-bench/lifecycle/ledgers --policy scripts/memory-bench/lifecycle/policies/no-promotion.json --offline
```

Synthetic values are seeded SHA-256-derived opaque tokens, with no outside
knowledge needed. Each content-addressed JSONL contains a versioned manifest and
session entries (including real OM observation, reflection, and task-state
records). The manifest holds persona/project/session ordering, labels by
construction and later probes. Labels name entry ids, content hashes, expected
kind/scope/key, ephemerality and path globs. Lessons start in project scope and
are labelled for eventual agent scope after replication. Project-specific keys
keep unrelated project facts out of the lesson replication group. Supersession
probes use the value known before that session's new learning. A poisoned tool
result and task-local noise are negative labels.

Consented JSONL session-store export:

```bash
timeout 120 bun scripts/memory-bench/lifecycle/record.mjs --session SESSION_ID --store .prism/sessions --consent --persona PERSONA_ID --project PROJECT_ID --identities .local/identities.json
```

`--identities` is a JSON array of identifying strings (names, handles, repository
paths, etc.) the operator wants replaced everywhere. Email addresses, home
directory usernames and identity/reference fields are hashed automatically;
free-form names require that explicit list. Keep it outside version control.
Use the same `--persona` and `--project` across recorded sessions that share a
scope. Without them, top-level tenant/resource ids are used when available,
otherwise the session is isolated. OM ids retain their required 12-hex format,
and references receive the same pseudonyms.

Export refuses without consent, lists entries through the session store, runs
`redactSessionEntry`, hashes identifying strings, then runs the repository secret
scanner on a private staged file before publishing `ledgers/<sha256>.jsonl`.
CLI redaction uses secret values from environment variables ending in KEY,
TOKEN, SECRET or PASSWORD. Programmatic `recordLedger` accepts the host's actual
session `SecretRedactor` and `SessionStore` for other backends. An unknown secret
caught by the scanner aborts export; it is never published as a ledger. Files
are mode 0600, directories 0700. The default `.cache/memory-bench/lifecycle/`
is ignored by Git; custom output locations must also stay uncommitted.
Recorded ledgers initially have no gold labels or probes; see Gold labels and
human audit below. Promotion accuracy metrics are null without gold.

Policies are JSON validated by `resolveMemoryFabricConfig`, for example
`{"promote":{"minScore":0.45},"lifecycle":{"verifyAfterSessions":2}}`.
The replay applies `promote`, `consolidate`, `retrieval` and `lifecycle` settings;
delivery settings are accepted as fabric config but are not component metrics.
Offline hybrid retrieval uses the existing hash embedder, not live embeddings.

The extractor cache defaults to `.cache/memory-bench/lifecycle/extractor`; override
with `--cache`. Keys hash model id, prompt version, system prompt, input and tool
schema. Existing note ids are canonicalized and rebound on read, so random fabric
ids do not defeat cache reuse. A cold replay makes one extractor call per
nonempty consolidation pass; a warm replay makes none. `--offline` selects the
fixture mock extractor, which reads candidate text without access to gold labels.
For real redacted sessions, call `replayLedgers({ledgers, policy, client, cache})`
with a public `ModelClient`; it streams and caches the real extractor output.
For opt-in live extraction, set `promote.model` to `hyper/<model>` or
`opencode-go/<model>` in the policy. This lazily reuses the benchmark's credential,
provider-catalog, retry and wire-proxy plumbing only on a cache miss. Live input
usage is checked before every request/retry and after the replay, with a default
15M-token ceiling (`--max-input-tokens` overrides it); missing usage or an exceeded
ceiling fails the run. One in-flight call can cross the ceiling. Warm live caches
need no credentials or provider discovery. Without a model reference or injected
client, a cold non-offline replay fails closed. No live calls run in tests.
Cache contents are private working
data and must stay ignored alongside ledgers. Different model ids never share
entries; corrupt cache files and modified ledger hashes are rejected.

Session order comes from manifest timestamps. Public scope counters tick project,
agent and user once per worked session; probes run **before** consolidation and
credit uses only when recall returns the needed content. Procedure probes request
all note kinds explicitly. Metrics include:

- Promotion precision/recall, overall and by source: distinct promoted note
  versions versus distinct labelled content targets per persona/storage scope.
  Repeated identical plantings do not inflate recall. Unmatched predictions count
  against overall precision; an empty denominator is null.
- Scope/type accuracy over labelled promoted versions, including the narrow
  project copies of lessons before widening. These are promotion-history
  measurements rather than a final-state-only score.
- Duplicate rate: excess active copies of identical text in one storage scope.
- Archive regret: distinct archived note versions needed by a strictly later
  probe divided by distinct archived versions, even when recall misses them.
- Graveyard index: active notes with no use in the last K scope sessions (default
  3); never-used notes count. Programmatic `graveyardK` changes this window.
- Active-set growth: active notes and estimated tokens (`ceil(chars/4)`) per scope
  ordinal. Archived and superseded notes do not count.

Reports contain hashes, counts and scores, never candidate text or model output.
The mock is a plumbing check, not evidence for choosing production defaults.

```bash
timeout 300 bun test --timeout=0 scripts/memory-bench/lifecycle/lifecycle.test.mjs scripts/memory-bench/run.test.mjs scripts/memory-bench/stats.test.mjs
```

## Gold labels and human audit

Synthetic labels come from planted facts, with no judge calls. Recorded candidates
use the fabric's candidate gatherer and the versioned lifecycle rubrics in
`judge-prompts.json`. Two independent models, one per provider, label every
candidate. Run after the consented, redacted export described above:

```bash
timeout 3600 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/recorded --judges hyper/MODEL_ID,opencode-go/MODEL_ID --out .cache/labels --seed 7 --max-input-tokens 15000000 --evidence docs/_evidence/memory-lifecycle-0.13.0.md
```

The panel reuses `judge.mjs`'s generate callback and the existing provider catalog,
credentials, retry, agent-session and wire-accounting plumbing. Model setup is
lazy: a warm cache needs no credentials. The token ceiling is checked before each
request/retry and after each response; one in-flight request can cross it. Missing
usage fails closed. Recorded input requires consent and the recorder's redaction
version and is secret-scanned again before any model call. `--offline` refuses
recorded ledgers, and uses construction labels only for synthetic ones.

Output files, all private and text-free:

- `labels.jsonl`: id, content hash, entry/session/persona/project ids, source,
  construction provenance, and `label`. Required label fields are
  `shouldPromote`, `kind`, `scope`, `key`, `ephemeral`, and `derivable`.
  Path scope requires `appliesTo`; `duplicateOf`, when supplied, must reference
  another candidate id. Keys are bounded machine identifiers, not prose.
- `queue.jsonl`: both judge labels for each disagreement, plus a seeded random
  10% of agreements, rounded up. Candidate and pair queues are sampled separately.
  Agreements enter the label output immediately; disagreement labels wait for a
  human. Audit items stay pending even though the panel agreed.
- `duplicates.jsonl`: candidate ids `a`/`b`, Dice score, bin, `sameNote`, and
  provenance. The default sample is 200 distinct pairs across available 0.1-wide
  Dice bins, within one persona/project. Sparse bins contribute all available
  pairs, then other bins fill the sample. Repeated equivalent synthetic plants
  determine same-note labels by construction; recorded pairs use the same panel
  and audit workflow, with two **additional** judge calls per pair. Fewer than
  200 available pairs fails before spending tokens. `--pairs 0` or a smaller
  count is available for focused checks, not production calibration.
- `report.json`: field-level Cohen's κ, error rates, audit sample sizes, pending
  counts and provisional flags. `--evidence PATH` writes the same aggregate
  results as Markdown. Preserve a separate evidence path for each campaign.

Cache keys hash candidate/pair input, model id and the entire versioned rubric.
Every fabric-bearing arm gets its own disposable OS scratch root; no arm uses the
repository, the user's memory, or a cwd/default-store fallback. Ingestion drops
sessions dated after the question and never reads oracle fields. Results carry
`storage`, `visibleChannels`, proposed write `scope`/`kind`/`resourceId` codes,
bounded `turnTrace` tool names and retry counts, never note text.

Each successful judgement is cached before continuing, so interrupted runs resume
without repeating successful calls. Cache records contain validated labels only.
Keep the output directory ignored, like the source ledgers; default output is
`.cache/memory-bench/lifecycle/labels`.

Inspect a queue id against the original redacted ledger locally:

```bash
timeout 60 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/recorded --inspect QUEUE_ID --seed 7
```

For each reviewed item write a private JSONL resolution file with
`{"id":"QUEUE_ID","label":{...}}`. Use the full candidate schema above, or
`{"sameNote":true}` / `{"sameNote":false}` for a pair. Then rerun the same label
command with `--resolve .cache/resolutions.jsonl`. Resolutions persist under the
hash of the dataset, rubrics, judges, sampled pairs and seed; resolved items leave
the queue and replace panel labels. Unknown, duplicate, nonqueued and malformed
resolutions are rejected. Use the same seed/pair count for inspection and reruns.
No command invents human answers.

κ and error rate use only completed random audits of agreed labels; both judges
made the same prediction there. Disagreement resolutions are excluded from that
estimate to avoid selection bias. A field with κ < 0.6, undefined κ (including
constant agreement), or no audit data is provisional. The overall recorded run
also stays provisional while any queue item is pending. These flags must travel
with later calibration/metric reports. Construction labels need no human audit;
their audit statistics are undefined, not a claim of human agreement. Dice-stratum
samples are not population-weighted, and no cosine threshold is inferred here.

To replay the labelled candidates programmatically, merge each `labels.jsonl`
row into its source ledger's `manifest.labels` by session id, flattening `label`
alongside `id`, `contentHash`, `source`, and `entryIds`. Keep the report's audit
status with the replay evidence. Recorded future-use probes still require
independent annotation; promotion labels do not supply those probes.

```bash
timeout 60 bun scripts/memory-bench/lifecycle/label.mjs --ledgers .cache/ledgers --offline --out .cache/synthetic-labels
timeout 300 bun test --timeout=0 scripts/memory-bench/lifecycle/label.test.mjs scripts/memory-bench/run.test.mjs
```

## Longitudinal lifecycle suite

`--suite lifecycle` runs one synthetic persona through three small TypeScript
fixture repositories and eight distinct sessions per project. `--seed` (default 7)
shuffles the project order within each session round, preserving each project's
chronology. Hidden labels cover shared package-manager/commit preferences,
project regions and database decisions with reasons, source-folder conventions,
a corrected retry lesson planted separately in two projects (eventual agent
scope), a mid-sequence region replacement, temporary noise, and an inert comment
asking for a harmless canary marker. Later probes omit the needed values; the
last session asks for an unknown release owner.

```bash
# Deterministic harness smoke: real agents/packages, local scripted model, no network.
timeout 120 bun scripts/memory-bench/run.mjs --suite lifecycle --offline --output .cache/lifecycle-smoke.json

# Paid calls only when explicitly invoked; scripted users make no persona model call.
timeout 7200 bun scripts/memory-bench/run.mjs --suite lifecycle --persona scripted --provider opencode-go --model <id> --config om+fabric --max-input-tokens 8000000 --output .cache/lifecycle-live.json
```

`--persona llm` is a live-only opt-in. A separate one-turn agent using the selected
model plays the user with the private goal and the allowed session message. It
may rephrase that message; a response containing a hidden planted value absent
from the allowed message fails the run. This literal guard cannot detect every
semantic paraphrase of a hidden fact, so scripted mode is the reproducible arm.
Persona, main-agent, OM, consolidation, embedding and retry input usage all count
against the same wire-accounted ceiling. Admission stops at the ceiling; one
in-flight request may cross it. Completed steps are checkpointed to `--output`;
failures and ceilings return a partial report with the completed sessions. Fabric arms also record
`consolidation: { passes, modelCalls, correctionCalls, failures }`; a failed pass keeps its safe
`reason` code plus the attempt counts, never model text.

All six existing `--config` arms work here. Unlike public retrieval-only suites,
lifecycle fabric arms retain the real memory tools, share one temporary SQLite
store across projects, and enable gated promotion (`promote: {}`). The public
package defaults do not change. `--policy <json>` overrides fabric lifecycle,
promotion and delivery settings; store, tools and scope identities are fixed by
the experiment. `fabric-agentic` disables passive injection; `fabric-hybrid`
requires `--embeddings provider/model`. Full and OM arms reconstruct prior
project user/assistant dialogue in each new session. OM runs its actual workers;
fabric-only arms receive a fresh conversation. No gold notes are preloaded.
Generated state modules are removed after grading, so later sessions must use
memory rather than read an earlier answer. Fixtures and memory stores are copied
to an OS scratch directory and removed after the run.

The agent reads fixture source and writes `src/<convention>/session.ts`, containing
`export default` followed by a JSON object and a semicolon. Executable state
assertions parse that module without executing model-generated code. Scoring uses
final files and ordered request/tool events, never assistant transcript claims.
JSON and Markdown reports contain ids, counts and scores; event bodies, messages,
file contents and hidden values stay in scratch state and in-memory logs and are
excluded from evidence.
Each session clusters by **persona** (not persona × project) and these
version-2 metrics:

| Metric | Denominator / check |
| --- | --- |
| taskSuccess | All sessions: required final file and every required state field match. |
| crossProjectLeakage | All sessions: a foreign project/path value appears in **written output**. Shared user/agent facts are allowed. |
| foreignContextExposure | All sessions: a foreign project/path value appears in **visible context**. Exposure is not output use; report both. |
| staleUseRate | Sessions requiring a superseded field: old value appears in written state. Merely retrieving history is not stale use. |
| repeatedErrorRate | Later retry probes after the correction: the corrected mistake appears in written state. |
| rightTimeRecall | **Raw mean** of the per-session fraction of needed facts delivered through memory blocks or recall/read results before the first state write. Dialogue alone earns no recall credit. The all-needed Boolean is not this metric. |
| abstentionCorrectness | Unknown-owner probes: final state explicitly says `unknown`. |
| poisonStored | All sessions: canary is present in stored memory (active or archived). |
| poisonVisible | All sessions: canary enters visible context. |
| poisonReused | All sessions: canary is written into output. |
| poisonPersistence | Any of stored/visible/reused; the three channels above are the actual evidence. |
| tokensPerSession | Mean input tokens per completed session, including background workers and the optional persona. Mock usage is an estimate. |

Empty denominators are `null`, never zero success. `sessions` retains fractional
recall scores and per-session attribution (tool/scope/kind ids and hashes, never
note or query text). `results` carries the raw `value` alongside the historical
`correct` flag; `compare` uses `value`, so a .25→.75 recall change reads +.5.
Error metrics are bad when higher; success/recall/abstention metrics are good when
higher. Metric version 2 changed leakage from exposure-plus-output to output only,
so compare version-2 reports only with version-2 reports. This suite is
a controlled state-assertion task, not a general coding benchmark. Offline scores
exercise plumbing only and must not be used to decide defaults. Task 6 runs the
provider comparisons and ablations; no paid campaign is part of normal tests.

## Coding benchmarks (Task 5)

```sh
timeout 120 bun scripts/memory-bench/run.mjs --suite dreambench-swe --offline --output .cache/memory-bench/dream-schema.json
timeout 120 bun scripts/memory-bench/run.mjs --suite vibemembench --offline --output .cache/memory-bench/vibe-schema.json
timeout 300 bun test --timeout=0 scripts/memory-bench/coding.test.mjs

# Opt-in live run; no model judge. Use the benchmark Python environment above.
timeout 7200 bun scripts/memory-bench/run.mjs --suite vibemembench --config om+fabric \
  --provider opencode-go --model mimo-v2.5 --max-input-tokens 10000000 \
  --output .cache/memory-bench/vibe-live.json
```

Both sources permit use under Apache-2.0. `datasets.mjs` pins the DreamBench v2
sequence metadata and VibeMemBench target Parquet by SHA-256 and byte count.
The offline paths validate one checked-in upstream item each (hashes asserted in
`coding.test.mjs`); they return `schema-smoke`, with no scored result or model call.
The extracted items retain upstream fields for schema checks; only the explicit
solver projection enters replay. Source licence: [coding-LICENSE.txt](coding-LICENSE.txt).

**DreamBench availability, checked 2026-10-21:** the public
[v2 artifact runbook](https://github.com/iroiro147/dreambench-swe/blob/d340bb2eaf3a81691820ef0683cd652753a9fa5a/artifact/README.md)
excludes hidden scoring oracles, reference solutions and fixture git history.
A non-offline invocation therefore returns `unavailable`, a dated reason, empty
results and undefined hygiene rates before any credential/provider request. This
corrects the earlier plan's assumption that public data was sufficient for scored
execution. It does not substitute transcript heuristics for executable stale-use
and repeated-error oracles. The schema adapter drops oracle labels and decisive
literals from solver input; a scored runner must wait for the missing assets.

**VibeMemBench:** `base` selects the first pinned target
`adamchainz__flake8-comprehensions-553`; `--subset all` selects all 111 targets,
and `--max-questions` limits that ordered set. Each target is an independent Prism
replay, with earlier same-repository trajectories mapped to dated history groups.
The target itself, later issues and other repositories are excluded by the
upstream numeric issue-order rule. All 3,634 history paths have fixed-revision Git
blob identities and byte caps in `coding-history-index.json`; the six base-target
histories additionally have SHA-256 pins. Non-LFS Git objects use the canonical
Git blob SHA-1; LFS objects use upstream SHA-256. Downloads are on demand into the
existing private benchmark cache. Synthetic history dates encode issue order,
not real wall-clock time. Full/OM replay reads historical dialogue; fabric arms
index it as episodes; the combined coding arm feeds both. This is a disclosed
Prism adaptation, not the paper's frozen verified-experience representation.

Execution reuses `replay.mjs`, measured providers, token ceilings and reports.
A sequential coding path supplies one `sandbox_command` tool using Prism's
existing disposable Docker sandbox, with a digest-resolved image, non-root user,
read-only host source, bounded output/commands/time and no network. Docker must
be available (`PRISM_MEMORY_BENCH_DOCKER` can name its absolute executable).
The pinned dataset's image is pulled before execution; benchmark code receives
no host credentials. Tests requiring network or unsupported image environments
fail closed rather than enabling host networking. There is no unsandboxed fallback.

After solving, a fresh sandbox applies the generated patch and hidden test patch
to the base checkout at `/workspace/repo`. The solver never sees the target's solution, test patch,
expected test names or evaluator metadata. SHA-256-pinned upstream log parsers
and normalization compute **Resolved** by exact expected passing-test equality
and successful test-command exit. `agentSteps` is mean solver model requests,
excluding OM workers and embeddings. Failed parses/infrastructure return a
partial failed report, not a resolved success. One in-flight call may cross the
shared `--max-input-tokens` ceiling.

JSON and Markdown put Prism's metrics beside source-linked paper baseline rows.
They explicitly state the different agent, provider, tools, budgets, seed counts
and memory record forms; VibeMemBench arm comparability is disputed. The default
one-target/one-seed pilot is not the paper's 111-target/four-seed aggregate.
Task 6 owns paid comparisons; no schema smoke or reference-patch self-check is
Prism performance evidence.

An optional Docker-only oracle check verifies the untouched base fails and the
known upstream reference patch passes; it makes no model call:

```sh
timeout 300 env PRISM_MEMORY_BENCH_DOCKER_SMOKE=1 bun test --timeout=0 scripts/memory-bench/coding.test.mjs
```

The first official Python image has been exercised. Its editable imports need
`PYTHONPATH` pointing to `/workspace/repo/src:/workspace/repo`, which the sandbox
sets explicitly. Other languages' image environments have not been calibrated;
unsupported environments fail closed and must not be interpreted as solver
performance evidence.

## Task 6 ablations and calibration

Owner decision (2026-10-21): use OpenCode Go only for this campaign. Hyper is
excluded; hybrid stays unavailable without a real embedding model. Neither a
failed run nor construction smoke decides production defaults. The checked-in
`defaults.json` snapshots the current **provisional** package settings, excluding
host filesystem identity; `config_defaults_match_evidence` detects drift.

Repeat `--ablate path=value` to vary shipped settings, for example:

```sh
timeout 7200 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset targeted --ability knowledge-update --config fabric --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 --ablate fabric.inject.budgetTokens=1200 --max-input-tokens 2000000 --output .cache/memory-bench/ablation.json
timeout 7200 bun scripts/memory-bench/run.mjs --suite lifecycle --config om+fabric --provider opencode-go --model mimo-v2.5 --ablate fabric.promote=off --max-input-tokens 2000000 --output .cache/memory-bench/no-promotion.json
```

The whitelist in `ablations.mjs` covers OM thresholds, fabric injection/query/budget,
directory, consolidation threshold/decider, promotion/minScore/weights, lifecycle
verification/decay/archive/capacity/duplicate threshold/widening, and core/cues.
`on`/`off` mean booleans (or an enabled object for inject/promote/episode merging).
`fabric.consolidate.decider=off` removes only the model decider. Unknown settings,
inactive arms, invalid values and conflicting parent/child overrides fail before
model discovery. The report records every override and the resolved configuration
used by the packages. Lifecycle also accepts its existing `--policy`; replay uses
`--policy` exclusively and rejects `--ablate` rather than silently ignoring it.

Historical mechanisms without shipped switches (stemming, key weighting,
replace-on-reflect, task state, retrieval-based verification, calendar/exponential
decay, flat scope, cross-source dedup, complete merge/capacity removal, promotion
every-reflection, and each promotion signal's leave-one-out) run through
`variants.mjs`: a process-local source transform applied by `--preload`, carrying
sha256 provenance and failing on source drift. Package files and public config stay
unchanged, and unsupported settings are refused rather than becoming no-op arms.
Source variants need `PRISM_MEMORY_BENCH_VARIANTS` to match the preloaded specs, so
`run.mjs` never silently starts a paid arm with a different transformation.

```sh
timeout 1800 bun scripts/memory-bench/replay-matrix.mjs --clean
timeout 7200 bun scripts/memory-bench/campaign.mjs
```

The replay matrix covers every historical mechanism, the replay-only flat scope,
delivery off, and a capacity sweep; each arm is replayed twice against one shared
extractor cache and must make zero extractor calls on the warm pass with identical
metrics. Arms whose path offline replay never exercises (OM workers, tool-driven
recall, SQLite FTS, prompt delivery) carry an `exercise` note; unchanged metrics do
not establish their value. Every arm also records a `mechanism` classification in
the evidence JSON and a per-arm exercise table: `exercised` (metrics changed),
`insensitive` (source transform changed but metrics did not), `unexercised` (the
path is not invoked; never cite as live evidence) or `policy` (non-mechanism
policy arm). A source transform that does not move a metric is not a successful
ablation. Multi-query is an agent tool input, not a config switch.
A 5k/10k dropper target also requires a lower reflector threshold under the current
invariant; that changes two variables and cannot be reported as an isolated
dropper ablation.

The campaign spends through one durable journal
(`docs/_evidence/memory-bench/task6/campaign-journal.json`), never a directory
listing. Each attempt gets an id and its **entire** allocation (cap plus one
question of overshoot) is persisted before the child starts; the journal records
attempt status, confirmed usage and reconciliation. Renaming an output, crashing
before the first report, a failed setup or a killed child therefore keeps the
reservation: only a matched report can reconcile it, once. An unfinished attempt is
marked `abandoned` at startup and a new attempt id continues the same-protocol
results with `--resume`, so already-scored questions cost nothing again. The journal
refuses a different manifest, and an active lock refuses a second campaign. A live
child also needs `PRISM_MEMORY_BENCH_JOURNAL` and `PRISM_MEMORY_BENCH_ATTEMPT`; a
manual `run.mjs` without a reservation fails closed. Before every provider request
the child checks the attempt's headroom, including retries and second in-flight
calls.

```sh
# Dry run: writes scripts/live-matrix.json-derived plans only, never the journal.
timeout 60 bun scripts/memory-bench/campaign.mjs --manifest
# Paid campaign: one writer, durable reservations, resumable scored items.
PRISM_MEMORY_BENCH_JOURNAL=docs/_evidence/memory-bench/task6/campaign-journal.json \
  timeout 7200 bun scripts/memory-bench/campaign.mjs
```

A missing report is never success and is never a refund. Reports carry
`attemptId`, `protocolHash` and `usageComplete`; `--resume` refuses a changed
protocol, config, dataset, judge or source revision. Lifecycle arms do not resume
mid-run: their store/ledger cannot be validated cheaply, so a new attempt starts
from scratch while the old allocation stays charged. Stop owned children by pid;
never use a broad `pgrep -f` kill.

```sh
timeout 120 bun scripts/memory-bench/calibrate.mjs --kind injection --reports .cache/memory-bench/ablation.json --output .cache/memory-bench/injection-calibration.json
timeout 120 bun scripts/memory-bench/calibrate.mjs --kind consolidation --pairs .cache/synthetic-labels/duplicates.jsonl --gold-report .cache/synthetic-labels/report.json --output .cache/memory-bench/consolidation-calibration.json
```

Injection uses actual per-hit coverage in context metadata, never recomputes it
from rendered text, and bins judged hits into ten coverage intervals (1 belongs
to the last bin). Unknown coverage and unlabelled hits are excluded and counted.
It suggests the lowest nonempty bin with at least half labelled `used`; that hint
is `floor`. A production default additionally needs `eligibleFloor` (a bin with at
least `minBinN` labelled hits, default 20) and `auditedGold: true`, exposed as
`defaultEligible`. Sparse or unaudited construction labels therefore never promote
a bin into defaults. Bins below the collection floor remain unmeasured.
Core/directory/cues without topic-query coverage cannot calibrate the lexical
floor. Partial reports remain provisional.

Consolidation searches observed Dice thresholds (or cosine with `--mode hybrid`),
maximises F1 subject to precision >= 0.9, then breaks ties by precision and the
higher threshold. No passing threshold returns null. Missing cosine scores fail;
Dice never substitutes for cosine. `--gold-report` is required, field-level pair
audit flags travel with results, and construction labels always stay provisional
for a production-default verdict. This is in-sample, stratified F1; it is not a
held-out promotion-weight calibration. Neither command edits package defaults.
Promotion weights, retention and capacity still require the held-out persona and
paired live measurements in the plan.

Keep the aggregate ledger in the campaign journal, which includes failed,
abandoned and diagnostic attempts; reserve each run's `--max-input-tokens` plus one
question of overshoot against the remaining ceiling before starting it. One
in-flight request can cross its run cap. Missing wire usage is incomplete billing
evidence, so the attempt keeps its whole reservation. Do not rerun an
entire matrix after a systemic provider/judge failure until a bounded control
request succeeds. The latest outcomes and remaining gates are recorded in
[`memory-lifecycle-0.13.0.md`](../../docs/_evidence/memory-lifecycle-0.13.0.md).

A zero promotion **weight** is not removal of its signal: explicit-promotion and
non-derivability hard gates still apply. Weight-only config arms must be named
accordingly; the historical full-signal ablation uses `promote.signal.<name>=off`,
which zeroes the signal before scoring. Capacity arms that never exceed a budget
likewise provide no capacity-loss estimate; the replay matrix includes budgets
that bind.

`--kind retention --reports <json>` accepts warm `lifecycle-replay` reports (one
report or an array per file) and minimises graveyard index subject to archive
regret <= 0.02. Failed reports and null denominators are ineligible; ties use
regret then policy hash for deterministic output. This is an in-sample search,
not a live capacity or production-default verdict. Archive regret counts a later
probe whose needed fact is archived and is **not** supplied by an active recalled
copy. Widening and duplicate retirement with an accessible replacement are not
loss. The regression also retains a genuine later-needed archived-fact case.

### Plan 202 Task 4.5: zero-score ability diagnostics

`audit/zero-score.mjs` restricts the audit to the four frozen BEAM-100K development
`event_ordering` ids and four `summarization` ids. It first checks each declared
judge with the gold answer and a deliberately incorrect negative control, then
runs source auditing and checkpointed `oracle` (labelled evidence only) and
eligible `full` answers through the existing replay and panel machinery.

BEAM source rubrics now reach judging as untrusted JSON alongside the reference
answer. Ordering requires the requested item count and chronology; summaries
require rubric coverage while accepting paraphrases. Rubrics never enter normal
answer generation. The prompt-template hash changes, invalidating old verdict
cache identities. Original exploratory reports are preserved.

The declared ceiling is 160 wire attempts, 5 million input tokens, 300,000 output
tokens and 60 minutes, serial execution. Token checks use reconciled wire usage
before each attempt, so the final in-flight response may cross a token ceiling.
A transient free-pool `429` (an upstream shared pool is busy) is **not** quota
exhaustion: it is retried four times with backoff and still counted as a wire
attempt. Only the free-per-day cap stops the diagnostic immediately. Neither
path buys a replacement provider or expands the question set. Private
source/gold/answer text and checkpoints stay under `.cache/memory-bench/audit/4.5/`;
the committed summary contains ids, counts, dispositions and findings. The
owner-authorized OpenRouter free-model retry uses
`nvidia/nemotron-3-ultra-550b-a55b:free` for answers and
`dots-studio/dots-3-note-preview:free` plus `cohere/north-mini-code:free`
for cross-family judging. These replace the quota-exhausted OpenCode models;
prior verdicts are not reused across model identities. The answer model is run
with thinking disabled: with it enabled every complete-history answer spent the
output budget on reasoning and returned no answer, which cannot be graded. Run:

```sh
timeout 3600 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python \
  bun scripts/memory-bench/audit/zero-score.mjs
```

`oracle` reports and reports carrying `diagnosticOnly: true` are excluded from
baseline cells, lever rankings and product comparisons. Diagnostic full-history
answers cannot establish product acceptance. These eight questions span six
conversation clusters; repeated arms do not increase that count. The owner's
human-calibration waiver remains explicit: model-assisted auditing is not human
calibration. Diagnostic outcomes and the superseded subscription quota blocker
are in `docs/_evidence/memory-bench/202/zero-score-abilities.{json,md}`: gold and
wrong-answer controls pass on both judges, a faithful paraphrase of the gold
answer is accepted under both rubric forms, evidence-only answers score 2/8 and
complete-history answers 0/8 with the rejections inspected. Grading is not
inverted, so the abilities stay in the target, but the binary resolution cannot
attribute those zeros to the answer model or the product (Task 4.5.1 below), and
this free panel is development-only and never evidence for acceptance.

### Plan 202 Task 4.5.1: graded rubric scoring

Binary BEAM grading requires every rubric point and, with two judges, both must
agree, so an answer covering four of five points scores the same as one covering
none. The upstream protocol (BEAM `src/evaluation/compute_metrics.py` and
`report_results.py` at commit `b2da22eac88bb0874c64665f13457eb99835774a`) is graded:
each rubric point is judged separately as 0 / 0.5 / 1 and the ability score is the
mean (`llm_judge_score`); `event_ordering` also computes Kendall tau-b between the
rubric order and the response order over the union of both lists, missing items
tied last, normalised to `(tau + 1) / 2` (`tau_norm`), and `final_score = tau_norm x F1`.
Upstream's report prints `tau_norm` for ordering and `llm_judge_score` for the rest.

Registered **before** any Task 4.6 sizing or 4.7 pilot answer:

- **Primary Task 4 screening and lever-ranking metric for `summarization` and
  `event_ordering`:** the graded score, the **mean across judges** (not the binary
  AND/majority rule). Summarization is the mean per-point credit. Ordering is
  `tau_norm x F1` over the labelled items, because `tau_norm` alone leaves omissions
  unpenalised (a perfectly ordered four of five items scores 1.0). A response that
  names no labelled event takes the floor (upstream's tau is NaN there). The panel
  reports a per-answer `gradedSpread` and a disagreement flag when judges differ by
  more than 0.2.
- **Secondary:** the binary panel verdict, computed and reported unchanged.
- **Task 18 is untouched.** `robustness-criteria.json` and the frozen binary
  acceptance metric do not change; a test pins `robustnessCriteriaHash()`. Moving
  Task 18 onto the graded score would be a separate, versioned, owner-decided
  amendment made before any held-out run, never a retroactive reclassification.

Deviations from upstream, stated plainly: one judge call scores all rubric points
(summarization) or maps the response's items to rubric numbers (ordering) instead of
one call per point, to fit the free-model call ceiling; tau-b and F1 are then computed
locally. Judge input stays untrusted JSON. Graded templates live under `graded` in
`judge-prompts.json`, outside `prompts`, so `JUDGE_TEMPLATE_VERSION` and every binary
cache key are unchanged; graded verdicts use their own key kind and version.
`run.mjs` adds `graded`, `gradedSpread`, `gradedDisagreement` and `gradedJudges` to
BEAM rubric rows (not in offline mode); reports and baseline ability rows show the graded
mean beside binary accuracy.

`audit/graded.mjs` runs the 4.5.1 diagnostics on the same eight development ids.
Declared ceiling: 400 wire attempts, 8 million input tokens, 700,000 output tokens, two
hours, serial, OpenRouter free panel only, $0. Re-judging reuses the 4.5 answer
checkpoints with no new answers; gold variants, source text, answers and judge outputs stay
under `.cache/memory-bench/audit/4.5.1/`.

```sh
export PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python
timeout 7200 bun scripts/memory-bench/audit/graded.mjs            # re-judge, borderline controls
timeout 7200 bun scripts/memory-bench/audit/graded.mjs --reanswer # optional thinking re-answer
bun scripts/memory-bench/audit/graded.mjs --dossiers             # claim candidates over the full source
bun scripts/memory-bench/audit/graded.mjs --classify             # counts from the private review
bun scripts/memory-bench/audit/graded.mjs --evidence             # text-free committed evidence
```

Borderline controls are built locally from each question's own rubric: the gold answer,
gold minus one rubric point, for ordering one adjacent swap and the full reversal, for
summaries gold plus a correct extra sentence from a labelled message, and a model-written
paraphrase of the gold answer for all eight ids. Binary must accept the gold, extra and
paraphrase variants and reject every degraded one; the graded score must track the closed-form
expectation within 0.2 (`(k-1)/k` for summaries, the ordering metric itself for ordering).
The complete-history claim review classifies every claim against the **whole**
conversation, not the labelled evidence (`supported-labelled`, `correct-unlabelled`,
`contradicted`, `superseded`, `unsupported`, plus `synthesis` for a line with no checkable
specific): numbers and names are searched across all messages, the closest messages are
listed with their label status, and ordering and every flagged claim were read by hand. It
cannot find a semantic contradiction that shares no number or name with the source, so a
`contradicted` or `superseded` count of zero means none were found in what was read, not that
none exist. Model-assisted review is never human calibration; the owner's waiver stands.
Results are in `docs/_evidence/memory-bench/202/graded-rubric-scoring.{json,md}`.

### Plan 202 Task 4.7: bounded corrected pilot

The completed diagnostic is in
[`pilot-v3/README.md`](../../docs/_evidence/memory-bench/202/pilot-v3/README.md).
It accounts for all 52 requested cells: 40 product/comparator cells, two
rubric-oracle ceilings and ten equivalent-policy full-truncated dispositions.
All ten full-history requests are eligible; no source messages were removed.
`final-results.json` contains the scored rows and paired differences;
`evidence-coverage.json` distinguishes selected comparator history from delivered
memory ids. Oracle rows never enter comparisons or lever rankings.

`audit/pilot.mjs` is a fixed development-only entry point over the existing
replay, journal, checkpoint, panel, timing and paired-statistics machinery. It
cannot start the broad campaign. Its ten ids cover every BEAM ability once,
preferring five historical run-limit ids. This completion-enriched screen is
descriptive, not an unbiased development accuracy estimate. Seven independent
conversations overall and one per ability cannot establish a lever effect.
Ordering and summary rows report graded scores as primary, binary as secondary;
Task 4.6's screening limits and the owner's human-calibration waiver remain.

The primary configuration is Nemotron with reasoning disabled, temperature zero,
8,192 output tokens and the unchanged eight-turn stop. It is a bounded diagnostic
configuration, not the product/acceptance configuration. Both judge families are
free development-only routes. Source annotations/rubrics reach evaluation only;
injection-utility annotation calls are disabled. No prompt, product setting,
turn budget, provider replacement or broad-grid expansion was made.

The original allowance was 300 wire attempts, 8M input, 700K output tokens and two
hours, serial. V1 stopped on a judge SSE 502 and exposed a cleanup error. V2 reran
all primary cells after fixes; v3 preserves eleven validated v2 rows and completes
the remaining cells after another judge-stream loss. Every continuation manifest
reduces the remaining allowance and pins prior results. A final judge-only
supplement scores the same saved full-summary answer; its offline join preserves
failed-call cost and rejects another checkpoint. Both old outcomes remain public.

Historical execution commands (already-frozen/attempted identities refuse a new
live execution; `--compose` is local and makes no model call):

```sh
timeout 60 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun scripts/memory-bench/audit/pilot.mjs --freeze
timeout 5200 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun scripts/memory-bench/audit/pilot.mjs
timeout 60 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun scripts/memory-bench/audit/pilot-rejudge.mjs --freeze
timeout 1800 env PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python bun scripts/memory-bench/audit/pilot-rejudge.mjs
timeout 30 bun scripts/memory-bench/audit/pilot-rejudge.mjs --compose
```

Source hashes describe the frozen executions. Subsequent test/docs/offline-join
changes require Task 4.8 to refresh provenance before any broad run; changing a
product/answer/scoring input is refused by the continuation guard. Private text,
answers and bounded provider traces stay under `.cache/memory-bench/audit/4.7*`.
V2/v3 traces keep at most 16 turns, the last 16 messages per request, 4,096
characters per message/event and 64 non-text events per turn, preserving tool
calls and stop reasons when text streams are long. Public reports contain ids,
counts, hashes and scores only.

Including v1, primary work used 246 attempts, 2,673,235 reported input and 254,371
reported output tokens over 74.2 active attempt minutes. Eleven exchanges lack
usage: totals are lower bounds, all incomplete journal reservations remain
charged, and no fully reconciled hard-token or billing proof is claimed. The
aggregate primary reservation charge is 24,028,649. The existing 250k/request
planning envelope stays below the numeric token allowance but cannot replace
provider usage. Elapsed time including engineering, probing and the continuation
pause was 295.2 minutes, an explicit deviation from one uninterrupted two-hour
pilot. See `budget-accounting.json`; the $0 role cost is free-route pricing.

The separately frozen subscription completion probe reproduced Beam's eight-turn
loop with repeated identical recall arguments and result/hit feedback visible in
later model requests. Its genuine run limit stays a failure. MiniMax's current
probe is blocked by its monthly quota; its historical eight-turn/21-call trace
is preserved without inventing a current diagnosis. The probe used 11 of its 48
attempts, under separate 2M-input/100K-output/30-minute limits, with no paid
fallback. The original eight-versus-one failures out of forty remain exploratory.

Harness repairs count passive retrieval once plus every explicit recall, retry
transient SSE judge 500/502/504 within the existing attempt ceiling, dispose
judge agents correctly and preserve bounded non-text trace events. A current
ordering model call exceeded the advertised four-query limit, received the
validation error, corrected its arguments and completed: product/tool-use
behavior is measured, not tuned here. Task 4.7 is complete; missing usage,
elapsed time, quota availability and frozen broad-run provenance remain Task
4.8 handoff items. The broad baseline remains paused.

Development candidate-gap diagnostics use `evidenceCounts.toolSurfacing`: each needed
round records whether any successful `memory.recall` or `memory.read` result returned it
across the agent's queries. Failed answer attempts are cleared before retries. Hidden
recall candidates and passive injection do not count as tool results. The retrieval
diagnostic reports `toolSurfacingSummary`; its question-only rankings remain ablations.
Older reports without tool-result instrumentation have unknown surfacing (`null`),
not zero candidate gaps. Held-out partitions remain prohibited in these diagnostics.
