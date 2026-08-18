# Phase 18 (0.1.6) primitive review and threat model — acp-session-store

Evidence file for plan 018 Task 1 (demand-gated closeouts). Reviewed 2026-08-11.
Demand record: closeout `acp-session-store` demanded by **a consuming app** (2026-08-11) —
ACP sessions must survive agent restart (live registry state: session bindings,
mode/config values); the in-memory registry is insufficient.

The other four closeouts (`native-sandbox`, `doc-reader`, `delete-glob`,
`checkpoint-bodies`) remain deferred with empty demand evidence; their
primitive review runs when demand lands (per plan 018 Task 1 acceptance).

## Primitive inventory (what already exists)

| Primitive | Location | What it gives this closeout |
| --- | --- | --- |
| `AcpSessionStoreSeams` (`load`/`list`/`delete`/`resume`/`additionalDirectories`) | `packages/ag-ui/src/acp/capabilities.ts` | Host-owned **protocol-level** session store; presence advertises `sessionCapabilities`. Pattern precedent: host-owned seam, presence ⇒ capability, absent ⇒ no advertisement. Reused for naming/shape, not for registry durability. |
| `authorize` seam → `AgUiAuthorization.ownership` (`OwnershipScope`) | `packages/ag-ui/src/acp/agent.ts:82`, `packages/ag-ui/src/types.ts` | Host binds transport identity to Prism ownership — the cross-tenant key. Restore MUST re-check it. |
| `ActiveSession` registry (in-memory `Map`, cap-checked `registerSession`) | `packages/ag-ui/src/acp/agent.ts:146-147,416-422` | Current durability gap. Holds `binding.session.id`, `controller`, `modeId`, `configValues`, `client`, `budget`. Duplicate/full registry fail closed (`ERR_PRISM_ACP_INPUT`/`ERR_PRISM_ACP_LIMIT`). Default cap 32, hard 128 (`packages/ag-ui/src/limits.ts:62-63,196,237`). |
| `modes` seam (`AcpModesSeam`, `initialModeId`, `toSessionModeState`) | `packages/ag-ui/src/acp/modes.ts` | Mode table + per-session `modeId`; restore must rehydrate `modeId` from stored state, never from defaults. |
| `configOptions` seam (`initialConfigValues`, `toSessionConfigOptions`, `validateConfigOptionValue`) | `packages/ag-ui/src/acp/modes.ts` | Per-session `configValues`; same rehydration requirement. |
| `AcpSessionBinding` (`{ session, agentId? }` via `sessionFactory`/`load`/`resume`) | `packages/ag-ui/src/acp/agent.ts:33-36` | Host-owned binding construction; a restart-restored registry entry must still resolve a live `AgentSession` through the host factory, not re-create it agent-side. |
| `resolveSessionInputs` (cwd/additionalDirectories/mcpServers policy + byte caps) | `packages/ag-ui/src/acp/agent.ts:438-461` | Persisted `cwd`/`additionalDirectories` must be re-validated on restore, not trusted from storage. |
| `SecretRedactor` (core), `AgentRunLifecycle.resumeStream` (durable resume), `AgUiProjection` | core `@arnilo/prism` | Redaction boundary for any persisted payload; durable-run resume already exists and is out of scope. |
| Host-owned store packages (`session-store-sqlite`, `session-store-postgres`), checkpoint codecs (`session-store-codecs`) | `packages/` | Storage-topology precedent: hosts own stores; the agent only defines the seam. |
| `docs/acp.md` "Persistence and ownership" (plan 013 Task 5) | `docs/acp.md:112-136` | Contract: agent never persists mode/config itself; host persistence MUST key by `sessions.ownership`; cross-tenant restore rejects `ERR_PRISM_ACP_INPUT`. Task 2 turns the guidance into the seam's enforcement. |

## Gap analysis

**What is already achievable with existing primitives:** a host can persist
sessions today via `AcpSessionStoreSeams` and reconstruct bindings on
`session/load`/`resume`; mode/config persistence is already a host decision
with documented ownership scoping (plan 013 Task 5).

**What is not achievable:** the agent-side registry (`sessions` Map) is
closure-scoped and lost on restart. After restart: no session is registered
until a client explicitly calls `session/load`/`resume`; `modeId`/`configValues`
of previously active sessions are gone (recomputed from defaults per
`docs/acp.md:114`); `configuration_changed` broadcasts reach only
post-restart registrations; `session/delete`/`cancel` state and per-session
`updatedAt` are lost. The consuming app's resume-without-reload flow needs the registry
itself to survive restart.

## New primitive (one, generic, host-owned)

