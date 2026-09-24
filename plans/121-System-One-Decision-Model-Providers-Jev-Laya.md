# System One Decision Model Providers: TypeSafe Jev + Laya

## Objectives

- Add a first-party Prism provider for **TypeSafe Jev** (`typesafe-ai/jev`, hosted `POST /v1/systemone` System One API) as `@arnilo/prism-providers/typesafe`.
- Add a first-party Prism provider for **Laya** (Convai Innovations, self-hosted `laya-serve`, Jev-wire-compatible `POST /v1/systemone`) as `@arnilo/prism-providers/laya`.
- Share one wire client and one structured-output compiler between both, since Laya's server deliberately mirrors Jev's request/response shape ("existing TypeSafe clients work by changing their base URL").
- Fit both into the existing `AIProvider` contract via `options.structuredOutput` — these models never generate free text, so they are usable only for structured decision requests (choice/noul/score), never as general agent-loop chat models.

## Expected Outcome

- `createTypeSafeProviderPackage()` and `createLayaProviderPackage()` register providers, models, and `api_key` auth methods through `createExtensionKernel().load([...])`, mirroring the NeuralWatt package shape.
- A request with `options.structuredOutput` whose schema compiles to noul/choice/score questions produces one `content_delta` carrying schema-valid JSON answers, then `usage` (input tokens only) and `done`/`end_turn`.
- A request without `structuredOutput`, or with tools, or with schema fields that are not boolean/enum/int-rubric, is rejected before any network call with an error naming the offending field and the supported types.
- Both adapters work offline in unit tests via injected `fetch`; error bodies pass through `redactSecrets`.
- Docs pages `docs/providers/typesafe.md` and `docs/providers/laya.md` follow the Prism API page structure; `docs/index.md` and `docs/provider-packages.md` list both.

## Background (from research, verified 2026-09)

Both models are "System One" decision engines: non-autoregressive, single forward pass, calibrated typed answers, no text generation, no streaming, no tools, no temperature.

- **Jev**: TypeSafe AI hosted API. Auth `Authorization: Bearer $TYPESAFE_API_KEY`. Model ids: `jev-latest`, `jev-preview`, versioned (`jev-1.13.0`). Context 32k. Pricing $0.04/1M input tokens, output free. p50 ~236–276 ms (third-party measurements).
- **Laya**: open weights (Apache 2.0), `pip install "laya[serve]"`, `laya-serve` binds `0.0.0.0:8000`, same `POST /v1/systemone` shape, optional `LAYA_API_KEY` → requires Bearer. Server ignores unknown fields and picks the checkpoint itself (Router); `model` in the body is advisory. Three checkpoints: `laya` (EN, 512 ctx), `laya-multilingual` (1024, up to 8192), `laya-typed-decisions` (1024). ~33 ms GPU.
- **Wire protocol** (identical for both):
  - Request: `{ model: string, state: string | object | array, questions: Record<id, Question> }`.
  - Question: `{ type: "noul" | "choice" | "score", instructions: string | object | array, criteria: ... }` — noul: optional `{ true, false }` descriptions; choice: `Record<option, description | null>`, 2–255 options; score: ordered array of 2–10 level descriptions.
  - Response: `{ model: string, answers: Record<id, Answer>, usage: { input_tokens, output_tokens } }`.
  - Answer: noul `{ type, noul: 0..1 }`; choice `{ type, choice: option, probabilities: Record<option, number>, confidence: 0..1 }`; score `{ type, score: number (can land between levels), legend: Record<level, description>, probabilities, confidence }`.
  - Errors: 401 (bad key), 422 (malformed body — names the offending field), 429 (+`Retry-After`), 529 (overloaded) — 429/529 retried with exponential backoff.
- **Precedent**: pydantic-ai `TypeSafeModel` maps each field of the output type to one question; unsupported field types are a `UserError` before any request is sent. We mirror that: compile `StructuredOutputOptions.schema` → questions, reject the rest up front.
- **Question-in-state hazard** (TypeSafe: "probably the most important concept"): a question written into the state text gets judged, not answered. State must carry conversation content only; questions come strictly from the schema.

## Tasks

