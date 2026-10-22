# Prism Agent

A private reference host for testing and proof. It shows that a realistic headless, multi-agent host can be built from published packages and public APIs alone, and it finds SDK gaps before the 0.13.0 freeze. It is **not an API**: its agents, prompts, and config belong to it and can change at any time. Hosts copy from it; they never depend on it.

The walkthrough below follows the roadmap's host layout rule (§2.13.1): the SDK kernel, native packages and host libraries, and the host each own a different kind of decision.

## Where things go

| Layer | In this repo | A thing belongs here when |
| --- | --- | --- |
| **SDK kernel** (`@arnilo/prism`) | the loop, hooks, slots, sessions, store, events, host port, driver kit | the default loop or the package system cannot work without it |
| **Native packages and host libraries** | `tools-coding`, `tools-research`, `memory-*`, `approval`, `workflows`, `driver-process`, `remote`, `headless`, `acp`, `channels` | any harness or host could want it, whatever the product |
| **The host** | `apps/prism-agent/` — which agents exist, their package sets, the workflow and gates, routing, vendor adapters, deployment | it is an opinion about one product |

Nothing sits between the host and the SDK. The host imports only `@arnilo/prism`, its public subpaths, and published packages; a repo test (`reference_host_imports_only_public_surface`) fails closed on anything else, including the retired flat 0.12 names.

## The agents and their packages

Every agent is one `createAgent` call with a package list. The host code for each agent lives in `src/host/`:

| Agent | Source | Why it has these packages |
| --- | --- | --- |
| orchestrator | [`src/host/orchestrator.ts`](src/host/orchestrator.ts) | `workflows` for the graph, `delegate` for a research child, and one `definePackage` that registers the host's `build` command |
| coding | [`src/host/coding.ts`](src/host/coding.ts) | `tools-coding` to edit the workspace, `approval` to gate writes, `context-files` and `hooks-json` for repo context, and both memory packages |
| research | [`src/host/research.ts`](src/host/research.ts) | `tools-web`, `tools-browser`, `memory-rag`, and `tools-research` (the citation ledger and `run.end` check) |
| external | [`src/host/external.ts`](src/host/external.ts) | a host-owned adapter over `driver-process`, for a vendor CLI the host does not control |
| remote | [`src/host/remote.ts`](src/host/remote.ts) | `connectAgent`, reaching a worker served from a second process |

The coding worker, in full shape:

```ts
import { createAgent } from "@arnilo/prism";
import { approvalPackage } from "@arnilo/prism-approval";
import { sqliteStore } from "@arnilo/prism-store-sqlite";
import { toolsCoding } from "@arnilo/prism-tools-coding";

const agent = await createAgent({
  name: "coding",
  model: config.models.coding,
  principal: { kind: "user", id: "prism-agent" },
  ownership: { tenantId: "prism-agent", userId: "prism-agent" },
  slots: { compaction: "@arnilo/prism-memory-compaction" },
  packages: [
    sqliteStore({ path: config.storePath }),
    toolsCoding({ root: config.workspace, principal: { id: "prism-agent" } }),
    approvalPackage({ mode: config.approval }),
  ],
});
```

Both memory packages claim the `compaction` slot; the explicit `slots` assignment is the SDK's conflict resolution, not a workaround. The orchestrator registers the build graph as a host command, not a model-visible tool:

```ts
import { createAgent, definePackage } from "@arnilo/prism";
import workflows, { workflowCommand } from "@arnilo/prism-workflows";

const orchestrator = await createAgent({
  name: "orchestrator",
  model: config.models.orchestrator,
  packages: [
    workflows,
    definePackage({
      name: "@prism-agent/build-command",
      version: "0.0.0",
      requires: { api: 1 },
      setup: (prism) => {
        prism.commands.register(workflowCommand(prism, "build", () => buildWorkflow(config, workers)));
      },
    }),
  ],
});
```

Config is refs, paths, and modes only ([`src/host/config.ts`](src/host/config.ts)):

```jsonc
{
  "models": {
    "orchestrator": { "provider": "anthropic", "model": "claude-sonnet-4" },
    "coding": { "provider": "anthropic", "model": "claude-sonnet-4" },
    "research": { "provider": "openai", "model": "gpt-5" }
  },
  "storePath": ".prism/sessions.db",
  "workspace": ".",
  "approval": "ask",
  "web": { "backend": "brave", "apiKey": "env:PRISM_WEB_API_KEY" },
  "gate": { "command": ["bun", "test"] },
  "external": { "binary": "claude" },
  "schedule": { "tz": "UTC", "brief": { "cron": "0 9 * * *", "prompt": "Write the morning brief." } }
}
```

