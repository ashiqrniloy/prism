import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLedger,
  CANDIDATE_STATUSES,
  enumerateSurface,
  LEDGER_PATH,
  namedTestExists,
  ROOT,
  render,
  safetyStatusProblems,
} from "./feature-ledger.mjs";
import { CLOSURE_202, FEATURES } from "./feature-ledger-features.mjs";

const ledger = buildLedger();
const byId = new Map(ledger.features.map((f) => [f.id, f]));
const clone = (value) => structuredClone(value);
const buildThrows = (input) => {
  try {
    buildLedger(input);
  } catch (error) {
    return String(error.message);
  }
  return "";
};

describe("plan 210 Task 1 feature ledger", () => {
  test("ledger_covers_every_config_field_kind_tool_and_command", () => {
    const surface = enumerateSurface();
    // The surface is read from the code, so it cannot shrink silently: these are the counts the ledger saw.
    expect(surface.config).toContain("fabric:recall.gather");
    expect(surface.config).toContain("om:dropper.policy");
    expect(surface.config).toContain("wiki:consolidate.triggers");
    expect(surface.kinds).toEqual(["episode", "fact", "preference", "procedure", "decision", "file", "exchange", "concept"]);
    expect(surface.tools).toEqual(expect.arrayContaining(["memory.recall", "memory.forget", "recall", "wiki_ingest"]));
    expect(surface.commands).toEqual(expect.arrayContaining(["memory:maintain", "memory:share", "memory:session:view", "wiki:lint"]));
    for (const kind of ["config", "kinds", "tools", "commands"]) {
      const names = kind === "config" ? surface.config : surface[kind];
      for (const name of names) expect(ledger.coverage[kind][name]?.length ?? 0).toBeGreaterThan(0);
    }

    // Dropping the only claim on a field, a kind, a tool or a command fails the build.
    const withoutGather = clone(FEATURES).map((f) => (f.id === "recall.gather" ? { ...f, config: [] } : f));
    expect(buildThrows({ features: withoutGather })).toContain("config field not in the ledger: fabric:recall.gather");
    const withoutConcept = clone(FEATURES).map((f) => (f.id === "kind.concept" ? { ...f, kinds: [] } : f));
    expect(buildThrows({ features: withoutConcept })).toContain("kind not in the ledger: concept");
    const withoutForget = clone(FEATURES).map((f) => (f.id === "safety.deletion-cascade" ? { ...f, tools: [] } : f));
    expect(buildThrows({ features: withoutForget })).toContain("tool not in the ledger: memory.forget");
    const withoutLint = clone(FEATURES).map((f) => (f.id === "ontology.claim-lint" ? { ...f, commands: [] } : f));
    expect(buildThrows({ features: withoutLint })).toContain("command not in the ledger: wiki:lint");
    // A row may not claim surface that no longer exists.
    const stale = clone(FEATURES).map((f) =>
      f.id === "recall.gather" ? { ...f, config: [...f.config, "fabric:recall.removedField"] } : f,
    );
    expect(buildThrows({ features: stale })).toContain("recall.gather: claims unknown config fabric:recall.removedField");
  });

  test("safety_proven_requires_a_named_passing_test", () => {
    for (const f of ledger.features.filter((row) => row.status === "safety-proven")) {
      expect(f.roles.some((role) => role === "safety" || role === "inspectability")).toBe(true);
      expect(f.tests.length).toBeGreaterThan(0);
      for (const t of f.tests) expect(namedTestExists(t)).toBe(true);
    }
    for (const f of ledger.features.filter((row) => row.roles.every((role) => role === "safety" || role === "inspectability"))) {
      expect(["safety-proven", "unmeasured"]).toContain(f.status);
    }
    const base = { id: "x", roles: ["safety"], status: "safety-proven" };
    expect(safetyStatusProblems({ ...base, tests: [] })).toEqual(["x: safety-proven without a named test"]);
    expect(
      safetyStatusProblems({ ...base, tests: [{ file: "scripts/memory-bench/safety/safety.test.mjs", name: "no_such_test" }] })[0],
    ).toContain("named test not found");
    expect(
      safetyStatusProblems({
        ...base,
        roles: ["accuracy"],
        tests: [{ file: "scripts/memory-bench/safety/safety.test.mjs", name: "ontology_report_carries_no_text" }],
      })[0],
    ).toContain("without a safety or inspectability role");
    expect(safetyStatusProblems({ id: "y", roles: ["safety"], status: "benefit", tests: [] })[0]).toContain(
      "must be safety-proven or unmeasured",
    );
    // The check runs inside the build too.
    const unproven = clone(FEATURES).map((f) => (f.id === "safety.legal-holds" ? { ...f, tests: [] } : f));
    expect(buildThrows({ features: unproven })).toContain("safety.legal-holds: safety-proven without a named test");
  });

  test("ledger_carries_every_202_closure_row_and_unbuilt_facts", () => {
    const closureMd = readFileSync(join(ROOT, "docs/_evidence/memory-bench/202/closure.md"), "utf8");
    const sourceTasks = [...closureMd.matchAll(/^\| (\d+): /gm)].map((m) => Number(m[1]));
    expect(sourceTasks).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(ledger.closure202.rows.map((r) => r.sourceTask)).toEqual(sourceTasks);
    for (const row of ledger.closure202.rows) {
      expect(row.deferredFrom).toBe(`202-task${row.sourceTask}`);
      expect(row.evidence.length).toBeGreaterThan(0);
      for (const ev of row.evidence) expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.developmentTarget.length).toBeGreaterThan(0);
      expect(row.limitation.length).toBeGreaterThan(0);
      expect(row.owningTasks.length).toBeGreaterThan(0);
    }
    expect(ledger.closure202.preserved).toEqual({ task4BaselineComplete: false, task5ScreenVerdict: "miss" });

    const task17 = ledger.closure202.rows.find((r) => r.sourceTask === 17);
    expect(task17.disposition).toBe("deferred-lever");
    expect(task17.features).toEqual([]);
    expect(task17.f4).toEqual({ status: "unresolved", measured: false, value: null });
    expect(task17.extractionGapDecisions).toEqual({ total: 14, measured: 0 });
    expect(ledger.closure202.rows.find((r) => r.sourceTask === 13).disposition).toBe("deferred-lever");
    expect(ledger.candidates.deferredLevers.map((l) => l.sourceTask)).toEqual([13, 17]);
    expect(ledger.candidates.openMeasurements.map((m) => m.sourceTask)).toEqual([14, 15, 16]);

    // Mandatory candidates (Tasks 6-12) are candidates unless measured as a benefit.
    for (const row of ledger.closure202.rows.filter((r) => r.sourceTask >= 6 && r.sourceTask <= 12)) {
      for (const id of row.features) expect(byId.get(id).candidate || byId.get(id).status === "benefit").toBe(true);
    }

    // Omitting a source-task row, F4 or Task 17 fails the build.
    expect(buildThrows({ closure: clone(CLOSURE_202).filter((r) => r.sourceTask !== 9) })).toContain("202 closure row missing: Task 9");
    expect(buildThrows({ closure: clone(CLOSURE_202).filter((r) => r.sourceTask !== 17) })).toContain(
      "202 Task 17 (facts / F4) is missing",
    );
    const built17 = clone(CLOSURE_202).map((r) => (r.sourceTask === 17 ? { ...r, deferredLever: false } : r));
    expect(buildThrows({ closure: built17 })).toContain("202 Task 17 must be a deferred lever");
    // An unmeasured stage is never a measured zero: a measured status needs evidence and a measured effect.
    const zeroed = clone(FEATURES).map((f) => (f.id === "delivery.weak-tool-caller" ? { ...f, status: "neutral", evidence: [] } : f));
    expect(buildThrows({ features: zeroed })).toContain("delivery.weak-tool-caller: neutral without evidence");
    const promoted = clone(FEATURES).map((f) =>
      f.id === "delivery.precision-filter" ? { ...f, status: "safety-proven", roles: ["accuracy"] } : f,
    );
    expect(buildThrows({ features: promoted })).toContain("202 Task 8: delivery.precision-filter is a mandatory candidate");
  });

  test("ledger_marks_202_task5_deferred_suites_unmeasured", () => {
    for (const id of ["write.keyword-enrichment", "navigation.agentic-lexical"]) {
      const row = byId.get(id);
      expect(row.candidate).toBe(true);
      expect(CANDIDATE_STATUSES).toContain(row.status);
      expect(row.deferredFrom).toBe("202-task5.4.6");
      expect(row.suiteStatus["longmemeval-m"].status).toBe("unmeasured");
      expect(row.suiteStatus["beam-1m"].status).toBe("unmeasured");
      expect(row.suiteStatus["memoryagentbench-cr"].status).toBe("unmeasured");
      expect(row.evidence.some((ev) => ev.path.endsWith("202/task5/development-screen-verdict.json"))).toBe(true);
    }
    expect(ledger.handoffTask5.manifestCells).toBe(10);
    expect(ledger.handoffTask5.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.handoffTask5.fileSha256).toMatch(/^[0-9a-f]{64}$/);

    const claimed = clone(FEATURES).map((f) =>
      f.id === "write.keyword-enrichment"
        ? { ...f, suiteStatus: { ...f.suiteStatus, "longmemeval-m": { ...f.suiteStatus["longmemeval-m"], status: "neutral" } } }
        : f,
    );
    expect(buildThrows({ features: claimed })).toContain("write.keyword-enrichment: longmemeval-m is deferred but claims neutral");
  });

  test("every_open_handoff_finding_and_limitation_has_an_owning_row", () => {
    expect(ledger.findings1887.map((f) => f.id)).toEqual(["F3", "F4", "F7", "F9", "F13"]);
    for (const f of ledger.findings1887) expect(f.features.length).toBeGreaterThan(0);
    for (const l of ledger.limitations18811) expect(l.features.length).toBeGreaterThan(0);
    for (const h of ledger.planHandoffs) for (const id of h.features) expect(byId.has(id)).toBe(true);
    expect(ledger.scope.excluded.map((x) => x.package)).toEqual(["@arnilo/prism-rag", "@arnilo/prism-memory-compaction"]);
  });

  test("ledger_is_text_free_and_committed_copy_is_current", () => {
    for (const f of ledger.features) for (const ev of f.evidence) expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(ROOT, LEDGER_PATH), "utf8")).toBe(render(ledger));
  });
});
