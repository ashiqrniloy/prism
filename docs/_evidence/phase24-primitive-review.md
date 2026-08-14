# Phase 24 Primitive Review — Package, Documentation, and Compatibility Truth

Plan: `plans/024-Release-0-2-4-Package-Documentation-And-Compatibility-Truth.md` Task 0.
Roadmap: `roadmap.md` §0.2.4 (four bullets) + §0.3.0 "Umbrella membership fix" deferral + mandatory 0.2.x regression matrix (already closed across 0.2.0–0.2.3; 0.2.4 adds no matrix item).
Baseline: `@arnilo/prism` 0.2.3 (HEAD 4138e65 + 0.2.3 working tree; plan 023 exit gate green). Evidence gathered 2026-08-14 against the working tree.
Tarball-excluded evidence document (lives under `docs/_evidence/`, already excluded from every publish tarball). No source or script was edited to produce this document.

## 1. Primitive inventory

### 1.1 Publish graph (root `package.json` + workspace globs)

- Root `@arnilo/prism` **0.2.3**, `workspaces` = 24 globs that expand to **49 workspace packages**; publishable graph = root + 49 = **50 manifests** (matches the canonical statement at `docs/release-and-install.md:5`).
- Taxonomy (all 49 workspace): **14 `provider-*`** (`@arnilo/prism-provider-{ai-sdk, alibaba, anthropic, azure, bedrock, google, kimi, neuralwatt, ollama, openai, opencode-go, openrouter, vertex, zai}`), **9 `prism-*` family/profile** (`prism-all`, `prism-base`, `prism-caveman`, `prism-code`, `prism-compaction`, `prism-openapi-tools`, `prism-ponytail`, `prism-providers`, `prism-sdk`), **26 capability** (the remaining 26 dirs).
- Orthogonal breakdown: **43 code packages** declare the `@arnilo/prism` peer; **6 pure-manifest packages** declare none: `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, `prism-sdk` (all 6 ship only `README.md`+`CHANGELOG.md` in `files`; `prism-base` also depends on `@arnilo/prism` as a runtime `dependency` — not a peer). Docs line 699 says "42 code packages + 6 pure-manifest family/profile packages" — **stale by exactly one** (plan 018 added `document-reader`, a code package with a peer).
- Peer shape: all **43** code packages declare non-optional `"@arnilo/prism": "0.2.3"` (exact, uniform); **6** also declare a second `@arnilo/prism-*` peer: `ag-ui` (`prism-mcp`, `prism-supervisor`), `coding-agent` (`prism-workflows`), `coding-security` (`prism-coding-agent`), `document-reader` (`prism-coding-agent`), `rag` (`prism-memory`), `server` (`prism-workflows`). `prism-ponytail` additionally peers external `@dietrichgebert/ponytail ^4.8.4`. All 43 also declare `"@arnilo/prism": "file:../.."` in `devDependencies` (stripped from consumer installs). No package uses a peer range — every spec is exact.
- `scripts/release.mjs` `bumpRelease` rewrites the version literal across all manifests; `validateRelease` enforces exact version/peer/lockfile internal consistency — the existing "release automation enforces internal consistency" primitive.

### 1.2 Umbrella manifests (the two false-claim sources)

- `packages/prism-providers/package.json` (0.2.3): `description` = "Umbrella package: installs all first-party Prism provider adapters, including Anthropic, Google, and AI SDK interoperability." — **FALSE**: `dependencies` = exactly **11** providers (ai-sdk, alibaba, anthropic, google, kimi, neuralwatt, ollama, openai, opencode-go, openrouter, zai). **Omits azure, bedrock, vertex** — the three cloud providers that `prism-all` adds directly. Roadmap §0.3.0 "Umbrella membership fix" names this (architectural problem #1).
- `packages/prism-all/package.json` (0.2.3): `description` = "Complete Prism umbrella: every first-party runtime, capability, provider, and persistence package." — **FALSE**: `dependencies` = **20** packages (code, sdk, providers, session-store-sqlite, session-store-postgres, evals, enterprise-postgres, memory, rag, server, supervisor, web-tools, browser, ag-ui, policy, model-router, provider-azure, provider-bedrock, provider-vertex, work-tools). Transitive closure over workspace `dependencies` = **43** of 49 workspace packages (the 20 direct deps expand through `prism-code` → base/coding-agent/coding-security/mcp and `prism-sdk` → credentials-node/observability/workflows, plus the 11 providers via `prism-providers`, plus compaction/tool-validator and the 2 compaction strategies via base). **5 workspace packages are unreachable** — exactly the roadmap's named omissions: **document-reader, openapi-tools, session-store-nats, Caveman, Ponytail** (plus `prism-all` itself, not self-reachable). CORRECTION (2026-08-14, Task 2 execution): the original Task 0 hand-walk under-expanded the non-provider direct deps and recorded closure 31 / 18 unreachable; the manifest-derived generator (`scripts/package-truth.mjs`) proves closure 43 / omits 5, and all Task 1 wording/plan numbers were corrected to 43.
- README claims to fix: `README.md:180` "`@arnilo/prism-providers` | family: all 14 first-party provider adapters" (**FALSE** — 11 of 14) and `README.md:185` "`@arnilo/prism-all` | every first-party package, including both persistence adapters and web tools" (**FALSE** — 31 of 49 workspace).
- `docs/release-and-install.md:20` "`@arnilo/prism-providers` includes all eleven `@arnilo/prism-provider-*` packages." — **TRUE** (11) — the contradiction with README:180 that the roadmap names.

### 1.3 Stale version/count literals (drift inventory)

| Location | Literal | Truth | Disposition |
|---|---|---|---|
| `README.md:180` | "all 14 first-party provider adapters" | 11 of 14 | Task 1 rewrite |
| `README.md:185` | "every first-party package" | 31 of 49 workspace | Task 1 rewrite |
| `packages/prism-providers/package.json` `description` | "all first-party Prism provider adapters" | 11, omits azure/bedrock/vertex | Task 1 rewrite |
| `packages/prism-all/package.json` `description` | "Complete Prism umbrella: every first-party …" | 20 deps / 43 transitive closure, omits 5 (document-reader, openapi-tools, session-store-nats, caveman, ponytail) | Task 1 rewrite |
| `docs/release-and-install.md:5` | "50 publishable manifests … 49 workspace — 14 provider, 9 prism-*, 26 capability" | correct (50/49/14/9/26) | Task 2: replace hand-count hint with generator reference |
| `docs/release-and-install.md:7` | "`@arnilo/prism@0.1.0` peer" | 0.2.3 (exact; Decision A) | Task 2 refresh |
| `docs/release-and-install.md:49–51, 97, 116–118, 161, 164–165, 199–206, 231–238` | `--version 0.1.0` / `arnilo-prism-…-0.1.0.tgz` / `"@arnilo/prism": "0.1.0"` | current 0.2.4 at release | Task 2: refresh only the *current-command* block; keep 0.1.0 publish handoff (line 180+) as historical record |
| `docs/release-and-install.md:699` | "All 49 manifests (root + 48 workspace packages: 42 code packages + 6 pure-manifest family/profile packages)" | 50/49; 43 code + 6 pure-manifest | Task 2 refresh |
| `docs/release-and-install.md:~800` (Extension notes) | "`@arnilo/prism@0.0.28` peer … range stays pinned to `0.0.28` for the current 0.x release and will widen to `^1.0.0` at the 1.x stable release" | current version; policy statement itself is Decision A precedent | Task 2/3 refresh literal, keep policy |
| `docs/release-and-install.md:566` | "0.0.23 … **47 manifests** (41 code + 6 family/profile)" | historical release block | **Retain as-is** (per-release record, not a current-line claim) |
| `docs/0.1.0-readiness.md:3` | "**0.1.1** is the current release line" | 0.2.4 | Task 2 refresh |
| `docs/0.1.0-readiness.md:23` | the 0.1.1-era "## Current line" readiness heading | 0.2.4 | Task 2 refresh |
| `docs/0.1.0-readiness.md:27` | "**49** publishable manifests at exact **0.1.1**" | 50 at 0.2.4 | Task 2 refresh |
| `docs/index.md` current-line entries | 0.2.x content; version mentions | 0.2.4 | Task 2 refresh |
| `roadmap.md` §0.2.4 bullet 2 | "Refresh … for the **0.1.7 baseline**" | actual current line 0.2.4; 0.1.7 = terminal 0.1.x baseline | Task 2: refresh to 0.2.4; record 0.1.7 as the completed 0.1.x terminal |

### 1.4 Docs test harness (`src/__tests__/docs.test.ts`)

- Runs in the core `node --test dist/__tests__/*.test.js` segment; measured wall time **4.29 s** (baseline, 2026-08-14, Node v24.19.0).
- Existing primitives: `index links point to existing local markdown files` (line 141); `all shipped markdown links resolve locally`; `no broken createExtensionKernel() destructure`; `no bare 'prism' import/install specifiers` (plan 023 guard); `no old-scope specifiers` (plan 023 guard — the pre-arnilo `@prism` package scope must not reappear); `api pages include required headings`; `docs index contains exactly one navigation link per documentation page` (line 214); `plans index links every active numbered plan` (line 228); `canonical manifest-count narrative: one statement, no stale counts` (line 243 — asserts the tokens "50 publishable manifests", "49 workspace packages", "14 provider adapters", "9 `prism-*` family/profile packages", "26 capability packages", "ls packages/*/package.json | wc -l" and rejects the three known stale-count phrases — the 41-capability wording, the 6-pure-manifest wording, and the 48-manifest wording — everywhere except `docs/migration.md`). Per-phase freeze tripwires (`scripts/phase*-freeze.test.mjs`) mirror this shape.
- **No prose-snapshot library; no docs generator; no navigation generator.** All assertions are `node:test` + `node:assert` + `node:fs` — the primitives for the Task 4 structural truth tests.

