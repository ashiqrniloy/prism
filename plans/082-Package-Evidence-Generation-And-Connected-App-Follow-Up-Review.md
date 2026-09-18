# Package Evidence Generation and Connected-App Follow-up Review

Status: complete (2026-09-17). Created after reviewing every Further Action in [081](081-Connected-Apps-Mcp-Host-And-Work-Http.md#further-actions). This is a small, non-release maintenance plan: it does **not** gate 080 Task 10 or the 0.8.0 cut.

## Objectives

- Close 081's five Further Actions with explicit evidence, demand triggers, and one minimal implementation.
- Make `node scripts/package-truth.mjs --emit-docs` regenerate the Phase 54 package-map evidence with its existing generated inventories.
- Preserve current safety boundaries: no model-facing Open Connector action tool, no arbitrary SharePoint-link resolution, no weakened secret scan, and no non-null-budget rebaseline.

## Review Disposition

| 081 Further Action | Decision | Reopen only when |
|---|---|---|
| Open Connector HTTP write adapter | **Deferred, P3.** The sidecar remains external; Prism cannot impose `pinnedFetch` on OC provider egress, and MCP `execute_action` has no idempotency key. Do not add an OC dependency or model-facing generic action tool. | A supported host needs retry-safe OC writes and supplies verified identity-to-connection mapping, pinned host-to-OC transport, and a bounded draft/approval design using OC Runtime HTTP `Idempotency-Key`. |
| Graph sharing-link resolver | **Deferred, P3.** Direct Graph Drive-item URLs deliberately keep each file operation to one bounded request. | A supported host cannot resolve its sharing links before calling Prism and supplies the required Graph permission/redeem policy for a bounded `/shares/{token}/driveItem` preflight. |
| Non-null assertion budget | **Closed.** Task 8 removed all 14 new assertions; ceilings remain 435 in `packages/prism-core/src` and 2,162 repository-wide. | A future change demonstrably needs a new assertion and records a reviewed budget-baseline reason. |
| Gitignore-aware secret scan | **Rejected.** Scanning ignored/untracked files is a security property; treating `scripts/live.env` as invisible would hide a real secret source. The known generated `graft/` cache remains the narrow excluded directory. | A new exclusion is proven to be a bounded generated cache and cannot contain user-controlled or credential material. |
| Phase 54 evidence from `--emit-docs` | **Implement.** The map is generated from the same package manifests as package truth, but currently requires a separate command. | Not applicable. |

No primitive-review task is needed: this plan adds no package, public export, reusable runtime primitive, or extension point.

## Expected Outcome

- One contributor command, `node scripts/package-truth.mjs --emit-docs`, rewrites the existing generated package inventory blocks and `docs/_evidence/phase54-package-map.md` from the selected `--root`.
- Generated Phase 54 evidence continues to match `generateMarkdown(buildPackageMap(root))`; stale-map diagnostics name the single regeneration command.
- A network-free regression proves a credential-shaped value in a gitignored fixture remains visible to `scanSecrets`, while the bounded `graft/` cache fixture remains excluded.
- No public package surface, dependency, version, work operation, credential flow, or secret-scan coverage is broadened or reduced.

## Tasks

- [x] **Task 1 — Emit Phase 54 evidence through package truth**
  - Acceptance Criteria:
    - Functional: `node scripts/package-truth.mjs --emit-docs` writes `docs/_evidence/phase54-package-map.md` as well as every current `DOC_BLOCK_TARGETS` page; the evidence derives from the supplied `--root`, not `DEFAULT_ROOT`.
    - Performance: one in-process map build; no child process, network call, directory walk beyond the existing manifest/map generation, or repeated map build.
    - Code Quality: reuse exported `buildPackageMap()` and `generateMarkdown()`; keep `--emit-docs` the only changed CLI behavior, retain normal package-truth artifact behavior, and use a small pure render seam only if required for a hermetic test.
    - Security: no new dependency, no shell interpolation, no model-controlled path, and write only the fixed evidence path beneath the selected repository root.
  - Approach:
    - Documentation Reviewed:
      - `scripts/package-truth.mjs:L245-L289`: generated-block targets and current `--emit-docs` CLI path.
      - `scripts/phase54-package-map.mjs:L689-L810,L1011-L1033`: pure map/markdown exports and root-relative CLI output.
      - `scripts/phase54-package-map.test.mjs:L131-L164`: exact stale-evidence invariant.
      - `docs/release-and-install.md:L14-L30` and `docs/index.md:L231-L249`: package-truth generated inventory convention.
    - Options Considered:
      - Spawn `phase54-package-map.mjs`: rejected; duplicates CLI/root/error handling and adds a process boundary.
      - Import `buildPackageMap` and `generateMarkdown` into the existing `--emit-docs` branch: chosen; smallest in-process path and preserves root selection.
      - Always generate the map without `--emit-docs`: rejected; changes the documented command's write contract and adds unnecessary work to ordinary truth checks.
    - Chosen Approach:
      - Build map markdown once from `root` inside the documented emit path, then write it to `join(root, "docs", "_evidence", "phase54-package-map.md")` with the existing generated documentation outputs. If direct CLI testing would mutate the working tree, expose only a narrow render-result seam for in-memory assertions; do not add a generic generator framework.
    - API Notes and Examples:
      ```sh
      node scripts/package-truth.mjs --emit-docs
      # rewrites package-truth.json, generated inventory/provider blocks,
      # and docs/_evidence/phase54-package-map.md
      ```
    - Files to Create/Edit:
      - `scripts/package-truth.mjs`: import existing map functions and include the evidence in the `--emit-docs` write set.
      - `scripts/truth-current.test.mjs`: add an in-memory regression proving the package-truth emit render includes current Phase 54 markdown without changing the working tree.
      - `scripts/phase54-package-map.test.mjs`: point stale-evidence recovery text at the canonical package-truth emit command if needed.
      - `docs/_evidence/phase54-package-map.md`: regenerate from the unified command.
    - References:
      - [081 Further Actions](081-Connected-Apps-Mcp-Host-And-Work-Http.md#further-actions).
      - `scripts/package-truth.mjs:L210-L289`.
      - `scripts/phase54-package-map.mjs:L689-L810,L1011-L1033`.
  - Test Cases to Write:
    - In-memory unified render: selected root returns the exact Phase 54 relative output whose content equals `generateMarkdown(buildPackageMap(root))`, ignoring only its generated timestamp.
    - Existing generated inventory blocks: all `DOC_BLOCK_TARGETS` still restore byte-identically and no non-target page changes.
    - Stale map recovery: changed manifest/map output fails with the canonical `node scripts/package-truth.mjs --emit-docs` remediation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this is a contributor-only internal script and generated evidence workflow, not a published package or runtime contract.
    - Docs pages to create/edit:
      - `docs/_evidence/phase54-package-map.md`: regenerated artifact only.
    - `docs/index.md` update: no; navigation and public behavior do not change.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (current-contract docs not applicable to an internal generator).

- [x] **Task 2 — Verify unified evidence and record 081 dispositions**
  - Acceptance Criteria:
    - Functional: the unified command leaves every generated inventory and Phase 54 evidence current; 081's Further Actions explicitly record the four non-implementation dispositions and the completed evidence integration.
    - Performance: default test-chain runtime remains within its existing budget; no new live or networked test.
    - Code Quality: all generated-output assertions use existing package-truth/map functions and timestamp-normalization convention; no export, budget, manifest, or version baseline changes.
    - Security: tracked-set secret scan remains clean; confirm the scanner still examines ignored/untracked paths except its explicit bounded cache exclusions, and do not add a gitignore bypass.
  - Approach:
    - Documentation Reviewed:
      - `plans/081-Connected-Apps-Mcp-Host-And-Work-Http.md:L414-L423`: source Further Actions and priorities.
      - `docs/work-connectors.md:L7,L18,L34`: fixed-origin/pinned-fetch model, direct Drive-item URL boundary, and no Slack/Teams channel scope.
      - `docs/connected-apps.md:L93-L101`: Open Connector remains an external sidecar and host identity glue.
      - Microsoft Graph, [`GET /shares/{shareIdOrUrl}/driveItem`](https://learn.microsoft.com/en-us/graph/api/shares-get): sharing URLs require token encoding and redeem behavior is security-significant.
      - Open Connector, [`docs/runtime-api.md`](https://github.com/oomol-lab/open-connector/blob/main/docs/runtime-api.md): Runtime HTTP accepts bounded `Idempotency-Key`; MCP `execute_action` does not. Context7 had no matching Open Connector documentation entry, so this official source is authoritative for the deferred decision.
      - `scripts/scan-secrets.mjs:L1-L59`: ignored directory policy, symlink avoidance, file limits, and exact secret patterns.
    - Options Considered:
      - Implement every P3 item now: rejected; two are explicitly demand-gated, one is already fixed, and the scan change would weaken a security control.
      - Delete the Further Actions without a record: rejected; loses trigger/rationale needed for future demand review.
      - Record dispositions in 081 while executing only the map integration: chosen; keeps historical decision provenance without expanding public behavior.
    - Chosen Approach:
      - Run the smallest existing verification set that proves generation and contract integrity, update 081's Further Actions with final disposition links, then mark this plan and its index entry complete. Do not modify `docs/index.md`, roadmap, dependencies, package manifests, or release eligibility.
    - API Notes and Examples:
      ```sh
      node scripts/package-truth.mjs --emit-docs
      node --test scripts/truth-current.test.mjs scripts/phase54-package-map.test.mjs
      node scripts/scan-secrets.mjs $(git ls-files)
      npm test
      ```
    - Files to Create/Edit:
      - `scripts/scan-secrets.test.mjs`: network-free temporary Git-tree regression for ignored-file detection and `graft/` exclusion.
      - `scripts/run-all-tests.mjs`: register the regression in the default gate suite.
      - `plans/081-Connected-Apps-Mcp-Host-And-Work-Http.md`: record each final disposition and this plan's result.
      - `plans/082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md`: mark tasks/status complete and fill compromises/further actions with actual outcomes.
      - `plans/README.md`: mark plan 082 complete.
      - `docs/_evidence/phase54-package-map.md`: final unified-generator output.
    - References:
      - `scripts/truth-current.test.mjs:L1-L126`.
      - `scripts/phase54-package-map.test.mjs:L131-L164`.
      - `src/pinned-fetch.ts:L50-L82` and `packages/prism-core/src/integrations/work/http.ts:L25-L71`.
  - Test Cases to Write:
    - Unified emission regression and Phase 54 stale-evidence test both pass after a single emit command.
    - `scripts/scan-secrets.test.mjs`: a credential-shaped value assembled from harmless string fragments in a gitignored fixture is detected, while the same fixture under `graft/` is not scanned.
    - Full default test chain, typecheck, lint, format check, coverage gate, export budgets, docs integrity, and `git diff --check` stay green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this finalizes internal evidence and plan decisions only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase54-package-map.md`: regenerated artifact only.
      - `plans/081-Connected-Apps-Mcp-Host-And-Work-Http.md`: historical decision record, not current API documentation.
    - `docs/index.md` update: no; no navigable current contract changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (no public API page is created or changed).

## Compromises Made

- None. Reused existing generators and kept OC/Graph proposals demand-gated; no package, public surface, manifest, or budget change.

## Further Actions

- No new work. Reopen only the demand-gated OC and Graph proposals under [081's recorded dispositions](081-Connected-Apps-Mcp-Host-And-Work-Http.md#further-actions).
