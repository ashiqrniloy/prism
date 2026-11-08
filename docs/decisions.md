# Decisions

Typed decision calls: one request asks a decision model a set of questions about a state and returns calibrated probabilities instead of generated text.

## What it does

A decision model answers in one pass. Each question is `noul` (a probability), `choice` (one option with per-option probabilities), or `score` (a value on an ordered rubric). Answers keep the raw probabilities and confidence, so a host can gate on a threshold rather than parse prose.

The kernel owns the contract, the bounds, and the typed error. A provider package supplies the adapter; a model declares `capabilities.decisions: true` to opt in.

## When to use it

Use decisions when a host needs a calibrated `yes`/`no`, a classification with confidence, or a rubric score, and the model is a decision model (for example a System One checkpoint). Do not use it for free-form generation: that is `models.client()` and `generate()`.

## Inputs

`prism.models.decisions(ref?)` returns a client bound to one model. `ref` defaults to `AgentConfig.model`. It needs the package `models` capability.

`decide(request)` accepts:

| Field | Meaning |
| --- | --- |
| `questions` | Required. `1`–`64` entries keyed by question id. |
| `state` | Conversation or document text: a string, JSON object, or array. Serialized size is capped at 256 KiB. |
| `images` | Optional inline `data:image/*;base64` URLs, `8 MiB` decoded in total. Remote URLs are rejected. |
| `signal` | Optional `AbortSignal`. |

Each question carries `instructions` (a non-empty string, object, or array) and:

- `noul`: optional `criteria` with `true`/`false` descriptions.
- `choice`: required `criteria` object of `2`–`255` option → description (or `null`).
- `score`: required `criteria` array of `2`–`10` ordered level descriptions.

Bounds are validated by `assertDecisionRequest` before any adapter runs. State and image ceilings throw `DecisionsError` with code `state_too_large`; every other violation throws `invalid_request` naming the question or field. `unsupported_model` means the model does not declare `capabilities.decisions` or the provider registers no adapter.

Images require the model to declare `image` in `capabilities.input`. A model whose `input` is absent is treated as unknown, matching the rest of the kernel; a declared list without `image` fails closed.

## Outputs

`decide()` resolves to `DecisionResult`:

| Field | Meaning |
| --- | --- |
| `model` | The checkpoint that actually answered; the requested model is advisory. |
| `answers` | Raw answers keyed by question id, discriminated by `type`. |
| `usage` | Input-token usage when the endpoint reports it. |
| `timingMs` | Wall-clock milliseconds for the whole call. |

Answers keep everything the wire returned:

```ts
type DecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "score"; score: number; legend?: Record<string, string>; probabilities?: Record<string, number>; confidence?: number };
```

## Request-response example

```ts
const jev = prism.models.decisions("typesafe/jev-latest");
const { answers, timingMs } = await jev.decide({
  state: ticketText,
  images: [screenshotDataUrl],
  questions: {
    urgent: { type: "noul", instructions: "Is the customer blocked right now?", criteria: { true: "blocked", false: "not blocked" } },
    team: { type: "choice", instructions: "Which team owns this?", criteria: { billing: null, shipping: null } },
    severity: { type: "score", instructions: "How severe?", criteria: ["low", "medium", "high"] },
  },
});

if (answers.urgent?.type === "noul" && answers.urgent.noul > 0.8) escalate();
```

A string `ref` carries no capabilities, so the provider adapter gates its own model. Pass a model object when the host should fail fast:

```ts
prism.models.decisions({ provider: "typesafe", model: "jev-latest", capabilities: { decisions: true, input: ["text"] } });
```

## Implementation example

A provider exposes the adapter through the optional `ModelProvider.decisions()` method:

```ts
import { assertDecisionRequest, type DecisionsProvider, type ModelProvider } from "@arnilo/prism";

const decisions: DecisionsProvider = {
  id: "acme",
  async decide(request) {
    assertDecisionRequest(request, model);
    const response = await post(request); // the provider's own client
    return { model: response.model, answers: response.answers, timingMs: 0 };
  },
};

const provider: ModelProvider = { id: "acme", generate, decisions: () => decisions };
```

