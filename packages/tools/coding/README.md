# @arnilo/prism-tools-coding

The first-party coding tools — file, search, and shell — as a Prism package. The default export is a
`definePackage` definition whose `setup` registers the tools into the session's tool registry.

## Install

```bash
prism add @arnilo/prism-tools-coding
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-tools-coding",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": { "root": "." }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | none (required) | The workspace root every file tool resolves against. Missing `root` fails the package load with a field-naming error. |
| `roots` | `string[]` | `[]` | Extra roots reported by the `coding.targets` service alongside `root`. |
| `readOnly` | `boolean` | `false` | Registers only `read`, `grep`, and `glob`. |
| `shell.enabled` | `boolean` | `true` | When `false`, `shell` is not registered and the effect-classified `delete`/`move` substitutes take its place. |
| `shell.timeoutMs` | `number` | tool default (600 s) | Default wall timeout for `shell`, converted to the tool's seconds option. |
| `shell.background.maxProcesses` | `number` | `4` (hard cap 16) | Live background processes per session. At the cap, `shell({ background: true })` fails until one is killed with `shell_output({ id, kill: true })`. |
| `repository` | `object` | tool defaults | Shared repository limits for `grep` and `glob`: `maxDepth`, `maxEntries`, `maxFiles`, `maxResults`, `maxConcurrency`, `maxScanBytes`, `maxFileBytes`, `maxMatches`, `maxPatternBytes`, `maxLineBytes`, `maxContextLines`, `maxTimeMs`, and `exclude`. |
| `sandbox` | `"none"` \| `"native"` \| `"docker"` \| `"e2b"` | `"none"` | Shell and file-operation backend. `native` builds the in-repo `unshare` backend; `e2b` is reached only through a dynamic `import()` of the optional peer; `docker` needs a host-provided digest-pinned image and runner. A backend that cannot be built notes a warning and withholds `shell` — it never throws and never runs an unsandboxed shell. |
| `commandRules` | `{ match, decision, reason? }[]` | `[]` | Hard-deny command rules for `shell`. `decision` is `allow`, `deny`, or `requireApproval`; a `deny` wins over any approval. The built-in deny patterns (sudo, `rm -rf /`, pipe-to-shell, `mkfs`, `dd if=`) always apply. |
| `egress` | `{ allow?, presets? }` | none | Egress allow-list for sandboxed shells, validated with `createEgressPolicy`. Without a sandbox backend it has no effect and notes a warning. |
| `git.enabled` | `boolean` | `true` | When `false`, no `git_*` tool is registered. |
| `language.servers` | server map | none | Language servers behind the opt-in `diagnostics` tool: name → `{ command, args?, languages, env? }`, where `languages` are LSP language ids (`typescript`, `typescriptreact`, `python`, …) and the package maps file extension → language. No servers means no `diagnostics` tool and no server process. |
| `checks` | named-check map | none | Registers `coding_check` only when at least one check is configured. Each value is `{ file, args, cwd?, env?, timeoutMs? }`. |
| `todo.enabled` | `boolean` | `true` | When `false`, `todo_write` is not registered. |
| `todo.continueOnOpen` | `boolean` | `true` | When `false`, `todo_write` stays and the `run.end` continuation is not registered. |
| `principal.id` | `string` | none | Durable-effect tools fail closed without a host principal. When set, a different `ctx.principal.id` fails closed. |
| `forge.token` | `env:NAME` \| `keyring:NAME` | none | Ref only. A literal fails config validation. Resolved through `prism.credentials.resolve` into the `coding.forge` service. |
| `workspace.enabled` | `boolean` | `true` | When `false`, no `workspace` service is provided. |
| `workspace.worktreeRoot` | `string` | per-repository directory under the OS temp dir | Where worktrees are created. Every path is canonicalized and containment-checked under it. |
| `workspace.maxWorktrees` | `number` | `4` (hard cap 16) | Maximum active worktrees the service creates. |
| `workspace.diff.maxFiles` | `number` | `200` (hard cap 2000) | Maximum files `workspace.diff` lists. |
| `workspace.diff.maxBytes` | `number` | `1 MiB` (hard cap 8 MiB) | Maximum bytes of one file's `diff` text; a larger file is listed with no `diff`. |

An unknown key fails `createAgent` with the kernel's config error naming the key.

## What it changes

Registers thirteen tools into the agent's tool registry (plus `diagnostics` when `language.servers` is configured), each with a declared `effects` annotation:

| tool | effects | notes |
| --- | --- | --- |
| `read`, `grep`, `glob`, `diagnostics` | `["read"]` | observation only; never mutate the workspace |
| `write`, `edit` | `["write"]` | durable local mutation, classified for recovery |
| `delete`, `move` | `["write"]` | only when `shell` is not registered (`shell.enabled: false`, or a sandbox backend that withheld the shell) |
| `shell` | `["execute"]` | `exclusive: true`, so a provider turn containing it dispatches sequentially |
| `shell_output` | `["execute"]` | registered only with `shell`, and only when the backend can start a long-running process |
| `git_status`, `git_diff` | `["read"]` | registered unless `git.enabled` is `false` or `readOnly` is set |
| `git_commit` | `["write"]` | durable; needs a principal |
| `git_pr_handoff` | `["external", "network"]` | durable; forge token is a ref, never a literal |
| `coding_check` | `["execute"]` | only when `checks` has at least one entry |
| `todo_write` | `[]` | transcript only; `run.end` id `@arnilo/prism-tools-coding:run.end#todo` continues while items stay open |
| `ask_user_decision` | `[]` | asks through `host.ui`; `unavailable` suspends |

