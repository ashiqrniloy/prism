# Impeccable behavior integration

## What it does

`@arnilo/prism-coding-tools/impeccable` is an optional package that wires a host-supplied
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
| `expectedSnapshotDigest` | `string` | no | sha256 hex of the resolved `SKILL.md` bytes. When set, `kernel.load` fails closed on drift before any registration — the vendored-snapshot pin. Record it when you vendor an upstream checkout; bump it when you deliberately pull upstream fixes. |

No optional peer. npm `impeccable` is the detector CLI, not a skill tree. Ownership model: **host-owned vendored snapshot, pinned** (decision + evidence: `docs/_evidence/impeccable-ownership-2026-09-04.md`; upstream commit at decision time `695df68a…`).

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
import { createImpeccableExtension } from "@arnilo/prism-coding-tools/impeccable";
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
- Not installed by any family profile (the 0.3-era profiles were removed in 0.4).

## Security and performance notes

- Upstream `SKILL.md` is untrusted host content; reads capped at `MAX_SKILL_FILE_BYTES` (256 KiB).
- Path escape rejected. Errors redact home and absolute paths.
- `expectedSnapshotDigest` is a content pin (sha256 of the parsed artifact): a vendored snapshot cannot be swapped silently — drift fails `kernel.load` with a redacted, bounded error naming the refresh step.
- No `npx`, hook install, env scan, or network on import/setup.
- Setup is one bounded file read (+ one hash when pinned).

## Related APIs

- [Caveman behavior integration](caveman.md)
- [Ponytail behavior integration](ponytail.md)
- [Extension kernel and event bus](extensions.md)
- [Context and skills](context-and-skills.md)
