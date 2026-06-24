# Phase 18 — Documentation, Examples, and Fixtures Catch-up

Tracks roadmap Phase 18: make the implemented package usable without reading
source. This plan does not add runtime behavior; every example, demo, fixture,
and docs page documents or exercises **already implemented** public APIs and
first-party packages.

It depends on Phases 14–17 being complete (they are: contracts, runtime,
stores, providers, compaction, observational memory, packaging, and release
files are all implemented per `plans/014`–`020`).

## Objectives

- Replace the stale placeholder `README.md` with an accurate Phase 14+ runtime
  overview (agents/sessions, tools, stores, compaction, providers, CLI/RPC).
- Complete provider-specific docs for OpenAI, OpenCode Go, OpenRouter, ZAI, and
  Kimi using the required 9-heading API-page structure, and enforce those
  headings in `docs.test.ts` instead of only the generic OpenAI-compatible page.
- Close every `/docs` coverage gap and `docs/index.md` link named in the roadmap
  so every public API, extension point, event, config surface, manifest field,
  default strategy, and first-party package has a linked page.
- Add compile-checked typed examples covering SDK basics through RPC, runnable
  without network or real credentials.
- Add end-to-end mock demos for provider packages, LLM compaction,
  observational-memory recall, CLI, and RPC.
- Add golden JSONL session fixtures (branching, compaction, LLM summaries,
  observational-memory ledger entries, corrupt entries, tool-result replay)
  consumed by tests, with no real-looking secrets.
- Document the opt-in live provider/worker smoke-test env vars without making
  them part of default verification.

## Expected Outcome

- A new `examples/` tree typechecks as part of `npm run typecheck` and a docs
  test asserts every listed example file exists and is covered.
- `npm test` is still network-free and stays under the 30s budget; new fixture
  and example tests are fast.
- `npm pack --dry-run` for core still excludes `examples/` source and any
  fixtures that are not intentionally shipped.
- Every first-party provider docs page passes the same 9-heading check as the
  OpenAI-compatible page.
- README, `docs/index.md`, and provider READMEs all describe the real runtime.
- A reader can go from install → register a provider → run a session → branch →
  compact → recall memory → drive CLI/RPC using only README + `/docs` +
  `examples/`.

## Tasks