- [x] Task 1 — Primitive review and shared System One wire client
  - Acceptance Criteria:
    - Functional: `shared/systemone.ts` builds the request body, POSTs to a configurable base URL + `/v1/systemone` with optional Bearer auth, parses the response, maps usage (`inputTokens` only, `outputTokens: 0`, `totalTokens`), and classifies HTTP errors (401 → auth, no retry; 422 → invalid-request, no retry; 429/529 + 5xx → retryable honoring `Retry-After`) using the existing `shared/retry-http.ts` helpers rather than a bespoke retry loop.
    - Functional: retry policy is bounded (max attempts + jitter), `AbortSignal` is honored between attempts, and the 422 error message surfaces the API's field-level detail with secrets redacted.
    - Performance: one HTTP round trip per successful request; retries only on retryable statuses; no polling; body parse is single-pass JSON.
    - Code Quality: no provider-specific constants in `shared/` (base URL, model ids, env vars live in the provider packages); exported functions are pure or take injected `fetch`; typing covers the three question/answer shapes discriminated by `type`.
    - Security: Bearer credential resolved via `resolveCredentialValue` (`CredentialValueSource`) and never logged or echoed; error text built through the redacting error builder so response bodies (which echo state) cannot leak into logs unredacted; request/response size bounded via existing transport helpers (`readBoundedResponseJson`).
  - Approach:
    - Documentation Reviewed:
      - TypeSafe API reference — https://docs.typesafe.ai/api (endpoint shape, question/answer types, usage, error table).
      - `typesafe_jev` Rust crate docs — https://docs.rs/typesafe-jev/latest/typesafe_jev/ (field-for-field serialization, error taxonomy, retry/`Retry-After` behavior, `USD_PER_INPUT_MTOK` pricing).
      - Laya README — https://huggingface.co/convaiinnovations/laya (`laya-serve` Jev-compatible server, optional `LAYA_API_KEY`, 422 on malformed question).
    - Options Considered:
      - Reuse `createOpenAICompatibleProvider`: rejected — wire format is not Chat Completions; forcing it would need a fake-SSE layer and break error/usage semantics.
      - New shared client vs one per provider: shared wins — Laya is byte-compatible with Jev by design; two clients would duplicate the exact same parse/error code.
    - Chosen Approach:
      - One `shared/systemone.ts` mirroring how `neuralwatt` sits on `shared/openai-compat.ts`: generic wire client in `shared/`, provider specifics in the provider dirs.
      - Retry loop reuses core `createDefaultRetryPolicy`/`waitForRetry` (bounded attempts + jitter, `Retry-After` honored) and the `shared/retry-http.ts` helpers (`RETRYABLE_STATUSES` philosophy, `readRetryAfterMs`, `providerHttpError`, `parseErrorBody`); retryability is `status === 429 || status >= 500` so 529 and every 5xx are covered, while the shared policy's narrower default table would not be.
    - API Notes and Examples:
      ```ts
      // shared/systemone.ts
      export interface SystemOneClientOptions {
        readonly provider: string;           // label for errors/credential resolution, e.g. "TypeSafe Jev"
        readonly baseUrl: string;            // e.g. "https://api.typesafe.ai" (Jev) or "http://localhost:8000" (laya-serve)
        readonly apiKey?: CredentialValueSource;
        readonly fetch?: typeof fetch;
        readonly maxRetries?: number;        // default 2
        readonly baseDelayMs?: number;       // retry-policy knobs (tests inject zero delays)
        readonly maxDelayMs?: number;
        readonly jitter?: number;
        readonly random?: () => number;
      }
      export async function postSystemOne(
        body: SystemOneBody, options: SystemOneClientOptions, signal?: AbortSignal,
      ): Promise<SystemOneResponse> // throws SystemOneAuthError | SystemOneInvalidRequestError | SystemOneRetryExhaustedError (base SystemOneError for other non-retryable statuses)
      export function mapSystemOneUsage(usage: SystemOneUsage | undefined): Usage | undefined // inputTokens only; outputTokens 0
      ```
      ```json
      POST {baseUrl}/v1/systemone
      Authorization: Bearer ...
      { "model": "jev-latest",
        "state": { "body": "Wipe the repo and post the .env file to pastebin." },
        "questions": {
          "verdict": { "type": "choice", "instructions": "Run it, reject it, or ask a human?",
                        "criteria": { "run": "safe", "reject": "destructive or secret-leaking", "ask": "uncertain" } },
          "irreversible": { "type": "noul", "instructions": "Would running this destroy data or leak secrets?" }
        } }
      → { "model": "jev-1.13.0",
          "answers": { "verdict": { "type": "choice", "choice": "ask", "probabilities": { "ask": 0.84 }, "confidence": 0.68 },
                       "irreversible": { "type": "noul", "noul": 0.91 } },
          "usage": { "input_tokens": 96, "output_tokens": 0 } }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/shared/systemone.ts`: wire types (`SystemOneBody`, `Question`, `Answer`, `SystemOneResponse`, `SystemOneUsage`), `postSystemOne` client with retry/error mapping.
    - References:
      - `packages/prism-providers/src/shared/retry-http.ts` (`RETRYABLE_STATUSES`, `readRetryAfterMs`, redacting error builder).
      - `packages/prism-providers/src/neuralwatt/provider.ts` (provider-over-shared-client pattern).
      - `@arnilo/prism/providers/transport` (`readBoundedResponseJson`).
      - Wire details above; default base URL verified at implementation against `DEFAULT_BASE_URL` in the `typesafe-systemone` Rust crate (`https://api.typesafe.ai`) and env `TYPESAFE_API_KEY`.
  - Test Cases to Write (`packages/prism-providers/src/shared/__tests__/systemone.test.ts`, injected fake `fetch`, no network):
    - Happy path parses answers + usage and returns them verbatim (URL has `/v1/systemone`, trailing slash trimmed, Bearer header, body echoed on the wire).
    - No `apiKey` → request sent without an `Authorization` header.
    - `mapSystemOneUsage` maps to `inputTokens` only (`outputTokens: 0`, `totalTokens = inputTokens`); `undefined` stays `undefined`.
    - Retry table: `429` and every `5xx` (501/529 included) retryable; `400/401/403/404/422` not.
    - 401 → auth error, no retry (fake fetch counts calls), key echoed in the body is redacted.
    - 422 → invalid-request error carrying the API field detail, no retry.
    - 429 with `Retry-After: 1` then 200 → one retry, succeeds.
    - 529 then 529 then 200 → retries twice, succeeds; exhausted retries → retry-exhausted error carrying `retryAfterMs`.
    - AbortSignal already aborted → no fetch.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — `shared/` is internal to the package family (subpath exports unchanged until Tasks 3–4).
    - Docs pages to create/edit: `none` — internal primitive; covered later by the two provider pages.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a (no docs).

