# Release 0.2.0 — Fail-closed Runtime and Sandbox Security

Roadmap phase: `roadmap.md` § **0.2.0 — Fail-closed runtime and sandbox security**.
Baseline: `@arnilo/prism` **0.1.7** (plan 019 complete; 50-package publish graph; zero audited vulnerabilities; clean sequential suite 3,334 tests / 3,301 pass / 33 protected or live skips / 0 failures).
Target: `@arnilo/prism` **0.2.0**. Security-motivated behavior changes are allowed only where this plan names the migration; unrelated public-contract changes are forbidden.

Scope items:

1. Reject unknown or malformed durable-resume decisions at the core runtime boundary before checkpoint mutation or tool execution.
2. Stop work-tool subprocesses inheriting ambient host environment variables; require absolute host-pinned executable/config paths and make output accumulation linear.
3. Replace ambiguous sandbox `containmentClaim` metadata with explicit workspace and isolation capabilities; native and unknown adapters must not imply filesystem isolation.
4. Prove all three fixes through source, public built-JavaScript, packed-consumer, threat-suite, migration, and release evidence.

## Objectives

- Close the three confirmed security defects without adding a dependency, package, background service, alternate runtime, or speculative abstraction.
- Make TypeScript declarations and JavaScript runtime behavior agree at every affected trust boundary.
- Preserve normal approve/deny, batched approval, connector credential, Docker sandbox, native egress-denial, mixed-wiring, and custom-adapter flows.
- Keep core, work-tool, and sandbox errors stable, bounded, redacted, and fail closed before their respective side effects.
- Publish explicit migration guidance for environment isolation, absolute paths, and sandbox capability metadata.
- Record machine-checkable baseline, threat-model, compatibility, package-budget, protected-matrix, and release evidence.

## Non-goals

- No provider/network hardening from 0.2.1, concurrent state work from 0.2.2, or build/coverage repair from 0.2.3.
- No new sandbox backend, container orchestrator, VM, seccomp profile, cgroup manager, firewall, or filesystem-isolation mechanism.
- No claim that native sandbox filesystem/process/privilege isolation exists; this release corrects metadata rather than inventing controls.
- No replacement of existing server JSON parsing; server validation remains independent defense in depth.
- No generic environment/config framework. Existing explicit `env` maps remain the host-supplied allow-list.
- No output streaming API change. Work connectors still return bounded `stdout`/`stderr` strings.
- No removal of deprecated `containmentClaim` in 0.2.0; retain one conservative compatibility projection because it is already a documented public field, then measure migration before removal.
- No new code-wiki task: `.agents/skills/project-wiki/` does not exist.

## Expected Outcome

- `resumeAgentRun`, `resumeAgentRunStream`, and `createAgentRunLifecycle().resume/resumeStream` reject invalid top-level decisions and malformed batches with `AgentDecisionError` before CAS writes, durable state transitions, agent resolution where avoidable, or tool calls.
- `createCliRunner` passes only a documented minimal platform environment, explicit host `env`, fixed connector controls, and late-bound identity credential variables; unrelated ambient secrets never reach the child.
- Work-tool executable and config paths must be absolute. Output capture performs one final concatenation rather than copying all prior bytes on every chunk.
- `SandboxCodingComposition` exposes explicit immutable capabilities for workspace coherence and filesystem/network/process/privilege isolation. Docker/native/custom/host/mixed modes report only controls they can support or explicitly attest.
- Native sandbox reports `filesystemIsolated: false`; custom/unknown adapters without capability metadata default all isolation claims to false.
- Deprecated `containmentClaim` becomes a conservative projection of verified composition capabilities, never a synonym for “tree backends are wired.”
- Direct source tests, built public-import tests, and a fresh packed plain-JavaScript consumer prove the fixes without relying on TypeScript.
- 0.2.0 exits with 50 packages, zero new runtime dependencies, standard budgets green, no skipped security blocker, and an operator-ready signed-tag/OIDC handoff.

## Operational Ownership

- **Release and security owner:** Prism maintainer/operator `arn`; owns scope amendments, threat acceptance, compatibility review, protected evidence, signed `v0.2.0` tag, and npm OIDC publication.
- **Core runtime owner:** Prism core maintainer; owns `AgentRunResume` runtime validation, checkpoint no-write invariants, and stable decision errors.
- **Work connector owner:** `@arnilo/prism-work-tools` maintainer plus deploying host; package owns safe environment construction, while host owns explicit non-secret environment values, absolute binaries/config roots, and per-identity credential providers.
- **Sandbox owner:** `@arnilo/prism-coding-security` maintainer plus deploying host; package owns truthful built-in capability metadata, while hosts own truthfulness of custom-adapter attestations and actual platform/network topology.
- **CI evidence owner:** release workflow maintainer; missing Docker/native-kernel evidence blocks the 0.2.0 security gate rather than becoming a passing skip.

## Migration Impact

- **Durable resume:** no type or checkpoint-shape migration. Untyped callers that previously supplied unknown decision strings and accidentally resumed execution now receive `ERR_PRISM_DECISION_INVALID`; this is the intended security fix.
- **Work CLI:** relative `binary` or `configDir` values become errors. Ambient variables other than the documented minimal platform set disappear from child processes. Hosts must pass required non-secret values through existing `env`; identity tokens continue through `WorkTokenProvider`/per-call env and remain late-bound.
- **Sandbox metadata:** new explicit capability fields are additive. Existing `containmentClaim` remains readable but is deprecated and becomes stricter; consumers must migrate authorization/security decisions to individual capabilities. Persisted session/checkpoint/database schemas do not change.
- **Rollback:** restoring 0.1.7 restores insecure behavior and must not be used as a production mitigation. If code rollback is unavoidable, disable durable resume side effects and work-tool execution at the host until 0.2.0 is restored. No data migration rollback is needed.

## Package and Performance Budget

- Publish graph remains **50 packages**; no package or export subpath is added.
- Runtime dependencies remain unchanged: core stays dependency-free; work-tools and coding-security gain no dependency.
- Root and affected package packed/unpacked/file-count growth must remain within the existing `scripts/budgets.json` tolerance unless measured evidence justifies a reviewed baseline change.
- Resume validation is O(batch size), bounded by `HARD_MAX_PENDING_DECISIONS`, and runs before checkpoint mutation.
- Environment construction is O(allowed variable count) with fixed/default and existing process limits; no ambient environment clone.
- CLI capture is O(total output bytes) copying with retained bytes bounded by `maxStdoutBytes`/`maxStderrBytes`.
- Capability resolution is O(1), frozen/copy-only metadata, and adds no sandbox process or network call.

## Tasks

