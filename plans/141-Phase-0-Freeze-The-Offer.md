# Phase 0 — Freeze the SDK 0.2.0 offer

## Objectives

- Write the host-facing 0.2.0 offer before more API is added, so later phases implement `roadmap.md` instead of inventing a contract.
- Point new readers at that offer from `README.md` without describing unshipped APIs as available and without replacing the released 0.12.1 story.
- Leave `/docs` API pages on the released contract.

This phase adds no editor mode, language mode, JS package, extension point, or reusable capability. No primitive-review task. `.agents/skills/project-wiki/` is absent, so no code-wiki task. No version bump, changelog entry, example file, or compat-baseline regeneration: nothing ships.

## Expected Outcome

- `PRODUCT.md` is the host offer for SDK 0.2.0. A reader can see install, shorthand-or-raw, the first `defineAgent` example, profiles versus surfaces, and the plane rules without opening a family package README. The banner still says it is not shipped. `/docs` remains the released contract.
- `README.md` has one paragraph: supported host path is the SDK, link to `PRODUCT.md`, link to `roadmap.md`. The 0.12.1 install lines, quick start, docs links, and generated package-truth block stay. Unshipped names (`agent.serve`, `local-operator`, `tools.use`) do not appear there.
- `src/__tests__/docs.test.ts` pins that freeze. `docs/agent-sdk.md` and `docs/index.md` are unchanged.
- `plans/README.md` already indexes this file. Do not add a second row.

## Tasks

