# Phase 37 — Security boundary hardening

## Objectives
- Close prompt, file, config, and provider-header escape hatches before production persistence makes mistakes durable.
- Keep hardening generic and host-owned: no sandbox, no hidden discovery, no provider-specific core branches.
- Make filesystem contribution reads fail closed on realpath/symlink containment and permission/trust checks.
- Prevent config prototype pollution and prompt-source priority surprises.
- Ensure provider-owned auth/session/security headers cannot be overridden by caller-provided headers.
- Update security docs so external apps can implement the boundary without reading source.

## Expected Outcome
- Discovered instruction-injector resources resolve inside their contribution directory by default; absolute/outside paths are rejected unless an explicit trusted absolute-resource policy approves them.
- Discovery loaders verify realpath containment before reading `AGENTS.md`, `SKILL.md`, `manifest.json`, and instruction resource files.
- Instruction injectors either receive redacted runtime input/history, or docs clearly mark them privileged and host-selected.
- Unknown `SystemPromptContribution.source` ranks below known host/run layers and cannot outrank run-level prompt overrides.
- `mergeConfigLayers()`/manifest config cloning blocks `__proto__`, `prototype`, and `constructor` keys or uses null-prototype objects so config JSON cannot mutate prototypes.
- OpenRouter and shared provider header merge patterns set provider-owned `Authorization`, session, and security headers after caller headers.
- `/docs` security, instruction injection, system prompt, provider package, and index pages document the hardened behavior.

## Tasks

