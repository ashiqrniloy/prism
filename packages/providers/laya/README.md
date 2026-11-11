# `@arnilo/prism-ai/laya`

Laya provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the self-hosted `laya` decision model, resolves its key through the credentials slot on every request, and ships the System One wire (shared with `@arnilo/prism/provider-kit`) and the checkpoint catalog.

## Install

```sh
bun add @arnilo/prism-ai
```

## Use

```ts
import laya from "@arnilo/prism-ai/laya";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "laya/laya-decision-v1",
  packages: [laya()],
});
```

The bare definition uses the schema defaults. Unlike cloud providers, Laya defaults to `keyRequired: false` for local `laya-serve` instances, so `packages: [laya]` registers cleanly without warning notes and sends requests without an `Authorization` header when no key is configured.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:LAYA_API_KEY` | Optional. Resolved through credentials slot when present. When unset, requests proceed without `Authorization`. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `http://127.0.0.1:8000` | Local or remote server endpoint. |
| `path` | string | `/v1/systemone` | Endpoint path; must start with `/`. |
| `maxRetries` | number | `2` | Retries after the first attempt, forwarded to the shared System One client. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` returns the curated checkpoint catalog without fetching. |

Set config through the code instance (`laya({ baseUrl: "http://127.0.0.1:8000" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id` and `fetch` — are not JSON and
cannot come from a manifest.

## Behaviour

- **A decision model, not a chat model.** The primary call is `prism.models.decisions("laya/laya").decide({ state, questions })`, which returns raw answers with probabilities, confidence, legends, usage, and timing. A `generate()` request must carry `options.structuredOutput` with a JSON schema; tools are rejected up front and there is no streaming. One `POST /v1/systemone` round trip returns the rendered, schema-valid JSON as a single text delta.
- **Images stay text-only.** Laya's catalog declares `input: ["text"]` and `decisions: true`; an image part is rejected before fetch, and the `images` field is omitted from every text body.
- **Local server prerequisite.** By default, Laya expects a running `laya-serve` instance at `http://127.0.0.1:8000`. Plaintext loopback (`127.0.0.1`, `localhost`, `[::1]`) connects cleanly without warnings.
- **Plaintext remote warning.** A remote plaintext non-loopback `baseUrl` (e.g. `http://remote.lan:8000`) emits a warning printing the origin only (no path or userinfo) while still allowing the connection for air-gapped LAN environments.
- **Key-optional contract.** Because Laya is frequently self-hosted without an auth gateway, `keyRequired` is `false`. When no key is resolvable, setup records no warning notes and outgoing requests omit the `Authorization` header.
- **The typed decision call lives in the kit.** `askSystemOneDecisions` (with its question/answer types, typed error family, and the schema compiler) is exported from `@arnilo/prism/provider-kit`, not from this package, because both System One vendors share the wire.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when `agent.models.list()` is called.
- **Secrets never surface.** If a key is configured and resolved, it joins the agent's redaction set, masking it in events, `inspect()`, status notes, and errors.

## Named exports

`createLayaProvider`, `LAYA_DEFAULT_BASE_URL`, `LAYA_API_KEY_ENV`, `LAYA_DEFAULT_API_KEY_REF`, and the catalog (`layaModels`, `defineLayaModel`, `type LayaModelConfig`).

## License

MIT
