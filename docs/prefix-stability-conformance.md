# Prefix stability conformance

## What it does

Prefix stability conformance drives a real agent session through two staggered skill loads and asserts that each provider request keeps a byte-identical leading prefix with its predecessor — messages **and** tool schemas. It is the host-runnable form of the golden check behind [provider caching](provider-caching.md) and progressive skill disclosure: a late `load_skill` must append a body after the stable prefix instead of rewriting it.

Exported from `@arnilo/prism/testing/prefix-stability-conformance`:

- `runPrefixStabilityConformance(options)`
- `PrefixStabilityConformanceOptions`
- `PrefixStabilityConformanceResult`

## When to use it

Use it when a host owns any part of prompt assembly — custom `inputBuilder`, `promptBuilder`, context providers, instruction injectors, input/prompt middleware, or an explicit `inputLayout` — and wants to prove that progressive disclosure still holds the cache prefix. The runner:

- installs a fixture provider (no network) that loads `skills[0]` on the first turn and `skills[1]` on the second, two provider requests per turn;
- keeps everything else in `host` exactly as production: system prompt, context providers, builders, middleware, disclosure settings;
- measures, for each consecutive captured request, the byte-shared prefix as a fraction of the previous request and fails below `minContinuity` (default `0.95`);
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
});
```

`PrefixStabilityConformanceOptions`:
- `host` — the host's `AgentConfig` minus `provider`, `providerSource`, and `skills`; the runner supplies the fixture provider and fixture skill registry
- `skills` — exactly two distinct `Skill` values with non-empty `instructions`, loaded in turn order
- `minContinuity?` — minimum shared-prefix fraction between consecutive requests (default `0.95`)
- `inputs?` — the two turn inputs (default fixed strings, so runs stay comparable across hosts)

## Outputs / response / events

Returns `Promise<{ requests: number; minContinuity: number }>`: the captured request count (four) and the lowest shared-prefix fraction observed. Throws a plain `Error` naming the offending request pair and the measured percentage on the first violation. No events, no test runner, no network.

## Request/response example

```ts
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";

const { minContinuity } = await runPrefixStabilityConformance({
  host: myAgentAssembly,
  skills: [alphaSkill, betaSkill],
});
// throws: "request 2 → 3 kept 41.2% of the previous provider prefix (minimum 95.0%)"
// when a context block or the skill catalog is recomposed in place.
```

## Implementation example

```ts
import { runPrefixStabilityConformance } from "@arnilo/prism/testing/prefix-stability-conformance";

// The runner owns the provider and skills, so the same helper is the negative control too:
// add a deliberately volatile context provider to prove the assertion can fail.
await runPrefixStabilityConformance({
  host: {
    model: myModel,
    context: [{ name: "volatile", resolve: () => [{ title: "Now", content: `${Date.now()}` }] }],
  },
  skills: [alphaSkill, betaSkill],
});
```

## Extension and configuration notes

- Loaded skill bodies and URI resources are re-sent after new transcript content by design (the tail is append-only, not immutable); a body larger than `1 - minContinuity` of the whole prompt lowers the fraction without indicating a prefix regression. Raise the fixture's stable prefix or lower `minContinuity` for body-heavy hosts.
- Prompt builders that render skill bodies outside the tail are welcome — the check measures the provider-visible prefix, not where the body sits.
- Attention/tool-result folding and context-budget eviction are explicit invalidation boundaries: run this check on an assembly path that neither folds nor evicts, or expect the fold to reset the measured prefix at that turn.

## Security and performance notes

- No credentials, no network, no real skills required; the fixture provider is a local generator.
- Four small provider requests per run, in-memory session store (unless `host.store` says otherwise); cheap enough for a conformance suite.

## Related APIs

- [Provider caching](provider-caching.md)
- [Input and prompt assembly](input-and-prompt-assembly.md)
- [Context and skills](context-and-skills.md)
- [Provider conformance](provider-conformance.md)
- [Compaction conformance](compaction-conformance.md)