- [x] Task 1 — Primitive review: inventory hardening seams and confirm minimum shared helpers
  - Acceptance Criteria:
    - Functional: Inventory current path/trust helpers, contribution discovery reads, instruction resource resolution, system prompt ordering, config merge/clone behavior, runtime injector context redaction, and first-party provider header merging. Record exact reusable seams and reject app/provider-specific core logic.
    - Performance: Review confirms hardening stays at O(1) or one `realpath`/read per guarded file and adds no watchers, background workers, recursive scans, or network calls.
    - Code Quality: Review records exact source/docs paths and names any generic helper to add before implementation.
    - Security: Review identifies every read/merge/header path that can cross a trust boundary and maps it to a fail-closed check.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 37 deliverables and acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/settings-auth-trust-security.md` (`createPathTrustPolicy`, `isPathInsideReal`).
      - `docs/contribution-discovery.md` (workspace discovery and symlink notes).
      - `docs/instruction-injection.md` (redacted input/history claim and resource loading).
      - `docs/system-prompts.md` (`source` ordering and `AGENTS.md`/`SYSTEM.md`).
      - `docs/provider-packages.md` (provider request options and headers).
      - `docs/configuration-and-manifests.md` (config merge guarantees).
      - `src/node/trust.ts`, `src/node/contribution-discovery.ts`, `src/node/instruction-injectors.ts`, `src/node/system-project-prompts.ts`, `src/system-prompts.ts`, `src/config.ts`, `packages/provider-openrouter/src/provider.ts`, `src/providers/openai-compatible.ts`.
    - Options Considered:
      - Add a sandbox for discovered contributions: rejected — roadmap says boundary hardening, not sandboxing host tools/extensions.
      - Duplicate per-loader containment logic: rejected — reuse `isPathInsideReal`/permission checks and add one tiny helper only if needed.
      - Add provider-name-specific header logic in core: rejected — provider-owned headers are package adapter behavior.
    - Chosen Approach:
      - Do a source-first review, then implement the smallest generic checks at the existing boundary functions: Node loaders, config merge, prompt rank, and provider adapters.
    - API Notes and Examples:
      ```ts
      if (!(await isPathInsideReal(contributionDir, target))) throw new Error("Resource escapes contribution directory");
      ```
    - Files to Create/Edit:
      - `plans/038-security-boundary-hardening.md`: record review outcome before implementation.
    - References:
      - `roadmap.md` Phase 37.
      - `src/node/trust.ts` `isPathInsideReal`.
      - `src/node/instruction-injectors.ts` `readInstructionsText`.
      - `src/config.ts` `mergeConfigLayers` / `cloneJsonObject`.
      - `src/system-prompts.ts` `sourceRank` / `rank`.
      - `packages/provider-openrouter/src/provider.ts` header merge.
  - Test Cases to Write:
    - none (review task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review gates public loader/config/prompt/provider behavior changes.
    - Docs pages to create/edit:
      - `plans/038-security-boundary-hardening.md`: review notes only.
    - `docs/index.md` update: no; handled in Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Reviewed current hardening seams and confirmed Task 1 requires no code change; it inventories the exact reusable primitives and gaps for Tasks 2–8.
    - **Reusable primitives / existing seams:**
      - `src/node/trust.ts:22` `isPathInsideReal(root, target)` resolves root and target with `realpath`, resolves a missing target's parent, and fails closed. `createPathTrustPolicy()` (`src/node/trust.ts:47`) already wraps it for `TrustPolicy` checks. Reuse this for contribution resource containment; no new path library needed.
      - `src/security.ts` `assertPermission` / `isTrusted` are already used by Node loaders. Keep permission/trust host-owned; no sandbox or implicit approval UI belongs in core.
      - `src/node/contribution-discovery.ts:45-85` is a single-level named-subdir scan. It gates the kind root through `trust.check`, skips escaping contribution directories via `isPathInsideReal(kindDir, dir)` at line 78, asserts permission for the directory at line 80, then reads one entry file. This is the right place for pre-read file containment checks for `SKILL.md` and `manifest.json`.
      - `src/node/system-project-prompts.ts:35-77` loads at most two files. `AGENTS.md` is trust-gated by `isTrusted()` before `assertPermission()` and read; `SYSTEM.md` is user/global and permission-gated but not workspace-trust-gated. Reuse same policy; no recursive discovery change needed.
      - `src/instruction-injection.ts:20-36` honors only `instructions` and `contextBlocks`; extra contribution fields grant nothing. `resolveInstructionInjectors()` (`src/instruction-injection.ts:56-66`) already fails closed on unknown names. No new capability/permission primitive needed.
      - `src/agents.ts:107-155` sets `activeRedactor`, rebuilds history, redacts run input (`inputToMessages(input).map(this.redact)` at line 138), selects injectors, and `src/agents.ts:168-189` calls `assembleProviderInput()` with `history: this.history` and the selected injectors. `src/input.ts:164-174` builds `InstructionContext` from `inputMessages(options.input)` and `options.history`. Current runtime comments claim redacted input/history, but `assembleProviderInput()` itself does not redact arbitrary callers' direct `options.input`; Task 3 must verify runtime behavior and either redact at `InstructionContext` construction or document injectors as privileged/host-selected.
      - `src/system-prompts.ts:10` has the known source order `user -> package -> app -> run`; `rank()` (`src/system-prompts.ts:52-54`) currently falls back to `10`, meaning an unknown source sorts after `run` and can `replace` run-level text. Task 4 needs only a fallback rank change + tests; no new prompt pipeline.
      - `src/config.ts:41-70` merges/clones JSON with normal `{}` objects and `Object.entries()` without filtering `__proto__`, `prototype`, or `constructor`. `src/manifests.ts` uses `isJsonObject()` for `configDefaults`/`metadata`, so the same config traversal helper can cover manifest JSON. Task 5 should add one forbidden-key guard in config traversal; no schema library needed.
      - Header precedence is adapter-local. `src/providers/openai-compatible.ts:55-59` and `packages/provider-openai/src/responses.ts:28-33` already spread caller headers before provider-owned auth/session headers. `packages/provider-openrouter/src/provider.ts:30-37` does the opposite: provider headers first, then `request.options?.headers`, so caller headers can override `authorization`, `x-session-id`, `http-referer`, and `x-title`. Task 6 is a local OpenRouter ordering fix and regression test, not a core provider abstraction.
    - **Gaps mapped to fail-closed checks:**
      - `src/node/contribution-discovery.ts:107-123` constructs `SKILL.md` / `manifest.json` paths and reads them via `readOptionalFile()` without verifying the entry file itself has not symlinked outside the contribution directory. Add `isPathInsideReal(dir, path)` before read; skip/reject on false.
      - `src/node/instruction-injectors.ts:80-85` resolves `declaration.resource` relative to the manifest dir, but accepts absolute paths and `..` escapes with no trust/permission check. Add contribution-dir containment by default; allow outside/absolute only through an explicit host `TrustPolicy` plus `assertPermission()` before read.
      - `src/input.ts:164-174` can give injectors raw direct-assembly input if a host calls `assembleProviderInput()` directly with secrets and an injector. Runtime path likely stores redacted history, but Task 3 must lock this with a capture-injector regression test.
      - `src/system-prompts.ts:52-54` unknown-source fallback must be below host/run priority, not above it.
      - `src/config.ts:50-64` clone/merge must reject or safely ignore dangerous keys at every depth before assignment.
      - `packages/provider-openrouter/src/provider.ts:30-37` must merge caller headers first, provider-owned headers last.
    - **Performance boundary confirmed:** hardening can stay bounded to one existing scan plus at most one extra `realpath`/containment check per entry file/resource and one in-memory key check per config field/header. No watchers, background workers, recursive filesystem scans, provider calls, or network calls are required.
    - **Code-quality boundary confirmed:** smallest shared helper is a config-key guard (and optionally a tiny Node `assertContainedResource` wrapper around `isPathInsideReal` + `assertPermission`). Do not add sandboxing, SQL/DB persistence code, package-specific core branches, or a provider-header framework.
    - **Security boundary confirmed:** trust-crossing surfaces are file reads (`SKILL.md`, `manifest.json`, instruction `resource`, `AGENTS.md`), injector-observed input/history, custom prompt `source`, config object keys, and provider request headers. Each maps to an existing fail-closed check or a one-line ordering/guard fix in later tasks.

- [x] Task 2 — Harden contribution discovery and instruction resource containment
  - Acceptance Criteria:
    - Functional: Discovery checks realpath containment before reading `SKILL.md` and `manifest.json`; instruction injector `resource` resolves under the contribution directory unless an explicit trusted absolute/outside policy approves it. Permission checks run before reads.
    - Performance: Adds at most one containment check per discovered entry/resource; keeps the single-level scan.
    - Code Quality: Reuses `isPathInsideReal` and existing `PermissionPolicy`/`TrustPolicy`; no new recursive walker or sandbox abstraction.
    - Security: Symlinked contribution dirs or resources escaping trusted roots are skipped/rejected before file content is read.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts` `scanKindRoot`, `readSkillEntry`, `readManifestEntry`.
      - `src/node/instruction-injectors.ts` `readInstructionsText`.
      - `src/node/trust.ts` `isPathInsideReal`.
      - `docs/contribution-discovery.md`, `docs/instruction-injection.md`, `docs/settings-auth-trust-security.md`.
    - Options Considered:
      - Forbid all `resource` fields: rejected — existing static markdown injector needs a resource escape hatch.
      - Allow absolute resources when lexical path is inside root: rejected — symlink escape must use realpath containment.
      - Default to contribution-dir containment with optional explicit trusted absolute policy: chosen — safest default and enough escape hatch for hosts.
    - Chosen Approach:
      - Guard `readSkillEntry`/`readManifestEntry` file paths with containment against their contribution dir/kind root, and guard `readInstructionsText` target against the contribution dir unless a new optional `absoluteResourceTrust`/`trust` option approves the resolved target.
    - API Notes and Examples:
      ```ts
      await registerDiscoveredInstructionInjectors(registries, discovered, {
        resourceTrust: createPathTrustPolicy({ trustedRoots: [trustedPromptRoot] }),
      });
      ```
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts`: verify entry file containment before `readOptionalFile`.
      - `src/node/instruction-injectors.ts`: reject escaping `resource` targets; add optional trusted absolute-resource policy only if needed.
      - `src/__tests__/contribution-discovery.test.ts`: symlink/escape cases.
      - `src/__tests__/node-instruction-injectors.test.ts`: resource containment cases.
    - References:
      - Phase 37 roadmap first two deliverables.
      - `docs/contribution-discovery.md` symlink handling claim.
  - Test Cases to Write:
    - Discovery skips a symlinked contribution directory that resolves outside `.agents/<kind>/`.
    - Discovery does not read `SKILL.md`/`manifest.json` through an escaping symlink.
    - Markdown instruction `resource: ../secret.md` rejects before read.
    - Explicit trusted absolute resource policy permits an absolute file and still requires permission.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Node discovery/instruction injector loader behavior changes and may reject previously accepted paths.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md`: document realpath containment before reads.
      - `docs/instruction-injection.md`: document resource containment and explicit absolute-resource trust.
      - `docs/settings-auth-trust-security.md`: document `isPathInsideReal` usage for contribution resources.
    - `docs/index.md` update: yes; handled in Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `src/node/contribution-discovery.ts` now realpath-checks `SKILL.md` and `manifest.json` against each contribution directory before `readOptionalFile()`. Escaping entry-file symlinks return no contribution.
    - `src/node/instruction-injectors.ts` now resolves markdown resources relative to the manifest directory, realpath-checks containment, rejects escaping resources by default, and allows outside/absolute resources only when a host supplies `resourceTrust`; `permission` is asserted before `readFile()`.
    - Added `LoadInstructionInjectorOptions.resourceTrust` and `permission`; no recursive scanner, sandbox, watcher, or provider/core abstraction added.
    - Tests added in existing files (`src/__tests__/node-contribution-discovery.test.ts`, `src/__tests__/node-instruction-injectors.test.ts`) for escaping `SKILL.md`, escaping `manifest.json`, `../` instruction resource rejection, symlink resource rejection, and explicit trusted outside resource with permission.
    - Docs updated: `docs/contribution-discovery.md`, `docs/instruction-injection.md`, `docs/settings-auth-trust-security.md`.
    - Verification: `npm run build:core && node --test dist/__tests__/node-contribution-discovery.test.js dist/__tests__/node-instruction-injectors.test.js dist/__tests__/docs.test.js` passed (62 tests); `npm run build:core && node --test dist/__tests__/*.test.js` passed (714 tests).

