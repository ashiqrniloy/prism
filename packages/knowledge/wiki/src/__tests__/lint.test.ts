/**
 * Plan 207 Task 7: claim lint, and the team ontology as a scope the curator never writes.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, type ModelClient } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { createHashEmbedder, createMemoryVectorStore, MemoryScopeError } from "@arnilo/prism-memory-core";
import memorySystem, { createMemory, createLongTermMemory, createMemoryLtmPort, type LtmScope } from "@arnilo/prism-memory-system";
import { resolveMemoryWorkerLimits } from "@arnilo/prism-memory-core";
import { createWikiLease, runWikiPass } from "../consolidate/pass.js";
import { WIKI_LINT_COMMAND_NAME, wiki } from "../index.js";
import { createWikiOntology } from "../ontology/port.js";
import type { WikiScopeLevel } from "../ontology/types.js";
import { createMemoryWikiStore, type WikiConceptRecord } from "../store.js";
import { LINT_RULES, lintOntology, UNBOUND_AFTER_PASSES, type WikiLintReport } from "../lint.js";

const scope = { tenantId: "t1", threadId: "th1" };
const refuse: ModelClient = {
  model: { provider: "test", model: "never" },
  async *generate() {
    throw new Error("a model call was made");
  },
};

function setup() {
  const vectorStore = createMemoryVectorStore();
  const embedder = createHashEmbedder({ dimensions: 8 });
  const memory = createMemory({ ...scope, resourceId: "r-project", embedder, vectorStore });
  const scopes: LtmScope[] = [{ level: "project", memory, store: vectorStore }];
  const ltm = createMemoryLtmPort({ scopes: () => scopes });
  const store = createMemoryWikiStore();
  const port = createWikiOntology({ store, ltm: () => ltm });
  const fabric = createLongTermMemory({ memory, vectorStore, consolidate: false });
  const note = async (text: string, subject?: string) =>
    await fabric.remember({ kind: "fact", content: text, ...(subject === undefined ? {} : { subject }) });
  return { vectorStore, memory, scopes, store, port, note };
}

type Env = ReturnType<typeof setup>;

const concept = async (env: Env, subject: string, title: string, claims: readonly [string, string][], aliases: string[] = []) => {
  await env.port.applyConceptEdits(
    "project",
    [
      { op: "create_subject", subject, title, conceptType: "entity", aliases },
      ...claims.map(([text, cite]) => ({ op: "add_claim" as const, subject, text, cites: [cite] })),
    ],
    { generatedBy: "consolidation" },
  );
};

const idOf = async (env: Env, subject: string) => (await env.port.subjects("project")).find((row) => row.subject === subject)!.conceptId;

/** Change a concept the way a person or the cascade would: straight in the wiki's store. */
const patchConcept = async (env: Env, level: WikiScopeLevel, id: string, patch: Partial<WikiConceptRecord>) => {
  const record = (await env.store.concepts(level)).find((entry) => entry.id === id)!;
  await env.store.putConcept({ ...record, ...patch });
};

const lint = (env: Env, extra: Partial<Parameters<typeof lintOntology>[1]> = {}): Promise<WikiLintReport> =>
  lintOntology(env.port, { maxClaimsPerConcept: 40, ...extra });

const rules = (report: WikiLintReport): string[] => [...new Set(report.findings.map((finding) => finding.rule))].sort();

/** A team concept: read-only to the curator, in the team scope of the wiki's store; the team LTM scope is attached. */
async function attachTeam(env: Env, cites: readonly string[]) {
  const store = createMemoryVectorStore();
  const memory = createMemory({ tenantId: "team", resourceId: "project", threadId: "default", vectorStore: store });
  env.scopes.push({ level: "team", memory, store });
  const now = new Date().toISOString();
  const record: WikiConceptRecord = {
    id: "a1b2c3d4e5f6",
    scope: "team",
    subject: "deploys",
    title: "Deploys",
    conceptType: "topic",
    aliases: [],
    links: [],
    body: `# Deploys\n\n- [c1] Deploys go out on Tuesdays.${cites.map((cite) => `[^${cite}]`).join("")}\n`,
    stale: [],
    dirty: [],
    status: "verified",
    flags: [],
    generated: { by: "human", at: now },
    createdAt: now,
    uses: 0,
  };
  await env.store.putConcept(record);
  return { record };
}

