# @arnilo/prism-provider-google

Native Google Gemini (`generateContent` / `streamGenerateContent`) provider for Prism. No vendor SDK.

```ts
import { createGoogleProviderPackage, listGoogleModels } from "@arnilo/prism-provider-google";

api.registerProviderPackage(createGoogleProviderPackage({ apiKey: "fake-google-key" }));

// Caller-gated discovery (never during setup)
const models = await listGoogleModels({ apiKey: "fake-google-key" });
api.registerProviderPackage(createGoogleProviderPackage({ apiKey: "fake-google-key", models }));
```

Exports:
- `createGoogleProviderPackage()`
- `createGoogleGenerateContentProvider()`
- `listGoogleModels()` / `mapGoogleModel()` / `defineGoogleModel()`
- `googleModels` (featured offline aliases)
- `googleThinkingConfig` / `googlePreserveThinking`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Credentials are resolved per request from caller-supplied values or resolvers; this package registers `api_key` only.
- No Gemini CLI subscription OAuth, token, or credential-file import. Gemini CLI prohibits third-party OAuth piggybacking: <https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md>.
- Provider-owned headers (`content-type`, `x-goog-api-key`) win over caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` + `GOOGLE_API_KEY` (or `GEMINI_API_KEY`).

Featured models (offline bootstrap): `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.5-flash`.

Out of scope in 0.0.12: Vertex AI enterprise identity / ADC.

Docs: [`docs/providers/google.md`](../../docs/providers/google.md)