`web.apiKey` is a reference (`env:` or `keyring:`), never a literal. The host passes a literal through so the package's own ref-only check rejects it — the config loader does not re-implement that check.

## The workflow graph

[`src/host/workflow.ts`](src/host/workflow.ts) is one declarative graph: a research brief, a `fanOut` across the coding, external, and remote workers, a deterministic `gateNode`, a `humanGate`, and a report. No engine lives in the host.

```ts
import { agentNode, defineWorkflow, fanOut, gateNode, humanGate } from "@arnilo/prism-workflows";

const graph = defineWorkflow({
  id: "prism-agent.build",
  revision: "1",
  limits: { maxSupersteps: 24 },
  nodes: {
    brief: agentNode({ agent: workers.research, input: () => "Write the research brief." }),
    slices: fanOut({
      items: () => ["coding", "external", "remote"],
      route: (item) => agentNode({ agent: sliceAgent(workers, item), input: () => `Implement the ${String(item)} slice.` }),
    }),
    tests: gateNode({ activation: "any", check: () => runGateCommand(config), onFail: "coding", maxIterations: 2 }),
    signoff: humanGate({ request: { kind: "confirm", title: "Ship the change?" }, onFail: "tests" }),
    report: agentNode({ agent: workers.research, input: () => "Write the report and cite the ledger." }),
  },
  edges: [
    ["brief", "slices"],
    ["slices", "tests"],
    ["tests", "coding"],
    ["coding", "tests"],
    ["tests", "signoff"],
    ["signoff", "report"],
  ],
});
```

The gate is a fixed argv from config, never a shell string and never model output. Exit 0 passes; a throw or a non-zero exit is a failed gate, and the `tests → coding → tests` back edge owns the retry (bounded by `maxIterations`). The host starts the graph by running its own `build` command on the orchestrator's session (`agent.commands.run("build", {}, { session })`); the graph is not a model-visible tool.

## External and remote workers

The **external worker** runs a vendor CLI through a host-owned adapter. `createProfiles` must run first — a run without a lease fails `profile_invalid` — and the agent lists the store and the driver package, with no `loop:` or `store:` field:

```ts
import { createProfiles } from "@arnilo/prism/driver-kit";
import { adapterDriver, processDriver } from "@arnilo/prism-driver-process";

await createProfiles({ root: profilesRoot, driver: adapterDriver(hostStreamCli) }).create("external", {
  mode: "key",
  principal: "prism-agent",
});

const agent = await createAgent({
  name: "external",
  packages: [sqliteStore({ path: config.storePath }), processDriver(hostStreamCli)],
});
```

The **remote worker** is a second Bun process (`bin/remote-worker.ts`) that serves one agent over stdio with `serveAgent`. The host connects with `connectAgent` and lends its own `HostUi` and store:

```ts
import { connectAgent } from "@arnilo/prism-remote";

const agent = await connectAgent(
  {
    kind: "stdio",
    command: [process.execPath, REMOTE_WORKER_BIN],
    env: { PRISM_AGENT_CONFIG: configPath },
  },
  { host: { ui }, mirror: store, endpointId: REMOTE_ENDPOINT },
);
```

**Attribution.** Tools the remote process runs are gated by the remote's policy, so their events carry `origin.remote` and `executedBy: "external"` and never claim the host's gate. The host's own `tool.call` hook sees no event for them, which is how the scenarios prove the boundary. The host store mirrors the remote session one entry per completed message.

## HostUi routing

[`src/host/host-ui.ts`](src/host/host-ui.ts) routes every human request — an approval, a selection, a free-text input, a notice, a terminal request — through `routeHostUi`: the attached client, then a paired channel, then the fail-closed policy default.

```ts
import { policyDefault, routeHostUi } from "@arnilo/prism-headless";

const ui = routeHostUi([
  { name: "client", ui: client, kinds: ["confirm", "select", "input", "notify", "terminal"] },
  { name: "channel", ui: channel, kinds: ["confirm", "select", "input"] },
  policyDefault(),
]);
```

`secret` is in neither list: the credentials slot owns it, so no route ever sees a secret value. A request no route answers suspends the run durably, and an answer from any route resumes it. The answer log records route, kind, and status only — never a value.

## Scheduling

