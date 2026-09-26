# Phase 125 — Bun-only runtime contract (evidence)

Plan [125](../../plans/125-Bun-Only-Runtime-Contract.md) flips the **consumer** contract from
`engines.node >=22` to `engines.bun >=1.4.2`. Plan [124](../../plans/124-Bun-Only-Toolchain-And-Test-Runner.md)
made the contributor toolchain Bun-only; this plan moves the published packages.

## 1. Task 1 — `engines` flip across the 12 publishable manifests (2026-09-25)

Host: bun 1.4.2, node v26.10.0, npm 12, 16 CPUs.

### 1.1 What changed

Every publishable manifest (root + 11 workspaces) replaced `"engines": { "node": ">=22" }` with
`"engines": { "bun": ">=1.4.2" }` — one shape, byte-identical across the twelve files:

| Manifest | `engines` before | `engines` after |
| --- | --- | --- |
| `package.json` (root) | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/acp-agent` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/ag-ui` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/hooks` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/mcp` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/memory` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/prism-channels` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/prism-coding-tools` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/prism-core` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/prism-providers` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/prism-work` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |
| `packages/web-tools` | `{ "node": ">=22" }` | `{ "bun": ">=1.4.2" }` |

`packageManager: "bun@1.4.2"` (plan 113) already pins the contributor side, so the declared floor and
the pinned manager agree at 1.4.2. `scripts/phase12-freeze-manifest.json` — the 0.1.x support-matrix
era record — is deliberately **not** edited; its `support.node.enginesRange: ">=22"` now describes
the era, and `scripts/phase12-freeze.test.mjs` asserts the record keeps that value *and* that the
live manifests carry the Bun contract instead.

Scaffold templates (`templates/*/package.json.tmpl`) still declare `engines.node`: plan 125 Task 3
owns scaffold output and is where they flip (a scaffold's runtime is its host's, and Task 3 also
removes the engines guess entirely).

### 1.2 Install-side probe — `engines.bun` is declarative only (the trade-off)

Probed with a throwaway package (`p125-engines-probe@1.0.0`, `engines.bun >=99.0.0`, packed with
`npm pack`), installed into two empty consumers:

```
$ npm install --no-audit --no-fund ./p125-engines-probe-1.0.0.tgz
added 1 package in 1s                     # no EBADENGINE, no warning

$ bun add ./p125-engines-probe-1.0.0.tgz
bun add v1.4.2 (744846f84)
installed p125-engines-probe@…tgz
1 package installed [60.00ms]            # no engines warning either

$ bun install                            # root package with engines.bun >=99.0.0
bun install v1.4.2 (744846f84)
No packages! Deleted empty lockfile
[35.00ms] done                           # exit 0, no warning
```

