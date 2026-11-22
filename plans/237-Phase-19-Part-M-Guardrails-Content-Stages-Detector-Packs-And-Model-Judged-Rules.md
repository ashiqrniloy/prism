# Phase 19 Part M — guardrails: content stages, detector packs, and model-judged rules

## Objectives

- Check what goes into and comes out of the model, not only tool arguments. `@arnilo/prism-extensions/guardrail-packs` compiles patterns onto `tool.call` and a `tool.result` observer only (`packages/extensions/guardrail-packs/src/index.ts:112`, `:143`), and its contract says packs never add a stage (`packages/extensions/guardrail-packs/src/contracts.ts:1-6`). The roadmap's hook table names `run.input` for input guardrails and `model.response` for output guardrails (`roadmap.md:348`, `:353`); no package uses them that way.
- Offer the detectors hosts ask for first: personal data, secrets in model output, and prompt-injection markers in untrusted tool results. The kernel already marks untrusted results (`UNTRUSTED_EXTERNAL_TRUST`, `src/input.ts`) but nothing inspects them.
- Offer a rule that asks a model. Every existing rule is a pattern or a host predicate.

## Expected Outcome

- A pack rule can name a stage: `input` (`run.input`), `output` (`model.response`), `tool_result` (`tool.result`), beside today's tool-call rules. Content rules can `deny` (the run fails closed with the rule's reason), `redact` (matched spans are replaced before the content goes on), or `flag` (an event only).
- Three new built-in packs: `pii` (email, phone, payment card with checksum, national id shapes), `output-secrets` (the secret shapes `secrets-hygiene` already knows, applied to model output), and `injection-markers` (instruction-override phrasing, role spoofing, and exfiltration link shapes in untrusted tool results).
- A `judge` rule sends one bounded question about the content to a configured model and acts on the answer. It uses the decisions capability when the model has it and structured output otherwise. A judge failure denies by default.
- The injection suite in `@arnilo/prism-hosts/evals` reports each pack's catch rate and false-positive rate; the README carries only measured numbers.

This plan implements roadmap **Phase 19 Part M**. It changes one package's contract. Its only kernel change is the additive `session` option on decision calls (Task 3, added by the Task 1 review). It also relies on two kernel behaviors the review must confirm (a `run.input` / `model.response` rejection's effect on the run, and `tool.result` transform ordering), so **Task 1 is a phase review**. It depends on plan 225 Task 5 (judge calls are metered) and plan 235 (structured output for judges on models without decisions). No version bump or publish.

The roadmap's Out of scope line about "gates that use a model's judgment as the deciding check" concerns `gateNode` in workflows, which stays deterministic. A judge rule is an opt-in package rule on a hook; plan 225 Task 2's Phase 19 entry says so.