The rule is one tool per job: `shell` covers what no dedicated tool does — `git branch`, `git worktree`,
`git apply`, `rm`, `mv`, and directory listing are all `shell` calls or `workspace`-service operations,
not extra tool schemas. `delete` and `move` exist only for a host with no shell, where their
effect classification is what recovery clears up after.

The read subset (`readOnly: true`) registers the three read tools only. Git, checks, todo, and `ask_user` stay off in that mode.

## Hard denies and the `coding.targets` service

One `tool.call` decide handler, id `@arnilo/prism-tools-coding:tool.call#hard-deny`, returns
`{ deny }` for:

- any path argument of its own tools that resolves, after realpath and symlink resolution, outside
  `root` ∪ `roots` — except a read-effect call (`read`, `glob`, `grep`, `diagnostics`) may also
  resolve inside a skill's directory, which is a read-only extra root;
- a `shell` command matched by a configured deny `commandRules` entry (or a built-in deny pattern);
- a mutating tool when `readOnly` is set — defence against a host that re-adds a tool.

The handler ignores tools it did not register. The kernel's `tool.call` rule is any-deny-wins, so the
deny holds under `approval` `auto`, under a host `allow` hook, and from a custom loop. Reasons name
the root and the tool, never file contents.

The package also provides the `coding.targets` service:
`targets(name, args, context?) → { paths, roots } | undefined`. `paths` are absolute; `roots` is
`root` plus `roots`, and for `read`, `glob`, `grep`, and `diagnostics` also the directory of every
effective skill that has an absolute `path` (`dirname(skill.path)` from `prism.skills.list()`).
Unknown tool names return `undefined`. Approval (plan 154 Task 6) reads it instead of parsing tool
names, so it sees the same skill directories.

Those skill roots are read-only. A mutating tool (`write`, `edit`, `delete`, `move`) never receives
them, so a write under a skill directory outside the workspace is still hard-denied, and `shell` is
unaffected. The list is read lazily after setup and the derived directories are cached until the
list's paths change; a missing or failed list keeps the coding roots. `createCodingTargets` takes an
optional fourth argument for that source; without it there are no skill roots. A symlink inside a
skill directory that escapes it is rejected by the same realpath containment as any other path.