The adapter receives `DecisionRequest`, which always carries `model`: `models.decisions(ref)` binds the resolved id, so package callers omit it. A host can reach the raw adapter through `agent.models.resolve(ref).provider.decisions?.()`, and must then pass `model` itself and call `assertDecisionRequest` before the wire call.

## System One endpoints

Every endpoint below speaks the System One wire, so one family of packages reaches them: each recipe registers `createSystemOneDecisionProvider` in a small package. Only the base URL, path, key ref, and model id change. Nothing is fetched at setup; `models()` and the first `decide()` do all I/O. All keyed recipes use `env:` refs, resolved through the credentials slot at call time.

The shared shape is:

```ts
import { definePackage } from "@arnilo/prism";
import { createSystemOneDecisionProvider, refSource, type SystemOneDecisionProviderOptions } from "@arnilo/prism/provider-kit";

// A recipe is this wrapper plus the options below; `keyRef` is resolved through the credentials slot.
const decisionPackage = (name: string, options: Omit<SystemOneDecisionProviderOptions, "apiKey"> & { keyRef?: string }) =>
  definePackage({
    name,
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["credentials"],
    setup(prism) {
      const { keyRef, ...providerOptions } = options;
      const apiKey = keyRef === undefined ? undefined : refSource((ref) => prism.credentials.resolve(ref), keyRef);
      prism.providers.register(createSystemOneDecisionProvider({ ...providerOptions, ...(apiKey === undefined ? {} : { apiKey }) }));
    },
  })();
```

### Ollama Cloud

The shipped `@arnilo/prism-provider-ollama-cloud` package serves Ollama's decision models (`/api/show` capability `decision`, e.g. `clef:27b`) at `/v1/systemone` with the same key as its chat models; no extra package is needed.

```ts
// packages: [ollamaCloud({ apiKey: "env:OLLAMA_API_KEY" })]
const clef = prism.models.decisions("ollama-cloud/clef:27b");
```

- Caveat: input is limited to the model's 65,536-token window; longer states are rejected, not truncated.
- Price: per input token on ollama.com/pricing (no output tokens).

### OpenRouter

One key reaches many decision models; the model id carries the vendor prefix.

```ts
const openrouter = decisionPackage("@acme/openrouter-decisions", {
  id: "openrouter-decisions",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api",
  path: "/v1/systemone",
  keyRef: "env:OPENROUTER_API_KEY",
});
// model: "liquid/d1" or another decision model listed by OpenRouter
```

- Caveat: OpenRouter's catalog and aliases move; pin a versioned id such as `liquid/d1` and log `DecisionResult.model`.
- Price: OpenRouter's model page (input per 1M tokens). Decision replies have no output tokens.

### Fastino GLiDE

```ts
const fastino = decisionPackage("@acme/fastino-decisions", {
  id: "fastino-decisions",
  label: "Fastino GLiDE",
  baseUrl: "https://api.fastino.ai",
  path: "/v1/systemone",
  keyRef: "env:FASTINO_API_KEY",
});
// model: "fastino/glide"
```

- Caveat: GLiDE is a "thinking" decision model with a 40k context; Fastino prices it per task, so per-token cost is not comparable.
- Price: Fastino's pricing page and the Artificial Analysis listing (about $119 per 1M tasks at survey time); no output tokens.

### Celeris-1 Decision

```ts
const celeris = decisionPackage("@acme/celeris-decisions", {
  id: "celeris-decisions",
  label: "Celeris-1 Decision",
  baseUrl: "https://inference.celeris.ai",
  path: "/celeris-1-decision/v1/systemone",
  keyRef: "env:CELERIS_API_KEY",
});
// model: "celeris-1-decision"
```

- Caveat: the path names the model, so a different Celeris checkpoint needs its own base/path pair; its OpenAI-Dialect endpoint needs the separate codec (not shipped).
- Price: Celeris pricing (about $0.04 per 1M input tokens); no output tokens.

### Microsoft Foundry

```ts
const foundry = decisionPackage("@acme/foundry-decisions", {
  id: "foundry-decisions",
  label: "Microsoft Foundry",
  baseUrl: "https://<resource>.services.ai.azure.com",
  path: "/providers/microsoft/v1/systemone",
  keyRef: "env:AZURE_AI_API_KEY",
});
// model: the deployment name, e.g. "Microsoft-Decision-1"
```