- [x] 1. Inventory gaps and pin the example/fixture/docs scope
  - Acceptance Criteria:
    - Functional: a written inventory exists in this task (Approach section)
      enumerating (a) every `/docs` page named by the roadmap, (b) each
      first-party provider docs page and which of the 9 required headings it
      currently lacks, (c) the exact list of typed examples and runnable demos
      to add, and (d) the golden fixtures to add.
    - Performance: inventory is read-only; no build/test runtime change.
    - Code Quality: the inventory becomes the source of truth that tasks 2–8 are
      checked against, so later tasks do not drift or duplicate.
    - Security: inventory records which surfaces touch credentials/secrets so
      examples/fixtures carry the "no real-looking secrets" rule forward.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 18 deliverables and acceptance criteria.
      - `docs/index.md` current nav groups and links.
      - `src/__tests__/docs.test.ts` current enforced pages and headings.
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - `src/index.ts` and each `packages/*/src/index.ts` for the exact public
        export list each example/demo must exercise.
    - Options Considered:
      - Skip the inventory and let each task re-derive its scope: rejected — the
        roadmap names ~16 example topics, 5 provider pages, and 6 fixture kinds;
        without a pinned list, tasks overlap or miss items.
      - Put the inventory in a separate `docs/coverage.md`: rejected — it would
        need its own maintenance; keeping it in this task block is enough.
    - Chosen Approach:
      - Inline the inventory below. It is the measured source of truth for
        tasks 2–8; later tasks check against it. Findings recorded by actually
        scanning `/docs`, `src/index.ts`, each `packages/*/src/index.ts`, the
        live test files, and `docs/index.md`.
    - Inventory (measured):
      - **Provider docs missing all 9 API-page headings** (current stubs):
        `docs/providers/openai.md` (33 lines), `opencode-go.md` (27),
        `openrouter.md` (33), `zai.md` (19), `kimi.md` (22).
        `docs/providers/openai-compatible.md` (125 lines) already passes all 9.
      - **Non-provider heading gap found during inventory:**
        `docs/provider-packages.md` is missing 3 of 9 — `Request/response
        example`, `Implementation example`, `Extension and configuration
        notes`. Folded into Task 4 (it is the provider-package-authoring page,
        not a `docs/providers/*` page, so Task 3's `docs/providers/*.md` glob
        will not cover it).
      - **`docs/index.md` link state:** all 27 content pages are already linked.
        The only files not linked are `index.md` (itself) and
        `api-page-template.md` (a heading template, correctly unlinked). The
        sole new index entry needed is the `examples/` entry added in Task 5.
      - **Topic coverage (measured, mostly already present — Task 4 is lighter
        than originally scoped):**
        - `credentials-and-redaction.md`: OAuth/API-key resolver order present
          (`docs.test.ts` already asserts `createExplicitCredentialResolver`,
          `createEnvCredentialResolver`, `refreshOAuthCredential`).
        - `system-prompts.md`: layering present (`docs.test.ts` asserts
          `composeSystemPrompt` + `package/app/user/run` order).
        - `compaction-observational-memory.md`: `recall`, `status`, `view` all
          already present — no additions needed.
        - `provider-packages.md`: `cache`, `compat`, `OAuth`, `auth`,
          `model metadata` present; exact phrase `cache policy` absent — add as
          a phrase anchor plus the 3 missing headings in Task 4.
      - **Typed examples (export names confirmed against source):**
        - `sdk-basics.ts` — `createAgent`, `createAgentSession`,
          `createMockProvider`, `session.subscribe()`/`session.run()`.
        - `provider-registration.ts` — `createProviderRegistry`,
          `createModelRegistry`, plus one `@prism/provider-*` package
          (`createXProviderPackage`).
        - `api-key-auth.ts` — `createEnvCredentialResolver`,
          `createExplicitCredentialResolver` (fake-safe keys).
        - `oauth-login.ts` — `createOpenAICodexOAuthProvider` /
          `openAICodexOAuthProvider` with mocked OAuth callbacks + PKCE helpers
          (`createPkceVerifier`, `computeS256Challenge`).
        - `openrouter-model-cache-override.ts` —
          `createOpenRouterProviderPackage` + `OpenRouterModelConfig` cache
          override.
        - `tools.ts` — `createToolRegistry`, `filterTools`, `dispatchToolCall`.
        - `context.ts` — `resolveContextProviders`.
        - `skills.ts` — `createSkillRegistry`, `resolveActiveSkills`.
        - `extensions.ts` — `createExtensionKernel`,
          `createExtensionEventBus`, `registerProviderPackage`.
        - `manifests.ts` — `definePrismManifest`, `parsePrismManifest`,
          `ManifestContributionKind`.
        - `config-settings.ts` — `mergeConfigLayers`,
          `createStaticSettingsProvider`, node config subpath.
        - `system-prompts.ts` — `composeSystemPrompt` + layer order.
        - `jsonl-stores-branching.ts` — `createMemorySessionStore`,
          `createSessionEntry`, `rebuildSessionContext`, node JSONL subpath,
          fork/clone/branch.
        - `compaction.ts` — `createDefaultCompactionStrategy`,
          `createDefaultRetryPolicy`.
        - `observational-memory-recall-status-view.ts` —
          `createObservationalMemoryExtension`, `recallObservationalMemory`,
          `createMemoryStatusCommand`, `createMemoryViewCommand`,
          `createRecallMemoryTool`.
        - `cli.ts` — `prism -p` / `--mode json` / `--mode rpc` via spawned bin.
        - `rpc.ts` — LF-delimited RPC commands (`prompt`, `abort`, `compact`,
          `cloneSession`).
      - **Runnable mock demos (Task 6, a subset of the above with `main()`):**
        provider packages (mock `fetch`/OAuth), LLM compaction
        (`createLlmCompactionStrategy` with mock summarizer),
        observational-memory recall (`recallObservationalMemory`), CLI, RPC.
      - **Golden JSONL fixtures (Task 7):** `branching.jsonl`,
        `compaction.jsonl`, `llm-summary.jsonl`,
        `observational-memory-ledger.jsonl`, `corrupt.jsonl`,
        `tool-result-replay.jsonl`.
      - **Live test env vars (Task 8, exact names confirmed in source):**
        `PRISM_LIVE_PROVIDER_TESTS=1` gates the 5 provider packages;
        `PRISM_LIVE_COMPACTION_TESTS=1` gates `@prism/compaction-llm`;
        `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` gates
        `@prism/compaction-observational-memory`. All currently implemented as
        network-free guards that skip unless the var is set.
      - **Packaging constraint (Task 5):** `examples/` must be excluded from
        every tarball; `packaging.test.ts` already denies `src/`, `plans/`,
        etc. — add an `examples/` source denial assertion.
    - References (measured during inventory):
      - Heading scan: all `docs/*.md` and `docs/providers/*.md`.
      - Export surface: `src/index.ts` (47 exports), each
        `packages/*/src/index.ts`.
      - Live guards: every `packages/*/src/__tests__/live.test.ts`.
      - Index links: diff of `docs/index.md` links vs on-disk pages.
    - Files to Create/Edit:
      - this task block (no code files)
    - References:
      - `roadmap.md` Phase 18; `docs/index.md`; `src/__tests__/docs.test.ts`;
        `prism-wiki.md`.

