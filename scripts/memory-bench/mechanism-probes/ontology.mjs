/** Plan 210 Task 2: ontology-tier probes (memory-wiki over the fabric). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mockCuratorEdits } from "../replay.mjs";
import { digest, events, fabricAgent, lastValue, packages, resultText, scripted, tailText } from "./harness.mjs";

const WIKI = "../../../packages/memory/wiki/src";

/** The real fabric ontology over an in-memory store, wired the way the package wires it (wiki tests' setup). */
async function env(levels = ["project"], ontologyOptions = {}) {
  const { fabric } = await packages();
  const core = await import("@arnilo/prism-memory-core");
  const vectorStore = core.createMemoryVectorStore();
  const memories = new Map(
    levels.map((level) => [level, fabric.createMemory({ tenantId: "t", threadId: "th", resourceId: `r-${level}`, vectorStore })]),
  );
  const ontology = fabric.createFabricOntology({
    scopes: [...memories].map(([level, memory]) => ({ level, memory })),
    store: vectorStore,
    ...ontologyOptions,
  });
  const fabrics = new Map(
    [...memories].map(([level, memory]) => [
      level,
      fabric.createMemoryFabric({ memory, vectorStore, consolidate: false, subjects: ontology.subjects, ...ontologyOptions.fabric }),
    ]),
  );
  const note = (text, options = {}) =>
    fabrics.get(options.level ?? "project").remember({
      kind: "fact",
      content: text,
      ...(options.subject ? { subject: options.subject } : {}),
      ...(options.keywords ? { keywords: options.keywords } : {}),
    });
  const coRead = async (ids, turns) => {
    const memory = memories.get("project");
    for (const id of ids)
      await memory.patchMetadata(id, (metadata) => {
        const parsed = fabric.parseMemoryNoteMetadata(metadata);
        const events = Array.from({ length: turns }, (_, turn) => ({ s: 1, t: turn + 1, with: ids.filter((other) => other !== id) }));
        return { ...metadata, fabric: fabric.encodeMemoryNoteMetadata({ ...parsed, coRead: events }) };
      });
  };
  return { vectorStore, memories, ontology, port: ontology.port, fabrics, note, coRead };
}

/** Capture the fabric's ontology port, as the wiki consumes it. */
async function grabPort(holder) {
  const { prism, fabric } = await packages();
  return prism.definePackage({
    name: "@probe/grab-port",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      holder.value = api.services.consume(fabric.MEMORY_FABRIC_SERVICE);
    },
  })();
}

/** A concept on `payments` with two cited claims. */
async function seeded(e) {
  const a = await e.note("payments retries use exponential backoff", { subject: "payments" });
  const b = await e.note("payments inputs are validated with zod", { subject: "payments" });
  await e.port.applyConceptEdits(
    "project",
    [
      { op: "create_subject", subject: "payments", title: "Payments service", conceptType: "entity", aliases: ["billing"] },
      { op: "add_claim", subject: "payments", text: "Retries use exponential backoff.", cites: [a.id] },
      { op: "add_claim", subject: "payments", text: "Inputs are validated with zod.", cites: [b.id] },
    ],
    { generatedBy: "consolidation" },
  );
  await e.port.settle("project", "payments");
  return { a, b };
}

const plan = async (e, triggers, extra = {}) => {
  const { planScope, resolveTriggers } = await import(`${WIKI}/consolidate/triggers.ts`);
  return planScope(e.port, "project", { triggers: resolveTriggers(triggers), minNotes: 5, minCoReads: 2, declined: new Set(), ...extra });
};

/** A scripted curator client answering `edit_concept` with the bench's deterministic edits. */
async function curator(calls) {
  const { testing } = await packages();
  return {
    model: { provider: "probe", model: "curator" },
    async *generate(request) {
      calls.push(1);
      yield testing.providerToolCall(testing.toolCallContent(`e${calls.length}`, "edit_concept", { edits: mockCuratorEdits(request) }));
      yield testing.providerDone();
    },
  };
}

