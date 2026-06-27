# Instruction injection

## What it does

Instruction injectors let a package modify how context is formulated and inject its own instructions to modify agent behavior — on the first turn, every turn, or in response to user input — without forking the input/prompt pipeline and without hidden globals. Each injector contributes only `instructions` (text) and `contextBlocks`; it cannot register tools, skills, or permissions, and cannot bypass the validator or the permission gate.

Injectors are the package-side complement to the host-owned `systemInstructions` base path: the host sets base instructions, then selected package injectors layer additional instructions and context blocks per turn.

## When to use it

- A package wants to bias the model toward a response format (e.g. "answer in JSON") every turn.
- A package wants to inject project context (e.g. a repo summary) on the first turn only.
- A package wants to react to user input (via a `predicate`) without re-authoring the assembler.
- A package wants to ship a discoverable `.agent/instructions/<name>/` bundle that hosts opt into by name.

Injectors are **not** a way to grant tool access, change credentials, or mutate provider request options.

## Inputs / request

Injectors implement `InstructionInjector`:

```ts
type InstructionTiming = "first_turn" | "every_turn" | "on_input";

interface InstructionContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly turn: number;          // 1-based; undefined is treated as turn 1
  readonly input: readonly Message[];  // already redacted by the runtime
  readonly history: readonly Message[]; // redacted messages from prior turns
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

interface InstructionContribution {
  readonly instructions?: string;
  readonly contextBlocks?: readonly ContextBlock[];
  readonly when: InstructionTiming;
  readonly predicate?: (ctx: InstructionContext) => boolean;
}

interface InstructionInjector {
  readonly name: string;
  readonly description?: string;
  apply(ctx: InstructionContext): InstructionContribution;
}
```

`InstructionContext` fields are already redacted by the runtime before `apply` runs: input is run through the host redactor during assembly, and history holds previously-redacted messages.

### Lifecycle

| `when` | `predicate` | Applied when |
|---|---|---|
| `first_turn` | ignored | `ctx.turn === 1` |
| `every_turn` | ignored | every turn |
| `on_input` | absent | every turn (default) |
| `on_input` | present | turns where `predicate(ctx)` returns `true` |

