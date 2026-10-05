# `@arnilo/prism-provider-xai`

xAI (Grok) provider package for Prism: registers the xai provider, resolves its key from an `env:`/`keyring:` ref per request, ships the OpenAI-compatible wire, and wraps SuperGrok device-code OAuth as an `auth` descriptor.

## Install

```sh
bun add @arnilo/prism-provider-xai
```

## Use

```ts
import xai from "@arnilo/prism-provider-xai";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "xai/grok-4.6",
  packages: [xai({ apiKey: "env:XAI_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [xai]` is the same as
`xai({ apiKey: "env:XAI_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:XAI_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `accessToken` | `env:`/`keyring:` ref | `keyring:xai` | SuperGrok OAuth access token; the `auth` descriptor writes it. Prefer it over `apiKey` when both resolve. |
| `baseUrl` | string | vendor default | Official Chat Completions base; defaults to `https://api.x.ai/v1`. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks the vendor's `/models` endpoint. |

Set config through the code instance (`xai({ apiKey: "env:XAI_API_KEY" })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `oauth`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "xai: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A run then fails
  with `credential_unavailable`, naming the ref and never a value.
- **OAuth.** `createXaiProvider` and the `xai` provider carry an `auth` descriptor that
  drives the SuperGrok device-code flow over `ctx.host` (`open-url`) and persists the tokens through
  `ctx.credentials.store`. Without a UI it fails closed with `oauth_unavailable`; it never spawns a
  process or opens a browser itself.

- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createXaiProvider`, the wire helpers, and the
catalog.

## License

MIT