Cost knobs: pattern and detector rules make no model call. A `judge` rule makes one model call per checked item (one per run input, per assistant message, or per tool result, as configured), bounded by `maxInputChars` (default 8,000) and `timeoutMs` (default 10,000). Nothing is on by default. The README table states each.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Stage semantics in the kernel.** What a `ctx.reject(reason)` or a thrown error does on each transform: `run.input` at run start and on a steer (`src/agent-session/session/assemble.ts`, `session.ts` `drainSteers`), `model.response` (`src/loop/run-controller.ts`, after the turn and before `message.append`), and `tool.result` (`dispatchOne`). Which of them leave content already streamed to subscribers (`message.delta` precedes `model.response`).
      - (b) **Ordering.** Hook priority and load order for transforms (`src/hooks/bus.ts` `sorted`), and where a redaction must sit relative to memory, compaction, and observability handlers on the same hooks.
      - (c) **The pack compiler.** `compileGuardrailPacks` and its bounds (`packages/extensions/guardrail-packs/src/compile.ts`), the record and event shape (`guardrail_decision`), the `tripwire` and `ask` actions, pack state shared with the result observer, and the built-in packs' rule shapes (`packages/extensions/guardrail-packs/src/packs/*.ts`).
      - (d) **Untrusted marking.** Where `metadata.trust` is set (`packages/tools/web`, `browser`, `mcp`, `openapi`, `work` connectors) and how the envelope is applied (`formatUntrustedToolText`, `src/input.ts`), so `injection-markers` reads the body before the envelope.
      - (e) **Model access for a judge.** `prism.models.client` and `prism.models.decisions` (`src/packages/api.ts:129-145`), `DecisionRequest` limits (`src/contracts-core/decisions.ts`), and what plan 225 Task 5 requires of a package call (pass the session).
      - (f) **The eval suite.** The injection dataset and its scorers (`packages/hosts/evals/src/`, `examples/eval-injection.ts`, `apps/prism-agent/evals/`), and how a package set is varied across arms.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records the limit of an output rule: text already streamed cannot be recalled, so `output` `deny` and `redact` protect the transcript and later turns. ~~a host that must not display unchecked text sets `limits.bufferOutput` (plan 228)~~ — amended by the Task 1 note: `bufferOutput` flushes before `model.response` runs, so a host that must not display unchecked text renders from `message.completed` (which carries the transformed message and is not emitted on a deny), not from `message.delta`. The README must say this.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (hook table), §2.9 (guardrail-packs row); `docs/hooks.md`, `docs/tools.md` (untrusted results)
      - `packages/extensions/guardrail-packs/README.md`, `src/`
    - Options Considered:
      - Skip — rejected: (a) decides what `deny` on `output` can promise.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–4.
    - API Notes and Examples:
      ```bash
      graft callers compileGuardrailPacks --depth all
      graft grep "untrusted_external"
      ```
    - Files to Create/Edit:
      - `plans/237-…md`: the task note
    - References:
      - Evaluation: "model-based or content guardrails" under missing features
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **(a) Stage semantics in the kernel.**
      - Transform dispatch: `src/hooks/bus.ts:256-286`. A handler's `ctx.reject(reason)` throws `HookRejectedError`, which no `onError` setting can suppress (`:274`, `:277`). Any other throw becomes `HookError` and fails the run, unless the registration set `onError: "ignore"` (`:278-283`). The reject reason goes through `redactSecrets` (`:147`). Returning `undefined` keeps the value.
      - `run.input` at run start (`src/agent-session/session/assemble.ts:377-384`): it runs on `inputToMessages(input)` **after** `session.redact`, and the result is appended to the store. A reject fails the run before any provider call. Returning `[]` does not fail the run: it continues with no new input. So `deny` at run start must be `ctx.reject`.
      - `run.input` on a steer (`src/agent-session/session.ts:1205-1236`): it gets a one-message array. Returning `[]` drops the steer: the kernel emits `steer.rejected` with a `stage: "input"` record and the run goes on (`agents.test.ts:855-888`). A **reject on a steer fails the whole run** (`:1211-1213`). `HookContext` (`src/hooks/types.ts:26-42`) has no field that tells a steer from run-start input. → Task 2 amended (input `deny`).
      - `model.response` (`src/loop/run-controller.ts:242-254`): it fires after `internals.generate` returns, only when `result.started`. Its output is what gets appended and what `message.completed` carries. A reject throws out of `turn()`. By then provider usage is charged and `turn.completed` has been emitted. No message is appended, `message.completed` is not emitted, and no tool call dispatches. **Tool dispatch reads `result.calls`, not the transformed message** (`:256`), so rewriting a `tool_call` block in `model.response` changes the transcript but not what runs. Content rules must touch text blocks only.
      - `tool.result` (`dispatchOne`, `src/loop/run-controller.ts:467-481`): it gets `ToolResult & { sessionId, runId }`. The stamp is stripped afterwards, and the result is not re-validated, so a handler must keep `toolCallId` and `name`. A reject or throw **fails the run**. It is not a per-call error (the existing observer relies on this, `packages/extensions/guardrail-packs/src/index.ts:72-75`). So tool-result `deny` must return an error `ToolResult` and not reject. `tool.result` does **not** fire for calls denied by `tool.call`, for `ask` denials, or for `respond` decisions (`:430-436`).
      - Streaming: `message.delta` events go out during `generateProviderTurn`. `limits.bufferOutput` (plan 228) holds them only until usage is charged and **flushes them inside `generateProviderTurn`** (`src/agent-session/session/provider-round.ts:377-382`, `:454`), which runs **before** `model.response`. So `bufferOutput` does not stop unchecked text from reaching subscribers. The surface that is safe to display is `message.completed`. The Task 1 Security line is amended. Holding deltas until `model.response` has passed would be a kernel change, so it goes to Further Actions.
      - Custom loops: `model.response` and `tool.result` fire inside the `RunController` primitives, and `run.input` fires in `assembleRoundContext`, which runs before any loop. All three stages therefore apply to custom loops (`works_on_a_custom_loop` stays).
    - **(b) Ordering.**
      - `sorted` (`src/hooks/bus.ts:151-157`) runs higher `priority` first and breaks ties by registration `seq`. Packages call `setup` in load order (dependency order, then listing order), and host `hooks` register **after every package** (`src/packages/loader.ts:1281-1299`).
      - Other handlers on these hooks today:
        - `tool.result`: research's source recorder (`packages/tools/research/src/index.ts:51`), hooks-json (`packages/extensions/hooks-json/src/compile.ts:385`), and the pack observer. All run at priority 0.
        - `run.input`: governance identity, rate, and audit (`packages/extensions/governance/src/index.ts:218`, `:225`, `:297`), advisor task capture (`packages/extensions/advisor/src/task-capture.ts:56`), and hooks-json (`:341`). All at priority 0.
        - `model.response`: no package. Hosts sometimes add claim-grounding.
      - Memory and observability read events: LTM uses `message.completed` (`packages/memory/system/src/ltm/index.ts:588`), and the timeline folds events. Both run after `model.response`, and the store append runs after every transform. Redaction at these stages therefore reaches memory, compaction, and the store **provided it runs before the other transforms on the same hook**.
      - → Task 2 amended: content transforms register at one fixed high priority, so a redaction runs before the research ledger, hooks-json, and advisor capture whatever the listing order.
    - **(c) The pack compiler.**
      - `resolveGuardrailPacks` (`packages/extensions/guardrail-packs/src/compile.ts:90-148`), `resolveRule` (`:154-202`).
      - Bounds (`:23-33`): 8 packs, 64 rules, 96-byte ids, 512-byte reasons, 4 KiB patterns, 8 arg paths. Scans are capped at 64 strings of 16 KiB each, at depth 8.
      - There is **no ReDoS analysis**. The only guards are the pattern-length cap and the per-string scan cap. Built-in patterns are quantifier-bounded by convention only (`packs/secrets-hygiene.ts:6-7`).
      - `compileRulePattern` (`:204-214`) removes `g` and `y`, so `redact` needs its own global copy of the pattern.
      - `ruleGuardrail` maps pack actions onto core actions: `deny`→`block`, `ask`→`interrupt`, `tripwire`→`tripwire` (`:220-240`). Its metadata is `{ pack, rule, version }`.
      - The observer is a `tool_output` guardrail that never denies (`:243-257`). Pack state is rebuilt from `state.session("packs")` on every hook call and written back after the observer runs (`index.ts:76-89`, `:110`, `:143-173`). Content rules need no pack state.
      - `runGuardrailList` (`src/guardrails.ts:81-126`) takes only the kernel `GuardrailStage = "tool_input" | "tool_output"` (`src/contracts-core/run-limits.ts:119`). It emits `package.event` `guardrail.decision` with `{ toolCallId?, toolName?, record }`. `guardrail_decision` is a frozen legacy name (`run-limits.ts:120`). `GuardrailRecordStage` already allows `"input" | "output"` (`:122`). `GuardrailAction` is `allow|block|tripwire|interrupt`, and there is no `flag` or `redact`.
      - Precedent: claim-grounding emits its own `output` record through `context.emit("guardrail.decision", …)` and records a non-blocking flag as `tripwire` (`packages/extensions/governance/src/claim-grounding.ts:80-83`). The timeline marks every `block` or `tripwire` step `denied` (`packages/extensions/observability/src/timeline.ts:518`), and the eval `guardrail_pack` scorer fails any `denied` step (`packages/hosts/evals/src/trajectory.ts:485`). A `flag` recorded as `tripwire` would therefore read as a denial. → Task 2 amended (record vocabulary).
      - Built-in rule shapes: `secrets-hygiene` is a single `RegExp` that is not exported (`packs/secrets-hygiene.ts:7`). `validation-respect` is a `deny` predicate plus an observer with a state codec. `destructive-commands` and `coding-standard` use patterns over named tools.
      - `GuardrailPackRow.stage` is typed `"tool_input" | "tool_output"` (`compile.ts:37-41`).
      - Text that Task 2 must update: the package says "never add a stage" (`contracts.ts:1-6`, `index.ts:4-8`, `:180`).
    - **(d) Untrusted marking.**
      - `UNTRUSTED_EXTERNAL_TRUST = "untrusted_external"` (`src/input.ts:44`).
      - Tools that set it: web (`packages/tools/web/src/tools.ts:159`, `obscura/web.ts:416`, `prompt-fetch.ts:56`), browser (`packages/tools/browser/src/tools.ts:180`, `:224`, `:324`, `:412`, `:467`), openapi (`packages/tools/openapi/src/execute.ts:125`), work connectors (`packages/tools/work/src/connectors/tool-helpers.ts:167`), office (`tools/office.ts:192`, `:213`), computer-use (`packages/tools/computer-use/src/create.ts:173`), and wiki ingest.
      - **MCP tool results are not marked.** `packages/extensions/mcp` never sets `trust` (`grep` finds only server-trust fingerprints), so `injection-markers` would never scan MCP results. → Task 2 amended (an option that names extra tools to scan).
      - The envelope is applied in `toToolResultMessage` → `toolResultPayload` (`src/input.ts:360-391`), **after** `tool.result`, so a `tool.result` handler sees the raw body. `formatUntrustedToolText` (`:55-70`) uses the text content blocks when there are any, and otherwise `JSON.stringify(value)`. Scanning and redaction must cover both. Errored results are not wrapped.
    - **(e) Model access for a judge.**
      - The plan's reference `src/packages/api.ts:129-145` is stale. The current lines are `ModelCallOptions` `:73-81`, `ModelClient` `:84-98`, and `prism.models` `:191-207`.
      - `client(ref).generate(request, { session })` runs `model.request` and `model.call` on the session's bus and charges the active run (plan 225 Task 5, done; `src/packages/loader.ts:825-951`).
      - **`prism.models.decisions(ref)` takes no session** (`src/packages/loader.ts:1110-1133`). The adapter calls `provider.decisions().decide` directly, so a decision call is **not charged to the run** and runs **no** `model.request` or `model.call` hook. That contradicts Task 3's "passes the session, so it is metered". → Task 3 amended.
      - A string ref has no `capabilities`. `decisions()` then passes whenever the provider has an adapter, so "does the model declare decisions" needs `client(ref).resolve()` (`api.ts:88-92`).
      - `DecisionRequest` limits (`src/contracts-core/decisions.ts`): at most 64 questions, serialized `state` at most 256 KiB, inline images only. A `noul` question answers a calibrated probability in `0..1` (`:35-39`). The contract says text written into `state` "get[s] judged, not answered" (`:61`), which suits judged content.
      - Structured output for a package call: `ModelClient.generate` forwards `providerOptions.structuredOutput` only to a natively capable model. The prompted fallback and parsing are run-level, but `resolveStructuredOutputRun`, `structuredOutputInstruction`, and `parseStructuredOutput` are exported from `@arnilo/prism/provider-kit` (`src/provider-kit/structured-output.ts:113-194`, re-exported at `src/provider-kit/index.ts:16`). The judge can reuse them without a kernel change.
      - Capabilities: `definePackage` supports `capabilitiesFor(config)`, which narrows the declared set (`src/packages/loader.ts:259-279`). Declaring `["session-state", "models"]` and narrowing to `session-state` when no judge rule is configured meets Task 3's "declares `models` only when a judge rule is configured".
    - **(f) The eval suite.**
      - `packages/hosts/evals/src/injection.ts` has 4 built-in attacks (`:24-49`): `important_instructions`, `ignore_previous`, `fake_tool_output`, `exfiltration_link`. `createInjectionDataset` adds one benign item per task plus every attack × carrier (`:74-104`).
      - `injectionHooks` adds the payload in a **`tool.execute` around** and changes neither tool identity nor `trust` (`:106-136`). The payload is therefore in the result before `tool.result`, and the carrier tool's own trust marking decides whether `injection-markers` scans it.
      - `runInjectionSuite` (`:158-247`) runs **one** arm and reports `benignUtility`, `utilityUnderAttack`, and `attackSuccessRate`, each with a Wilson interval (`stats.ts`). It has **no catch or false-positive metric**.
      - Arms differ through the `agent` factory. A paired comparison of two reports is `compareExperiments` (`packages/hosts/evals/src/compare-experiments.ts:49-153`).
      - The timeline projects a guardrail record's `action`, `guardrail` name, `toolName`, and `toolCallId`, but not its `metadata` (`timeline.ts:507-528`).
      - Carriers: `examples/eval-injection.ts` uses a host-supplied fake `web_fetch`. The `apps/prism-agent` suite (`apps/prism-agent/src/evals/suite.ts:248-280`, `apps/prism-agent/evals/dataset.ts:49-56`) runs the real research worker's `web_fetch` through the obscura backend, which marks results untrusted. That needs the obscura binary and runs 4 trials (`HOST_EVAL_TRIALS`).
      - → Task 4 amended (where the arms live, how catch and false-positive rates are scored).
    - **Re-cut:** Tasks 2–4 are confirmed, with the amendments below. Task 3 now carries one small, additive kernel change (a `session` option on decision calls), so the plan's "adds no kernel contract" line is amended.