describe("claim lint", () => {
  it("lint_reports_each_rule_and_fails_only_on_unresolved_or_collision", async () => {
    const env = setup();
    const [a, b, c, d, e, orphan] = await Promise.all(
      ["alpha detail", "beta detail", "gamma detail", "delta detail", "epsilon detail", "an unrelated note"].map((text) => env.note(text)),
    );
    await concept(env, "payments", "Payments service", [
      ["Retries use backoff.", a!.id],
      ["Inputs are validated.", b!.id],
    ]);
    await concept(env, "ledger", "Ledger", [["Entries are append-only.", c!.id]]);
    await env.port.applyConceptEdits("project", [{ op: "add_relation", subject: "payments", relation: "related", target: "ledger" }], {
      generatedBy: "consolidation",
    });
    // A healthy ontology reports nothing and passes.
    const healthy = await lint(env);
    assert.deepEqual(healthy.findings, []);
    assert.equal(healthy.ok, true);

    // Maintainer work: every one of these is reported and none of them fails the run.
    await env.port.applyConceptEdits("project", [{ op: "add_claim", subject: "payments", text: "Refunds are manual.", cites: [] }], {
      generatedBy: "human",
    });
    await env.memory.patchMetadata(d!.id, (metadata) => ({ ...metadata, status: "candidate" }));
    await concept(env, "reports", "Reports", [["Reports are nightly.", d!.id]]);
    const paymentsId = await idOf(env, "payments");
    await patchConcept(env, "project", paymentsId, {
      stale: ["c1"],
      dirty: ["stale", "edited"],
      generated: { by: "human", at: new Date().toISOString() },
    });
    // Forgetting the only cited note archives the concept (the deletion feed), so the relation to it dangles.
    await env.memory.forget({ ids: [c!.id] });
    await env.port.reconcile("project");
    await concept(env, "tickets", "Tickets", [["Tickets are triaged daily.", e!.id]]);
    const crowded = await lint(env, {
      maxClaimsPerConcept: 1,
      passStarts: Array.from({ length: UNBOUND_AFTER_PASSES }, () => "2999-01-01T00:00:00.000Z"),
    });
    assert.deepEqual(rules(crowded), [
      "candidate-only-claim",
      "human-edited",
      "over-claim-cap",
      "relation-missing-subject",
      "stale-claim",
      "unbound-note",
      "uncited-human-claim",
    ]);
    assert.equal(crowded.ok, true, "none of these fails the run");
    assert.equal(crowded.skipped, undefined);
    assert.ok(crowded.findings.some((finding) => finding.rule === "unbound-note" && finding.id === orphan!.id));
    assert.ok(crowded.findings.find((finding) => finding.rule === "uncited-human-claim")?.detail.includes("c3"));
    assert.equal(crowded.scopes[0]?.concepts, 3, "the archived concept is not live");

    // Without enough passes behind it, the gap rule says why it did not run.
    const early = await lint(env, { passStarts: ["2999-01-01T00:00:00.000Z"] });
    assert.match(early.skipped ?? "", /unbound-note needs 3 concept pass/);
    assert.equal(rules(early).includes("unbound-note"), false);
  });

  it("an_unresolved_citation_fails_the_run", async () => {
    const env = setup();
    const [a, b] = await Promise.all([env.note("alpha detail"), env.note("beta detail")]);
    await concept(env, "payments", "Payments service", [
      ["Retries use backoff.", a!.id],
      ["Inputs are validated.", b!.id],
    ]);
    // Removed behind the cascade's back (a restored backup, a hand-deleted file): the citation resolves to nothing.
    await env.vectorStore.delete({ tenantId: scope.tenantId, resourceId: "r-project", ids: [b!.id] });
    const report = await lint(env);
    assert.equal(report.ok, false);
    assert.deepEqual(rules(report), ["unresolved-citation"]);
    assert.equal(report.findings[0]?.id, "c2");
    assert.match(report.findings[0]?.detail ?? "", new RegExp(b!.id));
  });

  it("an_alias_collision_fails_the_run", async () => {
    const env = setup();
    const [a, b] = await Promise.all([env.note("alpha detail"), env.note("beta detail")]);
    await concept(env, "payments", "Payments service", [["Retries use backoff.", a!.id]]);
    await concept(env, "invoices", "Invoices", [["Invoices are monthly.", b!.id]], ["Payments service"]);
    const report = await lint(env);
    assert.equal(report.ok, false);
    assert.deepEqual(rules(report), ["alias-collision"]);
    assert.match(report.findings[0]?.detail ?? "", /payments service.*invoices and payments|belongs to invoices and payments/);
  });

  it("an_unparseable_body_is_reported_not_thrown", async () => {
    const env = setup();
    const a = await env.note("alpha detail");
    await concept(env, "payments", "Payments service", [["Retries use backoff.", a.id]]);
    const id = await idOf(env, "payments");
    await patchConcept(env, "project", id, { body: "this is not a concept body" });
    const report = await lint(env);
    assert.deepEqual(rules(report), ["invalid-body"]);
    assert.equal(report.ok, true);
  });

  it("team_concepts_are_linted_and_report_shared_without_evidence", async () => {
    const env = setup();
    const a = await env.note("alpha detail");
    await concept(env, "payments", "Payments service", [["Retries use backoff.", a.id]]);
    await attachTeam(env, [a.id]);
    const report = await lint(env, { scopes: ["team"] });
    assert.equal(report.scopes[0]?.scope, "team");
    assert.equal(report.scopes[0]?.concepts, 1);
    // The citation is provenance only: it is not an unresolved citation, and the report says it is not evidence.
    assert.deepEqual(rules(report), ["shared-without-evidence"]);
    assert.equal(report.ok, true);
    const all = await lint(env);
    assert.deepEqual(
      all.scopes.map((entry) => entry.scope),
      ["project", "team"],
    );
  });

  it("pass_never_edits_team_concepts", async () => {
    const env = setup();
    const a = await env.note("alpha detail");
    await attachTeam(env, [a.id]);
    // A team concept that would need a pass if the curator looked at it: a repair reason on the concept.
    await patchConcept(env, "team", "a1b2c3d4e5f6", { stale: ["c1"], dirty: ["stale"] });
    assert.equal((await env.port.dirty("team")).length, 1);
    const report = await runWikiPass({
      port: env.port,
      client: () => refuse,
      config: { minNotes: 1, minCoReads: 1, maxSubjectsPerPass: 8, maxClaimsPerConcept: 40, limits: resolveMemoryWorkerLimits() },
      trigger: "manual",
      declined: new Set(),
      lease: createWikiLease(),
    });
    assert.deepEqual(report.scopes, ["project"], "the team scope is never planned");
    assert.equal(report.modelCalls, 0);
    await assert.rejects(
      env.port.applyConceptEdits("team", [{ op: "retire_claim", subject: "deploys", claimId: "c1", reason: "x" }], {
        generatedBy: "consolidation",
      }),
      MemoryScopeError,
    );
  });

  it("lint_under_2s_for_2000_concepts", async () => {
    const env = setup();
    const notes = await Promise.all(Array.from({ length: 100 }, (_, i) => env.note(`measured evidence number ${i}`)));
    for (let batch = 0; batch < 2000; batch += 40) {
      const edits = Array.from({ length: 40 }, (_, offset) => {
        const n = batch + offset;
        return [
          { op: "create_subject" as const, subject: `topic-${n}`, title: `Topic ${n}`, conceptType: "topic" as const },
          { op: "add_claim" as const, subject: `topic-${n}`, text: `Fact ${n}.`, cites: [notes[n % notes.length]!.id] },
        ];
      }).flat();
      // 40 concepts × 2 edits would exceed one batch of 64: split.
      await env.port.applyConceptEdits("project", edits.slice(0, 40), { generatedBy: "consolidation" });
      await env.port.applyConceptEdits("project", edits.slice(40), { generatedBy: "consolidation" });
    }
    assert.equal((await env.port.subjects("project")).length, 2000);
    const started = performance.now();
    const report = await lint(env);
    const elapsed = performance.now() - started;
    assert.equal(report.scopes[0]?.concepts, 2000);
    assert.equal(report.ok, true);
    console.log(`lint over 2000 concepts: ${elapsed.toFixed(0)} ms`);
    assert.ok(elapsed < 2000, `lint took ${elapsed.toFixed(0)} ms`);
  });
});

