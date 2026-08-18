import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRunResult } from "@arnilo/prism";
import { createErpInvariantScorers, ERP_INVARIANT_SCHEMA_VERSION, erpInvariantDataset, scoreRun } from "../index.js";

/**
 * Plan 027 Task 9 — ERP invariant scorers are deterministic hard gates.
 *
 * No Postgres is required: these tests exercise the scorer logic against
 * synthetic journey facts. The protected end-to-end journey lives in
 * `scripts/phase27-erp-journey.test.mjs`; here we prove every required fact
 * absent/false makes its scorer fail and no weighted average hides it.
 */

function result(facts: unknown): AgentRunResult {
  return {
    sessionId: "session_erp",
    runId: "run_erp",
    status: "succeeded",
    text: JSON.stringify(facts),
    content: [{ type: "text", text: "erp-journey" }],
  };
}

/** A fully-satisfying facts record: every required fact is present and truthy. */
function passingFacts(): Record<string, Record<string, unknown>> {
  return {
    atomic: { committedAtomically: true },
    delivery: { singleLocalEffect: true, duplicateDelivered: true, businessMutationCount: 1 },
    compensation: { compensated: true, reconciled: true, terminalStatus: "compensated" },
    quorum: { distinctApprovers: 2, requesterDenied: true, subagentDenied: true, revokedDenied: true, provenance: true },
    chain: { verified: true, tamperedDetected: true, nextDigest: "abc123" },
    noLeak: { classifiedDenied: true, crossTenantDenied: true, secretRedacted: true },
    fencedFailover: { resumedByPeer: true, staleWriteRejected: true, cursorPreserved: true, failoverMs: 4097 },
    restore: { factsMatch: true, digestsMatch: true, drEvidenceFresh: true, restoreMs: 382 },
  };
}

const SCORER_IDS = [
  "atomic-intent",
  "single-local-effect",
  "compensation-terminal",
  "quorum-provenance",
  "chain-verification",
  "no-leak",
  "fenced-failover",
  "restore-equality",
] as const;

describe("erpInvariantDataset", () => {
  it("is frozen, versioned, and carries one item per invariant", () => {
    assert.equal(erpInvariantDataset.id, "prism.erp-invariants");
    assert.equal(erpInvariantDataset.version, "0.2.7");
    assert.equal(erpInvariantDataset.items.length, SCORER_IDS.length);
    assert.deepEqual(
      erpInvariantDataset.items.map((item) => item.id),
      [...SCORER_IDS],
    );
    assert.equal(erpInvariantDataset.metadata?.schemaVersion, ERP_INVARIANT_SCHEMA_VERSION);
    assert.equal(erpInvariantDataset.metadata?.frozen, true);
    // items are frozen (defineDataset Object.freeze)
    assert.ok(Object.isFrozen(erpInvariantDataset.items));
  });
});

describe("createErpInvariantScorers", () => {
  it("returns one scorer per invariant with stable ids", () => {
    const scorers = createErpInvariantScorers();
    assert.equal(scorers.length, SCORER_IDS.length);
    assert.deepEqual(
      scorers.map((s) => s.id),
      [...SCORER_IDS],
    );
  });

  it("scores all invariants 1 when every required fact is present and truthy", async () => {
    const records = await scoreRun({
      result: result(passingFacts()),
      scorers: createErpInvariantScorers(),
      datasetId: erpInvariantDataset.id,
    });
    assert.equal(records.length, SCORER_IDS.length);
    for (const record of records) {
      assert.equal(record.status, "scored", `${record.scorerId} must be scored`);
      assert.equal(record.score, 1, `${record.scorerId} must score 1`);
    }
  });

  it("fails the matching scorer and only the matching scorer when one invariant's block is missing", async () => {
    for (const id of SCORER_IDS) {
      const facts = passingFacts();
      const spec = erpInvariantDataset.items.find((item) => item.id === id);
      const factsKey = (spec?.input as { factsKey?: string } | undefined)?.factsKey as string;
      delete facts[factsKey];
      const records = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
      const failed = records.filter((r) => r.score !== 1);
      assert.equal(failed.length, 1, `only ${id} must fail when its block is missing`);
      assert.equal(failed[0]?.scorerId, id);
      assert.match(failed[0]?.reason ?? "", /missing facts block/);
    }
  });

  it("fails the matching scorer when any single required fact is false", async () => {
    for (const id of SCORER_IDS) {
      const spec = erpInvariantDataset.items.find((item) => item.id === id);
      const factsKey = (spec?.input as { factsKey?: string } | undefined)?.factsKey as string;
      const required = (spec?.expected as { required?: readonly string[] } | undefined)?.required as readonly string[];
      for (const factName of required) {
        const facts = passingFacts();
        // boolean facts → false; numeric facts → 0; string facts → ""
        const current = facts[factsKey][factName];
        facts[factsKey][factName] = typeof current === "number" ? 0 : typeof current === "string" ? "" : false;
        const records = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
        const failed = records.filter((r) => r.score !== 1);
        assert.equal(failed.length, 1, `only ${id} must fail when ${factName} is unsatisfied`);
        assert.equal(failed[0]?.scorerId, id);
        assert.match(failed[0]?.reason ?? "", new RegExp(`fact not satisfied: ${factName}`));
      }
    }
  });

  it("fails the matching scorer when a required fact is absent (undefined)", async () => {
    for (const id of SCORER_IDS) {
      const spec = erpInvariantDataset.items.find((item) => item.id === id);
      const factsKey = (spec?.input as { factsKey?: string } | undefined)?.factsKey as string;
      const required = (spec?.expected as { required?: readonly string[] } | undefined)?.required as readonly string[];
      for (const factName of required) {
        const facts = passingFacts();
        delete facts[factsKey][factName];
        const records = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
        const failed = records.filter((r) => r.score !== 1);
        assert.equal(failed.length, 1, `only ${id} must fail when ${factName} is absent`);
        assert.equal(failed[0]?.scorerId, id);
        assert.match(failed[0]?.reason ?? "", new RegExp(`missing fact: ${factName}`));
      }
    }
  });

  it("is deterministic: identical facts yield identical scores and reasons", async () => {
    const facts = passingFacts();
    const first = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
    const second = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
    assert.deepEqual(
      first.map((r) => ({ id: r.scorerId, score: r.score, reason: r.reason })),
      second.map((r) => ({ id: r.scorerId, score: r.score, reason: r.reason })),
    );
  });

  it("treats malformed result text as a total failure (no hidden pass)", async () => {
    const malformed: AgentRunResult = { ...result(passingFacts()), text: "not-json" };
    const records = await scoreRun({ result: malformed, scorers: createErpInvariantScorers() });
    assert.equal(records.length, SCORER_IDS.length);
    for (const record of records) {
      assert.equal(record.score, 0, `${record.scorerId} must fail on malformed facts`);
    }
  });

  it("never produces a weighted average: a single failing invariant fails the gate", async () => {
    const facts = passingFacts();
    delete facts.chain; // tamper chain block
    const records = await scoreRun({ result: result(facts), scorers: createErpInvariantScorers() });
    const allPass = records.every((r) => r.score === 1);
    assert.equal(allPass, false, "a single missing block must fail the gate");
    assert.equal(records.filter((r) => r.score === 1).length, SCORER_IDS.length - 1);
  });
});