A call from a session bound to a worktree reports that worktree as the session's root (see
[Worktree roots for one session](#worktree-roots-for-one-session)): a relative argument resolves
against the worktree, and a path inside the main `root` is outside the reported roots. Approval and
the hard-deny hook pass the `tool.call` payload's `sessionId`, so both follow the session.

`createCodingApprovalPolicy` and its `ExecutionPolicy` approval callback were removed in plan 154
Task 4 — prompting is `@arnilo/prism-approval`'s job. Containment (`assertPathInsideRoots`),
command rules (`evaluateCommandRules`), and the sandbox adapters stay as named exports.

## Workspace service

When `root` is inside a git repository the package provides the `workspace` service
(`prism.services.provide("workspace", …)`); outside one it emits an informational `status.note` and
provides nothing. It replaces the durable 0.12 workspace lifecycle: records, leases,
checkpoints, and multi-repository identity are gone, and Phase 16 moves those into
`@arnilo/prism-workflows`. The service is available in `readOnly` mode too — it is a service, not a
tool, and no tool reaches it.

```ts
const workspace = prism.services.consume<WorkspaceService>("workspace");
const wt = await workspace.worktree.create({ sessionId: child.id });
const overlay = await workspace.excludeOverlay(wt.path, [{ path: ".agents/hooks.json", content: "{}" }]);
const { changes } = await workspace.diff(wt.path);
const merged = await workspace.merge(wt.path, { into: "main", commit: { message: "delegated change" } });
if (merged.status === "conflict") console.log(merged.files);
await overlay.dispose();
await wt.dispose({ force: true });
```

| member | behavior |
| --- | --- |
| `worktree.create({ branch?, base?, sessionId? })` | Adds a linked worktree under `worktreeRoot` on a new branch (default `prism/<short id>`) from `base` (default `HEAD`), locks it with a `prism-workspace:` reason, and returns `{ path, branch, base, parentBranch, sessionId?, dispose }`. `base` is the resolved commit the branch started at. `parentBranch` is the main tree's checked-out branch at creation, recorded because `merge` only accepts a branch name; `HEAD` means the main tree was detached. `sessionId` binds the worktree for tool routing (see [Worktree roots for one session](#worktree-roots-for-one-session)); under a sandbox the binding fails with `workspace_sandbox_unsupported`. More than `maxWorktrees` active worktrees fails with `workspace_limit`; a destination outside `worktreeRoot` fails with `workspace_path_escape`. |
| `worktree.bound(sessionId)` | The active worktree bound to that session, or `undefined`. |
| `worktree.rebind({ path, sessionId, branch?, base? })` | Re-adopts a worktree a dead process left behind and binds it to `sessionId`, so a resumed workflow node runs in its recorded worktree. It fails closed with `workspace_unknown` unless the path is inside `worktreeRoot`, registered with git, locked with this service's `prism-workspace:` marker, and on `branch` when given. `base` defaults to the merge base of the branch and the main tree's `HEAD`. Idempotent for the same session; counts against `maxWorktrees`; refused under a sandbox. Never creates a worktree. |
| `diff(path, bounds?)` | `{ changes, truncated }` for tracked changes against the worktree's `base` plus untracked files. Paths are worktree-relative and each entry is the driver kit's `FileActivity` shape. A file whose diff exceeds `maxBytes` is listed with no `diff`; more than `maxFiles` sets `truncated`. Overlay files never appear. |
| `merge(path, { into, commit? })` | Merges the worktree's branch into `into`. Everything is decided before anything moves: the merge tree is probed with `git merge-tree --write-tree`, so a conflict returns `{ status: "conflict", files }` with both trees, the index, and every ref unchanged. A clean merge returns `{ status: "merged", commit }` and advances `into` with a compare-and-swap; when `into` is checked out somewhere, that worktree is fast-forwarded so its index and files stay consistent. |
| `commit(path, { message })` | Records the worktree's pending changes (tracked and untracked) on the worktree's own branch, without merging it, and returns `{ commit }`. A clean worktree creates nothing and returns its current tip. Use it before keeping a branch for a person, so the kept branch carries the work and not just its commits. Needs a configured commit identity, like `merge`. |
| `excludeOverlay(path, files)` | Writes the overlay files into the worktree and excludes them through one marked block in the git common directory's `info/exclude` (the same writer the driver kit's `overlay()` uses). Returns `{ dispose }`. |
| `dispose({ force? })` | Removes the overlays and their exclude blocks, unlocks and removes the worktree, drops the session binding, and deletes the branch when git considers it fully merged. Refuses a dirty worktree unless `force`, and is idempotent. |

A service created with `createWorkspaceService({ onEvent })` emits the frozen coding lifecycle event
`worktree_changed` — `{ action: "add", path }` after `worktree.create` succeeds and
`{ action: "remove", path }` after `dispose` removes one — through the same
`createCodingLifecycleEmitter` cap checks as the file tools, so a host that maps coding events (the ACP
lifecycle mapper) sees worktree movement. Events are host-wired: the package registers no listener and
the plugin passes no sink, exactly like the tools' `onEvent`.