describe("wiki:lint on a real agent", () => {
  it("wiki_lint_command_is_read_only_and_makes_no_model_call", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [
        mockProvider([[providerTextDelta("ok"), providerDone()]]),
        memorySystem({ ltm: {} }),
        wiki({ store: "memory", consolidate: { triggers: [] } }),
      ],
    });
    try {
      const out = (await agent.commands.run(WIKI_LINT_COMMAND_NAME, {})) as { ok: boolean; text: string; findings: unknown[] };
      assert.equal(out.ok, true);
      assert.match(out.text, /^wiki lint: ok, 0 findings\./);
      assert.match(out.text, /unbound-note needs 3 concept pass/);
      const one = (await agent.commands.run(WIKI_LINT_COMMAND_NAME, { scope: "project" })) as { scopes: { scope: WikiScopeLevel }[] };
      assert.deepEqual(
        one.scopes.map((entry) => entry.scope),
        ["project"],
      );
    } finally {
      await agent.dispose();
    }
  });

  it("the_rule_table_has_one_entry_per_rule_and_exactly_two_failing_rules", () => {
    const ids = LINT_RULES.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      LINT_RULES.filter((rule) => rule.fails).map((rule) => rule.id),
      ["unresolved-citation", "alias-collision"],
    );
  });
});
