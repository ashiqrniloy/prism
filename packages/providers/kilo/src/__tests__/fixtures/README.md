# Kilo CLI request fixtures

`kilo-cli-request-{chat,responses,messages}.json` are requests built by the installed
`@kilocode/cli` **7.8.18** and captured through a loopback recorder pointed at
`https://ai-gateway.kilo.ai` (`KILO_AI_GATEWAY_URL=<recorder>/api/v1`). The command was
`kilo run --format json -m kilo/<model> "Reply with exactly: OK"` with a fresh CLI home.

All three captures use the shipped paid exemplars (`google/gemma-4-26b-a4b-it`,
`openai/gpt-6-luna`, `anthropic/claude-haiku-5.5`). The reference account has no credit, so the
gateway returned `402` after the request was recorded; **no generation ran and nothing was spent**.
The request body is therefore the CLI's real wire shape, not a reconstruction, and the `status` field
records the 402.

Only cache-relevant headers are kept: `content-type`, `anthropic-version`, `anthropic-beta`,
`x-kilocode-taskid`, `x-session-affinity`, `x-session-id`, and `x-kilocode-mode`. `authorization`
and `x-api-key` are omitted, as are the CLI's machine id and unrelated attribution headers.

What the captures establish (plan 213 Task 4):

- **Chat**: no cache field and no `cache_control` anywhere; the task id is the only affinity lever.
- **Responses**: no `prompt_cache_key`; `store: false`. On GPT-5.6+ the CLI adds content-level
  `prompt_cache_breakpoint: {mode: "explicit"}` markers to its input items. Prism sends neither the
  key nor those markers because the gateway places its own breakpoints (Task 1b); the lever that
  matters is the task id plus a stable prefix.
- **Messages**: `cache_control: {type: "ephemeral"}` on the first two system messages and the last
  two non-system messages' last stable content part (a trailing `<environment_details>` text part is
  skipped), with no TTL and no tool marker.

The task ids are the CLI session ids. `cache-levers.test.ts` uses each capture's task id as the
Prism session id, so the `X-KILOCODE-TASKID` values are compared exactly. The prefix comparison uses
the shared plan-203 transcript; the CLI bodies contain the CLI's own system prompt and 24 tools, so
only cache-relevant fields, header values, and prefix stability are compared, not prompt bytes.
