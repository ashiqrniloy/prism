# Review coverage — 2026-07-20 Phase 4

Working evidence for Plan 072 Task 0. This page freezes revised Phase 4 scope, source/external revisions, primitive ownership, finite-limit targets, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-20. **Prism source:** `0d109989b4892e3fe4378ab782044ceadc460277` (`Release 0.0.8`). **Release target:** 0.0.9. **Default test rule:** local fakes and fixtures only; Docker/Playwright execution is a separate protected gate.

## Revised product decision

0.0.9 contains production coding and browser execution only. Office document execution is host-selected skill/instruction work outside Prism packaging. Prism will not ship `@arnilo/prism-work-tools/officecli`, an OfficeCLI binary/SDK/wrapper, Office-specific runtime contracts, generic Office MCP/CLI passthrough, Office tests/docs, or an Office release gate. This is a removed product criterion, not deferred 0.0.9 implementation.

Cloud Microsoft 365 and Google Workspace connectors remain a separate later roadmap decision. They cannot depend on or imply local OfficeCLI execution.

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task extends an existing optional package/contract. |
| `new-package` | New optional package; core remains dependency-free. |
| `compose` | Existing public primitives are sufficient; only example/docs or package-local glue may be needed. |
| `removed` | Deliberately outside Prism product/release scope. |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | [`0d109989b4892e3fe4378ab782044ceadc460277`](../plans/072-release-0-0-9-production-coding-and-browser-execution.md) | All primitive/caller claims below were checked against the 0.0.8 release tree. |
| Node.js | Local reference `v24.18.0`; Prism release support remains Node 20 and current | Use `node:child_process`, `node:fs`, streams, `AbortSignal`, `URL`, crypto hashes, and path APIs only. Node 20/current tests own compatibility. |
| Playwright | [`playwright-core@1.61.0`](https://github.com/microsoft/playwright/tree/v1.61.0), npm integrity `sha512-caX7TrY3Ml6egyDX0WUcTHDxodl/b51y5wJOdCEA36QviK/s2g081hvmGs8eaE3DWb6NYZQ6BjO/QkNRPenoPA==` | Task 5 tests this exact compatibility line. Browser binary remains host supplied; package install performs no browser download. Only documented Browser/BrowserContext/Page/Locator/Download APIs are allowed. |
| Playwright context/locator/snapshot/network docs | [BrowserContext](https://playwright.dev/docs/api/class-browsercontext), [Locator](https://playwright.dev/docs/api/class-locator), [locators](https://playwright.dev/docs/locators), [ARIA snapshots](https://playwright.dev/docs/aria-snapshots), [network](https://playwright.dev/docs/network), retrieved 2026-07-20 | Non-persistent contexts; role/label/test-id and snapshot refs before CSS; `ariaSnapshot({ mode: "ai" })`; service workers blocked when routing must observe requests. Request routing is defense in depth, not DNS containment. |
| Docker CLI/Engine | Local reference client/server `29.6.1`; [container run](https://docs.docker.com/reference/cli/docker/container/run/), [resource constraints](https://docs.docker.com/engine/containers/run/), [default seccomp](https://docs.docker.com/engine/security/seccomp/), retrieved 2026-07-20 | Task 1 uses an absolute host-selected Docker executable, digest-pinned preloaded image, `--pull=never`, typed arguments, read-only root/source, finite tmpfs workspace, non-root user, dropped capabilities, default seccomp, no-new-privileges, and network none. Exact supported-version floor follows tested flag preflight; 29.6.1 is reference evidence. |
| Git | Local reference `git version 2.55.0`; [official manuals](https://git-scm.com/docs), retrieved 2026-07-20 | Task 3 uses porcelain/plumbing argument arrays: `status --porcelain=v2 -z`, `diff --no-ext-diff --no-textconv`, `check-ref-format`, `worktree`, `apply --check`, `commit`, and `bundle`. Exact supported-version floor follows fixture/live conformance; 2.55.0 is reference evidence. |

No Office executable, SDK, repository, schema, or version is pinned because Office execution is outside the release boundary.

## Capability traceability matrix

| Revised roadmap criterion | Current surface | Minimum 0.0.9 gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Disposable read-only-base sandbox; writable bounded workspace; deny-default network; CPU/memory/PID/disk/time/secret/termination controls | `SandboxAdapter.exec(command)` maps only shell operations; coding tools have local operation seams | Typed process/lifecycle/import/export Docker reference with real limits and cleanup | `extend` / Task 1 | fake CLI matrix plus protected filesystem/network/process/resource escape tests | `coding-security.md`, `host-security.md`, `performance.md` | protected Docker gate + offline adapter tests |
| Native bounded repository list/search | `createReadOnlyTools()` contains only `read`; read already has path, byte, line, image, abort bounds | Streaming stdlib list/search and sandbox operation wiring | `extend` / Task 2 | traversal/search ordering, symlink, binary, regex, byte/time/abort tests | `coding-agent-tools.md`, `performance.md` | offline coding conformance |
| Structured Git status/diff/branch/worktree/patch/commit | Shell can invoke Git but has coarse operation policy | Typed arguments, bounded parsers/results, safe repo config, rollback, artifacts | `extend` / Task 3 | hostile path/ref/config/hook, dirty-tree, rollback, worktree tests | `coding-agent-tools.md`, `coding-security.md` | offline Git conformance + protected sandbox |
| Named test/lint/typecheck/security commands and diagnostics | Shell operation backend, output accumulator, execution policy, progress events | Host-declared name → fixed executable/args map; bounded summaries/artifacts | `extend` / Task 3 | unknown name, fixed args/env, timeout/output/secret tests | `coding-agent-tools.md`, `performance.md` | offline command conformance |
| Durable plans/todos/checkpoints/approvals/background branches/restart | Workspace files; `CheckpointStore`; workflow state/suspend/resume/coordinator/leases/events | Reference composition and immutable workspace artifact metadata; no second runtime | `compose` / Task 4 | restart/revision/owner/hash/lease/cancel/stale-worker matrix | `workflows.md`, `coding-agent-tools.md` | offline durable workflow journey |
| Host-owned PR creation | No repository host API; workflow results can return bounded data | PR handoff metadata + patch/bundle reference only | `extend` / Task 3, composed by Task 4 | deterministic bounded handoff; prove no push/network/credential use | `coding-agent-tools.md`, `workflows.md` | offline handoff conformance |
| Four Playwright browser tools with one run-owned isolated context and ordered actions | Core tool dispatch/exclusive flag, execution policy, guardrails, run identity; no browser package | Optional package and finite context/page/snapshot/action manager | `new-package` / Task 5 | fake API lifecycle, isolation, stale-ref, ordered-action, cleanup tests | `browser-automation.md`, `tools.md` | package/pack/install + protected Playwright |
| Browser egress/side-effect/artifact policy | Execution/permission policy, guardrails, path containment, `ImageContent`, redaction | Context routing + host firewall/proxy requirement; upload/download/screenshot quarantine | `new-package` / Task 6 | redirects/private/DNS/service-worker, approval, artifact, secret tests | `browser-automation.md`, `host-security.md` | protected egress/browser gate |
| Adversarial coding/browser evals and reproducible benchmarks | `@arnilo/prism-evals`, network-free fixtures, current benchmark/live workflow patterns | Package datasets, one 0.0.9 benchmark, protected real gate | `extend` / Task 7 | deterministic score thresholds and benchmark schema/cleanup | `evaluations.md`, `performance.md` | default eval gate + protected live gate |
| 0.0.9 package/docs/release evidence | 31-package 0.0.8 graph and deterministic release pipeline | Add at most browser package; version/docs/pack/install/audit evidence | `extend` / Task 8 | `sdk:ready`, Node 20/current, pack/install, supply chain, release dry-run | `release-and-install.md`, `migration.md` | complete 0.0.9 release gate |
| OfficeCLI/Office package/runtime/tests/docs/release criterion | Roadmap-only proposal; no current package | None | `removed` / product decision | docs assertion: absent from Phase 4/package graph/release checklist | this page, `roadmap.md` | explicit absence check |

## Primitive and caller inventory

| Primitive | Existing contract/callers at frozen revision | Phase 4 disposition |
| --- | --- | --- |
| `ToolDefinition` / tool dispatch | `src/contracts.ts` defines name/schema/static `exclusive`/execute; `src/tools.ts` applies registry filter, trust, permission, validation, `beforeExecute`, guardrails, run-limit charge, events, ledger, and redaction. Coding, web, MCP, workflows, providers, examples, and tests consume it. | Reuse for list/search/Git/check/browser tools. Browser tools set static `exclusive: true` and also queue per run. No browser-specific dispatch runtime. |
| `ExecutionPolicy` | String-extensible `ExecutionAction.kind`, operation/paths/command/risk/metadata and allow/modify/deny check in `src/execution-policy.ts`; coding tools enforce immediately before operations; workflow tool nodes can define actions and durable approval. | Reuse. Add package-local `git`, `check`, and `browser` action kinds/metadata; no core enum or approval engine. Policy is authorization, not containment. |
| `PermissionPolicy` / trust | `src/security.ts`; `dispatchToolCall` and resource loading check host policies before execution/load. MCP/supervisor/extensions also consume permission/trust contracts. | Reuse at dispatch/resource boundaries. Do not duplicate permission logic in sandbox/browser managers. |
| Guardrails / redaction | `src/tools.ts` runs tool-input/output guardrails and redacts results/events/ledger; `src/agents.ts` handles agent/provider stages. | Reuse for untrusted repository/browser content. Secrets remain host-known redactor inputs; sandbox/browser internals must redact before errors/artifact metadata too. |
| `RunLimits` / `RunLimitTracker` | Defaults/hard caps in `src/run-limits.ts`; runtime charges turns, provider attempts, tool rounds/calls, wall time, request/response bytes, tokens, cost. MCP/workflow types accept limits. | Reuse for total agent work. Package-local external-resource limits below charge before work/retention; no expansion of `RunLimits` until another domain needs identical counters. |
| `CheckpointStore` / leases | Generic owner-scoped versioned CAS/fencing contract; memory, SQLite, PostgreSQL, agent lifecycle/state, workflows, and schedules consume it. | Reuse for durable workflow metadata. Store artifact URI/hash/bytes and summaries, never repository/browser state blobs or credentials. |
| Workflow state/suspend/coordinator | Workflow revision hash, bounded state/history/checkpoints, tool approval suspension, background enqueue, lease renewal/fencing/cancel, finite coordinator concurrency/pages. | Compose coding plan/todo files and branch artifact references. No `CodingRun`, todo DB, scheduler, or second workflow engine. |
| Coding operation backends | `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`; local defaults; `SandboxAdapter` currently maps shell only. | Task 1 extends coding-security with typed `execFile`/lifecycle; Task 2 wires bounded repository operations. Preserve current custom/local contracts unless tests prove one shared addition is required. |
| `withFileMutationQueue` | Process-wide map keyed by resolved realpath; used by write/edit; serializes same real path and releases on error. | Reuse for local same-path mutation. Git disposable worktree/patch transaction owns multi-file rollback; do not turn queue into transaction manager. |
| `ResourceLoader` | Optional load/list with abort, trust, permission; bounded binary helper exists; inputs/contributions/extensions consume it. | May rehydrate a host-owned immutable artifact reference. It is not an artifact store, workspace transport, browser downloader, or network-containment bypass. Task 1/3 use narrow host callbacks for export. |
| `ImageContent` / media bounds | Core content contract; coding read returns bounded images and can require host transform. | Reuse for bounded screenshots. Browser package enforces pixel/encoded-byte caps before returning content; no new image type. |
| Agent/workflow events | Tool progress/start/finish/error/block, guardrail/limit events, workflow ordered events and finite buffers. | Reuse for diagnostics/progress/cleanup evidence. No coding/browser event bus or hook registry. |
| `@arnilo/prism-evals` | Immutable datasets, bounded experiments/concurrency, function scorers, trace/judge/comparison/report limits. | Extend with package-local coding/browser datasets/scorers only; no mandatory model/network/service. |
| `SandboxAdapter` | One `exec({ command, cwd, env, onData, signal, timeout })` contract and `createSandboxBashOperations`; no lifecycle, typed arguments, transfer, status, or containment implementation. | Extend in coding-security Task 1. Generic core sandbox contract is not authorized. |

### Primitive decision

No new core primitive is authorized by Task 0.

Authorized package-local work:

1. `@arnilo/prism-coding-security`: minimal typed executable, disposable lifecycle, import/export, status, and cleanup contracts implemented by the real Docker reference. Preserve current `SandboxAdapter.exec` compatibility.
2. `@arnilo/prism-coding-agent`: repository/Git/check/artifact types and operation overrides only where local and sandbox implementations both consume them.
3. `@arnilo/prism-browser`: run/context/action/artifact manager and Playwright types stay entirely optional-package local.

A shared primitive can be promoted later only with two concrete non-test consumers and migration/conformance evidence. One-consumer interfaces, artifact databases, browser planners, Git libraries, proxy/firewall implementations, Office types, and remote worker/control-plane contracts are rejected.

## Frozen capability boundary

| Surface | Supported in 0.0.9 | Explicitly unsupported |
| --- | --- | --- |
| Sandbox | Host-invoked Docker CLI reference; digest-pinned preloaded image; disposable container; finite tmpfs workspace; typed execution; bounded import/export; deterministic cleanup; default network none | Docker daemon provisioning, image build/pull/update, Kubernetes/remote scheduler, bundled image/proxy, host Docker-socket exposure, claim that command policy equals containment |
| Coding | Native list/literal-or-bounded-regex search; structured Git/status/diff/branch/worktree/patch/commit; named fixed checks; workspace plan/todos; rollback/discard; background workflow composition; PR handoff | Language server/index/watch service, arbitrary model-created commands, implicit repo hook execution, GitHub/GitLab authentication/push/PR client, second coding runtime |
| Browser | Four model tools; host-supplied Playwright 1.61-compatible browser; non-persistent context; ARIA snapshot/refs and user-facing locators; bounded screenshots/uploads/downloads/popups/dialogs | `evaluate`, arbitrary JavaScript/CSS/XPath, CDP/devtools, extensions, persistent/local profiles, browser binary download, generic MCP proxy, visual/coordinate planner |
| Network | Network none by default; real browsing only behind host-contained proxy/firewall plus Playwright route checks | DNS rebinding protection by URL regex/routing alone; in-package firewall/proxy; public-network default tests |
| Artifacts | Bounded host callbacks/references/hashes; download quarantine; screenshot `ImageContent`; patch/bundle/PR handoff | Artifact SaaS/database, unrestricted host paths, checkpointing credentials/storage state/full workspace, automatic upload/push |
| Office | Host-selected skills/instructions may guide external user-owned work | Any Prism Office executable, SDK, wrapper, package, protocol, tool, test, doc page, binary, or release gate |

## Frozen finite limits and charging points

Values are target defaults / hard caps for Tasks 1–7, not active 0.0.8 APIs. Existing stricter limits remain authoritative. Validate host configuration before starting work; charge count/declared bytes before each operation and stream-count actual bytes before retention/export.

### Sandbox and workspace

| Resource | Default / hard cap | Charge/check point | Failure and cleanup owner |
| --- | --- | --- | --- |
| Startup / run wall / idle | 30 s / 120 s; 20 min / 30 min; 5 min / 15 min | Before create; absolute deadline starts before Docker invocation; idle resets only on accepted operation | Task 1 stops, then kills and removes recorded container |
| CPU / memory+swap / PIDs | 2 / 8 CPUs; 2 GiB / 16 GiB; swap equal to memory; 256 / 1,024 PIDs | Validated before `docker run`; enforced by container/cgroup flags | Task 1 aborts run on limit exit and cleans container |
| File descriptors | 1,024 / 8,192 | Validated before `docker run`; `nofile` ulimit | Task 1 |
| Workspace / temp / download tmpfs | 1 GiB / 8 GiB; 256 MiB / 2 GiB; 64 MiB / 512 MiB | Size option validated before create; kernel tmpfs cap enforces writes | Task 1/6 discard on overflow |
| Commands / concurrent exec | 100 / 256; 1 / 8 | Before queue/start; total also remains under run tool-call/wall limits | Task 1 rejects/aborts; close drains finite queue then kills |
| Command output | existing 64 MiB / 1 GiB total; model result spill remains separately bounded | Stream byte count before append/write | Coding output accumulator + Task 1 termination |
| Environment/secrets | 64 names / 256; 64 KiB / 256 KiB aggregate values | Validate exact host allow-list before create/exec; inherit none | Task 1 redacts errors and never exports environment |
| Import/export | 50,000 / 250,000 entries; 256 MiB / 2 GiB bytes; 16 / 64 retained artifacts | Count headers/entries and stream bytes before write/retain; verify real path/type/hash | Task 1 aborts export, removes partial host artifact, source remains unchanged |
| Stop grace / forced cleanup | 5 s / 30 s; one stop then one kill; cleanup deadline 30 s / 120 s | Terminal/abort/timeout/lease loss/browser crash | Task 1 records unresolved cleanup as release-blocking error |

### Repository, Git, checks, and durable work

| Resource | Default / hard cap | Charge/check point | Owner |
| --- | --- | --- | --- |
| Repository depth / entries / files | 32 / 128; 10,000 / 100,000; 10,000 / 100,000 | Before descending/retaining next entry/file | Task 2 |
| Search scan/file/matches | 64 MiB / 1 GiB aggregate; 8 MiB / 64 MiB per file; 1,000 / 10,000 matches | Prefix/binary check then stream bytes; check aggregate before next file/match | Task 2 |
| Search pattern/line/context/time | 512 / 4,096 UTF-8 bytes; 50 KiB / 1 MiB line; 5 / 20 context lines; 30 s / 300 s | Before regex compile; before line/context retention; absolute deadline | Task 2 |
| Repository concurrency | 8 / 32 open/read workers | Before opening next directory/file | Task 2 |
| Git paths/refs/message | 1,000 / 10,000 paths; 1 KiB / 4 KiB ref; 64 KiB / 256 KiB commit message | Validate before process/temp-file creation | Task 3 |
| Git output/diff/patch | 4 MiB / 64 MiB inline output; 10,000 / 100,000 diff lines; 1,000 / 10,000 changed files; 16 MiB / 64 MiB patch input | Stream before retain; spill only through bounded artifact callback | Task 3 |
| Worktrees/background runs | 4 / 16 per parent run; coordinator default remains 4 and hard cap 256 | Before create/lease claim; exact branch/root ownership recorded | Task 3/4 |
| Named checks | 8 / 32 names per host config; 1 / 4 concurrent; 10 min / 60 min each; 2,000 / 100,000 diagnostic lines; 4 MiB / 64 MiB inline output | Validate config at construction; charge before start/line retention | Task 3 |
| Workflow state/checkpoint/history | Existing 64 KiB / 512 KiB state; 1 MiB / 8 MiB checkpoint; 32 / 128 history revisions | Existing workflow adapter checks before save | Task 4 |
| Workspace checkpoint artifacts | 16 / 64 references; 256 MiB / 2 GiB each, also sandbox export aggregate | Hash/size verify before checkpoint metadata/import | Task 4 with host artifact owner |
| Plan/todo and PR handoff | 256 KiB / 1 MiB plan; 1,000 / 10,000 todos; 256 KiB / 1 MiB handoff JSON | Before write/checkpoint/result exposure | Task 4 / Task 3 handoff |

### Browser

| Resource | Default / hard cap | Charge/check point | Owner |
| --- | --- | --- | --- |
| Contexts/pages/actions/queued actions | exactly 1 context per run; 4 / 16 pages; 100 / 256 actions; 16 / 64 queued | Before context/page/action/queue creation; invalidate refs on mutation | Task 5 |
| Snapshot refs/depth/bytes | 2,000 / 10,000 refs; depth 30 / 100; 256 KiB / 2 MiB encoded YAML | Before retaining each ref/node and before result exposure | Task 5 |
| Navigation/action/wait/run time | 30 s / 120 s navigation; 10 s / 60 s action; 30 s / 120 s explicit wait; sandbox 20 min / 30 min run | Absolute deadline before Playwright call; no timeout retries unless action budget charged | Task 5 |
| Popups/dialogs/listeners | 4 / 16 popups; 16 / 64 dialogs; 64 / 256 registered listeners | Before accepting/retaining; deterministic deny/dismiss after cap | Task 5/6 |
| Network requests/redirects/WebSockets | 1,000 / 10,000 requests; 10 / 32 redirects/request; 8 / 32 WebSockets | Before route continuation/redirect/socket acceptance | Task 6; host firewall/proxy owns actual egress |
| Screenshots | 16 / 64 megapixels; existing 10 MB / 32 MiB encoded image cap; 16 / 64 per run | Validate clip/viewport before capture and bytes before result/artifact | Task 6 |
| Uploads | 8 / 32 files; 16 MiB / 64 MiB each; 64 MiB / 256 MiB aggregate | Realpath/type/size/approval before Playwright receives path | Task 6 |
| Downloads | 8 / 32 files; 32 MiB / 256 MiB each; 64 MiB / 512 MiB aggregate | Stream to quarantine with count/hash; approval before export | Task 6 |
| Browser cleanup | 5 s / 30 s close grace, then sandbox kill; 0 retained context/storage-state objects | Abort, terminal run, explicit close, browser crash, lease loss | Task 5 manager and Task 1 sandbox |

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default/unsupported behavior |
| --- | --- | --- | --- | --- |
| Docker daemon/executable/image | Host operator supplies absolute CLI, daemon, digest, non-root image UID and policy | Model/repository/container output | Typed args; preflight; `--pull=never`; no socket/device/privileged/host namespaces; labels/recorded IDs | Missing/mutable/untrusted input fails before create; daemon compromise is outside Prism containment |
| Source/workspace import/export | Host selects source and artifact callback | Paths, links, repository entries, archive headers/content | Read-only source; finite tmpfs; realpath/type checks; no devices; stream bounds; hash; atomic partial cleanup | No direct write-back; failed run discards workspace |
| Process/environment/secrets | Host declares named checks and exact env allow-list | Model command text, repo scripts/config/hooks, process output | Typed exec for first-party tools; shell explicit; inherited env empty; noninteractive Git; redaction; limits | Unknown command/check/env denied; no implicit hooks/credentials |
| Network/DNS | Host firewall/proxy/network policy | URLs, redirects, DNS, page scripts/service workers/WebSockets | Network none default; isolated proxy/firewall for browse; route validation and service-worker block in depth | No proxy attestation means no external browser network; private/local/file/devtools denied |
| Playwright/browser endpoint | Host owns pinned browser launch/control endpoint | Pages, DOM/a11y text, refs, popups, downloads | One non-persistent context/run; short-lived host-only endpoint; ordered actions; no evaluate/CDP/profile | Endpoint/browser mismatch fails construction; import is inert |
| Side effects/approval | Host `PermissionPolicy`, `ExecutionPolicy`, workflow approval | Model/page instructions and action metadata | Dispatch permission/guardrails then immediate operation policy; high-impact durable approval | Page text cannot authorize; denial produces bounded stable result |
| Browser storage/secrets | Host injects at context/request edge | Cookies/storage state/page content/errors | Never return/persist/log storage state; redact known secret canaries; close context | No local profile; no checkpointed browser internals |
| Upload/download/screenshot | Host roots, artifact callback, approval | Filenames, MIME, bytes, page pixels, symlinks | Realpath containment; quarantine; stream/pixel/byte caps; hashes; explicit release | Overflow/unknown type stays quarantined then deleted |
| Durable checkpoint/resume | Host-owned checkpoint/lease/artifact stores and ownership scope | Persisted metadata, stale workers, artifact URI/content | CAS/fencing; workflow revision; image/tool/policy fingerprints; artifact hash/size; current approval | Wrong owner/revision/hash/fence fails before import/action |
| Office work | User/host-selected external skill/tool | Office files/commands | Outside Prism runtime | No package, executable, schema, docs, test, or release claim |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every retained Phase 4 criterion above has one primary owner Task 1–8; cross-task composition is explicit. Removed Office criterion has product-decision owner and no implementation task. |
| Primitive reuse | No new core primitive. Package-local additions have concrete local+sandbox or coding+browser consumers where shared; otherwise remain in owning package. |
| Finite resources | Every external start/read/write/retain/queue/export path above has default/hard caps, pre-charge point, abort behavior, and cleanup owner. |
| Security claims | Sandbox containment is Docker/host policy, not regex; browser DNS containment is host proxy/firewall, not Playwright routing; daemon, image, credentials, network, artifacts, and approvals stay host-owned. |
| Scope absence | Revised roadmap Phase 4, package ledger, persona outcomes, and release checklist contain no OfficeCLI/Office runtime/package gate. |

## Documentation and release ownership

- Task 1: `docs/coding-security.md`, `docs/host-security.md`, `docs/performance.md`, protected Docker gate.
- Tasks 2–4: `docs/coding-agent-tools.md`, `docs/workflows.md`, `docs/evaluations.md`, offline coding/Git/durable-workflow gates.
- Tasks 5–6: new `docs/browser-automation.md`, plus tools/guardrails/security/performance docs, package/install and protected Playwright gate.
- Task 7: eval, benchmark, and protected-gate evidence — completed network-free coding/browser adversarial fixtures (`eval-fixtures.test.ts`), `scripts/benchmark-0.0.9.mjs` (+ schema test), protected Playwright live matrix, expanded Docker protected matrix, and `.github/workflows/sandbox-browser.yml`.
- Task 8: migration/release docs, package graph, Node/pack/install/supply-chain/release dry-run evidence — completed 32-package exact `0.0.9` graph (`@arnilo/prism-browser` in `prism-all` only), finalized docs/changelogs/migration/release handoff, dated `benchmark-0.0.9` evidence, and release-candidate gates recorded in Plan 072.

No public implementation API changed in Task 0. This page and `roadmap.md` are the authoritative pre-implementation boundary; later tasks may tighten defaults but cannot raise hard caps or broaden authority without updating tests, docs, and this evidence.
