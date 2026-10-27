# OpenRouter Chat wire fixtures

Created 2026-10-25 for offline replay. **All JSON fixtures here are synthetic documented-shape
contracts, not captured live recordings.** Models: `google/gemma-4-31b-it:free` (pinned free wire)
and `anthropic/claude-haiku-4.5` (explicit-cache shape). The original temporary free-router probe
files are unavailable. No paid or pinned-model call was authorized or sent to create these files.
The 401 envelope matches the public unauthenticated observation; 402 and HTTP-200 mid-stream
errors follow OpenRouter's documented envelopes. Cache write/read counts are synthetic assertions,
not performance evidence. `cache-anthropic.json` has three turns: write, read, read.

Replay command (no credentials or network):

```bash
bun test packages/providers/openrouter/src/__tests__/openrouter.test.ts
```

Scenarios: text, tool-loop, thinking (`reasoning_details`), structured-output, cache-implicit,
cache-anthropic, error (401), error-credits (402), error-mid-stream (429 after partial output).
The documented overflow test lives in `openrouter.test.ts`; no observed overflow is claimed.

Future authorized captures can replace fixtures using `scripts/wire-proxy.mjs --upstream
https://openrouter.ai/api/v1 --listen 127.0.0.1:8787 --record <scratch> --secret-env OPENROUTER_API_KEY`.
Never capture credentials, cookie headers, account ids or sensitive prompts. Review and scrub
artifacts before copying them here; record exact date, model, served provider and capture command.
