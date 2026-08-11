# Release 0.1.6 — Coding-agent capability closeouts (demand-gated)

Roadmap phase: `roadmap.md` § **0.1.6 — Coding-agent capability closeouts (demand-gated)**.
Baseline: `@arnilo/prism` **0.1.5** (plan 017 breaking cut; 49 publishable manifests; audit 0 at moderate; compat baselines regenerated with recorded breaks).
Target: `@arnilo/prism` **0.1.6**, additive-only against the post-0.1.5 surface.

This milestone is **demand-gated end to end**. Every closeout requires a named demand record (host, integration, or operator) captured in the Task 0 freeze manifest **before** its implementation task may start. A closeout with no demand evidence stays deferred; the release may cut with any subset of closeouts shipped, and the changelog records each deferred closeout and its gate, per Priority/Dependency Rule 6 and Release Validation Checklist rule "no blocker converted into a skip."

Candidate closeouts (from `roadmap.md` §0.1.6, §Tools for coding agents, §Security review, and plans 003/004/010/012 further actions):

1. **Durable ACP session store** — the ACP live task registry in `packages/ag-ui/src/acp/` is in-memory (cap 512, FIFO, no persistence; modes/config report table defaults). Add a host-owned persistence seam so sessions survive restart without the agent persisting anything itself (plan 010/012 further actions; 0.1.1 shipped the ownership-scoping guidance this must implement).
2. **Native sandbox backend (network-free)** — `packages/coding-security` ships only the Docker reference `SandboxAdapter`. Add a network-free, dependency-free native backend (process spawn + rlimits + path containment) for hosts that cannot run Docker (plan 012 further action).
3. **PDF/Office document reader** — a bounded, host-selected parser adapter feeding the existing read/tool surface; no parser dependency in core (plans 004/roadmap non-goals; demand-gated).
4. **Recursive `delete` + brace-expanding `glob`** — extend `packages/coding-agent/src/delete.ts` and `glob-match.ts` only if pattern/usage demand justifies it (plan 004 further actions).
5. **Checkpoint persistence for loaded-skill bodies + full `ReadPathSet` state** — only if 0.1.3's opt-in names-only persistence (plan 015 Task 4, `createReadPathSetPersistence`) proves insufficient for a named host's resume flow (plans 003/004 further actions).

## Objectives

- Close only the coding-agent capability gaps that arrive with named demand evidence; defer the rest loudly, never silently.
- Put every shipped closeout behind a host-owned, explicit-activation seam: no persistence, sandbox backend, parser, or glob/delete behavior activates by import or discovery.
- Keep the additive-only 0.1.x promise: no breaking change against the post-0.1.5 `docs/public-contracts.md` surface; compat baseline stays green without `--allow-break`.
- Preserve the security posture: deny-by-default sandbox/egress, ownership-scoped persistence, literal-only search, redaction at boundaries, `npm audit` 0 at moderate.
- Run primitive review and a threat model before any closeout implementation (roadmap acceptance for 0.1.6).

## Non-goals

- No model-only Cursor/Antigravity integration (0.2.0 Module A, delegated agents — roadmap conclusion).
- No new module outside the five listed closeouts; no 0.2.0 enterprise adapters (Cedar, second object store, OpenAPI pagination).
- No second runtime, hosted product, control plane, or implicit activation (Product Boundaries).
- No parser or sandbox dependency added to the dependency-free core; adapters live in optional packages with optional peer dependencies.
- No recursive-delete/brace-glob implementation without recorded demand; the hand-rolled `*`/`?`/`**` matcher stays the default either way (plan 004 compromise).
- Final code-wiki task: `.agents/skills/project-wiki/` does not exist.

## Expected Outcome

- A demand-gate registry (`scripts/phase18-freeze-manifest.json`) records each closeout as `demanded` (with named evidence) or `deferred` (with gate); only `demanded` closeouts have implementation tasks checked off.
- Each shipped closeout has: a primitive-review record, a threat-model section, adversarial tests, budget/security gates green, and matching `/docs` + `docs/index.md` updates.
- ACP sessions, if shipped, restore across restart through a host-supplied store keyed by `sessions.ownership`; cross-tenant restore refuses with `ERR_PRISM_ACP_INPUT`; the agent process itself still persists nothing.
- The native sandbox backend, if shipped, passes the same `SandboxAdapter` conformance surface as the Docker reference with network disabled by construction; Docker stays the documented reference.
- The document reader, if shipped, is a bounded host-selected adapter with size/page caps, no core dependency, and literal-only content handling.
- Recursive delete / brace glob, if shipped, are opt-in flags with fail-closed defaults and adversarial path-traversal tests.
- Checkpoint body persistence, if shipped, is opt-in (size ceiling documented) and restores loaded-skill bodies + read-path state without cross-branch leakage.
- Deferred closeouts are recorded in the changelog and `## Further Actions` with their demand gates intact; release gates (`sdk:ready`, docs tripwires, audit, pack dry-run) green regardless of which subset ships.

## Tasks

