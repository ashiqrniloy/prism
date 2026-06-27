# Contribution discovery (workspace & global)

## What it does

Discovery scans the filesystem for workspace and global contribution directories and turns their on-disk files into inert `DiscoveredContribution` envelopes the host then registers. It reads text only — it never `import()`s, `require()`s, or otherwise executes contribution code, and it never grants tools, permissions, credentials, or provider slots.

APIs (Node subpath `@arnilo/prism/node/contribution-discovery`, parsers and registrar on the main barrel):

- `discoverContributions(options)` / `DiscoveryOptions`: directory-walking scanner. One `readdir` per kind-root per origin; merge order global → workspace (workspace wins on same `(kind, name)`).
- `parseSkillFile(text, path)` / `parseAgentFile(text, path)`: stdlib-only frontmatter parsers for `SKILL.md` / `AGENT.md` (no YAML dependency, no `node:*` import). Re-exported from `@arnilo/prism`.
- `registerDiscoveredContributions(registries, contributions)`: registers realized `Skill` objects for the `skill` kind and descriptor-only stubs for other kinds. Re-exported from `@arnilo/prism`.
- `ContributionFileKind`, `DiscoveredContribution`: contract types re-exported from `@arnilo/prism`.
- `createPathTrustPolicy` / `isPathInsideReal` (from `@arnilo/prism/node/trust`): realpath-resolved, fail-closed containment used to gate workspace roots.

## When to use it

Use discovery when a host or the `prism` CLI wants to honor a project-local or user-global contribution layout without wiring every contribution by hand. Typical hosts pass `--discover` on the CLI or call `discoverContributions()` on startup, then feed the result through `registerDiscoveredContributions()` into their existing `ContributionRegistries`.

Do not use it to discover providers — provider/model packages stay config/package-driven (Phase 24; see [Provider packages](provider-packages.md)). Do not use it to auto-activate anything: discovery registers, never activates. Skills become selectable only when a run passes `RunOptions.activeSkills`, and `toolNames` is still enforced against the resolved tool set at activation time.

## Inputs / request

### Directory layout

| Origin | Path | Scanned by |
| --- | --- | --- |
| Workspace | `<workspace>/.agent/{skills,tools,context,instructions,agents}/<name>/` | `workspaceRoot`, gated by `trust` |
| Global | `~/.prism/agent/{skills,tools,context,instructions,agents}/<name>/` | `globalRoot` (opt-in only) |

### Per-kind entry file

| Kind | Entry file | Parsed into |
| --- | --- | --- |
| `skill` | `<dir>/SKILL.md` | A realized `Skill` (placed in `DiscoveredContribution.skill`) |
| `agent` | `<dir>/AGENT.md` | A `ManifestContributionDeclaration` (`kind: "agent"`, `resource` = file path) |
| `tool` / `context` / `instructions` | `<dir>/manifest.json` | A `ManifestContributionDeclaration` |

### Frontmatter keys

`SKILL.md` frontmatter (YAML-like, parsed by a stdlib-only parser — no YAML dependency):

| Key | Meaning |
| --- | --- |
| `name` | Required if you want an explicit name; otherwise the parent directory name is used. |
| `description` | Optional skill description. |
| `toolNames` | Optional comma list (`[a, b]`) or YAML block list (`- a`). Enforced at activation, not at discovery. |

The markdown body below the front fence becomes `Skill.instructions`. Unknown frontmatter keys are tolerated and collected into `Skill.metadata` (never fatal).

`AGENT.md` frontmatter accepts `name` plus arbitrary `metadata`; full agent resolution is deferred to Phase 33's `resolveAgentDefinition`. `manifest.json` entries follow the [`ManifestContributionDeclaration`](configuration-and-manifests.md) shape: `kind`, `name`, and optional `module`/`exportName`/`resource`/`metadata`.

### `DiscoveryOptions`

| Field | Meaning |
| --- | --- |
| `kinds` | Which `ContributionFileKind` values to scan (`skill`, `tool`, `context`, `instructions`, `agent`). |
| `workspaceRoot` | Workspace root. Gated by `trust`; untrusted roots are skipped silently. |
| `globalRoot` | Global root. **Opt-in only** — scanned only when explicitly passed. Core never auto-touches `~/.prism`. |
| `permission?` | `PermissionPolicy` asserting each directory read (`assertPermission`). |
| `trust?` | `TrustPolicy` (e.g. `createPathTrustPolicy`) fail-closed against the workspace root. |

### CLI flags

| Flag | Meaning |
| --- | --- |
| `--discover` | Enable workspace contribution discovery. Opt-in; default runs never touch the filesystem. |
| `--discover-kinds <csv>` | Kinds to scan. Defaults to `skill`. Accepts `skill,tool,context,instructions,agent`. |
| `--discover-global` | Also scan `~/.prism/agent/` (global root). Defaults to the home directory. |
| `--no-discovery` | Hard-disable discovery even if `--discover` is set. |

## Outputs / response / events

`discoverContributions()` returns `readonly DiscoveredContribution[]`. Each envelope has `kind`, `name`, `origin` (`"global"` | `"workspace"`), `path`, and either `skill` (for the `skill` kind) or `declaration` (a `ManifestContributionDeclaration` for other kinds), plus optional `metadata`. The envelope is inert: it contains no executable code, no credential, and no resolved provider/model/tool reference.

