# Writing an adapter

## What it does

`@arnilo/prism-driver-process` runs one external coding-agent binary as a Prism `Agent`'s loop. Prism ships no
adapter for any vendor binary: the host writes an `AgentAdapter`, a plain object that describes what the binary can
enforce and capture, maps the agent definition onto the binary's flags or files, and maps the binary's wire onto
Prism activity. The driver package owns the process, the profile, the policy guard, the callback broker, the MCP tool
bridge, and the conformance suite. The adapter owns only what is vendor-specific.

This page is the authoring guide. It documents the contract member by member, then carries the vendor research from
roadmap §2.12.4, §2.12.5, §2.12.7, and §2.12.11 as dated, non-normative worked mappings.

## When to use it

- You want to run `claude`, `codex app-server`, `agy`, or any coding-agent binary as a Prism agent, with Prism's
  sessions, events, gates, tools, skills, and profiles.
- You are writing a driver package that wraps `processDriver` for one binary.

If you need an in-process Prism agent that calls a model, use the loop API instead (see [loop](loop.md)). If you are
wiring the kernel's driver kit for a new binary family, start with [drivers](drivers.md).

## The adapter contract

An adapter is an `AgentAdapter` from `@arnilo/prism-driver-process`. Every member is read once at definition, except
the functions, which are called per run.