- [x] Task 3 — Verify instruction injector redaction boundary
  - Acceptance Criteria:
    - Functional: Runtime passes instruction injectors redacted input/history matching what persisted session entries expose, or docs explicitly mark injectors privileged and host-selected if current architecture intentionally gives them raw data.
    - Performance: Redaction reuses existing per-run redactor and avoids double-cloning large history when already redacted.
    - Code Quality: One runtime path constructs `InstructionContext`; no special cases per injector source.
    - Security: Secrets known to the active redactor do not appear in injector-observed input/history unless the API is documented as privileged.
  - Approach:
    - Documentation Reviewed:
      - `docs/instruction-injection.md` claim that input/history are redacted.
      - `docs/credentials-and-redaction.md` and `docs/settings-auth-trust-security.md` redaction boundaries.
      - `src/agents.ts` runtime assembly path.
      - `src/instruction-injectors.ts` / input assembly helpers (exact paths confirmed in Task 1).
    - Options Considered:
      - Mark injectors privileged and leave raw data: rejected unless code already depends on raw values; safer docs/code alignment is cheap.
      - Redact only emitted provider request: rejected — injector code itself would still see secrets.
      - Redact `InstructionContext` at construction: chosen if not already true.
    - Chosen Approach:
      - Add/verify a small test injector that captures `ctx.input` and `ctx.history`; assert known secrets are redacted before `apply()` sees them.
    - API Notes and Examples:
      ```ts
      const redactor = createSecretRedactor(["secret-token"]);
      await session.run("secret-token", { redactor, instructionInjectors: [capture] });
      ```
    - Files to Create/Edit:
      - `src/agents.ts` or input/instruction injector runtime file: redact context if needed.
      - `src/__tests__/instruction-injectors.test.ts` or `src/__tests__/agents.test.ts`: capture-context redaction test.
      - `docs/instruction-injection.md`: align privileged/redacted wording.
    - References:
      - Phase 37 roadmap third deliverable.
  - Test Cases to Write:
    - Injector `apply(ctx)` sees redacted current input containing a known secret.
    - Injector `apply(ctx)` sees redacted prior history after a previous run with a known secret.
    - Provider request still receives redacted injector-produced text through existing redaction path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — clarifies/enforces `InstructionContext` data sensitivity.
    - Docs pages to create/edit:
      - `docs/instruction-injection.md`: document redacted or privileged injector context precisely.
      - `docs/settings-auth-trust-security.md`: cross-reference injector redaction boundary.
    - `docs/index.md` update: yes; handled in Task 8 if navigation text changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `src/input.ts` now accepts an optional `redactor` on `AssembleProviderInputOptions` and applies it to current `InstructionContext.input` before any injector `apply()` runs. `InstructionContext.history` stays the already-redacted runtime history; no extra history clone was added.
    - `src/agents.ts` passes the active per-run redactor into `assembleProviderInput()`, so runtime `AgentConfig.redactor` / `RunOptions.redactor` protects injector-observed current input and prior history.
    - Added a runtime regression in `src/__tests__/agents.test.ts` with a capture injector proving first-run current input and second-run prior history contain `[REDACTED]` and not raw known secrets.
    - Existing assembler regression still verifies injector-produced text is redacted on the outgoing provider request path.
    - Docs updated: `docs/instruction-injection.md` now states runtime context redaction and direct `assembleProviderInput()` redactor responsibility; `docs/settings-auth-trust-security.md` now includes injector context in redactor coverage.
    - Verification: `npm run build:core && node --test dist/__tests__/agents.test.js dist/__tests__/instruction-injection-assembler.test.js dist/__tests__/docs.test.js` passed (111 tests); `npm run build:core && node --test dist/__tests__/*.test.js` passed (715 tests).

