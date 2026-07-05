# Compaction conformance

## What it does

Compaction conformance helpers are dependency-free assertions for `CompactionStrategy` adapter tests. They exercise the summary-result shape, secret redaction, and abort observation of any `CompactionStrategy` without network or credentials.

Exported from `@arnilo/prism/testing/compaction-conformance`:

- `assertCompactionStrategyConforms(strategy, options?)`
- `CompactionConformanceOptions`

## When to use it

Use this helper when implementing a custom `CompactionStrategy` (the core default strategy and the first-party LLM compaction package both conform). It asserts:

- `compact()` returns a `CompactionResult` with a non-empty string `summary`
- known secrets are redacted from the summary and any returned `entries`
- (when `exerciseAbort: true`) an already-aborted `signal` is observed

## Inputs / request

```ts
import { assertCompactionStrategyConforms } from "@arnilo/prism/testing/compaction-conformance";
import type { CompactionStrategy } from "@arnilo/prism";

const { summary } = await assertCompactionStrategyConforms(myStrategy, {
  secrets: ["api-key-value"],
  exerciseAbort: true,
});
```

`CompactionConformanceOptions`:
- `secrets?: readonly string[]` — secrets that must not appear in the summary or returned entries
- `exerciseAbort?: boolean` — assert the strategy observes an already-aborted `signal`

## Outputs / response / events

Returns `Promise<{ summary: string }>`; throws a plain `Error` on the first contract violation. No events, no runner.

## Request/response example

```ts
import { assertCompactionStrategyConforms } from "@arnilo/prism/testing/compaction-conformance";

await assertCompactionStrategyConforms(myStrategy, { secrets: ["secret-value"] });
// throws if the summary is empty, a secret leaks into the summary, or a
// secret leaks into the returned entries.
```

## Implementation example

```ts
import { assertCompactionStrategyConforms } from "@arnilo/prism/testing/compaction-conformance";
import { createDefaultCompactionStrategy } from "@arnilo/prism";

await assertCompactionStrategyConforms(
  createDefaultCompactionStrategy({ keepRecentEntries: 1, secrets: ["secret-value"] }),
  { secrets: ["secret-value"] },
);
```

## Extension and configuration notes

- The helper builds a tiny two-message fixture; it does not call your strategy with production entries.
- Abort observation is optional because not every strategy performs async work that can be aborted.

## Security and performance notes

- No credentials, no network, no real secrets required; pass fake secret strings.
- The helper asserts redaction of exactly the secrets you supply (mirroring `createSecretRedactor`'s exact-match behavior); it does not detect arbitrary secret patterns.

## Related APIs

- [Compaction and retry](compaction-and-retry.md)
- [Provider conformance](provider-conformance.md)
- [Session store conformance](session-store-conformance.md)
