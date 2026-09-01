# @arnilo/prism-coding-tools

Unified coding agent tools, security sandboxing, document parsing, OpenAPI tools, Linux desktop integration, Dev inspector, and persona extensions for Prism.

## Subpaths

- `@arnilo/prism-coding-tools/agent`: Core coding tools (read, write, edit, search, bash, git, diagnostics, check, ast-grep, lsp).
- `@arnilo/prism-coding-tools/security`: Sandbox execution adapters (Docker/OCI, native disposable sandbox, approval policies, egress proxy).
- `@arnilo/prism-coding-tools/document-reader`: Bounded PDF/DOCX literal-text extraction adapter with optional peer fail-closed loading.
- `@arnilo/prism-coding-tools/openapi`: OpenAPI 3.x tool generator and executor with SSRF protection and parameter validation.
- `@arnilo/prism-coding-tools/computer-use-linux`: Linux desktop observation and targeting tool bridge.
- `@arnilo/prism-coding-tools/dev`: Loopback-only developer inspector, event timeline visualizer, and local replay server.
- `@arnilo/prism-coding-tools/caveman`: Caveman ultra-terse engineering persona extension.
- `@arnilo/prism-coding-tools/ponytail`: Ponytail multi-agent planning and delegation persona extension.
- `@arnilo/prism-coding-tools/impeccable`: Impeccable high-precision frontend engineering persona extension.

## CLI

- `prism-dev`: Launches the development inspector on loopback.

## Coding Tools

| Tool | Input | Result |
| --- | --- | --- |
| `shell` | `{ command, timeout? }` | Combined output + `metadata.exitCode`; 600-second default timeout and 64 MiB total-output cap. Non-zero exit is **not** an error. Prefer dedicated tools when they fit. |
| `read` | `{ path, offset?, limit? }` | Streamed bounded text page or bounded `[note, ImageContent]`. Continue with suggested offset when truncated. |
| `write` | `{ path, content, force? }` | Full overwrite; bounded UTF-8 input; optional read-before-write. |
| `edit` | `{ path, edits: [{oldText,newText}], force? }` | Exact-then-fuzzy replace; **fuzzy may succeed silently** — prefer exact `oldText`; duplicates fail closed. |
| `repo_list` | `{ path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Deterministic relative entries; paginates with `nextOffset`. Prefer `glob` for patterns. |
| `repo_search` | `{ query, path?, mode?, caseSensitive?, includeHidden?, context?, maxMatches?, outputMode? }` | Literal search; `outputMode`: `content` | `files_with_matches` | `count`. |
| `glob` | `{ pattern, path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Filename match (`*`/`?`/`**`; no braces). Files only. |
| `delete` | `{ path }` | High-risk: file or empty dir only; **no trash**. |
| `move` | `{ from, to, overwrite? }` | High-risk rename/move; `overwrite` default false; **no trash**. |
| `git_*` / `coding_check` | via `createGitTools(cwd, { commitIdentity, checks? })` | Opt-in structured Git + named checks. Not in `createCodingTools()`. |
| `ask_user_decision` | via `createAskUserDecisionTool({ ask })` | Opt-in user choice. Not in default aggregators. |

### Capabilities and Historical Lineage

No PDF reader, trash daemon, or PTY in 0.0.21. Optionals: `createLanguageIntelligence`, `createProcessSessions`, `createGitHubForge`.

- Terminal sessions support host-selected PTY execution.
- Fast indexed search and workspace lifecycle management.
- Process recovery and structured patch review capabilities across the 0.2.6 release baseline.

## Exports

Factories: `createShellTool`, `createReadTool`, `createWriteTool`, `createEditTool`, `createRepoListTool`, `createRepoSearchTool`, `createGlobTool`, `createDeleteTool`, `createMoveTool`, `createCodingTools`, `createReadOnlyTools`, `createAllTools`, `createGitTools`, `createCodingCheckTool`, `createAskUserDecisionTool`, `createLocalBashOperations`, `createLocalRepositoryOperations`, `createGitAwareRepositoryOperations`, `createLanguageIntelligence`, `createProcessSessions`, `createGitHubForge`, `createGitOperations`, `createReadPathSet`.

## License

MIT