Merge semantics and safety:

- A **dirty worktree** is refused without `commit`. With `commit`, the worktree's live state (tracked
  and untracked) is folded into a dangling commit, and the index is restored exactly if the merge
  turns out to conflict — so a conflict changes nothing at all. On success the worktree's branch
  advances to that commit, and the merge commit records it.
- A **dirty checked-out target** is refused with `workspace_dirty_target`; a clean one is
  fast-forwarded to the merge commit.
- The service never pushes, never resolves a conflict, and never invents a commit identity: it reads
  the repository's configured `user.name`/`user.email` and fails with `workspace_identity_missing`
  when there is none. A git too old for `merge-tree --write-tree` fails with
  `workspace_git_unsupported`.
- The **main worktree is never removed, locked, or reset** (`workspace_main_immutable`), and a path
  that is not a worktree this service created is refused (`workspace_unknown`).
- The remote URL is never stored or logged.

Cost: package setup costs one `git rev-parse` probe. Git is spawned only on service calls, through
the bounded `GitOperations` runner; a worktree's own instance is created on its first use and
dropped on dispose.

### Worktree roots for one session

A worktree bound with `worktree.create({ sessionId })` routes that session's tool calls into the
worktree. One wrapper at registration (`createWorktreeRouting({ base, create, workspace })`) wraps
each registered tool's `execute` with a lookup of the calling session's worktree and dispatches to
the instance built for that worktree. Relative paths then resolve inside the worktree, the tools'
own containment follows it, and `coding.targets` reports the worktree as that session's root. Tool
names, descriptions, and schemas are unchanged, and no tool reads the binding.

- The binding lives only in the service's memory, keyed by session id. It is never read from tool
  arguments or model output, so a model cannot claim a worktree.
- An unbound session — and any session id the service does not know — runs with `root` exactly as
  before.
- Instances are built once per bound worktree and dropped on `dispose`; the wrapper also drops a
  session's instances on the `session.closed` hook (there is no `session.deleted` event), and a
  session rebound to another worktree rebuilds.
- From a bound session a write to the main `root` is denied: the hard-deny hook reports roots
  `[worktree, ...roots]`, and `delete`/`move` refuse it through their own containment too. From any
  other session a path inside the worktree is outside that session's roots and is denied the same
  way.
- With `sandbox` other than `none`, `worktree.create({ sessionId })` fails with
  `workspace_sandbox_unsupported`: a routed worktree path is outside the sandbox root. `create`
  without `sessionId` still works, for a human to inspect.

### Tool reference

| tool | input | result |
| --- | --- | --- |
| `shell` | `{ command, timeout?, background? }` | Combined output + `metadata.exitCode`; 600-second default timeout and 64 MiB total-output cap. Non-zero exit is **not** an error. With `background: true` the command keeps running: the call returns `Started process <id>` plus the first output, waiting for it only until the one-second window closes, and `metadata.processId` names it. |
| `shell_output` | `{ id, waitSeconds?, kill? }` | Output produced since the previous call for that id (tail-capped like `shell`), whether it is still running, and its exit code once it ended. `waitSeconds` (default 0, max 60) waits for the process library's next publication — a chunk or the exit — rather than polling, and one call returns everything that accumulated in whole chunks up to twice the tail cap; `kill: true` ends it. Another session's id is an error; every process is killed on `session.closed` and on `agent.dispose()`. |
| `read` | `{ path, offset?, limit?, findText?, findMode? }` | Streamed bounded text page with each line prefixed by its 1-based number and a tab (`12\treturn 1;`), or bounded `[note, ImageContent]`. The prefix is not part of the file; the page caps count it. |
| `write` | `{ path, content }` (plus `force?` only when the host set `requireReadBeforeWrite`) | Full overwrite; bounded UTF-8 input. Without the guard the schema has no `force` and the description says nothing about one. |
| `edit` | `{ path, edits: [{oldText,newText}] }` (plus `force?` only with `requireReadBeforeWrite`) | **Exact-match only**: `oldText` must be copied from `read` without its line-number prefix; a miss fails with a `Nearby` hint (and a "remove the prefixes" hint when every line is numbered) and never strips or edits; duplicates and overlaps fail closed. Success reads `Edited <path>: N block(s).` followed by the changed lines with their new numbers, two lines of context, capped at 40 lines. |
| `grep` | `{ pattern, literal?, path?, glob?, caseSensitive?, includeHidden?, context?, maxMatches?, outputMode?, mode? }` | Regex by default in a terminate-able worker (`literal: true` matches text); ripgrep-style output — `path:line:text`, `path-line-text` context, `--` between groups, each line once; `outputMode`: `content` \| `files_with_matches` \| `count`; `mode` only when the host enabled an indexed mode. |
| `glob` | `{ pattern, path?, includeHidden?, maxDepth?, maxResults?, offset? }` | Filename match (`*`/`?`/`**`). Braces expand (`{ts,tsx}`, bounded to 128 alternatives / 4096 bytes; unbalanced, nested, or empty braces are errors) unless the host passed `braceExpansion: false`. Files only. |
| `diagnostics` | `{ path }` | Only with `language.servers`. The language server's diagnostics for one file as `path:line:col severity message` (1-based), after a document refresh; a server that cannot start is a tool error naming the server plus one `status.note("warn", …)`. |
| `delete` | `{ path, recursive? }` | Only when `shell` is absent. High-risk: file or empty dir only; **no trash**. |
| `move` | `{ from, to, overwrite? }` | Only when `shell` is absent. High-risk rename/move; `overwrite` default false; **no trash**. |

