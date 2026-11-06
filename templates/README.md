# Prism Template Gallery

Scaffold inputs shipped with the kernel.

## Available Templates

| Template | Description | Included Packages |
| --- | --- | --- |
| `package` | Package scaffold used by `prism new package` | `@arnilo/prism` |
| `provider` | Provider-package scaffold: package manifest, provider, models, cache, conformance test, and docs stub | `@arnilo/prism` |
| `init` | Minimal starter Prism agent with one selected provider and an offline mock test | `@arnilo/prism` |
| `deep-research` | Deep research agent: plan -> search -> extract -> refine loop -> citations -> HITL clarify | `@arnilo/prism`, `@arnilo/prism-tools-web`, `@arnilo/prism-memory-rag` (experimental: `bun add @arnilo/prism-memory-rag@experimental`), `@arnilo/prism-workflows` |
| `personal-assistant` | Personal workstation assistant: single-user ownership, local tools, credential references, and dev inspection | `@arnilo/prism` |
| `business-worker` | Multi-tenant business worker: durable storage, tenant isolation, verified identity, and governed boundaries | `@arnilo/prism`, `@arnilo/prism-tools-work` |

## Host skills

A host writes its own product rules as `skills.dirs` entries (`SKILL.md` directories it owns, for example `createAgent({ skills: { dirs: ["./skills"] } })`). A package's skills cover only how to use that module: they ship in the package, list only while the tools they need reach the model (`requiresTools`), and are never where a host's own policy lives. See `examples/skills.ts` for host skills and `examples/package-skills.ts` for package skills.

## Usage

```bash
# Scaffold a package (uses templates/package)
prism new package my-package --dir packages/my-package
```

The `init`, `deep-research`, `personal-assistant`, `business-worker`, and `provider` trees are checked-in scaffolds. The 0.13 kernel CLI scaffolds only `templates/package` (`prism new package`); the agent templates are kept for a future `prism init` and are not installed by any command.
