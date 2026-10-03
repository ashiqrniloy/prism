# `@arnilo/prism-hooks-json`

Claude/Codex `hooks.json` compiled onto Prism hooks.

## What it does

Loads a hooks file as package config. Command hooks stay allow-listed and hash-pinned. A command that is not pinned fails at load.

| hooks.json | Prism hook |
| --- | --- |
| `SessionStart` | `session.opened` |
| `UserPromptSubmit` | `run.input` |
| `PreToolUse` | `tool.call` |
| `PostToolUse` | `tool.result` |
| `Stop` | `run.end` |

`additionalContext` still drains on the next `context.build`.

## When to use it

A host already has a `hooks.json` and wants those events on a Prism agent. Pass the parsed file as `packageConfig`. Do not put secrets in the file. Env values are `env:` or `keyring:` refs.

## Inputs

```ts
import hooksJson from "@arnilo/prism-hooks-json";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [hooksJson],
  packageConfig: {
    "@arnilo/prism-hooks-json": {
      PreToolUse: [{ matcher: "write", hooks: [{ type: "command", command: "node audit.js" }] }],
      allowCommands: { "node audit.js": "sha256-…" },
    },
  },
});
```

`allowCommands: "all"` runs every command and records a warning. `mcpClient`, `cwd`, and `onWarning` are factory arguments on `hooksJson({ ... })`, not config.

## Security

Command hooks spawn an argv array. No shell. Hash pins cover the command and its args. Env refs resolve through the credentials slot, and the resolved value is redacted from later events.

## Related

Kernel hooks: `docs/next/hooks.md`. The released 0.12.1 page stays `docs/hooks.md`.
