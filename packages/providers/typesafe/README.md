# `@arnilo/prism-provider-typesafe`

TypeSafe Jev provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the hosted `typesafe` decision model, resolves its key through the credentials slot on every request, and ships the System One wire (shared with `@arnilo/prism/provider-kit`) and the Jev catalog.

## Install

```sh
bun add @arnilo/prism-provider-typesafe
```

## Use

```ts
import typesafe from "@arnilo/prism-provider-typesafe";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "typesafe/jev-latest",
  packages: [typesafe({ apiKey: "env:TYPESAFE_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [typesafe]` is the same as
`typesafe({ apiKey: "env:TYPESAFE_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:TYPESAFE_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.typesafe.ai` | Official base. |
| `maxRetries` | number | `2` | Retries after the first attempt, forwarded to the shared System One client. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` returns the curated Jev catalog without fetching. |

Set config through the code instance (`typesafe({ apiKey: "env:TYPESAFE_API_KEY" })`) or through
`AgentConfig.packageConfig` (which wins). Factory-only options — `id` and `fetch` — are not JSON and
cannot come from a manifest.

## Behaviour

- **A decision model, not a chat model.** A request must carry `options.structuredOutput` with a JSON schema; tools are rejected up front and there is no streaming. One `POST /v1/systemone` round trip returns the rendered, schema-valid JSON as a single text delta.
- **Raw answers stay raw.** Nothing is coerced: a probability is never rounded, a choice never flattened to a boolean, and a timeout is an error rather than a synthetic neutral answer.
- **The typed decision call lives in the kit.** `askSystemOneDecisions` (with its question/answer types, typed error family, and the schema compiler) is exported from `@arnilo/prism/provider-kit`, not from this package, because both System One vendors share the wire.
- **Missing key.** `createAgent` still succeeds. Setup records
  `status.note("warn", "typesafe: no API key at <ref>")` and registers the provider anyway, so
  `agent.models` still lists the catalog and the failure is not `Unknown provider`. A request then
  fails with `credential_unavailable`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` runs only when
  `agent.models.list()` is called.
- **Secrets never surface.** The resolved key joins the agent's redaction set, so it is masked in
  events, `inspect()`, status notes, and errors.

## Named exports

`createTypeSafeProvider`, `TYPESAFE_DEFAULT_BASE_URL`, `TYPESAFE_API_KEY_ENV`, and the catalog (`typeSafeModels`, `defineTypeSafeModel`).

## License

MIT
