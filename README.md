# prism

Agent harness for AI providers, agents, sessions, and tools. A TypeScript/Node.js
package that host apps use to build AI-powered features — not an app itself.

## Current scope

- ESM TypeScript package with strict mode.
- CLI entry point (`prism` bin, placeholder).
- Public barrel (`prism` package import).
- `node:test`-based test (no test framework dependency).
- TypeScript build-only toolchain (no bundler).

**prism defines contracts, not apps.** No built-in tools, no provider SDKs,
no default credentials, no app-specific integrations. Host apps own their
tools, providers, and UI layer.

## Scripts

| command | action |
|---------|--------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Build + run tests |
| `prism --help` | CLI placeholder |

## Non-goals (v1)

- Built-in shell/filesystem/browser tools
- MCP bridge
- TUI or interactive terminal
- Workflow/graph orchestration
- First-party provider adapters beyond OpenAI-compatible