- [x] 2. Rewrite `README.md` to the Phase 14+ runtime
  - Acceptance Criteria:
    - Functional: README describes agent/session runtime, tool harness, session
      stores/branching, compaction, settings/auth/trust, the 5 first-party
      provider packages, CLI print/json/rpc modes, and the `examples/` and
      `/docs` entry points; the "Current scope" and "Non-goals" sections no
      longer claim the runtime is placeholder.
    - Performance: README is static markdown; no runtime impact.
    - Code Quality: code snippets in README match real exports from
      `src/index.ts` and a package specifier; no workspace-relative imports.
    - Security: README states hosts own credentials and that secrets must not
      enter prompts/events/stores; no real-looking keys.
  - Approach:
    - Documentation Reviewed:
      - Current `README.md` (stale: calls CLI a placeholder, lists only provider
        lookup as implemented).
      - `docs/index.md` for the authoritative feature list and nav groups.
      - `src/index.ts` export surface and `packages/*/package.json` names.
      - `docs/release-and-install.md` for the install specifier and peer-dep
        wording to keep README consistent with release docs.
    - Options Considered:
      - Keep README minimal and point only at `/docs`: rejected — README is the
        install landing page; the roadmap explicitly wants it to describe the
        current runtime.
      - Mirror full API detail into README: rejected — duplication that drifts;
        README links to `/docs` for depth.
    - Chosen Approach:
      - Rewrite "Current scope" to list the implemented runtime; add short
        runnable snippets for create agent/session, register a provider package,
        run a session, and drive the CLI; keep "Docs" and "Scripts" sections;
        update "Non-goals" to drop "first-party provider adapters beyond
        OpenAI-compatible" (they now exist as packages).
    - API Notes and Examples:
      ```ts
      import { createAgent, createAgentSession } from "prism";
      import { createMockProvider } from "prism";

      const agent = createAgent({ provider: createMockProvider([{ type: "text", text: "hi" }, { type: "done" }]) });
      const session = createAgentSession({ agent });
      for await (const event of session.subscribe()) { /* AgentEvent */ }
      await session.run("Hello");
      ```
    - Files to Create/Edit:
      - `README.md`: replace stale scope with Phase 14+ overview.
    - References:
      - `docs/index.md`; `docs/agent-session-runtime.md`;
        `docs/release-and-install.md`; `plans/009-agent-session-runtime.md`.
  - Test Cases to Write:
    - `docs.test.ts`: assert README mentions `createAgent`/`createAgentSession`,
      the 5 provider package names, CLI `print`/`json`/`rpc` modes, and
      `examples/`; assert README contains no `sk-` real-looking secret.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — README is the package landing page,
      not an API surface.
    - Docs pages to create/edit: `README.md` only.
    - `docs/index.md` update: no (README links to index, not vice versa).
    - Documentation structure reference: `prism-wiki.md` (page structure not
      required for README, but snippet style should match).

