# Release and provenance

> Publishing is Bun-only: the tarballs are packed once, attested, and
> then published unchanged. This page covers the release pipeline and how a consumer verifies a
> published package.

## The pipeline

A release tag runs `.github/workflows/release.yml`. After the verify, Postgres, office, CodeQL, and
supply-chain gates pass, the `publish` job:

1. Packs every package once with `bun scripts/release.mjs pack --destination release-artifacts`
   (`bun pm pack` per package).
2. Writes `SHA256SUMS`, generates the SBOM with `bun scripts/sbom.mjs`, verifies it against
   `security/license-policy.json`, and secret-scans the unpacked tarballs.
3. Attests the tarballs and the SBOM with GitHub build provenance
   (`actions/attest-build-provenance`).
4. Publishes the same tarballs with `bun publish <tarball> --access public --tag latest`, in
   dependency order, resumably (`--resume` compares the registry manifest before skipping a version).

No npm binary runs in the release path. The SBOM is SPDX 2.3, built from `bun.lock` plus each
installed package's `package.json` license.

## What a tarball contains

The kernel publishes TypeScript source. Every `exports` target is the module itself
(`./src/index.ts`, `./src/testing/index.ts`, `./src/provider-kit/index.ts`,
`./src/driver-kit/index.ts`, `./src/manifest/index.ts`) plus the emitted `./manifest/schema.json`;
there is no `dist/`. Consumers on Bun import the source directly and no build step runs between
the tag and the published bytes. `files` ships `src` minus `src/**/__tests__`, the docs and
templates trees, and `CHANGELOG.md`.

Native packages under `packages/` publish source, so the whole set is
source-distributed and uniform. `tsc` runs `--noEmit` in `build:core` purely as the typecheck the
tag runs before packing.

## What the gate runs

`bun run release:gate` is the whole gate, in order: the release-evidence manifest, the client-neutrality
check, the reference host suite (`@arnilo/prism-agent`), the process-driver suite
(`@arnilo/prism-driver-process`), the three reference adapters through
`examples/adapters/conformance.ts` (it exits non-zero on a failed leg), the vendor-neutrality and
kernel-constraint tests, the clean-install idempotence suite
(`scripts/install-idempotence.test.mjs`), and finally `scripts/release.mjs gate` — which checks version-range drift, the
per-package API surface against `scripts/compat-baseline/`, the kernel size budget, and the tarball
deny list, for every publishable workspace. The reference host suite includes the offline evaluation
gate (`apps/prism-agent/src/__tests__/evals.test.ts`), which asserts invariant scorers, `pass^4`, and
non-regression against `apps/prism-agent/evals/baseline.json`.

The durable store legs need a database, because `test:postgres` records evidence the gate then reads:

```bash
podman run -d --rm --name prism-pg -e POSTGRES_PASSWORD=prism -p 5432:5432 docker.io/library/postgres:17
export PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@localhost:5432/postgres
bun run test:postgres        # writes scripts/postgres-evidence.json (gitignored)
bun run release:evidence     # records `pass` for the durable conformance surface
bun run release:gate
```

Without `PRISM_TEST_POSTGRES_URL` the durable surface records `blocked` and `release:gate` stops at
`checkReleaseEvidence` rather than passing quietly. The DSN is read from the environment only — it is
never written to `scripts/release-evidence.json`, `scripts/postgres-evidence.json`, or a log.

## The kernel size budget

`scripts/budgets.json` `kernel` records five strict ceilings — packed bytes, unpacked bytes, file
count, root export count, and non-test `src/` line count. `runGates` enforces them as step 4 of
`bun scripts/release.mjs gate`, using the root tarball the tarball deny list already packs, so the
check costs no extra pack. A breach fails the gate naming the metric and the delta:

```
kernel packedBytes grew: measured 1605300 vs ceiling 1605239 (+61) — shrink it or rebaseline budgets.json kernel.packedBytes with a reason
```

There is no tolerance band: the kernel is the one package whose size is a product decision. To
rebaseline, edit the ceiling in `scripts/budgets.json` and extend its `$comment` with the date, the
task, the measured value, and what grew — the same convention as `exportCounts`. `bun run test`
re-measures the same five metrics in `scripts/budget-gate.test.mjs` (the tarball one sharing the
existing pack), so a local run fails before the tag does.

The other two kernel constraints are gate-only and live in `src/__tests__/kernel-constraints.test.ts`:
`kernel_has_no_runtime_dependencies` (the root manifest declares no `dependencies`,
`peerDependencies`, `optionalDependencies`, or `bundleDependencies`) and `kernel_imports_only_builtins`
(every specifier under `src/` is relative, `node:*`, `bun`, or `bun:*`). The same file rejects a
specifier built at runtime (`import(name)`), which is the one form a static scan cannot see.

## Packages

The inventory and the provider adapters below are generated from the workspace manifests by `bun scripts/package-truth.mjs --emit-docs`, which reads `scripts/package-truth.json`. Do not hand-edit them.