| Member | Required | What it does |
| --- | --- | --- |
| `name`, `revision` | yes | Identity. `name` must be a package-shaped string; `revision` changes whenever the wire mapping changes. |
| `descriptor` | yes | `DriverDescriptor`: `usesModel: false`, `models`, `controls`, `capture`, `auth.modes`. This is the honest declaration the policy guard and `requires` read. |
| `transport` | yes | `"jsonl-stream"` or `"json-rpc"`. See [Choosing a transport](#choosing-a-transport). |
| `vendor` | no | A JSON Schema validating `ExternalAgentSpec.vendor`. Omit to accept no vendor options. |
| `binary` | yes | `{ command, versionArgs?, version(stdout) }`. `command` is the argv prefix the driver spawns; a config `binary` override replaces `command[0]` and keeps the rest. |
| `profile` | yes | `{ parseStatus({ exitCode, stdout }) }`, the only profile member that stays on the adapter. Home variable, protected paths and env, and the login and status commands live on `descriptor.auth.modes`. |
| `configure(spec, ctx)` | yes | Returns a `LaunchPlan` `{ args?, env?, files?, overlays? }`. `ctx` carries the private `runDir`, the profile `home`, `cwd`, selected materialized `skills`, the optional MCP `endpoint`, the relay `hook: { argv, command }`, and the `resume` entries. |
| `open?(ctx)` | no | Frames sent after spawn and before the first prompt. `ctx` is `{ sessionId?, turnId?, resume, tools }`. |
| `encode.prompt/steer/continue` | `prompt` | Map a Prism input to an outbound frame. `steer` and `continue` are optional and must match `controls.steer` and `controls.continueOnStop`. |
| `decode(frame)` | yes | Map one wire frame to `Decoded { activity, turnEnd?, sessionId?, turnId?, stop?, unmapped? }`. |
| `hooks?` | no | `{ codec, failClosed, timeoutMs? }` for relay callbacks. See [the hook codec](#the-hook-codec-and-the-fail-closed-response). |
| `permissionTool?` | no | The name of an MCP permission-prompt tool the driver exposes through `serveTools`. |
| `requests?` | no | JSON-RPC server-request handlers, keyed by method. See [server-to-client requests](#server-to-client-requests). |
| `session` | yes | `{ strategy, archive?, restore? }`. The strategy must equal `descriptor.controls.resume`. See [resume strategies](#resume-strategies). |
| `abort` | yes | The ordered abort ladder. See [the abort ladder](#the-abort-ladder). |
| `notices?(activity)` | no | Classify a decoded notice as a limit signal. |

`adapterDriver(adapter)` exposes the driver-kit definition; `processDriver(adapter)` builds the native package and
adds a `driver-process:<name>` service whose `inspect()` reports the adapter identity, binary, transport, capture,
deployment, isolation, and auth policy. Neither is needed in the adapter itself.

A minimal `jsonl-stream` adapter. From `packages/drivers/process/src/__tests__/guide-samples.test.ts`:

```ts
const minimal: AgentAdapter = {
  name: "example-adapter",
  revision: "1",
  transport: "jsonl-stream",
  descriptor: {
    vendor: "example",
    usesModel: false,
    models: "passthrough",
    controls: {
      systemPrompt: ["replace", "append"],
      builtinTools: "per-tool",
      clientTools: "mcp",
      skills: true,
      subagents: true,
      permissionCallback: false,
      rewrite: false,
      continueOnStop: false,
      steer: "none",
      resume: "none",
      isolation: "flags",
    },
    capture: {
      textDeltas: true,
      thinking: "deltas",
      skillActivation: "native",
      toolCalls: true,
      fileDiffs: true,
      subagents: "full",
      usage: "tokens",
    },
    auth: {
      modes: [
        {
          name: "key",
          kind: "api-key",
          deployments: ["local"],
          homeEnv: "EXAMPLE_HOME",
          protected: { paths: [], env: ["EXAMPLE_TOKEN"] },
        },
      ],
    },
  },
  binary: { command: ["example-cli"], versionArgs: ["--version"], version: (stdout) => /\d+\.\d+\.\d+/.exec(stdout)?.[0] },
  profile: { parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0 }) },
  configure: () => ({ args: [] }),
  encode: {
    prompt: (input) => JSON.parse(jsonlStreamDialect.encodeInput({ kind: "user", text: typeof input === "string" ? input : "go" })),
  },
  decode(frame) {
    const output = jsonlStreamDialect.parseFrame(JSON.stringify(frame));
    if (output?.kind !== "frame") return { activity: [], unmapped: true };
    return "kind" in output.frame ? { activity: [output.frame as ExternalActivity] } : { activity: [], turnEnd: true };
  },
  session: { strategy: "none" },
  abort: [{ signal: "SIGTERM" }],
};
```

## Choosing a transport

| | `jsonl-stream` | `json-rpc` |
| --- | --- | --- |
| Shape | One process per conversation, one JSON object per line each way. | A JSON-RPC 2.0 peer over the same stdio pipes. |
| Outbound frames | A plain `JsonValue`. | `{ method, params?, notify?, onResult? }`. |
| Results | Not applicable; every line is decoded. | `notify: true` sends a notification; otherwise the driver sends a request. The reply goes through `onResult(result)` when supplied, else through `decode(result)`. |
| Gating | Relay command hooks (`hooks.codec`). | Server requests (`requests`) plus optional relay hooks. |
| Abort | `closeStdin` and signals. | `rpc` steps, then `closeStdin`, then signals. |

Pick `jsonl-stream` when the binary reads prompts on stdin and writes events on stdout. Pick `json-rpc` when the
binary answers requests, sends its own requests, and needs a request/reply handshake before the first prompt. Both
transports share capture, steering, stop/continue, redaction, and process cleanup.

`open` frames run sequentially before the first prompt. In `json-rpc`, each request waits for its reply and applies
any decoded session or turn id before the next frame. From `examples/adapters/rpc-server.ts`:

```ts
open: (ctx): readonly OutboundFrame[] => {
  const thread = (method: string, threadId: string | null): OutboundFrame => ({
    method,
    params: { threadId, dynamicTools: ctx.tools as unknown as JsonValue },
    notify: true,
  });
  return [
    { method: "initialize", params: { capabilities: { experimentalApi: true }, clientInfo: { name: "prism", version: "1" } }, notify: true },
    { method: "initialized", notify: true },
    ctx.resume.sessionId ? thread("thread/resume", ctx.resume.sessionId) : thread("thread/start", null),
  ];
},
```

## Mapping the agent definition

Every adapter receives the same `ExternalAgentSpec`. The spec selects among the agent's own registries; it never
carries tool or skill definitions. An adapter that cannot enforce a control the spec asks for must say so in the
descriptor, so `requires` fails at `createAgent` instead of silently ignoring it.

| `ExternalAgentSpec` field | Map to |
| --- | --- |
| `systemPrompt.replace` / `.append` | A prompt flag, a settings file, or a generated agent file. Read `spec.systemPrompt` and branch on `"replace" in spec.systemPrompt`. |
| `model`, `effort` | The binary's model and reasoning-effort flags or fields. |
| `prismTools` | The broker's MCP endpoint (`ctx.endpoint`) written into the binary's MCP config, or the `json-rpc` bridge through `item/tool/call`. |
| `builtinTools.allow` / `.deny` | A tool allow/deny flag, an agent-file frontmatter list, or a permission rule. |
| `skills` | `ctx.skills` materialized through `materializeSkills`; the adapter wraps the neutral layout into the vendor's plugin or skills directory. |
| `subagents` | One generated definition per entry, or a JSON flag; declare `controls.subagents: false` when unsupported. |
| `limits` | The binary's turn or budget flags where they exist; kernel wall-time and tool-round limits always apply. |
| `isolation` | A flag (`--no-user-config`, `--strict-mcp-config`) or a worktree overlay. Default is `"strict"`. |
| `profile` | The profile the driver already created; the adapter only names the home variable in `descriptor.auth.modes`. |
| `vendor` | Whatever the adapter's `vendor` schema validates. |

`configure` returns the launch plan. A flag-configured adapter writes settings into the private run directory and
returns `args`; a workspace-file adapter returns `overlays` for the bound worktree. From
`examples/adapters/workspace-config.ts`:

```ts
async configure(spec, ctx) {
  const args = ["--agent", spec.name, "--input-format", "stream-json", "--output-format", "stream-json"];
  if (spec.isolation !== "inherit") args.push("--no-user-config");
  if (ctx.resume.sessionId !== undefined) args.push("--conversation", ctx.resume.sessionId);
  const overlays: MaterializedFile[] = [];
  const write = (path: string, content: string) => overlays.push({ path, content });
  write(`.agents/agents/${spec.name}.md`, agentFile(spec));
  write(".agents/hooks.json", JSON.stringify({ PreToolUse: [{ type: "command", command: [...ctx.hook.argv] }] }));
  write(".agents/mcp.json", JSON.stringify({ strict: true, endpoint: ctx.endpoint ?? null }));
  return { args, overlays };
},
```

Files must be relative to `ctx.runDir` or the bound worktree; overlays go through `RunDirectory.overlay`, which
writes the Git exclude block. An absolute path or `..` fails with `profile_invalid`. A `workspace-files` adapter under
strict isolation without a bound worktree fails with `worktree_required`.

## Mapping vendor activity

`decode(frame)` returns `Decoded`. Each `activity` entry is an `ExternalActivity` the run observes in order. Map every
message the binary can send; leave a frame `unmapped: true` only when it truly carries no activity.

| `ExternalActivity` kind | Produces | Notes |
| --- | --- | --- |
| `message.delta` | `message.delta` | Streaming text or thinking content. |
| `message` | `message.completed` | A complete message. |
| `tool.started`, `tool.progress`, `tool.completed` | `tool.started`, `tool.progress`, `tool.completed` | Vendor built-in tools, reported with `executedBy: "external"`. |
| `skill` | `agent.skill` | Set `source` (`"tool"`, `"path"`, `"native"`) and `resolved`. |
| `file` | `agent.file` | Set `source: "agent"` for a reported change or `"diff"` for a unified diff. |
| `plan` | `agent.plan` | |
| `subagent` | `agent.subagent` | Nested by `parentToolCallId`; `phase: "started" \| "completed"`. |
| `compaction` | `agent.compaction` | |
| `notice` | `agent.notice` | Classify limits with `notices`. |
| `usage` | Adds to the run's totals | No event of its own. |
| `raw` | `agent.raw` | An unmapped frame kept for `capture: "all"`. |

`Decoded` also carries the run signals: `turnEnd: true` ends the turn, `sessionId` records the vendor conversation
id, `turnId` records the current turn, and `stop` (`true` or a reason string) asks the driver to end the run. A frame
that matches nothing must return `{ activity: [], unmapped: true }`. An invalid JSON line is already captured as raw
by the transport; do not throw for it.

The reference adapters keep the wire table explicit and fall through to `unmapped`. Excerpt from
`examples/adapters/workspace-config.ts`:

```ts
export function decodeWorkspaceFrame(frame: JsonValue): Decoded {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return { activity: [], unmapped: true };
  const f = frame as Record<string, JsonValue>;
  const activity: ExternalActivity[] = [];
  switch (f.type) {
    case "init":
      if (typeof f.conversationId === "string") return { activity, sessionId: f.conversationId };
      break;
    case "text_delta":
      if (typeof f.text === "string") return { activity: [{ kind: "message.delta", content: { type: "text", text: f.text } }] };
      break;
    case "result":
      return { activity: [], turnEnd: true, ...(typeof f.conversationId === "string" ? { sessionId: f.conversationId } : {}) };
  }
  return { activity, unmapped: true };
}
```

## The hook codec and the fail-closed response

A vendor hook calls out when it wants to run a tool. Prism gates it through the relay: the driver's broker runs the
gate and answers the hook. `hooks.codec.decode(stdin)` turns the vendor's payload into a `HookEvent`:

- `{ kind: "pre-tool", request }` goes to `run.ask`, which fires the `tool.call` hook and can allow, deny, or suspend.
- `{ kind: "stop" }` goes to `run.end`, so a stop hook can continue the agent when `continueOnStop` is set.
- `{ kind: "observe", activity }` records activity without granting permission.

`hooks.codec.encode(answer)` returns `{ exitCode, stdout }`, printed verbatim. Choose the fail-closed response to
match the binary's own hook semantics: a binary that blocks on a non-zero exit uses `{ exitCode: 2, stdout: "" }`; a
binary that reads a printed decision uses `{ exitCode: 0, stdout: '{"decision":"deny","reason":"prism relay unavailable"}' }`.
The same value must be declared as `hooks.failClosed` so the conformance `fail_closed_response` leg can compare it.

Excerpt from `examples/adapters/workspace-config.ts`:

```ts
const FAIL_CLOSED = { exitCode: 0, stdout: '{"decision":"deny","reason":"prism relay unavailable"}' };
// ...
encode: (answer) => {
  if ("end" in answer) return { exitCode: 0, stdout: JSON.stringify({ decision: answer.end.continue ? "continue" : "stop" }) };
  if ("allow" in answer)
    return { exitCode: 0, stdout: JSON.stringify(answer.allow ? { decision: "allow" } : { decision: "deny", reason: answer.message }) };
  return FAIL_CLOSED;
},
```

A codec that throws, a callback that times out, a malformed answer, and a closed broker all answer `failClosed`.
Set `timeoutMs` to bound a slow callback. **Never gate through an HTTP hook whose failure the vendor treats as
non-blocking**: a gate that continues when Prism is unreachable is not a gate. Route gating through the relay
command, and use HTTP hooks only for observation.

## Server-to-client requests

A `json-rpc` binary sends requests the client must answer. Every method needs its own entry in `adapter.requests`;
there is no catch-all. Each handler receives `{ params, run, host, bridge, ask, tools, sessionId?, turnId? }` and
never the peer or the broker token. An unknown method is answered `-32601` and then fails the run with
`vendor_request_unhandled`; a throwing handler is answered `-32603` and fails with `vendor_request_failed`.

- Approvals: call `ask(request)`, which preserves `tool.call` hooks and external origin. Without a UI the kernel
  denies or suspends according to whether the loop is resumable.
- Questions and elicitation: call `host.ui.request(...)`.
- Client tools: call `bridge.invoke(call)`. Only `spec.prismTools` are bridged, and execution goes through
  `run.executeTools`, so `tool.call` and `tool.execute` fire as for any Prism tool.

From `examples/adapters/rpc-server.ts`:

```ts
requests: {
  "item/approval": async ({ params, ask }) => {
    const call = params as { toolCallId?: unknown; name?: unknown; args?: unknown };
    return answerToDecision(await ask({ toolCallId: String(call.toolCallId ?? ""), name: String(call.name ?? ""), args: (call.args ?? {}) as JsonValue, effects: ["write"] }));
  },
  "user/input": async ({ params, host }) => {
    const question = params as { question?: unknown };
    const answer = await host.ui?.request({ kind: "input", title: String(question.question ?? "Input") });
    return { answer: answer?.status === "answered" ? String(answer.value) : null };
  },
  "item/tool/call": async ({ params, bridge }) => {
    const call = params as { toolCallId?: unknown; name?: unknown; args?: unknown };
    const result = await bridge.invoke({ type: "tool_call", id: String(call.toolCallId ?? ""), name: String(call.name ?? ""), arguments: (call.args ?? {}) as JsonObject });
    return { result: (result.value ?? null) as JsonValue };
  },
},
```

Up to eight handlers run concurrently; excess requests receive a JSON-RPC error and fail the run. A package that
uses `adapterDriver` inside its own package must declare the `host-ui` capability before calling `host.ui`.

## Resume strategies

`descriptor.controls.resume` and `session.strategy` must agree. Choose one:

- `store`: the driver archives state after every completed turn and restores it into the next run's private
  directory. Implement `archive(ctx)` returning `JsonValue[]` and `restore(entries, ctx)` returning a `RestorePlan`
  `{ files?, args?, env? }`. `ctx` is `{ runDir, home, cwd, sessionId? }`. The driver appends the plan's `args`
  automatically and also exposes them as `configure`'s `ctx.resume.args`. Use this when the binary keeps a transcript
  file the host must copy.
- `vendor`: the binary owns its state. Record the id from `decode` (`sessionId`) and pass it back in `configure`
  (`ctx.resume.sessionId`) or `open`. Use this when the binary stores the conversation in its own home.
- `none`: start fresh each run and write no resume state. This avoids the per-turn archive write.

Store resume archives strings and object keys that are checked against every declared protected credential path, so
an adapter must select conversation data without reading credential files. Non-empty resume state requires matching
binary major and adapter revision; a mismatch fails with `driver_revision_mismatch`.

## The abort ladder

`abort` is an ordered list of steps. A run abort executes them in order; each step gets a slice of `graceMs`, with two
slices reserved for the fallback signal ladder and a hard SIGKILL deadline over the whole budget. Failed writes do
not block escalation.

| Step | Meaning |
| --- | --- |
| `{ rpc: method, params?(ctx) }` | Send a JSON-RPC notification. Requires `json-rpc`. |
| `{ closeStdin: true }` | Close the child's input. |
| `{ signal: "SIGINT" \| "SIGTERM" }` | Signal the child. |

A graceful post-turn shutdown closes stdin and waits up to `graceMs` for flushing before the fallback ladder. A
typical ladder for a stream binary is `[{ signal: "SIGINT" }, { signal: "SIGTERM" }]`; for an app server, interrupt
the turn first:

```ts
abort: [
  { rpc: "turn/interrupt", params: (ctx) => ({ threadId: ctx.sessionId ?? null, turnId: ctx.turnId ?? null }) },
  { closeStdin: true },
  { signal: "SIGTERM" },
],
```

## Declaring the auth policy honestly

Auth is data on `descriptor.auth.modes`. Each `AuthMode` has `name`, `kind: "account" | "api-key"`, `deployments`
(`"local"`, `"hosted"`), `hostedAcknowledgements`, `protected: { paths, env }`, and the vendor's `login` and `status`
commands. The driver supplies `parseStatus`. The policy guard enforces six rules; the first four apply to every
adapter, and the last two are the adapter's declaration:

1. **Unmodified binaries only.** Prism runs the vendor-published binary the user installed and never patches it or
   strips an authentication method. The probed path and version are recorded.
2. **No subscription credentials in Prism.** Sign-in happens only through the vendor's own flow, in a terminal the
   host gives the user, or through a URL shown with `open-url`. Prism never reads, writes, copies, stores, or relays
   subscription tokens or token files. API keys stay ordinary credential refs.
3. **One end user per profile.** A profile is bound to the principal that signed in; another principal fails with
   `profile_principal_mismatch`.
4. **Individual-usage pacing.** Each profile has a `maxConcurrentRuns` cap (default 2). Rate-limit, quota, and billing
   signals stop or defer the run; there is no retry loop.
5. **Deployment declaration.** The host declares `deployment: "local" | "hosted"`. A mode that lists `"hosted"` must
   list its `hostedAcknowledgements`; a hosted run without them fails with `plan_login_not_permitted`.
6. **Per-vendor conditions.** Anything the vendor's terms require beyond rules 1–4 is expressed as the mode's
   deployments and acknowledgements. The adapter's author pins the dated sources it was verified against, and a
   terms change is that author's release blocker.

`protected.paths` and `protected.env` are compared only as strings; the kit never opens them. The conformance canary
plants a token at each and proves the adapter does not read it. An account mode with no protected path or env is
rejected at definition.

## Extending an adapter

`extendAdapter(base, overrides)` creates a new adapter at definition time without changing the base. Every extension
requires its own `name` and `revision`.

From `packages/drivers/process/src/__tests__/guide-samples.test.ts`:

```ts
import { type AgentAdapter, extendAdapter } from "@arnilo/prism-driver-process";

const extended = extendAdapter(minimal, {
  name: "my-extended-adapter",
  revision: "1",
  configure: (baseConfigure) => async (spec, ctx) => {
    const plan = await baseConfigure(spec, ctx);
    return { ...plan, args: [...(plan.args ?? []), "--quiet"] };
  },
  descriptor: { auth: { modes: minimal.descriptor.auth.modes.map((mode) => ({ ...mode, deployments: ["local"] })) } },
});
```

For `configure`, `decode`, `open`, and `notices`, a bare function is a `(baseFunction) => newFunction` factory; use
`{ replace: fn }` to replace directly or introduce an absent optional function. Object members merge one level;
arrays replace as a whole. Auth overrides may only narrow policy; widening fails `adapter_invalid: policy_widened`.
The result records the full `extends` chain in `inspect()`.

## Recording fixtures and running conformance in CI

`adapterConformance(adapter, { dialect, fixtures })` from `@arnilo/prism-driver-process/testing` runs the kernel
driver suite plus adapter-specific checks: recorded replay, unmapped capture, declared fail-closed response, unknown
RPC request, abort within grace, resume strategy, hosted acknowledgements, and rate limits. It imports separately so
production imports never load testing code.

Record a fixture from one live run with `recordFixtures` from `@arnilo/prism/testing`: `recordFixtures.command`
returns a tee wrapper argv to set as the adapter's binary, and `recordFixtures.finish` writes a redacted fixture
file. The binary itself is never modified. Then run the suite in the host's CI:

From `packages/drivers/process/src/__tests__/guide-samples.test.ts`:

```ts
import { adapterConformance } from "@arnilo/prism-driver-process/testing";

const result = await adapterConformance(minimal, {
  dialect: "jsonl-stream",
  fixtures: { config: (cli) => ({ binary: cli.command[0], args: [...cli.command.slice(1)] }) },
});
```

`fixtures.config(cli)` returns the adapter's own config keys that point at the scripted binary. `fixtures.scriptFor(activity)`
can return raw steps when the dialect's `frames` cannot map a neutral activity, and `fixtures.home` supplies the
actual hook, skill, and MCP paths the strict-isolation check plants. A command-hook dialect that prints a deny with
exit zero must supply `hook.allowed({ exitCode, stdout })` so the fake binary honors that response. Failures throw
`AdapterConformanceError` with the failing `leg`; unavailable legs return a skip reason.

`packages/drivers/process/src/__tests__/external-host.test.ts` is the template for a host's CI: it links the kernel
and the package into a temporary workspace, checks that every import is a public specifier, resolves the kernel
through its `exports` (not `src`), and runs `adapterConformance` once. `packages/drivers/process/src/__tests__/reference-adapters.test.ts`
spawns `examples/adapters/conformance.ts`, which runs the suite for all three reference adapters.

## Worked mappings (non-normative)

> Worked mappings are non-normative research, verified on 2026-10-11 against the linked sources and re-checked on
> 2026-10-12. Vendor binaries and terms change. These mappings are not legal advice, and the adapter's author is
> responsible for complying with the vendor's terms (roadmap §2.12.16).

The research dates from 2026-10-04 (roadmap §2.12.4, §2.12.5, §2.12.7, §2.12.11). Plan 166 Task 1 re-verified it on
2026-10-11; this page re-read the rows it marked unverifiable on 2026-10-12. Each reference adapter implements one
shape offline, against the neutral scripted binary:

| Shape | Reference adapter | Transport | Gating | Resume |
| --- | --- | --- | --- | --- |
| A: flag-configured stream CLI | `examples/adapters/stream-cli.ts` | `jsonl-stream` | relay `PreToolUse`, rewrite | `store` |
| B: JSON-RPC app server | `examples/adapters/rpc-server.ts` | `json-rpc` | server approval requests | `vendor` |
| C: workspace-file stream CLI | `examples/adapters/workspace-config.ts` | `jsonl-stream` | relay `PreToolUse`, printed deny | `vendor` |

### Claude Code (shape A)

Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless](https://code.claude.com/docs/en/headless),
[hooks](https://code.claude.com/docs/en/hooks), [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
Verified 2026-10-11; `--resume`, `--session-id`, and exit 143 re-read 2026-10-12.

| Spec field | Mechanism |
| --- | --- |
| `systemPrompt.replace` / `.append` | `--system-prompt-file` / `--append-system-prompt-file` (2026-10-11). |
| `prismTools` | `--mcp-config` with `--strict-mcp-config` naming the broker's MCP server (2026-10-11). |
| `builtinTools` | `--tools` and `--disallowedTools` (2026-10-11). |
| `skills` | A generated plugin through `--plugin-dir` (2026-10-11). |
| `subagents` | `--agents` (2026-10-11). |
| `model`, `effort` | `--model`, `--effort` (2026-10-11). |
| `limits` | `--max-turns`, `--max-budget-usd` (a client-side estimate on a subscription) (2026-10-11). |
| Gating | `PreToolUse` command hook through the relay (`allow` / `deny` / `ask` / `defer`, `updatedInput`); `--permission-prompt-tool` for the rest; `--permission-prompts host` (2026-10-11). |
| Continue at stop | `Stop` hook to `run.end` (2026-10-11). |
| Isolation | `CLAUDE_CONFIG_DIR`; `--setting-sources user`, `--strict-mcp-config`, explicit `--tools` (2026-10-11). Never `--bare` (drops the subscription) or `--dangerously-skip-permissions`. |

Capture: text and thinking deltas; tool calls; skill activation (`source: "tool"`); sub-agents nested by
`parent_tool_use_id` with `--forward-subagent-text`; plans; file changes; compaction; usage and a cost estimate;
`system/api_retry` categories as notices; anything else raw. Resume archives the transcript `.jsonl` after each turn
and resumes with `--resume <absolute .jsonl path>` (re-verified 2026-10-12). `--session-id` takes a UUID. SIGTERM
exits with code 143; SIGINT ends the current turn (re-verified 2026-10-12).

Terms: "The Claude Code binary must not be modified"; customers "may not pay for, resell, or intermediate Claude
usage on their end users' behalf"; developers "may not collect, store, or intermediate Claude.ai credentials or
session tokens — sign-in to a Claude account must complete through Anthropic's own flow"; advertised Pro/Max limits
"assume ordinary, individual usage" (2026-10-12).

### Codex (shape B)

Sources: [app-server](https://learn.chatgpt.com/docs/app-server), [auth](https://learn.chatgpt.com/docs/auth).
Verified 2026-10-11; `chatgptAuthTokens` and the `item/` request names re-read 2026-10-12.

| Spec field | Mechanism |
| --- | --- |
| `systemPrompt.replace` / `.append` | `baseInstructions` / `developerInstructions` on `thread/start` (2026-10-11). |
| `prismTools` | `dynamicTools` (experimental) or an MCP server through `config`; `item/tool/call` for the bridge (2026-10-11). |
| `builtinTools` | Not removable; limited by sandbox and approval policy (2026-10-11). |
| `skills` | A generated root through `skills/extraRoots/set` (2026-10-11). |
| `subagents` | Not supported (2026-10-11). |
| `model`, `effort` | Model and reasoning effort on `thread/start` (2026-10-11). |
| `limits` | Kernel wall-time and tool-round limits (2026-10-11). |
| Gating | Server requests answered over JSON-RPC: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` (2026-10-11; `item/` prefix re-confirmed 2026-10-12). |
| Continue at stop | A new `turn/start` from `run.end` (2026-10-11). |
| Isolation | `CODEX_HOME` plus config overrides (2026-10-11). |

Lifecycle: `initialize` once per connection, then `initialized`; `thread/start`, `thread/resume`, `thread/fork`;
`turn/start`, `turn/steer`, `turn/interrupt` carrying `threadId`/`turnId`; `turn/completed` ends the run
(2026-10-11, re-confirmed 2026-10-12). `dynamicTools` is experimental and requires `capabilities.experimentalApi = true`
(2026-10-12). Resume uses `thread/resume` in the profile's `CODEX_HOME`; the driver archives `thread/read` output for
search. `codex exec --json` is rejected: no approvals, steering, or instructions.

Auth: `codex login` (or `--device-auth`), or app-server `account/login/start` with `type: "chatgpt"` or
`"chatgptDeviceCode"`; an `apiKey` mode; and the experimental `chatgptAuthTokens` for hosts that own the ChatGPT auth
lifecycle (re-confirmed 2026-10-12). Credentials live in `CODEX_HOME/auth.json` or the OS keyring
(`cli_auth_credentials_store = file | keyring | auto | ephemeral`; `CODEX_HOME` defaults to `~/.codex`, re-confirmed
2026-10-12). Status: `account/read` and `codex login status`.

Terms: "If you've built a local or open-source application using Codex app-server authentication, you can continue
using it"; "App-server authentication has never been permitted for commercial or hosted services"; use Sign in with
ChatGPT for those (2026-10-12).

### Antigravity CLI (shape C)

Sources: [headless](https://antigravity.google/docs/cli/headless), [installation and auth](https://antigravity.google/docs/cli/install),
[hooks](https://antigravity.google/docs/hooks), [terms](https://antigravity.google/terms). Verified 2026-10-11;
hooks, install, and terms re-read 2026-10-12.

| Spec field | Mechanism |
| --- | --- |
| `systemPrompt.replace` | The body of a generated `.agents/agents/<name>.md`, selected with `--agent` (replace semantics to verify) (2026-10-11). |
| `systemPrompt.append` | A generated always-on rule (2026-10-11). |
| `prismTools` | The MCP server in the generated worktree config (2026-10-11). |
| `builtinTools` | The agent frontmatter `tools` list plus generated permission rules (2026-10-11). |
| `skills` | A generated workspace skills directory (2026-10-11). |
| `subagents` | Generated agent files with `subagent: true` (2026-10-11). |
| `model`, `effort` | `--model`, `--effort` (2026-10-11). |
| `limits` | `--print-timeout`, plus kernel limits (2026-10-11). |
| Gating | `PreToolUse` command hook through the relay; `decision` is `allow` / `deny` / `ask` / `force_ask` / `deny_unless_prior_grant`, with no input rewrite (2026-10-12). |
| Continue at stop | `Stop` hook returning `decision: "continue"` (2026-10-12). |
| Isolation | Worktree `.agents/` overlay; home relocation is still to verify (2026-10-12). |

Stream: input `{ "event": "user", "message": { "content": … } }`; output `init`, `step_update`, and `result`
(`conversation_id`, `status`, cumulative `usage` including `thinking_tokens`). Thinking text is not in the stream,
only its token count, so the descriptor declares `thinking: "tokens-only"`. Skill activation is a `view_file` with
`IsSkillFile` (re-confirmed 2026-10-12). Sub-agents stream `subagent_info` with no inner steps, so capture is
summary-only. A new prompt waits for the previous turn's `result`; closing stdin ends the session after the current
turn. Resume uses `--conversation <id>` in the CLI's own store.

Auth: a local silent keyring sign-in (re-confirmed 2026-10-12), or a Gemini API key with `modelProvider: "gemini"` in
`~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY` (re-confirmed 2026-10-12). No relocatable-home
variable is documented, so account mode stays local-only and isolation comes from the worktree overlay.

Terms: "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using
the Service in connection with products not provided by us. Using third party software, tools, or services to access
the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement" (2026-10-12). A local run of
the user's own installed, signed-in binary is the case the headless docs describe; hosted or commercial use needs
Google's written confirmation, and a Gemini API key works in every deployment.

## Security and performance notes

- **Cost.** One process is probed at setup and one is spawned per run, even for a short turn. `capture: "all"` emits
  one `agent.raw` event per unmapped frame, increasing event and storage cost; the default `capture: "mapped"` counts
  them and emits one notice. A `store` adapter writes an archive per completed turn; `none` avoids that write.
- **Trust.** Adapters are trusted host code. Opaque transcript content carries no provenance, so a `store` adapter
  must select conversation data without reading credential files. Configured secrets are redacted before persistence.
- **Fail closed.** Gating runs through the relay, which blocks when Prism is unreachable. HTTP hooks are for
  observation only, because a vendor may treat their failure as non-blocking.
- **Isolation.** Strict by default. A `workspace-files` adapter writes only into the bound worktree, and a strict run
  without one fails. Overlays go through `RunDirectory.overlay`, which owns the Git exclude block.
- **Limits.** The process line cap is 1 MiB. At most 256 notification or result frames may wait for consumption.
  Unknown methods and throwing handlers fail the run and are never retried.

## Related APIs

- [drivers](drivers.md): the kernel driver kit this package builds on.
- [testing](testing.md): `createScriptedCli`, `recordFixtures`, and the scripted dialects.
- [hooks](hooks.md): the `tool.call` hook a gated call fires.
- [loop](loop.md): the loop slot the driver fills.
- [events](events.md): `agent.*` events and `agent.raw`.
