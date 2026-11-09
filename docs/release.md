# Release and provenance

> Bun packs the tarballs once and the workflow attests them; npm publishes exactly those bytes
> under OIDC trusted publishing, so no npm token exists. This page covers the release pipeline, the
> owner's registry setup, and how a consumer verifies a published package.

## The pipeline

A release tag runs `.github/workflows/release.yml`. After the verify, Postgres, office and security
(CodeQL plus supply chain) gates pass, the `publish` job:

1. Packs every package once with `bun scripts/release.mjs pack --destination release-artifacts`
   (`bun pm pack` per package).
2. Writes `SHA256SUMS`, generates the SBOM with `bun scripts/sbom.mjs`, verifies it against
   `security/license-policy.json`, and secret-scans the unpacked tarballs.
3. Attests the tarballs and the SBOM with GitHub build provenance
   (`actions/attest-build-provenance`).
4. Publishes the same tarballs with `npm publish <tarball> --access public --tag latest` (or
   `--tag experimental` for a package on the [experimental line](#experimental-packages)) and
   `--provenance`, in dependency order, resumably (`--resume` compares the registry manifest before
   skipping a version).

`npm publish` is the only step npm owns, and it holds no secret: the job runs in the `npm-publish`
environment with `id-token: write`, and npm exchanges that OIDC token for a short-lived credential
scoped to `release.yml`. Publishing needs npm 11.5.1 or newer on Node 22.14.0 or newer; the job
installs Node 24.10.0, which bundles npm 11.6.2. `bun publish` is not used, because it has no OIDC
support. The SBOM is SPDX 2.3, built from `bun.lock` plus each installed package's `package.json`
license.

### Owner setup for trusted publishing

npm has no API for this, so it is set per package on npmjs.com. `bun scripts/registry-cleanup.mjs
--trusted-publishers` prints the list and the exact settings.

1. **Configure the trusted publisher** on every published `@arnilo` name: Packages → *name* →
   Settings → Trusted publishing → GitHub Actions, with the owner, the repository, the workflow
   filename `release.yml`, the environment `npm-publish`, and **both** allowed actions — `npm
   publish` and `npm dist-tag` (the release sets `--tag experimental`; dist-tag calls need npm
   11.21.0 or 12.2.0).
2. **Disallow tokens** on the same page: Publishing access → "Require two-factor authentication and
   disallow tokens". Trusted publishers keep working; every granular token stops.
3. **Bootstrap a name that was never published.** Its settings page does not exist until a version
   does, so the first publish of each name is manual: `bun run release:publish` locally with 2FA,
   from the tarballs CI packed (check them against `SHA256SUMS`). A manual publish carries the
   GitHub attestation from the CI run but no npm provenance statement. Configure the trusted
   publisher right after, and from then on OIDC is the only path.
4. **Delete the `NPM_TOKEN` secret** (repository and organization) and revoke the token on
   npmjs.com. No workflow reads a token any more.
5. A newly created trusted publisher must complete its first successful publish within 2 days or it
   expires; create it when the publish is ready, not before.

There is no token fallback: if the trusted publisher is missing or misconfigured, the publish fails
with an OIDC authorization error rather than falling back to a secret.

## Experimental packages

A package can ship on an experimental prerelease line: the same npm name, a version of the form
`x.y.z-experimental.N`, and the npm dist-tag `experimental`. The line sits outside
the stability promise of the stable packages, so a host can try the package now while its API, config
and defaults can still change or be removed in any release. A `^0.13.0` range never
matches a prerelease, so a host reaches the line with `@experimental` or an exact version
(`bun add @arnilo/prism-memory-system@experimental`).

The set is one list: `experimental` in `scripts/independent-packages.json`. Today it names the four
memory and knowledge packages (`@arnilo/prism-memory-{core,system}`, `@arnilo/prism-wiki` and `@arnilo/prism-rag`, at
`0.13.0-experimental.0`). Nothing else carries the version or the tag. The release tooling enforces it:

- **Tag.** `publishArgs` derives `--tag` from the list. An experimental package publishes under
  `experimental`, never `latest`. A listed package whose version has no prerelease identifier fails with
  `experimental_version_mismatch`, and an unlisted package whose version has one fails with
  `stable_version_prerelease`, before any registry request.
- **Lockstep cut.** A `v*` cut neither validates nor publishes an experimental package. It ships from its own
  `@arnilo/<name>@<version>` tag, like any independent-line package.
- **Pins.** Experimental packages pin each other exactly, in `dependencies` and in `peerDependencies`
  (`0.13.0-experimental.0`, never a caret). Their ranges into stable packages and the kernel window
  peer (`>=0.13.0 <1.0.0`) are the usual ones. `satisfiesInternalRange` lets a prerelease target satisfy
  only an exact range, so a loose pin fails the release gates and never reaches an install.
- **Bumping.** `bun scripts/release.mjs bump --package @arnilo/prism-memory-system --type prerelease`
  turns `0.13.0-experimental.0` into `0.13.0-experimental.1`, rewrites the exact pins that name it in
  the other manifests, and regenerates `bun.lock`. An experimental package bumps with `prerelease` only.
- **Compat gate.** Experimental packages keep their baselines in `scripts/compat-baseline/`. A removal or a
  changed signature in one is printed and listed in the gate report's `experimental` section, and never
  fails the gate. A missing baseline still fails. Stable packages are classified as before.
- **Version gates.** `scripts/package-truth.json`, the version tables in `README.md`, `docs/index.md` and
  this page, `scripts/version-literal-gate.test.mjs` and `src/__tests__/packaging.test.ts` accept the
  prerelease version for exactly the experimental set and reject it anywhere else.

A package graduates by leaving the list and taking a stable version through a normal cut. No tooling
decision is needed beyond removing the name.

### Notice template

Every experimental package's README opens, right after its title, with this notice. `<name>` is the
package's own name. `src/__tests__/docs.test.ts` (`experimental_packages_carry_notice`) compares each README
to this template word for word, ignoring line breaks, and fails when a package joins the list without it or a
stable README carries it.

```markdown
> **Experimental in 0.13.0.** Install with `bun add <name>@experimental`. Outside the
> [stability promise](https://github.com/ashiqrniloy/prism/blob/main/docs/compatibility.md) of the stable packages: its API,
> config, preset contents and defaults may change or be removed in any release until it graduates.
> Graduation is the memory track's final step, which sets the first stable version.
```

The `docs/index.md` entry of each experimental package says "(experimental)". The link is absolute because the
notice ships inside each package's README on npm, where a relative path to `docs/` does not resolve.

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

`bun run release:gate` is the whole gate, in order. `src/__tests__/docs.test.ts`
(`docs_release_gate_list_matches_scripts`) compares this list with the `release:gate` script, so a
step added to one without the other fails `bun run test`.

1. `scripts/release-skip-manifest.mjs` — the release-evidence manifest (`bun run release:evidence`).
2. `scripts/host-builder-index.mjs --check` — the host-builder kit matches the live surface.
3. `scripts/check-client-neutrality.mjs` — the client-neutrality check.
4. `@arnilo/prism-agent` test suite — the reference host, including the offline evaluation gate
   (`apps/prism-agent/src/__tests__/evals.test.ts`: invariant scorers, `pass^4`, and non-regression
   against `apps/prism-agent/evals/baseline.json`).
5. `@arnilo/prism-driver-process` test suite — the process driver.
6. `examples/adapters/conformance.ts` — the three reference adapters (it exits non-zero on a failed leg).
7. `src/__tests__/driver-kit-vendor-neutral.test.ts`, `src/__tests__/kernel-constraints.test.ts`,
   `src/__tests__/host-builder-kit.test.ts` — vendor neutrality, kernel constraints and the
   host-builder kit (`host_builder_kit_matches_surface`).
8. `scripts/package-skills-conformance.mjs` — the package-skill gate (`package_skills_conform`,
   see "Writing a package skill" in [Packages](packages.md)).
9. `scripts/install-idempotence.test.mjs` — the clean-install idempotence suite.
10. `scripts/release.mjs gate` — the offline publish gates, for every publishable workspace:
    version-range drift, the per-package API surface against `scripts/compat-baseline/`, the tarball
    deny list, and the kernel size budget.

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

## CI workflows

One body per gate. `.github/workflows/` holds:

| workflow | triggers | what it runs |
| --- | --- | --- |
| `release.yml` | push to main, any tag, PR, dispatch | `verify` (the `sdk:ready` steps plus `security:threat-suites`) on every run; `postgres-integration`, `security-release` and `office-validation`, then `publish` on a tag |
| `security.yml` | push to main, PR, weekly, dispatch, `workflow_call` | CodeQL SAST, dependency review (PRs only), audit + SPDX SBOM + license policy + secret scan |
| `integration-postgres.yml` | push to main, dispatch, `workflow_call` | the Postgres suites and the evidence `release:gate` reads, then the migration drill |
| `integration-office.yml` | push to main, dispatch | the packed office golden round-trips |
| `sandbox-browser.yml` | push to main, weekly, dispatch | the protected Docker/browser/egress matrix and the unused-code sweep |
| `canary-providers.yml` | nightly, dispatch | one provider's live suite per matrix leg (default: the gating T1 providers) |
| `live-canaries.yml` | weekly, dispatch | the four restricted live protocol canaries |
| `live-matrix.yml` | weekly, dispatch | strict live suites; `memory-bench` and `context-rot` are manual-only memory-track tooling |
| `coding-journey.yml` | weekly, dispatch | the protected real coding-agent journey |

`release.yml` calls `security.yml` and `integration-postgres.yml` (`uses: ./.github/workflows/…`), so
the CodeQL, supply-chain and Postgres bodies exist once. `scripts/workflow-liveness.test.mjs` holds the
CI-integrity checks: every workspace, script, action pin (SHA plus version comment), job permission,
credential-safe checkout and release tag condition, and that the `verify` job runs every `sdk:ready`
step. No workflow names a version: `v*` is a lockstep cut and `@arnilo/<name>@<version>` an
independent-line cut.

The `publish` job runs in the `npm-publish` environment; add required reviewers there to make a publish
need an approval (the environment has no rules until the owner sets them). `.github` also holds
`dependabot.yml`, which bumps the action pins weekly.

## Live acceptance

`release:gate` is hermetic. Before the tag, the release commit also passes live acceptance: T1 wire
scenarios for every gating provider, the SDK journey on Hyper and OpenCode Go, and cache parity, all in
strict mode, with a signed evidence file. After publish, the packed smoke (`bun scripts/post-publish-smoke.mjs`)
runs against the registry. Tiers, entry criteria, credentials, the procedure, triage and evidence are in
[Release acceptance on live providers](live-testing.md#release-acceptance-on-live-providers).

## The compat gate

The compat leg freezes the shape of each package's public surface, not only its names.
`scripts/compat-shape.mjs` reads the emitted `.d.ts` tree from every code target in the manifest's
`exports` (`.`, `./net`, `./artifacts`, `./provider-kit`, `./driver-kit`, `./manifest`, `./testing`, …)
and records one line per name, keyed `<entry> <name>`:

```text
. AgentConfig	interface AgentConfig { readonly compaction?: false | CompactionOptions; readonly disable?: AgentDisable; … }
./net pinnedFetch	function pinnedFetch(…): Promise<Response>
```

- **What a line holds.** The full normalized declaration: interface, class and enum bodies with members
  sorted, type alias right-hand sides, every function overload, and const types. Comments are stripped
  and whitespace is collapsed, so a comment edit or a member reorder changes nothing. A re-exported name
  resolves to its declaration inside the package. A name re-exported from another package records
  `reexport <name> from "<package>"`, so the owning package's baseline freezes its shape. A value that is
  exported only as a type carries `[type-only export]`.
- **Entry points.** Only names reachable from an `exports` target are frozen. Moving a name between the
  root and a subpath is a removal under one entry and an addition under the other.
- **Classification.** The gate reports each name as `removed`, `changed` (with a line diff of the
  normalized text), `compatible`, or `added`. Three kinds of change are `compatible` and pass: a new optional
  interface or class member, a new function overload, and a new member of a union the kernel only
  produces. Those unions are listed in `PRODUCER_ONLY_TYPES` in `scripts/compat-shape.mjs`
  (`AgentEventPayload`, `AgentEvent`, `AgentEventType`, `AgentFinishReason`, `HostUiRequest`,
  `SessionEntryKind`); [compatibility.md](compatibility.md) gives the host, package and store rules that make
  their growth safe. Any other
  change fails, unless you pass `--allow-break` and `docs/migration.md` names the version. That includes
  widening a union a host constructs, a required member, a narrowed type, or a value that becomes
  type-only.
- **Updating.** `bun scripts/release.mjs gate --update-baseline` rewrites every live package's baseline.
  Review the diff of `scripts/compat-baseline/` like an API change. Baselines of the retired 0.3-era
  packages are left alone: they are frozen literals for the legacy registry
  (`scripts/phase54-package-map.mjs`).

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
| `@arnilo/prism-host-builder` | 0.13.0 | library — host library shipping version-exact API, error-code and example indexes, a skill, an MCP server and an installer for coding agents that build Prism hosts |
| `@arnilo/prism-mcp` | 0.13.0 | capability — MCP client package: connects allowed servers, bridges their tools, and exposes mcp:status/reconnect/close |
| `@arnilo/prism-mcp-server` | 0.13.0 | library — host library serving Prism tools, resources, and prompts over MCP (stdio and Streamable HTTP transports) |
| `@arnilo/prism-memory-compaction` | 0.13.0 | capability |
| `@arnilo/prism-memory-core` | 0.13.0-experimental.0 | library — shared memory contracts, vector stores, lineage, propagation, and scoring; no slot and no capability |
| `@arnilo/prism-memory-system` | 0.13.0-experimental.0 | capability — the memory system: session tiers (STM, WM, rehearsal) that observe the session, keep a source-backed ledger, and compact from it, plus long-term memory (ltm), the store of record behind the memory.* tools |
| `@arnilo/prism-model-router` | 0.13.0 | capability — policy around hook routing turns across candidates with budget, circuit, and rate-limit controls |
| `@arnilo/prism-observability` | 0.13.0 | capability — OpenTelemetry spans and metrics over the agent event catalog as observe handlers; exports nothing itself |
| `@arnilo/prism-rag` | 0.13.0-experimental.0 | capability — indexed retrieval with a rag_search tool, an opt-in context block, and the embeddings service |
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
| `@arnilo/prism-wiki` | 0.13.0-experimental.0 | capability — knowledge outside memory, opt-in and unmeasured: concepts and sources in its own store, consolidated from cited evidence; reads memory read-only |
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

Two attestations cover a published version. The npm provenance statement is produced by
`npm publish --provenance` under OIDC and is attached to the version on the registry:

```bash
npm audit signatures                                    # verifies every installed package's provenance
npm view @arnilo/prism@0.13.0 dist.attestations --json   # what the registry holds for that version
```

The GitHub build attestation covers the exact tarball bytes the workflow packed:

```bash
gh attestation verify arnilo-prism-0.13.0.tgz --owner <github-owner>
```

The attestation covers the tarball's digest, so a tarball that does not match the attested bytes
fails verification. The SBOM is attested the same way.

## Legacy deprecation

`npm deprecate` is the one registry write trusted publishing cannot do: npm's OIDC covers `npm
publish`, `npm stage publish` and `npm dist-tag` only. So `scripts/registry-deprecate.mjs` plans the
deprecations against the anonymous registry and prints the commands; it holds no credential and
mutates nothing.

The committed list is `scripts/deprecations-0.13.json`: whole-package entries
(`range: "*"`) for names no 0.13.0 package reuses, and range-scoped `<0.13.0` entries for names a
0.13.0 package or host library reuses. Every message names the successor and its
`docs/migrate-to-0.13.md` anchor.

```bash
bun scripts/registry-deprecate.mjs --generate    # anonymous GET per name -> release-artifacts/deprecation-plan.json
bun scripts/registry-deprecate.mjs --dry-run     # print the versions in range; mutates nothing
bun scripts/registry-deprecate.mjs --commands    # print the `npm deprecate` lines for the owner
```

The owner runs the printed lines locally with 2FA. There is no `--apply`: a token in CI is exactly
what the trusted-publisher switch removed, and `npm deprecate`, `npm unpublish` and `npm access`
cannot authenticate with OIDC at all.

## Registry hygiene

Deprecation leaves the old versions installable; the 0.13.0 scope is meant to be clean. Deletion is a
different operation: it is irreversible (an unpublished version never comes back), the registry
blocks a name whose every version was removed for 24 hours, and npm has no OIDC path for it. So it is
generated as a plan, confirmed by the owner, and run under the owner's own 2FA — never in CI, never
with a token in this repository.

```bash
bun scripts/registry-cleanup.mjs --inventory                       # anonymous reads -> docs/_evidence/registry/arnilo-scope-<date>.json
bun scripts/registry-cleanup.mjs --plan > /tmp/arnilo-cleanup.sh  # owner reviews, then runs it signed in
bun scripts/registry-cleanup.mjs --plan --include-unlisted        # also the fully deprecated names no 0.13 list mentions
```

The plan prints `npm unpublish <name> --force` for a name no 0.13.0 package reuses, one
`npm unpublish <name>@<version>` per retired version for a reused name (npm 12 accepts a single
version or `*`, not a range), and `npm deprecate` for a name the [unpublish
policy](https://docs.npmjs.com/policies/unpublish/) excludes — one maintainer, fewer than 300
downloads last week, and no registry package depending on it. Deletions are ordered dependents first
from the published manifests, so an aggregator goes before the packages it depends on. The tool
reads the registry anonymously (the scope listing `/-/org/<scope>/package`, one packument and one
downloads point per name), never reads a credential and never spawns npm.

The first run (2026-11-09) unpublished 66 of the 68 names in the scope. `@arnilo/prism` keeps its
0.12.x line because it is the kernel, and `@arnilo/liveframe` stays because nothing retires it and no
0.13.0 package replaces it. The reused names return at 0.13.0 after the 24-hour block. A name is
deleted as a name, not version by version, once every published version is retired; the tool also
reads `scripts/retired-names.json`, so a name retired before 0.13 is not mistaken for an unlisted
keeper.