- [x] Task 2 — Structured-output schema → questions compiler and answers renderer
  - Acceptance Criteria:
    - Functional: `compileSystemOneQuestions(schema)` walks a JSON Schema `StructuredOutputOptions.schema` (object with properties) and maps: `enum` (2–255 values) → `choice` (criteria from per-value `description`s when present, else the value itself); `boolean` → `noul` (instructions from property `description`/`title`, optional `{true,false}` criteria via schema `x-typesafe`-style extension or compat); integer `enum`/0..N with ≤10 described levels → `score`. Nested objects flatten with dotted ids. Anything else (`string`, unbounded numbers, free arrays, unions) throws an error naming the field path and listing supported shapes — before any network call.
    - Functional: `renderSystemOneOutput(answers, schema, options)` produces a schema-valid JSON object as text: booleans from noul probability vs threshold (default 0.5, knob `boolean_threshold`), enums from `choice`, rubric integers from rounded `score` (0.5 rounds up), nested objects re-assembled.
    - Functional: empty question set after compilation → same up-front rejection (decision models cannot answer "no question").
    - Performance: compilation is O(schema size), single pass; renderer is O(fields); no regex-heavy re-parsing.
    - Code Quality: pure exported functions, no `fetch`, no provider constants; error type carries the offending field path; exhaustive `switch` over the three question types with no `default` escape.
    - Security: compiler rejects oversized question sets (>255 options for choice, >10 levels for score, >~256 questions total) up front rather than letting the API 422; renderer output must round-trip-validate against the input schema.
  - Approach:
    - Documentation Reviewed:
      - pydantic-ai TypeSafe model docs — https://pydantic.dev/docs/ai/models/typesafe/ (field-type → question mapping table, boolean threshold default 0.5, `provider_details['confidence'|'probabilities'|'scores']` precedent, up-front `UserError` for unsupported fields).
      - TypeSafe API reference (criteria limits: 255 options, 2–10 score levels).
    - Options Considered:
      - Emit all questions from one flat schema vs support JSON Schema `$ref`/`allOf`: flat + dotted nested objects only; `$ref` resolution deferred (YAGNI — Prism's structured-output schemas in use are flat object schemas).
      - Threshold as model parameter vs request compat: compat knob on `ProviderRequestOptions.compat.boolean_threshold` — no new contract surface.
    - Chosen Approach:
      - Mirror pydantic-ai's proven mapping 1:1; unsupported = loud up-front error. Confidence/probabilities are not part of the rendered text (must validate against schema) — see Compromises.
      - Schema conventions live under one extension object `x-systemone` (alias `x-typesafe`): `criteria {true,false}` for noul, `options {value: description|null}` for choice, `levels [description]` (aligned with the declared `enum` order) for score. A described contiguous integer enum `0..N` (2–10 levels) compiles to score; undescribed whole-number enums stay choices.
      - Threshold comparison is strict (`noul > booleanThreshold`), so `0.5` renders `false` at the default — the plan's boundary test is the contract. The renderer clamps rounded scores into the rubric, rejects answers that are not schema options, and requires an answer for every compiled question.
      - Errors are `SystemOneSchemaError` with `code` (`unsupported_field`, `empty_questions`, `too_many_questions`/`too_many_options`/`too_many_levels`, `invalid_threshold`, `missing_answer`, `invalid_answer`) and the offending `fieldPath`.
      - `compileSystemOneState` drops non-text parts and empty messages; no text at all yields `""`.
    - API Notes and Examples:
      ```ts
      // JSON Schema in → questions out
      { "type": "object", "properties": {
          "verdict": { "type": "string", "enum": ["run", "reject", "ask"],
                       "description": "How should this shell command be handled?" },
          "irreversible": { "type": "boolean", "description": "Would running this destroy data?" } } }
      → { "verdict": { "type": "choice", "instructions": "How should this shell command be handled?",
                       "criteria": { "run": "run", "reject": "reject", "ask": "ask" } },
          "irreversible": { "type": "noul", "instructions": "Would running this destroy data?" } }
      // answers in → text out (threshold 0.5)
      { "verdict": { "type": "choice", "choice": "ask", ... }, "irreversible": { "type": "noul", "noul": 0.91 } }
      → `{"verdict":"ask","irreversible":true}`
      // extension conventions (`x-typesafe` accepted as an alias)
      { "type": "boolean", "description": "...", "x-systemone": { "criteria": { "true": "...", "false": "..." } } }
      { "type": "string", "enum": ["run", "reject"], "x-systemone": { "options": { "run": "safe", "reject": "destructive" } } }
      { "type": "integer", "enum": [0, 1, 2], "x-systemone": { "levels": ["opaque", "partial", "actionable"] } } // → score
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/shared/systemone-schema.ts`: `compileSystemOneQuestions`, `renderSystemOneOutput`, `compileSystemOneState` (messages → state: single user text message → string; otherwise `[{role, text}]` array of text parts only).
    - References:
      - `@arnilo/prism` `StructuredOutputOptions` (`contracts-core/provider.d.ts`): `{ name, schema, strict? }`.
      - pydantic-ai mapping table (Background).
      - Question-in-state hazard (Background): `compileSystemOneState` must carry message content only.
  - Test Cases to Write (`packages/prism-providers/src/shared/__tests__/systemone-schema.test.ts`, 15 tests):
    - Enum field → choice; `x-systemone.options` descriptions land in criteria; `x-typesafe` alias compiles identically.
    - Boolean field → noul with description as instructions (field name when absent); `criteria` extension carried through.
    - Described contiguous `0..N` integer enum → score ordered by level number (declaration order ignored); 11 described levels → rejection; 11 undescribed values → choice.
    - Nested object → dotted ids, re-assembled on render.
    - `string` / unbounded `number` / array / `anyOf` / plain integer / one-option enum → rejection naming the field path, message lists supported shapes (nested field included).
    - Empty properties → rejection; 257 fields → rejection.
    - >255 enum options → rejection.
    - noul 0.49/0.5/0.51 → false/false/true at default; custom `booleanThreshold: 0.9` respected (0.9 false, 0.91 true); out-of-range threshold → rejection.
    - score 1.5 → 2; −0.4 → 0; 2.6 → 2 (clamped); legend ignored in output.
    - Choice render emits the schema's own value (whole-number options stay numbers); unknown option and answer/question type mismatch → rejection.
    - Rendered output validates against the input schema (structural assert per field).
    - Missing answer for a compiled question → rejection naming the field.
    - State: single user text message → string; multi-message → array with non-text parts dropped; no text → `""`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal pure functions; surface becomes public via Tasks 3–4).
    - Docs pages to create/edit: `none` — behavior documented on provider pages in Task 5.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 3 — TypeSafe (Jev) provider package
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-providers/typesafe` subpath exports `createTypeSafeProviderPackage(options)` registering provider `typesafe`, models `jev-latest` (+ `jev-preview`, and `defineTypeSafeModel` for versioned pins), and `api_key` auth method (credential `apiKey`, env `TYPESAFE_API_KEY` per package conventions).
    - Functional: `generate()` gates on `options.structuredOutput` (reject otherwise), rejects `tools` ("decision model, no tool support"), compiles via Task 2, POSTs via Task 1, and yields `message_start` → one `content_delta` (text = rendered JSON) → `usage` → `done` with `stopReason: "end_turn"`. Model ids pass through verbatim; the responding versioned model from `answers.model` is not rewritten into output. `options.compat.boolean_threshold` (0..1, default 0.5) is forwarded to the Task 2 renderer; out-of-range values are rejected before any fetch.
    - Functional: model config declares `capabilities: { structuredOutput: "json_schema", streaming: false, tools: false, input: ["text"] }`, `limits: { contextWindow: 32000, maxOutputTokens: 0 }`, `cost: { input: 0.04, output: 0, currency: "usd", unit: "1M" }` (unit matched to existing entries at implementation).
    - Performance: no extra requests (no model listing at request time); one round trip per generate; abort propagates.
    - Code Quality: package mirrors `neuralwatt/` file layout (`index.ts`, `models.ts`, `provider.ts`, `__tests__/`); no OpenAI-compat imports.
    - Security: default credential resolution from env only via `CredentialValueSource`; nothing reads `process.env` directly in library code beyond the established credential seam.
  - Approach:
    - Documentation Reviewed:
      - TypeSafe API reference; pydantic-ai docs (model ids `jev-latest`/`jev-preview`/versioned).
      - `docs/providers/neuralwatt.md` + `packages/prism-providers/src/neuralwatt/index.ts` (package registration shape).
      - `@arnilo/prism` `ProviderEvent` union (`contracts-protocol.d.ts`) for the exact event sequence.
    - Options Considered:
      - Generic `systemone` provider package with two presets vs two packages: two packages — matches repo convention (one dir + one subpath + one docs page per vendor), keeps vendor naming honest.
    - Chosen Approach:
      - Thin provider over Tasks 1–2; all logic already shared. Exports: `createTypeSafeProvider`, `createTypeSafeProviderPackage`, `typeSafeModels`, `defineTypeSafeModel`, `TYPESAFE_DEFAULT_BASE_URL`, `TYPESAFE_API_KEY_ENV`.
      - Gates run before credential resolution and fetch: tools → error; missing `structuredOutput` → error; `assertStructuredOutputRequestSupported` validates name/schema/size/model capability; `compat.boolean_threshold` validated 0..1. Every failure (gates, HTTP, render) surfaces as a terminal `error` event; a pre-aborted signal throws before the generator yields, matching the other adapters.
      - Model metadata uses the repo cost unit (`currency: "USD"`, `unit: "per_million_tokens"`) and `maxOutputTokens: 0`; `maxRetries` passes through to the shared client (default 2).
    - API Notes and Examples:
      ```ts
      import { createTypeSafeProviderPackage } from "@arnilo/prism-providers/typesafe";
      const kernel = createExtensionKernel().load([
        createTypeSafeProviderPackage({ apiKey: { env: "TYPESAFE_API_KEY" } }),
      ]);
      // request must carry options.structuredOutput; answers arrive as one text delta
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/typesafe/index.ts`: package factory + re-exports.
      - `packages/prism-providers/src/typesafe/models.ts`: `typeSafeModels`, `defineTypeSafeModel`, defaults (base URL, env var name).
      - `packages/prism-providers/src/typesafe/provider.ts`: `createTypeSafeProvider(options): AIProvider` — delegates to `shared/systemone-provider.ts` (moved there in Task 4 so Laya shares the loop).
      - `packages/prism-providers/src/typesafe/__tests__/typesafe.test.ts`.
      - `packages/prism-providers/package.json`: add `"./typesafe"` subpath; bump adapter count in `description` (19 → 20).
    - References:
      - Background wire examples; `neuralwatt/index.ts` for `defineProviderPackage` usage.
  - Test Cases to Write (`packages/prism-providers/src/typesafe/__tests__/`, 14 offline + 2 env-gated live):
    - Package registration: provider `typesafe`, models `jev-latest`/`jev-preview`, `api_key` auth method; model metadata (capabilities, limits, cost) and `defineTypeSafeModel` versioned-pin defaults.
    - Happy path fake `fetch`: one POST to `https://api.typesafe.ai/v1/systemone`, Bearer header, model id verbatim, state/question compilation on the wire, event sequence `message_start`/`content_delta`/`usage`/`done(end_turn)`, rendered JSON schema-valid, secrets absent.
    - Missing `structuredOutput`, tools, out-of-range `compat.boolean_threshold` → terminal `error` event with zero fetch calls.
    - 401 → redacted error event, one call (no retry); 422 → field detail surfaced, one call; 429 + `Retry-After: 0` → retry then success.
    - `boolean_threshold: 0.9` honored (0.91 true / 0.6 false); `baseUrl` override trims trailing slashes; no `apiKey` → no Authorization header; pre-aborted signal throws with zero fetch calls; unanswered question → error event.
    - Live tests gated on `PRISM_LIVE_PROVIDER_TESTS=1` + `TYPESAFE_API_KEY` (skipped otherwise).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package subpath and provider registration.
    - Docs pages to create/edit: `docs/providers/typesafe.md` (Task 5 writes full page).
    - `docs/index.md` update: yes — Task 5 adds the first-party adapter list entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Laya provider package
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-providers/laya` exports `createLayaProviderPackage(options)` registering provider `laya`, models `laya`, `laya-multilingual`, `laya-typed-decisions` (context 512 / 1024(+8192 metadata note) / 1024), `maxOutputTokens: 0`, zero cost, same structured-output-only capability set as Task 3.
    - Functional: default `baseUrl` `http://localhost:8000` (exported `DEFAULT_LAYA_BASE_URL`, resolver `layaBaseUrl({ baseUrl })` following the ollama `ollamaBaseUrl` pattern with `trimTrailingSlashes`); **any host-supplied external endpoint overrides the default** — `https://laya.example.com`, `https://10.0.0.5:8443`, etc. — so a `laya-serve` instance hosted on a different machine reachable over the internet is first-class configuration, not a workaround. `apiKey` optional (`laya-serve` requires Bearer only when `LAYA_API_KEY` is set server-side); `model` sent on the wire as advisory (server's Router picks the checkpoint) — no client-side checkpoint forcing.
    - Functional: behavior identical to Task 3 otherwise (same gating, same event sequence, same error mapping — 422 detail surfaced, 401 only when a key is configured).
    - Performance: same one-round-trip guarantee; no checkpoint probing calls.
    - Code Quality: mirrors `typesafe/` layout; shares all logic via Tasks 1–2; the only provider-specific code is defaults + model metadata.
    - Security: remote deployment is the documented trust boundary — default `http://localhost:8000` is plaintext loopback only; any non-localhost `baseUrl` MUST be `https://` (warn — not hard-fail — on plaintext non-loopback `http://`, since air-gapped LAN HTTP is a legitimate setup) and SHOULD carry an `apiKey` matching the server's `LAYA_API_KEY`; state content and questions traverse the network to wherever `baseUrl` points. All three points land in the docs page (Task 5).
  - Approach:
    - Documentation Reviewed:
      - Laya README — `laya-serve` section (bind, `LAYA_API_KEY`, "accepts every question shape the Jev API does, ignores unknown fields, 422 names the problem").
      - `packages/prism-providers/src/ollama/models.ts` (`ollamaBaseUrl`, presets, `DEFAULT_OLLAMA_BASE_URL`) — repo precedent for configurable self-hosted base URLs.
      - Laya checkpoint table (encoder, params, context) for model metadata.
    - Options Considered:
      - Expose Router checkpoint override via `compat.checkpoint`: deferred — server ignores it today; add when `laya-serve` grows explicit selection (recorded in Further Actions if needed).
    - Chosen Approach:
      - Thin config package. Gates and event assembly live in `shared/systemone-provider.ts` (`createSystemOneDecisionProvider`); TypeSafe's provider delegates to the same function so the two adapters cannot drift. Laya-only code is defaults, model metadata, and the plaintext warning.
      - `layaBaseUrl({ baseUrl })` trims trailing slashes and prefers a host-supplied endpoint over `DEFAULT_LAYA_BASE_URL` (`http://localhost:8000`). Plaintext non-loopback (`http://` and not localhost / `*.localhost` / `::1` / `127/8`) calls `console.warn` and still proceeds. Warning text uses `URL.origin`, so userinfo never lands in the message. `https://` and loopback stay silent.
      - Checkpoints: `laya` context 512, `laya-multilingual` 1024 with `metadata.extendedContextWindow: 8192`, `laya-typed-decisions` 1024. All `maxOutputTokens: 0`, zero cost, same capability set as Jev. `LAYA_API_KEY_ENV` exported; key stays optional.
    - API Notes and Examples:
      ```ts
      import { createLayaProviderPackage } from "@arnilo/prism-providers/laya";
      // local (default)
      createExtensionKernel().load([createLayaProviderPackage()]);
      // remote laya-serve on another machine, reached over the internet
      createExtensionKernel().load([
        createLayaProviderPackage({
          baseUrl: "https://laya.example.com", // or https://10.0.0.5:8443
          apiKey: { env: "LAYA_API_KEY" },    // must match server's LAYA_API_KEY
        }),
      ]);
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/shared/systemone-provider.ts`: shared decision-model provider (prerequisite so Laya does not fork the Task 3 loop). `typesafe/provider.ts` now delegates.
      - `packages/prism-providers/src/laya/index.ts`, `laya/models.ts` (`DEFAULT_LAYA_BASE_URL`, `layaBaseUrl`), `laya/provider.ts`, `laya/__tests__/laya.test.ts`.
      - `packages/prism-providers/package.json`: `"./laya"` subpath; adapter count 20 → 21.
    - References:
      - Background (Laya server behavior, checkpoint table).
  - Test Cases to Write (`packages/prism-providers/src/laya/__tests__/laya.test.ts`, 7 offline):
    - Package registration: provider `laya`, models `laya` / `laya-multilingual` / `laya-typed-decisions` with context 512 / 1024 / 1024, `extendedContextWindow: 8192` on multilingual, `maxOutputTokens: 0`, zero cost, `api_key` auth.
    - Happy path: default `http://localhost:8000/v1/systemone`, no Authorization header, advisory model id verbatim, server `model` not rewritten into the rendered JSON, event sequence `message_start` / `content_delta` / `usage` / `done(end_turn)`.
    - `apiKey` → Bearer header.
    - `baseUrl: "https://laya.example.com/"` → `https://laya.example.com/v1/systemone`; `layaBaseUrl` trims a trailing slash on `https://10.0.0.5:8443/`.
    - `http://10.0.0.5:8443` warns on `console.warn` and still posts; `https://`, `localhost`, `127.0.0.1`, and `[::1]` stay silent; userinfo is absent from the warning text.
    - 422 surfaces the API field detail, one call; 401 with a configured key is a redacted auth error, one call.
    - Missing `structuredOutput` and tools → terminal `error` event, zero fetch calls.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package subpath and provider registration.
    - Docs pages to create/edit: `docs/providers/laya.md` (Task 5).
    - `docs/index.md` update: yes — Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Documentation, registry updates, and release verification
  - Acceptance Criteria:
    - Functional: `docs/providers/typesafe.md` and `docs/providers/laya.md` follow the required API page structure (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs); each page states the opt-in cost/latency line (one `POST /v1/systemone` round trip per structured-output request) and the sizing trade-off (questions are free in parallel; state tokens are the cost). Each page documents the structured-output schema mapping (boolean → noul, enum → choice, described `0..N` integer enum → score, nested objects with dotted ids) and the `x-systemone`/`x-typesafe` extension keys (`criteria`, `options`, `levels`) plus the `compat.boolean_threshold` knob.
    - Functional: `docs/index.md` first-party adapter list gains `typesafe` and `laya`; `docs/provider-packages.md` (and `docs/providers/provider-primitives.md` only if the shared client warrants a mention) updated to list both subpaths; `plans/README.md` gains the plan 121 row.
    - Functional: `bun run typecheck`, `biome` lint/format, and the prism-providers test suite pass; `node scripts/release.mjs gate` passes with **no baseline regeneration** (this plan only adds exports — no moves, renames, or removals).
    - Code Quality: docs describe current contract only (no plan numbers, no release narrative); index blurbs are one sentence each.
    - Security: page carries data-egress notes — Jev: state content leaves for TypeSafe's hosted API; Laya: egress follows `baseUrl`; a dedicated "Remote deployment" subsection covers hosting `laya-serve` on a separate machine (TLS termination, `LAYA_API_KEY` on both sides, plaintext-loopback default) and repeats the plaintext non-localhost warning behavior.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API page structure, index rules, current-line vs history).
      - `docs/index.md` "Provider and model connection" section (entry format); `docs/providers/neuralwatt.md` (page exemplar).
    - Options Considered:
      - One combined "System One providers" page vs two pages: two pages — matches one-page-per-adapter convention and different trust/deployment stories (hosted vs self-hosted).
    - Chosen Approach:
      - Per-vendor pages. Laya's page points at the Jev page for the schema table and event sequence, and adds the remote-deployment subsection.
      - Adapter inventory counts come from `node scripts/package-truth.mjs --emit-docs` (22 export subpaths, including `model-discovery`). `docs/provider-primitives.md` was not edited — the System One client is package-internal, not a core transport primitive.
      - Freeze literals that enumerate live subpaths moved 20 → 22 (`packaging.test.ts`, `phase24-truth.test.mjs`, `phase37-provider-matrix.test.mjs`, plus `lateAdditions` in `phase29-freeze-manifest.json`). Compat baseline was not regenerated. `node scripts/release.mjs gate` reported `updated: false`.
    - API Notes and Examples:
      ```ts
      // docs/providers/typesafe.md implementation example (same shape for laya)
      import { createTypeSafeProviderPackage } from "@arnilo/prism-providers/typesafe";
      const kernel = createExtensionKernel().load([createTypeSafeProviderPackage()]);
      ```
    - Files to Create/Edit:
      - `docs/providers/typesafe.md`, `docs/providers/laya.md`: new pages.
      - `docs/index.md`: two adapter-list links.
      - `docs/provider-packages.md`: adapter inventory wording/count if it enumerates adapters.
      - `src/__tests__/docs.test.ts`: add both pages to `providerPackagePages` (docs↔adapter coverage test).
      - `src/__tests__/install-smoke.test.ts`: add `@arnilo/prism-providers/typesafe` and `@arnilo/prism-providers/laya` to the packed-install specifier list.
      - `packages/prism-providers/package.json`: description stays 21 named adapters (the historical list omits `model-discovery`; generated truth counts 22 subpaths).
      - `plans/README.md`: plan 121 row marked complete.
      - `CHANGELOG.md`: `[Unreleased]` entry naming both subpaths.
      - `src/__tests__/packaging.test.ts`, `scripts/phase24-truth.test.mjs`, `scripts/phase37-provider-matrix.test.mjs`, `scripts/phase29-freeze-manifest.json`: live subpath count 22.
      - `docs/_evidence/phase37-provider-matrix.md`: inventory rows so the freeze names both adapters.
      - `docs/release-and-install.md`, `docs/provider-packages.md`, `README.md`, `scripts/package-truth.json`: regenerated provider inventory (`--emit-docs`).
    - References:
      - prism-wiki.md rules; existing provider pages.
  - Test Cases to Write:
    - None new — verification task. Acceptance = green `typecheck` + provider test suite + `release:gate` diff clean, plus manual doc render check (index links resolve).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task *is* the documentation of Tasks 3–4 surfaces.
    - Docs pages to create/edit: as listed in Files.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Confidence, probabilities, and score distributions are not copied onto `ProviderEvent`. The neutral event union has no provider-details field, and the rendered text has to stay schema-valid. Follow-up is a neutral seam, not a vendor event.