`AcpSessionStore` — an optional, host-owned durability seam on
`CreatePrismAcpAgentOptions` (alongside the existing `sessions?` protocol
store):

```
interface AcpSessionStore {
  save(entry: PersistedSession): Promise<void>;   // upsert on register/set_mode/config change/close
  loadAll(signal): Promise<readonly PersistedSession[]>; // bounded, at agent startup
  evict(sessionId): Promise<void>;                // on close/delete
}
interface PersistedSession {
  sessionId: string;
  ownership: OwnershipScope;        // from authorize(); the only valid key
  modeId?: string;                  // rehydrated via modes seam
  configValues: Record<string, boolean | string>; // rehydrated via configOptions seam
  cwd: string;                      // re-validated via resolveSessionInputs policy on restore
  additionalDirectories: readonly string[];
  updatedAt: string;                // ISO 8601
}
```

- Generic: it is a durability seam, not ACP protocol logic; the concrete first
  consumer is the ACP agent (plan 018 Task 2). No interface with no
  implementation — the seam ships only with its consumer.
- Explicit activation: absent seam ⇒ registry behaves byte-identically to
  0.1.5 (in-memory, cap 32 default / 128 hard). Store is only opened when the
  host supplies it.
- Persisted shape deliberately excludes `client`, `controller`, `budget`
  (ephemeral stream state) and pending decisions (durable approvals already
  live in core); on restore the agent re-resolves the live `AgentSession`
  binding through the host `sessionFactory` at first touch.
- Defaults discipline preserved: `modeId`/`configValues` restore from the
  stored entry for the same `ownership`; anything else falls back to
  `defaultModeId`/`defaultValue` exactly as today.
- Stale doc label to fix in Task 2: `docs/acp.md:136` still says agent-owned
  persistence is "0.2.0 Module E"; the 2026-08-10 resequencing moved it to
  0.1.6 — the persistence section must point at 0.1.6 and the new seam.
- No new core dependency, no second runtime, no implicit activation; storage
  topology stays host-owned (Product Boundaries).

## Threat model (risks → tests)

| # | Risk | Mitigation | Test |
| --- | --- | --- | --- |
| T1 | Cross-tenant state leakage: a restored entry's stored `ownership` differs from the current `authorize()` result; a `sessionId` alone collides across tenants | Restore refuses with `ERR_PRISM_ACP_INPUT` and never merges; ownership is the only key (`docs/acp.md` contract, enforced) | cross-tenant restore refusal |
| T2 | Secrets leak into persisted payloads | `PersistedSession` carries only the frozen shape; every field passes through the existing redactor at the store boundary before `save` | redaction of persisted fields |
| T3 | Corrupt/stale store records poison the registry | Fail-closed: entry dropped + error surfaced; never merged, never defaulted silently | corrupt-record drop |
| T4 | Tampering/replay of store rows | Host-owned store is the trust boundary (documented in the threat model); no integrity claim beyond what the host's store provides — at-least-once, no exactly-once (core contract) | (documented boundary; adversarial test only if the seam adds a checksum — it does not) |
| T5 | Resource exhaustion: restored entries exceed the registry cap; oversized rows | Registry cap (32 default / 128 hard) enforced on restore exactly as on `registerSession`; store read bounded (page/byte cap) | cap preserved across restore |
| T6 | Implicit activation: the store opens without the host asking | Store touched only when the seam is present; default path byte-identical to 0.1.5 | default in-memory unchanged |
| T7 | Restart resume inconsistency / unknown outcome | No exactly-once claim; resume follows the existing durable-resume + unknown-outcome recovery paths | restart restores mode/config/task state |
| T8 | Mode/config cross-session leak on restore | Restore rehydrates only for matching `ownership` + `sessionId`; `validateConfigOptionValue` re-runs; unknown values refuse or fall back to defaults per seam policy | per-session mode/config isolation |
| T9 | DoS via oversized/adversarial store entries | Byte caps on every persisted string (reuse `limits.acpAdditionalDirectoryPathBytes`-style bounds); loadAll bounded | oversized-entry refusal |

## Decision record

- **Reuse over build:** `AcpSessionStoreSeams` naming/presence pattern,
  `authorize` ownership, modes/config rehydration helpers, `SecretRedactor`,
  session-store package precedent — all reused; nothing reimplemented.
- **No premature abstraction:** one seam, one consumer (ACP agent). The
  generic delegated-agent contract stays 0.2.0 (roadmap Priority Rule 4).
- **Review order:** review precedes implementation (plan 018 Task 1 before
  Task 2); deferred closeouts are reviewed only when demand lands.

---