- Caveat: the wire `model` is your deployment name, not the catalog name; a renamed deployment is a different id.
- Price: Azure AI Foundry pricing for the deployed model (about $0.042 per 1M input tokens); no output tokens.

### TrueFoundry

```ts
const truefoundry = decisionPackage("@acme/truefoundry-decisions", {
  id: "truefoundry-decisions",
  label: "TrueFoundry",
  baseUrl: "https://<gateway-host>",
  path: "/v1/systemone",
  keyRef: "env:TRUEFOUNDRY_API_KEY",
});
// model: the gateway alias for the upstream decision model
```

- Caveat: the gateway must expose the Decisions route and may translate to an OpenAI-Dialect upstream; use the alias it serves, not the vendor's raw id.
- Price: the upstream model's page, passed through by the gateway (input only, no output tokens).

### llama-server (any decision GGUF)

```ts
const local = decisionPackage("@acme/llama-decisions", {
  id: "llama-decisions",
  label: "llama-server",
  baseUrl: "http://127.0.0.1:8080",
  path: "/v1/systemone",
  // no key: local servers need none
});
// serve: llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0 --port 8080
// model: "LiquidAI/d1-3B" (the name llama-server reports)
```

- Caveat: keep the decision head at Q8_0 or higher; low-bit imatrix quantization moves top answers and degrades calibration.
- Price: local hardware only; no per-token bill and no output tokens.

### laya-serve

```ts
const laya = decisionPackage("@acme/laya-decisions", {
  id: "laya-decisions",
  label: "Laya",
  baseUrl: "http://127.0.0.1:8000",
  path: "/v1/systemone",
  // no key: laya-serve needs none
});
// model: "laya"
```

- Caveat: Laya's 512-token context truncates long states, and its shipped calibration is weak (ECE 0.466); keep states short and calibrate thresholds on your labels.
- Price: local hardware only; no per-token bill and no output tokens.

## Operating rules

- **Pin versioned ids and log the returned `model`.** Aliases move under you; `DecisionResult.model` is the checkpoint that actually answered, so record it with every decision.
- **Calibrate thresholds per model on your own labels.** A few hundred labeled examples beat any vendor claim; probabilities are not comparable across models or Decision Index versions.
- **Keep the question out of the state.** Put instructions and criteria in `questions`; state is evidence. Mixing them lets the model answer its own framing.
- **Never use a decision model as the only prompt-injection defense.** It is one signal beside allowlists, provenance, and human approval, not a replacement for them.
- **Keep local decision heads at Q8_0 or higher.** Quantizing the head itself moves answers; quantization of the backbone is the lesser risk.

## Extension notes

- The vocabulary is the System One one (`noul`, `choice`, `score`) because every endpoint known today speaks it. A vendor with a different dialect maps at its own codec.
- The kernel caps a request at 64 questions; a raw wire call may accept more.
- `assertDecisionRequest(request, model)` is public so adapters enforce the same bounds.
- System One adapters (`createSystemOneDecisionProvider`, shared by `typesafe`, `laya`, `liquid`, and `ollama-cloud`'s decision models) implement `decisions()` over the same client as `generate()`, so retry, abort, credential resolution, and redaction are identical. The endpoint `path` is configurable (default `/v1/systemone`, e.g. Foundry's `/providers/microsoft/v1/systemone`); a path without a leading `/` fails at construction. A 401/422 from the wire becomes `DecisionsError("invalid_request")` with the credential redacted.

## Security and performance notes

- `decisions` is one optional member on `ModelProvider` and one capability flag, so the `generate` path imports nothing new.
- Images must be inline data URLs. The kernel never fetches one, so a request adds no SSRF surface.
- Adapter error messages pass through the agent's redactor, like every other provider surface. A resolved credential never appears in an event, note, log, or `inspect()` output.
- The 8 MiB image ceiling is sized for a few full-page screenshots at decision-model input resolutions; it is deliberately below the 32 MiB general media budget, because decision calls are latency-sensitive.

## Related APIs

- [Models](models.md): `ModelRef`, resolution, capabilities, and `models.client()` / `models.embeddings()`.
- [Provider kit](provider-kit.md): `@arnilo/prism/provider-kit`, including the System One wire client.
- [Packages](packages.md): the `models` capability and `PackageAPI.models`.
