# pi Sign in with ChatGPT cache-lever reference

`pi-request-openai-chatgpt.json` is an **offline, source-derived reference**, generated
2026-10-25 from installed `@earendil-works/pi-ai` **1.4.0**. It is not an upstream capture,
a model response, or measured cache evidence. No key, token, or pi authentication file was
read. No network request was made: the codec ran against a fake `fetch`.

Source: `@earendil-works/pi-ai/dist/api/openai-responses.js` (installed under
`/home/arn/.bun/install/global/node_modules/`):

- `stream`, lines 107–198: calls `buildParams`, then `client.responses.create` — the request
  body never carries `instructions`.
- `createClient`, lines 215–238: `session_id` (the `openai` affinity format) and
  `x-client-request-id` both carry `options.sessionId`.
- `buildParams`, lines 245–321: `store: false`; `prompt_cache_key =
  clampOpenAIPromptCacheKey(options.sessionId)` (`api/openai-prompt-cache.js`, 1–9, 64
  characters); `prompt_cache_retention`/`prompt_cache_options`/`max_output_tokens`/
  `temperature` are dropped when `isChatGPTSignIn` is true (lines 23–31: provider `openai`,
  base URL `https://api.openai.com/v1`, key not starting `sk-`); `reasoning: { effort,
  summary: "auto" }` plus `include: ["reasoning.encrypted_content"]` when reasoning is on.
- `convertResponsesMessages` in `api/openai-responses-shared.js`, lines 169–210: the leading
  system message becomes a `role: "developer"` input item with string content.

Versioned sources:
[Responses codec](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-responses.ts),
[prompt-cache key](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-prompt-cache.ts),
[transcript](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/utils/transcript.ts).

## How it was produced

Input is `scripts/cache-parity/fixtures/three-turn-coding.json` (plan 203's fixture, unchanged
except for the reasoning block described below), for each `turnMessageCounts` entry:

1. Build pi's provider-facing transcript the way pi-agent does: the messages array starts with
   `{ role: "system", content: <fixture system>, toolsAdded: <tools>, timestamp: 0 }`. Passing
   `Context.systemPrompt`/`Context.tools` instead would drop both — pi 1.4.0's
   `resolveTranscript` returns the context unchanged when mid-conversation system messages are
   off, and the codec only reads `messages`.
2. Map the fixture to pi messages: user text as a string, the tool result as
   `role: "toolResult"` with `toolCallId`/`toolName`/text and `isError: false`, and the assistant
   as `stopReason: "toolUse"` with a `toolCall` part and a `thinking` part whose
   `thinkingSignature` is the JSON of the reasoning item. All timestamps are zero.
3. Call the installed codec's `stream` with a model of provider `openai`, api
   `openai-responses`, base URL `https://api.openai.com/v1`, `reasoning: true`,
   `apiKey: "oaiapp_offline_fixture"` (not `sk-`, so `isChatGPTSignIn` is true),
   `sessionId: "cache-parity-fixture-204"`, `reasoningEffort: "medium"`, and a fake `fetch`
   that records the method's URL, headers and parsed body and answers one
   `response.completed` event. Consume the stream and reject any error event.
4. Repeat with the long session id for the clamp check, and record only its
   `prompt_cache_key`.

## The one provider-specific adaptation

This route replays only an **encrypted** reasoning item, so the shared fixture's synthetic
`reasoning.text` detail is replaced by one item —
`{ type: "reasoning", id: "rs_fixture", encrypted_content: "fixture-encrypted-content",
summary: [...] }` — which pi replays verbatim from `thinkingSignature` and Prism replays from
`ThinkingContent.data.item`. The key order is the order Prism emits, so the two wires match
byte for byte.

## Input and extraction

`cache_levers_match_pi_openai_chatgpt` compares Prism's real provider request against all
three snapshots: levers, headers, tools, and every input item. The **only** normalized
difference is the prompt's location — pi's leading `developer` item versus Prism's
Responses `instructions` field — and the test asserts the text is identical and appears
exactly once on each wire. It then asserts the instructions, tools and every earlier input
item are unchanged between turns, so the cached prefix cannot move.

`cache_key_clamp_matches_pi` compares the 104-character session id: both wires send a
64-character `prompt_cache_key`, and both affinity headers keep the caller's full value.