Factories: `createCodingTools`, `createReadOnlyTools`, `createAllTools`, and the per-tool factories
`createShellTool`, `createShellOutputTool`, `createReadTool`, `createWriteTool`, `createEditTool`,
`createGrepTool`, `createGlobTool`, `createDeleteTool`, `createMoveTool`, and `createDiagnosticsTool`; the opt-in
`createGitTools`, `createCodingCheckTool`, and `createAskUserDecisionTool` stay out of the default
aggregators.

Long-running commands are supported through `shell({ background: true })` + `shell_output`; those
processes run on the process-session library (the same ownership, lifetime, and output caps the
`agent/process` API uses), inherit the shell's environment allow-list, and are killed when the
session closes. A backend that cannot start a process (the native `unshare` sandbox) keeps the
`background` argument out of the schema and does not register `shell_output`.

`diagnostics` starts one language-server process per configured server, on the first call that needs
it, and stops them when the last open session closes (so `agent.dispose()` leaves none running); a
configured server that no file needs is never started. With a sandbox configured the servers still run
on the host, outside it — the package notes that when it loads.

Non-goals (unchanged from the 0.12 package): No PDF reader, no document reader, no trash /
recycle daemon, and no PTY / interactive process control in the default set. See
[coding-tools.md](README.md) and the
`coding-tools-capability-gaps.ts` example.

The package also re-exports the moved module surface as named exports (the former `/agent` and
`/security` surfaces of the retired coding-tools family package): the tool factories (`createCodingTools`,
`createReadOnlyTools`, `createAllTools`, and the per-tool factories), the opt-in Git, check, todo, and
`ask_user` tools, the workspace/process/language helpers, and the sandbox adapters (native,
Docker, E2B) and approval/egress helpers. Only the tools in the table above are registered; every other
export is inert until a host or another package uses it.

## Git, checks, todo, ask-user, and principal

`git` defaults on. `checks` registers `coding_check` only when the map is non-empty. `todo` registers
`todo_write` and, unless `continueOnOpen` is `false`, a `run.end` decide handler that returns
`{ continue: { reason, steer } }` while items stay open. The steer and no-progress caps are the 0.12
limits; `limits.maxContinuations` still caps the run.

`ask_user_decision` asks through `host.ui` `select` (options, plus a custom sentinel when
`allowCustom`) and `input` (a custom answer). `pros` and `cons` are optional, 0–3 strings each; the UI
shows whatever the model gave, so nothing enforces a fixed count. `dismissed` is a declined tool result. `unavailable`
returns `{ ask }`; the tool's elicitation contract suspends the run and `session.resume(decisions)`
delivers the answer without executing the tool.

A durable tool (`write`, `edit`, `delete`, `move`, mutating git, `git_pr_handoff`) fails closed with
`ERR_PRISM_CODING_PRINCIPAL_REQUIRED` when `ctx.principal` is absent, and with
`ERR_PRISM_CODING_PRINCIPAL_MISMATCH` when `principal.id` is set and differs. Read-only git needs no
principal.

