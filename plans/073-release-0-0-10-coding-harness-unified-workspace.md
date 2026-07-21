# Phase 5 — Release 0.0.10: Coding Harness Correctness and Unified Workspace (P0)

## Objectives

- Close the 0.0.9 split-brain coding composition: disposable Docker/sandbox shell must no longer silently pair with host filesystem mutations by default.
- Ship an explicit workspace mode (`host` | `sandbox`) on the one existing construction path so shell, read, write, edit, repo_list, repo_search, and sandbox-targeted Git/check runners observe one shared tree.
- Fail closed on unsafe mixed wiring unless an explicit documented escape hatch is set and surfaced in metadata.
- Preserve path containment, execution policy, non-root digest-pinned Docker defaults, finite import/export caps, and pluggable operation backends; add no second coding runtime.
- Version, document, and release-validate `@arnilo/prism-coding-security` / `@arnilo/prism-coding-agent` (and dependent graph) as **0.0.10**.

## Expected Outcome

- `createSandboxCodingTools` / `createSandboxReadOnlyTools` require or default to an explicit `workspaceMode`.
- `workspaceMode: "sandbox"` wires shell **and** filesystem/list/search backends to the disposable tree (exec-backed or documented shared-mount); Git/check runners targeting that sandbox use the same cwd/tree.
- `workspaceMode: "host"` runs all coding tools against the host workspace and never claims disposable containment in docs or tool/composition metadata.
- Mixed sandbox-shell + host-mutating FS backends throw without escape hatch; with escape hatch, composition metadata warns explicitly.
- Import/export/close/resume preserve tree identity (hash/entry metadata) so hosts cannot advertise sandboxed coding while edits land only on an unbound host root.
- Adversarial consistency tests and host-vs-sandbox benchmarks pass; `npm run sdk:ready`, docs/migration, and 0.0.10 release dry-run gates pass.
- 0.0.9 split composition is documented as superseded in migration notes.

## Tasks

