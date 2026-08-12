# Phase 20 (0.2.0) primitive review — fail-closed runtime and sandbox security

Evidence file for plan 020 Task 0 (`plans/020-Release-0-2-0-Fail-Closed-Runtime-and-Sandbox-Security.md`).
Reviewed 2026-08-12 at HEAD `051470a` (0.1.7 baseline). Scope: the three confirmed
review defects — durable-resume accepts unknown decisions, work-tool subprocesses
inherit ambient host environment, and sandbox containment metadata overclaims.
Method: reuse-first inventory of what already exists, then a written gap analysis per
blocker; a new primitive is proposed only where a real gap exists, and each new seam
ships with its concrete first consumers in the same phase (no single-consumer
extraction). This document is intentionally tarball-excluded like its phase 18/19
predecessors; nothing here changes public behavior.

Three new primitives are approved by this review, each with at least two consumers:

1. `assertValidAgentRunResume()` — transport-neutral resume-input shape assertion in
   `src/agent-approval.ts`, invoked once from `prepareAgentRunResume()` and covering
   all four public resume entrypoints (Task 2).
2. Package-local `buildCliEnvironment()` / `collectOutput()` helpers in
   `packages/work-tools/src/cli.ts` — minimal bounded child environment and linear
   output capture (Task 3). No new module, no new public exports.
3. `SandboxCapabilities` type + `resolveSandboxCapabilities()` — additive capability
   metadata on `SandboxAdapter`, resolved by sandbox composition; consumed by the
   Docker adapter, the native adapter, custom adapters, and the composition itself
   (Task 4).

---

## 1. Durable-resume input validation (plan Task 2)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `AgentDecisionError` (6 codes: `ERR_PRISM_DECISION_STALE` / `_UNKNOWN` / `_DUPLICATE` / `_SCOPE` / `_INVALID` / `_LIMIT`) | `src/contracts-run-state.ts:143-158` | The existing shared error contract for every decision violation; reused verbatim, no new error class. |
| `AgentRunResume` (`expectedVersion`, `decision?`, `decisions?`) | `src/contracts-run-state.ts` (resume section) | The public input shape; typed callers are already correct, untyped callers are the gap. |
| `RunDecision` (`approvalId`, `outcome`, `reason?`, `modifiedArguments?`, `elicitation?`) | `src/contracts-run-state.ts:66-78` | The batch entry shape; each field already has an existing bound used below. |
| Limits: `HARD_MAX_PENDING_DECISIONS` 128, `DEFAULT_MAX_PENDING_DECISIONS` 32, `MAX_DECISION_REASON_BYTES` 2 KiB, `MAX_ELICITATION_BYTES` 16 KiB, `DEFAULT_MAX_STICKY_DECISIONS` 64 | `src/contracts-run-state.ts:160-167` | Existing byte/count ceilings the assertion reuses instead of inventing new numbers. |
| `pendingDecisionsOf(state)` | `src/agent-approval.ts:29-52` | Synthesizes the legacy single-approval shape from state; authoritative pending set for legacy `approve` mapping. |
| `resolveRunDecisions({agent, state, decisions, signal})` | `src/agent-approval.ts:56-143` | Atomic fail-closed state-dependent validation: empty batch, cap, duplicate/unknown ids (shared non-enumerating error), outcome whitelist, reason bytes, scope checks, modified-arguments revalidation, elicitation revalidation, sticky cap. |
| `validateModifiedArguments()` | `src/agent-approval.ts:146+` | Bounded JSON probe (`JSON.stringify` + `MAX_ELICITATION_BYTES`), schema revalidation, input guardrails at decision time. |
| `validateElicitationPayload()` | `src/agent-tool-dispatch.ts` | Bounded, schema-derived elicitation payload validation. |
| `prepareAgentRunResume()` | `src/agent-run-lifecycle.ts:173-330` | The single funnel: `resumeAgentRun` (line 116), `resumeAgentRunStream` (line 127), lifecycle `resume` (→ line 78 → `resumeAgentRun`), lifecycle `resumeStream` (→ line 93 → `resumeAgentRunStream`) all route through it. Verified: one assertion call site covers all four public entrypoints. |
| Server parser `readAgentResume()` / `readAgentDecisions()` | `packages/server/src/handler.ts:684-760` | Transport-level whitelisting (legacy decision strings, batch entry keys/shape, bounded reason/objects) returning `ERR_PRISM_SERVER_RESUME`. Already correct; retained as defense in depth only. |
| Existing resume tests | `src/__tests__/run-decisions.test.ts`, `agent-run-state.test.ts`, `packages/server/src/__tests__/server.test.ts` | Cover approve/deny/batches/sticky/duplicate/foreign/stale and expectedVersion races; none cover unknown decision strings or malformed untyped entries — that is the test gap. |