- [x] Task 4 — Make system prompt source ordering fail-safe for unknown sources
  - Acceptance Criteria:
    - Functional: Unknown `SystemPromptContribution.source` ranks no higher than known host/run layers; custom sources cannot override or replace run-level prompt by sorting after it with higher priority.
    - Performance: Ordering remains one in-memory sort over prompt layers.
    - Code Quality: `sourceRank`/`rank` is the single source of ordering truth with tests covering unknown sources.
    - Security: Package/custom prompt layers cannot accidentally outrank `RunOptions.systemPrompt` or host/run overrides.
  - Approach:
    - Documentation Reviewed:
      - `src/system-prompts.ts` `sourceRank` and `rank()`.
      - `docs/system-prompts.md` source ordering.
      - `roadmap.md` Phase 37 unknown-source deliverable.
    - Options Considered:
      - Throw on unknown source: rejected — public type allows strings and packages may use custom labels.
      - Keep unknown after run with rank `10`: rejected — a later unknown `replace` can override run layers.
      - Rank unknown with low/package-like priority before host/run layers: chosen.
    - Chosen Approach:
      - Change `rank()` fallback to a safe low rank (for example package/app-adjacent but before `run`) and document exact behavior.
    - API Notes and Examples:
      ```ts
      composeSystemPrompt([
        { source: "run", mode: "replace", text: "Run wins" },
        { source: "custom", mode: "replace", text: "Cannot outrank run" },
      ]);
      ```
    - Files to Create/Edit:
      - `src/system-prompts.ts`: safe unknown-source rank.
      - `src/__tests__/system-prompts.test.ts`: unknown source ordering tests.
      - `docs/system-prompts.md`: document custom source rank.
    - References:
      - `docs/system-prompts.md` known order `user → package → app → run`.
  - Test Cases to Write:
    - Unknown `replace` contribution does not override a later/equal run contribution.
    - Stable order among multiple unknown sources remains deterministic.
    - Existing `user/package/app/run` order remains unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — prompt composition behavior for custom sources changes.
    - Docs pages to create/edit:
      - `docs/system-prompts.md`: custom source ordering and run override safety.
    - `docs/index.md` update: no navigation change expected.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `src/system-prompts.ts` now ranks unknown custom sources at `1.5`: after `user`/`package`, before `app`/`run`. `sourceRank` plus `rank()` remains the single ordering path; composition stays one in-memory stable sort plus one apply pass.
    - Added `src/__tests__/system-prompts.test.ts` regressions proving an unknown `replace` cannot override a run `replace`, multiple unknown sources keep input order, known `user → package → app → run` behavior remains, and run `disable` clears earlier unknown/app layers.
    - `docs/system-prompts.md` now documents known source order, unknown custom source placement, stable unknown ordering, and run override safety; no `docs/index.md` navigation change needed.
    - Verification: `npm run build:core && node --test dist/__tests__/system-prompts.test.js dist/__tests__/docs.test.js` passed (45 tests); `npm run build:core && node --test dist/__tests__/*.test.js` passed (717 tests).