- [x] 0. Freeze Phase 5 scope, primitive ownership, limits, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 5 roadmap criterion to current primitive, minimum gap, owning task, test, docs page, and release gate; mark 0.0.11+ coding-harness items (session search, context budgets, Anthropic/Google, goal/verify) as out of scope.
    - Performance: freeze which existing entry/byte/time/concurrency caps apply to sandbox FS backends and any host↔container sync; forbid new unbounded sync loops.
    - Code Quality: inventory callers of `createSandboxCodingTools`, `createSandboxBashOperations`, `DisposableSandbox.execFile`, `ReadOperations`/`WriteOperations`/`EditOperations`/`RepositoryOperations`, and Git `execFile` binding; authorize only minimal coding-security helpers unless a second non-test consumer needs a core primitive.
    - Security: freeze trust model for sandbox mode (containment claimed) vs host mode (no containment claim) vs escape hatch (explicit unsafe mixed wiring); path containment and policy remain mandatory for advertised sandbox mode.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5, Product Boundaries, Release Order gate 6, package ledger (`coding-agent` / `coding-security`), persona coding outcomes.
      - `docs/coding-security.md`, `docs/coding-agent-tools.md`, `docs/host-security.md`, `docs/migration.md`, `docs/review-coverage-2026-07-20-phase-4.md`, Plan 072 Task 1–2 evidence.
      - Current: `packages/coding-security/src/{sandbox,sandbox-coding-operations,docker-sandbox}.ts`, `packages/coding-agent/src/{read,write,edit,list,search,shell,repository,git-exec,git-tools}.ts`.
    - Options Considered:
      - Keep split-brain and only document: rejects harness correctness; rejected as default.
      - Always writable host bind-mount as `/workspace`: weaker isolation; only as explicit host-opted mode if retained.
      - Explicit mode + fail-closed composition + pluggable FS backends: chosen (roadmap).
    - Chosen Approach:
      - Create checked-in Phase 5 evidence matrix with revision, mode matrix, primitive/caller inventory, limit reuse table, threat owners, and task ownership.
      - Non-goals: session search/index, context budgets, native Anthropic/Google, goal/verify helper, AG-UI, coding compaction preset, new sandbox runtime, Kubernetes/remote scheduler, automatic image pull.
    - API Notes and Examples:
      ```text
      roadmap criterion -> current behavior (0.0.9 split) -> gap -> owner task -> test -> docs -> release gate
      workspaceMode: host | sandbox (| future)
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-21-phase-5.md` (new): scope, mode matrix, callers, limits, threats, gates.
      - `docs/index.md`: link Phase 5 review coverage under Release and install/maintenance.
      - `src/__tests__/docs.test.ts` (or equivalent): assert evidence sections/owners exist.
      - `plans/073-release-0-0-10-coding-harness-unified-workspace.md`: append freeze evidence while executing.
    - References:
      - Current `createSandboxCodingTools` wires only shell via `createSandboxBashOperations`; FS tools keep host `cwd` (documented split).
      - Existing pluggable `*Operations` seams already support remote backends without a second runtime.
  - Test Cases to Write:
    - Traceability: every Phase 5 criterion has exactly one owner; 0.0.11+ items absent from implementation tasks.
    - Primitive: proposed shared helpers have ≥2 concrete consumers or stay package-local.
    - Limit/threat: every sandbox FS/sync path reuses finite caps with abort/cleanup owners.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freezes release scope and mode semantics before code changes.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-21-phase-5.md`: evidence matrix.
    - `docs/index.md` update: yes; add Phase 5 review coverage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Wrote `docs/review-coverage-2026-07-21-phase-5.md` at source `5fc05437224f347b00fb6124d1783eb2cd3a9b25`: mode contract, capability matrix (Tasks 1–7), caller inventory, reused sandbox/coding-agent hard caps, threats, validation matrix.
    - Frozen API choices: `workspaceMode` **required** (`"host" | "sandbox"` only); escape hatch `allowMixedWorkspaceWiring`; `createSandboxCodingComposition → { tools, composition }` authoritative; wrappers keep tools-only return; metadata on `SandboxCodingComposition` (ToolDefinition has no metadata field); sandbox auto-wire needs `DisposableSandbox` or host-supplied agreeing ops; no new core primitive; no sync loops; no third mode.
    - Callers frozen: `createSandboxCodingTools` production callers = package tests only; Git stays opt-in via `execFile`.
    - Linked `docs/index.md`; `plans/README.md` + plan count 74; `docs.test.ts` Phase 5 evidence test green (`node --test --test-name-pattern="phase 5 evidence|plans index links"`).

- [x] 1. Add explicit `workspaceMode` contract and fail-closed mixed-wiring checks
  - Acceptance Criteria:
    - Functional: `SandboxCodingToolsOptions` (and read-only sibling) expose `workspaceMode: "host" | "sandbox"`; construction documents mode selection in one path.
    - Functional: default sandboxed composition no longer silently pairs container shell with host-mutating FS backends; choosing sandbox without capable sandbox/backends fails closed.
    - Functional: unsafe mixed wiring (sandbox shell + host-mutating FS) throws unless explicit documented escape hatch is set; escape hatch surfaces warning metadata on composition/tools.
    - Functional: host mode wires local FS + local or sandbox-optional shell consistently and never sets containment-claiming metadata.
    - Performance: mode selection is O(1) construction work; no sync loops introduced.
    - Code Quality: extend `sandbox-coding-operations.ts` only; keep aggregators in coding-agent unchanged aside from any typed option plumbing required.
    - Security: escape hatch name/docs make non-containment explicit; sandbox mode refuses to advertise containment when backends disagree.
  - Approach:
    - Documentation Reviewed:
      - Current `SandboxCodingToolsOptions` and tests asserting host list/search with sandbox shell.
      - Roadmap API sketch for `workspaceMode`.
      - Task 0 freeze: `docs/review-coverage-2026-07-21-phase-5.md` workspace-mode contract.
    - Options Considered:
      - Soft-default to host for back-compat: preserves silent footgun for Docker users; rejected as default for advertised sandbox helpers.
      - Require explicit mode always: clearest; **frozen chosen**.
      - Silent auto-detect from adapter type: brittle; rejected.
    - Chosen Approach:
      - Require `workspaceMode`; escape hatch `allowMixedWorkspaceWiring`.
      - Authoritative `createSandboxCodingComposition(cwd, options) → { tools, composition }`; keep `createSandboxCodingTools` / `createSandboxReadOnlyTools` as `.tools` wrappers.
      - In sandbox mode, auto-wire FS/list/search ops from Task 2 helpers when host does not supply custom ops; require `DisposableSandbox` for auto-wire.
      - Reject mixed wiring after option merge; surface mode/warnings on `SandboxCodingComposition` only (not `ToolDefinition`).
    - API Notes and Examples:
      ```ts
      const { tools, composition } = createSandboxCodingComposition(cwd, {
        sandbox,
        workspaceMode: "sandbox", // required: "host" | "sandbox"
        executionPolicy,
        // allowMixedWorkspaceWiring: true, // escape hatch; composition.warnings + containmentClaim:false
      });
      // compat:
      const toolsOnly = createSandboxCodingTools(cwd, { sandbox, workspaceMode: "sandbox" });
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox-coding-operations.ts`
      - `packages/coding-security/src/index.ts` (re-exports/types)
      - `packages/coding-security/src/__tests__/sandbox-coding-operations.test.ts`
      - Package CHANGELOG / README as needed after behavior lands (finalized in Task 6).
    - References:
      - Existing test `"wires shell to sandbox and keeps list/search local"` must be rewritten to host mode or escape-hatch expectations.
      - Task 0 freeze page.
  - Test Cases to Write:
    - Sandbox mode without FS backends / without DisposableSandbox capability → throws.
    - Host mode: local FS + no containment metadata.
    - Mixed wiring without escape hatch → throws; with hatch → tools run and metadata warns.
    - Custom ops that agree with mode still accepted.
    - Missing `workspaceMode` → throws.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; composition options and failure modes change.
    - Docs pages to create/edit: deferred detail to Task 6; API shape frozen here.
    - `docs/index.md` update: no in this task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Rewrote `packages/coding-security/src/sandbox-coding-operations.ts`: required `workspaceMode`, optional `sandbox`/`allowMixedWorkspaceWiring`/`workspaceRoot`, `SandboxCodingComposition` + `createSandboxCodingComposition` / `createSandboxReadOnlyComposition`, wrappers unchanged return shape, `SandboxCodingCompositionError`.
    - Fail-closed: missing mode throws; host+sandbox shell without hatch throws; sandbox without custom ops / without working auto-wire throws (Task 2 hook `tryAutoWireSandboxTreeOperations` returns undefined); hatch records `warnings` and forces `containmentClaim: false`.
    - Host mode (no sandbox): local tools, `containmentClaim: false`. Sandbox + full custom ops: `containmentClaim: true`.
    - Exports updated in `packages/coding-security/src/index.ts`. Tests rewritten/extended; `npm run build && npm test` in coding-security: 33 pass, 1 Docker skip.
    - Docs/README/CHANGELOG deferred to Task 6 (examples still show pre-mode API until then).

- [x] 2. Implement sandbox-tree filesystem and repository backends
  - Acceptance Criteria:
    - Functional: in `sandbox` mode, `read`/`write`/`edit`/`repo_list`/`repo_search` observe and mutate the shared disposable tree (same bytes as shell on that tree).
    - Functional: backends honor existing coding-agent operation contracts and finite byte/entry/time/abort caps; path resolution stays rooted at the sandbox workspace root (e.g. `/workspace`) with containment checks.
    - Functional: pluggable custom remote sandboxes can supply host-reachable or exec-backed FS ops; Docker reference gets a default execFile-backed implementation.
    - Performance: no unbounded host↔container sync loops; list/search/read/write stay within existing repository/coding limits; prefer exec/tar helpers already used for import/export over new protocols.
    - Code Quality: implement helpers in coding-security (or thin coding-agent seam only if required); reuse `DisposableSandbox.execFile`, path helpers, and limit validators; no second runtime.
    - Security: reject symlink/device escapes consistent with import/export; no host-root writes in sandbox mode; secrets redaction unchanged.
  - Approach:
    - Documentation Reviewed:
      - `ReadOperations`, `WriteOperations`, `EditOperations`, `RepositoryOperations` contracts.
      - `docker-sandbox.ts` workspace mount `/workspace`, import tar, export two-pass hash.
      - Docker `exec`/`cp` constraints via existing CLI helpers.
    - Options Considered:
      - Writable host bind-mount only: simpler FS, weaker isolation; optional documented mode later, not default for digest-pinned tmpfs reference.
      - `docker cp` per read/write: works but chatty; acceptable fallback if exec helpers insufficient.
      - Exec-backed ops (`cat`/`printf`/`find`/`grep` or small trusted helper scripts via `execFile` argument arrays): chosen for default Docker tmpfs tree.
    - Chosen Approach:
      - Add `createSandboxFilesystemOperations(sandbox, { workspaceRoot })` (name freeze in impl) producing read/write/edit ops.
      - Add `createSandboxRepositoryOperations(...)` for list/search against the same root, reusing repository limit validation.
      - Map tool-facing host-style relative paths to sandbox absolute paths under workspace root; keep coding-agent path policy enforcement.
      - Wire automatically from Task 1 when `workspaceMode: "sandbox"`.
    - API Notes and Examples:
      ```ts
      const fsOps = createSandboxFilesystemOperations(sandbox, {
        workspaceRoot: "/workspace",
      });
      const repoOps = createSandboxRepositoryOperations(sandbox, {
        workspaceRoot: "/workspace",
        limits: { maxResults: 50 },
      });
      // createSandboxCodingTools merges these when workspaceMode === "sandbox"
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox-fs-operations.ts` (new; tentative name)
      - `packages/coding-security/src/sandbox-coding-operations.ts`
      - `packages/coding-security/src/index.ts`
      - `packages/coding-security/src/__tests__/sandbox-fs-operations.test.ts` (new)
      - Possibly `packages/coding-agent/src/repository.ts` only if a tiny shared helper is required (prefer not).
    - References:
      - Plan 072 adversarial coding fixtures; Phase 4 split-architecture decision to supersede.
  - Test Cases to Write:
    - Fake DisposableSandbox: write via tool → read via shell sees same bytes; reverse path.
    - List/search agree with shell `find`/`grep` equivalents on same tree (fake exec recording).
    - Oversized write/read/search hit existing hard caps without unbounded buffering.
    - Path escape outside workspace root fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new exported helpers and sandbox-mode behavior.
    - Docs pages to create/edit: Task 6 (`coding-security.md`, `coding-agent-tools.md`).
    - `docs/index.md` update: yes if Tools/Security summaries change (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Added `packages/coding-security/src/sandbox-fs-operations.ts`: `createSandboxFilesystemOperations`, `createSandboxRepositoryOperations`, `assertSandboxPath`, fixed `SANDBOX_FS_SCRIPTS` dialect (`/bin/sh -c` + positional args; base64 chunked writes), `SandboxFsError`.
    - Auto-wire in `sandbox-coding-operations.ts`: DisposableSandbox sandbox mode wires FS/repo backends; tool cwd becomes `workspaceRoot` when backends bound so relative paths resolve under `/workspace`.
    - Reuses coding-agent `compileSearchPattern` / `resolveRepositoryLimits` / hard caps; find prune for `.git`/`node_modules`/`dist`; no sync loops.
    - Tests: `sandbox-fs-operations.test.ts` memory sandbox (write↔shell, composition auto-wire, list/search, oversize, escape); composition test updated for auto-wire containment claim. `npm run build && npm test`: 39 pass, 1 Docker skip.
    - Docs deferred to Task 6.

- [x] 3. Align Git/check runners with workspace mode tree semantics
  - Acceptance Criteria:
    - Functional: helpers or documented composition for `createGitTools` / named checks targeting the sandbox use the same tree and cwd as sandbox-mode coding tools.
    - Functional: host mode Git/check remain host-cwd; docs state no containment claim.
    - Performance: Git/check retain existing argument-array, output, and concurrency bounds; no extra full-tree sync.
    - Code Quality: reuse `execFile: sandbox.execFile` binding; add at most a thin `createSandboxGitTools`/`bindSandboxGitOptions` helper if it removes duplicated wiring — otherwise document-only composition is enough (prefer helper if ≥2 call sites in package/examples).
    - Security: Git still disables hooks/credentials/pager prompts; never push/open PRs; sandbox Git cannot escape workspace via pathspecs.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/git-exec.ts`, `git-tools.ts`, `checks.ts`.
      - Current docs note for `createGitTools({ execFile: sandbox.execFile })`.
    - Options Considered:
      - Fold Git into `createSandboxCodingTools` always: expands default tool surface; rejected.
      - Document-only wiring: minimal but easy to get wrong; acceptable if helper proves unnecessary.
      - Thin binder setting `cwd` + `execFile` + mode metadata: chosen if examples/tests need it.
    - Chosen Approach:
      - Ensure sandbox-mode coding composition and Git binder share workspace root string and execFile.
      - Add one example or test proving `git_status` after `write` sees the new file inside sandbox mode.
    - API Notes and Examples:
      ```ts
      const tools = [
        ...createSandboxCodingTools(cwd, { sandbox, workspaceMode: "sandbox" }),
        ...createGitTools("/workspace", {
          execFile: sandbox.execFile.bind(sandbox),
          commitIdentity: { name: "bot", email: "bot@example.com" },
        }),
      ];
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/sandbox-coding-operations.ts` and/or small git binder file (tentative).
      - `packages/coding-agent` only if export/docs need clarifying types.
      - Tests under coding-security or coding-agent; `examples/` only if an existing durable-coding example must be updated.
    - References:
      - Roadmap: “Git/check runners targeting the sandbox use the same tree and cwd semantics.”
  - Test Cases to Write:
    - Sandbox mode: write tool then git status/diff via sandbox execFile sees file.
    - Host mode: git uses host cwd; metadata non-containing.
    - Pathspec outside workspace rejected or contained per existing Git rules.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if new binder exported; otherwise behavior/docs only.
    - Docs pages to create/edit: Task 6.
    - `docs/index.md` update: only if new public helper needs index mention.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - No `bindSandboxGitOptions` (Task 0 freeze: <2 non-test call sites). Composition pattern on `sandbox-coding-operations.ts` module header + tests.
    - Tests in `sandbox-fs-operations.test.ts`: write→`git_status`/`git_diff` via `createGitTools(composition.workspaceRoot, { execFile })` same tree; `coding_check` same cwd; host mode Git cwd = host + `containmentClaim: false`; absolute escape pathspec still `cwd=/workspace` (existing `--` rules).
    - Memory sandbox answers `/usr/bin/git` status/diff. `npm run build && npm test`: 42 pass, 1 Docker skip. Public docs deferred to Task 6.

