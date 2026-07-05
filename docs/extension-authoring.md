# Extension authoring guide

## What it does

This guide shows third-party package authors how to publish a Prism extension package without taking over a host app. An extension exports an `Extension` object with a `setup(api)` function. During explicit host loading, `setup()` registers inert contributions into host-owned registries: providers, models, auth descriptors, tools, context providers, skills, commands, input/prompt builders, compaction strategies, retry policies, store/resource/settings/credential hooks, provider request policies, system prompt contributions, and instruction injectors.

Extensions do not start agents, execute tools, read credentials, scan files, or call providers by themselves. The host app loads the extension, inspects/filters contributions, then chooses which entries become active runtime config.

## When to use it

Use an extension package when you want reusable Prism capabilities that many host apps can opt into:

- provider/model metadata and provider-package registration
- reusable tools, context providers, skills, commands, input builders, and prompt builders
- compaction/retry strategies and middleware hooks
- data-only manifests/resources that hosts can inspect before importing code

Do not use an extension to hide host policy. The host still owns trust, permissions, credentials, provider selection, active tool registries, skill activation, storage, UI, and sandboxing. Prism does not auto-discover or sandbox extension packages.

## Inputs / request

Package authors export a public `Extension` value:

```ts
import type { Extension } from "@arnilo/prism";

export const extension: Extension = {
  name: "acme-prism-extension",
  setup(api) {
    api.registerSkill({ name: "acme.brief", instructions: "Answer briefly." });
  },
};
```

Host apps load it explicitly:

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { extension } from "acme-prism-extension";

import { createContributionRegistries } from "@arnilo/prism";

const registries = createContributionRegistries({ duplicate: "error" });
const kernel = createExtensionKernel({ registries, secrets: [apiKey] });
await kernel.load([extension]);
```

Common `ExtensionAPI` registration calls:

| Call | Registers | Activation is host-owned |
| --- | --- | --- |
| `registerProviderPackage()` | `ProviderPackage` setup metadata | host calls package setup / selects provider |
| `registerProvider()` / `registerModel()` | provider/model records | host resolves provider/model for an agent/run |
| `registerAuthMethod()` | credential descriptor | host resolves actual credentials |
| `registerTool()` | `ToolDefinition` | host copies selected tools into an active `ToolRegistry` |
| `registerContextProvider()` | `ContextProvider` | host passes selected providers to agent/input assembly |
| `registerSkill()` | `Skill` | host selects skills via config or `RunOptions.activeSkills` |
| `registerInputBuilder()` / `registerPromptBuilder()` | replaceable builders | host passes selected builders to `createAgent()` / assembly |
| `registerCompactionStrategy()` / `registerRetryPolicy()` | strategies | host selects them in agent/run config |
| `registerCommand()` / `registerAgent()` | command/agent definitions | host exposes/runs selected entries |
| `registerProviderRequestPolicy()` / `registerSystemPromptContribution()` | provider/prompt policies | host includes selected policy/layer in runtime config |
| `registerInstructionInjector()` | inert instruction injector | host passes selected injectors to agent/run config |
| `use(hook, middleware)` | middleware hook | host passes the kernel middleware registry to runtime config |

## Outputs / response / events

`kernel.load([extension])` returns after `setup(api)` completes. The host can then inspect `kernel.registries.*.list()` or resolve named entries. Contributions stay inert until the host wires them into runtime config.

Extension errors follow the kernel policy:

- default `errorPolicy: "event"` emits an `extension_error` event with known secrets redacted
- `errorPolicy: "throw"` rejects/throws so the host can fail fast

The event bus and middleware registry are ordered and explicit. No hidden global extension kernel is created.

## Request/response example

```json
{
  "loaded": ["acme-prism-extension"],
  "contributed": {
    "tools": ["acme.echo"],
    "skills": ["acme.brief"],
    "contextProviders": ["acme.project"]
  },
  "active": {
    "tools": ["acme.echo"],
    "skills": ["acme.brief"]
  }
}
```

The `contributed` set is what the extension registered. The `active` set is what the host chose to pass into the runtime.

## Implementation example

```ts
import {
  createAgent,
  createExtensionKernel,
  createMockProvider,
  createContributionRegistries,
  createSkillRegistry,
  createToolRegistry,
  providerDone,
  type Extension,
} from "@arnilo/prism";

