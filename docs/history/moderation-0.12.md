# Moderation

## What it does

`ModerationProvider` is the provider-neutral content-classification contract:
`moderate({ input })` sends text to a provider classifier and returns per-category
`{ score, flagged }` verdicts keyed by a provider-neutral vocabulary (plan 061
Task 6). Raw provider category/score fields ride along unmodified as `raw` for
host-side audits. Scores and flagged booleans are **provider output** — core
bakes in no policy: thresholds, blocking, and routing stay host-owned
([host security](host-security.md)). The first-party adapter is
[`createOpenAIModerationProvider`](providers/openai.md) (`POST /v1/moderations`,
`omni-moderation-latest`); offline conformance runs via
`runModerationConformance` from `@arnilo/prism/testing/provider-conformance`.

## When to use it

Use it when a host or guardrail seam wants pre-flight or post-hoc text
classification from a vendor classifier with portable category names. Do not use
it for local policy enforcement — Prism core never decides what is blocked;
hosts read `flagged`/`score` and apply their own thresholds.

## Inputs / request

| Field | Type | Meaning |
| --- | --- | --- |
| `input` | `string \| readonly string[]` | One input per call, or a batch (results match input arity and order). |
| `model` | `string?` | Classification model; adapter default `omni-moderation-latest`. |
| `signal` | `AbortSignal?` | Cancellation. |

Adapter options: `apiKey` (`CredentialValueSource` — resolved per call, redacted
from errors), `baseUrl`, `fetch` (fake transport for offline tests), `headers`,
`model`. Input caps reject typed before network I/O
(`OPENAI_MODERATION_INPUT_MAX_CHARS`, 100,000 chars — no provider-documented limit,
conservative ceiling).

## Outputs / response / events

| Field | Type | Meaning |
| --- | --- | --- |
| `flagged` | `boolean` | Provider's own top-level decision, verbatim. |
| `categories` | `Record<string, { score, flagged }>` | Verdicts keyed by the neutral vocabulary (see below); unknown raw categories pass through untouched. |
| `categories[k].score` | `number` | Provider-reported score in [0,1] — never locally recomputed. |
| `raw` | `JsonObject?` | Provider-native response fields for audits. |

Neutral category vocabulary (`MODERATION_CATEGORIES`): `harassment`,
`harassment/threatening`, `hate`, `hate/threatening`, `illicit`,
`illicit/violent`, `self-harm`, `self-harm/instructions`, `self-harm/intent`,
`sexual`, `sexual/minors`, `violence`, `violence/graphic`. The OpenAI adapter
maps via a data-driven table; vendor categories missing from the table surface
under their raw names so no provider signal is dropped.

Failures throw `ModerationError` with a stable `code`: `empty_input`,
`input_too_large`, `unsupported_model` (via `assertModerationSupported` when the
host checks `ModelCapabilities.moderation`), `request_failed` (non-2xx,
secret-redacted), `response_malformed` (missing `results`, non-numeric scores
downstream).

## Request/response example

```json
{ "model": "omni-moderation-latest", "input": "text to classify" }
```

## Implementation example

```ts
import { createOpenAIModerationProvider } from "@arnilo/prism-providers/openai";
import { runModerationConformance } from "@arnilo/prism/testing/provider-conformance";

const moderation = createOpenAIModerationProvider({ apiKey: process.env.OPENAI_API_KEY });
const result = await moderation.moderate({ input: text });
// Host-owned policy — Prism applies no thresholds:
if (result.categories.violence?.score ?? 0 > myPolicy.violenceCutoff) { ... }

// Batch where the provider allows it (arity- and order-preserving):
const batch = await moderation.moderate({ input: ["first", "second"] });

// Offline conformance (fake transport, no network):
await runModerationConformance({
  provider: createOpenAIModerationProvider({ apiKey: "sk-test", fetch: fakeFetch }),
  model: "omni-moderation-latest",
  maxInputChars: 100_000,
  sample: { input: "conformance probe" },
});
```

## Extension and configuration notes

- Implement `ModerationProvider` for other vendors; the contract is structural —
  no base class, no registry. Keep the data-driven category table per provider;
  never hard-code category logic in call paths.
- Models declare support with `capabilities.moderation`; hosts gate with
  `modelSupportsModeration` / `assertModerationSupported`, mirroring the
  embeddings/speech/image/video guard pattern.
- Guardrail seams consume the contract at the host layer: wire `moderate()`
  into request/output inspection stages; core stays policy-free by design.

## Security and performance notes

- API keys resolve through the existing `CredentialValueSource` seam and are
  redacted from every thrown error; no new secret paths.
- Classification responses are read through the bounded JSON reader
  (`OPENAI_MODERATION_MAX_RESPONSE_BYTES`, 8 MiB) — oversized payloads reject
  instead of buffering.
- One provider request per input; batch inputs loop the same bounded path.
- Inputs, verdicts, and raw payloads are never logged by core; error messages
  carry status and a redacted body only.

## Related APIs

- [Host security](host-security.md): policy ownership — thresholds and blocking
  stay host-side.
- [Provider conformance](provider-conformance.md): `runModerationConformance`
  and the offline conformance matrix.
- [Provider packages](provider-packages.md): subpath import rules for
  `@arnilo/prism-providers/openai`.