- [x] 4. Preserve import/export/resume tree identity for sandbox mode
  - Acceptance Criteria:
    - Functional: sandbox import/export/close paths expose hash/entry metadata hosts can compare across close/resume; composition refuses to claim sandboxed coding when FS backends are unbound from that tree.
    - Functional: resume guidance uses retained host artifact references/hashes, not silent host-root edits.
    - Performance: reuse existing two-pass export and finite entry/byte caps; no third full-tree walk beyond current export design unless required for identity check (then still capped).
    - Code Quality: extend `SandboxExportMetadata` / close options minimally; avoid new persistence subsystem.
    - Security: hashes are content identity only; never embed secrets; partial export failures discard host artifacts as today.
  - Approach:
    - Documentation Reviewed:
      - `SandboxExportMetadata`, `exportTwoPass`, import tar summarization in `sandbox-tar.ts`.
      - Checkpoint guidance in coding-agent durable helpers / workflows docs.
    - Options Considered:
      - Require hosts to remember hashes only in docs: insufficient for fail-closed advertising; rejected alone.
      - Return/composition-time tree identity snapshot (import hash + last export hash): chosen.
      - Full Merkle FS index: overkill; rejected.
    - Chosen Approach:
      - Record import summary hash/entries at sandbox start when import runs; surface via status or metadata accessor.
      - On close export, keep sha256/entry/byte metadata; document resume check: re-import exported artifact or verify hash before claiming continuity.
      - Composition metadata includes workspace mode + tree identity fields when available.
    - API Notes and Examples:
      ```ts
      const meta = await sandbox.close({ export: hostWriter });
      // meta.sha256 / entryCount / byteCount must match host-retained artifact
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/{sandbox,docker-sandbox,sandbox-tar}.ts` as needed.
      - Tests in `docker-sandbox.test.ts` / new identity tests (fake CLI where possible).
    - References:
      - Roadmap functional criterion on import/export/close/resume tree identity.
  - Test Cases to Write:
    - Import then mutate then export: hash changes; entry/byte caps enforced.
    - Export hash continuity across close callback; mismatch fails closed.
    - Concurrent exec limits still enforced during FS ops + export.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if status/metadata fields expand.
    - Docs pages to create/edit: Task 6 (`coding-security.md`, `host-security.md`, `migration.md`).
    - `docs/index.md` update: only if summaries change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - `SandboxStatus` + `DisposableSandbox`: optional `importIdentity` / `lastExportIdentity` (`SandboxExportMetadata` shape). Docker import hashes capped buffer (one FS walk); `close({ export })` sets `lastExportIdentity`; two-pass mismatch still fails closed (no identity retained).
    - Composition: `treeIdentity` from `sandbox.importIdentity ?? lastExportIdentity` when present; unbound backends still `containmentClaim: false` (Task 1).
    - Tests: import→composition.treeIdentity; export hash ≠ import; mismatch rejects; lastExport on successful close. `npm test`: 44 pass, 1 Docker skip. Docs → Task 6.