- [x] Task 5 — Block prototype pollution in config and manifest JSON merging
  - Acceptance Criteria:
    - Functional: `mergeConfigLayers()` and JSON clone/merge paths ignore or reject `__proto__`, `prototype`, and `constructor` keys at every depth, or build null-prototype output objects so prototypes cannot be mutated.
    - Performance: Merge remains proportional to JSON field count.
    - Code Quality: One small forbidden-key helper covers merge, clone, and relevant manifest config defaults; tests document chosen reject/skip behavior.
    - Security: Config JSON cannot set `Object.prototype` fields or alter constructors through nested objects.
  - Approach:
    - Documentation Reviewed:
      - `src/config.ts` `mergeConfigLayers`, `mergeObjects`, `cloneJsonObject`, `isJsonObject`.
      - `src/manifests.ts` config defaults parsing (exact section confirmed in Task 1).
      - `docs/configuration-and-manifests.md` merge behavior.
    - Options Considered:
      - Only use null-prototype objects: acceptable but can surprise JSON consumers.
      - Silently drop dangerous keys: smaller diff but hides bad config.
      - Throw on dangerous keys: chosen unless compatibility demands drop; fail closed is clearer.
    - Chosen Approach:
      - Add `assertSafeJsonKey()` in config merge/clone traversal; throw with field path on forbidden keys.
    - API Notes and Examples:
      ```ts
      mergeConfigLayers([{ name: "bad", config: JSON.parse('{"__proto__":{"polluted":true}}') }]);
      // throws; ({} as any).polluted remains undefined
      ```
    - Files to Create/Edit:
      - `src/config.ts`: forbidden key guard.
      - `src/__tests__/config.test.ts`: pollution tests.
      - `docs/configuration-and-manifests.md`: document forbidden keys.
    - References:
      - Phase 37 roadmap config deliverable.
  - Test Cases to Write:
    - Top-level `__proto__`, `prototype`, and `constructor` config keys reject and do not pollute `Object.prototype`.
    - Nested dangerous keys reject.
    - Valid null-prototype JSON object still merges normally.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config merge rejects dangerous keys.
    - Docs pages to create/edit:
      - `docs/configuration-and-manifests.md`: forbidden-key behavior and rationale.
      - `docs/settings-auth-trust-security.md`: mention config pollution guard.
    - `docs/index.md` update: no navigation change expected.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `src/config.ts` now rejects `__proto__`, `prototype`, and `constructor` keys at every object depth via one forbidden-key helper used by `assertJsonObject()`, `mergeObjects()`, and JSON clone traversal. Output objects stay normal JSON objects; unsafe input fails closed instead of being silently dropped.
    - `src/manifests.ts` now validates optional manifest JSON objects through `assertJsonObject()`, so `configDefaults`, manifest metadata, contribution metadata, and resource metadata share the same forbidden-key guard.
    - Added `src/__tests__/config-manifests.test.ts` regressions for top-level `__proto__` / `prototype` / `constructor`, nested dangerous keys, no `Object.prototype` pollution, valid null-prototype JSON objects, and manifest JSON rejection.
    - Docs updated: `docs/configuration-and-manifests.md` documents forbidden-key rejection and rationale; `docs/settings-auth-trust-security.md` mentions the prototype-pollution guard. No `docs/index.md` navigation change needed.
    - Verification: `npm run build:core && node --test dist/__tests__/config-manifests.test.js dist/__tests__/docs.test.js` passed (51 tests); `npm run build:core && node --test dist/__tests__/*.test.js` passed (720 tests).

