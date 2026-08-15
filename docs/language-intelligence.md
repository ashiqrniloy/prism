# Language intelligence

## What it does

`createLanguageIntelligence` is an optional host-activated contract in `@arnilo/prism-coding-agent` that talks to **host-selected** language servers over one bounded in-package JSON-RPC client (LSP 3.17 Content-Length framing). It exposes workspace symbols, definitions, references, diagnostics, hover, and rename/workspace edits. No `vscode-languageserver-protocol` dependency. Nothing spawns on import or construction — servers start lazily on first use and stop on `dispose()`.

| Export | Purpose |
| --- | --- |
| `createLanguageIntelligence(options)` | Build a `LanguageIntelligence` instance for one workspace root. |
| `LanguageIntelligence` | Contract: `workspaceSymbols`, `definitions`, `references`, `diagnostics`, `hover`, `rename`, `dispose`. |
| `LanguageServerSpec` | Host allow-listed `{ command, args?, languages, env? }`. Never model-supplied. |
| `LanguageLocation` / `LanguageSymbol` / `LanguageDiagnostic` / `LanguageWorkspaceEdit` | Normalized result shapes (paths workspace-relative; positions LSP 0-based). |
| `LanguageIntelligenceError` | Typed fail-closed errors (`ERR_PRISM_LSP_*`). |
| `resolveLanguageIntelligenceLimits` / `DEFAULT_MAX_LSP_*` / `HARD_MAX_LSP_*` | Finite caps for message bytes, diagnostics/file, pending requests, results/query, timeout, servers. |
| `encodeLspFrame` / `LspFrameReader` | Framing helpers (tests/hosts). |

## When to use it

Use when a host wants IDE-like language intelligence without embedding a parser framework or trusting model-chosen server commands. Wire host-pinned server binaries (for example `typescript-language-server --stdio`) and gate renames with the same `ExecutionPolicy` used for write/edit tools.

Do not use this as a sandbox, tool registry, or process session manager. Optional process-session registration of LSP children can use `createProcessSessions` ([Process sessions](process-sessions.md)).

```ts
import { createLanguageIntelligence } from "@arnilo/prism-coding-agent";

const lang = createLanguageIntelligence({
  workspaceRoot,
  servers: {
    typescript: {
      command: "/usr/bin/typescript-language-server",
      args: ["--stdio"],
      languages: ["typescript", "typescriptreact"],
    },
  },
  policy: hostExecutionPolicy, // rename gated like edit
});

const defs = await lang.definitions({ file: "src/a.ts", line: 10, character: 4 });
await lang.rename({ file: "src/a.ts", line: 10, character: 4, newName: "renamed" });
await lang.dispose();
```

## Document synchronization and diagnostics (0.2.6, plan 026)

LSP stays opt-in: `createLanguageIntelligence` is a standalone host-activated factory — nothing spawns on construction and no agent/tool assembly instantiates it.

- `syncDocument(file)` — re-syncs a file after an external edit via full-content `textDocument/didChange` (protocol-valid LSP 3.17; no diff engine). Versions are monotonic per document: didOpen stamps 1, each didChange increments.
- `diagnosticDelta({ files, previous })` — bounded diagnostic refresh for changed files only (never a whole-workspace pull). When the server advertises `diagnosticProvider`, the client uses pull diagnostics (`textDocument/diagnostic` with `previousResultId` reuse — `kind: full|unchanged`; the cached set is reused on `unchanged`); otherwise it reads the push cache (`textDocument/publishDiagnostics` always replaces the full set, `[]` clears). Results are normalized (`NormalizedDiagnostic`), generation-stamped with the document version, and diffed with `diagnosticDelta` into deterministic `added` / `removed` / `unchanged`. Stale views (a previous generation newer than the refresh) are dropped per file — a stale-version response never overwrites newer results. Refresh honors the standard LSP caps (message bytes, diagnostics/file, results/query, timeout, files per request).

```ts
await lang.syncDocument("src/app.ts");
const delta = await lang.diagnosticDelta({
  files: ["src/app.ts"],
  previous: { "src/app.ts": { generation: 3, diagnostics: priorDiags } },
});
```

## Inputs / request

`createLanguageIntelligence` options:

| Field | Type | Purpose |
| --- | --- | --- |
| `workspaceRoot` | `string` | Absolute or relative workspace root; all file URIs must stay inside. |
| `servers` | `Record<string, LanguageServerSpec>` | Host map keyed by server name; size capped (`maxServers`). |
| `limits?` | `LanguageIntelligenceLimits` | Optional overrides; invalid values fail instead of clamping. |
| `policy?` | `ExecutionPolicy` | Applied before rename writes (`kind: "edit"`, `operation: "rename"`). |

`LanguageServerSpec`:

