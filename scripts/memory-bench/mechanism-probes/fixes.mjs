/**
 * Plan 210 Task 2: the mechanism errors the probes found. `fixed` ones landed in this task with a
 * regression test; `task3` ones need a contract or design change and are handed to Task 3's gap
 * analysis. The feature ledger reads this list, so every entry names its rows and its test.
 */
const FT = "packages/memory/fabric/src/__tests__";
const OT = "packages/memory/observational/src/__tests__";

export const FIXES = Object.freeze([
  {
    id: "package-tool-routing",
    kind: "fixed",
    features: ["navigation.agentic-lexical", "tools.explicit-writes"],
    found: "never-fires",
    summary:
      "The package built its own tool set without the cross-scope routing createMemoryFabric().tools() has: memory.read { around | session } always returned not_found, memory.replace { id, pin } ignored pin, and a replace or verify of a note outside the narrowest scope missed it.",
    change: "Shared createNoteNavigator (navigation.ts) used by both tool sets; the package passes navigateNotes, noteMemory and routed pin/verify.",
    files: ["packages/memory/fabric/src/navigation.ts", "packages/memory/fabric/src/create.ts", "packages/memory/fabric/src/index.ts"],
    test: { file: `${FT}/session-navigation.test.ts`, name: "package_memory_read_navigates_and_replace_pins_across_scopes" },
  },
  {
    id: "expansion-coverage-scale",
    kind: "fixed",
    features: ["recall.expansion"],
    found: "never-fires",
    summary:
      "recall.expansion scaled the store's floor but reported coverage over the expanded terms, so a match found only through an alternate (one caller term) fell under memory.recall's 0.34 no-match confidence and the tool abstained.",
    change: "Hit coverage is reported over the caller's own terms, the same scale as the floor (opt-in variant; default off, unchanged).",
    files: ["packages/memory/fabric/src/recall.ts"],
    test: { file: `${FT}/recall-variants.test.ts`, name: "expansion_match_reaches_the_recall_tool_instead_of_abstaining" },
  },
  {
    id: "capture-needs-archive",
    kind: "reported",
    features: ["delivery.rule-capture"],
    found: "never-fires",
    summary:
      "rules.capture: \"confirm\" runs inside the exchange archive's task, so without `exchanges` it silently captured nothing. Both presets turn the archive on.",
    change: "Setup leaves a warning status note and the README states the dependency; making capture independent of the archive is a design change for Task 3.",
    files: ["packages/memory/fabric/src/index.ts", "packages/memory/fabric/README.md"],
    test: { file: `${FT}/package.test.ts`, name: "rules_capture_without_the_exchange_archive_warns_at_setup" },
  },
  {
    id: "om-commands-inspectability",
    kind: "test-added",
    features: ["om.commands"],
    found: "works",
    summary: "The inspectability role had no named test.",
    change: "Named test added; the row becomes safety-proven.",
    files: [],
    test: { file: `${OT}/observational.test.ts`, name: "om_commands_expose_session_state_for_inspection" },
  },
  {
    id: "fabric-toggle-status-inspectability",
    kind: "test-added",
    features: ["fabric.toggle-status"],
    found: "works",
    summary: "The inspectability role had no named test.",
    change: "Named test added; the row becomes safety-proven.",
    files: [],
    test: { file: `${FT}/package.test.ts`, name: "memory_toggle_and_status_commands_are_inspectable" },
  },
  {
    id: "package-lifecycle-project-only",
    kind: "task3",
    features: ["lifecycle.verification", "retrieval.strength-priors", "lifecycle.widen-narrow", "scope.user", "scope.agent"],
    found: "never-fires",
    summary:
      "The package's per-turn lifecycle task (uses, co-reads, retrievals, helpful/harmful evidence) runs on a project-only lifecycle, so a cited user- or agent-scope note never gains a use, never verifies by use and never builds R or S. Routing it needs each scope's own clock for the use event, a contract question.",
    change: "None in Task 2; for Task 3.",
    files: [],
  },
]);
