# pi Command Code cache-lever reference

`pi-request-{chat,responses,messages}.json` are **offline, source-derived reference
requests**, generated 2026-10-28 from installed `pi-commandcode-provider` **0.7.10** on
`@earendil-works/pi-ai` **1.4.0**. They are not upstream captures, model responses, or
measured cache evidence. No key, token, or pi authentication file was read, and no network
request was made: the reference codec ran against a fake `fetch` that recorded the request.

The lever set is confirmed against the live recordings from plan 205 Task 1b
(`/tmp/cc-probe/live/*.request.json` on the plan branch, summarized in the plan notes): the
Chat wire sends no cache field, the Responses wire sends `store: false` and a
`prompt_cache_key`, and the Messages wire marks the system prompt and the last message with
`cache_control` and leaves tool definitions unmarked.

Source lines (installed `pi-commandcode-provider/index.ts` and `src/`, pi-ai 1.4.0):

- `index.ts` `compatForModel` (122–143): Chat → `supportsStore: false`,
  `supportsDeveloperRole: false`, `supportsReasoningEffort`, `maxTokensField: "max_tokens"`;
  Responses → `supportsDeveloperRole: false`, `supportsLongCacheRetention: false`,
  `sessionAffinityFormat: "openai-nosession"`; Messages → `supportsCacheControlOnTools: false`,
  `forceAdaptiveThinking`.
- `index.ts` (231–238): the Responses request is wrapped with `x-client-request-id` affinity.
- `index.ts` (202): `COMMANDCODE_API_BASE` overrides the base URL.
- `src/models.ts` `baseUrlForModel` (163–166): the Messages base URL strips the trailing `/v1`;
  the wire is `…/provider/v1/messages?beta=true`.
- pi-ai `api/openai-completions.js` 568–586: no cache field, `stream_options.include_usage`.
- pi-ai `api/openai-responses.js` 245–321: `store: false`,
  `prompt_cache_key = clampOpenAIPromptCacheKey(sessionId)` (64 characters in
  `api/openai-prompt-cache.js`), `include: ["reasoning.encrypted_content"]` when reasoning is
  on, `reasoning: { effort, summary: "auto" }`.
- pi-ai `api/anthropic-messages.js` 933–961, 1216–1236: `cache_control: {type: "ephemeral"}`
  on the system prompt and the last message, never on tools when
  `supportsCacheControlOnTools` is false; adaptive thinking adds `display: "summarized"`.

## How it was produced

Input is `scripts/cache-parity/fixtures/three-turn-coding.json` (plan 203's fixture). For each
`turnMessageCounts` entry the fixture was mapped to the pi transcript (system message with
`toolsAdded`, user text, assistant `toolCall`, `toolResult`) and passed to the extension's
registered `streamSimple` with `apiKey: "offline-fixture-never-used"`,
`sessionId: "cache-parity-fixture-205"`, `reasoning: "high"`, and a fake `fetch` that recorded
the URL, the routing-relevant headers (`x-client-request-id`, `anthropic-beta`,
`anthropic-version`, `content-type`; credentials and SDK telemetry are not stored) and the
parsed body. Assistant messages carry zero usage so pi's context
estimator does not expect prior usage records.

## The per-wire thinking adaptation

The shared fixture's `thinking` block is a synthetic `reasoning.text` payload. Each wire
stores a different replayable shape, so the reference transcript adapts it:

- **Chat** — `thinkingSignature` is the JSON array of `reasoning_details` (the shape the live
  Chat wire returns), which pi replays as `assistant.reasoning_details`. Prism replays the
  same detail from `data` and the array from `signature`; the test feeds both fields.
- **Messages** — `thinkingSignature` is the opaque signature string the live wire returns;
  both harnesses replay `{type: "thinking", thinking, signature}`.
- **Responses** — the wire returns `reasoning_text` with an empty `summary` and no
  `encrypted_content`, so there is no item a client can replay (plan 205 Task 1b correction
  11). The thinking block is omitted, matching live traffic.

## Input and extraction

`cache_levers_match_pi_commandcode: {chat,responses,messages}` compares Prism's real provider
request against all three snapshots. It asserts, per wire, that the cache-relevant fields are
equal (`prompt_cache_key`, `store`, `include`, `x-client-request-id`; for Messages the exact
`cache_control` placement, absence of a TTL, and the adaptive `thinking` plus
`output_config.effort`), and that the cached prefix cannot move between turns: system or
instructions, tools and every earlier message stay byte-identical. On Messages the marker
moves with the last message on both harnesses, so earlier content is compared without
`cache_control`; the marker placement itself is compared against the reference each turn.

## Known, non-cache differences (deliberate)

- Prism omits `max_tokens`/`max_output_tokens` unless the catalog declares a cap; pi fills
  its 65 536 default. The Messages exemplar declares its measured 128 000 cap.
- pi fills JSON-Schema defaults (`properties: {}`, `required: []`) into tool `input_schema`;
  Prism ships the declared schema unchanged. The test normalizes that difference when it
  compares tools across harnesses.
- The Responses wire places the prompt in `instructions` (Prism and live pi through the
  agent) or as a leading `system` input item (this offline fixture); the text is identical.
  pi additionally sends `reasoning.summary: "auto"`, which Command Code ignores.
- pi emits `is_error: false` on every `tool_result`; Prism omits the default.