- [x] 3. Complete provider-specific docs and enforce their headings
  - Acceptance Criteria:
    - Functional: `docs/providers/openai.md`, `opencode-go.md`, `openrouter.md`,
      `zai.md`, and `kimi.md` each contain all 9 required headings (What it
      does / When to use it / Inputs / Outputs / Request-response example /
      Implementation example / Extension and configuration notes / Security and
      performance notes / Related APIs) and document real exports from each
      `packages/provider-*/src/index.ts`.
    - Performance: static docs; no runtime impact.
    - Code Quality: snippets import by package specifier (`@prism/provider-*`),
      never by workspace-relative path; examples use `createMockProvider`/fake
      credentials so they are network- and secret-free.
    - Security: every page states credentials are caller-owned, resolved per
      request, never env-scanned by Prism; no real-looking keys.
  - Approach:
    - Documentation Reviewed:
      - `prism-wiki.md` API-page structure (9 headings).
      - Existing `docs/providers/openai-compatible.md` as the passing template.
      - Each `packages/provider-*/src/index.ts` for exact exported function and
        options names; each package README for the behavior notes already
        written.
      - `src/__tests__/docs.test.ts` `apiPages` list and `requiredHeadings`.
    - Options Considered:
      - One combined "providers" page: rejected — the roadmap wants
        provider-specific pages and the index already links 5 of them.
      - Enforce headings via a generic "all files under docs/providers" glob:
        chosen for the test, so adding a future provider page is automatic.
    - Chosen Approach:
      - Expand each of the 5 stub pages to the full 9-heading structure using
        the OpenAI-compatible page as the template; cross-link Related APIs to
        `provider-packages.md`, `credentials-and-redaction.md`, and
        `provider-conformance.md`.
      - Extend `docs.test.ts`: change the heading check to scan every
        `docs/providers/*.md` (glob, not hard-coded list) so the rule applies to
        all current and future provider pages, and add an assertion that each
        provider page documents at least one real export from its package.
    - API Notes and Examples:
      ```ts
      // docs/providers/openrouter.md implementation example shape
      import { createOpenRouterProviderPackage } from "@prism/provider-openrouter";
      api.registerProviderPackage(
        createOpenRouterProviderPackage({ apiKey: () => process.env.OPENROUTER_API_KEY }),
      );
      ```
    - Files to Create/Edit:
      - `docs/providers/openai.md`: full API page.
      - `docs/providers/opencode-go.md`: full API page.
      - `docs/providers/openrouter.md`: full API page (model/cache override).
      - `docs/providers/zai.md`: full API page.
      - `docs/providers/kimi.md`: full API page.
      - `src/__tests__/docs.test.ts`: enforce headings + export coverage on every
        `docs/providers/*.md`.
    - References:
      - `docs/providers/openai-compatible.md`; `prism-wiki.md`;
        `packages/provider-*/src/index.ts`; `plans/015-real-provider-packages.md`.
  - Test Cases to Write:
    - Extend `docs.test.ts`: every `docs/providers/*.md` has all 9 headings.
    - Extend `docs.test.ts`: each provider page string-contains at least one
      export actually present in its package's `src/index.ts`.
    - Re-run the existing "docs avoid real-looking secret examples" check (now
      also covers the 5 new pages).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider package public surface is
      newly documented in full.
    - Docs pages to create/edit: the 5 `docs/providers/*.md` pages listed above.
    - `docs/index.md` update: no (links already present); verify links still
      resolve after expansion.
    - Documentation structure reference: `prism-wiki.md`.

- [x] 4. Close `/docs` coverage gaps and verify `docs/index.md` links
  - Acceptance Criteria:
    - Functional: every topic named in the roadmap (provider package authoring,
      OAuth/API-key auth, cache policy, model compat metadata, system prompt
      layering, LLM compaction, observational memory recall/status/view, CLI/RPC,
      manifests, release/install) is covered on a linked page and indexed from
      `docs/index.md`.
    - Performance: static docs; no runtime impact.
    - Code Quality: no `/docs` page is a stub missing required headings where the
      `apiPages` list already enforces them; new content references real exports.
    - Security: coverage of auth/cache/secrets pages reiterates no env scanning,
      per-request resolution, and no secrets in events/stores/summaries.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 18 "Complete `/docs` coverage" bullet.
      - `docs/index.md` current links; the `apiPages` and phrase-assertions in
        `docs.test.ts` that already pin much of this coverage.
      - `plans/014` (provider/auth/cache/system-prompt primitives), `plans/016`
        (LLM compaction), `plans/017` (observational memory) for the exact
        surfaces to cover.
    - Options Considered:
      - Add brand-new pages for each sub-topic (cache-policy.md, model-compat.md,
        etc.): rejected — the index and tests already route these into
        `provider-packages.md`, `provider-layer.md`, `credentials-and-redaction.md`,
        `system-prompts.md`; splitting fragments the nav.
      - Ensure depth inside the existing routed pages and add an index
        cross-reference where a topic is hard to find: chosen.
    - Chosen Approach:
      - Audit each existing page against the roadmap bullet; add missing
        sections/phrase anchors in place (e.g., observational-memory recall/
        status/view on `compaction-observational-memory.md`, cache policy +
        model compat on `provider-packages.md`, OAuth/API-key resolver order on
        `credentials-and-redaction.md`, system-prompt layers on
        `system-prompts.md`).
      - Add an `examples/` entry to `docs/index.md` (Testing/examples group)
        pointing at the examples once task 5 lands.
      - Add a `docs.test.ts` assertion that `docs/index.md` links an examples
        entry (guarded to run after task 5, or added in task 5).
    - API Notes and Examples:
      ```bash
      # one-command coverage audit during implementation
      grep -rL "## What it does" docs/  # pages missing the template (informational)
      ```
    - Files to Create/Edit:
      - `docs/provider-packages.md`: add the 3 missing headings
        (`Request/response example`, `Implementation example`, `Extension and
        configuration notes`) and a `cache policy` phrase anchor; ensure model
        compat depth.
      - `docs/compaction-observational-memory.md`: ensure recall/status/view.
      - `docs/credentials-and-redaction.md`: ensure OAuth/API-key resolver order.
      - `docs/system-prompts.md`: ensure layering depth.
      - `docs/index.md`: add examples entry (with task 5).
      - `src/__tests__/docs.test.ts`: add targeted phrase/link assertions for any
        newly required coverage.
    - References:
      - `roadmap.md` Phase 18; `docs/index.md`; `plans/014`, `016`, `017`.
  - Test Cases to Write:
    - `docs.test.ts`: assert index links an `examples/` entry after task 5.
    - `docs.test.ts`: targeted phrase assertions for any coverage the audit found
      missing (e.g., observational-memory recall/status/view phrases).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — completes public docs coverage.
    - Docs pages to create/edit: the in-place edits listed above (no new pages).
    - `docs/index.md` update: yes — add examples entry.
    - Documentation structure reference: `prism-wiki.md`.

