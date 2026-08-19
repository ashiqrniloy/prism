# Impeccable behavior integration

## What it does

`@arnilo/prism-impeccable` is an optional package that wires a host-supplied
[Impeccable](https://github.com/pbakaus/impeccable) `SKILL.md` into Prism skill
and command registries.

It registers one skill (`impeccable`) and one command (`impeccable`) that
dispatches `{ skill: "impeccable", dispatch: "load_skill" }`. Import and
`setup` without a readable `SKILL.md` fail closed with a bounded redacted
error and register zero contributions.

Prism does not vendor skill bodies, run the detector CLI, spawn a browser,
install hooks, or write `PRODUCT.md` / `DESIGN.md`.

## When to use it

Use it when a host has a compiled Impeccable checkout (or a linked skills dir)
and wants the design skill in a Prism extension kernel via progressive
`load_skill`.

Skip it when you only need the detector CLI (`npx impeccable`) or live browser
iteration — those stay host-owned.

## Inputs / request

`createImpeccableExtension(options)`:

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `upstreamPath` | `string` | yes | Path to a tree with `skills/impeccable/SKILL.md` or `SKILL.md` at the path (e.g. `dist/universal/impeccable`). |

No optional peer. npm `impeccable` is the detector CLI, not a skill tree.

## Outputs / response / events

| Export | Purpose |
| --- | --- |
| `createImpeccableExtension(options)` | Inert `Extension` until `kernel.load([...])`. |
| `impeccable` skill | Parsed upstream `SKILL.md` (`name: impeccable`). |
| `impeccable` command | Dispatch `{ skill: "impeccable", dispatch: "load_skill" }`. |

No instruction injector. No session persistence. No 23 Prism-native craft/polish commands.

## Request/response example

```json
{ "command": "impeccable", "args": {}, "sessionId": "s1" }
```

```json
{ "skill": "impeccable", "dispatch": "load_skill" }
```

## Implementation example

```ts
import { createImpeccableExtension } from "@arnilo/prism-impeccable";
import {
  createExtensionKernel,
  createLoadSkillTool,
  createLoadedSkillSet,
  createSkillRegistry,
} from "@arnilo/prism";

const kernel = createExtensionKernel({ errorPolicy: "throw" });
await kernel.load([
  createImpeccableExtension({
    upstreamPath: "/path/to/impeccable/dist/universal/impeccable",
  }),
]);

const registry = createSkillRegistry(kernel.registries.skills.list());
const loaded = createLoadedSkillSet();
const loadSkill = createLoadSkillTool({ registry, loaded });
await kernel.registries.commands.get("impeccable")!.execute({}, { sessionId: "s1" });
```

Keep `skillsDisclosure: "progressive"` so the full `SKILL.md` stays catalog-only until `load_skill`.

## Extension and configuration notes

- `sideEffects: false`. Import registers nothing.
- `kernel.load` resolves `SKILL.md` first; failure throws before any `register*`.
- Point `upstreamPath` at a compiled skill dir or a parent that contains `skills/impeccable/SKILL.md`.
- Do not invent per-command Prism wrappers for upstream `craft` / `polish` / `live`.
- Not in `@arnilo/prism-all` / `prism-code` / `prism-sdk`.

## Security and performance notes

- Upstream `SKILL.md` is untrusted host content; reads capped at `MAX_SKILL_FILE_BYTES` (256 KiB).
- Path escape rejected. Errors redact home and absolute paths.
- No `npx`, hook install, env scan, or network on import/setup.
- Setup is one bounded file read.

## Related APIs

- [Caveman behavior integration](caveman.md)
- [Ponytail behavior integration](ponytail.md)
- [Extension kernel and event bus](extensions.md)
- [Context and skills](context-and-skills.md)
