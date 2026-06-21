# OpenAI provider package

`@prism/provider-openai` provides explicit, side-effect-free provider setup for OpenAI Responses API and OpenAI Codex OAuth-backed Responses usage.

```ts
import { createEnvCredentialResolver } from "prism";
import { createOpenAIProviderPackage } from "@prism/provider-openai";

api.registerProviderPackage(createOpenAIProviderPackage({
  apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
}));
```

Exports:
- `createOpenAIProviderPackage(options)`
- `createOpenAIResponsesProvider(options)`
- `createOpenAICodexProvider(options)`
- `openAIModels`, `openAICodexModels`
- `createOpenAICodexOAuthProvider(options)`, `openAICodexOAuthProvider`
- `createPkceVerifier()`, `computeS256Challenge(verifier)` (RFC 7636 PKCE helpers, exported for testing)

Behavior:
- No package import, setup, build, or default test performs a live network call.
- Credentials are resolved per request from caller-supplied values/resolvers only.
- `ProviderRequest.options.sessionId`, `cacheKey`, `cacheRetention`, `headers`, `compat`, and `extra` map to request headers/payload fields.
- The Responses adapter preserves text, thinking (downgraded to text), assistant `tool_call` blocks as `function_call` input items, `tool_result` blocks as `function_call_output` input items, and image blocks when `capabilities.input` includes `"image"`. Unsupported block placements or unclaimed images fail before fetch.
- OAuth browser/device-code flows only run when the caller explicitly invokes the OAuth provider.
- Browser login uses RFC 7636 PKCE with `code_challenge_method=S256`: a cryptographically random verifier (`createPkceVerifier`, base64url of 32 random bytes, 43 chars) and `computeS256Challenge(verifier)` = `base64url(SHA-256(verifier))`. The verifier is exchanged at the token endpoint, never sent on the authorize URL.
- `OpenAICodexOAuthOptions.redirectUri` and `scope` are forwarded to the authorize URL; `scope` is also sent on the device-code POST body when supplied.
- API-key and Codex-subscription base URLs are distinct: `createOpenAIResponsesProvider` defaults to `https://api.openai.com/v1`, while `createOpenAICodexProvider` defaults to `https://chatgpt.com/backend-api/codex` (the Codex subscription Responses backend). `createOpenAIProviderPackage` wires them separately via `baseUrl` and `codexBaseUrl`; a Codex OAuth access token never silently hits the plain `/v1` endpoint.
- OAuth errors redact known token values (`[REDACTED]`).

Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` and fake-safe provider-specific env names.