- [x] Task 0 — Primitive review, threat model, ownership, migration, and budget decisions
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase20-primitive-review.md` (done, reviewed 2026-08-12 at HEAD 051470a) inventorying existing primitives before implementation: `AgentDecisionError`, `resolveRunDecisions`, `pendingDecisionsOf`, `prepareAgentRunResume`, server `readAgentDecisions`; `createCliRunner`, `WorkTokenProvider`, work limits, Docker/native exact-env precedents; `SandboxAdapter`, `DisposableSandbox`, `DockerNetworkConfig`, native/Docker constructors, sandbox composition, egress attestations, compatibility baselines, and packed-install harness.
    - Functional: document what can be fixed with those primitives and approve only three small gaps: one internal resume-input assertion (approved: `assertValidAgentRunResume` in `src/agent-approval.ts`, invoked once at the top of `prepareAgentRunResume` — verified all four public resume entrypoints route through that funnel, so the single call site covers `resumeAgentRun`, `resumeAgentRunStream`, lifecycle `resume`, and lifecycle `resumeStream`), one package-local minimal environment builder/chunk accumulator (approved: `buildCliEnvironment` + `collectOutput` module-private in `packages/work-tools/src/cli.ts` — no new file, no new public exports; absolute-path checks use `path.isAbsolute`), and one reusable sandbox capability shape/resolver used by Docker, native, custom, and composition paths (approved: `SandboxCapabilities` type on `SandboxAdapter` + `resolveSandboxCapabilities` in `sandbox-coding-operations.ts`, consumed by both built-in backends and the composition).
    - Functional: record threat actors, assets, entry points, trust boundaries, and mitigations for at least: unknown legacy decision, malformed batch, stale/foreign approval, ambient secret inheritance, token override of fixed env, relative/path-hijacked executable/config, output exhaustion, custom capability spoof/omission, native filesystem overclaim, Docker custom-network ambiguity, mixed wiring, and downgrade through deprecated metadata.
    - Functional: map every threat to a concrete test in Tasks 2–5 and record the operational owner, migration decision, rollback posture, package budget, and protected environment required for each blocker.
    - Performance: record baseline complexity and memory behavior for resume validation, environment construction, CLI output capture, and capability resolution; proposed changes stay within the Package and Performance Budget above.
    - Code Quality: reject a generic schema framework, cross-package internal utility package, sandbox factory hierarchy, or new interface with one consumer; retain existing package boundaries.
    - Security: explicitly decide that server parsing is defense in depth, ambient env is deny-by-default, omitted custom capability metadata means all isolation false, and deprecated `containmentClaim` cannot authorize a security-sensitive action by itself. (All four decided and recorded in the evidence document.)
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.0, review evidence/release order, mandatory regression matrix, release validation checklist.
      - `.agents/skills/create-plan/SKILL.md` primitive-review requirement.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - `docs/agent-session-runtime.md` durable interruption; `docs/public-contracts.md`; `docs/server.md` resume boundary.
      - `docs/work-tools.md`; `docs/coding-security.md`; `docs/host-security.md`; `docs/migration.md`.
      - Node.js v20.20.2 docs: `child_process.spawn()` environment/PATH and pipe behavior, `path.isAbsolute()`, `Buffer.concat()`, and `process.env`.
      - `plans/017` breaking-cut evidence flow and `plans/018` primitive-review/threat-model precedent.
    - Options Considered:
      - Patch only the demonstrated call sites: rejected; core resume and composition are shared boundaries, so caller-specific guards leave sibling paths exposed.
      - Introduce a validation/security framework: rejected; three bounded assertions/helpers are smaller and reuse current errors/contracts.
      - Reuse-first review with one threat table and explicit decisions: chosen.
    - Chosen Approach:
      - Write one tarball-excluded evidence document before freeze or source edits; freeze exact decisions and test names in Task 1.
    - API Notes and Examples:
      ```ts
      import { resumeAgentRun, type AgentRunResume } from "@arnilo/prism";
      import { createCliRunner } from "@arnilo/prism-work-tools";
      import { createSandboxCodingComposition } from "@arnilo/prism-coding-security";
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase20-primitive-review.md`: primitive inventory, gap decisions, threat model, owner/migration/budget matrix, and test mapping.
      - `plans/020-Release-0-2-0-Fail-Closed-Runtime-and-Sandbox-Security.md`: update only if review changes planned approach/files/tests.
    - References:
      - `src/agent-run-lifecycle.ts`; `src/agent-approval.ts`; `packages/server/src/handler.ts`.
      - `packages/work-tools/src/cli.ts`.
      - `packages/coding-security/src/{sandbox,sandbox-coding-operations,docker-sandbox,native-sandbox}.ts`.
      - `src/__tests__/install-smoke.test.ts`.
  - Test Cases to Write:
    - review traceability tripwire: every threat ID maps to at least one named automated test and one owning task.
    - primitive constraint tripwire: evidence rejects new dependencies/packages and records why each new helper has multiple call sites or modes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence and decisions only; source behavior changes in Tasks 2–4.
    - Docs pages to create/edit:
      - `docs/_evidence/phase20-primitive-review.md`: internal, tarball-excluded security evidence — created and reviewed; records primitive inventory, three approved gaps, threat-to-test traceability, owners, migration/rollback, budget, and baseline complexity figures.
    - `docs/index.md` update: no — `_evidence` is intentionally not public navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence exception; public docs follow in implementation tasks).

- [x] Task 1 — Freeze 0.1.7 baseline and machine-check 0.2.0 scope
  - Acceptance Criteria:
    - Functional: create `scripts/phase20-freeze-manifest.json` (done: release 0.2.0 / line 0.2.x / type fail-closed-runtime-and-sandbox-security; four items with disjoint allowed scopes, done-phase content markers, negative markers, and threat-to-test mapping; sharedFiles registry with per-editor markers; preservedSurface naming the six reused primitives; allowed/forbidden lists; compat policy additive-only with the three documented security exceptions and deviation-gated `--allow-break`; migration tokens; per-task evidence tokens; security policy with Docker/native protected gates) with target/baseline, three blocker scopes, Task 0 decisions, allowed files, forbidden changes, compatibility policy, operational owners, migration impact, package budget, protected-gate policy, empty deviations, and task tokens.
    - Functional: create `scripts/phase20-baseline.json` (done: captured 2026-08-12 at 0.1.7 HEAD 051470a; 48 file hashes incl. all item scopes, shared files, preserved surface; dependency-name fingerprint bab44803aaec; workspace-manifest and compat-baseline dir hashes; containmentClaim consumer inventory; workToolEnv defect record; npm test 1451/1451 + 208 script gates, coverage 91.92/84.19/91.35, typecheck 0, biome 61 warnings, format 958 files 0 fixes, secrets 1509 files 0 findings, audit 0, pack 50 deterministic, release gate 0.1.7 clean; `exitGate: null`) recording clean 0.1.7 test/typecheck/lint/format/coverage/audit/secret/pack/release-gate evidence, 50-package graph, affected declaration/file hashes, current `containmentClaim` consumer inventory, current work-tool env behavior, and `exitGate: null`.
    - Functional: create `scripts/phase20-freeze.test.mjs` (done: 22 tests green standalone), append it after phase 19 in root `npm test` (done), and validate pending-task immutability, done-task assertions, docs/migration tokens, package/dependency count, no unreviewed compatibility removal, and final exit evidence.
    - Performance: freeze test is stdlib-only, deterministic, and completes under five seconds excluding commands whose results are read from baseline evidence. (Done: 22 tests in ~130 ms standalone; expensive evidence is read from `phase20-baseline.json`, never re-run.)
    - Code Quality: mirror established phase 17–19 manifest/baseline/test shapes; do not add a second release-gate system. (Done: phase 19 manifest/baseline/state-machine shapes mirrored; no new gate system.)
    - Security: source edits outside the three reviewed scopes fail loud; blocker tasks cannot become done while their mapped adversarial tests/docs are absent; security skips cannot satisfy the exit gate. (Done: pending-scope byte-immutability, done-phase markers, securityTests mapping, and protected-gate exit assertions all enforced by the freeze test.)
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase19-freeze-manifest.json`, `scripts/phase19-baseline.json`, `scripts/phase19-freeze.test.mjs`.
      - `scripts/phase17-freeze-manifest.json` intentional migration/compat evidence.
      - `scripts/phase12-freeze-manifest.json` blocked-gate policy.
      - `scripts/budgets.json`; `docs/release-and-install.md`.
    - Options Considered:
      - Rely on plan prose and git review: rejected; previous phases already provide a small machine-checked scope pattern.
      - One phase-20 manifest with three item scopes and one baseline: chosen.
    - Chosen Approach:
      - Capture clean pre-change truth after Task 0; allow implementation only after standalone freeze test passes.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase20-freeze.test.mjs
      node scripts/release.mjs gate --version 0.1.7
      npm audit --audit-level=moderate
      ```
    - Files to Create/Edit:
      - `scripts/phase20-freeze-manifest.json`: scope/security/release gate. (Created.)
      - `scripts/phase20-baseline.json`: pre-change and exit evidence. (Created.)
      - `scripts/phase20-freeze.test.mjs`: machine checks. (Created.)
      - `package.json`: append phase-20 freeze test to `npm test`. (Done: after `scripts/phase19-freeze.test.mjs`.)
      - `plans/README.md`: keep plan 020 indexed as in progress. (Row present; status flips to complete at Task 6.)
    - References:
      - `plans/019-Release-0-1-7-Performance-and-DX.md` Tasks 0 and 6.
  - Test Cases to Write:
    - pending-scope mutation: changing any blocker-owned file before its task is done fails. (Done: STATE MACHINE pending-items test, byte-identical vs baseline hashes.)
    - unreviewed break: removed declaration or changed package/dependency count fails. (Done: dependency-name fingerprint test + workspace-manifest/compat-baseline dir-hash tests + manifest-count coherence test.)
    - missing security evidence: a done blocker with absent test/docs/threat token fails. (Done: DONE-PHASE ITEM ASSERTIONS with content markers, negative markers, and securityTests mapping.)
    - exit gate discipline: 0.2.0 cannot close with a blocker skipped or `exitGate.green !== true`. (Done: exit-gate test requires all tasks done, audit 0, pack determinism, clean plain release gate, Docker/native protected evidence, no `--allow-break` without deviation.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling only.
    - Docs pages to create/edit:
      - `none`: baseline/freeze files are internal release evidence.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; no public docs trigger.

- [x] Task 2 — Validate durable-resume input in core before side effects
  - Acceptance Criteria:
    - Functional: add one internal runtime assertion for the complete `AgentRunResume` input (`assertValidAgentRunResume` in `src/agent-approval.ts`, approved by Task 0) and invoke it from `resumeAgentRun`, `resumeAgentRunStream`, and lifecycle `resume`/`resumeStream` before checkpoint claim/transition, tool execution, and avoidable agent resolution — one call site at the top of `prepareAgentRunResume` covers all four entrypoints, before `loadAgentRunState`. (Done: exported from `agent-approval.ts`, called at the top of `prepareAgentRunResume` before `loadAgentRunState`; lifecycle `resume`/`resumeStream` route through the free functions so the single call site covers all four entrypoints.)
    - Functional: require a non-null object, positive safe-integer `expectedVersion`, exactly one of legacy `decision` or `decisions`, legacy decision exactly `approve`/`deny`, and a non-empty batch no larger than `HARD_MAX_PENDING_DECISIONS`. (Done: all enforced; the two now-redundant in-lifecycle discriminant checks were removed so the assertion is the single whitelist.)
    - Functional: validate every untyped batch entry enough to prevent property/type exceptions: object shape, bounded non-empty `approvalId`, whitelisted outcome, optional string reason within existing UTF-8 limit, and JSON-object `modifiedArguments`/`elicitation` within existing bounds. State-dependent foreign/stale/scope/schema/policy checks remain in `resolveRunDecisions`. (Done: per-entry object check, approvalId ≤ 128 chars, outcome whitelist, string reason ≤ 2 KiB, cycle-safe JSON-object payloads ≤ 16 KiB; `resolveRunDecisions` untouched and still authoritative for state-dependent checks.)
    - Functional: use existing `AgentDecisionError` codes (`ERR_PRISM_DECISION_INVALID`, `..._LIMIT`, `..._DUPLICATE`, `..._UNKNOWN`, `..._STALE`) rather than adding overlapping error classes. `decision: "sideways"` must never fall through to approval. (Done: only existing codes used; `sideways` throws `ERR_PRISM_DECISION_INVALID` with message `Unknown legacy decision` before any state read.)
    - Functional: invalid input causes zero checkpoint writes/CAS changes, zero tool calls, and zero resumed events; valid legacy approve/deny, full/partial batches, sticky outcomes, elicitation, modified arguments, stream cancellation, and server paths remain green. (Done: no-write/no-tool assertions in run-decisions tests; stream-path zero-events assertion in agent-run-state tests; full core 1456/1456 plus server 77/77, supervisor 23/23, ag-ui 187/187, workflows 65/65, coding-agent 306/306.)
    - Performance: assertion is one bounded O(n) pass with no serialization of checkpoint state and no extra store I/O; normal single-decision overhead is negligible against the existing run lifecycle.
    - Code Quality: one shared assertion, no duplicated whitelist across free-function/lifecycle paths; typed declarations remain unchanged; server parser may keep independent transport validation.
    - Security: validation runs for plain JavaScript and `as any` callers; errors contain no tool arguments, elicitation payload, credentials, or foreign approval details. (Done: all adversarial tests cast `as never`; error messages are fixed strings with no payload echo; the throwing-store test proves validation precedes any checkpoint read.)
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md` durable interruption contract.
      - `docs/public-contracts.md` resume exports.
      - `src/contracts-run-state.ts` `AgentRunResume`, `RunDecision`, limits, and `AgentDecisionError`.
      - `src/agent-run-lifecycle.ts`; `src/agent-approval.ts`.
      - `packages/server/src/handler.ts` `readAgentResume`/`readAgentDecisions` defense-in-depth parser.
      - `src/__tests__/run-decisions.test.ts`; `src/__tests__/agent-run-state.test.ts`; `packages/server/src/__tests__/server.test.ts`.
    - Options Considered:
      - Add `if (decision !== "approve" && decision !== "deny")` only: rejected; fixes the proof but leaves malformed untyped batches able to throw inconsistently after reads.
      - Reuse server request parser in core: rejected; core must remain transport-independent and server limits/content-type handling do not belong in runtime.
      - Small internal assertion reusing existing constants/errors, followed by current state-dependent resolver: chosen.
    - Chosen Approach:
      - Validate transport-neutral shape/discriminants at every public resume entry; retain `resolveRunDecisions` as authoritative state/policy validation.
    - API Notes and Examples:
      ```ts
      await assert.rejects(
        resumeAgentRun(agent, ref, { expectedVersion, decision: "sideways" } as never, options),
        (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
      );
      ```
    - Files to Create/Edit:
      - `src/agent-run-lifecycle.ts`: call shared assertion before resume work. (Done: `assertValidAgentRunResume(resume)` at the top of `prepareAgentRunResume`; redundant discriminant checks removed.)
      - `src/agent-approval.ts`: planned internal assertion using existing decision constants/errors (or keep in lifecycle if Task 0 proves no second consumer). (Done: `assertValidAgentRunResume` exported from `agent-approval.ts`; internal, not re-exported from the public entry.)
      - `src/__tests__/run-decisions.test.ts`: primary no-write/no-tool adversarial tests. (Done: new `durable resume input validation (plan 020 Task 2)` describe with 4 tests.)
      - `src/__tests__/agent-run-state.test.ts`: stream/lifecycle entry coverage if not already covered by run-decisions tests. (Done: stream-path `sideways` rejection with zero events/claim/dispatch.)
      - `packages/server/src/__tests__/server.test.ts`: parity/defense-in-depth regression only; server implementation remains unchanged unless review finds drift. (Done: existing `sideways` 400-parity case already covers the transport layer; server implementation untouched.)
      - `docs/agent-session-runtime.md`: explicit JavaScript runtime-validation and no-side-effect behavior. (Done: `Runtime input validation (0.2.0, plan 020 Task 2)` paragraph.)
      - `docs/public-contracts.md`: concise resume validation guarantee. (Done: `resumeAgentRunStream` row extended.)
      - `docs/index.md`: extend Agent/session runtime navigation description with fail-closed durable resume. (Done.)
    - References:
      - Confirmed runtime proof recorded in `roadmap.md` review evidence: unknown `decision: "sideways"` executed one suspended tool under 0.1.7.
      - `AgentDecisionError` in `src/contracts-run-state.ts`.
  - Test Cases to Write:
    - unknown legacy decision: stable invalid error; checkpoint version/state unchanged; tool counter zero. (Done: `sideways` → `ERR_PRISM_DECISION_INVALID`, version/status unchanged, executed 0.)
    - malformed top-level inputs: null, primitive, unsafe/non-positive version, neither/both discriminants. (Done: 8-case matrix against a throwing checkpoint store proving no read/write.)
    - malformed batches: non-array, empty, over cap, primitive entry, missing/empty approval id, unknown outcome, duplicate id, non-string/oversized reason, non-object/cyclic/oversized optional payload. (Done: 15-case matrix, all stable `AgentDecisionError` codes, state/version untouched after every case.)
    - valid matrix: approve, deny, partial/full batch, all four outcomes, elicitation, modified arguments, stale/foreign errors remain exact. (Done: existing suite covers all; legacy approve regression added; stale/foreign exactness re-verified by the untouched existing tests.)
    - lifecycle/stream: invalid input does not resolve agent where validation can precede it, subscribe, emit, claim, or dispatch. (Done: stream-path test asserts zero events, zero claim (version unchanged), zero tool calls; lifecycle routes through the same assertion.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — existing public resume APIs now enforce their declared discriminants at runtime for untyped callers.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: durable-resume input table, error/no-side-effect guarantee, plain-JavaScript note.
      - `docs/public-contracts.md`: runtime validation guarantee for resume exports.
    - `docs/index.md` update: yes — update Agent/session runtime entry description; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Isolate work-tool subprocess environments and linearize output capture
  - Acceptance Criteria:
    - Functional: `createCliRunner` rejects empty, NUL-containing, or non-absolute `binary` and `configDir` with existing stable `WorkToolError` families before spawn. (Done: `path.isAbsolute` + NUL/empty checks at construction; `ERR_PRISM_WORK_BINARY`/`ERR_PRISM_WORK_CONFIG`.)
    - Functional: replace `{ ...process.env }` with a documented minimal base: canonical `PATH` plus only Node/platform-required locale/system keys selected by a fixed allow-list; then merge explicit host `options.env`; then late-bound per-identity `runOpts.env`; finally force `HOME`/config and telemetry-disable controls so credentials cannot override fixed isolation fields. (Done: `buildCliEnvironment` = fixed `BASE_ENV_KEYS` base + validated explicit layer + forced `HOME`/`CLIMICROSOFT365_DISABLETELEMETRY`; `mergeTokenEnv` per call; reserved keys rejected in both layers.)
    - Functional: validate environment names/values, reject NUL and case-insensitive duplicate/reserved keys, and enforce a fixed bounded name/byte ceiling. On Windows, canonicalize PATH/system key casing so Node's case-insensitive first-key behavior cannot select an attacker-controlled duplicate. (Done: per-layer `validateEnvLayer` — NUL-free, `[A-Za-z_][A-Za-z0-9_]*` names, string values, case-insensitive reserved/duplicate rejection; win32 base dedupes allow-list keys to canonical casing; fixed caps 64 names / 64 KiB via `enforceEnvCaps` mirroring docker-sandbox defaults.)
    - Functional: preserve late-bound token behavior and missing-token refusal in Microsoft 365/Google Workspace adapters; token values never enter argv, returned errors, docs output, or captured process output. (Done: connectors unchanged — token layer still merged per call in `runner.exec`; existing token-provider tests green.)
    - Functional: replace repeated `Buffer.concat([buffer, chunk])` with bounded chunk arrays plus one final `Buffer.concat(chunks, totalBytes)` (or a lower-allocation equivalent selected in Task 0); kill and reject before retaining bytes beyond stdout/stderr caps. (Done: `collectOutput` chunk-array collector with one final `Buffer.concat(chunks, retained)`; overflow handler kills and rejects before the offending chunk is retained.)
    - Functional: timeout, caller abort, spawn error, non-zero exit reporting, concurrency, forbidden argv, JSON/NDJSON limits, and normal connector calls remain compatible. (Done: lifecycle handlers unchanged; full package suite green.)
    - Performance: output copying is O(total bytes), retained payload never exceeds configured stdout/stderr caps, and near-limit chunked fixtures complete within the existing work-tool test envelope without increasing default concurrency memory beyond documented bounds. (Done: 20,000-chunk fixture at 40 KB completes in ~95 ms; retained ≤ cap by construction.)
    - Code Quality: use Node stdlib (`path.isAbsolute`, `spawn`, `Buffer`) only; keep environment construction package-local and small; no dependency or generic process runner. (Done: stdlib only; builders module-private in cli.ts; zero new exports in index.ts.)
    - Security: unrelated ambient canaries do not reach real child or exec seam; explicit secrets remain redacted/absent; relative executable/config paths and reserved-env overrides fail before spawn. (Done: exec-seam and real-child canary tests with `PRISM_PROOF_SECRET`; 14-case pre-spawn validation matrix.)
  - Approach:
    - Documentation Reviewed:
      - Node.js v20.20.2 `child_process.spawn()` docs: `options.env` replaces child environment; PATH lookup and Windows case-insensitive duplicate-key behavior.
      - Node.js v20.20.2 `path.isAbsolute()` docs.
      - Node.js v20.20.2 `Buffer.concat()` docs and fixed-length buffer semantics.
      - `packages/work-tools/src/{cli,limits,types,microsoft365,google-workspace}.ts`.
      - `packages/work-tools/src/__tests__/work-tools.test.ts`; `docs/work-tools.md`.
      - Exact-env precedents: `packages/coding-security/src/{docker-sandbox,native-sandbox}.ts`.
    - Options Considered:
      - Keep ambient env and redact known secret names: rejected; secret names are unbounded/unknown and redaction after spawn cannot undo disclosure.
      - Add a new `inheritEnv` API: rejected for 0.2.0; existing explicit `env` map already lets hosts pass required values without expanding surface.
      - Minimal fixed platform base + explicit maps + forced reserved controls: chosen.
      - Preallocate both hard-cap buffers per process: rejected unless benchmarks prove preferable; it raises peak memory for small outputs.
    - Chosen Approach:
      - Build one bounded environment object at construction, derive a fresh bounded per-call object for credentials, and collect output chunks once.
    - API Notes and Examples:
      ```ts
      const runner = createCliRunner({
        binary: "/usr/local/bin/m365",
        configDir: "/var/lib/prism/m365/tenant-1/user-1",
        env: { LANG: "C.UTF-8" }, // explicit non-secret allow-list
      });
      await runner.exec(["version", "--output", "json"], {
        env: { M365_ACCESSTOKEN: token }, // late-bound identity credential
      });
      ```
    - Files to Create/Edit:
      - `packages/work-tools/src/cli.ts`: absolute path checks, minimal/bounded env, reserved keys, linear capture. (Done.)
      - `packages/work-tools/src/__tests__/work-tools.test.ts`: seam and real-child regressions. (Done: 4 new tests.)
      - `packages/work-tools/src/index.ts`: only if Task 0 approves public constants/types; no export is expected. (Done: no changes, no new exports.)
      - `docs/work-tools.md`: environment contract, absolute paths, migration and security/performance notes. (Done: Subprocess environment isolation section.)
      - `packages/work-tools/README.md`: concise migration/security parity with public docs. (Done.)
      - `docs/index.md`: update Work tools navigation description. (Done.)
    - References:
      - Existing late-bound token tests near `packages/work-tools/src/__tests__/work-tools.test.ts` token-provider cases.
      - Node child-process docs: `https://nodejs.org/docs/latest-v20.x/api/child_process.html#child_processspawncommand-args-options`.
      - Node path docs: `https://nodejs.org/docs/latest-v20.x/api/path.html#pathisabsolutepath`.
  - Test Cases to Write:
    - ambient canary: set unrelated `process.env.PRISM_PROOF_SECRET`; exec seam and real child both prove absence.
    - explicit map: allowed non-secret env and late-bound token reach child; fixed HOME/config/telemetry/PATH cannot be overridden by token env.
    - validation: relative/empty/NUL binary and config paths, invalid/NUL env name/value, over-count/over-byte env, reserved/case-variant keys all refuse before spawn.
    - output capture: many chunks near each cap return exact bytes/order; one byte over kills/rejects without oversized retention; stdout/stderr tracked separately.
    - process lifecycle: caller abort, timeout, spawn error, close race, and concurrency counters settle once.
    - connector parity: M365/GWS version/read/mutation and token refresh tests stay green with no token in argv/errors.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — existing `createCliRunner`/connector defaults stop ambient env inheritance and reject relative paths.
    - Docs pages to create/edit:
      - `docs/work-tools.md`: inputs, environment precedence, absolute-path requirement, examples, migration, security/performance notes.
      - `packages/work-tools/README.md`: package-facing summary and link.
    - `docs/index.md` update: yes — update Work tools entry to mention isolated subprocess env and host-pinned absolute paths.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Ship explicit sandbox capabilities and conservative compatibility metadata
  - Acceptance Criteria:
    - Functional: add exported immutable capability types separating `workspaceCoherent`, `filesystemIsolated`, `networkIsolated`, `processIsolated`, and `privilegeIsolated` plus the narrowly named `egressRestricted` field (Task 0 proved egress policy cannot be represented by `networkIsolated` alone: Docker custom-attested networks have a network but constrained egress, so the dedicated field is approved rather than overloading `networkIsolated`). (Done: exported `SandboxCapabilities` in sandbox.ts; Docker reports `egressRestricted` only for mode `none` or a custom network carrying a validated `EgressAttestation`.)
    - Functional: `SandboxCodingComposition` always returns a complete capability object. Workspace coherence derives from actual shell/filesystem/repository wiring; isolation fields derive only from validated adapter capability metadata, never from `execFile`/`close` duck typing or custom operations being present. (Done: `resolveCompositionCapabilities`; un-attested Disposable auto-wire now reports `workspaceCoherent` only.)
    - Functional: built-in Docker adapter reports only controls established by its validated create options and container construction; native reports network isolation/egress denial as documented but `filesystemIsolated: false`, `processIsolated: false`, and `privilegeIsolated: false`; host mode and mixed wiring report no containment capability. (Done: `resolveDockerCapabilities(network)` + `NATIVE_SANDBOX_CAPABILITIES` frozen consts on the sessions; matrix test proves none/custom-unattested/custom-attested truth.)
    - Functional: custom/unknown adapters that omit capability metadata resolve all isolation fields false. Explicit custom metadata is treated as host attestation, copied/validated/frozen, and documented as host responsibility rather than Prism verification. (Done: `resolveSandboxCapabilities` requires exactly the six known boolean fields; non-object/missing/non-boolean/unknown-key all resolve every field false; caller mutation after composition cannot change the frozen evidence — test-verified.)
    - Functional: retain `containmentClaim` as `@deprecated` for 0.2.0 because it is public in 0.1.7; compute it as a conservative conjunction defined in docs, so native/custom/mixed/host cannot return true unless every required capability is true. No authorization example may rely on it. (Done: `deprecatedContainmentProjection` = `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated`; docs and host-security guidance use individual capabilities only.)
    - Functional: update all existing composition, workspace-consistency, sandbox-FS, Docker, native, and protected tests to assert capability truth rather than broad containment shorthand. (Done: containmentClaim assertions migrated to `capabilities` truth in all six test files; native T9 test asserts the truthful matrix.)
    - Performance: capability construction is O(1), allocates one small frozen object per sandbox/composition, and adds no command, filesystem, Docker, DNS, or network operation. (Done: frozen consts for built-ins and EMPTY; single freeze per composition; documented in coding-security.md.)
    - Code Quality: one capability type and one resolver/validator reused by built-ins and composition; no backend class hierarchy, capability registry, or runtime discovery. (Done: `SandboxCapabilities` type + `resolveSandboxCapabilities` validator; built-ins self-describe via frozen objects.)
    - Security: malformed untyped capability metadata fails closed or resolves false; no backend may gain a capability by omission, duck typing, mixed wiring, or custom filesystem operations alone; docs distinguish workspace path checks from OS isolation. (Done: 6-case malformed matrix + un-attested/mixed/host assertions; capability table in docs distinguishes coherence from OS isolation.)
  - Approach:
    - Documentation Reviewed:
      - `docs/coding-security.md` workspace modes, Docker/native threat models, egress attestation, and current `containmentClaim` wording.
      - `docs/host-security.md`; `docs/process-sessions.md`; `docs/migration.md`.
      - `packages/coding-security/src/sandbox.ts`; `sandbox-coding-operations.ts`; `sandbox-fs-operations.ts`; `docker-sandbox.ts`; `native-sandbox.ts`; `egress/index.ts`.
      - `packages/coding-security/src/__tests__/{sandbox-coding-operations,workspace-consistency,sandbox-fs-operations,docker-sandbox,native-sandbox}.test.ts`.
      - `scripts/compat-baseline/arnilo__prism-coding-security.txt` and public docs/tests showing `containmentClaim` is already supported.
    - Options Considered:
      - Rename `containmentClaim` and keep one boolean: rejected; ambiguity caused the defect.
      - Infer isolation from methods or workspace operations: rejected; interface shape proves capability to call, not OS security controls.
      - Require capability metadata on every `SandboxAdapter`: rejected for this release; it would break shell-only/custom adapters that make no isolation claim. Omission safely means false.
      - Additive capability object plus deprecated conservative projection: chosen; truthful and migratable with minimal breakage.
    - Chosen Approach:
      - Built-ins self-describe fixed/option-derived controls; composition combines those with wiring coherence and freezes the result; unknowns default false.
    - API Notes and Examples:
      ```ts
      const { composition } = createSandboxCodingComposition(hostRoot, {
        workspaceMode: "sandbox",
        sandbox,
      });

      if (!composition.capabilities.filesystemIsolated) {
        throw new Error("Host policy requires filesystem isolation");
      }
      // composition.containmentClaim is deprecated compatibility metadata only.
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox.ts`: capability/attestation types on adapters. (Done.)
      - `packages/coding-security/src/sandbox-coding-operations.ts`: capability resolution and deprecated projection. (Done.)
      - `packages/coding-security/src/docker-sandbox.ts`: built-in Docker capability metadata. (Done.)
      - `packages/coding-security/src/native-sandbox.ts`: truthful native capability metadata. (Done.)
      - `packages/coding-security/src/index.ts`: additive type exports. (Done: SandboxCapabilities + resolveSandboxCapabilities + resolveDockerCapabilities.)
      - `packages/coding-security/src/__tests__/sandbox-coding-operations.test.ts`: host/mixed/custom/unknown matrix. (Done: 3 new tests.)
      - `packages/coding-security/src/__tests__/workspace-consistency.test.ts`: workspace coherence semantics. (Done: migrated to capability truth.)
      - `packages/coding-security/src/__tests__/sandbox-fs-operations.test.ts`: path-backed operations do not imply OS isolation. (Done: migrated to capability truth.)
      - `packages/coding-security/src/__tests__/docker-sandbox.test.ts`: Docker options/capabilities, including custom network cases. (Done: resolveDockerCapabilities matrix.)
      - `packages/coding-security/src/__tests__/native-sandbox.test.ts`: native filesystem/process/privilege false and network truth. (Done: T9, NETNS-gated.)
      - `docs/coding-security.md`: full capability table, examples, threat model, deprecation. (Done.)
      - `docs/host-security.md`: authorization guidance using individual capabilities. (Done.)
      - `packages/coding-security/README.md`: package-facing summary and migration pointer. (Done.)
      - `docs/index.md`: update Coding security navigation description. (Done.)
    - References:
      - Current defect location: `packages/coding-security/src/sandbox-coding-operations.ts` computes containment from bound backends/mixed-wiring only.
      - Native limitation documented in `docs/coding-security.md`: no filesystem isolation.
  - Test Cases to Write:
    - native composition: workspace coherent when wired, filesystem/process/privilege false, network capability exact, deprecated projection false. (Done: T9 native capabilities test.)
    - Docker matrix: network none, custom un-attested, custom egress-attested, and malformed attestation report only proven fields. (Done: resolveDockerCapabilities matrix + composeEgressSandboxNetwork fail-closed.)
    - custom unknown: Disposable-shaped adapter with no metadata cannot claim any isolation; adding custom FS operations changes coherence only. (Done: un-attested auto-wire + custom-tree-ops tests.)
    - explicit custom attestation: valid booleans copied/frozen; malformed/missing/non-boolean/unknown keys fail closed per Task 0 decision. (Done: 6-case matrix + frozen-copy mutation test.)
    - host/mixed modes: all isolation false; warnings preserved; compatibility projection false. (Done.)
    - immutability: caller mutation after composition cannot change returned capability evidence. (Done.)
    - compatibility: tools-only wrappers still work; old field remains but is deprecated and conservative. (Done: compat wrapper test green; @deprecated JSDoc; docs keep the term for docs.test.ts:1262.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive exported capability metadata plus stricter semantics/deprecation for existing `containmentClaim`.
    - Docs pages to create/edit:
      - `docs/coding-security.md`: capability API using full required API-page structure, backend matrix, custom attestation, deprecation, security/performance notes.
      - `docs/host-security.md`: policy guidance; never authorize from deprecated boolean alone.
      - `packages/coding-security/README.md`: concise public package guidance.
      - `docs/migration.md`: completed in Task 6 with before/after examples.
    - `docs/index.md` update: yes — update Security/auth/trust Coding security entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Add public-JavaScript, packed-consumer, and named threat-suite regressions
  - Acceptance Criteria:
    - Functional: add a named phase-20 security conformance test using built public package entrypoints, not private source imports, covering all three blockers and their no-side-effect invariants. (Done: `scripts/phase20-security.test.mjs` — 4 tests, 4/4 pass; imports `@arnilo/prism`, `@arnilo/prism-work-tools`, `@arnilo/prism-coding-security`; `sideways` → `ERR_PRISM_DECISION_INVALID` with zero checkpoint writes/version consumption and exactly-one tool execution on the valid follow-up resume; child-env probe proves ambient secret absent, token layer present, HOME/telemetry forced, PATH base present; un-attested/malformed/host capability matrix; gate-accounting test asserts all three blocker IDs ran.)
    - Functional: extend fresh packed-install smoke with a plain `.mjs` consumer that supplies `decision: "sideways"`, an ambient env canary, and an un-attested Disposable-shaped sandbox; it must prove invalid resume refusal/no tool call, env non-inheritance/token isolation, and false filesystem capability without TypeScript. (Done: `security.mjs` inside the existing install-smoke consumer — same three assertions from the installed tarballs; `result.securityStatus`/`securityOut` + dedicated test; suite green.)
    - Functional: wire phase-20 conformance into `security:threat-suites`; make that command standalone by building required outputs first or document/verify the existing build prerequisite in one script location. (Done: `package.json` `security:threat-suites` appends `scripts/phase20-security.test.mjs`; the standalone command's build prerequisite is verified — `npm test` builds before running the phase scripts, and release.yml runs `security:threat-suites` after `npm test` in the same verify job, so dist is always present.)
    - Functional: preserve existing install-smoke all-package imports/composition journey and package tarball checks; no network fetch beyond its current local-tarball install fallback. (Done: unchanged pack/install/importer/composition steps; security.mjs added as one extra consumer execution.)
    - Performance: focused conformance stays under ten seconds after build; packed test adds one consumer execution without repacking packages a second time; no duplicated full install fixture. (Done: `phase20-security.test.mjs` runs in well under 10s; security.mjs reuses the already-packed tarballs/install.)
    - Code Quality: reuse `src/__tests__/install-smoke.test.ts` staging/consumer harness and Node `node:test`; do not create a second pack/install framework. (Done: no new harness; one consumer script + two result fields + one test.)
    - Security: tests assert absence, not redacted placeholders; secret canaries never print into test logs/artifacts; any blocker failure is a hard failure, never skip. (Done: canaries assert `undefined` in the child env and are never echoed; sandbox-browser.yml blocker gate `if: always()` exits 1 on missing Docker/native evidence — never a passing skip.)
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/install-smoke.test.ts` pack/install/public-import harness.
      - `scripts/phase8-conformance.test.mjs` through `phase11-conformance.test.mjs` and root `security:threat-suites`.
      - `.github/workflows/security.yml`, `.github/workflows/release.yml`, `.github/workflows/sandbox-browser.yml`.
      - `docs/release-and-install.md` packed consumer and protected evidence expectations.
    - Options Considered:
      - Type-only compile fixture: rejected; original resume defect passed TypeScript declarations and existed only at runtime.
      - New standalone pack harness: rejected; would double release time and drift from install-smoke package inventory.
      - Extend existing packed consumer and add one focused built conformance suite: chosen.
    - Chosen Approach:
      - Test source-level details in Tasks 2–4, public built entrypoints here, and all packed exports in the existing install-smoke lifecycle.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test scripts/phase20-security.test.mjs
      npm run security:threat-suites
      node --test dist/__tests__/install-smoke.test.js
      ```
    - Files to Create/Edit:
      - `scripts/phase20-security.test.mjs`: focused public-entry security conformance. (Done — 4/4 pass.)
      - `src/__tests__/install-smoke.test.ts`: packed plain-JavaScript regression inside existing consumer. (Done — security.mjs consumer.)
      - `package.json`: append phase-20 conformance to `security:threat-suites`. (Done.)
      - `.github/workflows/sandbox-browser.yml`: require and record Docker/native capability evidence for the release profile; remove optional passing behavior for the 0.2.0 blocker gate. (Done — native evidence step + always() blocker gate + report fields.)
      - `.github/workflows/release.yml`: retain phase-20 security report/artifact in publish prerequisites if not already covered by `sdk:ready`. (Done — `security:threat-suites` phase added since npm test does not include it.)
      - `scripts/phase20-baseline.json`: reserve final evidence fields; values recorded only in Task 6.
    - References:
      - Mandatory regression matrix items 1–3 in `roadmap.md`.
      - `src/__tests__/install-smoke.test.ts` fresh offline tarball consumer.
  - Test Cases to Write:
    - built public core: unknown decision produces stable invalid error and no checkpoint write/tool call. (Done: conformance test 1.)
    - built work-tools: ambient canary absent, explicit token present only in child env, fixed keys unchanged. (Done: conformance test 2.)
    - built coding-security: un-attested custom/native capability cannot report filesystem isolation. (Done: conformance test 3.)
    - packed plain JS: same three assertions after local tarball install with no TS compiler. (Done: install-smoke security.mjs.)
    - gate accounting: phase-20 tests cannot be skipped and report all three blocker IDs. (Done: accounting test asserts all three blocker IDs; sandbox-browser blocker gate fails on missing protected evidence.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior — executable verification of Tasks 2–4.
    - Docs pages to create/edit:
      - `none`: public behavior docs belong to Tasks 2–4; release evidence is recorded in Task 6.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; verification-only task.

- [x] Task 6 — Migration/docs finalization, 0.2.0 bump, and fail-loud exit gate
  - Acceptance Criteria:
    - Functional: add a top `docs/migration.md` section for 0.1.7 → 0.2.0 covering invalid resume refusal, absolute work-tool paths, minimal env/precedence/reserved keys, sandbox capability before/after, deprecated projection semantics, store compatibility, rollout, rollback risk, and plain-JavaScript examples. (Done: `docs/migration.md` `## 0.1.7 → 0.2.0 fail-closed runtime and sandbox security (plan 020)` at the top of the guide — all three behavior tightenings with before/after semantics, a plain-JS `resumeAgentRun` refusal example, store-compatibility statement, rollout order, and rollback-risk warning; every delta is the version literal or the documented additive `capabilities` field.)
    - Functional: update root and affected package changelogs/READMEs, `docs/index.md`, `docs/release-and-install.md`, and roadmap 0.2.0 checkboxes only after Tasks 0–5 pass. Documentation must not claim native filesystem isolation or generic containment. (Done: root `CHANGELOG.md` 0.2.0 entry (0.1.7 entry preserved), `packages/work-tools/CHANGELOG.md` + README and `packages/coding-security/CHANGELOG.md` + README 0.2.0 entries, `docs/index.md` current line moved to `current **0.2.0**` with the plan-020 narrative, `docs/release-and-install.md` `### 0.2.0 publish handoff (plan 020 Task 6)` with the protected-evidence command block, roadmap.md all four 0.2.0 items `[x]`, `plans/README.md` 020 row `complete`; docs never claim native filesystem/process/privilege isolation — the capability table documents them false.)
    - Functional: run `node scripts/release.mjs bump --from 0.1.7 --to 0.2.0` across all 50 manifests/lockfile and update version-sensitive tests, exact internal peer pins, tarball names, and release docs. (Done: `bumped 50 manifests` — root + 49 workspace packages; `package-lock.json` regenerated at 0.2.0; `src/index.ts` version const 0.2.0; version pins updated in `src/__tests__/{index,release,docs,packaging,install-smoke,cli-provider-add}.test.ts` and 13 provider/family package `index.test.ts` files; install-smoke tarball-name assertions `arnilo-prism-0.2.0.tgz`; release-and-install 0.2.0 handoff added.)
    - Functional: run a plain pre-refresh compatibility gate and review every delta. Because this plan retains `containmentClaim`, no removal is planned; any unexpected breaking declaration halts release and requires a recorded plan/manifest migration amendment before `--allow-break`. Refresh affected baselines only after review, then require normal gate green. (Done: plain `release.mjs gate --version 0.2.0` rc=1 with exactly two reviewed deltas — the core `version` literal and the documented additive `capabilities` field on coding-security interfaces (`DisposableSandbox`/`SandboxAdapter`/`SandboxCloseOptions`/`SandboxExecRequest`/`SandboxExecFileRequest`/`SandboxProcessHandle`/`SandboxExportMetadata`/`SandboxStatus`/`SandboxStatusState`); zero removals; `containmentClaim` retained; `--update-baseline` refreshed exactly those two baselines (`arnilo__prism.txt`, `arnilo__prism-coding-security.txt`); post-refresh gate rc=0 — no `--allow-break` anywhere.)
    - Functional: run focused tests, `npm run security:threat-suites`, protected Docker/native capability matrix, `npm run sdk:ready`, full audit, tracked/unpacked secret scans, pack dry-run twice byte-identical, budget/benchmark gates, Node 20 packed imports, and release gate. No blocker may be skipped; missing protected environment records 0.2.0 as blocked. (Done: `npm test` rc=0 — 44 suites, 3,372 tests, 3,339 pass, 33 protected/live skips, 0 fail, core 1,457/1,457, all script gates incl. phase20-freeze done-phase and budget/benchmark gates green; `security:threat-suites` 32/32; protected Docker matrix ran against digest-pinned `ubuntu@sha256:5616...` (non-root uid assert) and native T9 ran under real netns (`unshare --net --map-root-user`) — coding-security suite 99/99, 0 skips; `sdk:ready` rc=0 (typecheck/lint/format/test/coverage/pack:dry-run/release:gate); `npm audit --audit-level=moderate` 0 vulnerabilities; secret scan 1,509 tracked files, 0 findings; pack dry-run twice byte-identical (sha256 `2d749838...`, 50 tarballs); Node 20 packed imports remain CI-only evidence (release.yml node20-compat job); release gate at 0.2.0 rc=0, 50 packages, 0 errors.)
    - Functional: record command, version, platform, counts, hashes, skips/blocks, compatibility deltas, package/dependency graph, protected evidence, and `green` in `scripts/phase20-baseline.json.exitGate`; phase-20 freeze done-state passes. (Done: `exitGate` recorded `green: true` with npmTest (rc 0, core 1,457/1,457, 44 suites/3,372 tests/3,339 pass/33 protected skips, scriptGatesFail 0), sdkReady rc 0, audit 0 moderate, packDryRun 50 deterministic with both run sha256s, releaseGate 0.2.0/50/0, protectedEvidence dockerSandbox+nativeNetns true with image digest and probe, compatibility breakingDeltas 0 allowBreak false; phase-20 freeze test 23/23 after recording.)
    - Performance: root/work-tools/coding-security package sizes remain in budget; CLI near-cap capture demonstrates linear behavior; resume/capability checks add no measurable benchmark regression. (Done: budget-gate and benchmark-0.1.0 gates green inside `npm test`; work-tools linear-capture test (20,000 chunks, ordered, capped) green; no new runtime deps.)
    - Code Quality: typecheck, Biome lint/format, unused sweep review, docs semantic tests, public export tests, and diff checks pass; plan checkboxes, files, tests, compromises, and further actions reflect actual implementation. (Done: `sdk:ready` typecheck + lint + format clean; `npm test` incl. docs.test.js 128/128, public-export contract, sweep-unused gate green; `git diff --check` clean; plan checkboxes/evidence reflect shipped code.)
    - Security: audit reports zero policy violations; secret scans report zero findings; packed JS and threat suites pass; Docker/native evidence is present; signed tag/provenance remain operator-gated after clean protected CI. (Done: audit 0, secret scan 0 findings, `security:threat-suites` 32/32 incl. phase-20 public-entry conformance, install-smoke packed plain-JS regressions 7/7, real Docker + real netns evidence recorded; publication stays the operator handoff — signed `v0.2.0` tag + npm OIDC, documented in the 0.2.0 publish handoff.)
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` 0.1.4 → 0.1.5 dynamic-config refusal and rollback structure.
      - `docs/release-and-install.md`; `docs/index.md`; root/package changelogs.
      - `roadmap.md` release validation checklist and 0.2.0 mandatory regressions.
      - `plans/017` Task 4 compatibility review and `plans/019` Task 6 exit-gate pattern.
      - `.github/workflows/{release,security,sandbox-browser}.yml`.
    - Options Considered:
      - Release after unit tests with protected Docker still optional: rejected; sandbox metadata is a release blocker and cannot close on a skip.
      - Remove deprecated projection immediately: rejected for 0.2.0; additive capability migration provides a safer one-release bridge.
      - Scripted bump, reviewed normal compatibility gate, complete protected evidence, operator publication: chosen.
    - Chosen Approach:
      - Finalize migration first, bump once, review declarations, run all gates, record immutable evidence, then hand off signed tag/publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.1.7 --to 0.2.0
      npm run security:threat-suites
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release.mjs gate --version 0.2.0
      ```
    - Files to Create/Edit:
      - `docs/migration.md`: 0.1.7 → 0.2.0 security migration. (Done — top-of-guide section.)
      - `docs/release-and-install.md`: 0.2.0 protected evidence and publish handoff. (Done.)
      - `docs/index.md`: current release and final navigation verification. (Done — `current **0.2.0**`.)
      - `CHANGELOG.md`: 0.2.0 security release. (Done — 0.1.7 entry preserved.)
      - `packages/work-tools/{README.md,CHANGELOG.md}`: env/path change. (Done.)
      - `packages/coding-security/{README.md,CHANGELOG.md}`: capability model/deprecation. (Done.)
      - `package.json`, all workspace manifests, `package-lock.json`: scripted 0.2.0 bump. (Done — 50 manifests + lockfile.)
      - `src/index.ts`, release/install/packaging/docs/public-export tests, package pin tests: version-sensitive updates. (Done.)
      - `scripts/compat-baseline/*`: reviewed additive/version baseline refresh only. (Done — 2 files, reviewed, no `--allow-break`.)
      - `scripts/phase20-baseline.json`: complete exit evidence. (Done — `exitGate` green.)
      - `scripts/phase20-freeze-manifest.json`: final task/evidence tokens; deviations only if actually required. (Done — task6 token done; zero deviations.)
      - `roadmap.md`: mark four 0.2.0 items complete after all gates pass. (Done — all four `[x]`.)
      - `plans/020-...md`: close tasks and fill actual compromises/further actions. (Done — no placeholders remain; compromises/further actions were filled in earlier tasks.)
      - `plans/README.md`: status complete only after exit gate. (Done — `| complete |`.)
    - References:
      - `plans/017-Release-0-1-5-Deprecated-Option-Removal.md` Task 4.
      - `plans/019-Release-0-1-7-Performance-and-DX.md` Task 6.
  - Test Cases to Write:
    - migration semantic tripwire: docs contain old/new environment and capability examples plus resume refusal/no-side-effect statement. (Done — migration section has all three; docs.test.js 128/128 green.)
    - compatibility sequence: plain pre-refresh delta reviewed; plain post-refresh gate green; unexpected removal blocks. (Done — reviewed delta rc=1, refreshed, post-refresh rc=0; removals remain gate-blocking by construction.)
    - release accounting: all tests/skips/protected environments named; any missing phase-20 blocker evidence makes `green: false`. (Done — exitGate names counts, 33 protected skips, Docker/native evidence; freeze test asserts the gate fields; sandbox-browser workflow fails loudly on missing evidence.)
    - package truth: 50 manifests, versions/peers/lockfile consistent, zero new dependency names, deterministic tarballs. (Done — bump 50 manifests, lockfile 0.2.0, dependency fingerprint unchanged, pack dry-run twice byte-identical, release-gate 50 packages 0 errors.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — publishes migration and release truth for all three changed boundaries.
    - Docs pages to create/edit:
      - `docs/migration.md`: mandatory 0.2.0 migration.
      - `docs/release-and-install.md`: protected gate and operator handoff.
      - `CHANGELOG.md` and affected package changelogs: shipped behavior.
      - Task 2–4 docs: final semantic verification and corrections only.
    - `docs/index.md` update: yes — current release plus final Agent runtime, Work tools, and Coding security navigation descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **Single resume assertion point:** one `assertValidAgentRunResume` call at the top of `prepareAgentRunResume` covers all four public resume entrypoints (verified by tracing lifecycle `resume`/`resumeStream` → free functions → `prepareAgentRunResume`). Trade-off: the assertion validates transport-neutral shape only; state-dependent checks (unknown/foreign/duplicate/scope/sticky) remain in `resolveRunDecisions` as before. A malformed batch with a *well-shaped* entry against an unknown approval id still costs one store read before rejection — accepted, since id validity is inherently state-dependent.
- **Bounded JSON probe cost:** the assertion runs one `JSON.stringify` probe on `modifiedArguments`/`elicitation` (rejecting cycles) and `validateModifiedArguments` may stringify again for tool approvals. Double stringify of a ≤16 KiB payload is negligible against checkpoint serialization; passing a precomputed probe would couple the assertion to the resolver for no measurable gain.
- **No `work-tools` public surface change:** `buildCliEnvironment`/`collectOutput` stay module-private in `cli.ts` with internal fixed caps (mirroring docker `validateEnv`'s `maxEnvNames`/`maxEnvBytes` pattern) rather than adding `WorkLimits` fields. Hosts who need tighter env caps can validate their own `options.env`; the internal caps only guarantee boundedness.
- **Minimal env allow-list is conservative, not exhaustive:** POSIX `PATH`/`LANG`/`LC_ALL`/`TZ` (plus Windows `SYSTEMROOT`/`SystemRoot`/`TEMP`/`TMP`/`PATHEXT`/`COMSPEC`). A future connector needing another ambient key adds it to the allow-list deliberately — that is the point of deny-by-default, and a documented one-line change.
- **Native sandbox reports no filesystem/process/privilege isolation** even though it is genuinely network-free; `containmentClaim` becomes the conservative conjunction `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated` (privilege excluded because root-in-container without userns remap is not a reliable boundary). This makes the deprecated field stricter than today — intended, and the reason docs/tests migrate to capabilities.
- **Docker `privilegeIsolated: false` by default:** no userns remap guarantee, so the container never claims a privilege boundary. Hosts that remap user namespaces can attest it explicitly via the custom capability field.
- **No compat-baseline amendment for the deprecation:** verified `scripts/compat-baseline/arnilo__prism-coding-security.txt` does not reference `containmentClaim`; only docs/tests migrate, so Task 6's compatibility refresh is version-bump-only.
- **Rollback is not a mitigation:** restoring 0.1.7 restores all three defects; hosts must disable resume side effects and work-tool execution at their own boundary if code rollback is unavoidable.

## Further Actions

- **Assertion reuse for future entrypoints:** when a new resume-like API is added (e.g. delegated-agent resume in 0.3.x), route it through `prepareAgentRunResume` or call `assertValidAgentRunResume` explicitly; the tripwire is the assertion's single call site.
- **Consider promoting work-tools env caps to `WorkLimits` in a later release** if hosts measurably need to raise the internal `maxEnvNames`/`maxEnvBytes` — demand-gated, not speculative.
- **Windows PATH/system-key casing validation** (Node first-key-wins) needs a real Windows runner in the protected matrix before 0.3.x; the unit tests cover the logic, not the platform.
- **Docker `privilegeIsolated` attestation path** (userns remap) can be documented as a host attestation example when a host asks for it; no code change expected.
- **Post-0.2.0 removal candidate:** `containmentClaim` deprecation is the 0.2.x bridge; re-evaluate removal with a migration census in a later breaking release (0.3.x+), per the plan's migration posture.