- [x] 5. Adversarial consistency tests, benchmarks, and eval fixture updates
  - Acceptance Criteria:
    - Functional: adversarial tests prove edit-then-shell and list-then-edit consistency inside one mode; mixed wiring cases covered.
    - Functional: host mode mutations land on host cwd; sandbox mode mutations do not claim host containment.
    - Performance: benchmarks cover host vs sandbox modes; no regression beyond justified overhead; existing finite caps still hold.
    - Code Quality: network-free fakes remain default; protected real-Docker checks stay opt-in env gates.
    - Security: escape tests still fail closed for path/symlink/resource abuse under sandbox mode.
  - Approach:
    - Documentation Reviewed:
      - Plan 072 eval fixtures / coding-agent `eval-fixtures.test.ts`.
      - `scripts/benchmark-0.0.9.mjs` pattern for a 0.0.10 benchmark script.
    - Options Considered:
      - Only unit tests: misses composition regressions; rejected.
      - Unit + fake-sandbox integration + opt-in Docker matrix + benchmark: chosen.
    - Chosen Approach:
      - Rewrite obsolete “list/search local with sandbox shell” expectation into explicit host-mode or escape-hatch tests.
      - Add consistency matrix tests; extend protected Docker test only when `PRISM_TEST_DOCKER_SANDBOX=1`.
      - Add `scripts/benchmark-0.0.10.mjs` (+ schema test) measuring host vs sandbox composition paths.
    - API Notes and Examples:
      ```bash
      node --test packages/coding-security/src/__tests__/*.test.ts
      PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=... PRISM_TEST_DOCKER_IMAGE=... npm test -w @arnilo/prism-coding-security
      node scripts/benchmark-0.0.10.mjs
      ```
    - Files to Create/Edit:
      - `packages/coding-security/src/__tests__/*`
      - `packages/coding-agent/src/__tests__/eval-fixtures.test.ts` if fixtures encode split-brain.
      - `scripts/benchmark-0.0.10.mjs`, `scripts/benchmark-0.0.10.test.mjs`
    - References:
      - Roadmap test cases for sandbox/host/mixed/import-export continuity.
  - Test Cases to Write:
    - Sandbox: write→shell read; shell write→tool read; list/search agree with shell.
    - Host: tools mutate host; metadata non-isolating.
    - Mixed wiring throw vs escape-hatch warning.
    - Import/export hash continuity; concurrent exec limits.
    - Benchmark schema bounds for both modes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; release evidence yes.
    - Docs pages to create/edit: mention benchmark in performance/release docs (Task 6).
    - `docs/index.md` update: no unless new public page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - `workspace-consistency.test.ts`: edit→shell; list→edit→search; host write on host cwd; sandbox write isolated from host; mixed hatch `containmentClaim: false`; path escape fail-closed.
    - `docker-sandbox.test.ts`: `maxConcurrentExecs` peak=1; protected live matrix extended with composition write↔shell + `importIdentity` (still `PRISM_TEST_DOCKER_SANDBOX=1` skip by default).
    - `scripts/benchmark-0.0.10.mjs` + `.test.mjs`: host vs sandbox-fake composition scenarios; schema/bounds green.
    - Eval fixtures unchanged (no split-brain encoding in coding-agent evals). `npm test` coding-security: 51 pass, 1 Docker skip. Docs → Task 6.