### 1.5 Release tooling (scripts/ + workflows)

- `scripts/release.mjs`: `loadRelease` / `validateRelease` (exact version/peer/lockfile internal consistency) / `topologicalOrder` / `bumpRelease` (literal replace across all manifests) / `regenerateLockfile` (`npm install --package-lock-only`) / `checkReleaseEvidence` / `check` / `publish` / `gate` / `bump` modes.
- `scripts/release-gates.mjs`: `BASELINE_DIR = "scripts/compat-baseline"` — per-package surface `.txt` files; `diffSurface` reports added/removed declarations; plain reviewed gate regenerates with `--update-baseline`, breaks require `--allow-break`. 0.2.3 delta was the version literal only.
- `scripts/release-skip-manifest.mjs` → `scripts/release-evidence.json` (58 surfaces, `pass`/`skip`/`blocked`/`protected`, env NAMES only); `scripts/phase23-baseline.json` `exitGate` precedent for `phase24-baseline.json`.
- `npm test` = build + core dist tests + 20 script-gate files + workspaces; `sdk:ready` = typecheck → lint → format:check → test → coverage → pack:dry-run → release:gate. `security:threat-suites` runs phase8–11 + phase20–23 suites.
- **No generator produces package/version/profile tables from manifests today** — counts are hand-maintained with only the "(Regenerate the counts: `ls …`)" hint at `docs/release-and-install.md:5`. This is the gap Task 2 fills.