Only `instructions` and `contextBlocks` are honored from a contribution; other fields grant nothing (see [Security and performance notes](#security-and-performance-notes)).

## Outputs / response / events

Injectors do not emit events. Their output is folded into the assembled `ProviderRequest`:

- **Instructions** layer via `composeSystemPrompt(injectorContributions, { base: systemInstructions })` as `source: "package"`, `mode: "append"`. Host base instructions come first, then injector package instructions appended. This keeps a single prompt-composition code path (no parallel prompt code in the assembler).
- **Context blocks** merge via `resolveContextProviders`, appended after host+skill provider blocks, before the context middleware hook runs. `ponytail:` the assembler threads `injectedBlocks` into `resolveContextProviders` so the existing context middleware flow is untouched and the diff stays minimal.

`runInstructionInjectors(injectors, ctx)` runs each selected injector against a turn-local `InstructionContext`, returning `{ instructions: SystemPromptContribution[]; contextBlocks: ContextBlock[] }`. It aborts on `ctx.signal`.

## Request/response example

```ts
const jsonInjector: InstructionInjector = {
  name: "json-always",
  apply: () => ({ instructions: "Always answer in JSON.", when: "every_turn" }),
};

const projectContext: InstructionInjector = {
  name: "project-context",
  apply: () => ({
    contextBlocks: [{ title: "Repo", content: "Prism monorepo — see docs/." }],
    when: "first_turn",
  }),
};

const onInputJson: InstructionInjector = {
  name: "json-on-json-input",
  apply: (ctx) => ({
    instructions: "Reply with JSON because the user asked for JSON.",
    when: "on_input",
    predicate: (c) => c.input.some((m) => /json/i.test(JSON.stringify(m.content))),
  }),
};
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, createSecretRedactor } from "@arnilo/prism";

const jsonInjector = { name: "json-always", apply: () => ({ instructions: "Answer in JSON.", when: "every_turn" as const }) };

const session = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerDone()]),
  instructions: "You are helpful.",
  instructionInjectors: [jsonInjector],
}).createSession();

await session.run("List primes under 10.");
```

### Selection and override semantics

`AgentConfig.instructionInjectors` configures a base injector list; `RunOptions.instructionInjectors` overrides it (last wins), mirroring `activeSkills`. `resolveInstructionInjectors` resolves names against a registry fail-closed:

```ts
import { resolveInstructionInjectors } from "@arnilo/prism";

const injectors = resolveInstructionInjectors({ registry, names: ["json-always", "project-context"] });
// Unknown name throws: Error: Unknown instruction injector: <name>
```

### Phase 29 discovery loading

A discovered `.agent/instructions/<name>/manifest.json` (see [Contribution discovery](contribution-discovery.md)) becomes a live injector via the host-owned Node adapter — core performs no `import()`:

```ts
import { registerDiscoveredInstructionInjectors } from "@arnilo/prism/node/instruction-injectors";

// markdown-only (no `module` field) → static every_turn injector reading resource text;
// module-referenced → host-supplied moduleLoader (skipped when absent).
await registerDiscoveredInstructionInjectors(registries, discovered, { moduleLoader });
```

The CLI wires this under `--discover` (see below). Hosts embedding the SDK keep the registry empty and supply injectors directly on `AgentConfig`/`RunOptions`.

### CLI and RPC

CLI:

```
# select a discovered injector by name (repeatable)
prism --discover --discover-kinds instructions --instruction json-always -p "Hi" --provider mock

# load a markdown file as a static every_turn injector (repeatable)
prism --injector-file ./rules/json.md -p "Hi" --provider mock

# disable all injectors for a run (including AgentConfig injectors)
prism --instruction false -p "Hi" --provider mock
```

`--instruction false` disables; `--instruction <name>` fails closed (exit 1) on an unknown name. Names resolve against discovered injectors only when `--discover` ran; without discovery, `--instruction` requires a name present in the session's `instructionInjectors` (host-supplied).

RPC: `prompt`/`followUp` params accept an optional `instructionInjectors: readonly string[]` field. Names resolve against the `instructionInjectors` registry passed to `runRpcServer({ instructionInjectors })`; an unknown name fails closed with a correlated error response and no provider call.

## Extension and configuration notes

- Register via `ExtensionAPI.registerInstructionInjector(injector)` (Phase 30). Each injector is stored by `injector.name` (last-write-wins).
- Select on `AgentConfig.instructionInjectors` or `RunOptions.instructionInjectors` (`RunOptions` wins). `RunOptions.instructionInjectors` is a list of `InstructionInjector` instances; hosts embed names by passing instances resolved through `resolveInstructionInjectors`.
- Manifest `kind: "instructionInjector"` (Phase 30) declares contributions data-only; discovery of `kind: "instructions"` is the filesystem vehicle (see [Configuration and manifests](configuration-and-manifests.md)).
- `turn` is plumbed through `LoopContext.assemble(nextInput, toolResults?, turn?)` (Phase 30) so injectors see the loop-local turn, not a stale value.

## Security and performance notes

- **No privilege grant:** `InstructionContribution` exposes only `instructions`/`contextBlocks`/`when`/`predicate`. There is no `tools`, `skills`, `permissions`, or `execute` field; a malformed contribution smuggling those fields contributes only `instructions`. Registering an injector adds entries only to `instructionInjectors`; `tools`/`skills`/`contextProviders`/`systemPromptContributions` stay empty.
- **Cannot bypass validator or permissions:** injectors are layered into prompt assembly; tool dispatch still re-checks the active registry (`unknown_tool`), filters, arguments, the permission assertion, and `validate` (Phase 4/25/26).
- **Secrets never enter history/events:** secrets in injector-produced `instructions`/`contextBlocks` are redacted in the outgoing `ProviderRequest` (via `redactProviderRequest`) and in emitted events (via `redactAgentEvent`). Do not put secrets in injector text at authoring time; the redactor is a backstop, not an invitation.
- No hidden globals: injectors are resolved explicitly per run; nothing is auto-activated or auto-imported by core.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): default prompt builder and `assembleProviderInput`, where injector instructions/blocks are merged.
- [System prompts](system-prompts.md): `composeSystemPrompt` and the `package`/`app`/`user`/`run` layering injectors layer into.
- [Context and skills](context-and-skills.md): `resolveContextProviders` merge order and skill `context`.
- [Contribution registries](contribution-registries.md): `instructionInjectors` registry.
- [Contribution discovery](contribution-discovery.md): `.agent/instructions/<name>/` discovery and the host-owned `loadInstructionInjector` adapter.
- [Extensions](extensions.md): `registerInstructionInjector` in the contribution-kinds list.
- [CLI and RPC](cli-rpc.md): `--instruction`/`--injector-file` flags and the RPC `instructionInjectors` field.
- [Credentials and redaction](credentials-and-redaction.md): `createSecretRedactor`, `redactProviderRequest`, `redactAgentEvent`.
