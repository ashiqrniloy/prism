# Changelog

## [Unreleased]

- New provider package (plan 204 Task 5): `@arnilo/prism-ai/openai-codex` registers the
  `openai-codex` provider for OpenAI models on a ChatGPT plan through Sign in with ChatGPT. The
  grant lives in a writable `keyring:` ref (default `keyring:openai-codex`), is refreshed per request
  inside a five-minute margin, and persists the rotated record before it is used. The package declares
  `capabilities: ["credentials", "credentials:write"]`; an `env:` credential ref is refused at load,
  and a missing record records `openai-codex: not signed in` and still registers the provider.
- One stateless route: `POST /responses` with `store: false`, `stream: true`, and
  `include: ["reasoning.encrypted_content"]`. `prompt_cache_key` is clamped to 64 characters; the same
  key travels as `session_id` and `x-client-request-id`. Fourteen route-refused fields are deleted
  after the body is built, `max_output_tokens` passes through with a local minimum of 16, and
  `previous_response_id` is never sent.
- Errors map through `providerHttpError`: a plan usage limit classifies `quota` with a message naming
  ChatGPT Settings → Usage, `invalid_user` asks for a new sign-in, and nothing in the table is retried.
- Model catalog: static `gpt-6.1-sol` (500 000 context) and `gpt-6-luna` (272 000), plus `GET /models`
  discovery that keeps `visibility: "list"` entries and maps their windows, modalities, and reasoning
  levels. `maxOutputTokens` is left undeclared because the route enforces no ceiling.
- Wire recordings for the Responses route (`text`, `tool-loop`, `structured-output`, `image`, `cache`,
  and three error bodies), plus `runProviderLiveScenarios` on the new `responses` route.