**Decision (recorded, per Task 1 acceptance).** Dropping `engines.node` removes the npm `EBADENGINE`
warning a Node host used to get; adding `engines.bun` does **not** replace it, because neither npm
nor Bun 1.4.2 enforces a `bun` engines key (npm does not know the key, Bun ignores it for both the
root package and dependencies). `engines` is therefore *advisory documentation* here, not a control —
which the plan already accepted ("`os`/`cpu`-style hard `engines` enforcement does not exist for bun
fields"). The compensating control is the fail-closed import, not the install warning.

The import-side shape today (pre-plan-126) is that nothing is Bun-dependent yet, so a Node host
running these packages gets no error at all — the declaration is honest about a dependency the code
does not have until plan 126 lands `bun:sqlite`. Node's raw failure for that import is not
actionable:

```
$ node -e "import('bun:sqlite').catch(e => console.log(e.code, e.message))"
ERR_UNSUPPORTED_ESM_URL_SCHEME Only URLs with a scheme in: file, data, and node are supported by the
default ESM loader. Received protocol 'bun:'
```

**Message text to implement (plan 126 Task 2, at the sqlite driver's entry point):**

```
@arnilo/prism requires the Bun runtime (engines.bun >=1.4.2): the durable storage layer imports "bun:sqlite".
Run this program with `bun` (https://bun.sh), or pin a Node-compatible Prism release (0.11.x or earlier).
```

Plan 126 Task 2 owns the rewrite (it is the task that introduces the `bun:` import); this task records
the text so the two changes agree. No 0.12.0 tarball reaches the registry before plan 129's cut, so
the declaration-only window is not user-visible.

### 1.3 CI consequence — the two declared Node legs retired

`engines.node` was the only reason `release.yml` carried a Node leg, so the flip retires them
(plan 124's Compromises named this task as the retirement point):

| Site | Before | After |
| --- | --- | --- |
| `release.yml` `verify` | `actions/setup-node@8207627…` (Node 24) + `node scripts/public-import-smoke.mjs` | deleted; the job runs `bun ci` + `bun run sdk:ready` only |
| `release.yml` `node22-compat` | whole job: checkout + setup-node 22 + `bun ci` + `bun run build` + the Node 22 smoke | job deleted |
| `release.yml` `publish` | `needs: [verify, node22-compat, postgres-integration, office-validation, codeql-release, supply-chain]` | `needs: [verify, postgres-integration, office-validation, codeql-release, supply-chain]` |
| `scripts/public-import-smoke.mjs` | the Node import sweep | deleted with its two call sites |

The only Node left in any workflow is the release-host registry toolchain (`npm pack`/`npm publish`/
`npm sbom` in `publish`, each carrying its comment), which is plan 125 Task 5's boundary.

Gate reconciliation (era record untouched, checks moved):

| Gate | Before | After |
| --- | --- | --- |
| `scripts/phase12-freeze.test.mjs` | `enginesRange === root.engines.node`; release.yml must contain `node-version: "22"`/`"24"` | `enginesRange === ">=22"` (record) + root declares `engines.bun` and no `engines.node`; release.yml must contain **no** `node-version`/`actions/setup-node` |
| `scripts/workflow-liveness.test.mjs` | only `release.yml` may set up Node, exactly the 22/24 legs; the two smoke steps are the only `node` executions | no workflow may set up Node; no workflow step executes `node` |
| `src/__tests__/docs.test.ts` | compat job named from the live manifest floor; `setup-node` SHA pin; smoke-script pins; compat job in the `needs:` string | no Node setup/version in the workflow; five-job `needs:` string; the era floor now read from the freeze manifest for the page's era wording |
| `src/__tests__/supply-chain-security.test.ts` | `needs:` regex built from the live manifest floor | literal five-job `needs:` regex |
| `scripts/phase24-truth.test.mjs` | workspace `engines.node` lockstep | `engines.bun` lockstep **and** no `engines.node` anywhere |
| `scripts/packaging-current.test.mjs` | — | new: every publishable manifest declares `engines.bun >=1.4.2` and no `engines.node` (Task 1 test case) |

`docs/release-and-install.md` gets the minimal honest pass here (the runtime matrix gains a Bun row and
marks the Node row retired in 0.12.0; the release-workflow/CI paragraphs drop the two legs; the
`@types/node` rationale now tracks the *published* 0.x line). Plan 125 Task 4 owns the full rewrite
(install table, history move, release-host row).

### 1.4 Verification (2026-09-25, host load ~2)

| Check | Command | Result |
| --- | --- | --- |
| manifests parse + one shape | `json.load` over the 12 manifests; `grep -c engines` | 12/12 parse, one `engines` block each |
| build | `bun run build` | EXIT 0 |
| root suite | `bun test --parallel=4 --timeout=0 dist/__tests__/*.test.js` | EXIT 0 — 2121 tests, 167 files, 1 skip, 0 fail (48 s) |
| gate suite | `bun test --parallel=4 --timeout=0 <45 GATE_FILES>` | 289 tests, 2 skip, 4 fail — all pre-existing in-flight rows (biome diagnostics in `packages/prism-core/src/runtime/workflows/**`, phase54 map ×2 export drift, compat baseline stale) |
| task-owned gates | `phase12-freeze` 11/0 · `phase24-truth` + `workflow-liveness` + `packaging-current` 73/0 · `docs` + `supply-chain-security` + `release` dist 273/1 (the phase54 row) | no new failures |
| manifest-truth gates | `version-literal-gate`, `truth-current`, `tooling-gate`, `import-hygiene`, `plan-review-gate`, `phase23-skip-manifest`, `phase15/20-freeze`, `phase38-codeql`, `phase27-release` | no new failures (phase27-release ×3 and phase20 ×2 are the pre-existing tree rows) |

### 1.5 Security

`engines` is advisory install metadata: no credential path, trust boundary, gate threshold, or
published export changed. The era support record (`scripts/phase12-freeze-manifest.json`) is
unmodified — the flip is expressed by asserting the record *and* the live contract, never by
rewriting history. The retired Node legs were the only CI steps that executed `node` outside the
release-host registry toolchain, and removing them removes an unsupported-runtime path rather than
adding one.

## 2. Task 2 — the consumer simulation is Bun (2026-09-25)

Host: bun 1.4.2, node v26.10.0, npm 12, 16 CPUs (load ~2). Tarballs always come from `npm pack`
(the release-host registry toolchain); everything downstream of the tarball runs on Bun.

### 2.1 Surfaces converted (one consumer simulation, no npm consumer leg)

| Surface | Before | After |
| --- | --- | --- |
| `scripts/packaging-current.test.mjs` | `npm install --offline` canary for the root tarball only | `Bun consumer: every packed tarball installs, imports, and answers one call` — all 12 tarballs, one consumer, one `bun install`, one `bun -e` sweep |
| `scripts/fixtures/packed-consumer.mjs` (shared by 5 e2e/journey suites + host composition) | `npm install … --offline`, `process.execPath` resolve probe | `bun install … --offline`, `bun -e` resolve probe |
| `src/__tests__/host-composition-compat.test.ts` | family tarballs installed by npm, contract run through `process.execPath` | installed by Bun, contract + Task 5/7 fixtures run with `bun` **by name** (never `process.execPath`); pinned-old-family leg installs on Bun too, env gates and skip-on-unavailable unchanged |
| `src/__tests__/install-smoke.test.ts` | 12 tarballs + `@ai-sdk/provider` installed by npm | same install on Bun (its peer-window `ERESOLVE` sibling test stays npm on purpose — it asserts npm's resolver policy, not our runtime) |
| `scripts/post-publish-smoke.mjs` | registry/local specs installed by npm | `bun install … --prefer-offline` |
| `scripts/phase26-coding-journey.test.mjs` | `npm install --no-save playwright-core@1.63.0` (live leg) | `bun add --no-save playwright-core@1.63.0` (probed: consumer manifest untouched) |
| `docs/testing.md` | replay comment "installed with `npm --offline`" | `bun install --offline`, plus the cold-cache sentence |

No npm *install* remains in a consumer leg. The remaining `npm` in tests is `npm pack`/`npm ls`
(tarball producer + registry metadata) and `src/__tests__/cli-init.test.ts`'s generated-scaffold
install, which plan 125 Task 3 owns with the scaffold commands.

### 2.2 `bun install --offline` — measured limits (why the retry exists)

`--offline` needs a cached **manifest** for every range it must resolve; a cache warmed by an
ordinary install does not provide them:

```
$ bun install --offline --no-audit --no-fund <12 tarballs>        # empty cache
EXIT=1  error: --offline: no cached manifest for "@arnilo/prism" (run once online, or use --prefer-offline)

$ # CI simulation: fresh cache, `bun install --frozen-lockfile` over the repo (137 packages, 16s)
$ bun install --offline --no-audit --no-fund <12 tarballs>        # same fresh cache
EXIT=1  39 errors, first: error: --offline: no cached manifest for "@ag-ui/core" …
```

So every converted leg is **offline first, `--prefer-offline` on failure** — the pre-existing
npm-era cold-cache pattern, now stricter (cache first instead of an unrestricted install). The
first-party guarantee is not weakened: the retry fetches *third-party* metadata only, and every
`@arnilo/*` resolution is asserted to point at the packed tarball:

```
$ grep -c '"@arnilo/prism[a-z-]*": \["@arnilo/prism[a-z-]*@<staging>/' bun.lock
12        # all twelve first-party packages resolved from the packed tarballs, never the registry
```

Measured install cost (Performance criterion, one recording): warm-cache `--offline` **148 ms**
(test leg) / 241 ms (probe); cold-cache `--prefer-offline` **7.77 s** for the same 12 tarballs +
69 packages.

### 2.3 Import sweep — every public export of every package on Bun 1.4.2

`bun -e` from the consumer: for each installed `@arnilo/*` package, import every key of its
`exports` map, then make one call per package. Transcript (tarballs packed from this tree):

```
call @arnilo/prism                 @arnilo/prism                                -> true
call @arnilo/prism-core            @arnilo/prism-core/runtime/server            -> true
call @arnilo/prism-memory          @arnilo/prism-memory                         -> 5
call @arnilo/prism-providers       @arnilo/prism-providers/openai               -> "@arnilo/prism-providers/openai"
call @arnilo/prism-coding-tools    @arnilo/prism-coding-tools/agent             -> "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebea…
call @arnilo/prism-work            @arnilo/prism-work/documents                 -> "&lt;b&gt;&amp;"
call @arnilo/prism-web-tools       @arnilo/prism-web-tools                      -> "https://example.com/a?b=1"
call @arnilo/prism-channels        @arnilo/prism-channels                       -> 32768
call @arnilo/prism-mcp             @arnilo/prism-mcp                            -> "mcp:srv:"
call @arnilo/prism-hooks           @arnilo/prism-hooks                          -> 3
call @arnilo/prism-ag-ui           @arnilo/prism-ag-ui                          -> 65536
call @arnilo/prism-acp-agent       @arnilo/prism-acp-agent                      -> "probe"

import sweep: 110 public subpaths across 12 packages, 0 registry copies, 0 failures
subpaths per package: @arnilo/prism(26) @arnilo/prism-acp-agent(1) @arnilo/prism-ag-ui(3)
  @arnilo/prism-channels(3) @arnilo/prism-coding-tools(7) @arnilo/prism-core(19) @arnilo/prism-hooks(1)
  @arnilo/prism-mcp(1) @arnilo/prism-memory(9) @arnilo/prism-providers(23) @arnilo/prism-web-tools(6) @arnilo/prism-work(11)
positive control (@arnilo/prism/definitely-not-a-subpath): rejected
```

This is the successor to the retired Node 22 `public-import-smoke` guarantee (which covered only
the root package's 26 targets): the sweep now covers **all 110 public subpaths of all 12
packages**, from packed tarballs, on Bun. The same sweep currently also passes on Node — expected,
because nothing in the tree imports a `bun:`-only module yet; the declaration is enforced the
moment plan 126's `bun:sqlite` driver lands (Task 1's decision record). The gate fails closed
either way: an unknown subpath must not resolve, and the sweep exits non-zero on any failure.

### 2.4 Verification (2026-09-25)

| Check | Result |
| --- | --- |
| `bun test --timeout=0 scripts/packaging-current.test.mjs` | 41 pass / 0 fail, 10.2 s (install leg: 12 tarballs in 148 ms, `offline`) |
| `dist/__tests__/host-composition-compat.test.js` | 3 pass / 1 skip (env-gated pin leg) / 0 fail, 4 s |
| `dist/__tests__/install-smoke.test.js` | 15 pass / 0 fail, 24 s (Bun install of 12 tarballs + `@ai-sdk/provider`) |
| `scripts/e2e-full-surface.test.mjs` / `e2e-enterprise-journey` / `e2e-coding-journey` | 5/0, 3/0, 3/0 — 19 s / 10 s / 6 s on the Bun consumer |
| `bun scripts/post-publish-smoke.mjs --local` | PASS (local tarballs), 4 s |
| root suite (`bun test --parallel=4 --timeout=0` over 167 dist files) | 2121 tests / 1 skip / 0 fail, 52 s |
| `bun scripts/phase12-freeze.test.mjs`, `workflow-liveness`, `packaging-current`, `tooling-gate`, `import-hygiene` | green (Task 1 set unchanged) |
| full gate stage (45 `GATE_FILES`, `--parallel=4`) | 289 tests / 2 skip / 4 fail — all pre-existing classes: biome diagnostics in `packages/prism-core/src/runtime/workflows/**` (in-flight work), the phase54 package-map pair (live export drift), and the multi-agent fan-out speedup floor under host load (passes solo). One earlier run also failed six `e2e-full-surface` legs with `npm error code EOF … dist/providers/media.d.ts` — a concurrent `tsc` rewriting `dist` while the journey packed it (re-run green); that race is pre-existing and the gate holds no build lock for the journey's own `npm pack`. |

### 2.5 Security

Offline-first installs; the cold-cache retry fetches third-party metadata only and the consumer
lockfile proves every first-party package came from the packed tarball. No credential value enters
a command line, log, or fixture; the sweep reads only `package.json` exports maps and the
consumer's own `node_modules`. Tarball contents are unchanged (`npm pack --dry-run` byte checks
still pass — the pack list tests were untouched).

## 3. Task 3 — scaffolds and hint strings emit Bun commands (2026-09-25)

### 3.1 What changed

| Surface | Before | After |
| --- | --- | --- |
| `src/cli-init.ts` (init hints) | `  npm install` / `  npm test` | `  bun install` / `  bun test` |
| `src/cli-init.ts` (README next steps) | `Run \`npm start\`` (live and mock variants) | `Run \`bun run start\`` |
| `src/cli-provider-add.ts` | `  npm install` / `  npm test` | `  bun install` / `  bun test` |
| `src/cli-dev.ts` | `npm install --save-dev @arnilo/prism-coding-tools` | `bun add --dev @arnilo/prism-coding-tools` |
| `packages/prism-coding-tools/src/dev/cli.ts` | "missing dependency in the scaffold (run npm install)" / "build the project first (npm run build)" | `bun install` / `bun run build` |
| `templates/{init,provider,business-worker,deep-research,personal-assistant}/package.json.tmpl` | `"test": "npm run build && node --test …"`, `"start": "npm run build && node dist/index.js"`, `"engines": { "node": ">=20" }` | `"test": "bun run build && bun test …"`, `"start": "bun run build && bun dist/index.js"`, `"packageManager": "bun@1.4.2"`, **no** `engines` |
| 5 × template `README.md.tmpl` + 2 optional example headers | `npm install` / `npm test` / `npm start` / `npm run dev` | `bun install` / `bun test` / `bun run start` / `bun run dev` (provider README: `bun add <pkg> @arnilo/prism`) |
| 9 provider/work live-suite headers + `drawio-live`, observational-memory hint | `// \`npm test\` and CI release verification never set these…` | `// \`bun run test\` …` (the stale `-w @arnilo/prism-compaction-observational-memory` hint became a real path) |
| `examples/README.md`, `examples/cyclic-reflection.ts`, `examples/obscura.ts` | `npm test` / `npm install @arnilo/prism` / `npm install @arnilo/prism-web-tools` | `bun run test` / `bun add …` |
| 12 chain-prose comments/labels (`run-all-tests.mjs` summary label, `with-build-lock.mjs`, `truth-current`, `phase23-build-race`, `phase24-truth`, `phase25-bounded-accumulation`, `phase26-coding-journey`, `phase27-release`, `budget-gate`, `usage-calibration-live`, `phase23-quality-gates`, `live-matrix.json` notes, `docs.test.ts` messages) | "npm test chain" wording | "bun run test" wording |

The scaffold's `pack-tarball` step stays `npm pack --dry-run` in the provider template: `npm pack`
is the release-host registry toolchain (plan 125 Task 5), not a contributor command.

### 3.2 Generated scaffold on Bun — transcript

```
$ bun <repo>/dist/cli.js init demo --provider mock
Created Prism project in /tmp/p125scaffold/demo
  provider: mock
  files: 8
  bytes: 3340

Next:
  cd demo
  bun install
  bun test

$ cat demo/package.json          # excerpt
  "type": "module",
  "packageManager": "bun@1.4.2",
  "scripts": {
    "test": "bun run build && bun test dist/__tests__/agent.test.js",
    "start": "bun run build && bun dist/index.js",
    …
  }                              # no "engines" key at all

$ cd demo && bun install --offline --no-audit --no-fund
4 packages installed [89.00ms]
$ bun run typecheck
$ tsc -p tsconfig.json --noEmit                     # EXIT=0
$ bun run test
$ bun run build && bun test dist/__tests__/agent.test.js
dist/__tests__/agent.test.js:
(pass) generated agent > runs offline with the mock provider [10.03ms]
 1 pass / 0 fail
$ bun run start
Hello from Prism
```

The generated README's Setup block is `bun install` / `bun test` and its next-steps line is
``Run `bun run start` (mock provider; no network or credentials).``

### 3.3 Retired-string census

Sweep: `rg -n "npm (install|test|start)\b" src packages examples scripts docs templates` (excluding
`node_modules`/`dist`). 392 hits in 124 files, every one flipped or attributed:

| Bucket | Files / hits | Disposition |
| --- | --- | --- |
| Frozen era evidence (`scripts/phase*-baseline.json`, `phase*-freeze-manifest.json`, retired `phase*-freeze.test.mjs`, `CHANGELOG.md`, `docs/_evidence/**`, `docs/history/**`) | 74 / 285 | **Excluded by the plan** — immutable release evidence; editing it would rewrite recorded history |
| Docs pages + package READMEs (consumer install instructions, e.g. `docs/core.md`, `docs/cli-rpc.md`, `packages/prism-core/README.md`) | 41 / 86 | **Attributed to the docs pass** (plan 125 Task 4 owns the contract pages; the rest are the same sweep — further action below) |
| Pinned surface label `core npm test` (`release-skip-manifest.mjs` + `phase23-skip-manifest.test.mjs`) | 2 / 6 | **Attributed** — the label is asserted by `phase23-skip-manifest.test.mjs:116/:178`; renaming it is a separate evidence-format change, not a scaffold hint |
| The new gate's own fixtures (`tooling-gate.test.mjs`) | 1 / 3 | **Attributed** — planted strings that must fail the scan |
| Parser/negative-assertion prose (`workflow-liveness.test.mjs`'s "`npm test` alias", `docs.test.ts`'s `npm install` (bare prism) negative scan and the `run: npm test` workflow guard) | 2 / 3 | **Attributed** — the parsers deliberately accept the npm form; the assertions are negatives |
| Fixture DATA, not instructions (coding-compaction demo prompt, memory compaction prompt fixtures, guardrail-pack shell-command fixtures) | 4 / 9 | **Attributed** — `npm test` is arbitrary payload content (a guarded command, a chat message), not a command a user is told to run |
| **Flipped by this task** | — | CLI hints, 5 template manifests, 7 template READMEs/comments, 9+3 live-suite headers, 3 examples, 12 chain-prose files, and the scaffold tests |

`npm i better-sqlite3` (the plan-113 hint plan 126 retires) has **zero** live hits: the only
`better-sqlite3` references left are the driver import in `scripts/drill-migration-rollback.mjs`,
benchmark/fixture imports, the peer row in `docs/release-and-install.md`, and plan-review tokens.

### 3.4 New gate: `scripts/tooling-gate.test.mjs`

`scaffolds and hint strings emit Bun commands only` scans every `src/cli-*.ts` plus every
`templates/**/*.tmpl` (≥30 files asserted, so the surface set cannot go empty) and fails on any
`npm …` line that is not `npm pack|publish|sbom|view` or npm *naming-rule* prose
(`npm-validated`, `npm names`, `npm package`). It carries positive fixtures (allowlisted forms),
negative fixtures (`npm install`, `npm test`, `npm start`, `npm ci`, `npm i better-sqlite3`, an npm
`test` script body) and a non-vacuity assertion that the surfaces really emit `bun install` /
`bun test`. Scaffold tests were extended in the same change: `cli-init.test.ts` asserts
`packageManager`, the absence of `engines`, both Bun script bodies, the printed `bun install` /
`bun test` hint, the README Setup block, and runs the generated project's `bun install` →
`bun run typecheck` → `bun test` chain; `cli-provider-add.test.ts` asserts the same manifest shape,
the `bun add` README line and the printed hint; `cli-dev.test.ts` asserts the `bun add --dev` hint.

### 3.5 Verification (2026-09-25)

| Check | Result |
| --- | --- |
| `bun test --timeout=0 dist/__tests__/cli-{init,provider-add,dev}.test.js` | 27 pass / 0 fail (includes the generated-project Bun chain) |
| `bun test --timeout=0 scripts/tooling-gate.test.mjs` | 8 pass / 0 fail (new gate included) |
| root suite (167 files) | 2122 tests / 1 skip / 0 fail, 31 s |
| gate stage (45 `GATE_FILES`, `--parallel=4`) | 290 tests / 2 skip / **0 fail**, 56 s |
| `bun run build` | EXIT=0 |
| `bun run format:check` | 6 files still red, all in the in-flight Plan 130 work (`examples/cyclic-reflection.ts` + `packages/prism-core/src/runtime/workflows/**`); no Task 3 file is implicated |

### 3.6 Security

Unchanged: no credentials, no network in any scaffold leg, no new dependency, and the generated
project's runtime contract is the host's (`packageManager` only — no engines guess, which is
deliberate: `engines.bun` is advisory and would be a lie for a scaffold that runs wherever the host
runs it). The one npm command left in a scaffold is `npm pack --dry-run`, the release-host registry
op plan 125 Task 5 sanctions.

## 4. Task 4 — docs contract rewrite: Bun runtime matrix, Node story to history (2026-09-25)

### 4.1 What changed

| Surface | Before | After |
| --- | --- | --- |
| `docs/release-and-install.md` install table (23 rows) | `npm install @arnilo/prism …` | `bun add @arnilo/prism …` (incl. the `0.0.12` era row and the tarball import-smoke line) |
| same table, tool rows | `npx --package @arnilo/prism prism init …`, `npx prism-wiki --help`, `npx prism` | `bunx …` forms (probed: `bunx --package <pkg> <bin>` works on 1.4.2) |
| same page, peer paragraph | "install `@arnilo/prism` alongside them or npm will report an unmet peer" | records the probe: `bun add` installs a first-party tarball with **no** missing-peer warning, npm fails closed; the peer is an explicit host contract. The ERESOLVE transcript stays, labelled as recorded npm behavior. |
| same page, support matrix | Bun row + a `Node (retired in 0.12.0)` row carrying the whole Node 22/24 narrative | **Bun `>=1.4.2` (1.4.x tested)** + PostgreSQL, with a "**Node runtime support retired in 0.12.0**" pointer to the archive |
| same page, release workflow bullet | the two-leg Node narrative | one clause + archive pointer, plus the release-host npm exception sentence (`npm pack`/`publish`/`sbom`, `bun pack` missing, `bun publish` without `--provenance`) |
| same page, `@types/node`, release checklist, CI-enforcement paragraphs | Node-leg narrative repeated three times | trimmed to the live facts (published 0.11.x floor, `engines.bun`, retirement pointer) |
| same page, 0.0.16 recorded Node compatibility matrix | inline table | moved to the archive page |
| same page, release commands | `node scripts/release.mjs …` (8 sites), `node scripts/scan-secrets.mjs`, `npx biome migrate --write` | `bun scripts/release.mjs …`, `bun scripts/scan-secrets.mjs`, `bunx biome migrate --write` |
| same page, enforcement row | "CI `node22-compat` also imports every public root `exports` default target on Node 22" | the Bun successor: the packed-consumer sweep imports every public subpath of every package (`scripts/packaging-current.test.mjs`) |
| same page, release section | no npm-exception row | new **Release-host registry toolchain** row in the release checklist |
| same page, install section | no frozen-lockfile/audit guidance for hosts | `bun install --frozen-lockfile` row + `bun audit --audit-level=moderate` sentence |
| `docs/history/retire-node-runtime.md` | — | **new**: the 0.1.x–0.11.x Node story (era matrix row `22, 24` / `engines.node >=22`, the 0.6.0 floor move, the 0.0.16 recorded compatibility matrix, what plans 124–125 changed, the advisory-`engines.bun` probe, the compensating control, and the 0.11.x registry line for Node hosts) |
| `docs/index.md` | "TypeScript/Node.js agent harness"; the 0.6.0 carried-line bullet stated `engines.node` as current; release entry said "install rules" | "TypeScript agent harness for the Bun runtime"; the 0.6.0 bullet marked "(retired in 0.12.0)" with the `engines.bun` successor; the release entry names the Bun install rules and runtime matrix |
| `README.md` | `npm install` ×10, `npx --package … prism init` ×3, `cd my-agent && npm install && npm test`, "TypeScript/Node.js agent harness" | `bun add` ×10, `bunx` ×3, `bun install && bun test`, Bun-runtime intro |
| `docs/peer-dependencies.md` + `scripts/live-doc-check.test.mjs` | 10 matrix rows + 4 examples said `npm i <peer>`; the gate asserted `startsWith("npm i ")` | `bun add <peer>`; the gate now requires a `bun add` install column (lockstep change, as Task 3's further action required) |
| 16 more live pages + 6 package READMEs | install lines | `bun add` (ag-ui, cli-rpc, coding-tools, computer-use-linux, core, dev-inspector, hooks, host-compositions, messaging-channels, obscura, rag, signal-channel, telegram-channel, work-tools, wiki, acp-agent + `packages/{acp-agent,hooks,mcp,memory,prism-core,prism-providers,prism-work}/README.md`) |
| `CHANGELOG.md` | — | `### Removed` bullet under `[Unreleased]`: manifests declare `engines.bun`, `engines.node` gone, both measured Node CI legs retired, install pages moved to `bun add`, advisory-engines probe, plan-126 compensating control, release-host npm exception |
| `docs/migration.md` | two 0.5/0.6-era lines stated the Node floor as current | both marked "(retired in 0.12.0)" with the `engines.bun` successor |
| `docs/history/README.md` | — | lists the new archive page |
| `scripts/package-truth.mjs` | usage comment + emitted block header said `node scripts/package-truth.mjs` | `bun scripts/package-truth.mjs`; the four generated doc blocks and `docs/_evidence/phase54-package-map.md` regenerated with the same generator |
| `src/__tests__/docs.test.ts` | `releaseDoc()` union = release-and-install + release-handoffs; canonical token `node scripts/package-truth.mjs` | union extended to `retire-node-runtime.md` (presence-only, the documented escape hatch for a live→archive split); canonical token flipped; **new test** `live pages carry one Bun install voice and no current Node support claim` |

### 4.2 Verification (2026-09-25)

| Check | Result |
| --- | --- |
| `bun test --timeout=0 src/__tests__/docs.test.ts` (source, no build needed) | **157 pass / 0 fail**, including the new live-page test |
| affected gate batch (`live-doc-check`, `phase12-freeze`, `truth-current`, `version-literal-gate`, `workflow-liveness`, `phase23-skip-manifest`, `import-hygiene`, `tooling-gate`, `run-all-tests`, `plan-review-gate`) | **86 pass / 0 fail** |
| one-grep Bun-only check of `docs/testing.md` + `README.md` (plan 124 Task 6 surfaces) | clean — no `npm install`/`npm test`/`npm run`/`node --test`/`node scripts/` stage runner |
| live-page install census (`npm (install|i) @arnilo/prism`) | **0** across `README.md`, every non-archived `docs/**/*.md`, and every `packages/*/README.md` (asserted by the new test, which also requires ≥50 `bun add` lines so the surface cannot go empty) |
| peer matrix ↔ manifests | `live-doc-check` passes with the `bun add` install column |

### 4.3 Scope decisions

- `docs/testing.md` was **verified, not re-edited** (plan 124 Task 6 left it Bun-only; the one grep above is the evidence).
- `docs/index.md`'s "Carried from the 0.x line" narrative keeps its plan references — that section *is* the version narrative; Task 4 rewrote the navigation entries it owns (intro, release entry, the 0.6.0 Node bullet).
- Benchmark and script transcripts in `docs/performance.md`, `docs/mcp-tools.md`, `docs/disaster-recovery.md`, and `docs/attention-compiler.md` keep their `node scripts/…` commands: they record how a specific measurement was taken, not how a host installs or runs Prism (a separate wording pass).
- `docs/impeccable.md` keeps `npx impeccable` (third-party detector CLI) and its "no `npx` … on import/setup" security claim.
- `docs/migrate-to-*.md` are per-era migration guides; only `docs/history/migrate-to-0.4.md` (archived) contains an npm install line, and the live guides carry none.
- The release-host npm exception is stated exactly twice on the page (one sentence in the publish bullet, one release-checklist row), matching Task 4's acceptance.

### 4.4 Security

No credential values, no absolute home paths. The peer paragraph now states the honest enforcement split — `bun add` installs a first-party tarball silently while npm fails closed (ERESOLVE) — and names the fail-closed import message as the compensating control (plan 126 Task 2). Install guidance keeps the reproducible-install and audit lines (`bun install --frozen-lockfile`, `bun audit --audit-level=moderate`), and the registry toolchain exception keeps `NPM_TOKEN`/OIDC/SBOM unchanged (plan 125 Task 5).

**Build-lock note (2026-09-25).** The canonical `bun run build` + root-suite run for this task was blocked by another agent's process holding `node_modules/.prism-build.lock` for a 45-minute root-suite run (`with-build-lock.mjs bun test --parallel=4 … dist/__tests__/*.test.js`, holder pid 164904, worker at ~42 min CPU under load 12–21). The lock protocol forbids a writer while a reader holds it, so every docs check for Task 4 was run **from source** instead (`bun test --timeout=0 src/__tests__/docs.test.ts`, which Bun executes natively): 157 pass / 0 fail. One `bun run build` after the lock frees refreshes `dist/__tests__/docs.test.js`; until then a root-suite run would execute the pre-Task-4 copy of that test.

## 5. Task 5 — the registry boundary (2026-09-25)

### 5.1 The probes (Bun 1.4.2)

| Probe | Result | Consequence |
| --- | --- | --- |
| `bun pack --help` | `error: Script not found "pack"` | no `bun pack` |
| `bun dist-tag ls x` | `error: Script not found "dist-tag"` | no `bun dist-tag` |
| `bun deprecate` | `error: Script not found "deprecate"` | no `bun deprecate` |
| `bun publish --help \| grep provenance` | no match (only `--access`, `--otp`, …) | **`bun publish` is rejected, not deferred**: OIDC attestations are a shipped security artifact |

So the registry *interface* stays npm's on the release host, and every other npm use is a bug.

### 5.2 The exception list, as measured after the flip

`npm <op>` call sites (16 scanned sites, ops `pack publish sbom view dist-tag deprecate`):

| Surface | Site | Op |
| --- | --- | --- |
| scripts | `packaging-current.test.mjs` ×3 (`:45`, `:205`, `:211`) | pack |
| scripts | `office-golden-packed.test.mjs`, `fixtures/packed-consumer.mjs`, `budget-gates.mjs`, `release-gates.mjs`, `post-publish-smoke.mjs` | pack |
| scripts | `release.mjs` (`spawnSync("npm", publishArgs(...))`) | publish |
| scripts | `phase54-legacy-registry.mjs` (the plan 054 legacy retirement path) | view, dist-tag, deprecate |
| workflows | `release.yml` (publish job + security job) | pack ×2, sbom ×2 |
| workflows | `security.yml` | pack ×2, sbom |

`dist-tag` and `deprecate` are the two ops the plan's four-item list did not enumerate: they are registry
*mutations* used only by the legacy-retirement operator script, they run through the same
`PRISM_LEGACY_NPM` seam, and Bun has no equivalent (probes above), so the gate's allowlist names them
explicitly (recorded as a compromise). Publish itself flows through `bun run release:publish` →
`release.mjs` → `spawnSync("npm", publishArgs(...))`, asserted by the gate.

### 5.3 The boundary comment and the decision record

Every npm call site carries the plan's one-liner:

```
// release-host registry toolchain — runner images ship Node; contributors never invoke npm
```

`release.mjs`'s header additionally records the decision (`bun pack`/`bun dist-tag`/`bun deprecate`
do not exist, `bun publish` has no `--provenance`, so pack/publish/sbom/view stay on npm, release host
only); `release.yml` and `security.yml` carry the one-liner above their npm steps (the gate checks it
within 30 lines of each npm command). The supply-chain surface is asserted unchanged:
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, `id-token: write`, both `attest-build-provenance` steps,
`bun scripts/verify-sbom.mjs`, and `bun audit --audit-level=moderate`.

### 5.4 Hint flips (npm → bun)

18 files, all one-liners: `release.mjs` (`run bun run release:evidence`), `release-gates.mjs`
(`bun run sdk:ready`, `run bun run build first`), `release-gate.test.mjs` (the compat-baseline
message + comment), `coverage-summary.mjs` ×3, `branch-coverage-audit.mjs`, `require-nats-url.mjs`,
`check-client-neutrality.mjs`, `drill-migration-rollback.mjs`, `release-skip-manifest.mjs` ×4,
`phase23-coverage.test.mjs`, `phase24-truth.test.mjs` ×3, `phase27-release.test.mjs`,
`phase12-restart-recovery.test.mjs`, `phase23-security.test.mjs` ×2, `truth-current.test.mjs` ×3,
`phase54-package-map.test.mjs`, `live-doc-check.test.mjs` ×2, `live-matrix.mjs` (the default
`build: "bun run build"` option). The pinned skip-manifest surface NAME `core npm test` is the one
non-registry npm string left in `scripts/` (`release-skip-manifest.mjs`), named as a gate exception.

### 5.5 The gate

`scripts/tooling-gate.test.mjs` gained
`npm survives only as the release-host registry toolchain`: it walks `scripts/**/*.{mjs,js}` for the
two npm spawn shapes (`spawnSync("npm", ["<op>", …]` and the phase54 `npm(["<op>", …]` helper) plus
computed-argument spawns, walks every workflow's comment-stripped `npm <op>` line, and fails on any
op outside the allowlist, a missing boundary comment, a computed spawn that is not the declared
`publishArgs`, or a retired npm invocation (`install|i|add|test|start|run|ci|exec|x|init|update|audit`)
in non-fixture scripts. Positive fixtures (registry ops, `spawnSync("git", …)`) pass and
negative fixtures (`npm install`, `npm test`, `npm ci`, `npm run build`) fail.

Two end-to-end negative controls were planted and reverted: `execFileSync("npm", ["ls", …])` in
`budget-gates.mjs` → `npm ls is not a registry op`; an `npm install` hint in `coverage-summary.mjs` →
`npm install first; … is retired (plan 125 Task 5)`. The second control exposed a real bug in the
first draft: the retired-hint scan sat behind the "this file spawns no npm" early exit, so it could
only ever see files that already had npm spawns. The scan is hoisted now, and both controls fire.

### 5.6 Verification

| Check | Result |
| --- | --- |
| `bun test --timeout=0 scripts/tooling-gate.test.mjs` | **9 pass / 0 fail** (8 pre-existing + the new gate) |
| affected batch (`release-gate`, `phase23-skip-manifest`, `workflow-liveness`, `phase12-freeze`, `truth-current`, `phase24-truth`, `phase54-package-map`, `live-doc-check`, `phase27-release`, `supply-chain-security`) | **91 pass / 3 fail** — the three pre-existing phase27-release Plan-027 closeout rows |
| `bun scripts/live-matrix.mjs --check` | 4/56 active suites runnable with the current env, 1 planned (unchanged) |
| `bun scripts/post-publish-smoke.mjs --local` | PASS (local tarballs) |
| `bun run lint` (biome) | clean |
| `scripts/phase23-coverage.test.mjs` | 13 pass / 1 fail — pre-existing stale generated artifact: `scripts/coverage-summary.json` (untracked) still records `core.pass=false` from a run whose only failure was the plans-index docs test that plan 124 Task 4 fixed. Regenerate with `bun run coverage:summary` once the build lock frees. |

### 5.7 Security

Unchanged and asserted: the publish token, OIDC `id-token: write`, both provenance attestations, the
SBOM verify gate, and `bun audit --audit-level=moderate` as the supply-chain audit. The npm registry
exception is a *documented* boundary with a gate behind it, not an implicit habit: any new npm
invocation outside the allowlist fails `bun run test`. No credential values in this evidence.