- [x] Task 6 — Enforce provider-owned header precedence in OpenRouter and shared patterns
  - Acceptance Criteria:
    - Functional: Caller-provided `ProviderRequest.options.headers` cannot override provider-owned `Authorization`, session/cache/security headers, content type, or provider app headers in OpenRouter; any shared OpenAI-compatible pattern remains provider-owned-header-last.
    - Performance: Header merge remains object/`Headers` construction only; no extra network calls.
    - Code Quality: Minimal helper or local ordering fix; tests assert actual outgoing headers, not implementation details.
    - Security: Caller headers cannot replace bearer tokens or provider session/security headers.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-openrouter/src/provider.ts` header merge currently spreads `request.options?.headers` after provider headers.
      - `src/providers/openai-compatible.ts` header merge already sets authorization after caller headers.
      - `docs/provider-packages.md`, provider-specific OpenRouter docs.
    - Options Considered:
      - Strip all caller headers: rejected — providers expose generic header extension intentionally.
      - Maintain denylist only: more code and misses future provider-owned headers.
      - Merge caller headers first, then provider-owned headers last: chosen.
    - Chosen Approach:
      - Change OpenRouter header object order so `request.options?.headers` comes first and provider-owned values come last; add tests for override attempts.
    - API Notes and Examples:
      ```ts
      headers: cleanHeaders({
        ...request.options?.headers,
        authorization: `Bearer ${token}`,
        "x-session-id": sessionId,
      })
      ```
    - Files to Create/Edit:
      - `packages/provider-openrouter/src/provider.ts`: header merge order.
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`: override tests.
      - `docs/provider-packages.md` and `docs/providers/openrouter.md`: header ownership notes.
    - References:
      - Phase 37 roadmap provider header deliverable and OpenRouter ordering fix.
  - Test Cases to Write:
    - Caller `authorization: Bearer attacker` is replaced by provider API key.
    - Caller `x-session-id` cannot override provider session/cache header.
    - Caller non-owned header still passes through.
    - OpenAI-compatible adapter keeps provider authorization precedence.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider request header override semantics harden.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: generic provider-owned header rule.
      - `docs/providers/openrouter.md`: OpenRouter-specific auth/session header ownership.
    - `docs/index.md` update: no navigation change expected.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - `packages/provider-openrouter/src/provider.ts` now merges caller `ProviderRequest.options.headers` first, then applies provider-owned `Content-Type`, `Authorization`, `X-Session-Id`, `HTTP-Referer`, and `X-Title` last. Caller non-owned headers still pass through.
    - `src/providers/openai-compatible.ts` keeps the shared OpenAI-compatible pattern provider-owned-header-last for `Content-Type` and `Authorization`.
    - Added regression tests asserting actual outgoing headers: `packages/provider-openrouter/src/__tests__/openrouter.test.ts` covers caller attempts to override auth/content/session/app headers while preserving `x-caller`; `src/__tests__/openai-compatible.test.ts` covers shared OpenAI-compatible auth/content-type precedence.
    - Docs updated: `docs/provider-packages.md` documents generic provider-owned header precedence; `docs/providers/openrouter.md` documents OpenRouter-owned headers and caller extension-header behavior. No `docs/index.md` navigation change needed.
    - Verification: `npm run build:core && node --test dist/__tests__/openai-compatible.test.js dist/__tests__/docs.test.js && npm run build -w @arnilo/prism-provider-openrouter && npm test -w @arnilo/prism-provider-openrouter` passed (50 core/doc tests plus 9 OpenRouter package tests, 1 live-test skip). Full `npm test` exit code 0.

