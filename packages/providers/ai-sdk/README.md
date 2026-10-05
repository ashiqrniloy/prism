# `@arnilo/prism-provider-ai-sdk`

AI SDK bridge provider package for [Prism](https://github.com/ashiqrniloy/prism). Adapts a **host-owned** AI SDK `LanguageModelV4` into a Prism provider. Unlike the HTTP vendor packages this one owns no wire: the model instance is a factory-only option, and `@ai-sdk/provider` stays an optional peer of this package alone — the kernel and every other provider package never load it.

## Install

```sh
bun add @arnilo/prism-provider-ai-sdk
```

## Use

```ts
import aiSdk from "@arnilo/prism-provider-ai-sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { createAgent } from "@arnilo/prism";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const agent = await createAgent({
  model: "ai-sdk:openai/gpt-5.1",
  packages: [aiSdk({ model: openai("gpt-5.1") })],
});
```

A bare `packages: [aiSdk]` registers nothing and records an `info` note: the bridge needs a host model.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `id` | string | `ai-sdk:<model.provider>` | Prism provider id. |
| `models` | `ModelConfig[]` | — | Static catalog; when absent, `models()` derives one entry from the host model id. |

Set config through the code instance or through `AgentConfig.packageConfig` (which wins). Factory-only
options — `model`, `redactor`, `readVersion` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing credential.** `createAgent` still succeeds. Setup records a `warn` status note naming the
  ref and registers the provider anyway, so `agent.models` still lists the catalog and the failure is
  not `Unknown provider`. A run then fails with `credential_unavailable`, naming the ref and never a
  value.
- **Discovery is caller-gated.** Nothing fetches during setup.
- **Secrets never surface.** Every resolved credential joins the agent's redaction set, so it is masked
  in events, `inspect()`, status notes, and errors.
- **Setup fails closed and never throws.** A missing peer, an unlisted peer version, or no host model records a `status.note` and registers nothing (roadmap §2.6), so `createAgent` still succeeds and the host sees why. A direct `createAiSdkProvider()` call keeps the strict version-matrix check and throws typed `AiSdkProviderError`.
## Named exports

The raw factories stay public for tests and advanced hosts: `createAiSdkProvider`, `toAiSdkPrompt`/`toAiSdkCallOptions`/`toAiSdkTool`, `mapAiSdkStream`/`mapUsage`, `AiSdkProviderError`, `assertSupportedAiSdkVersion`, `probeAiSdkPeer`, `readInstalledAiSdkVersion`, `SUPPORTED_AI_SDK_SPECIFICATION`, `SUPPORTED_AI_SDK_VERSION_MATRIX`.

## License

MIT
