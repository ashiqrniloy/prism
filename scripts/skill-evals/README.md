# Skill evaluations (plan 215 Task 11)

Paired evaluations for the module skills that plan 215 Tasks 7–9 added. Each skill runs on a dataset of 10 trigger
items (the skill should help) and 3 non-trigger items (it should not load), in two arms:

| Arm | Agent |
| --- | --- |
| `skill` | the tools and skill under test, listed in the catalog |
| `no-skill` | the same agent, model and instructions, with `disable.skills: [<skill>]` |

`skill_eval_arms_differ_only_by_skill` checks that nothing else differs.

| Skill | Package | Environment (all local) | `task_success` is graded on |
| --- | --- | --- | --- |
| `web-research` | `@arnilo/prism-tools-web` | a loopback SearXNG endpoint and a documentation site the native fetcher reaches through a request override | the final answer: the fact, no injected text, a cited URL where asked |
| `coding-workflow` | `@arnilo/prism-tools-coding` | a scratch repository per trial | hidden tests the agent never saw, plus untouched protected tests and forbidden-pattern sweeps |
| `browser-automation` | `@arnilo/prism-tools-browser` (manager over a real Chromium) | a loopback site with forms, a wizard, tabs, a modal and a prompt-injection page | what the server recorded (submissions, settings, no `/evil` hit) and the final answer |
| `delegating-work` | `@arnilo/prism-delegate` | an `analyst` child that sees only the brief and answers `MISSING DATA` otherwise | the final answer and a child answer that carries the result |

## Pre-registration

`criteria.json` holds the datasets' bounds, the arms, the scorers, trials, seed, the ship rule and the providers. It is
written and locked **before any paid run**:

```bash
bun scripts/skill-evals/run.mjs --register   # writes criteria.lock.json (criteria hash, dataset hashes, time)
git add scripts/skill-evals && git commit
```

A paid run refuses to start when the lock is missing or differs from `criteria.json` or a dataset. A scored
(`--live`) run also refuses while `criteria.json`, the lock or `datasets/` have uncommitted changes. Every live
evidence file records the criteria hash and its start time, and `skill_eval_criteria_preregistered` checks that the
evidence started after the lock and carries the locked hash.

## Scorers and the ship rule

- `task_success` (both arms): state grading, 0 or 1. Every item has a checkable end state, so no judge is used.
- `skill_triggered` (skill arm): from the execution timeline, `load_skill` was called with the skill's name on a trigger
  item, and not called on a non-trigger item.
- `tool_misuse` (both arms): failed or blocked tool steps; the score is `1 / (1 + count)` and the count is recorded.

Per provider, a skill **ships** when `assertEvaluationThreshold` with `maximumRegression` (`delta: 0`, `alpha: .05`,
baseline `no-skill`, scorer `task_success`) finds no significant regression, and trigger precision and recall are each at
least 0.7. Otherwise it is **rewritten once** and re-measured on fresh trials (`--round 2`); a second failure **removes**
it. A comparison that cannot be computed is `inconclusive`, never a ship. A skill ships only when every provider that ran
shipped.

## Running

```bash
timeout 300 bun scripts/skill-evals/run.mjs --offline                       # CI-safe wiring check, a few seconds
timeout 1800 bun scripts/skill-evals/run.mjs --dry-run --providers hyper    # 5 items per skill, 1 trial: the cost estimate
timeout 3600 bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go --skill web-research
```

Offline mode answers every item with its oracle on the scripted provider. It proves the datasets, the arms, the
graders and the scorers are wired together, not that any skill helps. Paid runs use Hyper and OpenCode Go with keys from
`~/.config/prism/live.env`. Providers are Hyper, OpenCode Go and the free models on OpenRouter, Kilo and Command Code
(owner decision 2026-11-05); the router aliases `openrouter/free` and `openrouter/auto` are refused. Models come from
`PRISM_LIVE_SKILL_EVAL_{HYPER,OPENCODE,OPENROUTER,KILO,COMMANDCODE}_MODEL`.

Evidence is `docs/_evidence/skill-evals/211/<skill>.json` and `.md` (round 2 adds `.round2`); protocol v1 evidence is kept in `211/v1/`. It records the skill text
revision, dataset hash, criteria hash, per-arm task success with intervals, the paired comparison, trigger precision
and recall, tool misuse, how many runs ended on a run limit (turns, tool calls or time), task success split by whether the skill was loaded, tokens (cached and uncached), cost and latency, and a per-item table.

## Protocol versions

`criteria.json` records its history in `protocolHistory`. Version 2 (2026-11-06) followed a review of version 1: the
first protocol measured mostly whether a model reaches for a skill, and its browser items ended on the turn limit in both
arms because the skill text omitted the `snapshotId` rule. Version 2 rewrote the skill text and descriptions, raised the
browser run limits, added two items per dataset that need the skill's content, and made the evidence show limit hits and
the loaded/not-loaded split. Rounds restart at 1.
