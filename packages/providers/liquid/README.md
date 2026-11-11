# `@arnilo/prism-ai/liquid`

Liquid provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers two decision-model providers over the shared System One wire:

- **`liquid` (hosted):** Liquid's `d1.1` and `d1-ultra` decision models at `https://api.liquid.ai`, keyed by `LIQUID_API_KEY`.
- **`liquid-local`:** Liquid's open-weight `d1-3B` served by llama.cpp's `llama-server` on loopback, no key required by default.

## Install

```sh
bun add @arnilo/prism-ai
```

## Use

```ts
import liquid from "@arnilo/prism-ai/liquid";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "liquid/d1.1",
  packages: [liquid({ apiKey: "env:LIQUID_API_KEY" })],
});

const routing = await agent.models.decisions("liquid/d1.1").decide({ state, questions });
```

Local-only development skips the hosted provider, and with it the missing-key note:

```ts
const agent = await createAgent({
  model: "liquid-local/d1-3B",
  packages: [liquid({ hosted: false })],
});
```

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:LIQUID_API_KEY` | Hosted key. A missing key records a `warn` status note, registers the provider anyway, and fails the request with `credential_unavailable`. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.liquid.ai` | Hosted endpoint. |
| `path` | string | `/decisions/v1/systemone` | Hosted endpoint path; must start with `/`. |
| `maxRetries` | number | `2` | Retries after the first attempt, shared with the System One client (429 and 5xx retry; 401/422 do not). |
| `hosted` | boolean | `true` | `false` registers only `liquid-local`. |
| `localBaseUrl` | string | `http://127.0.0.1:8080` | `llama-server` endpoint. |
| `localApiKey` | `env:`/`keyring:` ref | `env:LIQUID_LOCAL_API_KEY` | Optional ref for `llama-server --api-key`. When it resolves to nothing, no `Authorization` header is sent. |

Set config through the code instance (`liquid({ localBaseUrl })`) or `AgentConfig.packageConfig` (which wins). `fetch` is a factory-only option and cannot come from a manifest:

```json
{ "packages": { "@arnilo/prism-ai/liquid": { "apiKey": "env:LIQUID_API_KEY", "localBaseUrl": "http://127.0.0.1:8080" } } }
```

## Catalog

| provider | model | input | context | input price |
| --- | --- | --- | --- | --- |
| `liquid` | `d1.1` | text, image | — (not documented) | $0.02 / MTok |
| `liquid` | `d1-ultra` | text, image | — (not documented) | $0.042 / MTok |
| `liquid-local` | `d1-3B` | text, image | 32,768 | free |

Tokens are billed on input only (output is free, cached input costs the same), and an image is charged again for every question in the request. Prices are Liquid's 2026-10-23 list; `d1.1` has no row of its own and is charged at the `d1` row. Each hosted catalog entry records the source in `metadata.priceSource`. The legacy `d1` id is not shipped; it is the earlier model that Liquid now serves through OpenRouter/Vercel.

## Behaviour

- **A decision model, not a chat model.** The primary call is `prism.models.decisions("liquid/d1.1").decide({ state, images, questions })`, which returns raw answers with probabilities, confidence, legends, usage, and timing. A `generate()` request must carry `options.structuredOutput` with a JSON schema; tools are rejected up front and there is no streaming. One `POST` round trip returns the rendered, schema-valid JSON as a single text delta.
- **Images.** Both providers declare `input: ["text", "image"]` and forward `images` as data URLs or `{content_type, base64}` objects. The kernel caps decoded images at 8 MiB; **Liquid's hosted API caps the whole request body under 4.5 MB and allows at most 8 images**, so a request between the two limits fails at the vendor with a 4xx. Those are the vendor's limits, not additional Prism knobs.
- **Hosted path.** `/decisions/v1/systemone` on `https://api.liquid.ai` is the documented endpoint and what the package pins. The API also answers at the undocumented root `/v1/systemone`; a host that needs a proxy prefix can override `path`.
- **Local server prerequisite.** `llama-server` must be **build `b11480` or later** (the first release that includes d1-3B support and its multimodal projector). Install it from the [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) — on Ubuntu x64 the `llama-bNNNNN-bin-ubuntu-x64.tar.gz` archive is enough (extract, then run `./llama-server`); the benchmarks below used `b11840`. The recommended run:

  ```sh
  llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0 --alias d1-3B --port 8080
  ```

  `-hf` downloads the GGUF and the matching `mmproj` projector into `~/.cache/huggingface/hub` (about 4.8 GB for Q8_0 plus Q4_K_M); an image request without a projector returns 501. Q8_0 is the recommended quant: nearly lossless against BF16 at 3.12B parameters, and the local run is not cost-bound. It also answers as `d1-3B` in `GET /v1/models`, which is what the package sends.
- **`--alias` and router mode.** `--alias d1-3B` sets the id that `GET /v1/models` reports and that single-model requests answer as. In router mode (`llama-server` started without a model) the router owns the id: send the id the router lists, not the `--alias` value. The package sends the catalog id `d1-3B`, which matches the single-model setup above.
- **`--api-key`.** Set `env:LIQUID_LOCAL_API_KEY` (or pass another ref through `localApiKey`); requests then carry `Authorization: Bearer <key>`. When the ref resolves to nothing, no header is sent (and a server started with `--api-key` answers 401).
- **Hosted vs local are not confirmed to be the same model.** Liquid documents `d1-3B` as built on LFM2.5-VL-3B and calls `d1-ultra` a larger open-weight model with Liquid-specific customizations; nothing states the hosted weights equal the GGUF in this package. `docs/_evidence/decision-bench-<date>.md` (plan 196 Task 3) is where the hosted-vs-local agreement rate lands once a hosted key is present. The first live run (no hosted key) measured the two local quants instead: Q8_0 vs Q4_K_M agree on 95.5% of the 200 Prism-shaped items (62.5% / 63.0% accuracy, 0.112 / 0.118 ECE, p50 443 / 327 ms on a 16-core Ryzen 9 PRO 7940HS CPU).
- **Discovery is caller-gated.** Nothing fetches during setup. `models()` returns the curated catalog without a request; `llama-server` `/v1/models` discovery is not implemented.
- **Secrets never surface.** A configured key joins the agent's redaction set, masking it in events, `inspect()`, status notes, and errors.
- **Plaintext remote warning.** A non-loopback plaintext `baseUrl` or `localBaseUrl` warns through the kit while still connecting (air-gapped LANs), printing only the origin.

## Named exports

`liquid` (and the default definition), `createLiquidProvider`, `createLiquidLocalProvider`, `liquidModels`, `liquidLocalModels`, `defineLiquidModel`, `type LiquidModelConfig`, `type LiquidProviderOptions`, `type LiquidProviderConfig`, and the constants `LIQUID_DEFAULT_BASE_URL`, `LIQUID_DEFAULT_PATH`, `LIQUID_LOCAL_BASE_URL`, `LIQUID_API_KEY_ENV`, `LIQUID_DEFAULT_API_KEY_REF`, `LIQUID_DEFAULT_LOCAL_API_KEY_REF`.

## License

The package is MIT. The recommended `d1-3B` weights are **LFM Open License 1.0 (`lfm1.0`)**: free commercial use below $10M annual revenue, with the licence's attribution and use restrictions above it. Prism ships no weights.

## Wire recordings

`src/__tests__/wire/systemone` replays the hosted request/response shape offline. The fixtures were reconstructed from Liquid's docs on 2026-10-23 because no hosted key was available when the package landed (plan 196 Task 1); replace them with captured exchanges once the gated live row has run.