## Capabilities

`host-ui` and `credentials`. `host-ui` is how `ask_user_decision` reaches a person. `credentials` is
how `forge.token` resolves. The package claims no slot and makes no model call at setup.

## Enterprise deployment

In enterprise or multi-tenant deployments, executing uncontained shell commands or file operations directly on the host poses security risks. The package provides multiple layers of defense:

1. **Sandbox Backends (`sandbox`):**
   By default, `sandbox` is `"none"`, which executes shell commands on the host. When `shell` is registered without a sandbox, setup emits a `warn` status note (`"shell runs on the host without a sandbox; pair it with @arnilo/prism-approval or set sandbox"`). For production workloads, select an isolated backend:
   - `"docker"`: Runs file operations and shell commands inside a digest-pinned container runner.
   - `"native"`: Uses Linux namespace isolation (`unshare`) to containerize processes on the host.
   - `"e2b"`: Executes operations in isolated cloud microVMs via the optional E2B peer.
   If a configured backend cannot be initialized, the package fails closed by withholding `shell` and noting a warning.

2. **Approval Package (`@arnilo/prism-approval`):**
   Combine coding tools with `@arnilo/prism-approval` to require explicit human or policy approval before mutating operations (`write`, `edit`, `delete`, `move`) or `shell` commands execute.

3. **Command Rules (`commandRules`):**
   Configure granular command policies for `shell` execution:
   ```jsonc
   "commandRules": [
     { "match": "npm publish*", "decision": "deny", "reason": "publishing is prohibited" },
     { "match": "curl *", "decision": "requireApproval" }
   ]
   ```
   Built-in deny patterns (sudo, `rm -rf /`, pipe-to-shell, `mkfs`, `dd if=`) always apply and cannot be bypassed.

4. **Network Egress Rules (`egress`):**
   When using a sandbox backend (`"docker"` or `"native"`), configure egress policies (`allow` rules and preset bundles) to restrict outbound network access from sandboxed shells:
   ```jsonc
   "egress": {
     "allow": [{ "host": "github.com", "port": 443, "protocol": "https" }],
     "presets": ["node"]
   }
   ```
   Egress rules are validated with `createEgressPolicy`; under `sandbox: "none"`, egress filtering has no effect and emits a warning note.

## Cost, security, and failure behavior

- In-tool path containment stays on: `write`/`edit`/`delete`/`move` resolve through
  `resolveContainedMutationPath`, and `read`/`grep`/`glob` go through the
  repository operations that refuse a path outside the root and never follow symlink escapes.
  The `tool.call` hard deny above is the outer gate, so a custom loop or a host `allow` hook cannot
  skip it.
- Importing the package evaluates no `playwright-core`, `@office-open/*`, `mammoth`, `pdf-parse`,
  `@firecrawl/anydoc`, or `e2b` module. The optional E2B peer is reached only through
  `createRequire` plus a dynamic `import()` inside `createE2BSandbox`/`connectE2BSandbox`, and only
  when `sandbox: "e2b"` is selected.
- A durable tool (`write`, `edit`, `delete`, `move`, and the mutating Git tools) needs an ownership
  scope; without one the kernel fails the call closed with `ERR_PRISM_TOOL_EFFECT_CONFLICT` rather
  than recording an unattributed effect.
- A missing `root` fails the package load, naming the field.
- A `sandbox` backend that cannot be built fails closed: a warning note, no `shell` registration,
  and the run continues with the local file tools.

## Example

```ts
import toolsCoding from "@arnilo/prism-tools-coding";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [toolsCoding({ root: process.cwd(), readOnly: true })],
});
```

`examples/coding-approval.ts` runs this package with `@arnilo/prism-approval` in `ask` mode and
`@arnilo/prism-context-files` on one agent: the scripted host approves an `edit`, the file changes, and
`disable: { tools: ["shell"] }` removes the shell so a call to it is blocked as an unknown tool.

`examples/serve-tools.ts` runs this package under `@arnilo/prism-mcp-server`'s `serveTools`: the
package's own `read` and `edit` are the definitions served, `coding.targets` is what decides "inside
roots" for the served calls, the package's default command rules are what deny a dangerous shell
command, and the session's bound worktree is what a served `edit` changes — so `workspace.diff`
reports the edit and not the overlay the same run wrote through `excludeOverlay`.
