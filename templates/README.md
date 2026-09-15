# Prism Template Gallery

Ready-to-run project templates for `prism init --template <name>`.

## Available Templates

| Template | Description | Included Packages |
| --- | --- | --- |
| `init` | Minimal starter Prism agent with one selected provider and offline mock test | `@arnilo/prism` |
| `deep-research` | Flagship deep research agent: plan -> search -> extract -> refine loop -> citations -> HITL clarify | `@arnilo/prism`, `@arnilo/prism-web-tools`, `@arnilo/prism-memory`, `@arnilo/prism-workflows` |
| `personal-assistant` | Personal workstation assistant: single-user ownership, local tools, credential references, and dev inspection | `@arnilo/prism`, `@arnilo/prism-core`, `@arnilo/prism-providers` |
| `business-worker` | Multi-tenant business worker: durable storage, tenant isolation, verified identity, and governed boundaries | `@arnilo/prism`, `@arnilo/prism-core`, `@arnilo/prism-providers` |

## Usage

```bash
# Scaffold the flagship deep-research template
prism init my-research --template deep-research

# List all available templates
prism init --list-templates

# Scaffold the standard minimal agent
prism init my-agent
```