export const extension: Extension = {
  name: "acme-prism-extension",
  setup(api) {
    api.registerModel({ provider: "mock", model: "demo" });
    api.registerAuthMethod({ provider: "mock", kind: "api_key", credentialName: "ACME_API_KEY" });
    api.registerTool({
      name: "acme.echo",
      description: "Echo a JSON object.",
      execute(args, ctx) {
        return { toolCallId: ctx.toolCallId, name: "acme.echo", value: args };
      },
    });
    api.registerContextProvider({
      name: "acme.project",
      resolve: () => [{ title: "Project", content: "Use Acme conventions." }],
    });
    api.registerSkill({
      name: "acme.brief",
      instructions: "Answer in one short paragraph.",
      toolNames: ["acme.echo"],
    });
    api.registerPromptBuilder({ name: "acme.prompt", build: async (request) => request.messages });
    api.registerCompactionStrategy({ name: "acme.compact", compact: async () => ({ summary: "summary" }) });
    api.registerRetryPolicy({ name: "acme.retry", decide: () => ({ retry: false }) });
    api.registerCommand({ name: "acme.status", execute: () => ({ ok: true }) });
    api.use("provider_request", (request) => request);
  },
};

const registries = createContributionRegistries({ duplicate: "error" });
const kernel = createExtensionKernel({ registries, errorPolicy: "throw" });
await kernel.load([extension]);

// Host activation: select contributions explicitly.
const tool = kernel.registries.tools.resolve("acme.echo");
const skill = kernel.registries.skills.resolve("acme.brief");
const provider = createMockProvider([providerDone()]);

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  tools: createToolRegistry([tool]),
  skills: createSkillRegistry([skill]),
  context: kernel.registries.contextProviders.list(),
  promptBuilder: kernel.registries.promptBuilders.resolve("acme.prompt"),
  middleware: kernel.middleware,
});

await agent.createSession().run("Use the Acme extension.", { activeSkills: ["acme.brief"] });
```

## Extension and configuration notes

- Export a stable named `Extension` value. Avoid side effects at module top level; keep registration inside `setup(api)`.
- Prefix contribution names (`acme.echo`, `acme.brief`) to avoid collisions. Hosts loading third-party packages should use `duplicate: "error"`.
- A data-only `prism` manifest can describe contributions/resources before the host imports executable package code. Manifest parsing never executes modules.
- `registerTool()` contributes a definition only. It does not grant permission, add allow-list entries, or execute the tool.
- `registerSkill()` contributes instructions only. Referenced `toolNames` are checked against host-active tools when the skill is activated.
- `registerAuthMethod()` and `registerCredentialResolver()` must not contain resolved credential values. Use descriptors/resolvers; the host resolves secrets at the provider/request edge.
- Middleware from `api.use()` runs only when the host passes `kernel.middleware` into runtime configuration.
- Provider packages, provider request policies, system prompt contributions, instruction injectors, builders, strategies, commands, store factories, resource loaders, settings providers, and credential resolvers are all inert until host code selects or invokes them.

## Security and performance notes

- Prism does not sandbox extension code. Hosts should load only trusted packages or run untrusted packages in their own sandbox/process before calling Prism APIs.
- Prism does not auto-discover extensions. Filesystem discovery is a separate opt-in scanner that reads `SKILL.md`/`manifest.json` text and still does not activate contributions.
- Use host trust and permission policies to deny extension setup (`extension:<name>:setup`), resource loads, and tool execution before side effects.
- Pass known secret values to `createExtensionKernel({ secrets })` so setup/listener errors are redacted. Redaction is exact known-secret replacement, not general secret detection.
- Never put API keys, OAuth tokens, provider clients, credential resolver outputs, headers, or raw secrets in manifests, registry metadata, extension events, prompts, sessions, ledgers, or idempotency keys.
- Extension loading performs only the code in `setup(api)` and registry/middleware/event operations. Prism adds no background workers, watchers, network calls, provider calls, filesystem scans, or tool execution.
- Keep `setup(api)` bounded and deterministic. Long-running initialization, remote auth flows, migrations, and approval UI belong in the host app.

## Related APIs

- [Extension kernel and event bus](extensions.md): low-level `ExtensionAPI`, registries, events, middleware, and error policy.
- [Contribution registries](contribution-registries.md): inert registry bundle populated by extensions.
- [Configuration and manifests](configuration-and-manifests.md): data-only package manifests and contribution declarations.
- [Contribution discovery (workspace)](contribution-discovery.md): opt-in filesystem scanner; no import or activation.
- [Provider packages](provider-packages.md): package-level provider/model/auth/request-policy contributions.
- [Tools](tools.md): host-owned active tool registry, filtering, dispatch, and permission checks.
- [Context and skills](context-and-skills.md): host selection and `toolNames` fail-closed skill activation.
- [Input and prompt assembly](input-and-prompt-assembly.md): selecting contributed builders/context/providers.
- [Instruction injection](instruction-injection.md): inert injectors that grant no capabilities.
- [Settings/auth/trust](settings-auth-trust-security.md): trust, permission, credentials, no sandbox, and redaction boundaries.
- [Extension conformance](extension-conformance.md): test extension setup, inertness, and error redaction/rethrow behavior.