- [x] 6. Update docs, migration notes, package READMEs/changelogs, and index summaries
  - Acceptance Criteria:
    - Functional: docs state host vs sandbox modes, fail-closed mixed wiring, escape hatch, Git same-tree wiring, and that 0.0.9 split composition is superseded.
    - Functional: docs forbid treating host mode as contained execution; Docker defaults remain digest-pinned/non-root/network-none guidance.
    - Performance: document that unified mode adds no unbounded sync and reuses existing caps; link benchmark.
    - Code Quality: examples match exported API; no second-runtime language.
    - Security: host-security and coding-security pages agree on trust claims per mode.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
      - Current `docs/coding-security.md` paragraph describing split shell/FS behavior.
      - `docs/migration.md` 0.0.9 sandbox composition notes.
    - Options Considered:
      - New standalone “workspace modes” page: only if index/security pages become too large; prefer updating existing pages first.
      - Update existing coding-security/tools/migration/host-security pages: chosen.
    - Chosen Approach:
      - Replace split-brain guidance with mode contract + examples.
      - Migration section: 0.0.9 → 0.0.10 breaking composition default/options.
      - Sync package READMEs/CHANGELOGs for coding-security and coding-agent.
    - API Notes and Examples:
      ```ts
      // Sandbox: one tree
      createSandboxCodingTools(sourceRoot, { sandbox, workspaceMode: "sandbox" });
      // Host: explicit non-contained
      createSandboxCodingTools(cwd, { sandbox, workspaceMode: "host" });
      ```
    - Files to Create/Edit:
      - `docs/coding-security.md`
      - `docs/coding-agent-tools.md`
      - `docs/migration.md`
      - `docs/host-security.md`
      - `docs/performance.md` (benchmark mention if needed)
      - `docs/index.md` (summary text if Tools/Security blurbs change)
      - `packages/coding-security/README.md`, `CHANGELOG.md`
      - `packages/coding-agent/README.md`, `CHANGELOG.md` if user-facing
      - Root `CHANGELOG.md` as repo practice requires
    - References:
      - prism-wiki.md required sections for changed public APIs.
  - Test Cases to Write:
    - Docs tests: pages mention `workspaceMode`, forbid split-brain-as-default, host-mode non-containment warning present.
    - Example snippets typecheck or match exported names.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; documentation of composition semantics.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes if Coding security/tools summaries change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Docs: `coding-security.md` mode contract + composition API; `migration.md` 0.0.10 breaking section; `coding-agent-tools.md` / `host-security.md` / `performance.md` / `evaluations.md` / `index.md` synced.
    - READMEs + Unreleased changelogs (coding-security, coding-agent, root). Version bump deferred to Task 7.
    - Docs test: `phase 5 workspace-mode docs replace split-brain defaults...` asserts `workspaceMode`, fail-closed language, host non-containment, no old split-brain sentence, `benchmark-0.0.10.mjs`.