| Field | Purpose |
| --- | --- |
| `command` | Host allow-listed executable path. |
| `args?` | Fixed argv (never from the model). |
| `languages` | Language ids this server handles (matched from file extension). |
| `env?` | Extra env merged onto `process.env` for the child. |

Operation inputs use workspace-relative `file` plus LSP **0-based** `line` / `character`. `rename` also requires `newName`.

## Outputs / response / events

| Method | Result |
| --- | --- |
| `workspaceSymbols(query)` | `LanguageSymbol[]` (capped). |
| `definitions` / `references` | `LanguageLocation[]` (capped). |
| `diagnostics(file?)` | Normalized `LanguageDiagnostic[]` (per-file and aggregate caps). |
| `hover` | `{ text }` or `undefined`. |
| `rename` | `LanguageWorkspaceEdit` after policy-checked atomic writes. |
| `dispose` | Stops all spawned servers (bounded). |

Errors are `LanguageIntelligenceError` with codes: `ERR_PRISM_LSP_FRAMING`, `ERR_PRISM_LSP_SERVER`, `ERR_PRISM_LSP_TIMEOUT`, `ERR_PRISM_LSP_LIMIT`, `ERR_PRISM_LSP_UNSUPPORTED`, `ERR_PRISM_LSP_WORKSPACE`.

No package-owned events; hosts observe via their own run/tool wiring.

## Request/response example

```json
// definitions request (host API, not JSON-RPC wire)
{ "file": "src/a.ts", "line": 10, "character": 4 }

// normalized definition
{ "file": "src/a.ts", "line": 2, "character": 0 }
```

```json
// rename workspace edit (after apply)
{
  "edits": [
    {
      "file": "src/a.ts",
      "newText": "renamed",
      "range": {
        "start": { "line": 10, "character": 4 },
        "end": { "line": 10, "character": 7 }
      }
    }
  ]
}
```

## Implementation example

```ts
import {
  createLanguageIntelligence,
  DEFAULT_MAX_LSP_TIMEOUT_MS,
} from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";

const policy = createCodingApprovalPolicy({
  roots: [workspaceRoot],
  approve: async ({ action }) => host.confirm(action),
});

const lang = createLanguageIntelligence({
  workspaceRoot,
  servers: {
    ts: {
      command: process.execPath, // example only — pin a real language server in production
      args: ["/path/to/typescript-language-server", "--stdio"],
      languages: ["typescript", "typescriptreact"],
    },
  },
  limits: { requestTimeoutMs: DEFAULT_MAX_LSP_TIMEOUT_MS },
  policy,
});

try {
  const diags = await lang.diagnostics("src/app.ts");
  const hover = await lang.hover({ file: "src/app.ts", line: 0, character: 0 });
  console.log(diags.length, hover?.text);
} finally {
  await lang.dispose();
}
```

## Extension and configuration notes

- **Server map is the only language binding.** Extension ids map from common file extensions (`.ts` → `typescript`, `.py` → `python`, …); unknown extensions use `plaintext`. Hosts register servers for the language ids they need.
- **Lazy start.** First request for a language starts that server (`initialize` / `initialized`); `workspaceSymbols` / aggregate `diagnostics` start all configured servers.
- **Pluggable policy only.** Renames reuse `assertExecutionAllowed` + `withFileMutationQueue` + `atomicWriteUtf8File`. No second write path.
- **Framing helpers** (`encodeLspFrame`, `LspFrameReader`) are exported for tests and custom transports; production hosts normally use only `createLanguageIntelligence`.
- **Not in default tool aggregators.** Hosts call the contract directly or wrap it in their own `ToolDefinition`s.

## Security and performance notes

- Server `command`/`args` are host-config only — never taken from model tool arguments.
- File URIs must be `file:` and resolve inside `workspaceRoot`; escapes fail with `ERR_PRISM_LSP_WORKSPACE`.
- LSP payloads are untrusted: Content-Length framing is bounded; oversized/malformed frames fail closed; result lists and diagnostics are capped.
- Crash loop: unexpected exit increments a per-server restart counter; after the freeze budget (`LSP_RESTARTS_PER_SERVER` = 3) further starts fail with `ERR_PRISM_LSP_SERVER`.
- Defaults / hard caps (Phase 9 freeze): message 4 MiB / 32 MiB; diagnostics/file 200 / 1000; pending requests 32 / 128; results/query 500 / 5000; timeout 30 s / 120 s; servers/workspace 4 / 8.

## Related APIs

- [Coding agent tools](coding-agent-tools.md): shell/read/write/edit/list/search/glob and shared limits/policy seams this contract reuses for rename.
- [Coding execution approval and sandboxing](coding-security.md): `ExecutionPolicy` / approval composition for gating rename.
- [Tools](tools.md): host-owned `ToolDefinition` registration if you wrap language intelligence as tools.
