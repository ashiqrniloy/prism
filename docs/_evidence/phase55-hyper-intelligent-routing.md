# Phase 55 — Hyper intelligent-routing metadata (Task 10 external gate)

## Re-check date and outcome

Re-checked `https://hyper.charm.land/` + `https://hyper.charm.land/docs/` +
`https://hyper.charm.land/faq` (live fetch, 2026-09).

**Outcome: not actionable — feature not shipped.** Charm still lists intelligent
routing as roadmap only. No routing control is documented anywhere:

> Intelligent Routing — Beyond simple proxying, the Hyper roadmap includes
> intelligent model selection, which automatically delegates tasks to the most
> cost-effective or specialized model for specific steps in coding workflows.
> (FAQ, https://hyper.charm.land/faq, and landing page — identical wording)

## Endpoint inventory at re-check

`https://hyper.charm.land/docs/` API index links only these pages — none carry a
routing parameter, per-step model selection, router preset, or delegation knob:

| Page | Route(s) |
| --- | --- |
| authentication | auth headers |
| list-models | `GET /v1/models` (public, fixed catalog) |
| openai-chat-completions | `POST /v1/chat/completions` (standard params only) |
| openai-responses | `POST /v1/responses` (standard pass-through) |
| anthropic-messages | `POST /v1/messages` (standard Messages) |
| credits | `GET /v1/credits` |
| fantasy | — (non-API marketing page) |

## Decision (per plan 055 Task 10)

- Precondition — Charm publicly documents routing controls — **not met**.
- No speculative wire parameters were invented (same rule as cache fields).
- Zero code, zero tests, zero wire-surface changes; this evidence page + the
  plan record carry the re-check.
- Re-open when: Charm adds a documented routing endpoint/parameter
  (per-step model selection or router presets); then map request passthrough +
  featured-model metadata + offline conformance per the plan.

## Related

- `plans/055-First-Class-Hyper-And-Command-Code-Providers.md` Task 10
- `docs/providers/hyper.md` (extension notes stay feature-true)