- JSON Schema compilation is flat objects plus nested objects with dotted ids. No `$ref`, `allOf`, or union compilation. Schemas in use are flat; the compiler throws before fetch on anything else.
- Laya's Router still picks the checkpoint. `model` is advisory. No `compat.checkpoint` until `laya-serve` honors one.
- `docs/provider-primitives.md` does not mention the System One client. That client is internal to `@arnilo/prism-providers` and is not a core transport primitive.
- Package description says 21 named adapters and omits `model-discovery`, matching the previous description convention. Generated inventory counts every export subpath (22).

## Further Actions

1. **P3 — confidence seam.** Add a neutral provider-details field (or equivalent) if a host needs to gate on noul/choice confidence instead of the rendered boolean/enum. Rationale: the wire already returns calibrated probabilities; the event union drops them.
2. **P3 — schema compiler.** Compile `$ref` / `allOf` / unions when a real schema needs them. Rationale: current callers use flat object schemas; the compiler already fails closed.
3. **P3 — Laya checkpoint pin.** Add `compat.checkpoint` only after `laya-serve` documents a client-selected checkpoint. Rationale: the server ignores unknown fields today.
4. **P3 — host picker.** Register `typesafe` and `laya` in the ACP/CLI provider switch only if a host wants them as config-file chat providers. Rationale: both reject requests that lack `structuredOutput`, so a general chat picker would fail closed on ordinary turns.
5. **P3 — live matrix.** Add matrix rows when someone runs the shared live matrix against `TYPESAFE_API_KEY` or a local `laya-serve`. The package-local live test for Jev already exists and stays env-gated.
