# `@arnilo/prism-provider-bedrock`

Amazon Bedrock provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `bedrock` provider, resolves AWS credentials through the credentials slot on every request, and ships the SigV4 signer plus both routes: the OpenAI-compatible `/openai/v1` surface (default) and the native model-agnostic `Converse`/`ConverseStream` operations.

## Install

```sh
bun add @arnilo/prism-provider-bedrock
```

## Use

```ts
import bedrock from "@arnilo/prism-provider-bedrock";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0",
  packages: [
    bedrock({
      region: "us-east-1",
      accessKeyId: "env:AWS_ACCESS_KEY_ID",
      secretAccessKey: "env:AWS_SECRET_ACCESS_KEY",
    }),
  ],
});
```

`region` is required, so a bare `packages: [bedrock]` needs it from `packageConfig`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `region` | string | — (required at setup) | AWS region; also used for residency checks. |
| `accessKeyId` | `env:`/`keyring:` ref | `env:AWS_ACCESS_KEY_ID` | Resolved through the credentials slot on every request. |
| `secretAccessKey` | `env:`/`keyring:` ref | `env:AWS_SECRET_ACCESS_KEY` | Resolved through the credentials slot on every request. |
| `sessionToken` | `env:`/`keyring:` ref | `env:AWS_SESSION_TOKEN` | Optional STS session token; an unresolved ref means the credential has none. |
| `endpoint` | https URL | `https://bedrock-runtime.<region>.amazonaws.com` | Optional PrivateLink / VPC interface endpoint; host and path are preserved. |
| `api` | `compatible` \| `converse` | `compatible` | OpenAI-compatible route or the native Converse route. |
| `stream` | boolean | `true` | Native Converse only: `ConverseStream` or one `Converse` call. |
| `models` | `ModelConfig[]` | — | Static catalog; Bedrock model ids are region- and account-scoped. |

Set config through the code instance or through `AgentConfig.packageConfig` (which wins). Factory-only
options — `id`, `fetch`, `signRequest`, `credential` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing credential.** `createAgent` still succeeds. Setup records a `warn` status note naming the
  ref and registers the provider anyway, so `agent.models` still lists the catalog and the failure is
  not `Unknown provider`. A run then fails with `credential_unavailable`, naming the ref and never a
  value.
- **Discovery is caller-gated.** Nothing fetches during setup.
- **Secrets never surface.** Every resolved credential joins the agent's redaction set, so it is masked
  in events, `inspect()`, status notes, and errors.
- **Host-owned credential resolution.** A host that owns SSO profile / IRSA / instance-role / assumed-role credentials passes its own `credential` callback through the factory instead of the refs; the refs are then never read.
- **Two notes, one per unresolved half.** Setup records `bedrock: no accessKeyId at <ref>` and `bedrock: no secretAccessKey at <ref>` (the session token is optional and never warns). Both resolved values join the agent's redaction set.
## Named exports

The raw factories stay public for tests and advanced hosts: `createBedrockProvider`, `createBedrockConverseProvider`, `bedrockRuntimeEndpoint`, `signAwsRequest`, `bedrockConverseBody`/`bedrockConverseStreamEvents`/`bedrockConverseResponseEvents`, the AWS event-stream codec (`readAwsEventStream`, `crc32`, `eventStreamHeader`), and the thinking helpers.

## License

MIT