### Confirmed defect walkthrough

Manual proof at 0.1.7 (recorded in `roadmap.md` review evidence): `resumeAgentRun`
with `decision: "sideways"` — `prepareAgentRunResume` passes the
`=== "approve"` / `=== "deny"` / `=== undefined` checks, `resolved` stays
`undefined`, the dispatched-tool guard does not fire, the checkpoint is CAS-claimed
to `status: "running"`, and the suspended tool executes with `status: "succeeded"`.
The same fall-through exists for non-string legacy decisions and for `as any`
callers. Malformed untyped batch entries additionally crash with raw `TypeError`s
instead of `AgentDecisionError` (e.g. numeric `reason` → `Buffer.byteLength`
TypeError; cyclic `modifiedArguments` → `JSON.stringify` TypeError in
`validateModifiedArguments`).

### Gap analysis

**Already achievable today:** typed callers are fully validated by
`resolveRunDecisions`; the server parser rejects the same inputs at the HTTP
boundary. The runtime itself has no transport-neutral shape gate.

**The gap:** nothing in core validates the *shape* of `AgentRunResume` before
state-dependent resolution. The `decision === "approve"` / `=== "deny"` test is a
two-value whitelist that silently treats every other value as "no decision given,
proceed", and `resolveRunDecisions` assumes well-typed entries (it is correct for
typed callers, not for untyped ones). Core must fail closed on invalid shape at the
runtime boundary, independent of the server, because `resumeAgentRun` is a public
API callable by any host code.

### Approved new primitive (one, dependency-free)

`assertValidAgentRunResume(resume: unknown): asserts resume is AgentRunResume` in
`src/agent-approval.ts` (next to `resolveRunDecisions`, reusing `AgentDecisionError`
and the existing constants). Invoked once at the top of `prepareAgentRunResume()`
*before* `loadAgentRunState`, so invalid input performs no store read, no session
construction, no skill restore, no CAS, and no tool dispatch. Checks:

- non-null object; `expectedVersion` is a positive safe integer;
- exactly one of `decision` / `decisions` (existing `ERR_PRISM_DECISION_INVALID`
  message preserved);
- legacy `decision` is exactly `"approve"` or `"deny"`;
- batch: non-empty array, length ≤ `HARD_MAX_PENDING_DECISIONS`; every entry a
  non-null object; `approvalId` a non-empty string bounded to the same scale as
  existing ids; `outcome` in the four-outcome whitelist; `reason` a string ≤
  `MAX_DECISION_REASON_BYTES` UTF-8; `modifiedArguments` / `elicitation` are
  JSON objects (probe `JSON.stringify` once, reject cycles) ≤
  `MAX_ELICITATION_BYTES` UTF-8.

State-dependent checks (unknown/foreign ids, duplicates, scope, sticky cap, schema,
guardrails, policy) remain exclusively in `resolveRunDecisions` — the assertion never
reads state, never needs the agent, and never serializes checkpoint data.

### Trust boundaries (risks → tests in Task 2/5)