### 1.6 Roadmap state

- §0.2.4 four unchecked bullets (make claims match manifests; generate tables; define peer-version policy; keep docs semantic) with acceptance criteria — full text read in Task 0.
- §0.3.0 "Umbrella membership fix" (make `prism-providers` the documented complete family or a stable narrower rule; make `prism-all` membership intentional incl. document-reader/OpenAPI/NATS/Caveman/Ponytail) — the 0.2.4 membership freeze boundary.
- §0.2.8 contains **stray/truncated notes** to remove in Task 4: "Background observers — the actually novel bit. Alongside your session, Muse Code runs four persistent observer agents: memory recall, skill recall, goal tracking, and verification. Vent" and "Managing providers with profiles. Allows using multiple accounts with the same provider Mostly for opencode go" — no task structure, no acceptance criteria, contradicts the plan conventions.
- Mandatory 0.2.x regression matrix (12 items) is closed across 0.2.0–0.2.3 (plan 023 re-proved items 4 and 12); 0.2.4 adds no matrix item.

### 1.7 Peer-version policy precedent

- `docs/release-and-install.md` Extension notes already state the policy shape: "Every first-party code package declares a non-optional `@arnilo/prism` peer … The range stays pinned to <current> for the current 0.x release and will widen to `^1.0.0` at the 1.x stable release" (stale literal `0.0.28` to refresh).
- npm semantics: exact-pin mismatch → `ERESOLVE` peer conflict at install time; `~0.2.4` = patch range; `>=0.2.0 <0.3.0` = minor range. `validateRelease` already enforces internal consistency (no half-updated peers can ship).
- 1.0 readiness remains operator-gated (`docs/0.1.0-readiness.md`); compatibility has NOT stabilized yet — 0.2.x IS the stabilization line.

