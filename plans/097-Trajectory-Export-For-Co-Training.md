# Trajectory Export for Co-Training

Release: 0.10.0 (deferred from 0.9.0, P2). Freezes an export format over the existing eval trace curation (R07) suitable for rejection-sampled fine-tuning of harness trajectories. Deferred at the 0.9.0 cut (099 Task 4) so the versioned on-disk contract gets its own reviewed implementation rather than shipping unstarted against a publish deadline; folds into the 0.10.0 line (105).

## Objectives
- One documented, versioned export format: curated session trajectories → training-ready JSONL (messages, tool calls/results, outcomes, redaction state).
- Export is deterministic and content-addressed so hosts can diff datasets across harness versions.

## Objectives (non-goals)
- Prism does not train anything — export only. Muse-style co-training stays host/model-side.

## Expected Outcome
- `host.exportTrajectories({ dataset, filter })` produces a stable JSONL dataset hosts can hand to a fine-tune pipeline; synapta/clay eval runs become training data with provenance.

## Tasks

- [ ] Task 1: Export format + writer
  - Acceptance Criteria:
    - Functional: Export JSONL over curated eval runs: per-example `{ schema: "prism.trajectory/v1", messages, toolCalls: [{ id, name, argsRedacted, resultRedacted }], outcome, scores, provenance: { sessionId, runId, model, harness } }`; deterministic field order; dataset file content-addressed (sha256 of canonical bytes).
    - Performance: Streams examples (no full-corpus memory); 10k-trajectory export < 30s.
    - Code Quality: Format versioned, additive-only evolution rule documented; writer reuses `packages/prism-core/src/governance/evals/curate.ts` selection.
    - Security: Default exports redacted content only — full-content export requires explicit `includeRaw: true` with a logged justification flag; secrets matcher runs as final gate; provenance carries redaction state.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-core/src/governance/evals/curate.ts`, `dataset.ts`, `trajectory.ts`, `docs/evaluations.md`.
    - Options Considered:
      - Hosts assemble from raw session dumps: rejected — no redaction discipline, no stable format.
      - Export as sidecar of eval datasets: chosen — curation (rejection sampling by score) already exists.
    - Chosen Approach: Writer over curated datasets, canonical serialization, content addressing.
    - API Notes and Examples:
      ```ts
      const ds = await host.exportTrajectories({ dataset: "clay-build-v3", minScore: 0.8 });
      // ds.path, ds.sha256, ds.count
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/evals/export.ts`: writer; export in evals index + host API.
      - `docs/evaluations.md`: format page section.
    - References: Muse co-training (harness trajectories as training signal); R07 curation.
  - Test Cases to Write:
    - Determinism: two exports of same selection → identical sha256.
    - Redaction: secret-shaped content never appears even with `includeRaw` unset paths; raw path logs flag.
    - Schema stability: v1 examples parse against the documented schema (fixture).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new export API + format.
    - Docs pages to create/edit: `docs/evaluations.md` (trajectory export section with format table).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: Filter/split helpers + example
  - Acceptance Criteria:
    - Functional: Filters by score threshold, scenario id, model, date; deterministic train/holdout split (seeded); example `examples/trajectory-export.ts` runs against fixture sessions.
    - Performance: Split is a single pass.
    - Code Quality: Pure functions; seeded RNG documented.
    - Security: Same redaction gates as Task 1.
  - Approach:
    - Documentation Reviewed: eval dataset conventions.
    - Options Considered: none simpler.
    - Chosen Approach: Predicate filters + seeded split.
    - API Notes and Examples:
      ```ts
      const { train, holdout } = splitTrajectories(examples, { holdout: 0.1, seed: 7 });
      ```
    - Files to Create/Edit: `packages/prism-core/src/governance/evals/export.ts` (filters/split); example file.
    - References: rejection-sampling fine-tune practice.
  - Test Cases to Write:
    - Split determinism with seed; filter composition; example runs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — helper exports.
    - Docs pages to create/edit: `docs/evaluations.md` (helpers).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
