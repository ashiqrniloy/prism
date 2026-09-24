# Prefix stability conformance

## What it does

Prefix stability conformance drives a real agent session through two staggered skill loads and asserts that each provider request keeps a byte-identical leading prefix with its predecessor — messages **and** tool schemas. It is the host-runnable form of the golden check behind [provider caching](provider-caching.md) and progressive skill disclosure: a late `load_skill` must append a body after the stable prefix instead of rewriting it.

Exported from `@arnilo/prism/testing/prefix-stability-conformance`:

- `runPrefixStabilityConformance(options)`
- `scorePrefixStability(requests, options?)` — score a capture the host already holds; no session, no provider call
- `PrefixStabilityConformanceOptions`
- `PrefixStabilityConformanceResult`
- `ScorePrefixStabilityOptions`
- `PrefixStabilitySample`
- `PrefixStabilityResetDetail`

## When to use it

Use it when a host owns any part of prompt assembly — custom `inputBuilder`, `promptBuilder`, context providers, instruction injectors, input/prompt middleware, or an explicit `inputLayout` — and wants to prove that progressive disclosure still holds the cache prefix. A host that already holds captured `ProviderRequest`s scores them with `scorePrefixStability` instead of re-running the fixture; pass the session's `tailSegments` map if you have it. A wrong or empty map yields a wrong number, not an error, and never a fabricated `1`. The runner:

