# `@arnilo/prism-advisor`

A second model's advice on the current approach, and completion validation. One `advise` tool, two opt-in review triggers, and an opt-in `validate` stage that fails closed.

The advisor is **advisory**: it has no tools, cannot act, never writes to the session, and never blocks a run when it fails. Safety belongs to `@arnilo/prism-approval` and policy packages.

## Install

```sh
bun add @arnilo/prism-advisor
```

Peer: `@arnilo/prism >=0.13.0`.

## Configuration

```ts
import advisor from "@arnilo/prism-advisor";

advisor({
  model: "hyper/<strong-model>",
  context: { lastTurns: 8 },
  triggers: { beforeTools: ["shell", "write"], beforeFinish: true },
  maxConsultsPerRun: 4,
});
```

| Key | Default | What it does |
| --- | --- | --- |
| `model` | required | The advisor's own model (`"provider/model"` or `{ provider, model }`). Setup fails naming the field when absent; an unresolvable model is a `warn` status note and registers nothing. |
| `instructions` | built-in prompt | Replaces the advisor's instructions. |
| `context` | `{ lastTurns: 6, maxChars: 24_000 }` | The slice of the conversation the advisor reads. `lastTurns` capped at 50, `maxChars` at 120,000; a larger value is clamped with one `info` note. |
| `adviceMaxChars` | `4_000` | Cap on the advice text, hard cap 16,000. |
| `tool` | `true` | Register the `advise` tool. |
| `triggers.beforeTools` | off | Consult before each named tool call. |
| `triggers.beforeFinish` | off | Consult at the natural end of each run. |
| `maxConsultsPerRun` | `3` | Model calls one run may spend on consults, hard cap 20. |
| `validate` | off | Completion validation; see below. |

`triggers.beforeFinish` and `validate` together fail config validation: both are `run.end` reviews and the first continuation wins, so one would be silently inert.

## What it changes

- the `advise` tool (`tool: true`, the default);
- a `tool.call` decide hook for `triggers.beforeTools`;
- a `run.end` decide hook for `triggers.beforeFinish` or `validate`;
- a `run.input` transform hook that captures the run's task, only when `validate` is set.

Events, both `package.event`:

- `advisor.consult`: `{ trigger: "tool" | "beforeTools" | "beforeFinish", status: "ok" | "skipped" | "capped", verdict?, totalTokens? }`;
- `validator.verdict`: `{ round, verdict: "verified" | "incomplete" | "unverified" | "error", engine: "model" | "child", task: "captured" | "inferred", missing?, reasonCode?, totalTokens? }`.

Neither ever carries the transcript, the advice text, or the final answer. `missing` holds at most 5 items of at most 200 characters.

```ts
for await (const event of session.subscribe()) {
  if (event.type === "package.event" && event.name === "validator.verdict" && event.data.verdict === "verified") markVerified();
}
```

## Capabilities

`models` (the two model engines) and `session-state` (reads the branch for the slice).

## `advise`

```
advise({ question: "Is patching the parser or the caller the right fix?" })
→ "Patch the caller: …\n\n[advisor: hyper/<strong-model>, 3,912 tokens]"
```

One `prism.models.client(model).generate` call with no tools over `selectTranscript(<branch>, context)` and the question. Past `maxConsultsPerRun` the tool returns an error result naming the cap; a provider failure returns an error result and the event is `skipped`.

## Review triggers

- **`beforeTools`**: asks for `{ "verdict": "proceed" | "revise", "advice": string }` about the pending call (name and arguments). `revise` returns `{ deny: "Advisor: <advice>" }`, so the model reads the advice as the tool result. A retry of the same tool with the same arguments in the same run is allowed without a second consult, so a revise cannot loop.
- **`beforeFinish`**: one consult at the natural end of the run; `revise` continues with the advice as the steer. Bounded by `maxConsultsPerRun` and `limits.maxContinuations`.