## 2. Gap decisions (minimum reusable, reuse-first)

| Gap | Decision | Rationale |
|---|---|---|
| Package/version/profile tables from manifests | **Approve** one dependency-free generator `scripts/package-truth.mjs` emitting `scripts/package-truth.json` (stdlib `node:fs`/`node:path`/JSON; O(50) reads + one bounded closure walk; sub-second; no network) | Counts are hand-maintained today; the generator makes drift mechanically impossible; the JSON artifact is readable by docs tests and CI regeneration asserts tamper-freedom. No static-site framework needed. |
| Structural docs truth tests | **Approve** a manifest-derived assert block in `src/__tests__/docs.test.ts` (existing harness, `node:test`, +4.29 s leg grows by O(1) JSON load + O(docs files) grep) | `docs.test.ts` already runs semantic docs tests; deriving expected values from the artifact (never verbatim prose) keeps editorial freedom while failing on wrong closure/version/navigation. |
| Peer-version policy | **Approve Decision A**: keep exact `@arnilo/prism: <current>` peers until 1.0; document the atomic-upgrade rule and the unsupported-mixture refusal; verify mismatched exact pins fail clearly (ERESOLVE) in a packed install | The existing documented policy (1.7) is already Decision A; compatibility has not stabilized (0.2.x is the stabilization line); exact pins are the strongest compat promise with zero consumer migration; widening to a range is the 1.0 transition (`^1.0.0`). Roadmap bullet 3 acceptance is met: policy explicit (documented), third-party adapters peer on the exact current version (documented supported-range story), unsupported mixtures fail clearly (ERESOLVE), release automation enforces (validateRelease). |
| Packed-install truth journey | **Approve** extending `src/__tests__/install-smoke.test.ts` (existing local-tarball lifecycle, network-free) | The only place "documented contents == installed tarballs" and peer-mixture behavior can be proven over packed plain JavaScript. |
| Docs-site generator / Markdown AST / table library / second publish graph / membership change / new published package | **Reject** all | Second runtime or new dependency for a 50-file JSON read; membership change is explicitly 0.3.0 scope (§0.3.0); no new package. |

## 3. Decision freeze

### 3.1 Umbrella wording (Task 1)

- `prism-providers`: "family: **11 of 14** first-party provider adapters (omits Azure, Bedrock, Vertex, which `prism-all` adds separately), including AI SDK interoperability" — wording must assert the count 11, name the three cloud omissions, and never claim "all"/"every" for the provider family. Membership unchanged (11 deps).
- `prism-all`: "broad umbrella: **20 first-party packages** (43 transitive) across runtime, capability, provider, and persistence — omits document-reader, OpenAPI tools, NATS, Caveman, and Ponytail" — wording must name the roadmap's five omissions (which are the complete omission set — verified by the Task 2 generator); the closure is computed in Task 2 and asserted in Task 4. Membership unchanged (20 deps).
- Manifest `description` fields and both package READMEs carry the same corrected wording. `docs/release-and-install.md:20` (already true: "all eleven") stays.
- Freeze: no `dependencies` array in either umbrella changes in 0.2.4; `roadmap.md` §0.3.0 remains the membership-decision owner.

### 3.2 Generator + artifact shape (Task 2)