- [x] Task 1: Write `PRODUCT.md` as the unshipped 0.2.0 host contract
  - Acceptance Criteria:
    - Functional: `PRODUCT.md` exists at the repo root. The first screen, before the first `##`, states that this is the target contract for SDK 0.2.0, that it is not shipped, that `@arnilo/prism-agent-sdk` 0.1.0 is assembly-only, and that `/docs` is the released contract until 0.2.0 is published.
    - Functional: A host can see, without a family README, all of the following, copied from `roadmap.md` and not extended:
      - Install line is only `bun add @arnilo/prism-agent-sdk`. `@arnilo/prism` is the runtime the SDK depends on, not a second install.
      - Shorthand or raw object. Raw wins. The SDK does not wrap a plane the host already built.
      - The first example is the `roadmap.md` host-contract snippet (`defineAgent`, `agent.session()`, `session.stream`, `agent.serve`). Label it not runnable on 0.1.0.
      - Profiles versus surfaces: `tools.use` names are profiles; `serve` / `connect` are surfaces and are not constructor fields.
      - Plane catalog below, each marked not shipped.
      - Types a host must be able to import from the SDK: `Agent`, `AgentSession`, `AgentEvent`, `AgentRunResult`, `RunOptions`, `ToolDefinition`, `SessionStore`, `AIProvider`, `PermissionPolicy`, `ExecutionPolicy`.
      - Rules: nothing heavy loads unless that plane is configured; no silent verified identity; `identity: "local-operator"` is explicit opt-in, not the default; JSON config takes credential refs, never raw keys, tokens, or header values; coding is a profile, not the shape of `defineAgent`; `createAgent` stays the runtime and still works.
    - Functional: Required headings, in order: `## What a host gets`, `## Install`, `## Shorthand or raw`, `## First example`, `## Profiles and surfaces`, `## Planes`, `## Types`, `## Rules`, `## Out of scope`, `## Versions`, `## Released contract`. No `Phase N` and no `plans/` links. This file is not a second roadmap.
    - Functional: `## Planes` freezes only these target facts:
      - `defineAgent` returns the agent. `session()`, `dispose()`, `serve()`, `connect()`, and MCP status/reconnect/close are methods or named fields on that object. No second coordinator bag. 0.1.0 `createSession()` and the `AgentSdkDefinition` bag are the released shape, not the target.
      - `identity` is required, or the string `"local-operator"`. Do not design the profile object.
      - `provider` is a shorthand id or a raw `AIProvider`. Ids, no others: `openai`, `anthropic`, `google`, `azure`, `bedrock`, `vertex`, `deepseek`, `xai`, `zai`, `alibaba`, `kimi`, `clinepass`, `commandcode`, `hyper`, `laya`, `neuralwatt`, `ollama`, `opencode-go`, `openrouter`, `typesafe`. Unknown id fails closed. `ai-sdk`, `decisions`, and `model-discovery` are not shorthand ids. One provider cache per agent; a fixed `provider` must not shadow a per-run model switch through `providerSource`.
      - `credentials` is `{ ref }`, `{ resolver }`, or the raw provider. No secret in the config object or in events. OAuth is a credential kind (token source plus refresh). The SDK does not open a browser. The host supplies the callback.
      - `agent.models()` and `agent.thinkingLevels()` are the discovery surface. Missing discovery returns an empty list, not a throw, unless the host asked to fail closed. Do not invent the element type.
      - `tools.use` profile ids: `coding`, `git`, `checks`, `ask_user`, `web`, `browser`, `office`, `computer-use`. Order stays use, exclude, replace, add. `exclude` / `replace` / `add` stay. Unknown exclude/replace names fail closed. These ids are not today's tool names (`coding_check`, `ask_user_decision`). Do not inventory tool names. `codingPreset` is the 0.1.0 helper, not the 0.2.0 host path.
      - `policy` is `{ mode: "deny" | "ask" | "edits" | "auto", roots }` or a raw `PermissionPolicy` / `ExecutionPolicy`. Hard denies stay on. The SDK does not render a prompt. No callback means `ask_user` returns guidance or the policy denies. No fake approval.
      - `skills`: roots, exclude, add, disclosure `"progressive" | "eager"`. Progressive disclosure registers `load_skill` inside the SDK. Host skills are raw objects.
      - `instructions`: string, or `{ text, agentsMd, systemMd, layers }`. Any file load needs a trust policy. No home-directory scan unless the host passes that root.
      - `hooks`: `{ file }` plus programmatic stop hooks / guardrails / middleware. `stopHooks` are config, not a host wrapper around `session.run`.
      - `commands`: host-only list, not model-visible tools. The SDK stores and dispatches them. It does not draw a slash palette.
      - `mcp.servers`: stdio, url, or raw transport. `allow` stays fail-closed. Connect failure is status, not a failed `defineAgent`. `mcp.trust(server)` runs before connect. No callback means project-declared servers stay disabled. The SDK does not write `~/.prism/trust.json`. Header values are refs. Literal secrets in JSON fail closed.
      - `store`: `"memory"` | `{ type: "jsonl" | "sqlite" | "postgres", ... }` | raw `SessionStore`. Postgres loads `pg` only when chosen. Resume, search, and title are methods the stores already have, not a second store. Checkpoint store follows the session store when the adapter already provides one. The memory store stays in-memory.
      - `memory` is off unless set. `compaction`: `false` | `"default"` | `"llm"` | raw strategy. `"llm"` loads the memory package only then and costs extra model calls. Observational memory, wiki, RAG, and fabric are the same: off by default, extra work only when set. `contextBudget` and tool-result fold stay explicit. No silent fold because a coding profile was selected.
      - `web.backend`: `"brave" | "exa" | "firecrawl" | "obscura" | "off"`. Missing binary or key omits the tools and reports a setup note. It does not fail the agent. `office` and `computer-use` pass through to the existing packages. Browser and computer-use stay opt-in and fail closed on missing permission. Naming `"office"` is the only way Office parsers load.
      - `agent.serve({ protocol: "acp" | "mcp" | "ag-ui" })` and `agent.connect({ channel: "telegram" | "signal" })` are explicit. `defineAgent` does not open a socket. Approval callbacks are the policy callbacks, not a second engine.
      - Governance is a raw policy engine, OPA evaluator, model router, or an existing preset. No new policy language. Observability is off, or a host exporter. The SDK does not phone home. Workflows and enterprise Postgres load only when set. Evals are host-invoked, not a background job. Do not pick between `agent.evaluate` and a re-exported runner.
    - Functional: `## Out of scope` states: no harness, event-model, tool-dispatch, or redaction rewrite; no god config and no barrel of every family symbol; no TUI in the SDK; no hard dependency on `pg`, Playwright, Office parsers, or NATS; no unpublish; no new agent capabilities. `agent.inspect()` is not part of this offer.
    - Functional: `## Versions` states SDK 0.2.0 once, after the session-through-governance planes; family packages stay 0.12.1 unless a later phase proves a seam, in which case 0.13.0 is that seam only; Prism Code 0.5.0 is the lab, not the embed API. `## Released contract` points at `docs/agent-sdk.md` and `docs/index.md` and does not duplicate them.
    - Functional: Every shorthand provider id is an export of `packages/prism-providers/package.json`. If one is missing, stop. Do not add or drop an id.
    - Performance: One markdown file. No generated site, no new dependency, no example added to the compile-checked `examples/` set. The target snippet must not be copied into `examples/` — it does not typecheck against 0.1.0.
    - Code Quality: Host prose. No phase numbers, no task list, no family install tour. Do not hand-edit generated package-truth blocks. Do not edit package manifests, changelogs, or `/docs`.
    - Security: Examples use credential refs only. No raw key, token, header value, or `sk-` literal. State fail-closed identity, no silent verified identity, no `~/.prism/trust.json` write, and no browser opened by the SDK.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` (2026-09-30): Direction, Host contract, Out of scope, Phase 0, and the SDK API bullets of Phases 1–9. That file is the contract source. Phase 10's `inspect` is lab work, not this offer.
      - `README.md`: released install story and `<!-- generated:package-truth:inventory -->` block. Do not copy that story into `PRODUCT.md` as if it were 0.2.0.
      - `docs/agent-sdk.md`, `packages/agent-sdk/README.md`, `packages/agent-sdk/src/index.ts`, `packages/agent-sdk/src/define-agent.ts`, `packages/agent-sdk/src/presets.ts`: 0.1.0 shape (`createSession`, `AgentSdkDefinition`, required `provider` or `providerSource`, optional `AgentIdentity`, `codingPreset` / `barePreset`, peers on `@arnilo/prism`, `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, `@arnilo/prism-mcp`).
      - `packages/prism-providers/package.json` `exports`: shorthand ids match the roadmap union. `./ai-sdk`, `./decisions`, `./model-discovery` are not shorthand ids.
      - `docs/agent-identity.md` and `src/identity.ts`: released identity is a verified `AgentIdentity` from a host `IdentityVerifier`, not a string profile. Do not design `"local-operator"` here.
      - `packages/prism-coding-tools/src/agent/checks.ts`, `packages/prism-coding-tools/src/agent/ask-user-decision.ts`: shipped tool names are `coding_check` and `ask_user_decision`. Profile ids stay the roadmap strings.
      - `.agents/skills/create-plan/references/prism-wiki.md`: `/docs` documents the released contract. This phase must not put the target offer there.
      - `src/__tests__/docs.test.ts`: local-link, bare-specifier, and package-count guards. `PRODUCT.md` is not in the global markdown scan; Task 3 pins its links.
    - Options Considered:
      - Rewrite `docs/agent-sdk.md` now. Rejected: Phase 0 forbids `/docs` API edits, and the wiki rule says `/docs` is the released contract.
      - Leave the offer only in `roadmap.md`. Rejected: the phase is done when a host can read `PRODUCT.md`.
      - Generate `PRODUCT.md` by copying phase headings. Rejected: that makes a second roadmap. Freeze the resulting API, not the phase list.
      - Design the 0.1.0-to-0.2.0 TypeScript types in this file. Rejected: Phase 1 owns the seam check. This file names the offer and stops.
    - Chosen Approach:
      - Hand-write the host contract from `roadmap.md`. Name 0.1.0 only where a reader would otherwise copy `createSession`, `codingPreset`, or a family install line.
    - API Notes and Examples:
      ```ts
      // Target shape. Not shipped. Not runnable on @arnilo/prism-agent-sdk 0.1.0.
      const agent = await defineAgent({
        model: { provider: "anthropic", model: "claude-sonnet-4-5" },
        credentials: { ref: "ANTHROPIC_API_KEY" },
        identity, // required, or identity: "local-operator"
        tools: { use: ["coding"], exclude: ["shell"], add: [myTool] },
        store: { type: "sqlite", path },
        memory: { compaction: "llm" },
        mcp: { servers },
      });
      const session = agent.session();
      for await (const event of session.stream(prompt)) { /* host UI */ }
      await agent.serve({ protocol: "acp" });
      ```
      ```ts
      // Released 0.1.0 shape. Stays in docs/agent-sdk.md. Do not present it as 0.2.0.
      const app = await defineAgent({ model, provider, tools: { planes } });
      const session = app.createSession();
      ```
    - Files to Create/Edit:
      - `PRODUCT.md`: create the offer. No other file in this task.
    - References:
      - `roadmap.md` Host contract and Phase 0
      - `packages/agent-sdk/src/define-agent.ts` (`AgentSdkDefinition.createSession`)
      - `packages/prism-providers/package.json` `exports`
  - Test Cases to Write:
    - Covered by Task 3. This task does not add the test yet, so Task 1 can land as the document alone. Do not add `examples/agent-sdk-*.ts`.
  - Notes (executed 2026-09-30):
    - `PRODUCT.md` written. Provider shorthand ids match `packages/prism-providers/package.json` exports (missing: none). Not-shorthand exports are `ai-sdk`, `decisions`, `model-discovery`.
    - Phrase, heading, link, and secret check passed in a one-off node read. No `/docs` edit, no example file, no manifest change. Task 3 still owns the docs test pin.
    - Included the roadmap factory line `sdk.provider("openai", opts)` under Shorthand or raw so a later plane does not invent a second factory. Not a new plane.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. The file describes an unshipped target. No export, event, config field, or protocol changes.
    - Docs pages to create/edit:
      - `none`: Phase 0 forbids `/docs` API edits. `PRODUCT.md` is the labeled target, not a docs page.
    - `docs/index.md` update: no. No released behavior delta, and `PRODUCT.md` is outside `/docs`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2: Point `README.md` at the offer without retiring 0.12.1
  - Acceptance Criteria:
    - Functional: After the opening paragraph (the one ending `Prism defines contracts, not apps.`) and before `## Current scope`, one paragraph says the supported host path is `@arnilo/prism-agent-sdk`, links `[PRODUCT.md](PRODUCT.md)` and `[roadmap.md](roadmap.md)`, and says that API is not shipped. It points at the 0.12.1 install lines and docs below as what works today.
    - Functional: Unshipped names do not appear in `README.md`: `agent.serve`, `local-operator`, `tools.use`, `agent.session()`. The quick start still imports from `@arnilo/prism`. The sentence `Install the package that owns each capability` stays. `prism init` stays.
    - Functional: The `<!-- generated:package-truth:inventory begin -->` block is byte-identical. No other section is rewritten.
    - Performance: One paragraph. No new page generation, no extra install step, no new command in the scripts table.
    - Code Quality: Relative links resolve from the repo root. No bare `prism` import specifier, no `@prism/` specifier, no hand-copied package count outside the generated block. Do not edit `docs/`, package READMEs, or changelogs. Phase 9 owns the SDK-only README cutover.
    - Security: The paragraph names no secret, token, header, or env value. It must not tell the reader to paste a key.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 0 repo bullets and Phase 9 publish bullets. Phase 9 removes the family install story. This task must not.
      - `README.md` lines 1–8 (insertion point) and the generated inventory markers.
      - `src/__tests__/docs.test.ts`: `README.md` must keep `prism init`; local links must exist; no bare `prism` specifier; no package-count phrase outside generated blocks; retired package names stay out of current lines.
    - Options Considered:
      - Replace the install section with SDK-only instructions. Rejected: that is the Phase 9 publish cutover, and it would describe an unshipped install as available.
      - Put the pointer only under `## Docs`. Rejected: Phase 0 asks for a host-path paragraph a new reader sees before the 0.12.1 scope list.
      - Link `docs/agent-sdk.md` as the 0.2.0 page. Rejected: that page is the 0.1.0 assembly contract.
    - Chosen Approach:
      - Insert the paragraph below. Do not paraphrase extra APIs into it.
    - API Notes and Examples:
      ```markdown
      The supported host path is `@arnilo/prism-agent-sdk`. [PRODUCT.md](PRODUCT.md) is the target contract for SDK 0.2.0. That API is not shipped. Until it is, use the 0.12.1 install lines and [docs/index.md](docs/index.md) below. Cut order is [roadmap.md](roadmap.md).
      ```
    - Files to Create/Edit:
      - `README.md`: insert that paragraph only. Depends on Task 1, because the local-link test requires `PRODUCT.md`.
    - References:
      - `roadmap.md` Phase 0 and Phase 9 publish
      - `src/__tests__/docs.test.ts` README link and count guards
  - Test Cases to Write:
    - Covered by Task 3.
  - Notes (executed 2026-09-30):
    - Inserted the single paragraph from the plan verbatim after the opening paragraph and before `## Current scope`.
    - `git diff README.md` shows only that paragraph. Generated inventory block untouched. `bun test --timeout=0 src/__tests__/docs.test.ts` passes (159 pass, 0 fail).
    - One-off phrase check confirms `(PRODUCT.md)`, `(roadmap.md)`, `not shipped`, and `@arnilo/prism-agent-sdk` present; `agent.serve`, `local-operator`, `tools.use`, `agent.session()` absent.
    - Working tree also carries a pre-existing `roadmap.md` diff from before this plan. Not touched by this task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. Pointer only. Released quick start unchanged.
    - Docs pages to create/edit:
      - `none`: no `/docs` change.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3: Pin the freeze in `src/__tests__/docs.test.ts`
  - Acceptance Criteria:
    - Functional: One new `it` in `src/__tests__/docs.test.ts` fails if `PRODUCT.md` is missing a required heading, the banner phrases (`SDK 0.2.0`, `not shipped`, `@arnilo/prism-agent-sdk`, `bun add @arnilo/prism-agent-sdk`), the shorthand-or-raw rule, `defineAgent`, `agent.session()`, `session.stream`, `agent.dispose`, `agent.serve`, `agent.connect`, `identity: "local-operator"`, `tools.use`, each profile id, `protocol: "acp"`, `channel: "telegram"`, `credentials: { ref:`, each shorthand provider id, or the type names listed in Task 1.
    - Functional: The same test fails if `PRODUCT.md` matches `Phase \d`, contains `plans/`, contains `sk-`, or contains a `bun add @arnilo/prism` line other than `bun add @arnilo/prism-agent-sdk`. It fails unless `ai-sdk`, `decisions`, and `model-discovery` are named as not shorthand ids. It resolves every local markdown link in `PRODUCT.md`.
    - Functional: A second `it` fails unless `README.md` contains `(PRODUCT.md)`, `(roadmap.md)`, `not shipped`, and `@arnilo/prism-agent-sdk`, and still contains `from "@arnilo/prism"`, `Install the package that owns each capability`, and `prism init`. It fails if `README.md` contains `agent.serve`, `local-operator`, `tools.use`, or `agent.session()`.
    - Functional: A third `it` fails if `docs/agent-sdk.md` contains `local-operator`, `agent.serve`, or `tools.use`; if `docs/index.md` loses `every plane optional or replaceable`; or if `docs/index.md` mentions `PRODUCT.md`.
    - Performance: Synchronous reads inside the existing docs test file. No new test script, no spawn, no network.
    - Code Quality: Extend `src/__tests__/docs.test.ts`. Do not add a test runner, fixture library, or second suite. Assertion messages name the missing phrase.
    - Security: The pin rejects an `sk-` literal in `PRODUCT.md`. It does not embed a real secret in the test source.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts` around the plans-index test and the README phrase tests (`prism init`, generated-block count guard). Follow that `readFileSync` + `assert.ok` style.
      - `roadmap.md` Phase 0 done line: banner still says not shipped; host can see the shape without a family README.
    - Options Considered:
      - A new `scripts/phase141-*.test.mjs` plus `package.json` wiring. Rejected: one docs pin does not need a suite.
      - No test, review by eye. Rejected: the offer is the contract later phases will drift. One file-read pin is the check.
      - Snapshot the whole of `PRODUCT.md`. Rejected: wording edits that keep the contract would fail. Pin headings and required phrases.
    - Chosen Approach:
      - Three `it` blocks in the existing docs test, phrased as above. Run that file only.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/docs.test.ts
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: add the three tests. No production file.
    - References:
      - `src/__tests__/docs.test.ts` plans-index test (`plans/README.md` must include this plan filename; already true)
      - Task 1 and Task 2 acceptance phrases
  - Test Cases to Write:
    - `phase 0 offer freeze`: `PRODUCT.md` headings, banner, contract phrases, provider ids, no phase list, no secret literal, no family install line, local links resolve.
    - `phase 0 README pointer`: SDK path and roadmap link exist; 0.12.1 quick start remains; unshipped names absent.
    - `phase 0 leaves released API pages`: `docs/agent-sdk.md` and `docs/index.md` do not absorb the target offer.
  - Notes (executed 2026-09-30):
    - Added the three `it` blocks at the end of the `describe("docs")` block. `bun test --timeout=0 src/__tests__/docs.test.ts` passes (162 pass, 0 fail; the three new tests included).
    - Mutation check: changing `identity: "local-operator"` in `PRODUCT.md` to `identity: "nobody"` fails `phase 0 offer freeze`; restoring the file passes again. The pin bites.
    - `bun run build:core` (root `tsc`) passes with the new code.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no. Test pin only.
    - Docs pages to create/edit:
      - `none`
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

- Offer freeze is prose-pinned, not type-checked
  - Priority: P3
  - Compromise: `PRODUCT.md` freezes the 0.2.0 host offer as prose, and Task 3 pins it with `includes` and heading-order assertions instead of a typed `.d.ts` seam or generated schema.
  - Implications: A wording-only edit that keeps the contract fails the pin and costs a test edit; a semantic change that keeps the exact strings is not caught. Phase 1 still owns the TypeScript seam check.
- Provider, profile, and type id lists are hand-maintained in two places
  - Priority: P4
  - Compromise: The 20 provider shorthand ids, 8 profile ids, and 10 type names are hardcoded in both `PRODUCT.md` and `src/__tests__/docs.test.ts`; the pin only guards removals from the prose, not additions to `packages/prism-providers` exports.
  - Implications: Adding an adapter requires manual edits in three places (`roadmap.md`, `PRODUCT.md`, the pin). A new export advertised nowhere stays invisible to the test.
- Recorded in plans/backlog.md.

## Further Actions

- Fold `PRODUCT.md` into the shipped-doc guards when 0.2.0 ships
  - Priority: P3
  - What: Drop the not-shipped banner, retire the README `not shipped` pin, and add `PRODUCT.md` to the global "all shipped markdown links resolve locally" scan.
  - Why: Phase 0 marked the offer unshipped on purpose. When the later phases ship 0.2.0 the label becomes wrong, and the Task 3 link check duplicates the global scan.
- Compile-check the target example once the seam exists
  - Priority: P3
  - What: Move the `defineAgent` target snippet from `PRODUCT.md` into `examples/` and add it to the compile-checked set when `defineAgent` reaches the 0.2.0 shape.
  - Why: Task 1 could not add it (`examples/` is compile-checked and the snippet does not typecheck against 0.1.0), so the offered snippet is reviewed by eye only.
- Recorded in plans/backlog.md.