- [x] Task 0 — Freeze record, demand-gate registry, and 0.1.5 baseline evidence
  - Acceptance Criteria:
    - Functional: create `scripts/phase18-freeze-manifest.json` with target 0.1.6, baseline 0.1.5, type `demand-gated-closeouts`, the five closeout entries each with `id`, `status: demanded|deferred`, `demandEvidence` (named host/integration/operator + date, empty when deferred), allowed files, forbidden scope, empty deviations, and task tokens. Initial status is `deferred` for all five; a closeout flips to `demanded` only by committing named evidence to this manifest.
    - Functional: create `scripts/phase18-baseline.json` recording 0.1.5 test/audit/release-gate status, 49-manifest graph, and declaration hashes of the seams each closeout touches: `packages/ag-ui/src/acp/*`, `SandboxAdapter` exports in `packages/coding-security/src/index.ts`, `packages/coding-agent/src/{delete.ts,glob-match.ts,coding-checkpoint.ts,read-path-set.ts}`, and the skill-load surface in `src/skill-load.ts`.
    - Functional: `scripts/phase18-freeze.test.mjs`, wired after phase 17 in root `npm test`, validates manifest schema, demand-evidence shape for every `demanded` entry, baseline recency, and — once task tokens move to done — that implementation diffs touched only files allowed by `demanded` closeouts (a `deferred` closeout with implementation diff fails loud).
    - Performance: freeze adds one stdlib-only test under 5 seconds; no runtime hot-path change.
    - Code Quality: reuse phase-15/16/17 freeze/baseline JSON shape and Node test conventions; no new framework.
    - Security: the manifest forbids changes to deny-by-default sandbox/egress defaults, literal-only search, and ownership-scoping refusals introduced in plan 013 Task 5.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.1.6, §Priority and Dependency Rules (rules 3, 6, 7), §Versioning Policy, §Release Validation Checklist.
      - `plans/015` Task 0, `plans/016` Task 0, `plans/017` Task 0 freeze/baseline pattern.
      - `docs/acp.md` "Persistence and ownership" (plan 013 Task 5) — the contract a durable ACP store must honor.
    - Options Considered:
      - One plan per closeout (literal roadmap wording "each closeout behind its own plan"): rejected for planning; the milestone is one release, and per-closeout primitive-review + threat-model tasks satisfy the intent without five near-empty plan files. Each shipped closeout still gets its own review/threat-model record inside this plan.
      - Demand-gate registry in the freeze manifest: chosen; makes "no named user, no plan" machine-checkable instead of prose.
    - Chosen Approach:
      - Single milestone plan with a machine-checked demand gate; closeout tasks below are inert until the manifest records demand.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase18-freeze.test.mjs
      node scripts/release.mjs gate --version 0.1.5
      ```
    - Files to Create/Edit:
      - `scripts/phase18-freeze-manifest.json`: demand-gate registry + scope gate.
      - `scripts/phase18-freeze.test.mjs`: freeze and gate tripwires.
      - `scripts/phase18-baseline.json`: 0.1.5 pre-change evidence.
      - `package.json`: append phase-18 freeze test to `npm test`.
    - References:
      - `plans/015-Release-0-1-3-Dead-Code-Deprecation-Hygiene.md` Task 0.
      - `plans/017-Release-0-1-5-Deprecated-Option-Removal.md` Task 0.
  - Test Cases to Write:
    - manifest schema validation: all five closeouts present, valid status enum.
    - demanded-without-evidence: freeze test fails when `status: demanded` has empty `demandEvidence`.
    - deferred-with-diff: freeze test fails when a `deferred` closeout's allowed files appear in the implementation diff.
  - **Done (2026-08-11, HEAD fc914aa).** `scripts/phase18-freeze-manifest.json` created with the five-closeout demand-gate registry (all `deferred`, empty evidence, disjoint allowed-file scopes); `scripts/phase18-baseline.json` captures 0.1.5 evidence (npm test exit 0, core 1428/1428, script gates 173/173 at Task 0 — 190/190 after wiring the 17 new freeze tests, workspaces green; audit 0 moderate; release:gate 0.1.5 green 49 packages 0 breaking deltas; 49 publishable manifests) plus sha256 seam hashes for every closeout scope; `scripts/phase18-freeze.test.mjs` (17 tests) implements the demand state machine (pending ⇒ seam files byte-identical/absent, done ⇒ closeout demanded with named evidence, exit gate null-until-Task-7 with green assertions); package.json `npm test` wired with phase18 after phase17; plans/README.md row added. Phase-17 baseline snapshot evidence preserved under the new baseline (this file supersedes nothing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — planning/gating artifact only.
    - Docs pages to create/edit:
      - `none`: freeze manifests are release tooling, not public surface (precedent: plans 015–017 Task 0).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; no docs-required trigger.

- [x] Task 1 — Primitive review and threat model for demanded closeouts (gate: ≥1 closeout `demanded`)
  - Acceptance Criteria:
    - Functional: for every `demanded` closeout, write a primitive-review section in this plan (or `docs/_evidence/phase18-primitive-review.md` if it outgrows the plan) inventorying the existing primitives it must reuse: `SandboxAdapter`/`DisposableSandbox` (`packages/coding-security/src/index.ts`), ACP session/modes/agent modules (`packages/ag-ui/src/acp/`), `createReadPathSetPersistence` + checkpoint codecs (`packages/coding-agent/src/coding-checkpoint.ts`, `packages/session-store-codecs`), `glob-match.ts` matcher, `delete.ts` guards, `SecretRedactor` boundary, `sessions.ownership` scoping.
    - Functional: document what each closeout can achieve with existing primitives alone; propose only generic, reusable new primitives where a real gap exists (e.g., a host-owned `AcpSessionStore` interface); reject closeout-specific logic in core.
    - Functional: write a threat model per demanded closeout covering: cross-tenant state leakage, path traversal / symlink escape (delete/glob/reader), resource exhaustion (reader size/page caps, sandbox rlimits, glob fan-out), secret leakage through restored session/tool payloads, and fail-closed behavior when optional peer dependencies are absent.
    - Performance: state the budget impact of each new primitive (package-size gate in `budgets.json`, no core growth).
    - Code Quality: no single-implementation speculative interface; a new seam requires the demanded closeout as its concrete first consumer.
    - Security: threat model reviewed before implementation; every identified risk maps to a test in the closeout task.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/SKILL.md` primitive-review rule (rule 6).
      - `roadmap.md` §Existing strengths (neutral seams), §Security review, §Product Boundaries.
      - `packages/coding-security/src/index.ts` exported sandbox seam; `packages/ag-ui/src/acp/` module layout; `docs/acp.md`.
    - Options Considered:
      - Skip review for "small" closeouts (recursive delete): rejected; roadmap §0.1.6 acceptance requires primitive review + threat model per closeout.
      - Shared review document covering only demanded closeouts: chosen; deferred closeouts get reviewed when demand arrives.
    - Chosen Approach:
      - Review-first, evidence in-repo, tests derived from the threat model.
    - API Notes and Examples:
      ```ts
      import type { SandboxAdapter, DisposableSandbox } from "@arnilo/prism-coding-security";
      import { createReadPathSetPersistence } from "@arnilo/prism-coding-agent";
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase18-primitive-review.md`: primitive inventory + per-closeout threat models (excluded from tarball, like other evidence).
      - `plans/018-...md`: check off with review summary.
    - References:
      - `plans/004-Release-0-0-21-Coding-Tool-Capability-Gaps.md` (glob/delete ceilings).
      - `plans/010-Release-0-0-27-ACP-Coding-Host-Interop.md` (ACP in-memory registry compromise).
  - Test Cases to Write:
    - threat-model traceability: every risk listed has a matching test name recorded for its closeout task (checked in the freeze test's done-phase validation).
  - **Done (2026-08-11).** Gate satisfied: `acp-session-store` flipped to `demanded` in `scripts/phase18-freeze-manifest.json` with named evidence (Clay, 2026-08-11, resume workflow) and mirrored in `scripts/phase18-baseline.json`. Review delivered in `docs/_evidence/phase18-primitive-review.md`: primitive inventory (existing `AcpSessionStoreSeams` protocol store, `authorize`→`AgUiAuthorization.ownership`, in-memory `ActiveSession` registry cap 32/128, `modes`/`configOptions` rehydration helpers, `resolveSessionInputs` policy checks, `SecretRedactor`, session-store package precedents); gap analysis (registry is closure-scoped and lost on restart; mode/config recompute from defaults per `docs/acp.md`); one generic host-owned `AcpSessionStore` seam (`save`/`loadAll`/`evict`, ownership-keyed, frozen `PersistedSession` shape excluding ephemeral stream state, explicit activation); 9-risk threat model (T1 cross-tenant `ERR_PRISM_ACP_INPUT` refusal … T9 oversized-entry refusal) each mapped to a Task 2 test; stale `docs/acp.md` "0.2.0 Module E" label flagged for Task 2. Other four closeouts remain deferred and unreviewed by design.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review artifact precedes implementation.
    - Docs pages to create/edit:
      - `docs/_evidence/phase18-primitive-review.md`: new evidence file (tarball-excluded).
    - `docs/index.md` update: no (evidence folder is linked from readiness docs, not the navigation map).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` — evidence, not an API page.

- [x] Task 2 — Durable ACP session store behind a host-owned seam (gate: `acp-session-store` `demanded`)
  - Acceptance Criteria:
    - Functional: introduce a minimal `AcpSessionStore` host-owned seam (save/loadAll/evict) consumed by `packages/ag-ui/src/acp/agent.ts`; the in-memory registry remains the default when no store is supplied; when supplied, live tasks + modes/config restore across agent restart.
    - Functional: all persisted records are keyed by `sessions.ownership`; restore with mismatched ownership refuses with `ERR_PRISM_ACP_INPUT` (extends the plan 013 Task 5 contract from guidance to enforcement).
    - Functional: explicit activation only — no store is constructed, opened, or written by import or discovery; the agent process itself still persists nothing.
    - Performance: restore path is O(active sessions) with the existing 512 cap preserved; no per-prompt persistence on the hot path beyond the current registry update cost; budget gate green.
    - Code Quality: seam mirrors the existing session-store package pattern (`packages/session-store-*`); no ACP-specific logic leaks into core.
    - Security: threat-model risks enforced by tests — cross-tenant restore refusal, redaction of persisted prompt/tool payloads at the store boundary, fail-closed on corrupt records (session dropped + error surfaced, never merged).
  - Approach:
    - Documentation Reviewed:
      - `docs/acp.md` "Persistence and ownership".
      - `plans/010` (ACP compromises: in-memory registry, modes/config table defaults), `plans/012` further actions.
      - `packages/session-store-sqlite` / `session-store-postgres` as host-owned store references.
    - Options Considered:
      - Agent-side SQLite persistence built in: rejected — violates "host owns storage topology" and explicit activation.
      - Host-owned seam with in-memory default: chosen; matches every other Prism durability seam (event source, effect store, approvals).
    - Chosen Approach:
      - `AcpSessionStore` interface + ownership-scoped serialization; conformance-style tests in the owning package; hosts plug their own store (SQLite/Postgres codecs reusable).
    - API Notes and Examples:
      ```ts
      const agent = createAcpAgent({
        // ...existing options
        sessionStore: hostStore, // optional; absent = in-memory (today's behavior)
      });
      // restore rejects cross-tenant: ERR_PRISM_ACP_INPUT
      ```
    - Files to Create/Edit (tentative pending Task 1 review):
      - `packages/ag-ui/src/acp/session-store.ts`: seam + serialization.
      - `packages/ag-ui/src/acp/agent.ts`: consume optional store.
      - `packages/ag-ui/src/acp/__tests__/session-store.test.ts`: new tests.
    - References:
      - `docs/acp.md`; `plans/013` Task 5.
  - Test Cases to Write:
    - restart restore: sessions/modes/config survive a simulated agent restart with a host store.
    - default unchanged: no store ⇒ in-memory behavior identical to 0.1.5 (cap 512, FIFO).
    - cross-tenant refusal: ownership mismatch ⇒ `ERR_PRISM_ACP_INPUT`, no state merged.
    - corrupt record: fail-closed drop + surfaced error.
    - redaction: persisted payloads pass through the redactor boundary.
  - **Done (2026-08-11).** `AcpSessionStore` seam shipped in `packages/ag-ui/src/acp/session-store.ts` (`save`/`loadAll`/`evict`, `PersistedAcpSession` frozen shape, `ownershipKey`, `validatePersistedSession` byte caps), consumed in `packages/ag-ui/src/acp/agent.ts` via `options.sessionStore`: save on `session/new`/`set_mode`/`set_config_option` (redactor applied at the store boundary), lazy `loadAll` once per agent on first authorized touch with per-authorization merge (cross-tenant entries never merged — T1), restore re-validates cwd/directories/mode/config against the seams and drops corrupt/oversized/cap-full entries fail-closed (T3/T5/T8/T9), `evict` on close/delete, protocol `load`/`resume` idempotent only for seam-restored ids so the frozen duplicate-load rejection is preserved. 8 threat-model tests in `packages/ag-ui/src/__tests__/acp-session-store.test.ts` (ag-ui suite 187/187); `docs/acp.md` persistence section rewritten (stale "0.2.0 Module E" label fixed) and `docs/index.md` ACP entry extended. Deviations from the plan literal, per the Task 1 primitive review: the plan said "load/save/list/evict" and "cap 512" — the review found the in-memory cap is 32 default / 128 hard (`packages/ag-ui/src/limits.ts`) and the registry has no protocol `list`; the seam implements `save`/`loadAll`/`evict` and the real caps are preserved unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional seam on the ACP agent surface.
    - Docs pages to create/edit:
      - `docs/acp.md`: "Durable session store" subsection (seam shape, ownership enforcement, activation), using the API page structure for the new interface.
    - `docs/index.md` update: yes — extend the existing ACP navigation entry description with durable-session support.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Network-free native sandbox backend (gate: `native-sandbox` `demanded`)
  - Acceptance Criteria:
    - Functional: implement a native `SandboxAdapter` backend (process spawn + OS resource limits + existing `path-containment.ts`) in `packages/coding-security` alongside `docker-sandbox.ts`; no container runtime, no network namespace tooling, zero new runtime dependencies.
    - Functional: network denial is by construction (no network setup at all) or by the strongest available per-platform mechanism; platforms where denial cannot be enforced fail closed at adapter creation with a documented error rather than silently allowing egress.
    - Functional: passes the same adapter conformance surface as the Docker reference (exec, files, status, dispose); Docker remains the documented reference backend.
    - Performance: exec startup overhead measured and recorded in the benchmark evidence envelope; no regression to the Docker path; package-size budget green.
    - Code Quality: reuses `SandboxAdapter`/`DisposableSandbox` contracts unchanged; platform differences isolated behind one internal module, no per-call branching.
    - Security: threat-model risks enforced — rlimit/timeout enforcement, path containment on every file op, no shell interpolation beyond the existing command-rules layer, redaction of process output at the boundary, fail-closed on unsupported platform.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-security/src/{docker-sandbox.ts,sandbox.ts,path-containment.ts,command-rules.ts}`.
      - `roadmap.md` §Security review and §Product Boundaries (deny-by-default, explicit activation).
      - Node `child_process` docs (`stdio`, `uid/gid`, `timeout`) — current Node 20/22/24 API surface.
    - Options Considered:
      - Bubblewrap/seatbelt profiles per platform: deferred — platform-specific binaries contradict "network-free, dependency-free"; revisit only with demand for hardening beyond rlimits.
      - Node-native spawn + rlimits + containment: chosen; smallest backend that satisfies the seam on supported platforms and fails closed elsewhere.
    - Chosen Approach:
      - One `native-sandbox.ts` implementing `SandboxAdapter`; unsupported-platform detection at creation, never at exec time.
    - API Notes and Examples:
      ```ts
      import { createNativeSandbox } from "@arnilo/prism-coding-security/native";
      const sandbox = createNativeSandbox({ root, limits }); // throws on unsupported platform
      ```
    - Files to Create/Edit (tentative pending Task 1 review):
      - `packages/coding-security/src/native-sandbox.ts`: backend.
      - `packages/coding-security/src/index.ts` (+ subpath export if chosen): export behind existing barrel conventions.
      - `packages/coding-security/src/__tests__/native-sandbox.test.ts`: conformance + adversarial tests.
    - References:
      - `plans/012` further action (native sandbox backend).
  - Test Cases to Write:
    - conformance parity: same assertions as Docker adapter where environment permits.
    - egress denial: outbound connection attempt fails inside the sandbox (or adapter refuses creation on platforms that cannot guarantee it).
    - resource limits: CPU/time/output cap enforced and reported.
    - path escape: `../` and symlink escapes rejected.
    - unsupported platform: creation fails closed with documented error.
  - **Done (2026-08-11).** Demand record: operator (arn) instruction to complete Task 3 with the `native-sandbox` gate demanded (manifest `demandEvidence` + baseline mirror updated). Primitive review + threat model (T1-T8) extended in `docs/_evidence/phase18-primitive-review.md`. `createNativeSandbox` shipped in `packages/coding-security/src/native-sandbox.ts` and exported from `index.ts`: Linux-only with creation-time fail-closed preflight (`unshare` netns probe: `--net` then `--map-root-user`; neither works ⇒ `ERR_PRISM_NATIVE_SANDBOX` refusal, never a network-enabled fallback); every command runs in a fresh netns (loopback down — live egress probe asserts ENETUNREACH inside vs host-loopback positive control); `ulimit` hard caps (`-v` RLIMIT_AS ← `memoryBytes`, `-t` RLIMIT_CPU ← wall backstop, `-n` RLIMIT_NOFILE ← `maxFds`) with `|| exit 126` fail-closed prefix; `execFile` via `exec "$@"` (argv only, never shell-interpolated; NUL rejected); cwd containment via `assertPathInsideRoots` (symlink-aware, escape symlink rejected in tests); detached process-group kill covering sh + command + grandchildren on timeout/abort/output-cap/stop/kill/close; env exact allow-list (PATH-only default, host env never inherited) with name/byte caps; secret redaction at every error boundary; `close({ export })` bounded-tar parity via `createImportTarStream` single-pass tee with `SandboxExportMetadata`; `status`/`stop`/`kill` state machine mirroring the Docker reference. 16 tests in `packages/coding-security/src/__tests__/native-sandbox.test.ts` (coding-security suite 94 green; live netns tests skip when the environment denies netns, mirroring the repo's network-free guard). Docs: `docs/coding-security.md` native-backend section + `docs/index.md` sandbox entry. Documented parity gaps vs Docker (in review + docs): no `startProcess` (ProcessSessions fails closed `ERR_PRISM_PROCESS_UNSUPPORTED`), no CPU-rate/pids/fs-size caps (cgroup-only), no fs isolation (pair with `createSandboxFilesystemOperations` + approval policy), no import identity (root IS the workspace). Interpretation recorded: plan's "no network namespace tooling" read as shipping no netns management code; the OS `unshare` binary is the only zero-dependency egress-denial mechanism for a spawn.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported backend on `coding-security`.
    - Docs pages to create/edit:
      - `docs/sandbox.md` (or the existing sandbox/security page per `docs/index.md`): native backend section — when to use, platform support matrix, limits vs Docker, security notes.
    - `docs/index.md` update: yes — sandbox entry description updated with the native backend.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — PDF/Office document reader as a bounded host-selected parser adapter (gate: `doc-reader` `demanded`)
  - Acceptance Criteria:
    - Functional: a new optional package (e.g., `packages/document-reader`) exposing a parser adapter consumed by the coding read surface; PDF and Office formats behind host-selected parser wiring with an optional peer dependency on the parser library; fails closed with a documented error when the peer is absent.
    - Functional: bounded by construction — size cap, page/sheet cap, and literal text extraction only (no embedded-script execution, no external resource fetching, no macro evaluation).
    - Functional: explicit activation — the adapter is passed to the read/tool surface by the host; no file-extension sniffing activates parsing by default.
    - Performance: extraction time and memory recorded against `budgets.json`; a max-size document completes within the recorded envelope or refuses with a size error; package-size gate green; core untouched (49+1 manifests, zero core deps).
    - Code Quality: thin adapter — parsing delegated to the peer library; Prism code owns bounds, errors, and redaction only.
    - Security: threat-model risks enforced — decompression/size bombs refused, no network fetch of embedded resources, extracted text passed through the existing content/redaction path, parser advisory reviewed (`npm audit` clean).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §Tools for coding agents (coding gaps), §Non-Goals, §Product Boundaries.
      - `packages/coding-agent/src/read.ts` and `bounded-file.ts` (existing bounds to reuse).
      - Current docs for the chosen parser library (record exact name/version/sections here once the demand record names the required formats).
    - Options Considered:
      - In-core hand-rolled PDF parsing: rejected — core stays dependency-free; PDF parsing is exactly the "optional package" boundary the roadmap draws.
      - Optional package + optional peer parser: chosen; matches provider/LSP/forge packaging precedent.
    - Chosen Approach:
      - Bounded adapter package; host wires it; read surface accepts an optional document-reader slot.
    - API Notes and Examples:
      ```ts
      const read = createReadTool({
        // ...existing options
        documentReader: createPdfOfficeReader({ maxBytes, maxPages }), // optional
      });
      ```
    - Files to Create/Edit (tentative pending Task 1 review and demand record):
      - `packages/document-reader/{package.json,src/index.ts,src/__tests__/}`: new adapter package.
      - `packages/coding-agent/src/read.ts`: optional reader slot (additive).
      - `docs/providers/`/`docs/` reader page per wiki structure.
    - References:
      - `plans/004` (no-PDF compromise), `roadmap.md` §0.1.6.
  - Test Cases to Write:
    - extraction: known-fixture PDF/Office file yields expected literal text.
    - bounds: oversize/over-page documents refuse with the size error.
    - fail-closed: missing peer dependency ⇒ documented error at creation.
    - no-fetch: document with external resource references performs zero network calls (egress tripwire).
    - redaction: extracted text flows through the redaction boundary.
  - **Done (2026-08-11).** Demand record: operator (arn) instruction to complete Task 4 with the `doc-reader` gate demanded (manifest `demandEvidence` + baseline mirror updated). Primitive review + threat model (D1-D8) extended in `docs/_evidence/phase18-primitive-review.md`. New optional workspace package `packages/document-reader` (`@arnilo/prism-document-reader`, added to root workspaces; lockfile updated): `createDocumentReader({ maxBytes, maxPages, maxTextBytes, parsers, redactor })` → additive `DocumentReader` slot in `createReadTool({ documentReader })` (read.ts: after the image sniff and before the text page; stat + read cap refusal; `maxTextBytes` re-check parity with the text-page bounds check; `readPathSet` recording; `metadata.document = { format, pages, truncatedBy }`; unsupported buffers return `null` and fall through to the 0.1.5 text path — no extension sniffing anywhere, absent option = byte-identical 0.1.5 behavior). Magic-byte format gating (PDF header; DOCX zip + `word/document.xml` marker) keeps random binaries away from parsers. Default wiring loads the OPTIONAL peer parsers `pdf-parse` (PDF) and `mammoth` (DOCX raw text) declared via `peerDependenciesMeta.optional`; creation fails closed with `ERR_PRISM_DOCUMENT_READER` when a selected format's peer is absent (verified by a rename-restore probe; devDeps keep real-parser tests runnable in-repo). Bounds: input cap (default 32 MiB / hard 512 MiB) refused at the read-tool stat; over-page documents refuse with the documented size error; over-text results truncate at a UTF-8 byte boundary (`truncatedBy: "bytes"`); DOCX reports `pages: 1` (no page concept in raw text). Security: no embedded-script execution, no macro evaluation, no external resource fetching — egress tripwire test (fetch spied) over a linked-external-image docx fixture; optional `SecretRedactor` applied at the adapter boundary. 12 tests in `packages/document-reader/src/__tests__/index.test.ts` (incl. read-tool integration: cap refusal, metadata shape, fall-through, oversize-result refusal); coding-agent suite 296/296 (slot additive). Envelope: 1000-page max-cap fixture (288 KB) extracts in ~162 ms with ~17 MB heap delta, recorded in `scripts/budgets.json` `docReader` block with a 2000 ms ceiling asserted by the envelope test (plan's "recorded against budgets.json" acceptance). Docs: new `docs/document-reader.md` wiki page, `docs/coding-agent-tools.md` read-options/metadata tables, `docs/index.md` tools + release-graph entries, package README + CHANGELOG. Zero new core dependencies; the 49→50 manifest growth is exactly this one additive package (freeze test coherence leg green).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package + additive read-surface slot.
    - Docs pages to create/edit:
      - `docs/document-reader.md`: new API page in the wiki structure (what/when/inputs/outputs/examples/security).
      - `docs/tools.md` (or the read-tool page): optional reader slot documented.
    - `docs/index.md` update: yes — Tools group entry for the document reader.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Recursive `delete` and brace-expanding `glob` (opt-in flags) (gate: `delete-glob` `demanded`)
  - **Done (2026-08-11).** Demand record: operator (arn) instruction to complete Task 5 with the `delete-glob` gate demanded (manifest `demandEvidence` + baseline mirror updated). Primitive review + threat model (G1-G8) extended in `docs/_evidence/phase18-primitive-review.md`. Shipped in the existing files (no new package, zero new dependencies):
    - `delete.ts`: per-call opt-in `recursive: true` plus optional `maxEntries` fan-out cap (default 10,000 / hard 100,000). Iterative post-order walk (files unlinked, directories removed deepest-first); symlink children are **unlinked as links, never followed** — a symlinked directory can never drag the deletion outside the workspace root (outside target survives); abort and cap overruns stop with a loud error naming the count, never silent; `file_changed` lifecycle events per item; metadata carries `recursive` + `entriesDeleted`. Flagless calls are byte-identical 0.1.5 (non-empty directory refusal kept, message extended with the opt-in hint).
    - `glob-match.ts`: `expandGlobBraces` — bounded `{a,b}` expansion (cartesian across groups), max 128 alternatives / 4096 total expanded bytes, unbalanced-open/nested/empty groups fail closed; `validateGlobPattern` gains the `braceExpansion` opt-in (default rejection unchanged, existing test green).
    - `glob.ts` + repository plumbing: host-selected `createGlobTool(cwd, { braceExpansion })` option with per-call override; `RepositoryGlobRequest.braceExpansion` → `globLocal` expands once and matches any alternative (expansion is textual only, never touches the filesystem; walk caps unchanged). Deviation note: `repository.ts` carries the request field + match loop (it is outside the closeout's allowedFiles scope and the plan's file list; the extension logic itself lives in `glob-match.ts`/`glob.ts` as planned).
    - Tests: 10 new in `glob.test.ts` / `delete-move.test.ts` (coding-agent suite 306/306): default parity, nested-tree recursive delete, symlink-escape refusal, fan-out cap + invalid `maxEntries` refusal, expansion unit bounds + malformed input, per-call/host/override flag flow, path-scope containment, expansion bomb through the tool boundary.
    - Docs: `docs/coding-agent-tools.md` (non-goal lines, exports rows, `delete` + `glob` sections with the new option rows), `docs/index.md` coding-tools entry.

  - Acceptance Criteria:
    - Functional: `delete` gains an opt-in `recursive: true` flag requiring explicit per-call opt-in plus the existing containment checks; without the flag, behavior is byte-identical to 0.1.5 (non-recursive only).
    - Functional: `glob-match.ts` gains opt-in brace expansion (`{a,b}`) behind a host-selected option; default matcher semantics unchanged; expansion is bounded (max alternatives, max expanded pattern length) and fail-closed on overflow.
    - Performance: brace-expansion bounds enforced in O(alternatives); recursive delete refuses symlinked directory traversal and records a per-call fan-out cap; budget gate green.
    - Code Quality: extensions live in the existing files (`delete.ts`, `glob-match.ts`); no dependency added (hand-rolled matcher compromise stays, now documented with the brace ceiling).
    - Security: threat-model risks enforced — symlink escape, `..` traversal, expansion bombs, and recursive-delete-outside-root all rejected by adversarial tests.
  - Approach:
    - Documentation Reviewed:
      - `plans/004` (no recursive delete / brace glob compromise) and its further actions.
      - `packages/coding-agent/src/{delete.ts,glob.ts,glob-match.ts,path-containment.ts}`.
      - `roadmap.md` §0.1.6 ("if pattern/usage demand justifies it") — demand record must name the patterns.
    - Options Considered:
      - picomatch dependency for brace expansion: rejected — adds a dependency for a bounded expansion the hand-rolled matcher can do in a few lines.
      - Opt-in flags on existing tools: chosen; defaults unchanged, smallest diff.
    - Chosen Approach:
      - Bounded, opt-in extensions behind flags; fail-closed defaults.
    - API Notes and Examples:
      ```ts
      await deleteTool({ path: "dist", recursive: true }); // refused without the flag (today's behavior)
      globTool({ pattern: "src/{a,b}/**.ts", braceExpansion: true });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/delete.ts`: recursive flag + guards.
      - `packages/coding-agent/src/glob-match.ts`: bounded brace expansion.
      - `packages/coding-agent/src/__tests__/`: adversarial + regression tests.
    - References:
      - `plans/004` compromises; `roadmap.md` §0.1.6.
  - Test Cases to Write:
    - default parity: flagless calls behave exactly as 0.1.5.
    - recursive delete: nested tree removed; symlinked child outside root refused.
    - brace expansion: `{a,b}` matches both; overflow expansion refuses.
    - traversal: `../` and absolute escapes refused in both tools.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new opt-in flags on public tool options.
    - Docs pages to create/edit:
      - `docs/tools.md` (or the coding-tools page): `recursive` and `braceExpansion` options with bounds and refusal behavior.
    - `docs/index.md` update: yes — coding-tools entry description updated if it enumerates capabilities.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Checkpoint persistence for loaded-skill bodies + full read-path state (gate: `checkpoint-bodies` `demanded`, and only if 0.1.3 names-only persistence is insufficient per the demand record)
  - **Done (2026-08-11).** Demand record: operator (arn) instruction to complete Task 6 with the `checkpoint-bodies` gate demanded — names-only persistence is insufficient for the resume flow (the restored body is whatever the registry serves; hosts that re-serve skills at agent-construction time must keep the fingerprint-frozen definitions available, and the model incurs a `load_skill` round-trip when it does not know the catalog was restored). Primitive review + threat model (C1-C7) extended in `docs/_evidence/phase18-primitive-review.md`. Shipped additively (no new package, zero new dependencies):
    - `src/skill-load.ts` (closeout allowedFiles) owns the format: `LoadedSkillBodiesEntry { name, instructions }`, caps (≤64 bodies, ≤256-char names, ≤262144-byte bodies = loader hard cap parity, ≤1 MiB total), `validateLoadedSkillBodies` (fail-closed shape/caps on save AND load), `snapshotLoadedSkillBodies` (loaded names only; a restored body wins over the registry body; oversize refuses — never truncates), `applyRestoredSkillBodies` (replace by name, append synthesized skills for names the assembly no longer serves).
    - `includeSkillBodies: true` on BOTH the durable run options (`AgentRunStateOptions`) and the resume options (`AgentRunResumeOptions` / lifecycle request); `persistSessionState` stays the master gate, so names-only / 0.1.2 checkpoint shapes are byte-identical with either flag off. Resume restores bodies only with `persistSessionState` + `includeSkillBodies`.
    - `agent-run-state.ts`: `sessionState.loadedSkillBodies` + fail-closed validation; the existing `maxStateBytes` ceiling (default 256 KB) refuses oversize bodies-mode checkpoints with a recorded error. `agent-session.ts`: bodies snapshot at persist (`activeRunSkills`), session render uses persisted bodies over the assembly skills. Redaction: bodies are redacted at rest through the existing checkpoint redactor; restored text is the redacted placeholder.
    - Deviation notes (same pattern as Task 5's repository.ts): the closeout's tentative file list pointed at `coding-checkpoint.ts` (which holds no session-state code) and `read-path-set.ts` — the session-state persistence actually lives in `agent-run-state.ts` / `agent-session.ts` / `contracts-run-state.ts` / `agent-run-lifecycle.ts` (plumbing, outside the allowedFiles scope), and the read-path set was ALREADY fully persisted by 0.1.3 (`createReadPathSetPersistence`, ≤1024 paths) — the closeout is the bodies upgrade only. The plan's `createReadPathSetPersistence({ includeSkillBodies })` example was schematic; the real seam is the durable run/resume options.
    - Tests: 5 new in `src/__tests__/agent-run-lifecycle.test.ts` (suite 8/8): lifecycle end-to-end (bodies ride the checkpoint; resume renders the persisted body in exactly one provider turn — no `load_skill` round-trip; names-only resume stays 0.1.3), flag-off keeps the 0.1.3 shape, payload bounds + malformed payloads fail closed + apply/snapshot units (replace/append, loaded-only, oversize refusal), cross-branch non-leak (bodies ride their own ownership-scoped run record; cross-tenant load refuses), redaction at rest.
    - Performance recorded: bodies-mode save+load overhead measured at ~0.07 ms vs ~0.01 ms names-only per cycle for an 8-skill ~8 KB bodies payload (in-memory store) — sub-millisecond, recorded in the manifest evidence; names-only default untouched (no regression by construction).
    - Docs: `docs/agent-session-runtime.md` (durable session-state paragraph), `docs/context-and-skills.md` (persistence bullet + sample comment), `docs/index.md` (durable lifecycle entry).
  - Acceptance Criteria:
    - Functional: extend the opt-in 0.1.3 persistence (`createReadPathSetPersistence`, loaded-skill names in `coding-checkpoint.ts`) with an opt-in `includeSkillBodies` / full read-path-state mode; resume restores bodies without a `load_skill` round-trip; names-only mode stays the default.
    - Functional: checkpoint size ceiling documented and enforced; oversized checkpoints refuse the bodies mode with a recorded error rather than silently truncating.
    - Performance: checkpoint write/read overhead measured and recorded; names-only default shows no regression; budget gate green.
    - Code Quality: additive option on the existing persistence helper; no new package; codec versioning handles old checkpoints (names-only) reading cleanly.
    - Security: cross-branch non-leak test (bodies from branch A never surface on branch B); restored bodies pass through the same trust/redaction path as a fresh `load_skill`.
  - Approach:
    - Documentation Reviewed:
      - `plans/015` Task 4 (names-only persistence shipped), `plans/003`/`plans/004` compromises.
      - `packages/coding-agent/src/{coding-checkpoint.ts,read-path-set.ts}`, `src/skill-load.ts`, `packages/session-store-codecs`.
    - Options Considered:
      - Always persist bodies: rejected — checkpoint size growth for all hosts to serve one demand record; opt-in keeps the 0.1.3 ceiling intact.
      - Opt-in bodies mode on the existing helper: chosen; smallest additive diff.
    - Chosen Approach:
      - Additive option + codec version tolerance + size ceiling.
    - API Notes and Examples:
      ```ts
      const persistence = createReadPathSetPersistence({ includeSkillBodies: true, maxCheckpointBytes });
      ```
    - Files to Create/Edit (tentative pending Task 1 review):
      - `packages/coding-agent/src/coding-checkpoint.ts`: bodies mode.
      - `packages/coding-agent/src/read-path-set.ts`: full-state option if needed.
      - `packages/coding-agent/src/__tests__/`: resume + non-leak tests.
    - References:
      - `plans/015` Task 4; `roadmap.md` §0.1.6 final bullet.
  - Test Cases to Write:
    - resume with bodies: no `load_skill` call needed; skill catalog + bodies + read-path state restored.
    - default unchanged: names-only checkpoints byte-compatible with 0.1.3 format.
    - cross-branch non-leak: branch-isolated bodies.
    - size ceiling: oversized bodies mode refuses with recorded error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new opt-in persistence option.
    - Docs pages to create/edit:
      - `docs/` checkpoint/session-memory page: bodies mode, size ceiling, when to enable.
    - `docs/index.md` update: yes — compaction/session-memory entry updated if it enumerates modes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Docs finalization, changelog, version bump, and 0.1.6 exit gate
  - **Done (2026-08-11).** `CHANGELOG.md` 0.1.6 entry lists all five closeouts as **shipped** (none deferred — every demand gate fired) with their demand records; `docs/migration.md` gains no entries (additive release); docs tripwires green; `docs/index.md` current line → **0.1.6** 50-package graph; `docs/release-and-install.md` gains the `0.1.6 publish handoff` (operator prerequisites, signed `v0.1.6` tag + npm OIDC, rollback notes). Scripted bump `node scripts/release.mjs bump --from 0.1.5 --to 0.1.6` across all 50 manifests + lockfile; version-sensitive pins updated (`src/index.ts` version literal, `release.test.ts`, `install-smoke.test.ts` tarball names, `packaging.test.ts` exact pins, `docs.test.ts` current-line + pkg.version, `index.test.ts`, 12 provider/package peer pins + neuralwatt wiring). Compat flow per the manifest: plain `release:gate --version 0.1.6` ran first and its delta list was reviewed — **0 removed**; changed = the root version literal, 7 statement-text artifacts (additive barrel re-export statements: `DocumentReader`/`DocumentReaderResult` in the read.js statement, `LoadedSkillBodiesEntry` in the skill-load.js statement), and `validateGlobPattern`'s optional third parameter (signature widening, additive) — then `--update-baseline` regenerated the baseline text and created `scripts/compat-baseline/arnilo__prism-document-reader.txt`; the plain gate then passed (50 packages, 0 breaking deltas, **no `--allow-break` anywhere**). Exit gate recorded in `scripts/phase18-baseline.json`: npm test core 1,433/1,433 + 190 script gates (phase18-freeze done-phase 17/17), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical (sha256 `b3be92e1…`), release gate 0.1.6 clean, budget/benchmark evidence note (docReader envelope + checkpoint-bodies overhead). Biome formatting applied to the 13 Task 2–6 source/test files and 2 freeze scripts (sdk:ready format leg). Zero new runtime dependencies. Publication remains the operator handoff.
  - Acceptance Criteria:
    - Functional: `CHANGELOG.md` 0.1.6 entry lists each closeout as shipped (with summary) or deferred (with demand gate); `docs/migration.md` gains no entries (additive release); docs tripwires green; `docs/index.md` matches shipped surface.
    - Functional: scripted bump to 0.1.6 across all manifests + lockfile; compat baseline regenerated **without** `--allow-break` (any breaking delta fails the release).
    - Functional: full release validation checklist — `npm test`, `sdk:ready` rc=0, audit 0 at moderate, pack dry-run byte-identical twice, budget/benchmark gates green; protected suites pass or are recorded as blocked gates with evidence, never silent skips.
    - Functional: exit-gate evidence appended to `scripts/phase18-baseline.json` (`exitGate`) mirroring the plan 013 pattern; freeze test done-phase validation green (demanded ⇒ implemented, deferred ⇒ untouched).
    - Performance: benchmark envelope recorded; no budget regressions.
    - Code Quality: this plan's checkboxes reflect reality; `## Compromises Made` and `## Further Actions` filled with actual deviations and the deferred-closeout gates.
    - Security: supply-chain legs (CodeQL/SAST, secret scan, SBOM/license, provenance, tarball content) green.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §Release Validation Checklist, §Versioning Policy.
      - `plans/013` Task 6 / `plans/017` final task (bump + exit-gate pattern).
      - `docs/release-and-install.md` operator handoff.
    - Options Considered:
      - Hold the release until all five closeouts have demand: rejected — demand-gated means shipping what is demanded, not stalling on what is not.
      - Cut with the demanded subset and record deferred gates: chosen; matches Priority/Dependency Rule 6.
    - Chosen Approach:
      - Scripted bump + regenerated additive baseline + evidence-backed exit gate; publication (signed tag `v0.1.6`, npm OIDC) remains the documented operator handoff.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/release.mjs gate --version 0.1.6
      npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`: 0.1.6 entry.
      - `package.json` + all workspace manifests + lockfile: 0.1.6 bump (scripted).
      - compat baseline files: regenerated (additive only).
      - `scripts/phase18-baseline.json`: `exitGate` evidence.
      - `plans/018-...md`: close out checkboxes, compromises, further actions.
    - References:
      - `plans/013-Release-0-1-1-Post-Release-Hardening.md` Task 6.
  - Test Cases to Write:
    - freeze done-phase: every `demanded` closeout's task is `[x]`; every `deferred` closeout's allowed files are untouched.
    - docs tripwire: changelog/manifest-count/index consistency (existing tripwire suite).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release bookkeeping for whatever shipped).
    - Docs pages to create/edit:
      - `CHANGELOG.md`: 0.1.6 entry.
      - `docs/release-and-install.md`: only if the manifest count changed (document-reader package).
    - `docs/index.md` update: yes — verify all Task 2–6 navigation updates landed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **One plan for five closeouts** (known upfront): the roadmap's "own plan" wording is carried by the per-closeout primitive review + threat model sections in `docs/_evidence/phase18-primitive-review.md` (Task 1 for `acp-session-store`, then appended `native-sandbox`, `doc-reader`, `delete-glob`, `checkpoint-bodies` sections); five near-empty plan files were rejected for this shape.
- **All five closeouts shipped** — no deferral recorded, because every demand gate fired (user Clay for `acp-session-store`; operator arn for the other four). The deferred-closeout machinery (byte-immutable allowedFiles, `demanded ⇒ implemented` gate) was exercised in the opposite direction: each closeout flipped demanded before its task landed, and the freeze machine refused any implementation-while-deferred.
- **Plumbing outside the closeout allowedFiles scopes** (Task 2 → `acp/agent.ts` + `acp/index.ts`; Task 3 → none (self-contained module + index exports); Task 4 → `read.ts` in scope, root workspaces/lockfile/docs outside; Task 5 → `repository.ts` carries the request field + match loop; Task 6 → `agent-run-state.ts`/`agent-session.ts`/`contracts-run-state.ts`/`agent-run-lifecycle.ts` carry the session-state plumbing). The freeze machine hashes only each closeout's allowedFiles; the out-of-scope plumbing is recorded per task and is additive.
- **Plan-literals vs implementation reality**, each recorded as a task deviation: the session store is `save`/`loadAll`/`evict` with the real 32/128 registry caps (plan said load/save/list/evict, cap 512); `createReadPathSetPersistence({ includeSkillBodies })` was schematic — the read-path set was already fully persisted since 0.1.3 and the real bodies seam is the durable run/resume options; `checkpoint-bodies` allowedFiles named `coding-checkpoint.ts` which holds no session-state code.
- **Native sandbox honest boundary**: spawn + rlimits + cwd containment only (egress denial via the OS `unshare` binary, Linux-only fail-closed); no fs isolation, no CPU-rate/pids/fs-size caps, no user switch, no `startProcess` — each a documented deliberate deferral vs the Docker reference.
- **Document reader parser CVE surface lives with the optional peers** (`pdf-parse`/`mammoth`), accepted by design; no-fetch is enforced by construction + a source-scan tripwire, not a sandbox.
- **Compat baseline `changed` entries** at 0.1.6 are all additive (version literal, barrel statement-text artifacts, one optional-param widening) — the plain gate reported them, review confirmed 0 removed, `--update-baseline` refreshed the text without `--allow-break`; the `baselineRelease` field stays 0.1.5 per the phase-16/17 precedent.
- **Phase15 freeze token updated** for the additive `sessionState.loadedSkillBodies` field; **phase16 lockfile hash re-recorded** (doc-reader's optional peers are sanctioned by the manifest's "optional peer dependency of an optional package"); **budget fileCount baseline 293 → 307** (0.1.0-era baseline, refresh at release-time bookkeeping).

## Further Actions

- **No 0.1.6 closeout remains deferred** — the deferred-gate machinery is now proven; future closeouts (roadmap 0.1.7 candidates: ACP session store hardening, sandbox fs-isolation, document formats beyond PDF/DOCX) keep the same demand-gate pattern and route to the next 0.1.x candidate only when demand evidence lands.
- **Publication of 0.1.6 is the operator handoff**: clean tree at the `v0.1.6` tag candidate, `docs/release-and-install.md` `0.1.6 publish handoff` checklist (signed `v0.1.6` tag + npm OIDC); `release:publish --version 0.1.6 --resume` for interrupted publication.
- **0.2.0 module line** (roadmap Priority Rule 4): delegated-agent adapters (Cursor/Antigravity) Module A, agent-owned ACP persistence Module E, host-owned seam expansions — each a documented cut with `docs/migration.md` entries.
- **Deferred-but-referenced upgrades**: native sandbox CPU-rate/pids caps and `startProcess` parity when a host names them; doc-reader xlsx/pptx/odt parsers when demand names formats; per-session or per-ownership ACP store sharding if the single lazy `loadAll` proves slow at scale.