`registerDiscoveredContributions(registries, contributions)` writes into the existing `ContributionRegistries`: `skills` get full `Skill` objects; `tool`/`context`/`agent` get descriptor-only stubs whose `execute`/`resolve`/`create` throw (executable behavior is host-owned); `instructions` get descriptors with empty `text` (Phase 30 lifts `declaration.resource` into actual text). The host retains the original `DiscoveredContribution[]` for provenance — tool and context descriptors carry no `metadata.discovered` slot because `ToolDefinition` and `ContextProvider` have no metadata field. Phase 30 adds a host-owned `loadInstructionInjector` adapter (see [Instruction injection](instruction-injection.md)) that turns a discovered `kind: "instructions"` contribution into a live `InstructionInjector` — markdown-only → static `every_turn` injector; module-referenced → resolved through a host-supplied `moduleLoader` (core never auto-`import()`s).

## Request/response example

Discovering a workspace skill plus a global skill (workspace overrides same name):

```json
[
  { "kind": "skill", "name": "greeter", "origin": "global", "path": "/home/u/.prism/agent/skills/greeter/SKILL.md", "skill": { "name": "greeter", "description": "g", "instructions": "..." } },
  { "kind": "skill", "name": "greeter", "origin": "workspace", "path": "/proj/.agent/skills/greeter/SKILL.md", "skill": { "name": "greeter", "description": "g", "instructions": "..." } }
]
```

Only the workspace entry survives in the skills registry (last-write-wins by `(kind, name)`).

## Implementation example

```ts
import {
  createContributionRegistries,
  registerDiscoveredContributions,
  createSkillRegistry,
  createAgent,
  createMockProvider,
  providerDone,
} from "@arnilo/prism";
import { discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

// 1. Discover — workspace gated by trust; global is opt-in (pass globalRoot to scan ~/.prism).
const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });
const discovered = await discoverContributions({
  kinds: ["skill"],
  workspaceRoot,
  trust,
});

// 2. Register — skills become full Skill objects; other kinds register as stubs.
//    Discovery never imports or executes contribution code.
const registries = createContributionRegistries();
registerDiscoveredContributions(registries, discovered);

// 3. Run — discovery did NOT activate anything. The run explicitly selects skills.
const session = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerDone()]),
  skills: createSkillRegistry(registries.skills.list()),
}).createSession();

await session.run("Hi", { activeSkills: ["greeter"] });
```

A complete runnable example lives at `examples/discover-skills.ts`.

## Extension and configuration notes

- Discovery is loader-driven, not module-driven. The on-disk contribution is a data file (`SKILL.md`/`AGENT.md`/`manifest.json`); the host decides whether, when, and how to register and activate it. There is no `import()` of untrusted modules.
- Merge order is global first, then workspace overrides the same `(kind, name)` deterministically. Explicit `AgentConfig`/`RunOptions` selections (e.g. `RunOptions.activeSkills`) override discovered entries at run time.
- `ContributionFileKind` is the discovery-side kind name (`skill`/`tool`/`context`/`instructions`/`agent`). The manifest-side kind is `ManifestContributionKind` ([Configuration and manifests](configuration-and-manifests.md)); the node scanner maps between them.
- The `--discover-kinds` CSV lets a host scan a subset. The CLI default is `skill`; other kinds register descriptor stubs only (host-owned execution).
- First-party skills are expected to ship as installable packages (separate request); Phase 29 ships discovery infrastructure only and adds no first-party skill package.

## Security and performance notes

- **Workspace gating**: workspace roots are checked through `createPathTrustPolicy` + `isPathInsideReal`, which resolve symlinks and fail closed (return false) if either root or target cannot be resolved. Untrusted workspace roots are skipped silently, never thrown over. Permission is asserted per directory read via `assertPermission`.
- **Symlink handling**: symlinked entries that escape the kind root after realpath resolution are excluded.
- **Global is opt-in**: core never auto-touches `~/.prism`. The global root is scanned only when the host/CLI explicitly passes `globalRoot` (the CLI does so only when `--discover-global` is set).
- **No auto-execute**: discovery reads text. It does not `import()`, `require()`, or run contribution code. `registerDiscoveredContributions` registers descriptor stubs whose execution methods throw — the host lifts them into live tools/providers/agents itself.
- **No auto-activate**: discovery registers skills; it does not select them. Activation requires explicit `RunOptions.activeSkills`, and `toolNames` is still validated against the resolved tool set. Discovery grants no tools, permissions, or provider slots.
- **No provider scanning**: provider/model discovery stays config/package-driven (Phase 24). See [Provider packages](provider-packages.md).
- **Secrets**: the secrets-redaction path is unaffected — discovery reads contribution files, not provider request content. Skill `instructions` flow through normal input assembly and the same redaction pipeline as any system message.
- **Performance**: one `readdir` per kind-root per origin; missing kind directories are normal (ENOENT-tolerant). Default runs perform no discovery I/O at all. The merged output is inert.

## Related APIs

- [Contribution registries](contribution-registries.md): where discovered envelopes are registered.
- [Context and skills](context-and-skills.md): `createSkillRegistry` / `resolveActiveSkills` and the `RunOptions.activeSkills` activation that consumes discovered skills.
- [Extensions](extensions.md): host-provided extensions still register contributions programmatically; discovery is the filesystem-driven complement.
- [Configuration and manifests](configuration-and-manifests.md): `ManifestContributionDeclaration` / `ManifestContributionKind` shapes used by non-skill entries.
- [CLI/RPC](cli-rpc.md): the `--discover`, `--discover-kinds`, `--discover-global`, and `--no-discovery` flags.
- [Security/auth/trust](settings-auth-trust-security.md): `createPathTrustPolicy`, `assertPermission`, and the trust model.
