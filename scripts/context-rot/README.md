# Context-rot curve

Measures how much stale tool history a model can carry before its accuracy on agent-shaped work falls,
and whether batch tool-result clearing recovers that loss. Harness only: no package imports these
scripts and no product default changes.

## Run

```bash
# CI smoke: mock provider, 3 tasks, lengths 0 and 4000, under 30 s
timeout 60 bun scripts/context-rot/run.mjs --offline

# Live: one model on one route provider
timeout 14400 bun scripts/context-rot/run.mjs --provider opencode-go --model mimo-v2.5
timeout 14400 bun scripts/context-rot/run.mjs --provider hyper --model <id>
```

Flags: `--lengths 0,16000,32000,64000,96000`, `--repeats 3`, `--max-input-tokens 50000000`,
`--max-turns 8`, `--max-tasks <n>` (pilot runs), `--output-dir <dir>`, `--summary <file>`, `--cache <dir>`. Defaults clamp each
length to the model's declared window minus output and reserve. `--offline` uses the local fixture
repo as history and a mock provider; it does not download the pinned snapshot.

Live credentials come from `~/.config/prism/live.env` through `scripts/live-matrix.mjs` (or the
named env vars). Keys are never printed and are only passed to the wire proxy's redaction list.

## Method

- **30 fixed tasks** live in `tasks.json`, ten of each kind:
  - coding edits against `fixtures/repo`: the model edits `src/bugs.js`; the grader runs only that
    task's fixture test and fails the run if the test file's checksum changed;
  - needle lookups whose fact is stated at session start and whose question has no lexical overlap
    with it (NoLiMa-style), graded by exact normalized answer;
  - multi-step tool tasks over seeded `data/` files, graded by exact final state.
- **History** is `N` tokens of unrelated completed tool turns: alternating file reads and grep output
  from the pinned `expressjs/express` commit in `history.mjs`. The archive is cached under
  `~/.cache/prism/context-rot`, checked for exact byte length and SHA-256 every run, and extracted
  read-only. The snapshot is never imported or executed. The same history array is reused for every
  task at a length, and a cache breakpoint is pinned to its last message, so repeats are mostly cache
  reads.
- **Fold batch mode** is the second config: `context-engineering`'s `planToolResultFoldBatch` +
  `foldToolResultHistory` with `clearAtLeastTokens: 4096`, `keepLast: 3`, `minAgeTurns: 2`,
  `minBytes: 4096`, deterministic truncate summaries, and a persisted frontier per task run.
- **Usage** is read from the wire proxy's JSONL log, not estimated: input, cache-read, output, calls.
  The token ceiling (`--max-input-tokens`, default 50M per model) is checked after every task and
  leaves a partial report when it fires.
- **Effective input budget** is the largest tested length whose accuracy is within 5 points of the
  0-length baseline with overlapping Wilson 95% intervals; the smallest tested length is reported
  when none qualify. The report also computes it for the fold config.

Expected ceiling: 30 tasks × 5 lengths × 3 repeats × 2 configs ≈ 900 requests per model, about 45M
input tokens at the default lengths. Most history tokens should be cache reads; the report states the
provider-list billed estimate when the model publishes a price.

## Output

Live results go to `docs/_evidence/context-rot/<provider>-<model>-<date>.{json,md}` and upsert one row
in `docs/_evidence/context-rot-0.13.0.md`. Offline results default to
`~/.cache/prism/context-rot/offline/`. Evidence contains task ids, kinds, lengths, configs, scores and
usage counts only — never prompts, answers, file contents or credentials.

## Tests

```bash
bun test scripts/context-rot/run.test.mjs
```

Covers the offline smoke and its lengths, checksum refusal, the ceiling partial report, the budget
rule on a fixture curve (including none qualifying), and deterministic grading.
