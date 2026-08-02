# Ponytail behavior integration

## What it does

`@arnilo/prism-ponytail` is an optional package that wires [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) into Prism contribution contracts.

It registers upstream skills and commands, injects active mode instructions via upstream `getPonytailInstructions` / `filterSkillBodyForMode`, and persists mode as session custom `ponytail-mode` entries. Import is inert; missing upstream fails closed at `setup` with a bounded redacted error.

## When to use it

Use it when a host wants lazy-minimalism coding behavior (`lite`, `full`, `ultra`) with upstream Ponytail skills (`ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`) in a Prism extension kernel.

Install optional peer `@dietrichgebert/ponytail@^4.8.4` **or** pass `upstreamPath` to a checkout with `skills/` and `hooks/`.

Pair with progressive disclosure: mode slices on the `ponytail-mode` injector; full skill bodies via `load_skill` only.

## Inputs / request

`createPonytailExtension(options)`:

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `upstreamPath` | `string` | no | Override path to Ponytail root; default resolves optional peer package. |
| `defaultMode` | `PonytailMode` | no | Initial mode when no session entry exists (default `full`). |
| `quietStartup` | `boolean` | no | Suppress startup status events. |
| `appendEntry` | `(entry, opts?) => Promise<void>` | yes | Host session append (OM `attach` pattern). |
| `getEntries` | `() => readonly SessionEntry[] \| Promise<...>` | yes | Current branch entries for mode restore. |
| `configPath` | `string` | no | Bounded local config for `defaultMode` / `quietStartup` / `hideStatus`. |

`PonytailMode`: `off` \| `lite` \| `full` \| `ultra`.

Session custom entry shape:

```json
{ "kind": "custom", "data": { "type": "ponytail-mode", "mode": "full" } }
```

Registered skills: `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`.

Registered commands: `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-gain`, `ponytail-debt`, `ponytail-help`.

`ponytail` command actions: `lite|full|ultra|off`, `status`, `default <mode>`.

## Outputs / response / events

| Export | Purpose |
| --- | --- |
| `createPonytailExtension(options)` | Returns an inert `Extension` until `kernel.load([...])`. |
| `ponytail-mode` injector | `InstructionInjector` calling upstream `getPonytailInstructions(mode)`. |
| `ponytail` command | Set mode, report status, or persist default mode to config file. |
| Alias commands | Dispatch `{ skill, dispatch: "load_skill" }` for companion skills. |
| `ponytail:status` / `ponytail:loaded` events | Optional host metadata (no statusline shell scripts). |

Deactivation: exact phrases `stop ponytail` and `normal mode`.

## Request/response example

```json
{ "command": "ponytail", "args": { "mode": "lite" }, "sessionId": "s1" }
```

```json
{ "kind": "custom", "data": { "type": "ponytail-mode", "mode": "lite" } }
```

## Implementation example

```ts
import { createPonytailExtension } from "@arnilo/prism-ponytail";
import {
  createExtensionKernel,
  createLoadSkillTool,
  createLoadedSkillSet,
  createMemorySessionStore,
  createSkillRegistry,
} from "@arnilo/prism";

const store = createMemorySessionStore();
const callbacks = {
  appendEntry: async (entry, options) => store.append(entry, options),
  getEntries: async () => store.list("s1"),
};

const kernel = createExtensionKernel({ errorPolicy: "throw" });
await kernel.load([
  createPonytailExtension({
    upstreamPath: undefined, // optional peer @dietrichgebert/ponytail
    defaultMode: "full",
    quietStartup: true,
    ...callbacks,
  }),
]);

const registry = createSkillRegistry(kernel.registries.skills.list());
const loaded = createLoadedSkillSet();
const loadSkill = createLoadSkillTool({ registry, loaded });

await kernel.registries.commands.get("ponytail")!.execute({ mode: "lite" }, { sessionId: "s1" });
// Select instructionInjectors: ["ponytail-mode"] on runs that should receive mode slices.
```

See `examples/caveman-ponytail.ts` for combined Caveman + Ponytail progressive disclosure demo (network-free fixtures).

## Extension and configuration notes

- Import alone registers nothing (`sideEffects: false`); no timers, watchers, network, or shell scripts.
- Upstream hook modules load via `createRequire` from resolved root — instruction strings are not forked in Prism.
- Mode restore scans `getEntries()` for latest `data.type === "ponytail-mode"` (OM attach pattern).
- `ponytail-subagent` hook is not wired; nested-agent behavior is host responsibility.
- No TUI statusline scripts; use `ponytail status` command or extension events.
- Not included in `@arnilo/prism-code` or `@arnilo/prism-sdk` profiles — opt-in install only.

## Security and performance notes

- Upstream text is untrusted; reads bounded (`MAX_SKILL_FILE_BYTES` 256 KiB, `MAX_INJECTED_INSTRUCTION_BYTES` 32 KiB).
- Config writes only to host `configPath` with size cap (`MAX_CONFIG_FILE_BYTES` 16 KiB).
- Errors redact absolute paths and home directories.
- O(skills) setup scan; O(1) mode tracking per turn; no background workers.

## Related APIs

- [Caveman behavior integration](caveman.md): complementary terse-communication mode package.
- [Extension kernel and event bus](extensions.md): explicit `kernel.load`.
- [Context and skills](context-and-skills.md): progressive catalog + `load_skill`.
- [Instruction injection](instruction-injection.md): `ponytail-mode` injector.
- [Observational memory compaction package](compaction-observational-memory.md): session callback attach pattern.
- [Migration guide](migration.md): `0.0.21 → 0.0.22` notes.