| Risk | Boundary | Test to write |
| --- | --- | --- |
| Unknown legacy decision (`"sideways"`) executes suspended tool | Shape gate before CAS/dispatch | `run-decisions.test.ts` "unknown legacy decision": stable invalid error; checkpoint version/state unchanged; tool counter zero. Same assertion in `scripts/phase20-security.test.mjs` (built public entry) and packed plain-JS consumer (Task 5). |
| Non-string/primitive legacy decision falls through | Same gate | "malformed top-level inputs" matrix. |
| Malformed batch entries crash with raw TypeError or pass partially | Entry shape gate | "malformed batches" matrix: non-array/empty/over-cap/primitive entries/missing or non-string approvalId/unknown outcome/non-string or oversized reason/cyclic or oversized payloads. |
| Stale/foreign/duplicate approvals bypassed by malformed shape | Unchanged `resolveRunDecisions` | Existing stale/foreign/duplicate tests stay green as regression (no behavior change for typed callers). |
| Server-only validation gives false confidence | Core is enforcement; server stays defense in depth | `server.test.ts` parity regression: HTTP layer still rejects the same inputs independently. |
| Invalid input touches checkpoint state | Gate runs before `loadAgentRunState` | Assertion order test: invalid input performs zero store reads (spy on checkpoint store) and zero CAS writes. |

---

## 2. Work-tool subprocess environment isolation and linear capture (plan Task 3)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `createCliRunner()` | `packages/work-tools/src/cli.ts:40-127` | Binary/configDir existence checks, forbidden-argv guard, bounded limits, test `exec` seam, late-bound per-call `runOpts.env` merge. Defect: builds child env as `{ ...process.env, ...options.env, HOME, CLIMICROSOFT365_DISABLETELEMETRY }` (lines 111-119), inheriting every ambient variable; `binary`/`configDir` reject empty/NUL but not relative paths. |
| `assertSafeArgv()` | `cli.ts:22-38` | Empty argv, NUL bytes, forbidden interactive/telemetry tokens — already the argv-side isolation precedent. |
| `WorkToolError` families | `packages/work-tools/src/errors.ts` | `ERR_PRISM_WORK_*` codes; new env/path violations reuse the same family. |
| `resolveWorkLimits()` / `ResolvedWorkLimits` | `packages/work-tools/src/limits.ts` | Defaults: `maxStdoutBytes`/`maxStderrBytes` 2 MiB, `timeoutMs` 60 s, `maxConcurrency` 2; hards 16 MiB / 10 min / 8. Output caps already exist and kill on exceed. |
| `defaultExec` output capture | `cli.ts:63-100` | Defect: repeated `Buffer.concat([buffer, chunk])` (lines 87, 94) copies all prior bytes per chunk — worst-case O(n²) in chunk count up to the 2 MiB cap. |
| `parseCliJson` / `parseCliNdjson` | `cli.ts:141+` | `assertBoundedJson` (depth/properties/bytes, `__proto__`/`prototype`/`constructor` and non-finite rejection) — output parsing is already bounded. |
| Late-bound identity tokens | M365/GWS adapters + tests | Token values reach the child only via per-call env, never argv; missing token refuses before exec; tests assert argv never contains the secret. Preserved unchanged. |
| Docker sandbox env validation `validateEnv()` | `packages/coding-security/src/docker-sandbox.ts:174-192` | Exact env allow-list, `maxEnvNames`/`maxEnvBytes` caps, string-only values — the in-repo precedent for bounded explicit env (host env never inherited). |
| Native sandbox env | `packages/coding-security/src/native-sandbox.ts` | Exact allow-list, PATH only by default, host env never inherited — second precedent. |

### Gap analysis

**Already achievable today:** argv is already isolated (forbidden tokens, NUL
rejection), output is already capped with kill-on-exceed, JSON parsing is bounded,
and both sandbox backends already prove the exact-env pattern in the same repo.