- `node scripts/package-truth.mjs --out scripts/package-truth.json`; artifact shape (frozen here): `{ generatedAt, root: {name, version}, counts: {publishable, workspace, provider, prismFamily, capability, codeWithPeer, pureManifest}, providers: [14], family: [9], capability: [26], umbrella: { "prism-providers": {deps: [11], omitsProviders: [azure, bedrock, vertex]}, "prism-all": {deps: [20], closure: 43, omits: [5 = document-reader, openapi-tools, session-store-nats, caveman, ponytail] } }, profiles: { "prism-base": [closure], "prism-code": [...], "prism-sdk": [...], "prism-providers": [...], "prism-all": [...] }, peerPolicy: { decision: "A", spec: "<current exact>", atomicUpgrade: true } }`.
- Reproducible: same manifests → byte-identical JSON (modulo `generatedAt`); CI regenerates and asserts equality (tamper detection).
- `docs/release-and-install.md:5` hint replaced by "Generated by `node scripts/package-truth.mjs` → `scripts/package-truth.json`".
- Current-line refresh target: `docs/0.1.0-readiness.md` 0.1.1-era "Current line" block advances to **0.2.4** (50 manifests); **0.1.7 recorded as the terminal 0.1.x baseline**; 0.1.0/0.1.1 tables below stay as historical record. Line 566's 0.0.23 "47 manifests" stays as historical per-release record unless a Task 4 structural test flags it as a current-line contradiction (it will not — it is inside the 0.0.23 publish handoff block).

### 3.3 Peer-version policy (Task 3) — **Decision A**

- **Keep exact pins**: all 43 code packages declare `"@arnilo/prism": "0.2.4"` after the scripted bump (literal replace via `bumpRelease`; the 6 second-peers and the `@dietrichgebert/ponytail` peer advance by the same bump; `file:../..` devDependency unchanged).
- **Atomic-upgrade rule** (documented): all `@arnilo/prism-*` packages must move together at the same version; partial upgrades are unsupported. `validateRelease` enforces internal consistency so release automation can never ship a half-updated set.
- **Supported range story**: third-party `@arnilo/prism-*` adapters peer on the exact current version (0.2.4); the range widens to `^1.0.0` at the 1.x stable release (existing documented policy, literal refreshed).
- **Unsupported mixtures fail clearly**: a mismatch such as `@arnilo/prism@0.2.3` + `@arnilo/prism-coding-agent@0.2.4` fails at install with npm `ERESOLVE` naming the conflicting peer. Packed-install test proves the refusal over local tarballs (network-free).
- **"Mixed supported patches" mapping**: under Decision A no mixed patches are supported; the roadmap's "verify mixed supported patches" requirement is satisfied by verifying the refusal (unsupported mixture fails clearly) and the matched-set clean install. The patch-range option is rejected until compatibility stabilizes (1.0 gate).
- 0.2.4 ships the decision, the refreshed literal, the documentation, and the packed-install verification — no manifest spec change beyond the version bump.

### 3.4 Structural tests + stray text (Task 4)

- Add manifest-derived asserts to `docs.test.ts` (counts, provider membership, umbrella closures + omissions, profile closures, current-line version in `docs/index.md` + `docs/0.1.0-readiness.md`, navigation shape); strengthen the line-243 test to compare against the generated artifact. Never verbatim prose snapshots.
- Remove from `roadmap.md` §0.2.8: the two stray note paragraphs (background observers/Muse Code/Vent; opencode-go profiles) — no acceptance criteria, no task structure. Sweep `docs/**` for truncation markers; retain per-release historical literals (0.0.23 block, 0.1.x handoffs) verbatim.

### 3.5 Performance budget

- Docs-test leg baseline: **4.29 s** (measured 2026-08-14). Generator: sub-second, O(50). Truth asserts: O(1) JSON + O(docs files) grep. Packed journey: one extra local-tarball `npm install` in the existing install-smoke lifecycle. No benchmark regression expected; budget gates unchanged.

## 4. Threat model

