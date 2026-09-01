# Caveman behavior integration

## What it does

`@arnilo/prism-coding-tools/caveman` is an optional package that wires [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) into Prism contribution contracts.

It registers upstream skills and commands, injects active level prompt slices via `InstructionInjector`, and persists level as session custom `caveman-level` entries. Import and extension `setup` without a resolvable upstream path fail closed with a bounded redacted error and register zero contributions.

Upstream prompt fragments, skill bodies, and rules load from the host-supplied upstream checkout — Prism does not reimplement or vendor Caveman content.

## When to use it

Use it when a host wants terse token-efficient communication modes (`lite`, `full`, `ultra`, wenyan variants, `micro`) with upstream Caveman skills (`caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-help`, `cavecrew`) in a Prism extension kernel.

Skip it when you do not have a local Caveman checkout (Caveman is not published on npm) or when you only need progressive skill catalog without mode injection.

Pair with Phase 3 progressive disclosure: register `createLoadSkillTool` and keep `skillsDisclosure: "progressive"` so full `SKILL.md` bodies stay catalog-only; mode slices come from the `caveman-mode` injector, not eager skill bodies.

## Inputs / request

`createCavemanExtension(options)`:

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `upstreamPath` | `string` | yes | Absolute path to a Caveman checkout containing `skills/`. |
| `defaultLevel` | `CavemanLevel` | no | Initial level when no session entry exists (default upstream: `full`). |
| `showStatus` | `boolean` | no | Emit `caveman:status` extension events on level changes. |
| `appendEntry` | `(entry, opts?) => Promise<void>` | yes | Host session append (OM `attach` pattern). |
| `getEntries` | `() => readonly SessionEntry[] \| Promise<...>` | yes | Current branch entries for level restore. |
| `configPath` | `string` | no | Bounded local config file for `defaultLevel` / `showStatus`. |

`CavemanLevel`: `off` \| `lite` \| `full` \| `ultra` \| `wenyan-lite` \| `wenyan` \| `wenyan-ultra` \| `micro`.

Session custom entry shape:

```json
{ "kind": "custom", "data": { "type": "caveman-level", "level": "full" } }
```

Required skills (fail closed if missing): `caveman`, `caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-help`, `cavecrew`. Extra `skills/*/SKILL.md` (v2.1 extras like `caveman-explore`) register as optional skills and `load_skill` commands. Dirs without `SKILL.md` (`*.mjs`, `registry.json`, `generated/`) are skipped.

Registered commands: `caveman` (level), `caveman-init`, plus one `load_skill` dispatch per registered skill except `caveman`.

## Outputs / response / events

| Export | Purpose |
| --- | --- |
| `createCavemanExtension(options)` | Returns an inert `Extension` until `kernel.load([...])`. |
| `caveman-mode` injector | `InstructionInjector` — upstream filtered `skills/caveman/SKILL.md` slice when level ≠ `off`. |
| `caveman` command | Set level (`/caveman lite\|full\|ultra\|wenyan\|micro\|off`) or toggle `off`↔`full`. |
| Alias commands | Dispatch `{ skill, dispatch: "load_skill" }` metadata for companion skills. |
| `caveman:status` event | Optional metadata when `showStatus: true`. |

Deactivation phrases `stop caveman` and `normal mode` clear active injection without erasing session history.

## Request/response example

```json
{ "command": "caveman", "args": { "level": "ultra" }, "sessionId": "s1" }
```

```json
{ "kind": "custom", "data": { "type": "caveman-level", "level": "ultra" } }
```

## Implementation example

```ts
import { createCavemanExtension } from "@arnilo/prism-coding-tools/caveman";
import {
  createExtensionKernel,
  createLoadSkillTool,
  createLoadedSkillSet,
  createMemorySessionStore,
  createSkillRegistry,
  createSessionEntry,
} from "@arnilo/prism";

const store = createMemorySessionStore();
const callbacks = {
  appendEntry: async (entry, options) => store.append(entry, options),
  getEntries: async () => store.list("s1"),
};

const kernel = createExtensionKernel({ errorPolicy: "throw" });
await kernel.load([
  createCavemanExtension({
    upstreamPath: "/path/to/juliusbrussee-caveman",
    defaultLevel: "full",
    ...callbacks,
  }),
]);

const registry = createSkillRegistry(kernel.registries.skills.list());
const loaded = createLoadedSkillSet();
const loadSkill = createLoadSkillTool({ registry, loaded });

await kernel.registries.commands.get("caveman")!.execute({ level: "lite" }, { sessionId: "s1" });
// Select instructionInjectors: ["caveman-mode"] on runs that should receive level slices.
```

See `examples/caveman-ponytail.ts` for progressive catalog + `load_skill` wiring with fixture upstream trees (network-free).

## Extension and configuration notes

- Import alone registers nothing and starts no timers, watchers, or network I/O (`sideEffects: false`).
- `kernel.load` calls `setup`, which resolves upstream first; failure throws before any `register*`.
- Level restore scans `getEntries()` for the latest `data.type === "caveman-level"` — same OM attach pattern; core does not auto-emit `session_start`.
- Host must register `createLoadSkillTool` and pass `skillsDisclosure: "progressive"` for catalog-only skill bodies.
- `caveman-stats` dispatches skill metadata only; full stats need host session-log integration.
- `caveman-init` returns upstream guidance text; it does not write files in the host repo.
- No TUI status bar; optional `caveman:status` events for host UI.
- Caveman 2 compression proxy/engine is **not** a Prism runtime. Only `SKILL.md` files under `skills/` load.

## Security and performance notes

- Upstream `SKILL.md` and injected text are untrusted host-supplied content; reads are size-bounded (`MAX_SKILL_FILE_BYTES` 256 KiB, `MAX_INJECTED_INSTRUCTION_BYTES` 32 KiB).
- Config read/write is bounded (`MAX_CONFIG_FILE_BYTES` 16 KiB) at host-owned `configPath` only.
- Errors redact home directories and absolute paths.
- Setup is O(skills) directory scan; mode read/write is O(1) per change; injection is O(1) upstream lookup per turn.
- Session custom entries respect host session ownership and redaction policies.

## Related APIs

- [Ponytail behavior integration](ponytail.md): complementary lazy-minimalism mode package.
- [Extension kernel and event bus](extensions.md): `kernel.load` and contribution registration.
- [Context and skills](context-and-skills.md): progressive disclosure + `createLoadSkillTool`.
- [Instruction injection](instruction-injection.md): `caveman-mode` injector selection.
- [Observational memory compaction package](compaction-observational-memory.md): `appendEntry` / `getEntries` attach precedent.
- [Migration guide](migration.md): `0.0.21 → 0.0.22` install and opt-in notes.