/** Package arm: fabric + wiki, three keyword-clustered notes, one `wiki:consolidate`, then a concept recall. */
export async function tierArm(dir, { wiki = true, fabricConfig = {}, after, edits = mockCuratorEdits, agentOptions = {} } = {}) {
  const ev = await events();
  let curatorCalls = 0;
  const { memoryWiki } = await import(`${WIKI}/index.ts`);
  const s = scripted().queue({
    calls: [
      { name: "memory.recall", args: { query: "deploy pipeline approval", ...(wiki ? { kinds: ["concept"] } : { kinds: ["concept"] }) } },
    ],
  });
  const h = await fabricAgent(dir, {
    config: { rules: false, ...fabricConfig },
    respond: s.respond,
    worker: (request, ctx) => {
      if (ctx.toolTurn) return ev.say("");
      curatorCalls++;
      return ev.call("edit_concept", { edits: edits(request) });
    },
    seed: async ({ writer }) => {
      for (const text of ["deploys go through the pipeline", "the pipeline deploys on tag", "pipeline deploy needs approval"])
        await writer.remember({ kind: "fact", content: text, keywords: ["deploy"], scope: "project" });
    },
    afterPackages: wiki ? [memoryWiki({ consolidate: { model: "worker/main", minNotes: 3 } })] : [],
    agentOptions,
  });
  try {
    const pass = wiki
      ? await h.command("wiki:consolidate", {}, "probe").catch((error) => ({ error: String(error?.message ?? error) }))
      : undefined;
    await h.run("probe", "how do deploys work");
    const value = lastValue(h);
    const extra = after ? await after(h) : undefined;
    return {
      pass,
      curatorCalls,
      value,
      text: resultText(h.toolResults.at(-1)?.result),
      concepts: (await h.notes()).filter((note) => note.metadata?.kind === "concept").length,
      extra,
      h,
    };
  } finally {
    await h.close();
  }
}