- [x] Task 7 — Add security regression tests and final verification
  - Acceptance Criteria:
    - Functional: Tests cover file escape, config pollution, prompt unknown-source rank, injector redaction, and provider header override attempts.
    - Performance: Default no-network test suite remains within the repo's release budget; no live provider or filesystem watcher tests.
    - Code Quality: Tests are small `node:test` cases near existing affected modules; no new test framework or fixtures beyond temp dirs/files.
    - Security: Every Phase 37 acceptance condition has at least one failing-before/passing-after regression check.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts.
      - Existing `src/__tests__/*`, `packages/provider-openrouter/src/__tests__/openrouter.test.ts` patterns.
      - `docs/release-and-install.md` test budget note.
    - Options Considered:
      - One end-to-end security test: rejected — harder to diagnose and duplicates unit tests.
      - Focused module tests with temp dirs and mocked fetch: chosen.
    - Chosen Approach:
      - Add focused tests while implementing Tasks 2–6, then run one final build/test pass.
    - API Notes and Examples:
      ```bash
      npm test
      ```
    - Files to Create/Edit:
      - `src/__tests__/contribution-discovery.test.ts`
      - `src/__tests__/node-instruction-injectors.test.ts`
      - `src/__tests__/instruction-injectors.test.ts` or `src/__tests__/agents.test.ts`
      - `src/__tests__/system-prompts.test.ts`
      - `src/__tests__/config.test.ts`
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`
    - References:
      - Phase 37 acceptance list.
  - Test Cases to Write:
    - Run all task-specific tests listed above.
    - `npm test`: final network-free verification.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new docs from this task alone; verifies documented behavior from Tasks 2–6.
    - Docs pages to create/edit:
      - `none`: documentation handled in Task 8.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Security regressions now exist near affected modules for every Phase 37 boundary implemented so far:
      - file escape: `src/__tests__/node-contribution-discovery.test.ts` and `src/__tests__/node-instruction-injectors.test.ts` cover symlink/path escapes and permission-before-read.
      - injector redaction: `src/__tests__/agents.test.ts` captures injector context and asserts current input/prior history are redacted.
      - prompt unknown-source rank: `src/__tests__/system-prompts.test.ts` proves unknown sources cannot override run layers and keep stable order.
      - config/manifest pollution: `src/__tests__/config-manifests.test.ts` rejects dangerous keys and proves `Object.prototype` is not polluted.
      - provider header overrides: `packages/provider-openrouter/src/__tests__/openrouter.test.ts` and `src/__tests__/openai-compatible.test.ts` assert actual outgoing headers keep provider-owned values.
    - Tests remain focused `node:test` cases using temp files or mocked fetch only; no new test framework, live provider dependency, watcher, or network requirement was added. OpenRouter live test remains skipped by default.
    - Task-specific verification passed: `npm run build:core && node --test dist/__tests__/node-contribution-discovery.test.js dist/__tests__/node-instruction-injectors.test.js dist/__tests__/agents.test.js dist/__tests__/system-prompts.test.js dist/__tests__/config-manifests.test.js dist/__tests__/openai-compatible.test.js && npm run build -w @arnilo/prism-provider-openrouter && npm test -w @arnilo/prism-provider-openrouter` passed (110 core tests, 9 OpenRouter package tests, 1 live-test skip).
    - Final verification passed: `npm test` exit code 0.

- [x] Task 8 — Update security boundary docs and index
  - Acceptance Criteria:
    - Functional: Docs explain contribution realpath containment, instruction resource trust, injector context redaction/privilege, prompt custom-source rank, config pollution guard, and provider-owned header precedence.
    - Performance: Docs state no sandbox, watcher, recursive scan, or automatic filesystem/provider work is added.
    - Code Quality: Docs follow Prism API page structure where pages are API pages; links are consistent with current filenames.
    - Security: Docs make fail-closed behavior and host-owned trust/permission responsibilities explicit.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/index.md` security and configuration sections.
      - `docs/settings-auth-trust-security.md` (current canonical security/auth/trust page; roadmap shorthand says `/docs/security-auth-trust.md`).
      - `docs/contribution-discovery.md`, `docs/instruction-injection.md`, `docs/system-prompts.md`, `docs/configuration-and-manifests.md`, `docs/provider-packages.md`, `docs/providers/openrouter.md`.
    - Options Considered:
      - Create a duplicate `docs/security-auth-trust.md`: rejected unless docs navigation requires the exact roadmap filename; current index already uses `settings-auth-trust-security.md`.
      - Update only affected sections in existing pages: chosen — fewer files, less drift.
    - Chosen Approach:
      - Patch existing docs and update `docs/index.md` descriptions if new hardening behavior changes navigation text.
    - API Notes and Examples:
      ```md
      - Provider-owned headers win: adapters merge caller headers first, then auth/session/security headers.
      ```
    - Files to Create/Edit:
      - `docs/settings-auth-trust-security.md`: boundary hardening summary.
      - `docs/contribution-discovery.md`: realpath-before-read details.
      - `docs/instruction-injection.md`: resource containment and redacted/privileged context wording.
      - `docs/system-prompts.md`: custom source ordering.
      - `docs/configuration-and-manifests.md`: forbidden config keys.
      - `docs/provider-packages.md`: provider-owned headers.
      - `docs/providers/openrouter.md`: OpenRouter header ownership.
      - `docs/index.md`: update existing entries if descriptions change.
    - References:
      - Prism wiki API page structure.
      - Roadmap Phase 37 docs list.
  - Test Cases to Write:
    - Existing docs/link checks if present.
    - `npm test`: catches docs enforcement tests if configured.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this is the required docs update for the phase.
    - Docs pages to create/edit:
      - `docs/settings-auth-trust-security.md`: canonical security/auth/trust page update.
      - `docs/contribution-discovery.md`: discovery containment update.
      - `docs/instruction-injection.md`: injector resource/context update.
      - `docs/system-prompts.md`: prompt source rank update.
      - `docs/configuration-and-manifests.md`: config pollution update.
      - `docs/provider-packages.md`: header precedence update.
      - `docs/providers/openrouter.md`: OpenRouter header precedence update.
    - `docs/index.md` update: yes if entry descriptions need hardening notes; keep existing Security and credentials navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Updated `docs/settings-auth-trust-security.md` with a boundary hardening summary covering contribution entry realpath checks, instruction resource trust/permission, injector redacted context and no privilege grant, unknown prompt source ordering, config/manifest forbidden keys, and provider-owned header precedence. The page also states no sandbox and no added workers/watchers/retries/network/filesystem scans.
    - Updated `docs/index.md` navigation descriptions for contribution discovery, instruction injection, configuration/manifests, provider packages, and security/auth/trust so the hardening boundaries are discoverable from the docs index.
    - Verified the existing affected pages already document detailed behavior: `docs/contribution-discovery.md`, `docs/instruction-injection.md`, `docs/system-prompts.md`, `docs/configuration-and-manifests.md`, `docs/provider-packages.md`, and `docs/providers/openrouter.md`.
    - Added `phase37_security_boundary_docs_cover_hardening_summary` in `src/__tests__/docs.test.ts` to lock the docs/index coverage.
    - Verification passed: `npm run build:core && node --test dist/__tests__/docs.test.js` (41 docs tests) and full `npm test` exit code 0.

## Compromises Made
- Reused `docs/settings-auth-trust-security.md` as the canonical security boundary page instead of creating duplicate `docs/security-auth-trust.md`; this matches the current docs index and avoids drift.

## Further Actions
- None for Phase 37. Future hardening phases should add one focused docs regression test per new public security boundary.