| # | Threat | Actor | Asset | Entry point | Trust boundary | Mitigation (test mapping) |
|---|---|---|---|---|---|---|
| T1 | False umbrella closure: host installs `prism-providers` expecting Azure/Bedrock/Vertex and silently gets 11; or `prism-all` expected to include document-reader/NATS/Caveman/Ponytail | Host developer (supply-chain trust) | Install-time dependency closure | `README.md:180/185`, umbrella `description` fields, package READMEs | Host trusts published docs/descriptions as truth | Task 1 rewrites; Task 2 generator computes closure; Task 4 assert wording == closure; Task 5 packed tarball dep counts == 11/31 (roadmap acceptance: "packed-install tests assert documented contents") |
| T2 | Stale current-line version: consumer reads "current line 0.1.1" and pins an ancient line | Consumer (upgrade-guidance) | Version guidance | `docs/0.1.0-readiness.md:3/23/27`, `docs/index.md` | Docs are upgrade guidance | Task 2 refresh to 0.2.4; Task 4 assert current-line version == root manifest version; Task 5 packed root version == docs current line |
| T3 | Hand-maintained count drift: future package add updates manifests but not docs | Contributor (process) | Documentation truth | `docs/release-and-install.md:5` hand-count hint | Manifest = truth; docs = derived | Task 2 generator is the single source; Task 4 assert docs count == artifact; Task 6 CI regeneration equality (roadmap acceptance: "generated checks catch drift") |
| T4 | Peer-version mixture false-green: host mixes `@arnilo/prism@0.2.3` with a `0.2.4` adapter and gets silent incompatibility | Host (upgrade) | Runtime compatibility | `peerDependencies` exact pins | npm peer resolution | Task 3 Decision A documented; packed-install test proves ERESOLVE refusal for mismatched exact pins, clean install for matched set (roadmap acceptance: "unsupported mixtures fail clearly") |
| T5 | Generated-truth artifact tampering: hand-edited `package-truth.json` makes docs match a false claim | Contributor (process) | Generator trust | `scripts/package-truth.json` | Artifact is derived, never authoritative | Task 5/6 CI regenerates and asserts byte-equality (modulo `generatedAt`) |
| T6 | Brittle prose snapshot false-green: docs test hardcodes a count string that drifts | Contributor (process) | Test trustworthiness | `docs.test.ts` string asserts | Tests prove docs | Task 4 derivation asserts (values from artifact, never verbatim prose) — editorial changes stay permitted (roadmap acceptance: "permitting editorial changes") |
| T7 | Stray/truncated roadmap text misread as scope: "Vent"/observer notes in §0.2.8 read as requirements | Contributor (process) | Plan clarity | `roadmap.md` §0.2.8 | Roadmap = scope authority | Task 4 removes the stray paragraphs; no acceptance criteria lost (they never had any) |
| T8 | Stale peer literal misread: "pinned to 0.0.28" read as current policy | Consumer (upgrade) | Policy guidance | `docs/release-and-install.md` Extension notes | Docs = policy | Task 2/3 refresh literal to current version; Task 4 assert no stale 0.0.28/0.1.0/0.1.1 current-line claims outside historical blocks |

All threats are fail-closed in the truth tests: a docs claim contradicting the artifact fails the gate, never proceeds. No fix weakens an existing ownership/redaction/secret-scan/compat-baseline control.

## 5. Owner / migration / budget / protected-environment matrix

| Item | Owner | Migration impact | Rollback | Budget | Protected env |
|---|---|---|---|---|---|
| Umbrella wording (Task 1) | Root README + `prism-providers` + `prism-all` maintainer | Docs-only; no install-resolution change | Restoring 0.2.3 wording restores the false claims (not a mitigation; truth fix is the remediation) | 2 manifest `description` edits (bytes), README text | None (static docs) |
| Generator + tables (Task 2) | `scripts/` maintainer + docs owner | Contributor-facing; canonical count 49→50 where stale, stays 50 where correct | Restoring 0.2.3 restores stale literals | `scripts/package-truth.mjs` + JSON artifact, tarball-excluded | None |
| Peer policy (Task 3) | `scripts/release.mjs` + root manifest owner | Consumer-facing policy documentation; exact pins stay (version literal only) | Restoring 0.2.3 peers restores prior literal | No manifest spec change beyond version bump | Packed installs are network-free local tarballs (install-smoke lifecycle) |
| Structural tests + stray text (Task 4) | `docs.test.ts` maintainer | Contributor-facing; editorial freedom preserved | Restoring 0.2.3 removes the truth gate | O(1) JSON + O(docs) grep in existing leg | None |
| Conformance (Task 5) | CI evidence owner | Verification-only | — | One extra local-tarball install | Postgres matrix unchanged (`PRISM_TEST_POSTGRES_URL`, blocked-visible per 0.2.3 skip manifest) |
| Finalization + bump (Task 6) | Operator `arn` | Version literal 0.2.3 → 0.2.4 across 50 manifests | Store-safe (nothing persisted changes shape) | 50/50 pack dry-run twice byte-identical | Signed tag + npm OIDC after clean protected CI |