# Phase 18 primitive review and threat model — native-sandbox (plan 018 Task 3)

Reviewed 2026-08-11. Demand record: closeout `native-sandbox` demanded by the
**operator** (arn, 2026-08-11) — instruction to complete plan 018 Task 3 with
the `native-sandbox` gate demanded; hosts without a container runtime need a
network-free containment backend.

## Primitive inventory (what already exists)

| Primitive | Location | What it gives this closeout |
| --- | --- | --- |
| `SandboxAdapter` / `DisposableSandbox` contracts (`exec`, `execFile`, `status`, `stop`, `kill`, `close`, optional `startProcess`) | `packages/coding-security/src/sandbox.ts` | The exact seam to implement; no contract changes allowed. |
| `docker-sandbox.ts` (reference backend) | `packages/coding-security/src/docker-sandbox.ts` | Semantics to mirror: cap-checked env, remaining-wall-time per command, maxCommands/maxConcurrentExecs, output byte cap, stop-grace/kill/remove lifecycle, two-pass export with metadata, secret redaction. |
| `path-containment.ts` (`isPathInsideReal`, `assertPathInsideRoots`) | `packages/coding-security/src/path-containment.ts` | Symlink-aware cwd containment for the native backend — the only path isolation a spawned process gets. |
| `sandbox-limits.ts` (defaults + hard caps + `validateSandboxLimit`) | `packages/coding-security/src/sandbox-limits.ts` | Reused knob names/values for the applicable subset (wall, idle, memory→RLIMIT_AS, maxFds→RLIMIT_NOFILE, maxCommands, maxConcurrentExecs, env caps, output cap, export bounds, stop/cleanup deadlines). |
| `docker-cli.ts` (`createSecretRedactor`, `assertAbsoluteExecutable`) | `packages/coding-security/src/docker-cli.ts` | Error redaction + executable preflight, reused unchanged. |
| `sandbox-tar.ts` (`createImportTarStream`, `summarizeTarStream`) | `packages/coding-security/src/sandbox-tar.ts` | `close({ export })` parity: bounded tar of the native workspace root. |
| `command-rules.ts` (`evaluateCommandRules`, `hasShellMetacharacters`) | `packages/coding-security/src/command-rules.ts` | Command classification stays a host policy layer above the adapter — unchanged, not duplicated. |
| `sandbox-fs-operations.ts` (`assertSandboxPath`) | `packages/coding-security/src/sandbox-fs-operations.ts` | Per-op path containment for FS tools; the native adapter deliberately does not re-implement it (see gap). |

## Gap analysis

**What a native backend cannot do (honest boundaries):** a spawned process runs
as the invoking OS user with full host-filesystem access. There is no read-only
root, no tmpfs workspace, no per-op fs isolation, no CPU-rate limit (cgroup
only), no pids cap, no user switch (unless the host itself runs as root and
supplies uid/gid). The Docker reference is strictly stronger; the native
backend's containment is: egress denial + resource limits + cwd containment,
with fs-op containment delegated to the existing `sandbox-fs-operations` layer
(`assertSandboxPath` on every tool op) and command policy to `command-rules` +
the approval policy. This must be documented, not silently implied.

**Egress denial is the hard requirement.** "We don't set up networking" does
not deny egress for a spawned process. The plan's "no network namespace
tooling" is read as: we ship no netns management code. The only zero-runtime-
dependency mechanism is the OS `unshare` binary creating a fresh network
namespace per command (`unshare -n` when privileged; `unshare -Urn` for
unprivileged user namespaces). The fresh netns has **no interfaces up —
loopback is down** (stricter than Docker `--network=none`); hosts needing
loopback keep the Docker backend. Platforms where netns cannot be created fail
closed **at adapter creation** (never at exec time, never silently network-
enabled): macOS/Windows always; Linux without a working `unshare`.

## Design decisions

- **Creation-time fail-closed matrix.** `process.platform !== "linux"` →
  documented `ERR_PRISM_NATIVE_SANDBOX` error. Linux: preflight `unshare -n
  true`, then `unshare -Urn true`; the first working mode is recorded and used
  for every command. Neither works → fail closed with the platform/privilege
  diagnosis. No per-call branching after creation.
- **rlimits via `ulimit` builtins**, hard limits (default = both soft+hard in
  POSIX sh), so the command cannot raise them: `-v` RLIMIT_AS from
  `memoryBytes` (KB), `-t` RLIMIT_CPU = wall-time backstop (seconds), `-n`
  RLIMIT_NOFILE from `maxFds`. `ulimit ... || exit 126` — a failed ulimit never
  runs the command unconstrained. Plus Node `spawn` `detached: true` (new
  process group) so timeout/abort/output-cap/stop/kill signal the **whole
  group** (`kill(-pid)`, SIGTERM then SIGKILL), covering sh + command +
  grandchildren — the Docker runner's SIGKILL-on-timeout semantics, group-wide.