- [x] 5. Add compile-checked typed examples (`examples/`)
  - Acceptance Criteria:
    - Functional: an `examples/` directory contains one `.ts` file per topic in
      the task-1 inventory; `npm run typecheck` compiles them; a docs test
      asserts each listed example file exists.
    - Performance: examples typecheck within the existing build/typecheck time
      budget (incremental, seconds); they are not compiled into `dist/`.
    - Code Quality: each example imports from `prism` / `@prism/*` by package
      specifier, uses mock providers and fake credentials, and contains a
      `demo()`/`main()` self-check that is the smallest thing that fails if the
      API shape breaks.
    - Security: no real credentials, no network calls, no `process.env` reads of
      real keys; OAuth examples use mocked callbacks.
  - Approach:
    - Documentation Reviewed:
      - `tsconfig.json` (core, `include: ["src"]`) and `tsconfig.packages.json`
        to decide how examples compile without polluting `dist/`.
      - `src/index.ts` and `packages/*/src/index.ts` for exact export names per
        example.
      - Ponytail self-check rule (one runnable `demo()`/`__main__` check, no
        framework).
      - `package.json` `files` whitelist and `packaging.test.ts` so examples are
        excluded from tarballs.
    - Options Considered:
      - Compile examples as part of the main `tsc` build into `dist/`: rejected
        — pollutes the published output and needs `files` exclusions.
      - A separate `examples/tsconfig.json` with `noEmit` and a dedicated
        `typecheck:examples` script wired into `npm run typecheck`: chosen —
        examples are checked but never emitted, and packaging is unaffected.
      - Extract code fences from `/docs` and compile them: rejected — fragile
        parsing; dedicated example files are clearer and directly runnable.
    - Chosen Approach:
      - Add `examples/tsconfig.json` (`noEmit`, `strict`, `module NodeNext`,
        referencing the workspace `prism` and `@prism/*` packages).
      - Add each example file from the task-1 list; each ends with a `demo()`
        self-check runnable via `node` against compiled output or guarded so it
        typechecks cleanly when imported.
      - Wire `npm run typecheck` to also run the examples typecheck (one
        additional `tsc -p examples` step).
      - Keep `examples/` out of `dist/` and out of the published `files`
        whitelist; add a `packaging.test.ts` assertion that no tarball includes
        `examples/` source.
    - API Notes and Examples:
      ```bash
      # examples typecheck wiring
      npm run typecheck   # now also: tsc -p examples --noEmit
      ```
      ```ts
      // examples/sdk-basics.ts (shape)
      import { createAgent, createAgentSession, createMockProvider } from "prism";
      export async function demo() {
        const agent = createAgent({ provider: createMockProvider([{ type: "text", text: "hi" }, { type: "done" }]) });
        const session = createAgentSession({ agent });
        // smallest assertion that fails if the API shape breaks
      }
      ```
    - Files to Create/Edit:
      - `examples/tsconfig.json`: noEmit typecheck config.
      - `examples/<topic>.ts`: one per task-1 inventory item.
      - `package.json`: extend `typecheck` script to include `examples`.
      - `src/__tests__/docs.test.ts`: assert each listed example file exists.
      - `src/__tests__/packaging.test.ts`: assert no tarball ships `examples/`.
    - References:
      - `tsconfig.json`; `tsconfig.packages.json`; `src/index.ts`;
        `packages/*/src/index.ts`; `plans/009`–`017` for the APIs each example
        exercises.
  - Test Cases to Write:
    - `docs.test.ts`: existence check for every example file in the inventory.
    - `packaging.test.ts`: `examples/` source excluded from every tarball.
    - The `npm run typecheck` step itself is the compile-correctness check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; examples document existing
      ones.
    - Docs pages to create/edit: `docs/index.md` examples entry (with task 4).
    - `docs/index.md` update: yes — Testing/examples group links `examples/`.
    - Documentation structure reference: `prism-wiki.md` for snippet style.