<!-- generated:package-truth:inventory begin -->
**51 publishable manifests** — root `@arnilo/prism` plus 50 workspace packages (1 `prism-*` family packages, 38 capability packages). Generated by `bun scripts/package-truth.mjs --emit-docs` — do not hand-edit.

| package | version | notes |
| --- | --- | --- |
| `@arnilo/prism` | 0.13.0 | core — runtime, CLI/RPC, templates, docs |
| `@arnilo/prism-channels` | 0.13.0 | family — transport-neutral messaging runtime, durable journal, pairing and one-use approvals; official /telegram (private DMs, opt-in granted groups/topics) and experimental pinned signal-cli /signal |
| `@arnilo/prism-acp` | 0.13.0 | capability |
| `@arnilo/prism-advisor` | 0.13.0 | capability — a second model's advice as one advise tool and opt-in review consults, plus completion validation by a model or a hidden delegate child |
| `@arnilo/prism-ag-ui` | 0.13.0 | capability — AG-UI/A2A/A2UI adapter |
| `@arnilo/prism-approval` | 0.13.0 | capability — approval modes deny/ask/edits/auto over tool effects and roots, as one tool.call gate |
| `@arnilo/prism-context-engineering` | 0.13.0 | capability — the input budget, tool-result folding, tool search, and the attention compiler as one fixed-order context.build handler |
| `@arnilo/prism-context-files` | 0.13.0 | capability — AGENTS.md / SYSTEM.md layers as one context.build handler, trust-gated and cached per session |
| `@arnilo/prism-credentials-keyring` | 0.13.0 | capability — credentials slot: OS keyring and encrypted-file backends, `keyring:` ref resolution, and secret/OAuth persistence |
| `@arnilo/prism-delegate` | 0.13.0 | capability — a delegate tool whose child agent inherits a chosen subset of the parent packages, reporting delegate.step package events |
| `@arnilo/prism-devtools` | 0.13.0 | capability |
| `@arnilo/prism-driver-process` | 0.13.0 | capability — generic external-agent process driver with a host-written adapter |
| `@arnilo/prism-evals` | 0.13.0 | capability |
| `@arnilo/prism-governance` | 0.13.0 | capability — deny-by-default policy engine (inline rules or OPA) plus approvals and an audit ledger, as one tool.call/run.input/model.request gate with a governance.policy/governance.audit service |
| `@arnilo/prism-guardrail-packs` | 0.13.0 | capability — built-in guardrail packs (coding-standard, destructive-commands, validation-respect, secrets-hygiene) as restrictive-only tool.call/tool.result rules with package session state |
| `@arnilo/prism-headless` | 0.13.0 | library — host library routing HostUi requests through ordered routes with a value-free answer log |
| `@arnilo/prism-hooks-json` | 0.13.0 | capability — Claude/Codex hooks.json compiled onto session.opened, context.build, run.input, tool.call, tool.result, and run.end |
| `@arnilo/prism-mcp` | 0.13.0 | capability — MCP client package: connects allowed servers, bridges their tools, and exposes mcp:status/reconnect/close |
| `@arnilo/prism-mcp-server` | 0.13.0 | library — host library serving Prism tools, resources, and prompts over MCP (stdio and Streamable HTTP transports) |
| `@arnilo/prism-memory-compaction` | 0.13.0 | capability |
| `@arnilo/prism-memory-core` | 0.13.0 | library — shared memory contracts, vector stores, lineage, propagation, and scoring; no slot and no capability |
| `@arnilo/prism-memory-fabric` | 0.13.0 | capability — T1 of the three-tier memory, the store of record: working, semantic, and scoped notes with the memory.* tools, a context block, and per-session state |
| `@arnilo/prism-memory-observational` | 0.13.0 | capability — T0 of the three-tier memory: observes the session, keeps a source-backed ledger, and compacts from it |
| `@arnilo/prism-memory-rag` | 0.13.0 | capability — indexed retrieval with a rag_search tool, an opt-in context block, and the embeddings service |
| `@arnilo/prism-memory-wiki` | 0.13.0 | capability — T2 of the three-tier memory, opt-in and unmeasured: concept notes over the fabric, consolidated from cited evidence |
| `@arnilo/prism-model-router` | 0.13.0 | capability — policy around hook routing turns across candidates with budget, circuit, and rate-limit controls |
| `@arnilo/prism-observability` | 0.13.0 | capability — OpenTelemetry spans and metrics over the agent event catalog as observe handlers; exports nothing itself |
| `@arnilo/prism-remote` | 0.13.0 | library — host library serving a Prism agent to remote clients and connecting to remote agents over prism.remote/1 |
| `@arnilo/prism-store-codecs` | 0.13.0 | capability |
| `@arnilo/prism-store-jsonl` | 0.13.0 | capability |
| `@arnilo/prism-store-postgres` | 0.13.0 | capability |
| `@arnilo/prism-store-sqlite` | 0.13.0 | capability |
| `@arnilo/prism-tools-browser` | 0.13.0 | capability — six exclusive Playwright browser tools with declared effects, fail-closed egress policy, and artifact quarantine |
| `@arnilo/prism-tools-coding` | 0.13.0 | capability — coding file/search/shell tools as a package: a small tool set with declared effects, in-tool path containment, and an optional shell |
| `@arnilo/prism-tools-computer-use` | 0.13.0 | capability — the host-owned computer-use-linux MCP binary as tools with declared external effects, in-tool device admission, and a bundled skill |
| `@arnilo/prism-tools-openapi` | 0.13.0 | capability — compile allow-listed OpenAPI 3.1 operations into bounded tools with pinned origins, per-method effects, and ref-only header credentials |
| `@arnilo/prism-tools-research` | 0.13.0 | capability — research skills, a per-session source ledger, cite, and a bounded run.end citation check |
| `@arnilo/prism-tools-web` | 0.13.0 | capability — keyless native fetch plus Brave/Exa/SearXNG/Tavily/Kagi search, Firecrawl fetch/extract, and host-installed Obscura, with a host domain policy, an optional per-session cache, and a web.fetch service |
| `@arnilo/prism-tools-work` | 0.13.0 | capability — /connectors, /documents, /sheets, /diagrams, /document-extraction, /document-reader, /sandbox, /skills, /tools subpaths |
| `@arnilo/prism-workflows` | 0.13.0 | library — typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions: checkpoints, suspend/resume, replay, graph export, and the `checkpoints`/`leases` service contracts |
<!-- generated:package-truth:inventory end -->