- installs a fixture provider (no network) that loads `skills[0]` on the first turn and `skills[1]` on the second, two provider requests per turn — and, when the host runs an attention compiler, carries a deterministic reasoning block per skill-load round so the compiler's thinking stage has real content to fold;
- keeps everything else in `host` exactly as production: system prompt, context providers, builders, middleware, disclosure settings;
- measures, for each consecutive captured request, the byte-shared prefix as a fraction of the previous request and fails below `minContinuity` (default `0.95`);
- reports that fraction twice: `minContinuity` (provider-visible prefix, what the prompt cache pays for) and `cacheableContinuity` (the same measurement with the session's tail segments removed), and asserts whichever `assertOn` selects (default `providerPrefix`);
- fails when a loaded body never reaches a provider request, so a builder that drops the tail cannot pass vacuously.

## Inputs / request

```ts
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";

const result = await runPrefixStabilityConformance({
  host: {
    model: { provider: "anthropic", model: "claude-sonnet-4-6" },
    systemPrompt: { text: "..." },
    context: [projectContextProvider],
  },
  skills: [skillA, skillB],
  assertOn: "cacheablePrefix",
});
```

`PrefixStabilityConformanceOptions`:
- `host` — the host's `AgentConfig` minus `provider`, `providerSource`, and `skills`; the runner supplies the fixture provider and fixture skill registry
- `skills` — exactly two distinct `Skill` values with non-empty `instructions`, loaded in turn order
- `minContinuity?` — minimum shared-prefix fraction between consecutive requests (default `0.95`); always measured against the provider-visible prefix
- `assertOn?` — `"providerPrefix"` (default) gates the run on the provider-visible prefix; `"cacheablePrefix"` gates it on the tail-aware measurement instead, for an eager or body-heavy host that deliberately re-sends bodies after the stable prefix
- `allowedResets?` — how many request pairs may break below `minContinuity` (default `0`, today's behavior). Set `1` for an assembly that folds, compacts, or evicts exactly one boundary; more resets than declared fail, and fewer fail too, because a fixture that was supposed to invalidate the prefix and never did cannot pass vacuously. Each allowed gap is also a `resetDetails` row
- `foldableToolResultBytes?` — installs a runner-owned `prefix_stability_bulk` fixture tool that returns exactly this many bytes of generated text and adds a second tool call for it beside `load_skill` in the same round, so the attention compiler's tool-result stage has a foldable row. Unset, the capture is byte-identical to today (four requests, one `load_skill` call each)
- `inputs?` — the two turn inputs (default fixed strings, so runs stay comparable across hosts)

## Outputs / response / events

Returns `Promise<{ requests: number; minContinuity: number; cacheableContinuity: number; resets: readonly number[]; resetDetails: readonly PrefixStabilityResetDetail[] }>`: the captured request count (four), the two lowest shared-prefix fractions, and one detail row per reset. Throws a plain `Error` naming the offending request pair and the measured percentage on the first violation. No events, no test runner, no network. Detail rows are indexes and fractions only — no message text.

A gap below `minContinuity` **on the metric `assertOn` selects** is collected as a reset instead of failing inside the loop: `resets` holds the 1-based index of the request that broke (the later request of the pair, ascending). `resetDetails[i].request` equals `resets[i]`; `fraction` is that selected metric and `cacheableFraction` is the tail-excluded fraction for the same pair. A run with no gap returns `[]` for both. With the default `allowedResets: 0` the first reset fails the run exactly as before, now adding the observed reset list to the message; `allowedResets: 1` lets a single documented boundary (an attention fold, a compaction, a budget eviction) pass while every other pair must stay byte-stable, and the result carries exactly that one detail row.

Both numbers measure the same consecutive request pairs, byte for byte:

- **`minContinuity`** — the provider-visible prefix, messages **and** tool schemas as sent on the wire. This is what the prompt cache can keep paying for, and its meaning is frozen: `0.95` default, unchanged by `assertOn`.
- **`cacheableContinuity`** — the same fraction recomputed after removing this session's tail segments (loaded skill bodies, resources moved to the tail) from **both** requests of each pair. A host whose provider-visible fraction dips only because of tail bodies reads `1` here.

Tail segments are read from the session's own `tailSegments` map — the exact `Message` objects assembly appended — matched by object identity first and by serialized-value equality for a `promptBuilder` that clones messages. Nothing is added to the provider payload and no host content is pattern-matched. When no captured request carried a tail segment (a builder that renders bodies elsewhere), `cacheableContinuity` equals `minContinuity`; it is not reported as `1`. `scorePrefixStability` uses the same rule: omit `tailSegments`, or pass a map that matches nothing, and the two fractions stay equal.

`scorePrefixStability(requests, options?)` returns `{ minContinuity, cacheableContinuity, resets, resetDetails }` for a list the host already captured. `resets` follows the provider-visible prefix unless `options.assertOn` is `"cacheablePrefix"` (the runner passes its own `assertOn` so the two surfaces share one measurement). `resetDetails[i].request` equals `resets[i]`; each row is `{ request, fraction, cacheableFraction }` — indexes and fractions only, never message text. Fewer than two requests throws a plain `Error` naming the count.

## Request/response example

```ts
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";

const { minContinuity, cacheableContinuity, resets } = await runPrefixStabilityConformance({
  host: myAgentAssembly,
  skills: [alphaSkill, betaSkill],
});
// throws: "request 2 → 3 kept 41.2% of the previous provider prefix (minimum 95.0%), and 1 pair(s)
// broke below it (resets [3] of 3 request pairs, allowedResets 0)"
// when a context block or the skill catalog is recomposed in place.
// minContinuity: 0.98 (provider-visible) · cacheableContinuity: 1 (tail bodies excluded) · resets: []
```

## Implementation example

```ts
import { runPrefixStabilityConformance, scorePrefixStability } from "@arnilo/prism/testing/prefix-stability-conformance";

// The runner owns the provider and skills, so the same helper is the negative control too:
// add a deliberately volatile context provider to prove the assertion can fail.
await runPrefixStabilityConformance({
  host: {
    model: myModel,
    context: [{ name: "volatile", resolve: () => [{ title: "Now", content: `${Date.now()}` }] }],
  },
  skills: [alphaSkill, betaSkill],
});

// A host that captures its own provider requests (middleware, proxy, or an adapter tap):
const sample = scorePrefixStability(captured, { tailSegments: sessionTails, minContinuity: 0.95 });
// → { minContinuity: 0.98, cacheableContinuity: 1, resets: [], resetDetails: [] }
// With no tail map a deliberate tail re-send counts against the score:
// → { minContinuity: 0.71, cacheableContinuity: 0.71, resets: [2], resetDetails: [{ request: 2, fraction: 0.71, cacheableFraction: 0.71 }] }
```

## Extension and configuration notes

- Loaded skill bodies and URI resources are re-sent after new transcript content by design (the tail is append-only, not immutable); a body larger than `1 - minContinuity` of the whole prompt lowers the provider-visible fraction without indicating a prefix regression. For such a host assert `assertOn: "cacheablePrefix"` (the tail-aware number stays `1`), or raise the fixture's stable prefix or lower `minContinuity`.
- A volatile leading context provider lowers **both** fractions: context is not a tail segment, so `cacheablePrefix` cannot mask a real prefix regression.
- Prompt builders that render skill bodies outside the tail are welcome — the check measures the provider-visible prefix, not where the body sits.
- Attention/tool-result folding and context-budget eviction are explicit invalidation boundaries: with the default `allowedResets: 0` the run fails at that turn. Declare the boundary instead of loosening `minContinuity` — one fold is one reset, so a second reset, a post-fold rewrite, or a fold that never happened still fails:

  ```ts
  const result = await runPrefixStabilityConformance({
    host: {
      ...myAssembly,
      // A predicate gate must settle under the stages it triggers: one that still fires after folding
      // fails closed with `AttentionBudgetError` instead of reporting a reset. This one opens on a
      // run's opening round while the carried request is over the floor, and the fold drops it back.
      attentionCompiler: {
        maxInputTokens: 4_000,
        keepLast: 0,
        thinkingKeepTurns: 0,
        trigger: { kind: "predicate", shouldFold: (state) => state.turn === 1 && state.estimatedInputTokens >= 1_350 },
      },
    },
    skills: [alphaSkill, betaSkill],
    allowedResets: 1, // add `assertOn: "cacheablePrefix"` when tail re-sends should not count either
  });
  result.resets; // [3] — the request after the fold; every other pair stayed append-only
  result.resetDetails; // [{ request: 3, fraction, cacheableFraction }] — same gap, both fractions
  ```

- Both compiler stages are proven by the runner. The deterministic reasoning block proves the thinking stage; `foldableToolResultBytes` proves the **tool-result** stage — the bulk row becomes the stub at the reset while the sibling `load_skill` confirmation stays byte-identical (the shrink guard leaves the small row alone). The fixture tool is installed only when the option is set, and its payload is generated text, never host content.

- Documented invalidation boundaries — what `resets` is expected to name. Each row is pinned by a fixture in [`src/__tests__/invalidation-inventory.test.ts`](../src/__tests__/invalidation-inventory.test.ts) that asserts the boundary *position* (message index, and tool index for schemas), so a reordering of the cache-aware layout fails that suite instead of silently relocating a boundary:

  | Segment | Boundary in the default `cache_aware` layout | Owner |
  | --- | --- | --- |
  | Per-turn instruction-injector text (`on_input`) | Message 0: merged into the leading system prompt — never moved behind the transcript | [Input and prompt assembly](input-and-prompt-assembly.md) |
  | Host / injector context blocks | The context slot: after the hoisted leading system messages, before skills | [Context and skills](context-and-skills.md) |
  | Observational-memory blocks (`observational-memory`, `recent-messages`) | The same context slot; re-rendering identical blocks keeps the prefix byte-identical | [Context and skills](context-and-skills.md) |
  | Compaction summaries | Right after the leading system prompt while nothing user-role precedes it; a leading attachment moves the summary behind the context and skill slots | [Input and prompt assembly](input-and-prompt-assembly.md) |
  | Pending tool results / current input | The suffix: a result inserts immediately before the current input, so that input is the round's boundary | [Input and prompt assembly](input-and-prompt-assembly.md) |
  | `contextBudget` eviction | The first evicted group in the documented drop order (tool results → history → summaries → context → skills → attachments). Tool results, history, the lowest-priority context block, skill-body demotion, and the newest attachment are pinned at their message index in [`src/__tests__/invalidation-inventory.test.ts`](../src/__tests__/invalidation-inventory.test.ts); the full drop order stays behavioral in [`src/__tests__/context-budget.test.ts`](../src/__tests__/context-budget.test.ts) | [Input and prompt assembly](input-and-prompt-assembly.md) |
  | Tool-schema selection | `request.tools` only: gaining or losing a schema leaves every message byte-identical, while a changed description is a boundary at that schema | [Provider caching](provider-caching.md) |
  | Attention-compiler / tool-result fold | In place at the fold frontier: the oldest stripped or stubbed row is the boundary — one reset, declared with `allowedResets` | [Attention compiler](attention-compiler.md) |
  | Skill bodies and URI resources (tail) | After the transcript, append-only: a newly loaded body never invalidates the prefix and `cacheableContinuity` stays `1` | [Input and prompt assembly](input-and-prompt-assembly.md) |

- Switching `inputLayout` is an explicit, documented invalidation, not a stability claim — the whole
  order moves ([`legacy` includes the resolved context and skill slots ahead of the instruction
  groups](input-and-prompt-assembly.md)). The same fixtures are pinned under both `cache_aware` and
  `legacy` in [`src/__tests__/invalidation-inventory.test.ts`](../src/__tests__/invalidation-inventory.test.ts):
  the injector-context boundary is message 2 under `cache_aware` and message 1 under `legacy`, and the
  summary boundary is 1 and 3. A layout change that relocates either boundary fails that suite.

## Security and performance notes

- No credentials, no network, no real skills required; the fixture provider is a local generator.
- Four small provider requests per run, in-memory session store (unless `host.store` says otherwise); cheap enough for a conformance suite.

## Related APIs

- [Provider caching](provider-caching.md)
- [Input and prompt assembly](input-and-prompt-assembly.md)
- [Context and skills](context-and-skills.md)
- [Provider conformance](provider-conformance.md)
- [Compaction conformance](compaction-conformance.md)