- [x] 6. Add end-to-end mock demos for packages, compaction, recall, CLI, RPC
  - Acceptance Criteria:
    - Functional: runnable demos exist for the 5 provider packages (mock `fetch`/
      OAuth callbacks), LLM compaction (mock summarization provider),
      observational-memory recall, CLI print/json, and RPC; each demo runs to
      completion with no network and no real credentials.
    - Performance: each demo runs in well under the per-test budget; the full
      suite stays under the 30s offline budget.
    - Code Quality: demos reuse the typed examples from task 5 (a demo is an
      example with a runnable `main()`), avoiding duplicate code.
    - Security: demos use fake keys and mocked OAuth/network; assert no secret
      appears in emitted events.
  - Approach:
    - Documentation Reviewed:
      - Existing mocked tests: `src/__tests__/openai-compatible.test.ts`,
        `packages/provider-*/src/__tests__/*.test.ts`, RPC/CLI tests.
      - `createMockProvider` and provider-conformance helpers in
        `src/testing/provider-conformance.ts`.
      - `plans/016` (LLM compaction) and `plans/017` (observational memory) for
        the demo entry points.
    - Options Considered:
      - Separate `demos/` tree: rejected — duplicates the example code.
      - Promote selected task-5 examples to runnable demos with a tiny runner:
        chosen — one source of truth, demos are examples that actually execute.
    - Chosen Approach:
      - For each demo topic, ensure the corresponding example has an executable
        `main()` guarded by an `if`/export so `node` can run it after compile.
      - Add a `node:test` case that spawns/imports each demo with mocked
        `fetch`/OAuth and asserts it completes and emits no secret.
      - Document how to run a demo by hand in `examples/README.md`.
    - API Notes and Examples:
      ```bash
      # run a demo by hand (after build)
      node --input-type=module -e "import('./examples/rpc.ts').then(m=>m.main())" # or compiled path
      ```
    - Files to Create/Edit:
      - `examples/provider-registration.ts` (+ per-provider demo paths as needed):
        add runnable `main()`.
      - `examples/compaction.ts`: runnable LLM-compaction demo.
      - `examples/observational-memory-recall-status-view.ts`: runnable recall demo.
      - `examples/cli.ts`, `examples/rpc.ts`: runnable CLI/RPC demos.
      - `examples/README.md`: how to run demos.
      - `src/__tests__/docs.test.ts` (or a new `examples-demos.test.ts`): assert
        demos run and emit no secret.
    - References:
      - `src/testing/provider-conformance.ts`; `packages/provider-*/src/__tests__`;
        `plans/016`, `017`.
  - Test Cases to Write:
    - Demo test: each demo runs to completion under mocked `fetch`/OAuth.
    - Demo test: scanned emitted events contain no real-looking secret.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — demos exercise existing APIs.
    - Docs pages to create/edit: `examples/README.md` (how to run).
    - `docs/index.md` update: no (covered by task 5 examples entry).
    - Documentation structure reference: `prism-wiki.md` for snippet style.

