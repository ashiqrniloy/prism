# 068 — Docs progressive disclosure + `prism-execution` skill

Request: stop dumping `docs/` (and plan history) onto the agent hot path. Ship a three-level disclosure model: graft for location, slim `docs/index.md` for current-line navigation, `prism-execution` as the execute-task router. Split `create-plan` so it only writes plans.
Target: **docs + agent skills only**. No runtime API, no lockstep version bump, no new package.
Baseline: `docs/index.md` (75 KB), `docs/migration.md` (165 KB), `docs/release-and-install.md` (185 KB), `src/__tests__/docs.test.ts` (~833 asserts), `.agents/skills/create-plan/`, `AGENTS.md` graft rule.

## Objectives

- Agent hot path never loads release archaeology. History lives under `docs/history/` (and existing `docs/_evidence/`).
- `docs/index.md` is a nav map: current-line headline + grouped links with ≤15-word blurbs. Generated inventory block stays generated.
- `docs.test.ts` freeze policy = **current-line contract**, not changelog. Historical phrase asserts retarget to history/migration corpus so the index slim can land.
- `create-plan` writes plans only. Its Deterministic Execution Loop moves to `prism-execution`.
- `prism-execution` is a router: classify task → 1–2 reference files. It does **not** copy `docs/` and does **not** replace graft.
- Fix current-line drift in `index.md` (0.5.3 headline, 0.2.5 readiness blurb, retired package names, Decision A `0.2.4` pins).

## Expected Outcome

- `docs/index.md` ≤ ~15 KB of hand-written nav (generated inventory excluded). Current line names **0.5.4** run-limits HARD split, not the 0.5.3 tool-result fold.
- `docs/history/` exists; `docs/migration.md` is 0.5.x only; older cuts live in history files. One index line points at the archive.
- `node --test src/__tests__/docs.test.ts` green after freeze retarget + moves.
- `.agents/skills/prism-execution/` validates via skill-creator `quick_validate.py`. SKILL.md < 200 lines. Nine one-level `references/*.md`.
- `.agents/skills/create-plan/SKILL.md` has no execute loop. `prism-wiki.md` forbids changelog blurbs in `index.md`.
- Follow-up (not this plan): strip “0.0.N adds…” from fat API pages (`coding-agent-tools.md`, `acp.md`, `host-security.md`, `provider-packages.md`, `performance.md`).

## Design decisions

| Option | Decision |
|---|---|
| Ingest `docs/` into the skill | **No.** Skill points. Docs stay contract source. Graft stays location source. |
| New `project-wiki` / extra index | **No.** Slimmed `docs/index.md` is the wiki. |
| Keep create-plan execute loop | **No.** Dual routers. Planner writes; `prism-execution` runs. |
| Mention `prism-execution` in `AGENTS.md` | **No.** Always-on tokens. Trigger lives in the skill description. Graft rule stays the only AGENTS.md agent-context line. |
| Strip all 130 API pages in this plan | **No.** Index + archive + freeze + skills. Fat-page changelog strip is Further Actions. |
| Lockstep 0.5.5 | **No.** Docs/skills only. Optional one-line CHANGELOG if a later patch wants it. |
| Delete historical freeze tests | **No.** Retarget paths. Audit trail stays. |
| One-link-per-page for `docs/history/` | **No.** Exclude `history/` like `_evidence/`. One index archive entry. |
| Duplicate `session-stores-and-branching.md` | Keep a stub that points at `session-stores.md` so old links don’t 404. Still one index link. |

## Tasks

