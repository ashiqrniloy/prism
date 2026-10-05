# `@arnilo/prism-provider-laya`

Laya provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the self-hosted `laya` decision model, resolves its key through the credentials slot on every request, and ships the System One wire (shared with `@arnilo/prism/provider-kit`) and the checkpoint catalog.

## Install

```sh
bun add @arnilo/prism-provider-laya
```

## Use

```ts
import laya from "@arnilo/prism-provider-laya";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "laya/laya",
  packages: [laya({ apiKey: "env:LAYA_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [laya]` is the same as
`laya({ apiKey: "env:LAYA_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:LAYA_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `http://localhost:8000` | Official base. |
| `maxRetries` | number | `2` | Retries after the first attempt, forwarded to the shared System One client. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` returns the curated checkpoint catalog without fetching. |

Set config through the code instance (`laya({ apiKey: "env:LAYA_API_KEY" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id` and `fetch` — are not JSON and
cannot come from a manifest.

## Behaviour

- **A decision model, not a chat model.** A request must carry `options.structuredOutput` with a JSON schema; tools are rejected up front and there is no streaming. One `POST /v1/systemone` round trip returns the rendered, schema-valid JSON as a single text delta.
- **Plaintext loopback by default.** `http://localhost:8000` is the `laya-serve` bind. A remote plaintext non-loopback `baseUrl` warns (the origin only, never userinfo) and still returns, so an air-gapped LAN HTTP setup works.
- **The typed decision call lives in the kit.** `askSystemOneDecisions` (with its question/answer types, typed error family, and the schema compiler) is exported from `@arnilo/prism/provider-kit`, not from this package, because both System One vendors share the wire.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "laya: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A request then
  fails with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createLayaProvider`, `layaBaseUrl`, `DEFAULT_LAYA_BASE_URL`, `LAYA_API_KEY_ENV`, and the catalog (`layaModels`, `defineLayaModel`).

## License

MIT
