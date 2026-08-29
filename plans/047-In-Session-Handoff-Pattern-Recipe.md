# 047 — In-Session Handoff Pattern (Recipe)

Adoption-list item #8 (LangChain multi-agent handoffs / OpenAI Agents SDK).
Roadmap phase: **0.3.x** (documentation + example first; primitive only if the example proves one needed).
Baseline: `@arnilo/prism` **0.3.0**+.

## Objectives

- Document and example the simplest multi-agent pattern — agent A transfers control of the ongoing conversation to agent B with full context, B completes or returns to A — using only existing Prism seams (`AgentDefinition`, tool dispatch, middleware, instruction injectors).
- Establish whether a reusable helper/primitive is justified (expected: no — supervisor delegation + a handoff tool composition should suffice).
- Make the pattern discoverable: hosts arriving from other SDKs search "handoff" and "swarm" and must land on a Prism answer.

## Expected Outcome

- `examples/handoff-swarm.ts`: compile-checked, runnable offline with the mock provider — a triage agent hands off to one of two specialist agents via a generated `handoff` tool; the specialist finishes the turn; the conversation transcript shows the transfer with full context.
- `docs/multi-agent-patterns.md` (or a section in an existing page): handoff vs supervisor delegation vs A2A decision table, security notes (narrowing permissions on transfer), and the example walkthrough.
- A recorded decision: helper primitive shipped or not, with evidence.

## Tasks

- [ ] Task 1 — Pattern Recipe: Handoff as Definition Swap Over Existing Seams
  - Acceptance Criteria:
    - Functional: example demonstrates triage → specialist handoff with: (1) a `handoff` tool whose args name the target agent, (2) definition swap or delegated-agent step composition using `src/agent-definitions.ts` + `src/delegated-agent-step.ts` seams, (3) context carried in the same session transcript (no new session unless the recipe chooses delegation — record choice), (4) permissions narrowed on transfer (specialist cannot re-handoff unless allowed).
    - Performance: handoff adds no runtime cost beyond a normal tool round (fixture-timed).
    - Code Quality: example compile-checked in the examples build; no `any`; follows existing example structure (`examples/minimal-host-app.ts` style).
    - Security: transfer is explicit model-initiated, host-authorized (allow-list of handoff targets — reuse tool allow/deny); specialist inherits narrowed `toolNames`; untrusted target names rejected fail-closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-definitions.ts` surface (`docs/agent-definitions.md` — `resolveAgentDefinition`, explicit activation, fail-closed capabilities).
      - `src/delegated-agent-step.ts`, `docs/supervisors.md` (delegation, narrowing-only permissions — the same discipline applies locally).
      - `docs/middleware-hooks.md`, `docs/instruction-injection.md` (context bridging without permission grants).
      - `examples/` structure + `examples/README.md`.
    - Options Considered:
      - New `handoff()` core primitive: rejected unless proven necessary — suspect a host tool + definition resolver composition is enough; Prism discipline is contracts, not patterns-as-primitives.
      - Recipe + generated handoff tool in the example: chosen — demonstrates the seam; ship a helper only if the example's boilerplate exceeds ~50 lines of unavoidable duplication.
    - Chosen Approach:
      - Example-first: implement, measure duplication, decide helper with evidence in the plan closeout.
    - API Notes and Examples:
      ```ts
      const triage = resolveAgentDefinition({
        name: "triage", model: { provider: "mock", model: "demo" },
        tools: [createHandoffTool({ targets: { billing: billingDef, support: supportDef } })],
      });
      ```
    - Files to Create/Edit:
      - `examples/handoff-swarm.ts` (new), `examples/README.md` (entry).
  - Test Cases to Write:
    - Example runs offline (mock provider) as a `node --test` smoke: transcript contains triage turn → handoff tool call → specialist answer; specialist attempt to call forbidden tool is blocked with the standard blocked reason.
    - Fail-closed: handoff to unknown target name rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API (example only; helper decision recorded).
    - Docs pages to create/edit: `docs/multi-agent-patterns.md` (new page, full API-page structure where applicable) or a section in `docs/supervisors.md`.
    - `docs/index.md` update: yes — Multi-agent and interoperability group gains "Multi-agent patterns (handoff/swarm)" entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Decision Table, Security Notes, and Docs Truth
  - Acceptance Criteria:
    - Functional: decision table written: handoff (in-session transfer) vs supervisor delegation (bounded child with allow-list) vs A2A (cross-service) — when each applies, ownership/telemetry implications of each.
    - Performance: n/a (docs).
    - Code Quality: docs pass tripwires; example link from the pattern page verified.
    - Security: notes cover: narrowing on transfer, no permission escalation through handoff, redaction of carried context, telemetry attribution (which agent produced which turn — map to existing agent-identity/delegation telemetry refs).
  - Approach:
    - Documentation Reviewed: `docs/agent-identity.md` (delegation narrowing, telemetry refs), `docs/a2a.md`, `docs/supervisors.md`.
    - Options Considered / Chosen Approach: one page, table-first.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `docs/multi-agent-patterns.md`, `docs/index.md`, `docs/supervisors.md` (cross-link).
  - Test Cases to Write: docs tripwire for the new page/index entry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass. (Known constraint up front: no shipped helper in v1 unless example duplication proves one — decision recorded at closeout.)

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.