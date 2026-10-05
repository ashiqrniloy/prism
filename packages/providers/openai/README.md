# `@arnilo/prism-provider-openai`

OpenAI provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the OpenAI
Responses (`openai`) and Codex (`openai-codex`) providers, resolves their keys through the
credentials slot on every request, exposes Codex OAuth as an `auth` descriptor, and ships the model
catalog.

## Install

```sh
bun add @arnilo/prism-provider-openai
```

## Use

```ts
import openai from "@arnilo/prism-provider-openai";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai/gpt-5.2",
  packages: [openai({ apiKey: "env:OPENAI_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [openai]` is the same as
`openai({ apiKey: "env:OPENAI_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:OPENAI_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.openai.com/v1` | Official Responses base. |
| `codexAccessToken` | `env:`/`keyring:` ref | `keyring:openai-codex` | Codex OAuth access token; the login writes it here. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Factory-only options — `fetch`, `codexBaseUrl`, `oauth` — are not JSON and cannot come from a
manifest.

## Codex OAuth

The `openai-codex` provider carries an `auth` descriptor:

```ts
const provider = agent.models.resolve("openai-codex/gpt-5.1-codex").provider;
const oauth = provider.auth?.find((method) => method.kind === "oauth");
await oauth.login({
  host,        // a HostPort with `ui`
  credentials, // { store(ref, secret), delete(ref) }
});
```

`login` drives the device-code flow through `ctx.host` (`open-url`) and persists the tokens with
`ctx.credentials.store("keyring:openai-codex", …)`. It never spawns a process and never opens a
browser itself. A host that answers `unavailable` makes `login` throw `OAuthUnavailableError`
(`code: "oauth_unavailable"`) and store nothing. No token ever appears in a `host.ui` request.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "<provider>: no API key at <ref>")` and registers both providers anyway, so
  `agent.models` still lists the catalogs and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called; Codex lists its static catalog.
- **Secrets never surface.** Every resolved value joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createOpenAIResponsesProvider`, `createOpenAICodexProvider`, `createOpenAICodexOAuthProvider`,
`computeS256Challenge`, `createPkceVerifier`, the catalog (`openAIModels`, `openAICodexModels`,
`listOpenAIModels`, `mapOpenAIModel`, `defineOpenAIModel`), plus the batch, embeddings, images,
moderation, realtime, speech, transcription, and prompt-cache surfaces.

## License

MIT