[`src/host/schedule.ts`](src/host/schedule.ts) declares fixed targets over the store's `checkpoints` and `leases` services. Cron strings and prompts come from config, never model output.

```ts
import { createScheduler } from "@arnilo/prism-headless";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";

const persistence = createSqlitePersistence({ filename: config.storePath });
const scheduler = createScheduler({
  checkpoints: persistence.checkpoints,
  leases: persistence.leases,
  ownership: { tenantId: "prism-agent", userId: "prism-agent" },
  targets: { brief: { kind: "agent", agent: research, input: config.schedule.brief.prompt } },
});
await scheduler.schedule({ id: "brief", target: "brief", cron: config.schedule.brief.cron, tz: "UTC" });
```

Scheduler and target agents share one ownership scope; the scheduler refuses a target in another. A `schedule.build` target starts the build workflow command. Missed firings follow the configured `skip` or `run-once` policy. The `schedule` command runs until `SIGTERM` or `SIGINT` and exits 0.

## Entry points

[`bin/prism-agent.ts`](bin/prism-agent.ts) dispatches four commands:

```bash
prism-agent run [--agent orchestrator|coding|research] [--config <file>] [--session <id>] <prompt>
prism-agent resume --session <id> [--config <file>] [--agent <name>] [--decision <approvalId>=allow|deny]...
prism-agent acp [--agent orchestrator|coding|research] [--config <file>]
prism-agent schedule [--config <file>]
```

`--config` defaults to `./prism-agent.json` and must name a file. Credential values stay refs in that file; they are not accepted on the command line.

`run` writes each kernel `AgentEvent` as one JSON line, then a final `{"type":"prism-agent.exit","code":N}`. The host does no redaction or reshaping: the JSONL is the kernel's own event catalog. A research run then calls `research.verify` and folds the citation verdict into the exit code.

| Code | Meaning |
| --- | --- |
| 0 | Completed |
| 1 | The run failed |
| 2 | Usage or config error, including a `createAgent` rejection |
| 3 | Suspended. The pending approval ids are in the kernel events, not a host object |
| 4 | A completed research run whose `research.verify` verdict is `failed`. `pending` is not 4 |

Precedence is `2 > 3 > 1 > 4 > 0`. `resume` without `--agent` uses the session actor written at `run`.

`acp` speaks ACP over stdio only, for manual interactive testing from an ACP-capable editor. A Zed `settings.json` entry:

```jsonc
{
  "agent_servers": {
    "Prism Agent": {
      "command": "bun",
      "args": ["/abs/path/to/prism/apps/prism-agent/bin/prism-agent.ts", "acp", "--config", "/abs/path/prism-agent.json"]
    }
  }
}
```

The host has no TUI and depends on no terminal UI library; the editor owns the other half of the stream.

## Running the scenarios offline

The scenarios are deterministic and network-free. They run with the package suite:

```bash
bun run --filter @arnilo/prism-agent test
```

The same leg runs in `release:gate` after the client-neutrality check, and `run-all-tests` picks the app up through the workspace glob. Every scenario uses the mock provider and scripted CLIs; a missing fixture fails the test rather than skipping it. The suite is also asserted to contain no `test.skip` and to read no secret environment variable.

| Scenario | What it proves |
| --- | --- |
| orchestrated workflow | the graph runs end to end, each worker's events carry the right `origin`, and a failed gate takes its back edge once |
| approval | the coding worker's write is denied or allowed by the host's answer |
| external worker | vendor-CLI events carry `executedBy: "external"` and never reach the host gate |
| remote worker | remote events carry `origin.remote` and `executedBy: "external"`, the session is mirrored, and the remote approval is answered by the host's `HostUi` |
| headless approval | a run suspends, a channel answers, and a fresh process resumes and completes |
| scheduled run | a firing fires once per tick across two processes, under both missed policies |
| one-shot JSONL | the event stream matches a golden file |
| research citations | every cited source resolves to a ledger entry, and an unresolved citation fails `run.end` |
| secrets | a credential ref never reaches the event stream, and a literal is rejected by the package |

**The gap log.** A seam the host needs and the SDK lacks is never worked around. It is either added to the SDK inside the task that found it, or recorded in the Phase 12 plan's `## Gap log` table with the disposition `fixed in <file> (<test>)` or `backlog: <title> — <reason>`. Phase 12 is not done while a row is open, and a grep over `apps/prism-agent/` must find no workaround (a type-erasing `any` cast, a reach into package internals, or reimplemented package logic). The log is currently empty: every Phase 12 scenario is expressible with what the SDK ships.