- [x] 7. Version graph to 0.0.10 and run release validation
  - Acceptance Criteria:
    - Functional: all publishable workspace manifests, internal ranges, lockfile, and release/install guards target exact `0.0.10` for this release line; roadmap Phase 5 completion evidence recorded only after checks pass.
    - Functional: `npm run sdk:ready` passes with zero unexplained failures; adversarial/unified-workspace tests green; protected Docker gate remains documented operator prerequisite.
    - Performance: package-size/benchmark deltas measured and justified.
    - Code Quality: changelogs/migration/release-and-install match behavior; no 0.0.11 scope sneaks in.
    - Security: `npm audit`, secret scan, SBOM/tarball review, `git diff --check` pass; no containment claims for host mode in release notes.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, Release Validation Checklist in `roadmap.md`, Plan 072 Task 8/13 command matrix.
    - Options Considered:
      - Ship docs-only without version bump: rejected; roadmap release is 0.0.10.
      - Full graph bump + dry-run publish: chosen.
    - Chosen Approach:
      - Bump versions/ranges consistently; run sdk:ready + supply-chain + `release:check` / `release:publish --dry-run` for `0.0.10`.
      - Update `roadmap.md` Phase 5 checkbox/evidence only after gates pass (execution time).
      - Stop before signed tag/publish without operator authorization.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run release:check -- --version 0.0.10 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.10 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - All publishable `package.json` / lockfile / profile manifests as required by release scripts.
      - `docs/release-and-install.md`, `roadmap.md` (completion evidence).
      - Changelogs already touched in Task 6.
    - References:
      - Roadmap Release Validation Checklist; package ledger rows for coding-agent/coding-security @ 0.0.10.
  - Test Cases to Write:
    - Version-guard tests expect `0.0.10`.
    - Full sdk:ready + dry-run matrix.
    - Docs regression for Phase 5 mode language.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; released version semantics.
    - Docs pages to create/edit: `docs/release-and-install.md`, `roadmap.md` evidence.
    - `docs/index.md` update: only if release nav needs Phase 5 link (usually covered by review-coverage entry from Task 0).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-21):
    - Exact `0.0.10` graph across 32 manifests + lockfile + `src/index.ts` version + MCP client/server version strings; guards/tests retargeted.
    - `npm run sdk:ready`: 1,963 tests (1,934 pass, 29 skips, 0 fail). Audit 0 high; SBOM 186/8; secrets 0/2,418; `git diff --check` clean.
    - Pack: 988,020 / 3,820,326 / 850 files (core 527,333 / 1,848,113 / 248). `release:check` all 32 available; `release:publish --dry-run` 32/32. No commit/tag/publish.
    - `roadmap.md` Phase 5 marked complete with evidence. Stopped before signed tag.

## Compromises Made

- Retargeted publishable versions from post-ship `0.0.96` down to roadmap `0.0.10` (semver-lower than already-shipped line). Operators must treat `0.0.10` as explicit tag/`--version` publish, not assume npm `latest` semantics vs `0.0.96`.
- No `bindSandboxGitOptions` helper (Task 0 threshold unmet); Git same-tree wiring remains documented composition + tests.
- Protected Docker/Playwright live gates remain operator-hosted; default suite stays network-free fakes.
- Import identity buffers full tar up to `maxExportBytes` (not streaming tee) after tee caused tar validation failures in tests.

## Further Actions

- P0 operator: signed commit/tag `v0.0.10`, protected CI, OIDC provenance, actual `release:publish` when authorized; confirm `latest` tag policy vs residual `0.0.96` registry versions.
- P1: optional live Docker composition matrix in CI when digest-pinned image variables present.
- P2 (0.0.11+): session search/index, token budgeting, native Anthropic/Google providers, goal→verify helper — explicitly out of Phase 5.
)