The 0.13.0 publish set is the nine adapters that ship at this cut. `@arnilo/prism-provider-commandcode` and `@arnilo/prism-provider-ollama-cloud` are present in the tree at 0.13.0 but publish in the first release after 0.13.0, so the generated adapter count below counts the tree, not the cut.

<!-- generated:package-truth:providers begin -->
**11 provider adapters** — first-party adapters ship as standalone `@arnilo/prism-provider-*` packages (importing one never evaluates another):

| adapter package | version |
| --- | --- |
| `@arnilo/prism-provider-commandcode` | 0.13.0 |
| `@arnilo/prism-provider-hyper` | 0.13.0 |
| `@arnilo/prism-provider-kilo` | 0.13.0 |
| `@arnilo/prism-provider-laya` | 0.13.0 |
| `@arnilo/prism-provider-liquid` | 0.13.0 |
| `@arnilo/prism-provider-litellm` | 0.13.0 |
| `@arnilo/prism-provider-ollama-cloud` | 0.13.0 |
| `@arnilo/prism-provider-openai-codex` | 0.13.0 |
| `@arnilo/prism-provider-opencode-go` | 0.13.0 |
| `@arnilo/prism-provider-openrouter` | 0.13.0 |
| `@arnilo/prism-provider-typesafe` | 0.13.0 |
<!-- generated:package-truth:providers end -->

## Verify a published package

npm registry provenance is retired (Bun 1.4.2 has no `--provenance`). The provenance artifact is the
GitHub build attestation on the exact published tarball:

```bash
gh attestation verify arnilo-prism-0.13.0.tgz --owner <github-owner>
```

The attestation covers the tarball's digest, so a tarball that does not match the attested bytes
fails verification. The SBOM is attested the same way.

## Legacy deprecation

`npm dist-tag` and `npm deprecate` have no Bun equivalent on 1.4.2. Retiring the 0.12 family packages
goes through the registry HTTP API instead (`scripts/registry-deprecate.mjs`), which is the same
GET-then-PUT the npm CLI performs: read the packument, set `versions[v].deprecated`, write it back
with `Authorization: Bearer $NPM_TOKEN`. No npm binary runs.

The committed list is `scripts/deprecations-0.13.json`: whole-package entries
(`range: "*"`) for names no 0.13.0 package reuses, and range-scoped `<0.13.0` entries for names a
0.13.0 package or host library reuses. Every message names the successor and its
`docs/migrate-to-0.13.md` anchor.

```bash
bun scripts/registry-deprecate.mjs --generate    # anonymous GET per name -> release-artifacts/deprecation-plan.json
bun scripts/registry-deprecate.mjs --dry-run     # print the versions in range; mutates nothing
NPM_TOKEN=… bun scripts/registry-deprecate.mjs --apply --confirm   # one PUT per name
```

`--apply` fails closed with zero mutations when `NPM_TOKEN` is missing, when the plan was generated
against a different registry state, when a reused name's `latest` dist-tag is still inside `<0.13.0`,
or when a reused name has no `0.13.0` published yet. Applied entries are skipped, so a resume is
safe. The `.github/workflows/npm-deprecate.yml` operator job runs the same three commands behind its
`confirm: deprecate` input.
