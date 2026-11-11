/**
 * Plan 210 Task 2: ontology probes. Since plan 216 Task 3 the ontology is the wiki's: concepts live in its own store and
 * read the fabric (LTM) only through the read-only `memory.ltm` port. The probes drive that path; the three mechanisms
 * plan 216 removed (extractor binding, the recall concept prior, concept sharing to the team store) report so.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mockCuratorEdits } from "../replay.mjs";
import { digest, events, fabricAgent, lastValue, packages, resultText, scripted } from "./harness.mjs";

const WIKI = "../../../packages/knowledge/wiki/src";

/** The wiki's ontology over the real fabric (LTM, read only) and an in-memory wiki store (the wiki tests' setup). */
async function env(levels = ["project"], ontologyOptions = {}) {
  const { fabric } = await packages();
  const core = await import("@arnilo/prism-memory-system/core");
  const { createWikiOntology } = await import(`${WIKI}/ontology/port.ts`);
  const vectorStore = core.createMemoryVectorStore();
  const memories = new Map(
    levels.map((level) => [level, fabric.createMemory({ tenantId: "t", threadId: "th", resourceId: `r-${level}`, vectorStore })]),
  );
  const ltm = fabric.createMemoryLtmPort({ scopes: () => [...memories].map(([level, memory]) => ({ level, memory, store: vectorStore })) });
  const ontology = createWikiOntology({ ltm: () => ltm, ...ontologyOptions });
  const fabrics = new Map(
    [...memories].map(([level, memory]) => [level, fabric.createLongTermMemory({ memory, vectorStore, consolidate: false })]),
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
  return { vectorStore, memories, ontology, port: ontology, fabrics, note, coRead };
}

/** The concepts the agent's wiki wrote, read from its store on disk. */
async function wikiConcepts(root) {
  const { createMarkdownWikiStore } = await import(`${WIKI}/store.ts`);
  return (await createMarkdownWikiStore({ root }).concepts("project")).filter((record) => record.status !== "archived");
}

/** The wiki's passive block in a request (its `context.build` block, id `wiki:pointer`). */
const wikiPointerText = (request) =>
  (request.context ?? [])
    .filter((block) => block.id === "wiki:pointer")
    .map((block) => (typeof block.content === "string" ? block.content : ""))
    .join("\n");

/** A mechanism plan 216 Task 3 removed: reported, not probed. */
const removed = (property, finding) => ({ surface: "unspecified", property, fires: 0, reaches: false, correct: true, finding });

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

/** Package arm: fabric + wiki, three keyword-clustered notes, one `wiki:consolidate`, then a `wiki.search` (off: a recall). */
export async function tierArm(dir, { wiki = true, fabricConfig = {}, after, edits = mockCuratorEdits, agentOptions = {} } = {}) {
  const ev = await events();
  let curatorCalls = 0;
  const { wiki: wikiPackage } = await import(`${WIKI}/index.ts`);
  // Outside the fabric's tools.root: the fabric mirrors files under its root as notes, the wiki's included.
  const knowledgeRoot = `${dir}-wiki`;
  const s = scripted().queue({
    calls: [
      wiki
        ? { name: "wiki.search", args: { query: "deploy pipeline approval" } }
        : { name: "memory.recall", args: { query: "deploy pipeline approval" } },
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
    afterPackages: wiki ? [wikiPackage({ root: knowledgeRoot, consolidate: { model: "worker/main", minNotes: 3 } })] : [],
    agentOptions,
  });
  try {
    const pass = wiki
      ? await h.command("wiki:consolidate", {}, "probe").catch((error) => ({ error: String(error?.message ?? error) }))
      : undefined;
    await h.run("probe", "how do deploys work");
    const value = lastValue(h, wiki ? "wiki.search" : "memory.recall");
    const extra = after ? await after(h) : undefined;
    return {
      pass,
      curatorCalls,
      value,
      text: resultText(h.toolResults.at(-1)?.result),
      concepts: wiki ? (await wikiConcepts(knowledgeRoot)).length : 0,
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
          "with the wiki beside the fabric, a curator pass turns a memory note cluster into a concept in the wiki's store that wiki.search renders with cited claims; without the wiki no concept is ever written",
        fires: on.concepts,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.concepts >= 1 && (on.value?.concepts?.length ?? 0) >= 1 && off.concepts === 0,
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
      const hit = on.value?.concepts?.[0];
      return {
        surface: "tool-result",
        property:
          "a concept (the wiki's, not a memory kind) renders in wiki.search as [id] level concept subject with its current claims and the ids they cite",
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
      const { resolveMemoryWorkerLimits } = await import("@arnilo/prism-memory-system/core");
      const { parseConceptBody } = await import(`${WIKI}/ontology/codec.ts`);
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
        const doc = view ? parseConceptBody(view.text, { allowUncited: true }) : undefined;
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
      await e.port.refresh();
      const before = await plan(e, []);
      // The wiki reads memory's deletion feed: forgetting a cited note cascades on the next refresh.
      await e.memories.get("project").forget({ ids: [a.id] });
      await e.port.refresh();
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
        // One token of the subject's name (payments), none of its title's second token or alias. The wiki binds on its pass.
        const note = await e.note("the payments retries back off slowly");
        await e.port.bindPending("project");
        return (await e.port.store.bindings("project")).get(note.id);
      };
      const on = await arm(1);
      const off = await arm(2);
      return {
        surface: "stored-note",
        property:
          "a new memory note containing bindThreshold tokens of a subject's name is bound to that subject by the wiki's pass (memory is never written)",
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
    async run() {
      return removed(
        "removed by plan 216 Task 3: LTM never binds a note to a subject, so the extractor is shown no subject list and its subject is ignored",
        "The extractor schema keeps an ignored free `subject` string for byte-stable tool bytes; binding is the wiki's (ingest and pass).",
      );
    },
  },
  {
    id: "ontology.concept-prior",
    async run() {
      return removed(
        "removed by plan 216 Task 3: memory.recall holds no concepts, so there is no concept prior; wiki.search ranks concepts on their own",
        "The concept-first stage left memory recall with the ontology.",
      );
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
          return wikiPointerText(h.requests.at(-1)?.request ?? {});
        },
      });
      const off = await tierArm(join(root, "off"), {
        wiki: false,
        edits: named,
        fabricConfig: { inject: { query: "user", minSimilarity: 0 } },
        after: async (h) => {
          await h.run("probe2", "how does the deploy pipeline approval work");
          return wikiPointerText(h.requests.at(-1)?.request ?? {});
        },
      });
      return {
        surface: "request",
        property: "when a concept is in play for the turn, the wiki's passive block adds one pointer line naming it instead of its text",
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
    async run() {
      return removed(
        "removed by plan 216 Task 3: memory:share shares facts, preferences and procedures; a team concept is a file a person checks into the wiki's team scope",
        "The wiki reads its team scope read only and reviews every load; there is no share command for a concept yet.",
      );
    },
  },
  {
    id: "ontology.source-ingest",
    async run(root) {
      const { wiki: wikiPackage } = await import(`${WIKI}/index.ts`);
      const arm = async (name, wiki) => {
        const dir = join(root, name);
        await mkdir(join(dir, "docs"), { recursive: true });
        await writeFile(join(dir, "docs", "adr-7.md"), "ADR 7: billing events are idempotent by event id.\n");
        const s = scripted().queue({ calls: [...(wiki ? [{ name: "wiki_ingest", args: { path: "docs/adr-7.md" } }] : [])] });
        const h = await fabricAgent(dir, {
          config: { rules: false },
          respond: s.respond,
          // Outside the fabric's tools.root: the fabric mirrors files under its root as notes, the wiki's included.
          afterPackages: wiki ? [wikiPackage({ workspaceRoot: dir, root: `${dir}-wiki`, consolidate: { triggers: [] } })] : [],
        });
        try {
          await h.run("probe", "ingest the adr");
          const ingest = h.toolResults.find((row) => row.name === "wiki_ingest");
          const value = ingest?.result?.value;
          const memoryFiles = (await h.notes()).filter((note) => note.metadata?.kind === "file").length;
          return {
            ingested: value?.indexed === true && typeof value?.noteId === "string",
            memoryFiles,
            d: digest([value?.indexed ?? null, value?.scope ?? null, memoryFiles]),
          };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "tool-result",
        property:
          "wiki_ingest stages a workspace file under the wiki root and records it as a wiki source the concept pass can cite; memory gains no note",
        fires: on.ingested ? 1 : 0,
        reaches: on.d !== off.d,
        correct: on.ingested && on.memoryFiles === off.memoryFiles,
        on: on.d,
        off: off.d,
        counts: { memoryFilesOn: on.memoryFiles, memoryFilesOff: off.memoryFiles },
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
        property: "the wiki composes with the coding preset: a pass under preset coding still yields a concept wiki.search returns",
        fires: on.concepts,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.concepts >= 1 && (on.value?.concepts?.length ?? 0) >= 1,
        on: digest(on.text),
        off: digest(off.text),
      };
    },
  },
];