## 6. Test mapping (Tasks 1–5)

| Task | Tests |
|---|---|
| Task 1 | `prism-providers` closure honest (11 deps derived; no "all 14"/"every provider" tied to the name); `prism-all` closure honest (20 deps/43 closure; the 5 omissions named; no "every first-party"/"complete umbrella"); no membership change (deps byte-identical to 0.2.3); no over-broad qualifier grep → zero |
| Task 2 | generator reproducible (byte-identical, malformed manifest exits non-zero); counts match manifests (50/49/14/9/26/43/6); closures match manifests (11/31 + omission sets); docs values equal artifact |
| Task 3 | consistent peer spec across 43 code packages; atomic-upgrade rule documented; packed mismatch → ERESOLVE refusal; packed matched set → clean; no `*` peer (grep → zero) |
| Task 4 | derived count/provider membership/umbrella closure/profile closure/current-line version; editorial-permit fixture; stray-text grep → zero outside retained-historical blocks |
| Task 5 | built `dist` export surface + manifest version; artifact tamper detection (regenerate == committed); packed tarball dep counts (11/31); packed peer mixture (Decision A refusal + matched clean); packed current-line == root version; gate accounting names the five roadmap 0.2.4 acceptance criteria |
| Task 6 | contributor-doc tripwires (0.2.4 section, migration note); compatibility sequence (plain gate, expected delta = version literal + description text + additive scripts-only artifacts); release accounting (no silent skip); package truth (50 manifests consistent, deterministic tarballs, artifact regenerated + equal) |

## 7. Documentation/Wiki impact (Task 0)

- Public API or behavior impacted: **no** — Task 0 is evidence-only; Task 1–4 touch docs/manifest descriptions/docs tests only; Task 3 documents (does not change) the peer spec.
- Docs pages to create/edit: `docs/_evidence/phase24-primitive-review.md` (this file, tarball-excluded).
- `docs/index.md` update: no (Task 2 refreshes the current-line entry).
- Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (each task's Documentation/Wiki Assessment already present in the plan).
- No code-wiki task: `.agents/skills/project-wiki/` does not exist (same as 0.2.0–0.2.3).

## 8. Decisions ratified

1. **Peer-version policy = Decision A** (exact pins through 0.2.x; `^1.0.0` at 1.x; atomic-upgrade rule; ERESOLVE refusal for unsupported mixtures). Roadmap bullet 3 acceptance met without a range.
2. **Umbrella wording** corrected per §3.1; membership frozen in 0.2.x; §0.3.0 owns membership.
3. **Current-line refresh** to 0.2.4 (50 manifests); 0.1.7 recorded as terminal 0.1.x baseline; 0.0.23/0.1.x handoff blocks retained as historical record.
4. **Generator** `scripts/package-truth.mjs` → `scripts/package-truth.json` is the single source for counts/tables; artifact shape frozen in §3.2; CI regeneration asserts equality.
5. **Structural truth tests** derive values from the artifact; never verbatim prose snapshots; editorial changes stay permitted.
6. **Stray text**: §0.2.8 background-observer/opencode-go notes removed in Task 4; no acceptance criteria lost.
7. **Corrections to plan-created numbers**: 43 (not 44) code packages carry the `@arnilo/prism` peer; 6 (not 4) carry a second `@arnilo/prism-*` peer (`ag-ui`, `coding-agent`, `coding-security`, `document-reader`, `rag`, `server`); the 6 pure-manifest packages are `prism-all`/`prism-base`/`prism-code`/`prism-compaction`/`prism-providers`/`prism-sdk`.
8. **Budget**: 50-package graph unchanged; scripts-only artifacts; docs-test leg 4.29 s baseline; no new dependency; protected envs unchanged (Postgres matrix + signed-tag/OIDC operator handoff).