**The gap:** the child environment is the only unisolated surface. `{ ...process.env }`
discloses every ambient variable (manual proof: `PRISM_PROOF_SECRET` reached the
exec seam), and relative `binary`/`configDir` values let a cwd-adjacent attacker
redirect the host-pinned binary or config. Output capture is quadratic in chunk
count, which is unnecessary and load-sensitive near the cap. Nothing bounds env
name/value counts or rejects case-insensitive duplicate keys (relevant on Windows,
where Node's env lookup is case-insensitive and first-key wins).

### Approved new primitive (two package-local helpers in `cli.ts`)

1. `buildCliEnvironment(hostEnv, optionsEnv, tokenEnv)` — returns a frozen child
   env with three layers, in order:
   - *minimal base*: only a fixed allow-list of platform/system keys carried from
     the host, each individually validated and bounded: POSIX `PATH` (bounded to a
     fixed length ceiling; dropped if malformed rather than propagated), `LANG`,
     `LC_ALL`, `TZ`; Windows adds `SYSTEMROOT`, `SystemRoot`, `TEMP`, `TMP`,
     `PATHEXT`, `COMSPEC`. Nothing else is ever inherited — ambient deny-by-default.
   - *explicit host env*: `options.env` (existing surface), validated names/values
     (NUL rejection, string-only, case-insensitive duplicate detection, fixed
     `maxEnvNames`/`maxEnvBytes` internal caps mirroring docker `validateEnv`).
   - *fixed reserved controls*: `HOME` → `configDir`, telemetry-disable flags — set
     last so neither host env nor token env can override them; attempted override
     of a reserved key is an `ERR_PRISM_WORK_ENV` error before spawn.
   Per-call `runOpts.env` (late-bound identity tokens) merges over the frozen base
   at exec time, still unable to touch reserved keys.
2. `collectOutput(onChunk)` — chunk-array accumulator with one final
   `Buffer.concat(chunks, totalBytes)`; when the accumulated total passes the
   stdout/stderr cap the caller kills and rejects without retaining bytes beyond
   the cap. O(total bytes) copying, bounded peak memory.

Both stay module-private in `cli.ts`: no new file, no new public export, no
dependency. The absolute-path requirement is two `path.isAbsolute()` checks in
`createCliRunner` (empty/NUL checks remain).

### Trust boundaries (risks → tests in Task 3/5)

| Risk | Boundary | Test to write |
| --- | --- | --- |
| Ambient secret inheritance (`PRISM_PROOF_SECRET` proof) | Minimal base allow-list; no `process.env` spread | "ambient canary": set unrelated env var; exec seam and real child both prove absence. Same in `phase20-security.test.mjs` and packed consumer (Task 5). |
| Token env overrides fixed isolation fields (HOME, telemetry) | Reserved keys set last; override rejected | "explicit map": allowed env and late-bound token reach child; reserved keys unchanged; attempted override errors before spawn. |
| Relative/empty/NUL binary or configDir (path hijack) | `path.isAbsolute()` + existing empty/NUL checks | "validation": all three refuse before spawn with `ERR_PRISM_WORK_*`. |
| Env name/value abuse (NUL, non-string, duplicates, unbounded count/bytes) | Validation + fixed internal caps | "validation": over-count, over-byte, NUL, case-variant duplicate keys (Windows PATH/system-key casing) all refuse. |
| Output exhaustion / quadratic capture | Chunk array + one final concat + cap kill | "output capture": many chunks near each cap return exact bytes/order; one byte over kills/rejects without oversized retention; stdout/stderr tracked separately. |
| Late-bound token regression (token in argv/errors/output) | Token path untouched | "connector parity": M365/GWS suites stay green; argv never contains secret. |
| Concurrency/abort/timeout races | Unchanged lifecycle | "process lifecycle": abort, timeout, spawn error, close race, counters settle once. |

---

## 3. Sandbox capability metadata (plan Task 4)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `SandboxAdapter` (`exec` only) | `packages/coding-security/src/sandbox.ts:55-57` | The minimal shell-only seam; custom adapters may stop here. |
| `DisposableSandbox` (`id`, `importIdentity`/`lastExportIdentity`, `execFile`, `status`, `stop`, `kill`, `close`, optional `startProcess`) | `sandbox.ts:75-99` | The duck-typed lifecycle shape `isDisposableSandbox()` detects (`execFile` + `close`, `sandbox-coding-operations.ts:105-108`). Interface shape proves callability, never OS isolation — the root of the overclaim. |
| `DockerNetworkConfig` (`none` / `custom`) | `packages/coding-security/src/docker-sandbox.ts:36-56` | The only existing *attested* isolation metadata: custom networks require `EgressAttestation` (`proxyEndpoint` + `denyDirectEgress: true`) via `assertEgressAttestation`/`composeEgressSandboxNetwork`/`assertBrowserSandboxNetwork` before browse-ready use. |
| Native sandbox (`createNativeSandbox`) | `native-sandbox.ts` | Fresh network namespace per command via `unshare`, egress denied, loopback down, POSIX ulimits, group-kill, output cap. Documented limitation: **no filesystem isolation** (commands run as invoking user with host-tree access). |
| Docker sandbox (`createDockerSandbox`) | `docker-sandbox.ts` | Network `none` by default, digest-pinned image, absolute CLI, exact env allow-list. The stronger reference backend. |
| `SandboxCodingComposition` | `sandbox-coding-operations.ts:38-45` | `workspaceMode`, `containmentClaim`, `mixedWiringAllowed`, `warnings`, `workspaceRoot`, optional `treeIdentity`. Defect at line 254: `containmentClaim = backendsBound && !mixedWiringAllowed && warnings.length === 0` — a workspace-wiring statement reported as a containment statement; any Disposable-shaped object can yield `true`. |
| `tryAutoWireSandboxTreeOperations` / `createSandboxFilesystemOperations` / `createSandboxRepositoryOperations` | `sandbox-coding-operations.ts` + `sandbox-fs-operations.ts` | Path-scoped tree backends (`assertSandboxPath` per op). These are workspace-coherence controls, not OS isolation. |
| Existing docs/tests | `docs/coding-security.md`, `docs/host-security.md`, `docs/migration.md:523-524`, workspace-consistency/sandbox-FS/Docker/native suites | `containmentClaim` is documented public surface (compat baseline `arnilo__prism-coding-security.txt` does **not** reference it — verified — so deprecation has no compat-baseline impact; only docs/tests reference it). |

### Gap analysis

**Already achievable today:** Docker custom networks already carry egress
attestation (proxy + deny-direct), native egress denial is real (netns), and
`assertBrowserSandboxNetwork` already fails closed on un-attested custom networks.
Host mode and mixed wiring already set `containmentClaim: false`.

**The gap:** there is no explicit, backend-verified statement of *which* OS
isolation controls a sandbox provides. `containmentClaim` conflates workspace
wiring with OS containment, so native (no filesystem isolation), custom duck-typed
adapters, and mixed wiring can all present a claim that host policy reads as
"isolated". A boolean cannot carry the distinction between "tree backends are
wired to the disposable tree" (workspace coherence) and "the OS enforces
filesystem/network/process/privilege boundaries" (isolation). Native's
documented filesystem limitation is precisely the case the current boolean
misrepresents.

### Approved new primitive (one capability shape + one resolver)

```ts
export interface SandboxCapabilities {
  readonly workspaceCoherent: boolean;   // FS/read/edit/... target the sandbox tree
  readonly filesystemIsolated: boolean;  // OS-enforced FS boundary
  readonly networkIsolated: boolean;     // no network access (docker none; native netns)
  readonly egressRestricted: boolean;    // network exists but egress forced through attested proxy
  readonly processIsolated: boolean;     // separate process/pid namespace
  readonly privilegeIsolated: boolean;   // privilege boundary (e.g. non-root / userns remap)
}
```

- `SandboxAdapter` gains an optional `readonly capabilities?: Readonly<SandboxCapabilities>`
  attestation field. **Omission or invalid values resolve every field to `false`**
  (fail closed). Explicit custom attestation is treated as host attestation:
  copied, validated (booleans only, no unknown keys), frozen, and documented as
  host responsibility — Prism verifies shape, never the truth of a host claim.
- `resolveSandboxCapabilities(sandbox, { workspaceCoherent })` in
  `sandbox-coding-operations.ts` merges adapter attestation with the
  composition-derived `workspaceCoherent` (existing `backendsBound &&
  !mixedWiringAllowed && warnings.length === 0` — now correctly labeled as a
  *workspace coherence* computation, not containment).
- Built-in metadata (Task 4): Docker reports `filesystemIsolated: true`,
  `processIsolated: true` (container namespaces), `networkIsolated: true` only for
  mode `none`, `egressRestricted: true` only for custom + validated attestation,
  `privilegeIsolated: false` by default (no userns remap guarantee). Native reports
  `filesystemIsolated: false`, `processIsolated: false`, `privilegeIsolated:
  false`, `networkIsolated: true`, `egressRestricted: false` (no egress exists).
  Host mode / mixed wiring: all false.
- **Egress decision (Task 0 proves the plan's open question):** `networkIsolated`
  cannot represent Docker custom-attested networks (network exists, egress
  constrained) — so the plan's conditional holds and the narrowly named
  `egressRestricted` field is added rather than overloading `networkIsolated`.
- `containmentClaim` stays for 0.2.0 as `@deprecated`, computed as the conservative
  conjunction `workspaceCoherent && filesystemIsolated && networkIsolated &&
  processIsolated` (privilege excluded: root-in-container is not a reliable
  boundary without userns). No authorization example may rely on it alone.

### Trust boundaries (risks → tests in Task 4/5)

| Risk | Boundary | Test to write |
| --- | --- | --- |
| Native filesystem overclaim (documented no-FS-isolation) | Built-in native metadata | "native composition": workspace coherent when wired; filesystem/process/privilege false; network exact; deprecated projection false. |
| Custom/unknown adapter claims containment by duck typing | Omission → all false; capability field required for any claim | "custom unknown": Disposable-shaped adapter without metadata cannot claim any isolation; adding custom FS operations changes coherence only, never isolation. |
| Docker custom-network ambiguity | `networkIsolated` only for none; `egressRestricted` only with attestation | "Docker matrix": none/custom-unattested/custom-attested/malformed attestation report only proven fields. |
| Capability spoof via malformed untyped attestation | Resolver validates booleans/keys, fails closed | "explicit custom attestation": valid booleans copied/frozen; malformed/missing/non-boolean/unknown keys resolve false. |
| Mixed wiring / host mode misread as contained | All isolation false; warnings preserved | "host/mixed modes": projection false, warnings intact. |
| Caller mutation of capability evidence | Frozen copy | "immutability": post-composition mutation cannot change returned evidence. |
| Downgrade through deprecated `containmentClaim` | Conservative conjunction; docs/tests migrate to capabilities | "compatibility": old field present, deprecated, and stricter; docs/migration examples updated; no auth path depends on it. |
| Capability truth in protected backends | Docker daemon + native netns evidence | Task 5: `sandbox-browser.yml` records Docker/native capability assertions; missing evidence blocks 0.2.0. |

---

## 4. Cross-cutting decisions

### Operational ownership

| Blocker | Owner | Evidence gate |
| --- | --- | --- |
| Durable resume validation | Core runtime maintainer | Unit + built-entry conformance + packed consumer (no protected env) |
| Work-tool environment isolation | `@arnilo/prism-work-tools` maintainer + deploying host | Unit + built-entry conformance + packed consumer (no protected env) |
| Sandbox capability metadata | `@arnilo/prism-coding-security` maintainer + deploying host | Unit + **protected Docker daemon matrix and native netns evidence** (missing → 0.2.0 blocked, not skipped) |
| Release/security sign-off | Prism operator `arn` | Full phase-20 baseline exit evidence, signed tag, OIDC provenance |

### Migration decisions

- **Resume:** no type or checkpoint-shape migration. Untyped callers that previously
  passed invalid decision strings and accidentally resumed now get
  `ERR_PRISM_DECISION_INVALID` before any side effect — the intended security fix.
  Server parser behavior unchanged (defense in depth).
- **Work CLI:** relative `binary`/`configDir` become `ERR_PRISM_WORK_*` errors;
  ambient variables other than the fixed allow-list disappear from child env. Hosts
  pass required non-secret values through existing `options.env`; identity tokens
  continue through `runOpts.env`/token providers, late-bound, never argv.
- **Sandbox:** capability fields are additive; `containmentClaim` remains readable
  but deprecated and stricter (conservative conjunction). Persisted session /
  checkpoint / database schemas are untouched. No compat-baseline amendment needed
  (verified: the coding-security baseline does not reference `containmentClaim`);
  only docs/tests migrate.

### Rollback posture

Restoring 0.1.7 restores the insecure behavior and is **not** a production
mitigation. If code rollback is unavoidable, hosts must disable durable-resume
side effects and work-tool execution at their own boundary until 0.2.0 is
restored. No data migration rollback exists or is needed.

### Package and performance budget

- Publish graph stays **50 packages**; zero new runtime dependencies anywhere; no
  new export subpath. New source is limited to `src/agent-approval.ts`,
  `src/agent-run-lifecycle.ts` (one call), `packages/work-tools/src/cli.ts`,
  `packages/coding-security/src/{sandbox,sandbox-coding-operations,docker-sandbox,native-sandbox,index}.ts`,
  their tests, `scripts/phase20-*`, and docs. Root/package size growth must stay
  within `scripts/budgets.json` tolerance.
- **Resume validation:** one bounded O(batch) pure scan, zero store I/O; invalid
  input now fails *before* `loadAgentRunState` (strictly less work on the failure
  path). Normal-path overhead is negligible against the existing checkpoint
  serialization/CAS cost.
- **Environment construction:** runner creation O(allow-list + explicit env), per
  call O(token env); the current full `process.env` clone is *removed*.
- **Output capture:** worst case drops from O(n²) (repeated `Buffer.concat`) to
  O(total bytes) with one final concatenation; retained memory ≤ cap + one chunk.
- **Capability resolution:** O(1) per composition, one small frozen object, no
  subprocess/network/Docker/DNS operation.

### Security decisions (explicit)

1. Server parsing is defense in depth only — core runtime is the enforcement point.
2. Ambient environment is deny-by-default; only the documented minimal allow-list
   is inherited.
3. Omitted or invalid custom sandbox capability metadata means every isolation
   field is false (fail closed).
4. Deprecated `containmentClaim` can never authorize a security-sensitive action
   by itself; hosts migrate to individual capabilities.

### Code quality decisions (rejected approaches)

- **Generic schema/validation framework** (zod/ajv in core, work-tools,
  coding-security): rejected — all three packages stay dependency-free; the
  assertion is a bounded hand-rolled scan reusing existing constants/errors.
- **Cross-package internal utility package** (e.g. shared env/capability helper):
  rejected — no new workspace package; helpers stay package-local with two or more
  consumers each (four resume entrypoints; two sandbox backends + composition).
- **Sandbox factory hierarchy / capability registry / runtime discovery**: rejected
  — one type + one resolver, built-ins self-describe statically.
- **New interface with one consumer**: rejected — the capability shape has three
  consumers (Docker, native, composition resolver) and the assertion has four
  entrypoints; each new primitive ships with its consumers in the same phase.
- **New public exports from work-tools**: rejected — helpers stay module-private.
  coding-security adds only the additive capability types to `index.ts`.

---

## 5. Threat-to-test traceability (tripwire inputs for Task 1)

| # | Threat | Mitigating task | Named tests |
| --- | --- | --- | --- |
| T1 | Unknown legacy decision executes suspended tool | Task 2 (gate) + Task 5 (built/packed) | `run-decisions.test.ts` unknown-legacy-decision; `phase20-security.test.mjs` built public core; install-smoke packed plain JS |
| T2 | Malformed batch crashes/partially applies | Task 2 | `run-decisions.test.ts` malformed top-level inputs + malformed batches; lifecycle/stream no-side-effect |
| T3 | Stale/foreign/duplicate approval regression | Task 2 (untouched resolver) | existing `run-decisions.test.ts`/`server.test.ts` suites stay green |
| T4 | Ambient secret inheritance | Task 3 + Task 5 | work-tools "ambient canary"; `phase20-security.test.mjs` built work-tools; packed consumer |
| T5 | Token env overrides fixed isolation fields | Task 3 | work-tools "explicit map" reserved-key cases |
| T6 | Relative/path-hijacked executable/config | Task 3 | work-tools "validation" absolute-path matrix |
| T7 | Output exhaustion / quadratic capture | Task 3 | work-tools "output capture" near-cap chunks + cap kill |
| T8 | Custom capability spoof or omission | Task 4 + Task 5 | coding-security "custom unknown" + "explicit custom attestation"; `phase20-security.test.mjs` built coding-security |
| T9 | Native filesystem overclaim | Task 4 | coding-security "native composition" |
| T10 | Docker custom-network ambiguity | Task 4 | coding-security "Docker matrix" |
| T11 | Mixed wiring misread as contained | Task 4 | coding-security "host/mixed modes" + workspace-consistency suite |
| T12 | Downgrade through deprecated metadata | Task 4 | coding-security "compatibility" + migration docs semantic tripwire (Task 6) |