- **Command construction.** `exec`: `sh -c 'ulimit ... || exit 126; <command>'`
  under `unshare`. `execFile`: `sh -c 'ulimit ... || exit 126; exec "$@"'
  <argv0> <file> <args...>` — file/args are argv, never shell-interpolated;
  NUL bytes rejected (contract parity). `execFile` stays a true exec (no
  lingering wrapper).
- **Env.** Exact allow-list when `env` is provided (name regex + byte caps,
  Docker parity); otherwise only `PATH` (host env never inherited). Secrets
  redacted from every error via `createSecretRedactor`.
- **Workspace.** `root` = absolute existing host directory (validated at
  creation); `cwd` default = root, every request cwd checked with
  `assertPathInsideRoots` (symlink-aware, fail closed). No import identity
  (the tree IS the workspace); `close({ export })` streams a bounded tar of
  root via `createImportTarStream` single-pass tee through
  `summarizeTarStream`; any bounds/stream failure destroys the host stream
  (contract: partial failures discard).
- **Not implemented (documented parity gap with Docker reference):**
  `startProcess` absent → ProcessSessions fails closed
  `ERR_PRISM_PROCESS_UNSUPPORTED`; no CPU-rate/pids/fs-size caps (cgroup-only);
  no user switch (runs as invoking user). Each is a deliberate deferral, not a
  silent omission — the limits surface only accepts the applicable subset.
- **Test seam.** `buildNativeSpawnArgsForTest` (argv construction, mirrors
  `buildDockerCreateArgsForTest`) + real-process tests gated on live `unshare`
  availability (`t.skip` when the environment denies netns — CI containers
  often do), mirroring the repo's network-free guard pattern.

## Threat model (risks → tests)

| # | Risk | Mitigation | Test |
| --- | --- | --- | --- |
| T1 | Egress: sandboxed command dials the network | Every command runs in a fresh netns (`unshare -n`/`-Urn`); creation fails closed when netns is unavailable; loopback down (no localhost escape either) | argv carries netns; creation fails closed with fake/missing unshare; live egress probe skipped when netns unavailable |
| T2 | Resource exhaustion: CPU/memory/output runaway | `ulimit -v/-t/-n` hard caps before the command; wall-time remaining per command; output byte cap kills the group; maxCommands + concurrency semaphore | ulimit prefix asserted in argv; timeout kills group (live, gated); output cap kills (live, gated) |
| T3 | Path escape: cwd outside root, symlink redirect | `assertPathInsideRoots` on every request cwd (symlink-aware, fail closed); fs-op containment delegated to `sandbox-fs-operations` (documented boundary) | cwd outside root rejected; symlinked cwd outside root rejected |
| T4 | Command injection: file/args shell-interpolated | execFile via `exec "$@"` — argv only; NUL rejected; shell metacharacter policy stays in `command-rules` (host layer) | argv assertion (no interpolation); NUL rejected |
| T5 | Secret/env leak into sandbox commands | Host env never inherited; exact allow-list or PATH-only; secrets redacted from errors | env default/allow-list argv assertions; redaction on error paths |
| T6 | Silent network-enabled fallback / implicit activation | Platform + unshare preflight at creation only; no degraded mode; absent adapter = no sandbox (unchanged default) | non-linux platform fails closed (simulated via seam); preflight failure refuses creation |
| T7 | Orphaned processes after timeout/abort/stop | `detached` process group; group SIGTERM→SIGKILL on timeout/abort/output-cap/stop/kill/close; cleanup deadline | live group-kill test (gated); stop/kill state transitions |
| T8 | Tampered/invalid workspace root | root validated absolute + readable at creation; no import/export identity claims beyond tar metadata | invalid root fails closed |

## Decision record

- **unshare over alternatives:** bubblewrap/seatbelt deferred per plan (binary
  per platform); seccomp/firewall need root or native modules; netns via the
  OS binary is the only zero-dependency egress denial for a spawn.
- **No adapter contract change:** `DisposableSandbox` unchanged; one new
  backend export, one consumer surface (hosts choose backend per environment).
- **Review order:** review precedes implementation (Task 1 before Task 3);
  `doc-reader`, `delete-glob`, `checkpoint-bodies` remain deferred.

## Doc-reader primitive review (plan 018 Task 4, closeout `doc-reader`)

