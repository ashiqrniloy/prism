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
| coding | [`src/host/coding.ts`](src/host/coding.ts) | `tools-coding` to edit the workspace, `approval` to gate writes, `context-files` and `hooks-json` for repo context, `context-engineering` for fold/accounting, and both memory packages (plus `memory-wiki` when `ontology` is on) |
| research | [`src/host/research.ts`](src/host/research.ts) | `tools-web`, `tools-browser`, `memory-rag`, `tools-research` (the citation ledger and `run.end` check), and the same fold/accounting with a 20% block cap |
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

`web` accepts every `tools-web` backend name (`brave`, `exa`, `firecrawl`, `obscura`, `native`, `searxng`,
`tavily`, `kagi`), plus `searxngOrigin` for a self-hosted instance, and three optional blocks passed
straight to the package:

| Field | Type | Description |
| --- | --- | --- |
| `web.fetch` | `{ backend?: "native" \| "firecrawl" \| "off", apiKey?: ref }` | The fetch half when `backend` is a keyed search backend. Unset means the package default, the keyless `native` backend, so the research worker can read what it searches for. |
| `web.domains` | `{ allow?: string[], block?: string[] }` | Host-enforced hostname permission for search results and every fetch path. This is the host's policy, not a model argument: the research worker cannot widen it. |
| `web.cache` | `{ ttlSeconds: number, maxEntries?: number, maxBytes?: number }` | Opt-in per-session page cache. Off unless present; entries are dropped when the session closes and never persisted. |

The config loader validates types and unknown keys and leaves range checks to the package, which
fails the package load with a field-naming error. The research worker's approval allow-list stays
`web_fetch`, `web_search`, `rag_search`, `cite`, and Obscura's native `obscura_fetch`/`obscura_scrape`
stay unregistered (`nativeTools: false`), so a host that configures Obscura gets the same two web
tools as every other backend.

## Memory

`memory: "conversational"` (off by default) installs `@arnilo/prism-memory-fabric` on the research and
coding workers with the conversational preset. The preset archives each completed exchange verbatim,
injects recalled exchanges for the turn's task, enables `memory.recall`/`memory.read`, and makes no
write-path model or embedding call; retrieval is lexical. `memory.recall` and `memory.read` join the
research worker's prompt-free allow-list; `memory.forget` and the other writes still ask.

`memory: "coding"` selects the coding preset: the same exchange archive and read tools, plus a
standing-decision kind. A user turn with a lasting-rule cue (`from now on`, `always`, `we decided`,
`use X instead of Y`, `no, do X`) is captured as a **proposed** decision and never silently active;
the host UI asks once to confirm it, and use across two sessions can also activate it. Active project
decisions take the pinned-core slice (decisions first, then preferences), and path-scoped decisions
reach the turn through at most three path cues. The option makes no decision-model or other
generative write call; a decision model is opt-in plan 202 Task 12.

`ontology: true` (off by default, and an error without `memory`) adds `@arnilo/prism-memory-wiki` beside the
fabric on the research and coding workers. A background pass then consolidates the fabric's notes into
concepts that cite them, `memory.recall` returns a matching concept before the plain notes, and
`wiki_ingest` stages sources under the same `tools.root` as the fabric. The pass is extra model calls:
it runs on `ontologyModel` (a model ref, never a key) when the config names one and on the worker's own
model otherwise. The host adds the package and nothing else; the pass, the concepts and their
deletion cascade live in the packages. The tier is unmeasured, which is why it is not the default.

The markdown store lives under `<dirname(storePath)>/memory`, inside the host's data directory, and
the fabric jails it to that `tools.root`. Exchanges are shared by every session on one store: the
fabric takes its tenant from `scopes.tenantId` (default `prism`) and its user scope from a fixed
`user` resource id, not from the session principal. A host that serves several principals therefore
keeps one store, and one tenant, per principal. The option is a storage decision, which is why the
default is off; plan 202 owns the safety verdict.

## Context management

Both workers size their gates from one table, [`src/host/context-budgets.ts`](src/host/context-budgets.ts).
A key is `provider/model`; the number is the effective input budget measured by plan 194 Task 6, and
the entry's comment names its evidence file.

| Model | Measured budget | Fold batch (`clearAtLeastTokens`) | Compaction trigger | OM `compactAt` |
| --- | ---: | ---: | --- | --- |
| `opencode-go/mimo-v2.5` | 96,000 | 9,600 (10%) | `threshold_tokens` 96,000 | `{ ratio: 0.6, maxTokens: 96,000 }` |

An unlisted model gets `input_ratio` 0.6 of its input cap, the package's 4,096-token fold batch, and
one `info` status note per agent. The coding worker uses the `coding` compaction profile; the research
worker uses `default` and caps injected blocks at 20% of the input cap. Add a measured row before a
release pins a new model.

The fold rewrites old tool results only when the pending batch reaches `clearAtLeastTokens`, so the
provider prefix holds between batches. Cost: one cache miss per fold batch and one per compaction
(the compaction slot's summary call, or the kernel's deterministic compactor); requests between
those points reuse the prefix.

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

## Gating a host release on evals

`evals/dataset.ts` and `src/evals/suite.ts` evaluate the coding and research workers with `@arnilo/prism-evals` across 12 items (`dev` and `heldout` splits, `trials: 4`, `timeline: "metadata"`), scoring `approval_before_effect` (using `agent.tools`), `citation_integrity`, `createStateMatchScorer` over the workspace files, and `task_success` (including `web_fetch` prompt-injection items built from `createInjectionDataset`).

```ts
import { assertEvaluationThreshold } from "@arnilo/prism-evals";
import { loadHostEvalBaseline, reconstructReportFromRecord, runHostEvalSuite } from "./src/evals/suite.js";

const baseline = loadHostEvalBaseline();
const report = await runHostEvalSuite();

assertEvaluationThreshold(report, {
  requireInvariants: true,
  minimumPassHatK: {
    task_success: { k: 4, minimum: 0.9 },
    state_match: { k: 4, minimum: 0.9 },
  },
  maximumRegression: {
    baseline: reconstructReportFromRecord(baseline),
    delta: 0.05,
  },
});
```

`src/__tests__/evals.test.ts` checks invariants, `pass^4`, dataset content-hash parity, and regression against `evals/baseline.json` on every `bun run test` and `bun run release:gate` run without rewriting the baseline. To update `evals/baseline.json` deliberately after a dataset or scorer change, run `bun run --filter @arnilo/prism-agent eval:baseline`. The opt-in `release/eval-gate` row in `scripts/live-matrix.json` runs the `heldout` split against Hyper (`PRISM_LIVE_EVAL_GATE_MANUAL=1`) under a 2M input-token ceiling and appends the `ExperimentReportRecord` to the SQLite experiment store.
