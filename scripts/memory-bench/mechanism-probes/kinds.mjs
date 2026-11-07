/** Plan 210 Task 2: note-kind probes (episode view, fact, preference, procedure, decision, file, lessons). */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, fabricAgent, lastValue, packages, receivedText, resultText, scripted, SCOPE, tailSourceText } from "./harness.mjs";
import { lib } from "./lifecycle.mjs";
import { toolArm } from "./retrieval.mjs";

/** A host package that appends one OM observation to the session ledger, as observational memory would. */
async function observation(item) {
  const { prism } = await packages();
  const om = await import("@arnilo/prism-memory-observational");
  return prism.definePackage({
    name: "@probe/observation",
    version: "0.0.0",
    requires: { api: 1 },
    capabilities: ["session-state"],
    setup(api) {
      const log = api.state.log("ledger");
      let done = false;
      api.hooks.on("turn.completed", async (_event, context) => {
        if (done) return;
        done = true;
        await log.append(context.session, { type: om.OBSERVATIONS_RECORDED, observations: [item] });
      });
    },
  })();
}

export const probes = [
  {
    id: "kind.episode",
    async run(root) {
      const { fabric } = await packages();
      const id = "0b5e00000001";
      const h = await fabricAgent(join(root, "om"), {
        config: { rules: false },
        extraPackages: [await observation({ id, content: "user debugged the flaky friday deploy", timestamp: "2026-01-01T00:00:00.000Z", relevance: "high", sourceEntryIds: [], tokenCount: 7 })],
      });
      try {
        await h.run("probe", "hello");
        const session = await h.session("probe");
        const before = (await h.stores.vectorStore.getByThread(SCOPE)).length;
        const viewer = fabric.createMemoryFabric({ memory: h.memory, vectorStore: h.stores.vectorStore, consolidate: false, observational: { session } });
        const view = await viewer.remember({ kind: "episode", id });
        const after = (await h.stores.vectorStore.getByThread(SCOPE)).length;
        const without = await h.writer.remember({ kind: "episode", id }).then(() => "accepted", (error) => (/requires createMemoryFabric/.test(String(error?.message)) ? "refused" : "other"));
        return {
          surface: "library-result",
          property: "kind episode is a view of an observational-memory observation: the note carries its content and writes no row; without an OM source it is refused",
          fires: view?.kind === "episode" ? 1 : 0,
          reaches: /flaky friday deploy/.test(view?.content ?? ""),
          correct: view?.content === "user debugged the flaky friday deploy" && after === before && without === "refused",
          on: digest(view?.content),
          off: digest(without),
          finding: "The package never passes an observational source to its fabric and no tool writes kind episode, so the view is reachable only from a library host; episode rows in the store come only from the consolidation extractor (promote on), which both presets leave off.",
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "kind.fact",
    async run(root) {
      const seed = async ({ writer }) => writer.remember({ kind: "fact", content: "the api gateway timeout is thirty seconds", scope: "project" });
      const on = await toolArm(join(root, "on"), { seed, args: { query: "api gateway timeout" } });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "api gateway timeout", kinds: ["preference"] } });
      return {
        surface: "tool-result",
        property: "a fact note is stored at its scope and returned by the default recall kinds",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct: on.value?.hits?.[0]?.kind === "fact" && off.hits.length === 0,
        on: on.d,
        off: off.d,
      };
    },
  },
  {
    id: "kind.preference",
    async run() {
      const l = await lib({ scopes: (make, memory) => [{ level: "project", memory }, { level: "user", memory: make("user") }] });
      const pref = await l.fabric.remember({ kind: "preference", content: "prefer short commit messages" });
      const fact = await l.fabric.remember({ kind: "fact", content: "commit messages follow the template" });
      const userRow = await l.make("user").getEntry(pref.id);
      const projectRow = await l.memory.getEntry(fact.id);
      return {
        surface: "stored-note",
        property: "a preference without an explicit scope lands in the user scope; a fact lands in the project",
        fires: userRow ? 1 : 0,
        reaches: userRow !== undefined && (await l.memory.getEntry(pref.id)) === undefined,
        correct: userRow !== undefined && projectRow !== undefined,
        on: digest(Boolean(userRow)),
        off: digest(Boolean(projectRow)),
      };
    },
  },
  {
    id: "kind.procedure",
    async run(root) {
      const l = await lib({});
      await l.fabric.remember({ kind: "procedure", content: "to release, tag then run the publish job" });
      const lib1 = (await l.fabric.recall("release tag publish job", { minSimilarity: 0 })).hits.length;
      const lib2 = (await l.fabric.recall("release tag publish job", { minSimilarity: 0, kinds: ["procedure"] })).hits.length;
      const seed = async ({ writer }) => writer.remember({ kind: "procedure", content: "to release, tag then run the publish job", scope: "project" });
      const { blocksOf, tailText } = await import("./harness.mjs");
      const s = scripted();
      const h = await fabricAgent(join(root, "passive"), { config: { rules: false, inject: { query: "user", minSimilarity: 0 } }, seed, respond: s.respond });
      let passive = "";
      try {
        await h.run("probe", "how do I release, tag then publish job");
        passive = tailText(h.requests.at(-1)?.request ?? {});
      } finally {
        await h.close();
      }
      void blocksOf;
      return {
        surface: "recall-result",
        property: "a procedure is kept out of default library recall and passive injection; naming the kind returns it",
        fires: lib2,
        reaches: lib1 !== lib2,
        correct: lib1 === 0 && lib2 === 1 && !/publish job/.test(passive),
        on: digest(lib2),
        off: digest(lib1),
      };
    },
  },
  {
    id: "kind.decision",
    async run(root) {
      const s = scripted().queue({ calls: [{ name: "memory.insert", args: { kind: "decision", text: "validate api input with zod", rationale: "one validator everywhere" } }] });
      const h = await fabricAgent(join(root, "on"), { config: { rules: false }, respond: s.respond });
      try {
        await h.run("one", "we decided on zod");
        const id = /Remembered ([0-9a-f]{12})/.exec(resultText(h.toolResults.findLast((row) => row.name === "memory.insert")?.result))?.[1];
        const before = (await h.notes()).find((note) => note.id === id)?.metadata;
        for (const key of ["a", "b"]) await h.writer.recordUses(key, [id], { verifyAfterSessions: 2 });
        const after = (await h.notes()).find((note) => note.id === id)?.metadata;
        return {
          surface: "stored-note",
          property: "a decision is written proposed (a candidate) and becomes active once used in two sessions",
          fires: before?.decisionStatus === "proposed" ? 1 : 0,
          reaches: before?.decisionStatus !== after?.decisionStatus,
          correct: before?.decisionStatus === "proposed" && before?.status === "candidate" && after?.decisionStatus === "active",
          on: digest(after?.decisionStatus),
          off: digest(before?.decisionStatus),
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "kind.file",
    async run(root) {
      const arm = async (name, file) => {
        const dir = join(root, name);
        await mkdir(join(dir, "docs"), { recursive: true });
        if (file) await writeFile(join(dir, "docs", "runbook.md"), "Runbook: restart the ingest worker with the drain flag.\n");
        const s = scripted().queue({ calls: [{ name: "memory.recall", args: { query: "restart ingest worker drain", kinds: ["file"] } }] });
        const h = await fabricAgent(dir, { config: { rules: false }, respond: s.respond });
        try {
          await h.run("probe", "how do I restart ingest");
          return { hits: lastValue(h)?.hits ?? [], d: digest(resultText(h.toolResults.at(-1)?.result)) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "tool-result",
        property: "the startup reconcile indexes a file under tools.root as a file note that recall returns with its path",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct: on.hits.length === 1 && on.hits[0]?.kind === "file" && /runbook/.test(on.hits[0]?.path ?? "") && off.hits.length === 0,
        on: on.d,
        off: off.d,
      };
    },
  },
  {
    id: "lessons",
    async run(root) {
      const arm = async (name, nudge) => {
        const s = scripted();
        const h = await fabricAgent(join(root, name), { config: { rules: false, exchanges: {}, lessons: { nudge, minTurnsBetweenNudges: 1 } }, respond: s.respond });
        try {
          await h.run("probe", "Remember that the cache must be warmed before load tests.");
          await h.run("probe", "ok");
          const texts = h.requests.map((row) => tailSourceText(row.request, "fabric-lesson-nudge") + receivedText({ context: (row.request.context ?? []).filter((block) => block.metadata?.source === "fabric-lesson-nudge") }));
          return { nudges: texts.filter((text) => text.length > 0).length, d: digest(texts) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "request",
        property: "with lessons.nudge and the exchange archive, a remember/correction/fix turn adds one nudge to cite the exchange in a lesson",
        fires: on.nudges,
        reaches: on.d !== off.d,
        correct: on.nudges >= 1 && off.nudges === 0,
        on: on.d,
        off: off.d,
      };
    },
  },
];
