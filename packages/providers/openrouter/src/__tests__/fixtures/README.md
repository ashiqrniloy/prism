# pi OpenRouter cache-lever reference

`pi-request-openrouter.json` is an **offline, source-derived reference**, generated
2026-10-25 from installed `@earendil-works/pi-ai` **1.4.0**. It is not an upstream
capture, a model response, or measured cache evidence. No key or pi authentication
file was read. No network request was made.

Source: `@earendil-works/pi-ai/dist/api/openai-completions.js` (installed under
`/home/arn/.bun/install/global/node_modules/`):

- `createClient`, lines 544–553: `sessionId` becomes `x-session-id`.
- `buildParams`, lines 568–623: converted messages/tools, cache application;
  `prompt_cache_key` is absent at the OpenRouter URL with **short** retention.
- `getCompatCacheControl` / cache-marker helpers, lines 799–871: ephemeral
  markers on first instruction message, last tool and last eligible message.
- `convertMessages`, lines 873–1060: replay `reasoning_details` without folding
  them into visible assistant text.
- compatibility detection, lines 1268–1306: Anthropic block caching only for
  `openrouter` + `anthropic/*`; OpenRouter session header for both models.
- `dist/utils/transcript.js`, lines 1–25: current provider-facing input uses an
  initial system message with `content: systemPrompt`, `toolsAdded: tools` and
  `timestamp: 0`. This matters: passing old `Context.tools` directly to the
  provider's `stream` would silently omit tools from the reference.

Versioned sources:
[Chat codec](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-completions.ts),
[transcript](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/utils/transcript.ts).
Verified against Context7's `/earendil-works/pi/v1.4.0` cache/compat documentation.

## Input and extraction

The input is `scripts/cache-parity/fixtures/three-turn-coding.json`, without its
probe-only padding. Conversely, the live provider probe removes this fixture's
synthetic thinking/signature blocks; a fabricated signature must never be sent
as real upstream reasoning history. For each model and each `turnMessageCounts` entry:

1. Call the installed codec's exported `stream` with model API
   `openai-completions`, provider `openrouter`, URL
   `https://openrouter.ai/api/v1`, `reasoning: false`, `input: ["text"]`, and
   context/max output 200000/128. No compat overrides; short retention.
   `reasoning: false` keeps the instruction role `system` (pi otherwise chooses
   `developer` for reasoning-capable Anthropic models). This fixture tests
   replay of historical details, not a request for fresh thinking.
2. Map plain user text to pi's supported string content; map the tool result to
   `role: "toolResult"`, `toolName`, `toolCallId`, text content, `isError: false`.
   Map the assistant to `api/provider/model` matching the selected model,
   `stopReason: "toolUse"`, text thinking with `thinkingSignature` equal to the
   JSON array containing the fixture detail, and `type: "toolCall"` arguments.
   All timestamps are zero. Prepend the system message described above.
3. Set `sessionId: "cache-parity-fixture-203"`, `apiKey: "offline-fixture"` and
   inject a **fake fetch**. Parse `init.body`, assert `x-session-id` and absence
   of `prompt_cache_key`, save only `{ messages, tools }`. Return a local SSE
   `choices[].delta.content: "OK"`, `finish_reason: "stop"`, then `[DONE]`.
   Consume the stream and reject any error event.

`cache_levers_match_pi_openrouter` compares Prism's real provider wire output
against all six snapshots. It also byte-compares tools and every previous
message across turns. Only moving `cache_control` and its necessary singleton
text-array wrapper are normalized for prefix stability; reference comparisons
remain exact. The encoded prefix helper planned for the harness parity runner
does not exist yet, so this assertion stays inline.

Deliberate boundary: pi can preserve user text arrays where Prism sends a
string, and may use the developer instruction role when reasoning is enabled.
This plain-string/system fixture proves the listed cache levers for its fixed
transcript, not whole-harness byte parity. Long retention and header precedence
are not asserted equal. Measured reuse and the actual headless workload remain
separate, gated checks.