An unparseable verdict, a model error, a timeout, or the cap being reached **allows** (tool) or **ends normally** (finish), with `status: "skipped"` or `"capped"`. An advisor outage cannot block work.

## Completion validation

`validate` makes "done" a checked claim:

```ts
delegate({
  children: {
    verifier: { inherit: ["@arnilo/prism-tools-coding"], tools: { only: ["read", "grep", "glob", "shell"] }, hidden: true, limits: { maxTotalTokens: 100_000 } },
  },
});
advisor({ model: "hyper/<strong-model>", tool: false, validate: { engine: { child: "verifier" }, criteria: "Tests pass and the changelog is updated.", maxRounds: 2 } });
```

Each round, the validator reads `selectTranscript(payload.history, validate.context)` with the run's task pinned, then asks for `{ "verdict": "complete" | "incomplete", "missing": string[], "evidence": string }`.

- `complete` → the run ends and the event is `verified`.
- `incomplete` with rounds left → `{ continue: { reason, steer: "Missing: … Finish these, then state the evidence." } }`, event `incomplete`.
- `incomplete` with no rounds left → the run ends, event `unverified`.

**Fails closed.** A model or child error, a timeout, an unparseable verdict, a missing service or unknown child (`validator_engine_unavailable`), never yields `verified`. With `onError: "continue"` and rounds left the run continues with `Validation could not run (<reason code>). Check your work explicitly and state the evidence.`; otherwise the run ends. The event is `error` either way.

- `engine: "model"` (default) is one model call per round. `engine: { child }` is one delegation through the `delegate` service, bounded by that child's own `limits`; give it tight limits and read-only tools.
- `maxRounds` defaults to 2, hard cap 10. Rounds are counted by the run's continuations and are **not** spent from `maxConsultsPerRun`. The effective cap is the smaller of `maxRounds` and the continuations left, so a host with `limits.maxContinuations: 0` gets no validation rounds.
- The task is captured from the run's input (the `run.input` hook carries the run id), so a mid-run steer cannot replace it. A run whose input was empty (a resume, a restart) falls back to the first user message of the history, and the event says `task: "inferred"`.
- Rounds are not a gate the runtime enforces on the result: **the host treats a run as done only when the run's last `validator.verdict` is `verified`**. A run reporting `completed` alone does not mean verified.

Combining with fixed checks: JSON hooks' `Stop` command and the coding package's goal-verify run commands and tests; `validate` covers what needs judgment. Use both when you want both.

## Advisor or delegate child?

| | `advisor` | `delegate` child |
| --- | --- | --- |
| Work | one model call, advisory | its own agent loop, tools, limits |
| Acts? | no | yes |
| Use for | a second opinion, reviewing an answer or a planned tool call | doing work, checking evidence with tools |

For a reviewed child that can act, use `delegate` with `context: { lastTurns }` and a report contract. `validate.engine: { child }` is the middle ground: a hidden reviewer that can check evidence but not change the result.

## Cost, security, and failure behavior

- Each consult is one model call: about `context.maxChars / 4` tokens in and `adviceMaxChars / 4` out. The worst case per run is `maxConsultsPerRun` calls. `beforeTools` adds that latency before every listed tool.
- `validate` costs nothing unless set: one model call per round, or one delegation per round with a child engine (bounded by the child's limits — 500,000 tokens by default, so set tight ones).
- The advisor sees only the redacted branch slice. It has no tools and cannot act. The model cannot raise `maxConsultsPerRun`, `context`, or `adviceMaxChars`; `context` comes only from host config.
- The validator child gets only its configured packages through the `delegate` service; this package cannot add tools or packages to it, and a malformed or oversized child verdict is an `error`, never `verified`.
- Task capture keeps one message list per active run in memory, bounded to the last 32 runs.

## Example

See `examples/advisor.ts` (advise + a `revise`→`proceed` finish review) and `examples/validator.ts` (an `incomplete`→`complete` validation, printed as verdict events).