- [x] 7. Add golden JSONL session fixtures and fixture-consuming tests
  - Acceptance Criteria:
    - Functional: `examples/fixtures/*.jsonl` covers branching, default
      compaction, LLM summary, observational-memory ledger, corrupt-entry
      quarantine, and tool-result replay; tests load each fixture through the
      real JSONL store/loader and assert the expected parse/reject behavior.
    - Performance: fixtures are tiny; load tests run in milliseconds.
    - Code Quality: fixtures are deterministic and machine-generated/validated
      against the real `SessionEntry` shapes from `src/`; corrupt fixtures encode
      the exact malformations the store is documented to reject.
    - Security: fixtures contain no real-looking secrets (no `sk-…`); redacted
      placeholders only.
  - Approach:
    - Documentation Reviewed:
      - `src/node/session-store-jsonl.ts` and `src/__tests__/node-session-store-jsonl.test.ts`
        for the exact line/entry shapes and quarantine behavior.
      - `src/session-stores.ts` for `SessionEntry` kinds (message, model, label,
        custom, summary, compaction) and `parentId` branching.
      - `plans/010` (branching), `plans/011` (compaction entries), `plans/016`
        (LLM summary entries), `plans/017` (observational-memory ledger custom
        entries).
      - `docs.test.ts` secret-scanning regex to reuse for fixture scanning.
    - Options Considered:
      - Hand-write fixtures: risky — easy to drift from real shapes.
      - Generate fixtures from a one-off script using the real store APIs, then
        freeze them as golden files: chosen — guarantees shape fidelity and
        makes corruption cases explicit and intentional.
    - Chosen Approach:
      - Generate the well-formed fixtures via the real store APIs (kept as a
        scratch script or as a `demo()`), commit the output as golden `.jsonl`.
      - Hand-craft only the corrupt fixture(s) to encode each documented reject
        path (bad `message`/`summary`/`parentId`/`model`/custom `data` shape).
      - Add a `node:test` suite that loads each fixture through the JSONL store,
        asserts rebuild/branch/summary/ledger results for the good ones, and
        asserts fail-closed errors for the corrupt one.
      - Reuse the `docs.test.ts` secret regex to scan fixtures for real-looking
        keys.
    - API Notes and Examples:
      ```ts
      // fixture test shape
      const store = createJsonlSessionStore({ path: "examples/fixtures/branching.jsonl" });
      const entries = await store.list(/* root */);
      assert.equal(entries.at(-1)?.parentId, /* expected leaf parent */);
      ```
    - Files to Create/Edit:
      - `examples/fixtures/branching.jsonl`
      - `examples/fixtures/compaction.jsonl`
      - `examples/fixtures/llm-summary.jsonl`
      - `examples/fixtures/observational-memory-ledger.jsonl`
      - `examples/fixtures/corrupt.jsonl`
      - `examples/fixtures/tool-result-replay.jsonl`
      - `src/__tests__/fixtures.test.ts`: load + assert + secret-scan.
    - References:
      - `src/node/session-store-jsonl.ts`; `src/session-stores.ts`;
        `plans/010`, `011`, `016`, `017`.
  - Test Cases to Write:
    - `fixtures.test.ts`: each good fixture loads and rebuilds to the expected
      leaf/context.
    - `fixtures.test.ts`: `corrupt.jsonl` is rejected/quarantined fail-closed.
    - `fixtures.test.ts`: no fixture file matches the real-looking-secret regex.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — fixtures exercise the documented
      JSONL store contract.
    - Docs pages to create/edit: `docs/node-jsonl-session-store.md` may add a
      one-line pointer to the fixtures (optional).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (fixtures, not API pages).

- [x] 8. Document opt-in live provider/worker smoke-test env vars
  - Acceptance Criteria:
    - Functional: a single docs section lists every opt-in env var used by live
      tests (`PRISM_LIVE_PROVIDER_TESTS=1` and the fake-safe provider-specific
      env names) and states they are not part of default verification.
    - Performance: docs-only; no runtime change.
    - Code Quality: the documented var names match the actual names read in
      `packages/provider-*/src/__tests__/live.test.ts` and worker tests.
    - Security: docs stress these are opt-in, never set by default, and use
      fake-safe names; no real keys in examples.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-*/src/__tests__/live.test.ts` for the exact env var
        names and guard expression.
      - `docs/release-and-install.md` for the offline-test-budget section to
        keep wording consistent.
      - `roadmap.md` Phase 16/18 live-test opt-in wording.
    - Options Considered:
      - A new `docs/live-tests.md` page: rejected — too much surface for an opt-in
        knob; a section inside `release-and-install.md` (or
        `provider-conformance.md`) keeps it discoverable next to the budget.
      - Put it on each provider page: rejected — duplication.
    - Chosen Approach:
      - Add an "Optional live smoke tests" section to
        `docs/release-and-install.md` listing the guard var and per-provider env
        names, stating default `npm test` never runs them.
      - Cross-link from each provider docs page's "Security and performance
        notes".
      - Add a `docs.test.ts` assertion that the section exists and names the
        guard var.
    - API Notes and Examples:
      ```bash
      # opt-in only; never part of default npm test
      PRISM_LIVE_PROVIDER_TESTS=1 OPENAI_API_KEY=fake npm test
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: add live-test env-var section.
      - `docs/providers/*.md`: cross-link from security notes.
      - `src/__tests__/docs.test.ts`: assert the section + guard var name.
    - References:
      - `packages/provider-*/src/__tests__/live.test.ts`;
        `docs/release-and-install.md`; `roadmap.md` Phase 16/18.
  - Test Cases to Write:
    - `docs.test.ts`: `release-and-install.md` documents
      `PRISM_LIVE_PROVIDER_TESTS` and states default tests are network-free.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — documents existing test opt-in.
    - Docs pages to create/edit: `docs/release-and-install.md`; provider pages
      cross-link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `prism-wiki.md`.