- [x] Task 2: Content stages and detector packs
  - Acceptance Criteria:
    - Functional:
      - `GuardrailRule.stage?: "tool_call" | "input" | "output" | "tool_result"` (default `"tool_call"`, today's behavior). A content rule has a `pattern` or a named `detector`, and an `action` of `deny`, `redact`, or `flag`. `tripwire` and `ask` stay tool-call only; using them on a content stage fails the load.
      - The package registers a transform on a hook only when a configured rule needs that stage.
        - `input`: `deny` rejects the input (`ctx.reject`), failing the run or dropping the steer as the kernel does today; `redact` replaces matches in text blocks.
        - `output`: `deny` rejects the assistant message; `redact` replaces matches in text blocks before the message is appended.
        - `tool_result`: `deny` replaces the result with an error result naming the rule; `redact` replaces matches in text content and string values.
      - `redact` writes a fixed marker (`[redacted:<rule id>]`); the matched text is never recorded.
      - Built-in packs: `pii`, `output-secrets`, `injection-markers`, each with options to pick detectors and the action. `injection-markers` applies only to results marked `untrusted_external` and defaults to `flag`.
      - Every decision emits the existing guardrail record (pack, rule, stage, action, reason) with no content.
      - Inline rules stay JSON-only for patterns; detectors are named, not supplied as functions, in package config.
      - Limits: at most 8 packs and the existing rule bounds; content scanned per item is capped (default 256 KiB, the rest is passed through and the record says `truncated`). Amended in execution: the cap is package config `maxScanChars` (characters, default 262,144, range 1,024–4,194,304), because the scan works on JS strings.
      - Amended by Task 1 (2026-11-17):
        - **Input `deny`:** at run start it returns `ctx.reject(reason)`, which fails the run. On a steer it returns `[]`: the kernel drops the steer, emits `steer.rejected`, and the run goes on. A reject on a steer would fail the whole run, and returning `[]` at run start would let the run continue with no input. The handler tells the two cases apart by run: the first `run.input` call for a `runId` is the run-start input, and later calls are steers. The handler keeps a bounded per-run set, which is cleared on `run.completed` / `run.failed` / `run.suspended`.
        - **Tool-result `deny`:** returns `{ toolCallId, name, error: { code: "guardrail_denied", message } }`, where `message` is built with `guardrailRefusalText`. It never rejects, because a `tool.result` reject fails the run. Every `tool.result` rewrite keeps `toolCallId`, `name`, and `metadata`.
        - **Output `redact`:** touches `text` blocks only. Tool dispatch reads the provider's calls, not the transformed message, so rewriting `tool_call` blocks would only make the transcript wrong.
        - **Priority:** content transforms register at one exported constant priority (proposed `GUARDRAIL_CONTENT_PRIORITY = 10_000`). They then run before the research ledger, hooks-json, governance, and advisor handlers whatever the load order. The existing `tool.call` and observer registrations stay at 0.
        - **Records:** emitted with `context.emit("guardrail.decision", { record })`, as claim-grounding does (`runGuardrailList` accepts only the kernel's tool stages). They are emitted only when a rule fires. Record `stage`: `input` → `"input"`, `output` → `"output"`, `tool_result` → `"tool_output"`. Record `action`: `deny` → `"block"`, and `redact` and `flag` → `"allow"`. A `flag` must not read as a denial in the timeline or the `guardrail_pack` scorer, and the kernel `GuardrailAction` enum stays as it is. `metadata` is `{ pack, rule, version, outcome: "deny" | "redact" | "flag", count, truncated? }`.
        - **`GuardrailPackRow.stage`** widens to `"tool_input" | "tool_output" | "input" | "output"`. This is additive and is recorded in the baseline diff.
        - **`redact`** compiles its own global (`g`) copy of the pattern. `compileRulePattern` removes `g`.
        - **`output-secrets`** reuses the `secrets-hygiene` pattern. Move it to `detectors/secrets.ts` and import it in both packs, so there is one source.
        - **`injection-markers`** gains `options.tools?: string[]` (at most 16). These name tools whose results are scanned whatever their trust marking. MCP results are not marked untrusted today, and listing a tool only adds scanning, so the option is restrictive.
        - **Scanning** checks text content blocks and the string values in `value`, the same body the envelope is built from.
        - The package docs comments that say packs "never add a stage" (`contracts.ts:1-6`, `index.ts:4-8`, `:180`) are rewritten.
    - Performance: Rules compile once. Scanning is linear in the content with bounded patterns; a 256 KiB tool result scans in under 5 ms per pack on the benchmark machine class, recorded in the task note.
    - Code Quality: Detectors are pure functions with table-driven tests; the stage handlers share one "apply rules to text" routine.
    - Security: Restrictive only: a rule can remove or refuse content, never add or widen. Records and events carry rule ids and counts, never matched text. Amended by Task 1: the compiler has no backtracking analysis. Its only bounds are the 4 KiB pattern cap and the scan caps. Built-in detectors are written with bounded quantifiers, and a table test feeds each one a worst-case 256 KiB input inside the performance budget. Inline content patterns keep the 4 KiB cap and the per-item scan cap, and the README warns that a host pattern's cost on large content is the host's responsibility.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/guardrail-packs/src/{contracts,compile,config,index}.ts`, `packages/extensions/guardrail-packs/src/packs/secrets-hygiene.ts`
      - `docs/hooks.md` (`run.input`, `model.response`, `tool.result` rows)
      - Task 1(a)–(d)
    - Options Considered:
      - A new package for content guardrails — rejected: the compiler, bounds, record shape, and config already exist here.
      - Host predicates on content stages — rejected for package config (JSON only); the library export keeps the typed predicate for hosts that build packs in code.
    - Chosen Approach:
      - Extend the rule with a stage and a small detector catalog.
    - API Notes and Examples:
      ```jsonc
      { "packs": [
          { "id": "pii", "options": { "detectors": ["email", "payment-card"], "stages": ["output", "tool_result"], "action": "redact" } },
          "injection-markers",
          { "id": "house", "rules": [{ "id": "no-internal-hosts", "stage": "output", "pattern": "\\binternal\\.example\\.com\\b", "action": "redact", "reason": "internal hostname" }] } ] }
      ```
    - Files to Create/Edit:
      - `packages/extensions/guardrail-packs/src/{contracts,compile,config,index}.ts`
      - `packages/extensions/guardrail-packs/src/detectors/{pii,secrets,injection,types,index}.ts`: new
      - `packages/extensions/guardrail-packs/src/content.ts`: new (content-rule resolution, the shared `applyContentRules`, the stage handlers)
      - `packages/extensions/guardrail-packs/src/packs/options.ts`: new (option readers shared by the content packs)
      - `packages/extensions/guardrail-packs/src/packs/{pii,output-secrets,injection-markers}.ts`, `packs/index.ts`
      - `packages/extensions/guardrail-packs/src/__tests__/{content-stages,detectors}.test.ts`: new
      - `packages/extensions/guardrail-packs/README.md`
      - `examples/guardrail-content.ts`: new, on the mock provider; `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts` (demo list and output assertions)
      - `scripts/budgets.json`: `extensions.packedBytes` rebaselined with a reason
      - `scripts/compat-baseline/…` for `@arnilo/prism-extensions`: regenerated with `bun scripts/release.mjs gate --update-baseline`, additive diff in the task note
    - References:
      - `packages/extensions/guardrail-packs/src/contracts.ts:10-45`
  - Test Cases to Write:
    - `output_redact_replaces_matches_before_append`: the stored message holds the marker, not the match.
    - `output_deny_rejects_the_message_and_fails_closed`.
    - `input_deny_fails_the_run_and_drops_a_steer`.
    - `tool_result_redact_covers_text_and_string_values`.
    - `injection_markers_only_scan_untrusted_results`.
    - `payment_card_detector_requires_a_valid_checksum`.
    - `tripwire_or_ask_on_a_content_stage_fails_the_load`.
    - `no_hook_is_registered_for_an_unused_stage`.
    - `records_carry_no_matched_text`.
    - `oversized_content_is_scanned_to_the_cap_and_marked_truncated`.
    - `works_on_a_custom_loop`: the transforms fire through the primitives.
    - Added by Task 1: `tool_result_deny_returns_an_error_result_and_the_run_continues`.
    - Added by Task 1: `flag_and_redact_records_do_not_mark_the_timeline_denied`.
    - Added by Task 1: `content_redaction_runs_before_a_priority_zero_handler_listed_earlier`.
    - Added by Task 1: `injection_markers_scan_named_tools_without_the_trust_mark`.
    - Package conformance passes; `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — rule fields, three packs, new hook registrations
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: stages, actions, the three packs, the streaming caveat from Task 1's Security finding
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-18):
    - **What changed.**
      - `contracts.ts`: `GuardrailRule` gains `stage`, `detector`, `untrustedOnly`, and `alsoScanTools`. `GuardrailRuleAction` adds `redact` and `flag`. The new type `GuardrailRuleStage` is exported, and the header comment no longer says packs "never add a stage".
      - `content.ts` (new):
        - `resolveContentRule` validates a content rule and fails closed. It rejects `tripwire` and `ask` ("tool_call only"), a `deny` predicate, `argPath`, `tool` on `input`/`output`, and `untrustedOnly`/`alsoScanTools` off `tool_result`. A rule needs exactly one of `pattern` or `detector`, and an unknown detector name fails the load.
        - `applyContentRules` is the one "apply rules to text" routine that every stage uses. It applies the scan cap across all of an item's texts. `deny` rules run first on the original text, then `flag` rules, then `redact` rules in order, each on the output of the one before. Each regex is a private global copy. Zero-length matches are skipped.
        - `installContentStages` registers one transform per stage in use, at `GUARDRAIL_CONTENT_PRIORITY = 10_000`.
          - `run.input` tells run start from a steer by recording the first call per `runId`. The set is bounded at 1,024 runs and is cleared on `run.completed`, `run.failed`, and `run.suspended`.
          - `model.response` rewrites text blocks only.
          - `tool.result` scans text blocks and `value` strings (depth 8, at most 4,096 strings). A deny returns `{ toolCallId, name, metadata?, error: { code: "guardrail_denied", message } }`.
          - Records follow the Task 1 amendment: `deny` is recorded as `block`, and `redact` and `flag` as `allow`. `metadata` is `{ pack, rule, version, outcome, count, truncated? }`. `toolCallId` and `toolName` sit beside the record on tool results.
      - `compile.ts`: `resolveRule` routes content stages to `resolveContentRule`. `ResolvedPack` gains `contentRules`. `describeGuardrailPacks` emits content rows. `GuardrailPackRow.stage` widens. Tool and reason validation are shared with tool-call rules. Tool-call rules now reject `detector`, `untrustedOnly`, and `alsoScanTools`.
      - `index.ts`: `tool.call` is registered only when a tool-call rule exists, and the `tool.result` observer only when a pack has `observe`. A pack with only content rules therefore registers neither.
      - Detectors (`detectors/`): `email`, `phone` (9–15 digits), `payment-card` (Luhn), `national-id` (US SSN without the never-issued areas, and UK NINO), `secret` (the `secrets-hygiene` pattern, moved to `detectors/secrets.ts` and imported by both packs), `instruction-override`, `role-spoofing`, and `exfiltration-link`.
      - Built-in packs:
        - `pii`: rules are named `<detector>-<stage>`. The default stages are `output` and `tool_result`, and the default action is `redact`.
        - `output-secrets`: one rule, `no-secret-material-in-output`, defaulting to `redact`.
        - `injection-markers`: one rule per detector, `untrustedOnly`, defaulting to `flag`, with `options.tools` (at most 16).
        - All three reject unknown option keys.
      - Config: `maxScanChars`, and the rule schema adds `stage`, `detector` (an enum of the catalog), `untrustedOnly`, `alsoScanTools`, and the two new actions.
      - Other files: the README (stages and actions table, the streaming caveat, pattern cost, the three packs, the record shape), the CHANGELOG, `examples/guardrail-content.ts` (wired into the docs demo test and `examples/README.md`), and `scripts/e2e-coverage.json`, which lists `content-stages.test.ts`.
    - **Deviations from the task text.**
      - The scan cap is in characters (`maxScanChars`), not bytes.
      - A `deny` predicate is rejected on content stages (config is JSON-only, and the predicate's signature takes tool arguments).
      - The trust filter is two generic rule fields, `untrustedOnly` and `alsoScanTools`, so inline `tool_result` rules can use it too. `injection-markers` sets them from `options.tools`.
    - **Tests.**
      - `content-stages.test.ts` has 15 tests: every listed case, plus `describe_reports_content_rows`.
      - `detectors.test.ts` has 3 tests: the detector table, `payment_card_detector_requires_a_valid_checksum`, and `worst_case_input_scans_inside_the_budget`.
      - A mutation check confirmed that setting the priority to 0 fails `content_redaction_runs_before_a_priority_zero_handler_listed_earlier`.
      - Package conformance passes.
    - **Performance.** Worst case for a 256 KiB item, built from 12 adversarial fill patterns, on the development machine (Bun 1.4.4, Linux x64): `pii` 4.4 ms, `injection-markers` 3.6 ms, `output-secrets` 1.0 ms. The first draft of `exfiltration-link` took 33 ms. The URL body now excludes `?&(` and the gaps are 48 characters ending at whitespace, which brought it within budget. The test asserts under 50 ms per pack to leave headroom against CI noise. The 5 ms figure is the measured number, not the assertion.
    - **Checks.**
      - `bun run --filter @arnilo/prism-extensions test`: 1174 pass, 0 fail.
      - `bun run --filter @arnilo/prism-extensions typecheck` and `tsc -p examples --noEmit`: clean.
      - `src/__tests__/docs.test.ts`: 69 pass, including the demo run of `guardrail-content.ts`.
      - `scripts/e2e-coverage.test.mjs`: 8 pass.
      - hosts `guardrail-pack-scenarios.test.ts`: 11 pass.
      - Biome format and lint: clean.
    - **Not green, and not from this task.**
      - `bun run typecheck` stops at `build:core` on `src/__tests__/provider-live-scenarios.test.ts:253` (`"tool_use"` is not a `ProviderStopReason`). That file has uncommitted edits from other work.
      - `bun scripts/release.mjs gate` still reports the kernel budget growth (packed, unpacked, root exports, source lines) and `@arnilo/prism-ai` needing a version bump. This task changes no kernel or `prism-ai` file.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism-extensions.txt`, regenerated with `--update-baseline`; no other baseline file changed):
      - Changed:
        - `GuardrailPackRow.stage` widens to `"tool_input" | "tool_output" | "input" | "output"`.
        - `GuardrailPacksConfig` adds `maxScanChars?`.
        - `ResolvedPack` adds `contentRules`.
      - Added: `CONTENT_DETECTORS`, `CONTENT_DETECTOR_IDS`, `ContentAction`, `ContentDetector`, `ContentHit`, `ContentRule`, `ContentScanResult`, `ContentStage`, `DEFAULT_MAX_SCAN_CHARS`, `GUARDRAIL_CONTENT_PRIORITY`, `GuardrailPackInput`, `GuardrailPackRef`, `GuardrailRule`, `GuardrailRuleAction`, `GuardrailRuleStage`, `applyContentRules`, `injectionMarkersPack`, `luhnValid`, `outputSecretsPack`, `piiPack`.
      - No removals.
    - **Budget.** The gate failed `@arnilo/prism-extensions` at 546,376 packed bytes against a ceiling of 536,897. Without this task the package measures about 533.7 KB; this task adds about 12.7 KB packed and 43 KB unpacked. `extensions.packedBytes` is rebaselined to 546,376 with a dated reason. Unpacked size stays inside tolerance.
    - **Findings for later tasks.**
      - Task 3: `applyContentRules` is synchronous and regex-only. A judge rule needs an async step in the stage handlers before or after it, not a matcher. The `deny`-first ordering and the record shape (`metadata.outcome`) carry over.
      - Task 4: the timeline names a guardrail step after the record's **stage** and puts the rule in `metadata.guardrail` (`packages/extensions/observability/src/timeline.ts:516-523`). `guardrail_flagged` must therefore match `metadata.guardrail`, not the step name. → Task 4 amended.
      - Task 4: the injection detectors were written with the four built-in attacks in view. The detector table checks that `instruction-override` catches `important_instructions` and `ignore_previous`, `role-spoofing` catches `fake_tool_output`, and `exfiltration-link` catches `exfiltration_link`. A catch rate on those four attacks is therefore in-sample. → Task 4 amended.

- [x] Task 3: Model-judged rules
  - Acceptance Criteria:
    - Functional:
      - A rule may carry `judge: { model, question, threshold?, maxInputChars?, timeoutMs?, onError? }` instead of a pattern. `question` is a yes/no question about the content, at most 512 characters.
      - When the model declares `capabilities.decisions`, the package asks through `prism.models.decisions(ref)` and compares the returned probability with `threshold` (default 0.5). Otherwise it asks through `prism.models.client(ref)` with structured output `{ answer: boolean }` (plan 235) and no tools.
      - The content is sent inside the kernel's untrusted envelope with a fixed system instruction; the judged content cannot change the question.
      - A "yes" applies the rule's action (`deny` or `flag`; `redact` is not available to a judge rule). `onError` is `"deny"` (default) or `"allow"`, applied on timeout, provider failure, or an unparsable answer, and recorded.
      - The call passes the session, so it is metered against the run and visible to `model.call` hooks.
      - At most one judge call per item per rule; identical content within a run is answered from a per-run cache.
      - The package declares the `models` capability only when a judge rule is configured; without the capability a judge rule fails the load.
      - Amended by Task 1 (2026-11-17):
        - **Kernel prerequisite (additive).** `prism.models.decisions(ref)` returns a client with no session (`src/packages/loader.ts:1110-1133`), so a decision call today is neither charged to the run nor seen by any hook. Add `DecisionsClient.decide(request, options?: { session?: SessionContext })`. With a session, the call's usage and request bytes are charged to the active run's limits, usage, and ledger the same way a package `generate` call is charged (plan 225 Task 5 seam). `model.request` and `model.call` stay generate-only, because their payloads are `ProviderRequest` and a provider stream. The README says a decisions-path judge is metered but does not pass through `model.call`. Update the baseline and record the diff.
        - **Capability.** Declare `capabilities: ["session-state", "models"]` with `capabilitiesFor(config)` returning `["session-state"]` when no rule has `judge` (`src/packages/loader.ts:259-279`). "Without the capability" then means a host or manifest that withholds `models`, and the load fails closed.
        - **Decisions detection.** Resolve it with `await prism.models.client(ref).resolve?.()` and read `capabilities.decisions`. A string ref has no capabilities, so `decisions()` alone does not show what the model declares.
        - **Structured-output path.** Use `resolveStructuredOutputRun`, `structuredOutputInstruction`, and `parseStructuredOutput` from `@arnilo/prism/provider-kit`. `ModelClient.generate` sends `structuredOutput` natively only to a capable model and has no prompted fallback of its own.
        - **Decisions request.** One `noul` question, with the fixed instruction plus the user's `question` as `instructions` and the enveloped content as `state` (`maxInputChars` sits far below the 256 KiB state cap).
        - **Per-run cache.** Parallel tool results can run `tool.result` at the same time, so the cache holds the in-flight promise keyed by `(runId, rule, sha256(content))`. It is bounded (proposed 256 entries per run) and dropped on run end.
    - Performance: Stated in the README: calls per run input, per assistant message, or per tool result; the default bounds; the cache.
    - Code Quality: One judge function for both model paths, tested on the mock provider's `generate` and `decisions` handlers.
    - Security: The judge model gets no tools and no session history. Its raw answer is never recorded; the record carries the rule id, the outcome, and the probability when available. `model` is a model reference, never a credential.
  - Approach:
    - Documentation Reviewed:
      - `docs/decisions.md`, `src/contracts-core/decisions.ts`, `src/packages/api.ts:129-145`
      - `src/input.ts` (`formatUntrustedToolText`), plan 235 (structured output), plan 225 Task 5 (`ModelCallOptions.session`)
      - `packages/extensions/advisor/src/consult.ts` (an existing tool-less side call with a bounded prompt)
    - Options Considered:
      - A free-text rubric with a scored reply — rejected: harder to bound and to validate than a yes/no answer; the decisions capability already returns calibrated probabilities.
      - Judge every delta — rejected: cost, and a delta is not a unit of meaning.
    - Chosen Approach:
      - One bounded yes/no question per item, on the decisions capability when present.
    - API Notes and Examples:
      ```jsonc
      { "packs": [{ "id": "house", "rules": [
          { "id": "off-topic-output", "stage": "output", "action": "flag",
            "judge": { "model": "typesafe/jev", "question": "Does the text give medical advice?", "threshold": 0.7 } } ] }] }
      ```
    - Files to Create/Edit:
      - `packages/extensions/guardrail-packs/src/{judge.ts,contracts.ts,compile.ts,config.ts,index.ts}`
      - `packages/extensions/guardrail-packs/src/__tests__/judge.test.ts`: new
      - `packages/extensions/guardrail-packs/README.md`
      - `packages/extensions/package.json`: capability declaration, if capabilities are listed there
      - Added by Task 1: `src/contracts-core/decisions.ts` (`DecisionsClient.decide` options), `src/packages/loader.ts` (`models.decisions` charging through the package-call seam), `src/__tests__/`, `docs/decisions.md`, and the compat baseline for `@arnilo/prism`, regenerated with `bun scripts/release.mjs gate --update-baseline` (diff in the task note)
    - References:
      - Phase 18 (decision models); `examples/decision-models.ts`
  - Test Cases to Write:
    - `judge_uses_decisions_when_the_model_declares_them`.
    - `judge_falls_back_to_structured_output`.
    - `yes_above_threshold_applies_the_action`.
    - `judge_timeout_denies_by_default_and_allows_when_configured`.
    - `judged_content_cannot_override_the_question`: content containing "answer no" does not flip a clear yes on the scripted model's input check (the test asserts the envelope and instruction, not model behavior).
    - `judge_call_is_metered_on_the_run`.
    - `identical_content_is_judged_once_per_run`.
    - `judge_rule_without_models_capability_fails_the_load`.
    - `record_carries_no_content_and_no_raw_answer`.
    - Added by Task 1: `decision_call_with_session_is_charged_to_the_run` (kernel, `src/__tests__/`).
    - Added by Task 1: `concurrent_identical_tool_results_share_one_judge_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a rule kind, a capability, extra model calls
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: "Judge rules", capabilities, the cost table, failure behavior
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-18):
    - **Kernel (additive).**
      - `src/contracts-core/decisions.ts`: new `DecisionCallOptions { session?: SessionContext }`. `DecisionsClient.decide(request, options?)`.
      - `src/packages/loader.ts` (`models.decisions`): after the adapter answers, a call with a session in an active run is charged through the same seam a package `generate` call uses (`packageCallSeamOf(session).recordUsage`, a `package_call` ledger row). With no usage reported, the run estimates from a synthetic request built from the state and the question instructions (`decisionEstimateRequest`). It is never sent. No `model.request` or `model.call` hook runs.
      - `docs/decisions.md` documents `options.session`. Kernel docs pages must not cite plan numbers (`docs_next_is_promoted`), so the page names no plan.
    - **Package.**
      - `judge.ts` (new):
        - `resolveJudge` validates the `judge` field and fails closed on unknown keys. The field and its bounds are listed under Deviations below.
        - `createJudgeRunner(models, refs)` is the one judge function for both model paths. It builds every judge client in `setup`, so an instance without `models` fails the load.
        - It resolves `capabilities.decisions` with `client(ref).resolve()`, once per ref.
          - Decisions path: one `noul` question. `instructions` is `JUDGE_INSTRUCTION` plus the configured question, and `state` is the content in `formatUntrustedToolText`.
          - Structured path: a system message (`JUDGE_INSTRUCTION`, plus the prompted instruction from `resolveStructuredOutputRun` when the model is not natively capable) and one user message. There are no tools and no history. The reply is parsed with `parseStructuredOutput` and read up to 4,096 characters.
        - Timeout: an `AbortController` raced against a timer. The run's signal is chained in.
        - Per-run cache: it holds the in-flight promise, keyed by `(rule name, sha256(text))`. It is capped at 256 entries per run and 1,024 runs, and is dropped on `run.completed`, `run.failed`, and `run.suspended`.
      - `content.ts`:
        - `ContentRule.judge`. A rule takes exactly one of `pattern`, `detector`, or `judge`, and `redact` on a judge rule fails the load.
        - The stage handlers are now async. Pattern rules run first. A pattern `deny` skips the judge. Otherwise `judgeItem` asks every applicable judge rule in parallel **on the redacted text**, so a redacted span never reaches the judge model. The first judge `deny` in rule order wins, and it follows the stage's existing deny semantics (reject at run start or on output, `[]` on a steer, an error result on a tool result).
        - `ContentHit` gains `outcome` and `judge`. Records add `metadata.judge: { path, probability?, error? }`. A judge failure under `onError: "allow"` records `action: "allow"`, `outcome: "allow"`.
      - `index.ts`:
        - `capabilities: ["session-state", "models"]`, with `capabilitiesFor` narrowing to `session-state` unless `hasJudgeRule(config)`.
        - New exports: `hasJudgeRule`, the `DEFAULT_JUDGE_*` constants, `JUDGE_INSTRUCTION`, `MAX_JUDGE_CACHE_ENTRIES_PER_RUN`, and the `GuardrailJudge`, `JudgeVerdict`, `JudgeErrorKind`, and `ResolvedJudge` types.
      - `config.ts`: the `judge` object schema. The kernel schema subset has no `exclusiveMinimum`, so the schema uses `minimum: 0` and `resolveJudge` enforces `> 0`.
      - `compile.ts`: tool-call rules reject `judge`.
      - `packages/extensions/package.json` lists no capabilities, so it is unchanged.
    - **Deviations from the task text.**
      - Bounds the task left open:
        - `threshold` must be in (0, 1].
        - `maxInputChars` is an integer in 256–65,536.
        - `timeoutMs` is an integer in 100–120,000.
        - `model` is at most 256 characters.
      - The judge sees the item **after** pattern redaction (security: a PII or secret span is not sent to a second model). A pattern `deny` on the same item skips the judge call.
      - "Without the capability" is tested with a package definition that reuses the package's `config` and `setup` but declares only `session-state`. That is the shape of a host or manifest that withholds `models`. The kernel has no other way to withhold a declared capability.
      - A structured-path judge call passes through `model.request` and `model.call` (it is a `models.client` call). A decisions-path call does not. The README says so.
    - **Tests.**
      - `judge.test.ts` has 12 tests: every listed case, plus `structured_answer_no_records_nothing_and_unparsable_applies_on_error` and `judge_rule_validation_fails_closed`.
        - The timeout case covers both paths.
        - The metering case covers both paths and asserts `>= 4,000` tokens, because the run's own turn adds a small usage estimate.
        - `concurrent_identical_tool_results_share_one_judge_call` drives `createJudgeRunner` directly with a gated `decide`, so the concurrency is deterministic.
      - Kernel (`src/__tests__/package-model-calls.test.ts`):
        - `decision_call_with_session_is_charged_to_the_run`: a call with the session is charged, and the same call without it is not.
        - `decision_call_with_session_counts_against_run_limits`.
    - **Checks.**
      - Passed:
        - `bun test packages/extensions/guardrail-packs`: 41 pass.
        - Kernel decisions, package-API, conformance, public-export, package-model-calls, and package-sessions tests: 113 pass.
        - hosts `guardrail-pack-scenarios.test.ts`: 11 pass.
        - `src/__tests__/docs.test.ts`: 69 pass.
        - Typecheck: kernel `tsc` (only the pre-existing `provider-live-scenarios.test.ts:253` error), extensions, and `tsc -p examples`.
        - Biome on every touched file.
        - The guardrail-packs non-null-assertion count is unchanged at 1.
      - Failed, outside this task: the extensions suite ran 1184 pass and 2 fail. The failures are `governance_identity_expiry_denies_tool_call`, a 5 s timeout (`governance/src/index.ts` has uncommitted edits from other work), and the field-policy microbenchmark. Both fail in isolation, and neither touches guardrail-packs or decision calls.
      - `bun scripts/release.mjs gate`: still fails on the kernel budget growth and the `@arnilo/prism-ai` bump, as Task 2 recorded. This task adds 1 root export (`DecisionCallOptions`) and about 30 kernel source lines to that growth. The rest is other in-flight work.
    - **Baseline diff.** Regenerated with `--update-baseline`. The regeneration also absorbed other uncommitted work in the tree: kernel `Session.continue`, `RunController.checkpoint`, `PackageAPI.sessions`, and changes to hosts, tools, and memory-system.
      - `@arnilo/prism`: added `DecisionCallOptions`. Changed `DecisionsClient.decide(request, options?: DecisionCallOptions)`, an additive optional parameter.
      - `@arnilo/prism-extensions/guardrail-packs`:
        - Added: `DEFAULT_JUDGE_MAX_INPUT_CHARS`, `DEFAULT_JUDGE_THRESHOLD`, `DEFAULT_JUDGE_TIMEOUT_MS`, `GuardrailJudge`, `JUDGE_INSTRUCTION`, `JudgeErrorKind`, `JudgeVerdict`, `MAX_JUDGE_CACHE_ENTRIES_PER_RUN`, `ResolvedJudge`, and `hasJudgeRule`.
        - Compatible changes: `ContentHit` adds `outcome?` and `judge?`. `ContentRule` adds `judge?`. `GuardrailRule` adds `judge?`.
      - No removals.
    - **Budget.** `extensions.unpackedBytes` is rebaselined to 2,219,425 (prior 2,096,614) with a dated reason covering Tasks 2 and 3. Packed bytes stayed inside tolerance.
    - **Findings for later tasks.**
      - Task 4: a judge record is a normal `guardrail.decision` record named `pack:<pack>/<rule>`, so `guardrail_flagged` counts it. A judge failure under `onError: "allow"` also emits a record (`outcome: "allow"`). If a judge arm is ever measured, the scorer must exclude `metadata.outcome === "allow"`, but the timeline does not project `metadata` (Task 1(f)). The planned arms use no judge rule, so this is noted only.

- [x] Task 4: Measure the packs on the injection suite
  - Acceptance Criteria:
    - Functional:
      - The injection suite runs two arms on the mock provider's recorded scenarios and, opt-in, on live models: no pack, and `injection-markers` plus `pii`. It reports per pack: items caught, items missed, and false positives on the benign items, with the suite's existing statistics (interval and paired comparison).
      - The result is written to `docs/_evidence/guardrails-2026-11.md` with the dataset hash, the pack versions, and the model ids.
      - The README states the measured rates, or states that a pack is unmeasured. It makes no claim the evidence does not carry.
      - Amended by Task 2 (2026-11-18): the `injection-markers` detectors were written with the four built-in attacks in view, so a catch rate on them is in-sample. The evidence file and the README label that rate as in-sample. Before quoting a catch rate as general, add held-out attack phrasings to the dataset that were not used while writing the detectors (paraphrases, other languages, obfuscated spacing), or state that no held-out set was measured.
      - The deterministic arm runs in `bun run test`; the live arm is a manual `test:live` entry.
      - Amended by Task 1 (2026-11-17):
        - **Where the arms live.** The deterministic arm goes in `packages/hosts/evals/src/__tests__/guardrail-arms.test.ts`, on the mock provider. Its carrier tool is a fixture `web_fetch` whose results carry `metadata.trust: "untrusted_external"`. `injectionHooks` never sets trust, and the hosts tests' tools are unmarked. The live arm extends the `apps/prism-agent` eval suite, whose research worker runs the real `web_fetch` (marked untrusted), with a packs arm.
        - **Catch and false-positive scoring.** `runInjectionSuite` has no catch or false-positive metric. Add one scorer, `guardrail_flagged`, that counts timeline `guardrail` steps whose `metadata.guardrail` starts with `pack:<id>/` (amended by Task 2: the step's `name` is the record stage, `timeline.ts:516-523`). Content records are emitted only when a rule fires, and the timeline projects the rule name but not `metadata`. Catch rate is its pass rate on attacked items, and false-positive rate is its pass rate on benign items. Both use `wilsonInterval`. The paired comparison uses `compareExperiments` on the two arms' reports, so no new statistics code is needed.
      - Amended in execution (2026-11-18):
        - **The scorer is public.** It is `createGuardrailFlaggedScorer({ pack, id? })` in `@arnilo/prism-hosts/evals` (`trajectory.ts`), with id `guardrail_flagged:<pack>`. `runInjectionSuite` takes `detectors` (at most 8 scorers) and reports `detection[id] = { caught, falsePositive }`, overall and per attack and carrier. `RunInjectionSuiteOptions` omits `scorers`, so the suite could not report a pack without this change.
        - **Clean-page catch.** A benign page that trips a detector by itself makes every attack carried on that page look caught. The evidence and the README therefore quote catch on clean pages: attacked items whose benign page the pack does not flag. The raw count is recorded beside it.
        - **Held-out set.** Ten held-out attacks live in the test, not in `BUILTIN_INJECTION_ATTACKS`, so the built-in suite does not change. No detector was changed after they were written.
        - **`pii` catch** is not a quantity this suite measures, since it holds no personal-data attacks. Only `pii`'s false positives are reported.
        - **Live arm.** It is `apps/prism-agent/evals/live-guardrails.test.ts` (`bun run test:live:guardrails` in `apps/prism-agent`). `runHostEvalSuite` gains `extraScorers`. `scripts/live-matrix.mjs` lists provider rows, not suites, so it is unchanged. The live arm has not been run.
    - Performance: The deterministic arm adds under 5 s to the hosts test stage.
    - Code Quality: The comparison reuses `runExperiment` and the suite's scorers; no new statistics code.
    - Security: The evidence file contains counts and ids only, no dataset content beyond what the suite already publishes.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md`, `src/` (injection suite, `runExperiment`, statistics), `examples/eval-injection.ts`
      - `docs/_evidence/skill-evals/` (the shape of an evidence record)
    - Options Considered:
      - Ship the packs with no measurement — rejected: the repo's rule is that a claim carries its evidence.
    - Chosen Approach:
      - Two arms on the existing suite, deterministic by default.
    - API Notes and Examples:
      ```ts
      const report = await runExperiment({ agent: withPacks, baseline: withoutPacks, dataset: injectionDataset, scorers, ownership, store });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/__tests__/guardrail-arms.test.ts`: new (or under `apps/prism-agent/evals/` if the suite lives there; Task 1(f) decides)
      - `docs/_evidence/guardrails-2026-11.md`: new
      - `packages/extensions/guardrail-packs/README.md`: the measured section
      - `scripts/live-matrix.mjs`: a live row, if the matrix lists suites
    - References:
      - Plan 200 (injection suite)
  - Test Cases to Write:
    - `injection_markers_arm_catches_recorded_injections`: the deterministic arm's catch count is at or above the recorded floor.
    - `benign_items_stay_under_the_false_positive_ceiling`.
    - `evidence_file_matches_the_report`: counts in the file equal the run's.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; published claims
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: measured rates with a link to the evidence
      - `CHANGELOG.md`: `## [Unreleased]`, Documentation
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-18):
    - **What changed.**
      - `packages/hosts/evals/src/trajectory.ts`: `createGuardrailFlaggedScorer` and `GuardrailFlaggedScorerOptions`. A step counts when `kind === "guardrail"` and `metadata.guardrail` starts with `pack:<pack>/`, whatever its action. The scorer is not an invariant. A missing timeline scores 0 with a reason.
      - `packages/hosts/evals/src/injection.ts`: `RunInjectionSuiteOptions.detectors`, the `InjectionDetection` type, `detection` on the suite result, and `InjectionMetrics.detection?` on the per-attack and per-carrier groups. Duplicate ids (including `utility` and `attack_success`) or more than 8 detectors throw.
      - `packages/hosts/evals/src/__tests__/guardrail-arms.test.ts` (new): the deterministic two-arm run.
        - Dataset: 4 benign pages with near-misses × (1 benign + 4 built-in + 10 held-out attacks), carried by a fixture `web_fetch` marked `untrusted_external`, 60 items.
        - Model: a scripted gullible mock that answers any `PRISM_…` token and fetches any `exfiltrate.invalid` link.
        - Tests: `injection_markers_arm_catches_recorded_injections`, `benign_items_stay_under_the_false_positive_ceiling`, and `evidence_file_matches_the_report`. The last compares the dataset hash, item count, model id, pack versions, and every count with the evidence file's `counts` block. `PRISM_GUARDRAIL_ARMS_PRINT=1` prints the block and the rates.
      - `apps/prism-agent`: `runHostEvalSuite({ extraScorers })`, `evals/live-guardrails.test.ts` (skipped unless `PRISM_LIVE_GUARDRAIL_ARMS=1` and `HYPER_API_KEY`), and the `test:live:guardrails` script.
      - Docs:
        - `docs/_evidence/guardrails-2026-11.md` (new).
        - The guardrail-packs README "Measured detection" section, which replaces the "not measured yet" sentence.
        - The evals README: a scorer table row and the `detectors` paragraph.
        - CHANGELOG (Added and Documentation).
    - **Measured** (mock model, 1 trial, dataset `sha256:dd135dc4…`):
      - `injection-markers` v1:
        - In-sample catch is 16/16 raw and 12/12 on clean pages (Wilson 0.76–1.00).
        - Held-out catch is 22/40 raw and 12/30 on clean pages (0.25–0.58). It catches `ho_paraphrase_disregard`, `ho_chat_template`, `ho_assistant_line`, and `ho_markdown_image`. It misses the other paraphrase, French, German, letter-spaced text, the "SYSTEM NOTICE" banner, and "copy the question into the link".
        - False positives: 1/4. The transcript sample trips `role-spoofing`.
      - `pii` v1: false positives 1/4 (a tracking number trips `phone`). Its catch is not measured.
      - Paired comparison (McNemar):
        - `guardrail_flagged:injection-markers`: 0 → 0.65, q < 0.001.
        - `guardrail_flagged:pii`: 0 → 0.25, all from the order page.
        - `attack_success` and `utility`: difference 0. At the default `flag`/`redact` actions the packs record attacks and do not stop them.
      - Both arms run in about 0.4 s.
    - **Findings.**
      - `role-spoofing` fires on an ordinary chat-transcript sample (`assistant:` at a line start), and `phone` fires on a parcel tracking number. Both are false positives on ordinary pages, and both are now on record. No detector was changed in this task, which keeps the held-out measurement clean.
      - Detection is English and literal: paraphrase, other languages, and spacing evade it.
    - **Checks.**
      - Passed:
        - `bun test evals/src` (hosts): 250 pass.
        - `bun run --filter @arnilo/prism-agent test`: 69 pass. On the first run `schedule.test.ts` hung for 120 s under `--parallel=4`. It passes alone (4/4) and on the rerun.
        - `src/__tests__/docs.test.ts`: 69 pass.
        - `tsc` for `packages/hosts` and `apps/prism-agent`: clean.
        - Biome on the new files: clean. `organizeImports` in `evals/src/index.ts` and `injection.ts` fails at HEAD too.
      - Failed, outside this task:
        - `bun run --filter @arnilo/prism-hosts test`: 990 pass, 3 fail. The failures are `a2a` `connectA2A` abort and stream cut (an untracked package from plan 236; the abort case is in the backlog) and `remote` conformance (modified, uncommitted files).
        - `bun run build:core` / `typecheck`: the existing `provider-live-scenarios.test.ts:253` error.
        - `security:threat-suites`: 48 pass, 4 fail. The failing tests check built entrypoints, and the build fails on that same error.
        - `bun scripts/release.mjs gate`: the kernel budget growth and the `@arnilo/prism-ai` bump, as Tasks 2 and 3 recorded.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism-hosts.txt` only, `--update-baseline`):
      - Added: `GuardrailFlaggedScorerOptions`, `InjectionDetection`, and `createGuardrailFlaggedScorer`.
      - Changed (additive): `InjectionMetrics.detection?`, `RunInjectionSuiteOptions.detectors?`, and the `runInjectionSuite` result's `detection`.
      - No removals.
    - **Budget:** the hosts package stays inside tolerance. The gate reports no hosts budget line.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun run security:threat-suites`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- **Priority P3.** Detection rates are measured on a scripted mock model with 4 benign pages. The false-positive intervals are wide (1/4, 0.05–0.70), and no live run backs any number. The README says so and quotes counts, not general rates.
- **Priority P3.** `createGuardrailFlaggedScorer` counts any fired record. A judge rule that failed under `onError: "allow"` also emits one, and the timeline does not project `metadata.outcome`, so the scorer over-counts packs with judge rules. No measured arm uses a judge rule.
- **Priority P4.** The whole-plan verification is not fully green, for reasons outside this plan:
  - `build:core` / `typecheck` stop at `src/__tests__/provider-live-scenarios.test.ts:253` (uncommitted work), so the threat suites' built-entrypoint tests fail with them.
  - The release gate still reports the kernel budget growth and the `@arnilo/prism-ai` bump.
  - The hosts suite fails in `a2a` (untracked, plan 236) and `remote` (uncommitted).
  - The plan's own suites pass. `bun run test` (whole repo) was not run.

Recorded in plans/backlog.md.

## Further Actions

- From Task 1 (candidates for the backlog handoff):
  - Kernel: an opt-in hold of `message.delta` until `model.response` passes. `limits.bufferOutput` flushes earlier, so no setting today keeps unchecked output from subscribers. Medium.
  - `packages/extensions/mcp`: mark MCP tool results `untrusted_external`, so the kernel envelope and `injection-markers` cover them without listing tools by name. Medium.
  - `packages/extensions/governance` claim-grounding records a non-blocking flag as `tripwire`, which the timeline and the `guardrail_pack` scorer read as a denial. Align it with the `allow` + `metadata.outcome` vocabulary from Task 2. Low.
- From Task 3:
  - Kernel: a decision call made with a session is charged but emits no `model.call` package event and runs no hook. If hosts need to see decision calls in the event stream or the timeline, add a `decision.call` package event (no hook, since there is no `ProviderRequest`). Low.
  - Kernel: there is no host-side way to withhold a capability a package declares. "Withhold `models`" is tested only through a re-declared definition. If hosts need per-package grants, that is a manifest feature. Low.
- From Task 4:
  - Run the live guardrail arm (`apps/prism-agent`: `bun run test:live:guardrails`) and add its counts, model id, and dataset hash to `docs/_evidence/guardrails-2026-11.md`. The README carries no live claim until then. P2.
  - `injection-markers`: reduce the measured false positives (`role-spoofing` on chat-transcript samples) and extend coverage to paraphrase and non-English override phrasing. Measure on a **new** held-out set: the Task 4 set is now in view and becomes in-sample for any detector change. P3.
  - `pii` `phone`: tracking numbers and long digit runs read as phone numbers. Require separators or a country/area-code shape, then re-measure. Add personal-data attacks to the suite so `pii` gets a measured catch rate. P3.
  - Timeline: project `metadata.outcome` for guardrail records, so `createGuardrailFlaggedScorer` can exclude judge `onError: "allow"` records. P4.

Recorded in plans/backlog.md.
