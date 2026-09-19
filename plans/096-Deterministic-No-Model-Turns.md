# Deterministic No-Model Turns

Release: 0.9.0 (P2). Formalizes synapta's proven model-less Ask pattern: host middleware answers without a provider call, recorded with "no model was called" provenance.

## Objectives
- First-class host-middleware turn kind that completes a user turn without any provider request.
- Timeline/usage record the turn as `deterministic` with the middleware that produced it — zero cost, zero hallucination, auditable.

## Expected Outcome
- Hosts answer what the desk already knows (teaching empty states, canned flows, deterministic lookups) through the normal session API; the conversation transcript and timeline show exactly which turns saw no model.

## Tasks

- [x] Task 1: `respondWithoutModel` middleware seam — **complete (2026-09-19)**
  - Acceptance Criteria:
    - Functional: `beforeProviderTurn` on the existing middleware registry (`AgentConfig.middleware`) receives `BeforeProviderTurnPayload` (`sessionId`, `runId`, `turn`, `userText`) and returns it with `answer: DeterministicTurnAnswer { content: ContentBlock[], provenance: { middleware } }` to short-circuit the provider request for that turn; returning the payload unchanged (or `undefined`) proceeds normally. The answered turn records the assistant message and emits `deterministic_turn`; the timeline folds it to a `deterministic` step named after the middleware with `{ turn, middleware }` metadata; usage is absent (`ProviderTurnResult.usage === undefined`, no ledger row, no `provider_turn_*` events). ✅
    - Performance: Zero provider cost on answered turns — the provider adapter is never called (spy test) and no provider attempt/request bytes are charged; middleware overhead is one host call, plus `maxResponseBytes` for the answer content so host answers cannot bypass a process-safety ceiling. ✅
    - Code Quality: Hook name + payload/answer types + validation live in `src/middleware.ts`; the short-circuit is `resolveDeterministicTurn()` in `src/agent-session/session/provider-round.ts`, invoked from the turn entry point (`assemble.ts` `generate`) after turn policy/checkpoint and before provider policy/round construction, so every loop inherits it. Answer content passes the same output-guardrail call path as provider content; blocks are shape-checked (non-empty, assistant-visible kinds, text/thinking require string text). ✅
    - Security: Middleware is host code (trusted), but the answer is validated at the boundary — provenance is mandatory and bounded to an id (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`), tool-call blocks are rejected (no provider ran to authorize a call), and a malformed/empty answer throws `DeterministicTurnError` (`ERR_PRISM_DETERMINISTIC_TURN`) failing the run closed instead of falling through to the provider. Deterministic content flows through output guardrails before any message event is emitted, so a deny/tripwire blocks the turn with no partial transcript. ✅
  - Approach:
    - Documentation Reviewed:
      - `src/middleware.ts`, `docs/middleware-hooks.md`, `src/agent-session/session/provider-round.ts` (turn entry point).
    - Options Considered:
      - Host returns a fake provider adapter: rejected — provenance lies, usage path abused.
      - Dedicated turn kind at middleware seam: chosen — honest, one seam.
    - Chosen Approach: beforeProviderTurn short-circuit with mandatory provenance, as a payload transform (`answer` field) matching the existing `retry`/`compaction` middleware shape and the `Middleware<T>` type contract.
    - API Notes and Examples:
      ```ts
      import { createAgent, createMiddlewareRegistry, type BeforeProviderTurnPayload } from "@arnilo/prism";

      const middleware = createMiddlewareRegistry();
      middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", (payload, next) => {
        const text = DESK_ANSWERS.get(payload.userText);
        return text ? { ...payload, answer: { content: [{ type: "text", text }], provenance: { middleware: "desk" } } } : next(payload);
      });
      const session = createAgent({ model, provider, middleware }).createSession();
      await session.run("what can you do?"); // no provider call; transcript: user turn → deterministic assistant turn (provenance: desk)
      ```
    - Files to Create/Edit (actual):
      - `src/middleware.ts`: `beforeProviderTurn` hook name; `BeforeProviderTurnPayload`, `DeterministicTurnAnswer`, `DeterministicTurnProvenance`, `DeterministicTurnError`; `validateDeterministicTurnAnswer()`.
      - `src/contracts-protocol.ts`: `deterministic_turn` event on the `AgentEvent` union (no `usage` field).
      - `src/agent-session/session/provider-round.ts`: `resolveDeterministicTurn()` (hook call, validation, `maxResponseBytes` charge, output guardrails, `deterministic_turn` + message events).
      - `src/agent-session/session/assemble.ts`: turn-loop call site in `generate` before provider-round construction.
      - `src/index.ts`: root exports for the new types + error; `src/__tests__/public-export-contract.test.ts` frozen lists.
      - `packages/prism-core/src/governance/observability/timeline-types.ts` + `timeline.ts`: `"deterministic"` step kind and `deterministic_turn` fold.
      - `docs/middleware-hooks.md`, `docs/execution-timeline.md`, `docs/agent-events.md`; `src/__tests__/docs.test.ts` hook list.
    - References: synapta T09 model-less Ask + desk answers (zero cost, teaching empty states).
  - Test Cases to Write:
    - Answered turn: no provider adapter call (spy), assistant message present, timeline kind `deterministic`, usage absent. → `src/__tests__/deterministic-turns.test.ts` (event order incl. `deterministic_turn`, zero provider requests, `result.usage === undefined`); `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts` (`deterministic` step + provenance, no usage, `providerAttempts: 0`).
    - Undefined return: provider round proceeds identically to no-middleware fixture. → `deterministic-turns.test.ts` compares event-type sequences with/without the registry.
    - Guardrails still applied to deterministic content. → `deterministic-turns.test.ts` allow-guardrail captures the answered content.
    - Malformed answer fails closed with no provider call. → `deterministic-turns.test.ts` (`ERR_PRISM_DETERMINISTIC_TURN`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — middleware contract extension, new `deterministic_turn` agent event, `deterministic` timeline step kind, four additive root exports (frozen-export contract updated).
    - Docs pages to create/edit: `docs/middleware-hooks.md` (built-in hook list + no-model turn section and example); `docs/execution-timeline.md` (`deterministic` kind); `docs/agent-events.md` (`deterministic_turn` fields).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Replay and provenance in timeline/eval — **complete (2026-09-19)**
  - Acceptance Criteria:
    - Functional: The answering middleware id reaches the assistant message as `metadata.deterministic = { middleware }` (`ProviderTurnResult.metadata`, copied by both loops), so every session codec round-trips it (JSONL stores the entry verbatim; sqlite/postgres `stringifyJson(entry.message)`/`parseJson(row.message)`) and a transcript read back from a store still proves the turn had no model. Eval trajectories already carry the `deterministic` step with provenance (Task 1); `createDeterministicTurnScorer()` grades it — `minTurns` (default 1) deterministic steps, optional `middleware` filter, and a fail when a deterministically-answered turn also issued a provider request. `summarizeTimeline()`/`summarizeSession()` report `turns: { model, deterministic }` (model = turn steps without a deterministic child), so run summaries and cockpit cards split no-model turns from model turns. ✅
    - Performance: No extra storage — provenance rides the existing message `metadata` (no new entry/column/record), and `turns` is computed inside the summary's existing single pass over steps. ✅
    - Code Quality: Codec change is additive (no codec code touched; the parity fixture proves round-trip on both dialects); the scorer reads step kind/name/parent (provenance), never message text. ✅
    - Security: Only the validated bounded id is stored (`validateDeterministicTurnAnswer` rebuilds `{ middleware }`), never host-supplied free text; the metadata survives redaction because it is an id. ✅
  - Approach:
    - Documentation Reviewed: codec conventions; `packages/prism-core/src/governance/evals/trajectory.ts`.
    - Options Considered: n/a (completes Task 1).
    - Chosen Approach: Provenance on the assistant message (replay-exact through existing codecs) + summary turn split + a trajectory scorer; no new store schema and no new event.
    - API Notes and Examples:
      ```ts
      summary.turns; // { model: 12, deterministic: 3 }
      result.message?.metadata; // { deterministic: { middleware: "desk" } }
      await createDeterministicTurnScorer({ middleware: "desk" }).score({ result, timeline }); // 1 when answered without model
      ```
    - Files to Create/Edit (actual):
      - `src/contracts-protocol.ts`: `ProviderTurnResult.metadata?` (additive).
      - `src/agent-session/session/provider-round.ts`: deterministic result carries `metadata: { deterministic: provenance }`.
      - `src/agent-loops.ts`: both loops copy `metadata` onto the assistant `Message`.
      - `packages/prism-core/src/governance/observability/summary.ts`: `turns` on `TimelineSummary` + `SessionSummary`.
      - `packages/prism-core/src/governance/evals/trajectory.ts` + `evals/index.ts`: `createDeterministicTurnScorer` + options type.
    - References: synapta governance story (no model in consumer loop).
  - Test Cases to Write:
    - Round-trip replay of a session containing a deterministic turn; summary counts correct. → `src/__tests__/deterministic-turns.test.ts` (store read-back keeps `metadata.deterministic`, `message_finished` carries it); `packages/prism-core/src/sessions/codecs/__tests__/parity.test.ts` (deterministic assistant entry round-trips on both dialects); `observability/__tests__/summary.test.ts` + `timeline.test.ts` (`turns: { model, deterministic }`, mixed and orphan cases); `evals/__tests__/trajectory.test.ts` (scorer pass/0 cases and a real `runScenario` no-model run scoring 1 with the provider control scoring 0, zero provider calls).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `ProviderTurnResult.metadata`, `TimelineSummary.turns`/`SessionSummary.turns`, new scorer export (`@arnilo/prism-core/governance/evals`).
    - Docs pages to create/edit: `docs/execution-timeline.md` (provenance on the message + turn split); `docs/observability.md` (summary shape + honest attribution guarantee); `docs/middleware-hooks.md` (persistence + scorer); `docs/agent-events.md` (`message_finished` metadata); `docs/evaluations.md` (scorer row).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

Task 1 deltas from the sketched approach:

- **Registry hook, not a new `createSession({ middleware: {...} })` option.** The hook registers on the existing `MiddlewareRegistry` (`createMiddlewareRegistry().use("beforeProviderTurn", ...)`) and rides `AgentConfig.middleware` like every other hook. A second session-level middleware map would fork ordering/error policy from the one middleware contract; `AgentSessionConfig` stays unchanged.
- **Payload transform, not a bare answer return.** Middleware sets `answer` on `BeforeProviderTurnPayload` and returns the payload (or calls `next(payload)`), matching the `retry` (`{ context, decision }`) and `compaction` (`{ context, result }`) hooks and the `Middleware<T>` type contract. Returning `undefined` still proceeds to the provider, as the AC requires.
- **Camel-case hook name.** `beforeProviderTurn` is camelCase because the plan names it that way; the pre-existing hooks are snake_case. Renaming later is a breaking change for host registrations, so it is frozen now.
- **Deterministic answers are text/media/thinking only.** Tool-call blocks are rejected: no provider ran to request a call, so a deterministic turn can never dispatch a tool. Hosts that need tools use the provider path or `toolNarrowing`.
- **Content is charged against `maxResponseBytes`.** The answer bypasses `maxProviderAttempts`/token/cost accounting (usage stays absent, and no ledger row is written), but its bytes are charged to the process-safety response axis so a host answer cannot grow the transcript past a configured ceiling.
- **Timeline provenance is event-level in Task 1.** The `deterministic_turn` event folds to a `deterministic` step and `timeline.turns` shows `providerAttempts: 0`, but the assistant `Message` in the store carries no provenance field yet and run summaries do not count deterministic vs model turns — both are Task 2 (replay/codec + eval + counts).
- **Budget gates are red in the working tree.** `scripts/budget-gate.test.mjs`: `@arnilo/prism` export surface measured 1445 vs the 1400 ceiling (pre-existing in-flight work plus this task's four additive exports), root tarball/fileCount over budget, and the non-null-assertion budget over. Not rebaselined here to avoid absorbing unrelated unreviewed exports; the four new exports were added to `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` in `src/__tests__/public-export-contract.test.ts`. The rebaseline itself is now tracked as **plan 099 Task 0 (pre-release budget rebaseline)**, with the measured deltas recorded there.

Task 2 deltas:

- **Provenance rides `Message.metadata`, not a new codec field.** `message.metadata.deterministic = { middleware }` was already inside the message JSON that every codec serializes (`stringifyJson(entry.message)` / `parseJson(row.message)`; the JSONL store validates only role + content array), so replay-exactness needed zero codec edits — only the additive `ProviderTurnResult.metadata` and the copy in the two loops. A dedicated entry/column would have forced schema migration on three dialects for one id.
- **`ProviderTurnResult.metadata` is generic, not deterministic-specific.** The field is `Readonly<Record<string, unknown>>` so future no-provider turn kinds can carry their own provenance without another contract change; today only the deterministic path sets it, and provider turns stay byte-identical (no key).
- **Turn split is derived, not stored.** `turns.model = turnSteps - deterministicSteps`, computed in the summary's existing pass. It trusts the timeline's parent links (a deterministic step under a turn step); an orphaned deterministic step counts as deterministic and cannot inflate model turns, which the summary test pins.
- **Scorer failures are invariant failures.** Both a missing deterministic turn and a provenance lie (a deterministically-answered turn that still issued a provider request) score 0 with `metadata.invariant = true`, so an evaluation threshold fails closed instead of averaging the coverage away.
- **`TimelineTurn` is unchanged.** The per-turn trace still has no `deterministic` marker; a cockpit reads the `deterministic` step or the summary split instead. Add the marker only if a renderer needs it per row.

## Further Actions

- OTel/AG-UI/ACP treatment of `deterministic_turn`: today frontends see the normal message events and no provider span/step — add an explicit mapping only if a cockpit needs to badge no-model turns. Priority P3, needs a named consumer.
- `TimelineTurn.deterministic` (per-turn middleware marker) if a cockpit needs the answered/unanswered split on the `turns` row itself rather than via steps or the summary. Priority P3.
