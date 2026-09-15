# Plan 074 attention-compiler measurements

Plan 074 shipped the cache-stable Attention Compiler (ratio gate, sticky thinking strip,
deterministic tool stubs), the host-programmable compaction trigger, the `attention_compiled`
event, and the `truncated` follow-up seam. Its Further Actions section starts with **measure
before extending**: without a number, another compiler stage is guesswork. This file is that
number, and it is regenerated and re-checked by the gate.

## How the number is produced

`scripts/benchmark-scenarios/attention-compiler.mjs`, run through the parameterized runner:

```bash
node scripts/benchmark.mjs --scenario attention-compiler
```

Hermetic and credential-free: it assembles a synthetic 8-turn session through the real
`assembleProviderInput` (assistant turns with tool calls, small rows for the first 3 turns and
8 KiB tool results after, an `echo` tool, a 6 000-token input cap at `triggerRatio` 0.5), once
compiler-off and once compiler-on, and derives four things from the assembled requests:

1. **stub savings** — input tokens and payload bytes before/after the stages,
2. **cache behaviour** — the longest common prefix between consecutive turns (a *bust* is a turn
   whose stable prefix shrank, i.e. the previous turn's bytes were rewritten),
3. **restart churn** — the same fixture re-assembled under a relaxed gate (0.99) with a restored
   sticky frontier versus a cleared one, which is what a process restart looks like,
4. **the follow-up policy** — `createAttentionTruncationTrigger` fed from the reports and
   resolved through `resolveShouldCompact` on the same fixture.

The scenario fails the gate on any envelope breach (`scripts/budgets.json#attentionCompiler`);
`scripts/attention-measurements.test.mjs` re-runs it and compares the numbers below.

## Recorded numbers

```json
{
  "fixture": {
    "turns": 8,
    "payloadBytes": 8192,
    "inputCap": 6000,
    "triggerRatio": 0.5,
    "volatileBlockBytes": 1024
  },
  "results": [
    {
      "name": "input_tokens_off",
      "value": 32716,
      "unit": "tokens"
    },
    {
      "name": "input_tokens_on",
      "value": 11886,
      "unit": "tokens"
    },
    {
      "name": "token_reduction",
      "value": 0.6367,
      "unit": "ratio"
    },
    {
      "name": "stub_bytes_total",
      "value": 83310,
      "unit": "bytes"
    },
    {
      "name": "mutated_turns",
      "value": 4,
      "unit": "turns"
    },
    {
      "name": "prefix_busts_off",
      "value": 0,
      "unit": "turns"
    },
    {
      "name": "prefix_busts_on",
      "value": 1,
      "unit": "turns"
    },
    {
      "name": "prefix_min_hit_bytes_on",
      "value": 192,
      "unit": "bytes"
    },
    {
      "name": "uncached_tail_bytes_off",
      "value": 80298,
      "unit": "bytes"
    },
    {
      "name": "uncached_tail_bytes_on",
      "value": 48767,
      "unit": "bytes"
    },
    {
      "name": "volatile_uncached_tail_bytes",
      "value": 37759,
      "unit": "bytes"
    },
    {
      "name": "pinned_uncached_tail_bytes",
      "value": 18411,
      "unit": "bytes"
    },
    {
      "name": "volatile_block_resend_bytes",
      "value": 19348,
      "unit": "bytes"
    },
    {
      "name": "resume_churn_avoided_bytes",
      "value": 32867,
      "unit": "bytes"
    },
    {
      "name": "compact_decision_after_truncated_turns",
      "value": true,
      "unit": "boolean"
    }
  ]
}
```

## What the numbers say

- **Stubs dominate this fixture: ' + f'{r["results"][2]["value"]*100:.1f}' + '% fewer input tokens** (' + f'{r["results"][0]["value"]:,}' + ' → ' + f'{r["results"][1]["value"]:,}' + ' tokens over 8 turns, ' + f'{r["results"][3]["value"]:,}' + ' payload bytes removed by ' + str(r["results"][4]["value"]) + ' mutating turns). A new stage (layered eviction, LLM-in-compiler, provider-native editing) has to beat that on real sessions before it earns its cache risk.
- **The compiler costs one cache bust, not one per turn.** Compiler-off is strictly append-only (0 busts). Compiler-on busts once — the turn where the gate first trips and the older rows are rewritten — and every later turn re-derives byte-identical stubs (deterministic stub + sticky frontier), so the prefix grows again from there.
- **A volatile prefix block is the real cache tax, and it is not the compiler's.** With a context provider whose block changes each turn, everything behind the block is re-sent on every turn: ' + f'{r["results"][12]["value"]:,}' + ' bytes across the fixture. Pinning the block (resolve once per session — four lines in host code, shown below) drops the uncached tail to ' + f'{r["results"][11]["value"]:,}' + ' bytes, which is the fixture's unavoidable new-turn content. The compiler deliberately does not pin provider blocks (its locked fork: it never drops, stubs, or rewrites them), so this stays a host recipe; revisit only if a host measures a pin it cannot write.
- **A restored frontier is worth ' + f'{r["results"][13]["value"]:,}' + ' bytes on resume.** Under a relaxed gate the resumed turn keeps its stub only because the frontier rode the checkpoint (`persistSessionState`), which is exactly the one-re-stub cost the plan deferred on evidence.
- **`truncated` turns are actionable.** Feeding the reports into `createAttentionTruncationTrigger` arms the compact-once policy on the same fixture, so the host-side follow-up is a documented three-liner rather than a new SDK mode.

## Host recipe: pin a volatile context block

```ts
const pinned = new Map<string, ContextBlock[]>();
const provider: ContextProvider = {
  name: "om-pinned",
  async resolve(context) {
    const key = context.sessionId ?? "session";
    pinned.set(key, pinned.get(key) ?? (await om.resolve(context)));
    return pinned.get(key);
  },
};
```

Pinning trades freshness for cache hits: the block freezes at its first value for the session.
That trade-off belongs to the host (and to the provider that renders it), which is why the
compiler keeps rendering whatever the provider emits.

## Reproducing and re-checking

```bash
node scripts/benchmark.mjs --scenario attention-compiler            # print the report
node --test scripts/attention-measurements.test.mjs                 # gate: numbers match this file
```