- **Demand record:** operator (arn), 2026-08-11: instruction to complete
  Task 4 with the `doc-reader` gate demanded. Integration: coding agents need
  literal-text extraction for PDF/Office files without running embedded
  content or fetching external resources.

- **Primitive inventory (existing):**
  - `createReadTool` (packages/coding-agent/src/read.ts) — bounded text page
    + magic-byte image sniff; `ReadOperations` (readFile/readText/access/
    statFile/detectImageMimeType) is the remote-backend seam.
  - `readFileBounded` (bounded-file.ts) — byte-capped file read.
  - `validateCodingLimit` + coding limits catalog — cap validation pattern.
  - `SecretRedactor` (`@arnilo/prism` redaction.js) — used by goal-verify;
    read-tool content redaction is host-owned today.
  - Optional-peer precedent: ag-ui (zod non-optional; mcp/supervisor
    optional), peerDependenciesMeta.optional.
  - Roadmap boundaries: plans/004 no-PDF compromise; roadmap §Non-Goals —
    no embedded-script execution, no macro evaluation, no external fetching.

- **Honest-boundary gap analysis (what this closeout can and cannot claim):**
  - Parsing is delegated to a peer library (pdf-parse, mammoth). Prism code
    owns bounds, format gating, fail-closed activation, and redaction only —
    parser CVE surface lives with the peer (advisory reviewed at ship time;
    host pins versions).
  - "Literal text only" is the peer's raw-text surface (pdf-parse `text`,
    mammoth `extractRawText`); no HTML/rich rendering, no images, no links
    followed. Office files are zip containers: mammoth reads only
    word/document.xml text runs; embedded objects/OLE are not dereferenced.
  - Page/sheet caps are approximate by format: pdf-parse reports page count
    (refuse when over cap); docx has no page concept in raw text (page=1,
    byte-cap governs). Over-page/oversize documents REFUSE with a documented
    error — truncation only by output bytes.
  - No-fetch is by parser construction (both peers are pure text extractors),
    enforced by an egress tripwire test, not by a sandbox.
  - Activation: extension sniffing NEVER enables parsing; the host must wire
    the reader into `createReadTool({ documentReader })`. Within the reader,
    magic-byte detection (PDF header; docx zip + `[Content_Types].xml` /
    `word/document.xml` probe) gates format dispatch so a random binary never
    reaches a parser.

- **Threat model (doc-reader):**

| # | Risk | Mitigation | Test |
| --- | --- | --- | --- |
| D1 | Missing/absent parser peer | Optional peer declared; dynamic import fails closed with `ERR_PRISM_DOCUMENT_READER` at reader creation (never at read time) | creation without peer installed rejects with documented error (simulated by a missing-peer fixture path) |
| D2 | Decompression/size bomb: huge or deeply-compressed document | `maxBytes` stat + read cap (never loads more than cap); output `maxTextBytes` cap; over-page refusal | oversize fixture refuses; over-page PDF fixture refuses |
| D3 | Embedded content execution (macros/scripts) | Literal-text extraction only; parsers never execute embedded code | docx with VBA/embedded object extracts text only (no execution — construction + fixture) |
| D4 | External resource fetch (linked images/URLs) | Peers are pure text extractors (no fetch); egress tripwire in test | docx fixture with external link; `fetch` spied to throw; extraction completes with zero calls |
| D5 | Random binary misinterpreted as document | Magic-byte gating per format; unknown buffer returns null → read falls through to the 0.1.5 text path | binary fixture returns null; read tool falls back to text page |
| D6 | Extracted text leaks secrets | Optional `SecretRedactor` applied at the adapter boundary before the result leaves the package | redactor fixture replaces secret in extracted text |
| D7 | Reader output beyond bounds / unbounded metadata | `maxTextBytes` re-checked by the read tool (parity with readText bounds check); result shape frozen | oversize text result refused by read tool |
| D8 | Implicit activation / default behavior change | Absent `documentReader` option = byte-identical 0.1.5 behavior; no extension sniffing | read tool without reader unchanged (existing tests) |

- **Decision record:**
  - **Peers over vendored parsing:** pdf-parse + mammoth as OPTIONAL peers
    (peerDependenciesMeta.optional), dev-only installs for the package's own
    tests; zero core dependencies; matches ag-ui optional-peer precedent.
  - **Slot shape:** `DocumentReader` contract lives in coding-agent read.ts
    (additive); adapter package implements it; result shape
    `{ text, format, pages, truncatedBy }` frozen.
  - **Refuse over truncate for pages:** page cap enforced as refusal (pdf),
    byte cap truncates; matches "max-size document completes within the
    recorded envelope or refuses with a size error".
  - **Review order:** doc-reader reviewed here before implementation; only
    `delete-glob` and `checkpoint-bodies` remain deferred.

