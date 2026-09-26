# System One decision calls

## What it does

`@arnilo/prism-providers/decisions` is the host-facing typed decision call over the shared `POST /v1/systemone` wire client used by both [TypeSafe Jev](typesafe.md) and [Laya](laya.md). One call returns the raw `answers` (noul probability, choice probabilities and confidence, score with legend and distribution), the checkpoint that actually answered, mapped usage, and wall-clock timing. Nothing is coerced: an answer is never converted to a boolean, rounded to an integer, replaced by a synthetic `0.5`, or flattened to a schema value. The subpath re-exports the question/answer types, the typed error family, the pre-fetch limits, and the schema compiler (`compileSystemOneQuestions`, `compileSystemOneState`) for hosts that build requests from JSON Schema or Prism messages.

## When to use it

Use it when a host needs calibrated decision output for confidence gating, shadow classification, calibration runs, or custom telemetry, and wants the raw probabilities plus the responding checkpoint. Use the `typesafe` or `laya` `AIProvider` adapter instead when the call is a normal structured-output request and only schema-valid JSON text is needed. The call is host-invoked; it never registers a provider, model, tool, or automatic agent hook, and a decision answer is never effect authority.

## Inputs / request

`askSystemOneDecisions(body, options, signal?)` takes the wire body plus client options.

| Body field | Type | Purpose |
| --- | --- | --- |
| `model` | `string` | Sent verbatim. Advisory: the answering checkpoint can differ and is reported in the result. |
| `state` | `string`, JSON object, or array | Conversation content only. Questions must never be written into `state` — the model judges that text instead of answering the question. |
| `questions` | `Record<string, SystemOneQuestion>` | Keyed by question id; 1–256 questions. `noul` takes optional `criteria.true`/`criteria.false` strings, `choice` an object of 2–255 option → description (`string` or `null`), `score` an array of 2–10 level descriptions. Every question needs non-empty `instructions`. |

| Option | Type | Purpose |
| --- | --- | --- |
| `provider` | `string` | Label used in errors and credential resolution, e.g. `"TypeSafe Jev"` or `"Laya"`. |
| `baseUrl` | `string` | Base URL without the path; `/v1/systemone` is appended and trailing slashes are trimmed. |
| `apiKey` | `CredentialValueSource` | Optional Bearer credential, resolved once per call under `provider`. Absent means no `Authorization` header (anonymous `laya-serve`). |
| `fetch` | `typeof fetch` | Fetch implementation for tests and hosts. |
| `maxRetries`, `baseDelayMs`, `maxDelayMs`, `jitter`, `random` | numbers | Forwarded to the shared bounded retry policy; retries after the first attempt default to 2, with jittered backoff honoring `Retry-After`. |
| `timeoutMs` | `number` | Whole-call deadline in milliseconds, retries included. Must be a positive finite number. |
| `maxStateBytes` | `number` | Serialized `state` byte ceiling. Default `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` (262,144). |
| `signal` | `AbortSignal` | Third argument. Composes with `timeoutMs`: whichever aborts first ends the call. |

Pre-fetch gates run before credential resolution or fetch: question count and criteria bounds mirror the schema compiler, `state` must serialize under `maxStateBytes`, `instructions` must be non-empty, and `model`/`timeoutMs`/`maxStateBytes` must be valid.

## Outputs / response / events

`SystemOneDecisionResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `model` | `string` | Checkpoint that actually answered. |
| `answers` | `Record<string, SystemOneAnswer>` | Raw answers by question id: `noul` probability, `choice` with `choice`, `probabilities`, and `confidence`, `score` with `score`, optional `legend`, `probabilities`, and `confidence`. |
| `usage` | `Usage?` | Input tokens mapped as `inputTokens`/`totalTokens`; `outputTokens` stays 0. Omitted when the API reports none. |
| `timingMs` | `number` | Wall-clock milliseconds for the whole call, retries included. |

There is one HTTP round trip per attempt and no streaming, polling, or extra discovery request.

Failures are typed and never become a decision:

| Error | When | `status` |
| --- | --- | --- |
| `SystemOneError` | Local bound violation (no request sent), or any other non-retryable HTTP status | `0` for local violations |
| `SystemOneAuthError` | `401`; never retried | `401` |
| `SystemOneInvalidRequestError` | `422`; message carries the API field detail | `422` |
| `SystemOneRetryExhaustedError` | `429`/`5xx` survived every bounded retry | last status |
| `SystemOneAbortedError` | Caller signal or `timeoutMs` deadline ended the call | `0` |

Other transport failures (for example a DNS error) propagate unchanged. HTTP error messages are built through the redacting error builder, so an echoed body and the API key never reach logs unredacted.

## Request/response example

```json
{
  "model": "jev-latest",
  "state": "rm -rf ./build",
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "How should this be handled?",
      "criteria": { "run": "run", "ask": "ask", "reject": "reject" }
    },
    "irreversible": { "type": "noul", "instructions": "Would running this destroy data?" }
  }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "route": { "type": "choice", "choice": "ask", "probabilities": { "run": 0.12, "ask": 0.71, "reject": 0.17 }, "confidence": 0.71 },
    "irreversible": { "type": "noul", "noul": 0.91 }
  },
  "usage": { "input_tokens": 96, "output_tokens": 0 }
}
```

The result keeps `0.91` and every probability; it does not return `true`, `"ask"`, or a synthesized default.

## Implementation example

```ts
import { askSystemOneDecisions } from "@arnilo/prism-providers/decisions";

const result = await askSystemOneDecisions(
  {
    model: "jev-latest",
    state: conversationText,
    questions: {
      route: { type: "choice", instructions: "How should this be handled?", criteria: { run: "run", ask: "ask", reject: "reject" } },
      irreversible: { type: "noul", instructions: "Would running this destroy data?" },
    },
  },
  { provider: "TypeSafe Jev", baseUrl: "https://api.typesafe.ai", apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 2_000 },
  signal,
);

if (result.answers.route.type === "choice" && (result.answers.route.confidence ?? 0) < 0.6) {
  return escalateToHostPolicy(result); // a decision never authorizes an effect by itself
}
```

For Laya, pass `provider: "Laya"` and the `laya-serve` base URL (or omit `apiKey` for an anonymous local server). For compiled schemas, call `compileSystemOneQuestions(schema)` and send the returned questions.

## Extension and configuration notes

- Engine-specific calibration controls are not forwarded: the supported wire contract is verified for `model`, `state`, `questions`, and Bearer auth only. Temperature/floor refits belong in host configuration until the wire documents them.
- `maxRetries`, backoff, jitter, and `random` are the shared client's knobs, not a second retry loop.
- The wrapper is re-exported from `@arnilo/prism-providers/typesafe` and `@arnilo/prism-providers/laya` for hosts that already import the provider package.
- `compileSystemOneState` converts Prism messages to wire state (single user text message → string, else `[{ role, text }]` with non-text parts dropped); questions stay out of it by construction.

## Security and performance notes

- **Egress.** `state` text and compiled questions leave the process for the configured `baseUrl`; TypeSafe's hosted default or a self-hosted `laya-serve` deployment. Do not put secrets in `state`, and do not write questions into it.
- **Credentials.** One resolution per call under `provider`; the same value serves transport and redaction and is never logged.
- **Cost and latency.** One round trip per attempt; questions are free in parallel, state tokens are the cost. `timingMs` includes retries; `timeoutMs` bounds them altogether.
- **Fail closed.** Local bounds and deadline validation fail before any fetch. Abort, deadline, auth, invalid-request, and exhausted-retry outcomes are distinguishable from a measured probability; no failure fabricates an answer.
- **Authority.** Decision answers are advisory. Authorization, capability grants, money paths, and commit rechecks stay host-side and deterministic.

## Related APIs

- [TypeSafe Jev](typesafe.md): hosted adapter and schema mapping.
- [Laya](laya.md): self-hosted adapter over the same wire.
- [Structured output](../structured-output.md): `options.structuredOutput` contract the adapters require.
- [Credentials and redaction](../credentials-and-redaction.md): `CredentialValueSource` and error redaction.
