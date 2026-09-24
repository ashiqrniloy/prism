# Laya provider package

## What it does

`@arnilo/prism-providers/laya` registers the Laya decision model served by `laya-serve`. Laya speaks the same `POST /v1/systemone` wire as TypeSafe Jev. It does not generate free text, stream, or call tools. A request is valid only with `options.structuredOutput`.

The package registers provider `laya`, checkpoints `laya`, `laya-multilingual`, and `laya-typed-decisions`, and an optional `api_key` auth method. The server Router picks the checkpoint. The `model` field is advisory and is not a client-side force.

## When to use it

Use it when a host runs `laya-serve` locally or on another machine and wants the same structured decision contract as Jev without a hosted account. Do not use it as a general chat model or a tool-calling agent.

## Inputs / request

```ts
import {
  createLayaProvider,
  createLayaProviderPackage,
  DEFAULT_LAYA_BASE_URL,
  defineLayaModel,
  LAYA_API_KEY_ENV,
  layaBaseUrl,
  layaModels,
} from "@arnilo/prism-providers/laya";
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Optional. Send it only when the server was started with `LAYA_API_KEY`. Absent key means no `Authorization` header. |
| `fetch` | `typeof fetch` | Optional fetch for tests and hosts. |
| `baseUrl` | `string` | Overrides `http://localhost:8000`. Any absolute URL wins, including `https://laya.example.com` and `https://10.0.0.5:8443`. Trailing slashes are trimmed. `layaBaseUrl({ baseUrl })` is the same resolver. |
| `id` | `string` | Overrides the provider id (default `laya`). |
| `models` | `readonly ModelConfig[]` | Overrides `layaModels`. |
| `maxRetries` | `number` | Retries after the first attempt. Default 2. |

Gating, schema mapping, `compat.boolean_threshold`, state rules, and the event sequence match [TypeSafe Jev](typesafe.md). Unsupported schema fields, tools, a missing schema, and an out-of-range threshold fail before any fetch.

| Checkpoint | Context | Notes |
| --- | --- | --- |
| `laya` | 512 | English encoder. |
| `laya-multilingual` | 1024 | `metadata.extendedContextWindow` is `8192` — `laya-serve` may extend the window. |
| `laya-typed-decisions` | 1024 | Typed-decision checkpoint. |

All three declare the same capability set as Jev (`structuredOutput: "json_schema"`, `streaming: false`, `tools: false`, text in and out), `maxOutputTokens: 0`, and zero cost.

## Outputs / response / events

Same sequence as Jev: `message_start`, one `content_delta` of schema-valid JSON, `usage` (`inputTokens` only, `outputTokens: 0`), `done` with `stopReason: "end_turn"`. Gate, HTTP, and render failures are a terminal `error` event. `401` is not retried and only occurs when a key is configured. `422` is not retried and the message includes the API field detail. The server's chosen model id is not rewritten into the rendered text.

## Request/response example

```json
{
  "model": "laya",
  "state": "rm -rf ./build",
  "questions": {
    "verdict": {
      "type": "choice",
      "instructions": "How should this be handled?",
      "criteria": { "run": "run", "reject": "reject" }
    }
  }
}
```

The response shape matches Jev. Rendered text is the schema object, for example `{"verdict":"reject"}`.

## Implementation example

```ts
import { createEnvCredentialResolver, createExtensionKernel } from "@arnilo/prism";
import { createLayaProviderPackage, LAYA_API_KEY_ENV } from "@arnilo/prism-providers/laya";

const kernel = createExtensionKernel();

// Local laya-serve, no key.
await kernel.load([createLayaProviderPackage()]);

// laya-serve on another machine.
await kernel.load([
  createLayaProviderPackage({
    baseUrl: "https://laya.example.com",
    apiKey: createEnvCredentialResolver(process.env, { laya: LAYA_API_KEY_ENV }),
  }),
]);
```

## Extension and configuration notes

- `baseUrl` is the deployment switch. A host-supplied endpoint always overrides `DEFAULT_LAYA_BASE_URL`.
- `model` on the wire is advisory. There is no client checkpoint override.
- Schema extension keys are `x-systemone` and the `x-typesafe` alias: `criteria` for booleans, `options` for choices, `levels` for rubrics. See [TypeSafe Jev](typesafe.md) for the field table.
- `compat.boolean_threshold` (`0..1`, default `0.5`) is the only request knob.
- No checkpoint probing and no model listing run at setup or during `generate()`.

## Security and performance notes

- **Egress follows `baseUrl`.** State text and compiled questions are sent to whatever origin that URL names. Do not put secrets in the state.
- **Cost and latency.** One `POST /v1/systemone` round trip per structured-output request. Questions are free in parallel; state tokens are the cost. Catalog cost is zero. There is no streaming and no second hop.
- **Credentials.** When set, the bearer token is resolved at the provider edge and redacted from error events. It is never logged.

### Remote deployment

Host `laya-serve` on another machine only behind TLS. Terminate HTTPS at the server or a reverse proxy, set `LAYA_API_KEY` on the server, and pass the same secret as `apiKey` on the client (`LAYA_API_KEY`). Point `baseUrl` at that `https://` origin (`https://laya.example.com`, `https://10.0.0.5:8443`, and so on).

The default `http://localhost:8000` is plaintext loopback only. A non-loopback `http://` base URL (not `localhost`, `*.localhost`, `::1`, or `127/8`) logs a `console.warn` and still sends the request — air-gapped LAN HTTP is a legitimate setup. `https://` and loopback `http://` stay silent. The warning uses the URL origin, so userinfo is not printed. Prefer HTTPS plus a matching `LAYA_API_KEY` for any machine that is not the local host.

## Related APIs

- [TypeSafe Jev](typesafe.md): hosted twin. Schema mapping and event sequence are defined there.
- [Structured output](../structured-output.md): `options.structuredOutput` contract this adapter requires.
- [Provider packages](../provider-packages.md): registration and auth-method shape.
- [Credentials and redaction](../credentials-and-redaction.md): `CredentialValueSource` and `createEnvCredentialResolver`.