export const probes = [
  {
    id: "ontology.tier",
    async run(root) {
      const on = await tierArm(join(root, "on"));
      const off = await tierArm(join(root, "off"), { wiki: false });
      return {
        surface: "tool-result",
        property:
          "with memory-wiki over the fabric, a curator pass turns a note cluster into a concept that recall renders with cited claims; without the wiki no concept is ever written",
        fires: on.concepts,
        reaches: digest(on.text) !== digest(off.text),
        correct:
          on.concepts >= 1 &&
          on.value?.hits?.some((hit) => hit.kind === "concept") &&
          !(off.value?.hits ?? []).some((hit) => hit.kind === "concept"),
        on: digest(on.text),
        off: digest(off.text),
        counts: { concepts: on.concepts, curatorCalls: on.curatorCalls },
      };
    },
  },
  {
    id: "kind.concept",
    async run(root) {
      const on = await tierArm(join(root, "on"));
      const hit = on.value?.hits?.find((item) => item.kind === "concept");
      return {
        surface: "tool-result",
        property: "a concept note renders as [id] level concept subject with its current claims and the ids they cite",
        fires: hit ? 1 : 0,
        reaches: /concept/.test(on.text),
        correct: hit !== undefined && new RegExp(`\\[${hit.id}\\] project concept`).test(on.text),
        on: digest(on.text),
        off: digest(""),
      };
    },
  },
  {
    id: "ontology.curator-pass",
    async run() {
      const { runWikiPass, createWikiLease } = await import(`${WIKI}/consolidate/pass.ts`);
      const { resolveMemoryWorkerLimits } = await import("@arnilo/prism-memory-observational");
      const { fabric } = await packages();
      const arm = async (withEvidence) => {
        const e = await env();
        await seeded(e);
        if (withEvidence)
          for (let i = 0; i < 3; i++) await e.note(`payments detail ${i}: refunds reuse the retry queue ${i}`, { subject: "payments" });
        const calls = [];
        const client = await curator(calls);
        const report = await runWikiPass({
          port: e.port,
          client: () => client,
          config: { minNotes: 3, minCoReads: 2, maxSubjectsPerPass: 8, maxClaimsPerConcept: 40, limits: resolveMemoryWorkerLimits() },
          trigger: "manual",
          declined: new Set(),
          lease: createWikiLease(),
        });
        const row = (await e.port.subjects("project")).find((entry) => entry.subject === "payments");
        const [view] = row ? await e.port.read("project", [row.conceptId]) : [];
        const doc = view ? fabric.parseConceptBody(view.text, { allowUncited: true }) : undefined;
        return { report, calls: calls.length, claims: doc?.claims.length ?? 0, d: digest(doc?.claims.map((claim) => claim.text)) };
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "stored-note",
        property: "a due subject gets one edit_concept call; a valid cited edit lands as a claim; a quiet scope makes no call",
        fires: on.calls,
        reaches: on.d !== off.d,
        correct: on.calls >= 1 && on.claims > 2 && off.calls === 0 && off.claims === 2,
        on: on.d,
        off: off.d,
        counts: { modelCalls: on.calls, claims: on.claims },
      };
    },
  },
  {
    id: "ontology.trigger.co-read",
    async run() {
      const e = await env();
      await seeded(e);
      const x = await e.note("payments detail 0: refunds reuse the retry queue", { subject: "payments" });
      const y = await e.note("payments detail 1: refunds share the dlq", { subject: "payments" });
      const before = await plan(e, ["co-read"]);
      await e.coRead([x.id, y.id], 2);
      const after = await plan(e, ["co-read"]);
      const accumulation = await plan(e, ["accumulation"]);
      return {
        surface: "curator-plan",
        property: "two bound notes cited together in minCoReads turns make their subject due before the accumulation threshold",
        fires: after.length,
        reaches: after.length !== before.length,
        correct: after.length === 1 && after[0].reasons.includes("co-read") && before.length === 0 && accumulation.length === 0,
        on: digest(after.map((item) => item.reasons)),
        off: digest(before.map((item) => item.reasons)),
      };
    },
  },
  {
    id: "ontology.trigger.accumulation",
    async run() {
      const e = await env();
      await seeded(e);
      const before = await plan(e, ["accumulation"], { minNotes: 3 });
      for (let i = 0; i < 3; i++) await e.note(`payments detail ${i}: refunds reuse the retry queue ${i}`, { subject: "payments" });
      const after = await plan(e, ["accumulation"], { minNotes: 3 });
      return {
        surface: "curator-plan",
        property: "minNotes uncited bound notes make their subject due",
        fires: after.length,
        reaches: after.length !== before.length,
        correct: after.length === 1 && after[0].reasons.includes("accumulation") && before.length === 0,
        on: digest(after.map((item) => item.reasons)),
        off: digest(before.map((item) => item.reasons)),
      };
    },
  },
  {
    id: "ontology.trigger.repair",
    async run() {
      const e = await env();
      const { a } = await seeded(e);
      const before = await plan(e, []);
      await e.ontology.retract({ ids: [a.id], reason: "forgotten" });
      const after = await plan(e, []);
      return {
        surface: "curator-plan",
        property: "forgetting a cited note leaves its concept due for repair even with every other trigger off",
        fires: after.length,
        reaches: after.length !== before.length,
        correct: after.length === 1 && after[0].reasons.includes("repair") && before.length === 0,
        on: digest(after.map((item) => item.reasons)),
        off: digest(before.map((item) => item.reasons)),
      };
    },
  },
  {
    id: "ontology.binding-deterministic",
    async run() {
      const arm = async (bindThreshold) => {
        const e = await env(["project"], { bindThreshold });
        await seeded(e);
        // One token of the subject's name (payments), none of its title's second token or alias.
        const note = await e.note("the payments retries back off slowly");
        const { fabric } = await packages();
        return fabric.parseMemoryNoteMetadata((await e.memories.get("project").getEntry(note.id))?.metadata)?.subject;
      };
      const on = await arm(1);
      const off = await arm(2);
      return {
        surface: "stored-note",
        property: "a new note containing bindThreshold tokens of a subject's name binds to that subject",
        fires: on === "payments" ? 1 : 0,
        reaches: on !== off,
        correct: on === "payments" && off === undefined,
        on: digest(on ?? null),
        off: digest(off ?? null),
        finding: "At the default bindThreshold 2 a note naming one token of a two-token subject title does not bind; threshold 1 binds it.",
      };
    },
  },
  {
    id: "ontology.binding-extractor",
    async run(root) {
      // The extractor may name a shown subject on a note it records; the write binds it.
      const ev = await events();
      const { memoryWiki } = await import(`${WIKI}/index.ts`);
      const arm = async (name, subject) => {
        let sawSubjects = false;
        const port = {};
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, promote: { model: "worker/main", minTurnsBetween: 1, derivableFrom: [], minScore: 0 } },
          respond: scripted().respond,
          worker: (request, ctx) => {
            if (ctx.toolTurn) return ev.say("");
            const schema = JSON.stringify(request.tools ?? []);
            if (/subject/.test(schema)) sawSubjects = true;
            return ev.call("record_notes", {
              notes: [
                {
                  // No token of the subject's name, so only the extractor's subject can bind it (not bindThreshold).
                  text: "the weekly cadence moves to thursdays",
                  kind: "fact",
                  scope: "project",
                  keywords: [],
                  aliases: [],
                  evidence: ["c1"],
                  explicit: true,
                  correction: false,
                  generality: 1,
                  ephemerality: 0,
                  derivable: false,
                  ...(subject ? { subject } : {}),
                },
              ],
            });
          },
          afterPackages: [memoryWiki({ consolidate: { triggers: [] } }), await grabPort(port)],
        });
        try {
          // The extractor may only name a subject it was shown; create it first through the port the wiki uses.
          const evidence = await h.writer.remember({ kind: "fact", content: "the release train schedule is weekly", scope: "project" });
          await port.value.applyConceptEdits(
            "project",
            [
              { op: "create_subject", subject: "release-train", title: "Release train", conceptType: "topic", aliases: [] },
              { op: "add_claim", subject: "release-train", text: "The release train runs weekly.", cites: [evidence.id] },
            ],
            { generatedBy: "consolidation" },
          );
          await h.run("probe", "Remember that the weekly cadence moves to thursdays.");
          await h.command("memory:consolidate", {}, "probe");
          await h.settle();
          const note = (await h.notes()).find((row) => /moves to thursdays/.test(row.text ?? "") && row.metadata?.kind === "fact");
          return { subject: note?.metadata?.subject, sawSubjects, written: note !== undefined };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", "release-train");
      const off = await arm("off", undefined);
      return {
        surface: "stored-note",
        property: "a subject the extractor names on a recorded note binds that note (the tier then curates it)",
        fires: on.subject ? 1 : 0,
        reaches: on.subject !== off.subject,
        correct: on.written && on.subject === "release-train" && off.subject === undefined,
        on: digest(on.subject ?? null),
        off: digest(off.subject ?? null),
        counts: { extractorSchemaNamesSubject: on.sawSubjects ? 1 : 0 },
      };
    },
  },
  {
    id: "ontology.concept-prior",
    async run() {
      const arm = async (conceptPrior) => {
        const e = await env(["project", "agent"], { fabric: { ontology: { conceptPrior } } });
        const { b } = await seeded(e);
        const f = e.fabrics.get("project");
        const hits = (await f.recall("payments inputs validated zod", { minSimilarity: 0, kinds: ["fact", "concept"] })).hits;
        return { first: hits[0]?.kind, order: hits.map((hit) => hit.kind), evidence: b.id };
      };
      const on = await arm(0.5);
      const off = await arm(0);
      return {
        surface: "recall-result",
        property: "the concept prior lifts a matching concept above its own evidence notes",
        fires: on.first === "concept" ? 1 : 0,
        reaches: digest(on.order) !== digest(off.order),
        correct: on.first === "concept" && off.first !== "concept",
        on: digest(on.order),
        off: digest(off.order),
      };
    },
  },
  {
    id: "ontology.passive-pointer",
    async run(root) {
      // A subject whose name the turn names in full (deploy pipeline), so the concept is in play.
      const named = (request) =>
        mockCuratorEdits(request).map((edit) =>
          edit.op === "create_subject"
            ? { ...edit, subject: "deploy-pipeline", title: "Deploy pipeline" }
            : edit.op === "bind"
              ? { ...edit, subject: "deploy-pipeline" }
              : // A fixed claim text: the mock's claim follows id order, and ids are random per run.
                { ...edit, text: "Every deploy through the pipeline needs approval." },
        );
      const on = await tierArm(join(root, "on"), {
        edits: named,
        fabricConfig: { inject: { query: "user", minSimilarity: 0 } },
        after: async (h) => {
          await h.run("probe2", "how does the deploy pipeline approval work");
          return tailText(h.requests.at(-1)?.request ?? {});
        },
      });
      const off = await tierArm(join(root, "off"), {
        wiki: false,
        edits: named,
        fabricConfig: { inject: { query: "user", minSimilarity: 0 } },
        after: async (h) => {
          await h.run("probe2", "how does the deploy pipeline approval work");
          return tailText(h.requests.at(-1)?.request ?? {});
        },
      });
      return {
        surface: "request",
        property: "when a concept is in play for the turn, the passive tail adds one pointer line naming it instead of its text",
        fires: /concept/i.test(on.extra ?? "") ? 1 : 0,
        reaches: digest(on.extra) !== digest(off.extra),
        correct: /concept/i.test(on.extra ?? "") && !/concept/i.test(off.extra ?? ""),
        on: digest(on.extra),
        off: digest(off.extra),
      };
    },
  },
  {
    id: "ontology.concept-sharing",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, share) => {
        await mkdir(join(root, name, ".prism/memory"), { recursive: true });
        const ui = testing.createScriptedHostUi({ confirm: true });
        let status;
        const result = await tierArm(join(root, name), {
          fabricConfig: { team: { dir: ".prism/memory", write: "ask" } },
          agentOptions: { host: { ui: ui.ui } },
          after: async (h) => {
            const id = h.toolResults
              .findLast((row) => row.name === "memory.recall")
              ?.result?.value?.hits?.find((hit) => hit.kind === "concept")?.id;
            const shared =
              share && id
                ? await h.command("memory:share", { id }, "probe").catch((error) => ({ error: String(error?.message ?? error) }))
                : undefined;
            status = await h.command("memory:status", {}, "probe");
            return { id, shared };
          },
        });
        return { team: status?.team, extra: result.extra };
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      const count = (arm) => (arm.team?.verified ?? 0) + (arm.team?.candidate ?? 0);
      return {
        surface: "stored-note",
        property: "memory:share copies a concept into the team store, where its claims stand on the share",
        fires: count(on),
        reaches: count(on) !== count(off),
        correct: count(on) >= 1 && count(off) === 0,
        on: digest(count(on)),
        off: digest(count(off)),
        counts: { shareError: on.extra?.shared?.error ? 1 : 0 },
      };
    },
  },
  {
    id: "ontology.source-ingest",
    async run(root) {
      const { memoryWiki } = await import(`${WIKI}/index.ts`);
      const arm = async (name, wiki) => {
        const dir = join(root, name);
        await mkdir(join(dir, "docs"), { recursive: true });
        await writeFile(join(dir, "docs", "adr-7.md"), "ADR 7: billing events are idempotent by event id.\n");
        const s = scripted().queue({
          calls: [
            ...(wiki ? [{ name: "wiki_ingest", args: { path: "docs/adr-7.md" } }] : []),
            { name: "memory.recall", args: { query: "billing events idempotent" } },
          ],
        });
        const h = await fabricAgent(dir, {
          config: { rules: false },
          respond: s.respond,
          afterPackages: wiki ? [memoryWiki({ workspaceRoot: dir, consolidate: { triggers: [] } })] : [],
        });
        try {
          await h.run("probe", "ingest the adr");
          const ingest = h.toolResults.find((row) => row.name === "wiki_ingest");
          const hits = lastValue(h)?.hits ?? [];
          return {
            ingested: ingest?.result?.value?.id !== undefined || /indexed|staged|id/i.test(resultText(ingest?.result)),
            hits: hits.length,
            d: digest(resultText(h.toolResults.at(-1)?.result)),
          };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "tool-result",
        property: "wiki_ingest stages a workspace file under the memory root and indexes its extract as a file note recall returns",
        fires: on.ingested ? 1 : 0,
        reaches: on.d !== off.d,
        correct: on.ingested && on.hits >= 1,
        on: on.d,
        off: off.d,
        counts: { hitsOn: on.hits, hitsOff: off.hits },
      };
    },
  },
  {
    id: "ontology.coding-o6",
    async run(root) {
      const on = await tierArm(join(root, "on"), { fabricConfig: { preset: "coding" } });
      const off = await tierArm(join(root, "off"), { wiki: false, fabricConfig: { preset: "coding" } });
      return {
        surface: "tool-result",
        property: "the tier composes with the coding preset: a pass under preset coding still yields a recallable concept",
        fires: on.concepts,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.concepts >= 1 && on.value?.hits?.some((hit) => hit.kind === "concept"),
        on: digest(on.text),
        off: digest(off.text),
      };
    },
  },
];