- [x] Task 1 — Primitive inventory (no new wiki engine) — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: list every agent-context layer and every `docs.test.ts` rule that blocks an index slim. Confirm this plan is freeze-retarget + file moves + two skill edits, not a docs generator or graft replacement.
    - Performance: inventory-only; no runtime change.
    - Code Quality: no speculative “agent wiki package”; reuse graft + `docs/` + skills.
    - Security: do not weaken fail-closed contract freezes (error codes, permission wire table, generated package-truth). Those stay.
  - Approach:
    - Documentation Reviewed:
      - `AGENTS.md` graft block (2333 B)
      - `docs/index.md` (75 KB), `docs/migration.md` (165 KB), `docs/release-and-install.md` (185 KB), `docs/0.1.0-readiness.md`, `.agents/skills/create-plan/references/prism-wiki.md`
      - `src/__tests__/docs.test.ts` (160 `it()`, 76 touch `index.md`, 77 `apiPages`)
      - `.agents/skills/{create-plan,find-docs,skill-creator}/SKILL.md`
      - `.agents/skills/skill-creator/scripts/{init_skill.py,quick_validate.py}`
      - graft repo map (1504 files / 9 publishable package clusters)
    - Options Considered:
      - New wiki renderer / LLM-wiki over docs: rejected — graft + slim index is enough.
      - Copy contract text into skill references: rejected — drift in a week.
      - Reuse `packages/memory/src/wiki` (Karpathy LLM wiki): rejected — that compiles *codebases/PKM*, not agent docs.
      - Inventory then reuse: chosen.
    - Chosen Approach:
      - Write findings into this task. No code.
    - Findings (inventory result):
      - **Confirmed: freeze-retarget + file moves + two skill edits. No new package, no graft replacement, no docs generator, no wiki engine.**
      - **Agent-context layers (reuse):**
        1. `AGENTS.md` graft (always-on, ~2 KB) — location. CLI: `graft ask/grep/skeleton/callers/map/build`. MCP graft tools hit the same graph. Keep as the only AGENTS.md agent-context block.
        2. `graft/INDEX.md` (15 lines) — browse. Not hot-path.
        3. `docs/index.md` (75 KB, intended nav, actually changelog). `docs/history/` **does not exist**.
        4. `docs/*.md` — 202 markdown files (123 top-level + `providers/` + 59 `_evidence/`). `_evidence/` is 1.3 MB, already one-link-excluded.
        5. `create-plan` — writes plans **and** has Deterministic Execution Loop (`SKILL.md` “When executing a plan”). Dual-router if `prism-execution` is added without deleting this.
        6. `find-docs` — Context7 for **external** libraries. Do not overlap; Prism contracts stay in `docs/`.
        7. `skill-creator` — `init_skill.py` + `quick_validate.py` + `agents/openai.yaml`. Use for Task 6.
        8. `typescript-advanced-types` — unrelated.
        9. **Missing:** `project-wiki/`, `project-patterns/`, `prism-execution/`, `docs/history/`, `isArchivedDoc` / `freezeCorpus`.
        10. User-level ponytail (`~/.pi`) is not a repo skill.
      - **Cause of dump:** `prism-wiki.md` requires every public-API task to add an index entry with a “short functional description”. Agents pad blurbs with plan numbers so freeze tests stay green. `create-plan` then tells executors to read those docs.
      - **Code clusters → nine `prism-execution` reference files (graft map, no new split):** `runtime` (`src/agent-session*`, `createAgent` 145←), `providers` (`packages/prism-providers/*`), `tools` (`prism-coding-tools` agent/security/openapi/computer-use-linux), `persistence` (`prism-core/sessions` + enterprise), `memory` (`packages/memory` compaction/rag/wiki/graft), `interop` (`ag-ui`, `mcp`, `acp-agent`, `prism-core/runtime` A2A/server/workflows), `governance` (`prism-core/governance` + credentials), `office-web` (`office`, `web-tools`), `release` (`src/__tests__/docs.test.ts`, `scripts/`, `.github/workflows/` — not a graft hub; still the 0.5.4 tag-thrash file).
      - **`docs.test.ts` rules that *keep* (do not weaken):** permission `optionId→kind` (`docs/acp.md`); no bare `"prism"` specifier; no `@prism/` scope; generated `package-truth` equality; `apiPages` required headings (What/When/Inputs/…); current `package.json` version on index (`current **${pkg.version}**`, `Current line (0.5.4)`); live **href** asserts (`(cli-rpc.md)`, `(host-security.md)`, …); one-link-per-page for live pages; no `slack.md`/`teams.md`; `computer-use-linux` under `## Tools`; `plans/README.md` lists every `NNN-*.md`; CHANGELOG historical entries.
      - **`docs.test.ts` rules that *block index slim* (Task 2 must retarget off `index.md`):**
        - L249–263 one-link skip list is only `index.md` / `api-page-template.md` / `_evidence/` — add `history/`.
        - L379 retired-package exempt is only `migration.md` / `migrate-to-0.4.md` / `0.1.0-readiness.md` — add `docs/history/**`.
        - L481 `0.1.0-readiness.md` must contain `## Current line (${pkg.version})` — lockstep magnet; retarget off current-line.
        - L612/641/707 `index.includes("**0.2.8**")`; L670 `"**0.2.9**"`.
        - L909 `index.includes("0.1.0 capacity envelopes")`.
        - L1363 `"bounded source lifecycle"`; L1384 `"host reranking, ingestion status"`; L1406 `"identity-bound redacted export"`; L1434–1436 `0.0.15` benchmark/canary recap.
        - L1781 `"workspaceMode"` / `"workspace modes"`.
        - L2019 `"retry transient provider failures"`.
        - L2876–2883 phase37 four phrases (`security-boundary hardening summary`, `realpath-contained`, `prototype-pollution key rejection`, `provider-owned header precedence`).
        - L2911–2919 phase38 eight API-cleanup phrases (`fail-closed omitted capabilities`, `activateAllCapabilities`, `replace-or-error duplicate policy`, … `direct AgentRunResult`).
        - L3066 `"NeuralWatt agent run"`.
        - L3741 `"per-provider explicit/implicit cache matrix"`.
        - L3854–3855 `"applyDefaultProviderRequestOptions"` / `"om:{session.id}"` (keep `Current line (0.5.4)` on the same test).
        - L3953 `"no Prism catalog"`.
        - L4087 `"progressive skill catalog"`.
        - L4101–4111 phase2 OM phrases may use `om.includes || index.includes` — keep OM page; drop index as fallback.
        - L4267 `"0.0.25"`; L4315 `"0.0.26"`; L4435 `"ACP coding-host interop"` is a **title** — keep if the link text stays, else retarget.
      - **Drift already wrong on current index (Task 4):** Current line leads with 0.5.3 tool-result fold, not 0.5.4 run-limits; readiness blurb still “0.2.5 current line”; Release bullet names retired packages (`prism-all`, `prism-prompts`, `prism-evals`, `prism-browser`, `prism-work-tools`, `prism-coding-security`, `prism-impeccable`) and Decision A exact `0.2.4` pins; `graft.md` mentions `prism-all`.
      - **Stubs/moves:** `session-stores-and-branching.md` still one-link-required (keep stub). Primitive-review pages and `migrate-to-0.4.md` / `0.1.0-readiness.md` have no `history/` home yet.
    - API Notes and Examples:
      ```ts
      // docs.test.ts — the two rules that gate every later task
      // 1) one nav link per live page (exclude index, api-page-template, _evidence/, history/)
      // 2) plan-NNN freeze tests must not require index.md to contain **0.2.8** / **0.2.9**
      ```
    - Files to Create/Edit:
      - none (inventory)
    - References:
      - Session analysis: hot-path dump, drift list, 9-file router sketch
      - `plans/067-Run-Limits-Hard-Vs-Host-Policy.md` (freeze-test cost of a docs edit)
  - Test Cases to Write:
    - none (inventory)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — inventory only
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2 — Freeze policy: current-line vs history corpus — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: `docs.test.ts` header states freeze = current-line contract. Historical phrase asserts read a corpus that includes `docs/migration.md`, `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, `docs/performance.md`, and `docs/history/**` (if present). `index.md` is asserted only for current `package.json` version, live page links, generated adapter names, and one archive link each for `_evidence/` and (after Task 3) `history/`.
    - Functional: `markdownFiles("docs")` one-link-per-page skip list includes `history/` the same way as `_evidence/`.
    - Functional: retired-package / stale-count exempt set includes `docs/history/**` (today: `migration.md`, `migrate-to-0.4.md`, `0.1.0-readiness.md`).
    - Functional: delete or retarget asserts that `index.md` must contain `**0.2.8**`, `**0.2.9**`, or “0.2.5 current line”. Keep `plans/README.md` complete-row asserts and CHANGELOG historical entries.
    - Performance: test file still network-free; no new deps.
    - Code Quality: one helper (`freezeCorpus()` or `isArchivedDoc()`) — no parallel test harness.
    - Security: keep contract freezes: permission `optionId→kind`, no bare `prism` specifier, no `@prism/` scope, generated package-truth equality, current version literal.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts` lines 249–263 (one-link), 501–718 (plan 013–029 index `**0.2.x**` asserts), 300–384 (stale-count / retired-package exempt)
      - `src/__tests__/docs.test.ts:153` `markdownFiles()`
    - Options Considered:
      - Delete historical freeze `it()`s: rejected — audit trail.
      - Move tests in the same PR as file moves only: rejected — index slim cannot land until index is no longer the freeze target.
      - Corpus helper now, moves next: chosen.
    - Chosen Approach:
      - Add `isArchivedDoc(relative)` (`_evidence/` or `history/`).
      - Add `freezeCorpus()` concatenating the history-bearing current files + `docs/history/**`.
      - Retarget **every** Task 1 “blocks index slim” phrase off `index.md` (line-numbered list in Task 1 Findings). Not only `**0.2.8**` / `**0.2.9**` — also phase37/38, 0.0.15/0.0.25/0.0.26, OM fallback, construction-helper blurbs.
      - Keep `index.includes(\`current **${pkg.version}\`)` and `Current line (${pkg.version})`.
      - Retarget L481 `0.1.0-readiness.md` `## Current line (${pkg.version})` so readiness is not a lockstep magnet.
      - Do **not** move files in this task. Corpus still finds phrases in `migration.md` / `release-and-install.md` / current index until Task 3–4.
    - Done:
      - `isArchivedDoc` + `freezeCorpus()` in `src/__tests__/docs.test.ts`. Header states freeze = current-line contract.
      - One-link skip + retired-package walk + stale-count walk all exclude `docs/history/`.
      - New `it("archived history/ and _evidence/ prefixes skip one-link indexing")`.
      - Dropped readiness lockstep magnet (`## Current line (${pkg.version})`).
      - Historical recaps (`**0.2.8**`/`**0.2.9**`, `0.0.25`/`0.0.26`, capacity envelopes) → `freezeCorpus()`.
      - Index-only current-contract blurbs retargeted to the API page that already had the token (RAG/memory/retry/phase37–38/NeuralWatt/cache/discovery/066/AI SDK/skills/OM/ACP title). Live hrefs kept on `index.md`.
      - `node --test src/__tests__/docs.test.ts` 151/0. No file moves.
    - API Notes and Examples:
      ```ts
      function isArchivedDoc(relative: string): boolean {
        return relative.startsWith("_evidence/") || relative.startsWith("history/");
      }
      // one-link skip:
      if (["index.md", "api-page-template.md"].includes(relative) || isArchivedDoc(relative)) continue;
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: helper + retarget + skip list
    - References:
      - plan 015 Task 2 comment already excludes `_evidence/` — copy that pattern
  - Test Cases to Write:
    - existing `docs.test.ts` must pass on current tree after retarget (no file moves yet)
    - a unit comment or tiny assert: archived prefix `history/foo.md` is skipped by one-link
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test policy only
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (tests)

- [x] Task 3 — Archive history files — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: `docs/history/` exists with a short `README.md` (what belongs here; do not read on hot path).
    - Functional: `docs/migration.md` retains **0.5.x only** (including 0.5.3 → 0.5.4). Older `## 0.x → 0.y` sections move to `docs/history/migration-0.0.md` … `migration-0.4.md` (group by major line; don’t invent one file per patch unless a freeze test names a heading that needs a stable path).
    - Functional: plan-NNN publish-handoff recaps leave `docs/release-and-install.md`. That page keeps current install, generated inventory, live gates, current peer policy. Recaps go to `docs/history/release-handoffs.md` (or per-line files if freeze headings collide).
    - Functional: `docs/migrate-to-0.4.md` and `docs/0.1.0-readiness.md` move to `docs/history/`. `docs/migrate-to-0.5.md` stays (current line).
    - Functional: primitive-review dumps move: `persistence-credentials-multimodality-primitives.md`, `workflow-orchestration-primitives.md`, `workflow-tui-primitives.md` → `docs/history/`.
    - Functional: inbound local links updated or stubbed. `session-stores-and-branching.md` becomes a 5-line stub pointing at `session-stores.md` (still one index link).
    - Functional: `freezeCorpus()` still sees every frozen historical phrase. `docs.test.ts` green.
    - Performance: no runtime.
    - Code Quality: no hand-edit of `<!-- generated:package-truth` blocks. If `release-and-install.md` generated block moves, regenerate via `node scripts/package-truth.mjs --emit-docs` instead.
    - Security: historical pages may name retired packages; live `docs/*.md` (except stubs) must not present `prism-all` / `@arnilo/prism-prompts` / `@arnilo/prism-evals` / `@arnilo/prism-browser` / `@arnilo/prism-work-tools` / `@arnilo/prism-coding-security` / `@arnilo/prism-impeccable` as current installables.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` heading list
      - `docs/release-and-install.md` generated-block markers
      - `docs.test.ts` freeze `it()` file paths after Task 2
      - `scripts/package-truth.mjs --emit-docs`
    - Options Considered:
      - Delete history: rejected — freeze tests + audit.
      - Keep everything in `migration.md` and only slim index: rejected — agents still open 165 KB when a task says “read migration”.
      - Split by major line into `docs/history/`: chosen.
    - Chosen Approach:
      - `git mv` where possible so history stays. Update relative links. Stubs only for names freeze tests or external links still use at the old path.
    - Done:
      - `docs/history/` live: README + `migration-0.0.md`…`migration-0.4.md` (grouped by FROM major), `release-handoffs.md` (41 `###` handoffs; GitHub Actions pipeline + coverage/evidence/Biome subsections stayed live), `migrate-to-0.4.md`, `0.1.0-readiness.md`, and the three primitive-review pages (all `git mv`).
      - `migration.md` 165 KB -> 16 KB (0.5.x sections + API boilerplate + archive pointer); `release-and-install.md` 185 KB -> 67 KB (all `##` sections + live `###` subsections + archive pointer); generated package-truth block untouched (no regen needed).
      - `session-stores-and-branching.md` -> 3-line stub; removed from `apiPages`; helper asserts retargeted to `session-stores.md`; index link kept.
      - docs.test.ts: `withHistory()` + `migrationDoc()`/`releaseDoc()`/`readinessDoc()` union corpus for presence asserts; live-only reads kept for absence/current-contract asserts; `freezeCorpus()` roots dropped moved files (history walk covers them); plan-057 exempt list updated.
      - Path updates outside docs.test.ts: `packaging.test.ts` (2), `release.test.ts` (0.1.2 handoff), `install-smoke.test.ts` (readiness magnet dropped), `phase24-truth.test.mjs` (readiness magnet dropped), `phase54-legacy-registry.{mjs,test.mjs}` (guide path + URL -> history).
      - Relative links rewritten: history files -> `../`, live docs -> `history/`; link-resolver walk skips `docs/history/`.
      - index.md: five moved-page lines replaced by one `Documentation archive` line; `migrate-to-0.5.md` status line names plan 067.
      - Verified: docs 151/0; dist run docs+packaging+release+export+install-smoke 462/0; phase24/truth-current/packaging-current/phase54/legacy-registry/import-hygiene/dead-export/release-gate/live-doc-check green; tsc clean.
    - API Notes and Examples:
      ```bash
      mkdir -p docs/history
      # after moves:
      node scripts/package-truth.mjs --emit-docs   # only if a generated block was touched
      node --test src/__tests__/docs.test.ts
      ```
    - Files to Create/Edit:
      - `docs/history/README.md` (new)
      - `docs/history/migration-0.0.md` … `migration-0.4.md` (new, content from `migration.md`)
      - `docs/history/release-handoffs.md` (new, content from `release-and-install.md`)
      - `docs/history/migrate-to-0.4.md`, `docs/history/0.1.0-readiness.md` (moved)
      - `docs/history/` primitive-review pages (moved)
      - `docs/migration.md`, `docs/release-and-install.md` (trimmed)
      - `docs/session-stores-and-branching.md` (stub)
      - `docs/migrate-to-0.5.md` (status line: include plan 067 / 0.5.4; drop “055–066” as the whole story)
      - inbound links in `docs/*.md` that pointed at moved files
      - `src/__tests__/docs.test.ts` path updates if a freeze test still hardcodes an old path instead of `freezeCorpus()`
    - References:
      - Task 2 helpers
  - Test Cases to Write:
    - `docs.test.ts` still green
    - one-link-per-page does not require per-file index links under `docs/history/`
    - broken-local-link walk still passes (`all shipped markdown links resolve locally`)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API. Docs **structure** yes.
    - Docs pages to create/edit:
      - `docs/history/*` as listed
      - `docs/migration.md`, `docs/release-and-install.md` trimmed
    - `docs/index.md` update: **yes** — add one Release-and-install archive line pointing at `history/` (full index slim is Task 4; this task only needs the archive link so moved pages are not live orphans). If Task 4 is sequential in the same change set, the archive line can land there; then this assessment is “index archive link in Task 4”.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4 — Slim `docs/index.md` + fix current-line drift — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: hand-written `docs/index.md` (above the generated inventory) is a grouped link map. Each bullet: `[Title](page.md):` + **≤15 words**. No plan numbers, no “0.2.6 adds”, no god-module line counts.
    - Functional: `## Current line (0.5.4)` is ≤5 bullets and leads with run-limits HARD vs host policy (plan 067), not the 0.5.3 tool-result fold.
    - Functional: Release-and-install bullet is short and does **not** name retired packages as live. Current graph = 10 lockstep packages (generated table below).
    - Functional: 0.1.0-readiness index blurb does **not** say “0.2.5 current line”. Point at `history/0.1.0-readiness.md` as 1.0-gates archive.
    - Functional: graft index blurb does not mention `prism-all`.
    - Functional: Decision A / exact `0.2.4` pins are not stated as current policy on the index (current is `^0.5.4` caret lockstep).
    - Functional: live pages still have exactly one index nav link. `computer-use-linux` still indexed under Tools. Generated adapter shorts still linked.
    - Performance: no runtime.
    - Code Quality: do not hand-edit the generated inventory block.
    - Security: do not drop the host-security / credentials links; shorten blurbs only.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md` current groups (Public contracts → Package inventory)
      - `src/__tests__/docs.test.ts` remaining index asserts after Task 2
      - `scripts/package-truth.json` (live package list)
    - Options Considered:
      - Delete most index groups: rejected — one-link-per-page still requires a link.
      - Keep groups, kill changelog blurbs: chosen.
    - Chosen Approach:
      - Rewrite blurbs in place. Keep group headings. One archive bullet for `_evidence/` and one for `history/`.
    - API Notes and Examples:
      ```markdown
      ## Current line (0.5.4)
      - Run limits: HARD is request/response bytes only; policy axes accept `null`.
      - Ten lockstep packages at 0.5.4 (see inventory).
      ```
    - Files to Create/Edit:
      - `docs/index.md`
      - `docs/graft.md` (drop `prism-all` if still present)
      - `docs/coding-agent-tools.md` only if the **index blurb** is the drift; do not strip the whole API page (Further Actions)
    - References:
      - Task 2 remaining index asserts
      - generated inventory comment `<!-- generated:package-truth:inventory -->`
  - Test Cases to Write:
    - `docs.test.ts` green
    - current-line version equals root manifest
    - no index phrase `**0.2.5** current line` / retired-package-as-live
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API. Navigation yes.
    - Docs pages to create/edit:
      - `docs/index.md`: slim + drift fix
      - `docs/graft.md`: drop retired umbrella name if present
    - `docs/index.md` update: **yes** — this task *is* the navigation rewrite. Entry shape: short blurb + link, per group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
    - Done:
      - `docs/index.md` 75 KB -> 20 KB. Every page keeps exactly one nav link (incl. `document-reader`/`indexed-code-search`/`coding-workspaces`/`coding-review-and-diagnostics`, previously buried in the coding-agent-tools blurb); all hand-written blurbs are <=15 words; generated inventory block untouched.
      - Current line (0.5.4): 5 bullets, leads with run-limits HARD vs host policy (plan 067); carries the `current **0.5.4**` lockstep magnet the plan-016/017/023/024 freeze tests assert.
      - Drift fixed: Release-and-install 8 KB plan-012..050 changelog -> one-line install/publication blurb (no retired packages); migration blurb no longer describes the 0.1.4->0.1.5 era; mangled `Migrate 0.4 to 0.5` + doubled archive bullet rewritten as `Migrate 0.5` + archive lines; Decision A / exact pins / `0.2.5 current line` gone.
      - `docs/graft.md`: `prism-all` umbrella mention reworded to "family/umbrella packaging" opt-out.
      - docs.test.ts: new negative test (no `**0.2.5** current line`, no retired `@arnilo/prism-*` names as live).
      - Verified: docs 152/0; packaging/release/install-smoke/phase24/truth/packaging-current/phase54/live-doc-check 147/0; tsc clean.

- [x] Task 5 — `create-plan` planner-only + wiki rule change — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: `.agents/skills/create-plan/SKILL.md` has no Deterministic Execution Loop. One line: executing a plan task → `prism-execution`.
    - Functional: `references/prism-wiki.md` requires: index entry = one sentence, **no plan numbers**, **no changelog**. History → `docs/history/` or `CHANGELOG.md`, not the API page and not the index blurb. “Public API impacted: no” → no `docs/index.md` edit.
    - Functional: plan-writing workflow, numbered files, acceptance-criteria shape, primitive-review-when-new-capability, Documentation/Wiki Assessment fields — kept.
    - Performance: skill body not larger than today (should shrink).
    - Code Quality: no duplicate execute instructions left in create-plan references.
    - Security: wiki rule still requires docs when a **public** API/error/export changes.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/SKILL.md` (execution loop at bottom)
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - skill-creator progressive-disclosure rules
    - Options Considered:
      - Leave execute loop and add prism-execution: rejected — dual routers.
      - Split planner vs executor: chosen.
    - Chosen Approach:
      - Delete loop from create-plan. Point at prism-execution by name (skill may land in Task 6; keep the pointer anyway).
    - API Notes and Examples:
      ```markdown
      ## `/docs` structure
      - `/docs/index.md` is a nav map. Each entry: link + ≤15 words. No plan numbers.
      - Current-line contract lives on the API page (What/When/Inputs/Outputs/Example).
      - Archaeology lives in `/docs/history/` or CHANGELOG, never the index blurb.
      ```
    - Files to Create/Edit:
      - `.agents/skills/create-plan/SKILL.md`
      - `.agents/skills/create-plan/references/prism-wiki.md`
    - References:
      - skill-creator “Concise is Key”
  - Test Cases to Write:
    - none automated (skill markdown). Manual: create-plan description still matches “create/update plans”, not “execute Task N”.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no product API. Agent-skill contract yes.
    - Docs pages to create/edit:
      - none (skills are not `docs/` pages)
    - `docs/index.md` update: no
    - Documentation structure reference: this task **edits** `prism-wiki.md`

    - Done:
      - `create-plan/SKILL.md`: Deterministic Execution Loop (9 steps) deleted; replaced by a 2-line `## Executing a Plan` router -> `prism-execution`. Description no longer claims `execute`; body 104 -> 94 lines.
      - `references/prism-wiki.md`: new `Current-line vs history (plan 068)` section — index entry = one sentence, no plan numbers/version narrative/cuts/line counts; history goes to `docs/history/` or `CHANGELOG.md`, never API-page bodies or index blurbs; API pages carry no release-recap sections; `Public API impacted: no` -> `docs/index.md update: no`. Group list updated to the live index headings. Planner workflow, numbered files, acceptance-criteria shape, primitive-review task, and Documentation/Wiki Assessment fields unchanged.
      - No duplicate execute instructions left in references; no tests pin these skill files.
- [x] Task 6 — `prism-execution` skill — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: skill exists at `.agents/skills/prism-execution/` created via `init_skill.py`, with `agents/openai.yaml`, `references/` only (no scripts, no assets, no README, no CHANGELOG inside the skill).
    - Functional: `SKILL.md` frontmatter `description` triggers on: execute a plan task, implement/fix/refactor in this repo, “do task N”, coding changes against Prism. Does **not** trigger on “write a plan” (create-plan) or “look up a library” (find-docs).
    - Functional: body < 200 lines: graft first; classify → named reference files; universal invariants; plan-task loop (from create-plan); stop conditions (understand-only → graft + one docs page, never `migration.md` / `performance.md` / `_evidence/` / `history/` unless the task is a migration/audit).
    - Functional: nine one-level reference files, each with TOC, graft queries, 3–8 **current** docs links, test globs, don’t-do:
      - `runtime.md` — session, run, loop, events, steer, limits, usage
      - `providers.md` — adapters, request construction, cache, thinking, usage map (adapter pages only when the task names a vendor)
      - `tools.md` — registry, coding tools, sandbox, process, forge, execution policy
      - `persistence.md` — session store, checkpoint, lease, postgres/sqlite, run ledger
      - `memory.md` — compaction, OM, RAG, wiki, skills, prompt assembly
      - `interop.md` — ACP, AG-UI, A2A, MCP, CLI/RPC, server
      - `governance.md` — identity, policy, credentials, redaction, guardrails
      - `release.md` — version bump, exports, freeze tests, workflows, packaging (the 0.5.4 tag-thrash file)
      - `office-web.md` — office / web-tools / browser / obscura
    - Functional: references point at docs; they do not paste API pages. Invariants that apply to every task stay in SKILL.md (fail-closed trust boundary, no new deps, shortest diff after reading the flow, one runnable check, `graft build` after large edits).
    - Functional: `python3 .agents/skills/skill-creator/scripts/quick_validate.py .agents/skills/prism-execution` passes.
    - Performance: SKILL.md body stays under skill-creator 500-line cap (target < 200).
    - Code Quality: no nested references. No duplication of AGENTS.md graft text beyond one line.
    - Security: `release.md` and `governance.md` tell the agent not to weaken fail-closed tests, not to commit secrets, not to expand byte HARD.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/skill-creator/SKILL.md` (anatomy, progressive disclosure, init/validate)
      - `.agents/skills/skill-creator/scripts/init_skill.py`
      - `.agents/skills/skill-creator/references/openai_yaml.md` (read on execute)
      - `AGENTS.md` graft
      - current `docs/index.md` groups (post Task 4) as the classification table source
    - Options Considered:
      - One giant SKILL.md: rejected — dumps the same problem into the skill.
      - One reference per docs page (~130): rejected — not a router.
      - Nine code-cluster references: chosen.
    - Chosen Approach:
      ```bash
      python3 .agents/skills/skill-creator/scripts/init_skill.py prism-execution \
        --path /home/arn/Projects/prism/.agents/skills \
        --resources references \
        --interface display_name="Prism execution" \
                    short_description="Execute Prism plan tasks without dumping docs/" \
                    default_prompt="Execute the next unchecked plan task using prism-execution."
      python3 .agents/skills/skill-creator/scripts/quick_validate.py \
        /home/arn/Projects/prism/.agents/skills/prism-execution
      ```
    - API Notes and Examples:
      ```markdown
      # SKILL.md classify table (sketch)
      | Task mentions | Read |
      |---|---|
      | RunLimits, usage, steer, session | references/runtime.md |
      | provider adapter, thinking, cache tokens | references/providers.md |
      | version, npm, freeze, tag, CHANGELOG | references/release.md |
      ```
    - Files to Create/Edit:
      - `.agents/skills/prism-execution/SKILL.md`
      - `.agents/skills/prism-execution/agents/openai.yaml`
      - `.agents/skills/prism-execution/references/{runtime,providers,tools,persistence,memory,interop,governance,release,office-web}.md`
    - References:
      - skill-creator init/validate
      - Task 1 inventory of graft vs docs vs skills
  - Test Cases to Write:
    - `quick_validate.py` exit 0
    - SKILL.md line count < 200 (manual/wc in the task check)
    - each reference file is linked from SKILL.md (one level)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no product API
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no — skills are not product pages; do not add an index entry
    - Documentation structure reference: not applicable

    - Done:
      - Created via `init_skill.py` (needed `python3 -m ensurepip` + `pip install pyyaml` first). `quick_validate.py` exit 0.
      - `SKILL.md` 84 lines: graft-first section (`graft ask/skeleton/callers/grep`, `graft build` after big edits), 9-row classify table linking every reference exactly once, universal invariants (fail-closed boundaries, no new deps, shortest diff after reading the flow, one runnable check, root cause, no secrets, byte HARD caps stay), the plan-task loop moved from create-plan (8 steps), stop conditions (understand-only = graft + one page; never migration/performance/_evidence/history unless the task is one; never paste API pages; references one level).
      - `references/`: runtime, providers, tools, persistence, memory, interop, governance, release, office-web — each with Docs (3-8 current pages), graft queries, real test globs (verified against `src/__tests__/` + workspace layout), don't-do, adjacent-page line. All 68 relative links resolve (fixed depth `../../..` -> `../../../..`). No nested references; no duplication of AGENTS.md graft text.
      - `release.md` + `governance.md` carry the security don't-dos: never weaken fail-closed tests, no secrets in argv/logs/events/tests (`scripts/live.env` local-only), byte HARD caps stay.
      - No scripts/assets/README/CHANGELOG inside the skill. docs suite still 152/0.
- [x] Task 7 — Verify gates + list the plan — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: `node --test src/__tests__/docs.test.ts` pass. `npx biome format --write` on touched files; `format:check` clean.
    - Functional: `plans/README.md` lists `068-Docs-Progressive-Disclosure-And-Prism-Execution.md`.
    - Functional: skill validate still green. create-plan SKILL.md has no execute loop (grep).
    - Performance: docs tests remain network-free.
    - Code Quality: no leftover `TODO` in the new skill template sections.
    - Security: `scripts/live.env` still gitignored; no secrets in skill files.
  - Approach:
    - Documentation Reviewed:
      - this plan’s tasks 2–6 file lists
    - Options Considered:
      - Full `npm test`: unnecessary for docs/skills; run docs.test + format + skill validate. Broader suite only if a freeze helper import breaks something.
    - Chosen Approach:
      ```bash
      node --test src/__tests__/docs.test.ts
      npx biome check --write src/__tests__/docs.test.ts
      python3 .agents/skills/skill-creator/scripts/quick_validate.py .agents/skills/prism-execution
      ```
    - Files to Create/Edit:
      - `plans/README.md` (this plan’s row; may already exist from plan creation)
      - this plan: checkboxes, Compromises, Further Actions
    - References:
      - Task 2–6
  - Test Cases to Write:
    - none new
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable

    - Done:
      - `plans/README.md`: plan 068 row present, status flipped `in progress` -> `complete`.
      - Gates: `npx biome format --write src/__tests__/docs.test.ts` clean (no fixes needed); repo-wide `format:check` 1498 files clean; dist docs suite 152 pass / 0 fail (network-free, local file reads); `quick_validate.py prism-execution` valid; create-plan has no execution loop (only the 2-line `Executing a Plan` router); zero `TODO` in skill files; `scripts/live.env` still gitignored; skill files contain no secrets (filenames only).
      - Housekeeping: removed `__pycache__` generated by the validator under skill-creator/scripts. Unstaged deletion of root scratch file `prism-run-limits-hard-vs-host-policy.md` (the plan-067 feature request) matches the established consume-into-plan pattern and stays recoverable in git history (committed at de0b22e1); left deleted in the plan-068 commit.

## Compromises Made

Known before execution (do not expand scope to dodge them):

- `docs.test.ts` currently pins historical plan recaps into `docs/index.md` (`**0.2.8**`, `**0.2.9**`, 0.1.0 capacity envelopes, `_evidence/` repeats). Task 2 must land first or Task 4 cannot pass CI.
- One-link-per-page remains for **live** pages — index stays a full catalog, just not a changelog.
- Generated `package-truth` blocks are not rewritten by hand.
- Fat API-page “0.0.N adds” stripping is out of scope.
- No runtime/semver bump.

## Further Actions

To be filled after task completion. Intended follow-up (not this plan):

- Strip changelog sentences from fat API pages: `coding-agent-tools.md`, `acp.md`, `host-security.md`, `provider-packages.md`, `performance.md` (current envelopes only).
- Optional: word-count budget test on `docs/index.md` hand-written section (fail if a blurb exceeds 15 words) — only if drift returns.