# Phase 18 primitive review and threat model — delete-glob (plan 018 Task 5, closeout `delete-glob`)

Demand record: operator (**arn**) instruction to complete Task 5 with the
`delete-glob` gate demanded (2026-08-11) — recursive directory delete and
brace-expanding glob as explicit opt-in flags, matching the plan 004 further
actions ("recursive delete and brace-expanding glob only if pattern/usage
demand justifies it") and roadmap §0.1.6 demand-gated line. Recorded in
`scripts/phase18-freeze-manifest.json` `demandGates.closeouts[delete-glob]`.

## Primitive inventory (what already exists)

| Primitive | Location | What it gives this closeout |
| --- | --- | --- |
| `createDeleteTool(cwd, options?)` | `packages/coding-agent/src/delete.ts` | File/empty-directory delete; non-empty directories rejected ("Recursive delete is not supported"); symlinks unlinked as links; `DeleteOperations` seam (`lstat`/`unlink`/`rmdir`/`readdir`), mutation-path containment (`resolveContainedMutationPath`: `..` and realpath escapes rejected), execution-policy gate, per-path mutation queue. |
| `createGlobTool(cwd, options?)` / `globLocal` | `packages/coding-agent/src/glob.ts`, `repository.ts:826-899` | Bounded `*`/`?`/`**` matcher; pattern byte cap (default 512 / hard 4096); `{`/`}` rejected by `validateGlobPattern`; exclude/hidden/depth/page/time caps; symlinks never followed; pagination. |
| `matchGlobPattern` / `validateGlobPattern` | `packages/coding-agent/src/glob-match.ts` | Hand-rolled segment matcher (plan 004 compromise: no picomatch/glob dependency). Brace rejection is the ONLY reason `{`/`}` cannot be matched today. |
| `mutation-path.ts` containment | `packages/coding-agent/src/mutation-path.ts` | `resolveContainedMutationPath` realpath + prefix checks; recursive delete MUST run every traversal step through the same containment reasoning (symlink children unlinked, never followed). |
| Docs (`docs/coding-agent-tools.md:104-105`, `:321`, `:302-316`) | tools page | "No recursive directory delete" / "No brace-expansion globs" non-goals; both become opt-in flag rows. |
| `glob.test.ts`, `delete-move.test.ts` | `packages/coding-agent/src/__tests__/` | Existing regression surface; default-parity tests extend here. |

## Gap analysis

**What is already achievable:** recursive deletion can be composed today by
repeated `delete` calls (empty-dir after contents), and multi-name globbing by
repeated `glob` calls — both safe, both chatty and racy (partial state between
calls, no single atomic fan-out). Brace patterns are outright rejected.

**What is missing:** (1) a single-call recursive delete with the same
containment guarantees as the single-file path; (2) `{a,b}` expansion with
bounded blow-up; (3) explicit per-call/host opt-in so the 0.1.5 defaults stay
byte-identical.

**Honest boundary:** recursive delete still runs as the invoking OS user with
host-fs access — containment is `resolveContainedMutationPath`-style path
checks only (same trust boundary as today's `delete`/`write`/`edit`); the walk
never follows symlinks, so a symlinked child can never drag the deletion
outside the root. Brace expansion is textual pattern expansion only — it
cannot read the filesystem; the tool's existing caps (depth/page/time, pattern
byte cap) bound the search. Both features are default-off: absent flags mean
exactly 0.1.5 behavior (non-recursive delete, brace rejection).

## Threat model (risks → tests)

| # | Risk | Mitigation | Test |
| --- | --- | --- | --- |
| G1 | Recursive delete escapes the workspace root via `..`/absolute path | Existing `resolveContainedMutationPath` refusal runs before the recursive flag is consulted | `..` escape refused (existing tests) + recursive variant |
| G2 | Symlink child points outside root and is traversed/deleted-through | Walk NEVER follows symlinks; symlink children are unlinked as links only | tree with symlink to outside dir/file: outside target survives |
| G3 | Recursive delete on a huge tree starves the host (fan-out bomb) | Per-call `maxEntries` fan-out cap (default 10,000 / hard 100,000); exceeding it stops with an error naming the cap | 10,000+ entry tree with `maxEntries: 5` refuses |
| G4 | Unbounded brace expansion (expansion bomb) | `expandGlobBraces` bounds: max 128 alternatives, max 4,096 expanded bytes total; overflow fails closed with a documented error | `{a,a,...}` 129-alternative pattern refuses |
| G5 | Brace semantics change default matching | Expansion only when the opt-in flag is set; `validateGlobPattern` default still rejects `{`/`}`; `matchGlobPattern` itself unchanged | default parity: flagless glob rejects braces (existing test); flagless delete refuses non-empty dir (existing test) |
| G6 | Malformed braces (unbalanced/nested) | Fail closed — reject, never guess | unbalanced `{a` and nested `{a,{b,c}}` patterns refuse |
| G7 | Expansion produces a pattern that escapes the search root | Expansion is textual; result patterns still go through the unchanged `matchGlobPattern` + walk caps; `path` scope still enforced by `resolveRepoPath` | brace pattern under a `path` scope only matches within it |
| G8 | Partial recursive deletion on abort/cap leaves silent inconsistency | Signal checked per entry; cap stop returns an error naming the cap and the count deleted so far; lifecycle `file_changed` events per item | abort mid-walk test; cap test asserts error text |

## Decision record

- **Opt-in flags, defaults unchanged:** `delete` gains per-call `recursive`
  (and optional `maxEntries`); `glob` gains host-selected `braceExpansion`
  option + per-call override. Absent flags = byte-identical 0.1.5.
- **Bounded expansion in the hand-rolled matcher:** no picomatch/glob
  dependency (plan 004 compromise stays, now with a documented brace ceiling);
  `expandGlobBraces` in `glob-match.ts`, used by `globLocal` in repository.ts
  (plumbing only — the request gains `braceExpansion`, the walk stays).
- **Symlink children unlinked, never followed** (rm -r parity): refusal is
  refusal to TRAVERSE; the outside target is never touched.
- **Fan-out cap per call** (default 10,000 / hard 100,000) with fail-closed
  stop — partial deletion reported in the error, not silent.
- **Review order:** `delete-glob` reviewed here before implementation; only
  `checkpoint-bodies` remains deferred.

# Phase 18 primitive review and threat model — checkpoint-bodies (plan 018 Task 6, closeout `checkpoint-bodies`)

Demand record: operator (**arn**) instruction to complete Task 6 with the
`checkpoint-bodies` gate demanded (2026-08-11) — 0.1.3 names-only persistence
is insufficient for the resume flow because the restored body is whatever the
live skill registry serves at resume time: a registry that lost or changed a
skill silently renders a missing/stale body (the loaded flag rides, the
instructions do not), and hosts that keep the registry empty at resume cannot
re-render instructions at all. Bodies mode persists the exact instructions
that were loaded, so resume re-renders them registry-independently. Recorded
in `scripts/phase18-freeze-manifest.json` `demandGates.closeouts[checkpoint-bodies]`.

## Primitive inventory (what already exists)

| Primitive | Location | What it gives this closeout |
| --- | --- | --- |
| `persistSessionState` (run + resume options) | `src/contracts-run-state.ts:190,225`, `src/agent-run-lifecycle.ts:44,81,98` | 0.1.3 opt-in gate; the bodies mode hangs off the same gate (+ a new `includeSkillBodies` opt-in), keeping the default byte-identical. |
| `StoredAgentRunState.sessionState` + `validateSessionState` | `src/agent-run-state.ts:60,352-370` | Names-only payload (`loadedSkillNames` ≤64, ≤256 chars) with fail-closed load/save validation; gains the bodies block. |
| `boundState` / `maxStateBytes` (default 256 KiB, hard 1 MiB) | `src/agent-run-state.ts:26-27,320-337` | The checkpoint size ceiling: oversize bodies mode refuses with `AgentRunStateError` (recorded error, never silent truncation). |
| `RuntimeAgentSession.loadedSkills` / `restoreLoadedSkills` | `src/agent-session.ts:176-181` | Names-only restore marks the catalog; bodies render via the live registry. |
| `skillMessages` / `skillHasRenderableBody` / `skillPromptText` | `src/skill-disclosure.ts` | Progressive disclosure renders instructions only for loaded names — the render path the persisted body must feed. |
| `createLoadSkillTool` / `resolveSkillLoad` / `LoadedSkillSet` | `src/skill-load.ts` | Loader + caps (`HARD_MAX_SKILL_INSTRUCTION_BYTES` 262144); the bodies format/validation owner (in closeout allowedFiles). |
| `createReadPathSetPersistence` | `packages/coding-agent/src/read-path-set.ts` | Read-path state already persists fully (paths ≤1024, ownership-scoped) — plan 015 Task 4; "full read-path state" in the closeout title is already shipped, nothing to add. |
| `redactor` on `saveAgentRunState` | `src/agent-run-state.ts:183` | Restored bodies pass through the same redaction path as any checkpointed state (secrets already redacted at rest). |

## Gap analysis

**What is already achievable:** `persistSessionState: true` carries the loaded
skill name catalog; on resume the names re-mark the `LoadedSkillSet` and the
model's next turn renders each skill's instructions **from the live registry**.
The read-path set already persists fully through `createReadPathSetPersistence`.

**What is missing:** exact-instructions persistence. Names-only restore marks
the catalog and re-renders whatever the (fingerprint-frozen) registry serves —
the model also incurs a `load_skill` round-trip when it does not know the
catalog was restored, and any host that re-serves skills at agent-construction
time from its own storage must keep the fingerprint-frozen definitions
available. Bodies mode persists `{name, instructions}` pairs — the exact
loaded text, redacted at the checkpoint boundary like all state — and the
session renders them on resume regardless of what the assembly's skills list
serves (replace by name; append for names the list no longer has).

**Honest boundary:** bodies are stored in the run-state checkpoint (host
`CheckpointStore`, ownership-scoped) — the checkpoint is the trust boundary,
not a new one; a tampered checkpoint can already inject instructions via
`persistSessionState`, so bodies add no new trust surface. Persisted bodies
are the redacted-at-rest text (a redacted secret restores as the safe
placeholder, matching the acp-session-store decision). No new package; the
codec stays version 1 with an absent `loadedSkillBodies` key for names-only /
0.1.2 checkpoints.

## Threat model (risks → tests)

| # | Risk | Mitigation | Test |
| --- | --- | --- | --- |
| C1 | Registry drift: resume renders a changed/missing skill body | Lifecycle resume already fail-closes registry drift via the agent fingerprint (changed skills = fingerprint mismatch, refused); bodies mode additionally renders the PERSISTED text over whatever the assembly serves (replace by name, append unknown names) — registry-independent at the render layer | `applyRestoredSkillBodies` unit (replace + append); lifecycle end-to-end renders the persisted body; fingerprint-refusal path untouched |
| C2 | Cross-branch leak: bodies from run A surface on run B | Checkpoint is per-runId, ownership-scoped (`loadAgentRunState`), names+bodies ride the same CAS record | run A saved with bodies; resume run B (different session) → no bodies on B |
| C3 | Oversized bodies payload | Per-body/name/total caps in skill-load.ts (count ≤64, name ≤256 chars, body ≤32 KiB default / 256 KiB hard, total ≤192 KiB hard) + checkpoint `maxStateBytes` ceiling refuses oversize with a recorded error | oversized instructions refuse at save; malformed bodies payload refuses at load |
| C4 | Default behavior change | Bodies persist/render only with `includeSkillBodies: true` on BOTH run and resume options; absent = 0.1.3 names-only byte-identical | names-only checkpoint has no `loadedSkillBodies` key; flagless resume restores names only |
| C5 | Malformed/tampered bodies block | `validateLoadedSkillBodies` fail-closed on both save and load (shape, caps); old names-only checkpoints read cleanly | corrupt bodies entry refuses resume |
| C6 | Secrets in persisted bodies | Same redaction path as all checkpoint state (`redactor` at `saveAgentRunState`); restored text is the redacted placeholder | redactor fixture: secret replaced in the persisted body and the resumed render |
| C7 | Bodies render without the loaded flag | Bodies mode implies names: restore marks names AND bodies together; `skillHasRenderableBody` gate unchanged | resumed turn renders the body (progressive disclosure) |

## Decision record

- **Same gate + new opt-in:** `includeSkillBodies: true` on durable run and
  resume options, alongside `persistSessionState: true` (both sides required,
  symmetric — an absent flag on either side keeps 0.1.3 behavior).
- **Format owner in scope:** `LoadedSkillBodiesEntry { name, instructions }`
  + caps + snapshot/validate/apply live in `src/skill-load.ts` (closeout
  allowedFiles); `agent-run-state.ts` (sessionState field + validation),
  `agent-session.ts` (render + persist wiring), `contracts-run-state.ts`
  (option), `agent-run-lifecycle.ts` (resume restore) carry plumbing —
  deviation from the plan's tentative file list, noted in the plan (same
  pattern as Task 5's repository.ts).
- **Read-path state:** nothing to add — 0.1.3 already persists the full path
  set; the closeout is the bodies upgrade only.
- **Refuse over truncate:** bodies mode refuses oversize payloads (recorded
  error), never silently truncates; checkpoint `maxStateBytes` is the outer
  ceiling.
- **Review order:** checkpoint-bodies reviewed here before implementation; no
  0.1.6 closeouts remain deferred.