- [x] 9. Final verification for Phase 18
  - Acceptance Criteria:
    - Functional: every public API, extension point, event, config surface,
      manifest field, default strategy, and first-party package has a linked
      docs page (manual + test-backed spot checks); all task-1 inventory items
      are delivered; examples compile; demos run; fixtures load.
    - Performance: `npm test` stays network-free and under the 30s budget.
    - Code Quality: `npm run typecheck` (including `examples/`) passes;
      `npm run pack:dry-run` excludes `examples/` source and fixtures from every
      tarball; `docs.test.ts` green including the new provider-heading and
      examples/fixture assertions.
    - Security: secret scan across `/docs`, `examples/`, and fixtures passes; no
      real-looking keys; live-test vars remain opt-in.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 18 acceptance criteria.
      - This plan's task-1 inventory as the completion checklist.
      - `docs/release-and-install.md` budget wording.
    - Options Considered:
      - Rely on per-task tests only: rejected — Phase 18 is a cross-cutting
        catch-up; a final whole-tree verification catches drift between tasks.
    - Chosen Approach:
      - Run `npm run typecheck`, `npm test`, `npm run pack:dry-run`; manually
        walk `docs/index.md` against the roadmap bullet list; confirm the
        task-1 inventory is fully delivered; record any deviations in
        `Compromises Made`.
    - API Notes and Examples:
      ```bash
      npm run typecheck && npm test && npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `Compromises Made` / `Further Actions` sections of this plan.
    - References:
      - `roadmap.md` Phase 18; `plans/020` release/packaging guard.
  - Test Cases to Write:
    - No new tests; aggregate the checks from tasks 2–8.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

## Compromises Made
- Verified after all tasks (2–8) completed and tests pass. Final aggregated
  verification: `npm run typecheck` exit 0 (includes `examples/`); `npm test`
  exit 0 — 457 tests, 0 fail, 6 skipped (the opt-in live-test placeholders);
  wall time ~21.8s, under the 30s offline budget; `npm run pack:dry-run` exit 0
  and 0 `examples/` paths in any of the 8 tarballs (core + 5 providers + 2
  compaction packages), so examples and fixtures never ship.
- Secret scan across `docs/`, `examples/`, and fixtures: 0 matches for
  `sk-…`/`AIza…`/`ghp_…`. Live-test gate vars (`PRISM_LIVE_PROVIDER_TESTS`,
  `PRISM_LIVE_COMPACTION_TESTS`, `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS`)
  remain opt-in and are not set by default, CI, or release verification.
- Compromise: the observational-memory and LLM-compaction live tests are
  intentionally empty placeholders (fake-safe, no real provider keys read). The
  docs and tests document this honestly rather than speculating a
  `OPENAI_API_KEY=fake` example the bodies do not yet consume. A later phase
  that adds real provider-backed live checks must add the key env names to the
  `release-and-install.md` list.
- Compromise: CLI/RPC examples spawn the built `prism` bin rather than calling
  `runCli`/`runRpcServer` directly, because those entry points are not part of
  the public export surface (the CLI bin is the public adapter). This keeps the
  examples honest about the supported integration surface.
- Compromise: provider-page heading enforcement was changed from a hard-coded
  list to a glob over `docs/providers/*.md` plus a per-page real-export check;
  `docs/providers/openai-compatible.md` was removed from the hard-coded
  `apiPages` list so the single generic page and all 5 provider-specific pages
  are enforced uniformly by the same glob. No regression: all 6 pages pass all
  9 required headings.
- No deviations from the task-1 inventory: every inventory item was delivered.
  The only scope refinement during execution was folding the
  `docs/provider-packages.md` 3-heading fix into Task 4 (it is not under
  `docs/providers/*`) and adding it to the enforced `apiPages` list.

## Further Actions
- When a real provider-backed live test is added (not a placeholder), update
  the `release-and-install.md` live-test section to list the provider-specific
  key env name (e.g. `OPENAI_API_KEY`) the gated body actually reads, and add a
  `docs.test.ts` assertion that it appears. Priority: low (only when live
  checks stop being placeholders). Leave a `ponytail:` note in the live test
  body pointing back here.
- If `docs.test.ts` grows past ~35 tests, split the example/doc/fixture
  existence and secret-scan checks into a dedicated `examples-and-fixtures.test.ts`.
  Priority: low; current count is 27 and still single-purpose enough.
- If new `docs/providers/*.md` pages are added, no test change is needed — the
  glob + real-export check already enforces them. If new public API surfaces are
  added in a future phase, add the corresponding `docs/index.md` link and a
  `docs.test.ts` spot-check; the per-task `Documentation/Wiki Assessment`
  section (create-plan skill) is the trigger.
- If the examples grow beyond Network/credential-free illustrative scope,
  revisit whether the `examples/` packaging exclusion should become a
  published `@prism/examples` package instead; not needed now (YAGNI).
