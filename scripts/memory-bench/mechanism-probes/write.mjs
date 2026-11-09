/** Plan 210 Task 2: write-path probes (consolidation, promotion, exchange archive, timeline, state). */
import { join } from "node:path";
import { digest, events, fabricAgent, lastValue, packages, receivedText, resultText, scripted } from "./harness.mjs";
import { lib } from "./lifecycle.mjs";
import { toolArm } from "./retrieval.mjs";

const NOTE = (text, extra = {}) => ({
  text,
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
  ...extra,
});

/** A host package that appends OM reflections to the session ledger, as observational memory would. */
async function reflections(items) {
  const { prism } = await packages();
  return prism.definePackage({
    name: "@probe/observations",
    version: "0.0.0",
    requires: { api: 1 },
    capabilities: ["session-state"],
    setup(api) {
      const log = api.state.log("ledger");
      api.hooks.on(
        "turn.completed",
        async (_event, context) => {
          if (items.length === 0) return;
          await log.append(context.session, { type: "memory.session.reflections.recorded", reflections: items.splice(0) });
        },
        { priority: 100 },
      );
    },
  })();
}

/** Promotion arm: one turn, optional OM reflections, the extractor answering `record_notes`. */
async function promotionArm(dir, { promote, ledger = [], text = "Remember that the release train leaves on thursdays.", command = false }) {
  const ev = await events();
  let extractorCalls = 0;
  let sawReflection = false;
  const h = await fabricAgent(dir, {
    config: { rules: false, ...(promote ? { promote: { model: "worker/main", minTurnsBetween: 1, derivableFrom: [], minScore: 0 } } : {}) },
    respond: scripted().respond,
    worker: (request, ctx) => {
      if (ctx.toolTurn) return ev.say("");
      extractorCalls++;
      const body = receivedText({ messages: request.messages });
      if (/orchard keys stay in the shed/.test(body)) sawReflection = true;
      return ev.call(
        "record_notes",
        { notes: [NOTE(sawReflection ? "orchard keys stay in the shed" : "the release train leaves on thursdays")] },
        `x${extractorCalls}`,
      );
    },
    extraPackages: ledger.length ? [await reflections(ledger)] : [],
  });
  try {
    await h.run("probe", text);
    await h.run("probe", "and one more thing");
    const consolidated = command ? await h.command("memory:consolidate", {}, "probe") : undefined;
    await h.settle();
    const promoted = (await h.notes()).filter(
      (note) => note.metadata?.generated?.by === "promotion" || note.metadata?.promotion !== undefined,
    );
    return { extractorCalls, sawReflection, promoted: promoted.length, consolidated, d: digest(promoted.map((note) => note.text)) };
  } finally {
    await h.close();
  }
}

export const probes = [
  {
    id: "write.consolidate-default",
    async run() {
      const arm = async (consolidate) => {
        const l = await lib({ consolidate });
        await l.fabric.remember({ kind: "fact", content: "the nightly backup job runs at two in the morning on the db host" });
        await l.fabric.remember({ kind: "fact", content: "the nightly backup job runs at two in the morning on the db host" });
        await l.fabric.remember({ kind: "fact", content: "the nightly backup job runs at three in the morning on the db host" });
        const hits = (await l.fabric.recall("nightly backup job db host", { minSimilarity: 0 })).hits;
        const { fabric } = await packages();
        const similar = hits.filter((hit) =>
          (fabric.parseMemoryNoteMetadata(hit.metadata ?? {})?.links ?? hit.links ?? []).some((link) => link.relation === "similar"),
        ).length;
        return { count: hits.length, similar, d: digest(hits.map((hit) => hit.content)) };
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "recall-result",
        property:
          "default consolidation folds a same-text write into the existing note; a near-duplicate (Dice ≥ 0.85) is kept as a new note with a similar link",
        fires: off.count - on.count,
        reaches: on.d !== off.d,
        correct: on.count === 2 && on.similar >= 1 && off.count === 3,
        on: on.d,
        off: off.d,
        counts: { notesOn: on.count, notesOff: off.count, similarLinks: on.similar },
      };
    },
  },
  {
    id: "write.consolidate-model-decider",
    async run(root) {
      const ev = await events();
      const arm = async (name, decider) => {
        let calls = 0;
        const s = scripted().queue(
          {
            calls: [
              {
                name: "memory.insert",
                args: { kind: "fact", text: "the platform team standup happens at nine every weekday morning in room four" },
              },
            ],
          },
          {
            calls: [
              {
                name: "memory.insert",
                args: { kind: "fact", text: "the platform team standup happens at ten every weekday morning in room four" },
              },
            ],
          },
          { calls: [{ name: "memory.recall", args: { query: "platform team standup weekday morning" } }] },
        );
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, ...(decider ? { consolidate: { decider: "model", model: "worker/main" } } : {}) },
          respond: s.respond,
          worker: (request, ctx) => {
            if (ctx.toolTurn) return ev.say("");
            calls++;
            const id = /"candidates":\[\{"id":"([0-9a-f]{12})"/.exec(receivedText({ messages: request.messages }))?.[1];
            return ev.call("decide_memory", id ? { action: "SUPERSEDE", id } : { action: "ADD" });
          },
        });
        try {
          for (const text of ["note it", "it moved", "when"]) await h.run("probe", text);
          const hits = lastValue(h)?.hits ?? [];
          return { calls, hits: hits.length, d: digest(hits.map((hit) => [hit.content, Boolean(hit.supersededBy)])) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "tool-result",
        property: "with decider model, a near-duplicate write asks the model once (ADD/UPDATE/SUPERSEDE/NOOP) and applies its answer",
        fires: on.calls,
        reaches: on.d !== off.d,
        correct: on.calls === 1 && on.hits === 1,
        on: on.d,
        off: off.d,
        counts: { modelCalls: on.calls, hitsOn: on.hits, hitsOff: off.hits },
      };
    },
  },
  {
    id: "write.session-consolidation",
    async run(root) {
      const on = await promotionArm(join(root, "on"), { promote: true, command: true });
      const off = await promotionArm(join(root, "off"), { promote: false, command: true });
      return {
        surface: "stored-note",
        property:
          "with promote on, a consolidation pass gathers the session's sources, makes one extractor call and writes candidate notes",
        fires: on.extractorCalls,
        reaches: on.d !== off.d,
        correct: on.extractorCalls >= 1 && on.promoted >= 1 && off.extractorCalls === 0 && off.promoted === 0,
        on: on.d,
        off: off.d,
        counts: { extractorCalls: on.extractorCalls, promoted: on.promoted },
      };
    },
  },
  {
    id: "write.om-promotion",
    async run(root) {
      const reflection = () => [
        { id: "cccccccccccc", content: "orchard keys stay in the shed", tokenCount: 7, supportingObservationIds: [] },
      ];
      const on = await promotionArm(join(root, "on"), { promote: true, ledger: reflection(), text: "ok thanks" });
      const off = await promotionArm(join(root, "off"), { promote: true, text: "ok thanks" });
      return {
        surface: "stored-note",
        property:
          "observational-memory reflections are consolidation sources: fresh OM material triggers the pass and the reflection reaches the extractor",
        fires: on.sawReflection ? 1 : 0,
        reaches: on.d !== off.d,
        correct: on.sawReflection && on.promoted >= 1 && off.extractorCalls === 0,
        on: on.d,
        off: off.d,
        counts: { extractorCallsOn: on.extractorCalls, extractorCallsOff: off.extractorCalls },
      };
    },
  },
  {
    id: "write.keyword-enrichment",
    async run(root) {
      const s = scripted().queue({ calls: [] }, { calls: [{ name: "memory.recall", args: { query: "travel", kinds: ["exchange"] } }] });
      const h = await fabricAgent(join(root, "on"), { config: { exchanges: {}, rules: false }, respond: s.respond });
      let on;
      try {
        await h.run("one", "I booked a flight to Lisbon for the spring.");
        await h.closeSession("one");
        await h.run("two", "what trips do I have");
        const note = (await h.notes()).find((row) => row.metadata?.kind === "exchange");
        on = {
          keywords: note?.metadata?.keywords ?? [],
          hits: lastValue(h)?.hits?.length ?? 0,
          d: digest(resultText(h.toolResults.at(-1)?.result)),
        };
      } finally {
        await h.close();
      }
      const seed = async ({ writer }) =>
        writer.remember({ kind: "exchange", content: "I booked a flight to Lisbon for the spring.", scope: "project" });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "travel", kinds: ["exchange"] } });
      return {
        surface: "tool-result",
        property: "the archive enriches each exchange with entity and category keywords, so a paraphrase (travel) finds a flight turn",
        fires: on.keywords.length,
        reaches: on.d !== off.d,
        correct: on.keywords.includes("travel") && on.hits === 1 && off.hits.length === 0,
        on: on.d,
        off: off.d,
        counts: { keywords: on.keywords.length },
      };
    },
  },
  {
    id: "write.exchange-steps",
    async run(root) {
      const { prism } = await packages();
      const tool = prism.definePackage({
        name: "@probe/tool",
        version: "0.0.0",
        requires: { api: 1 },
        setup(api) {
          api.tools.register({
            name: "deploy_status",
            description: "Check a deploy.",
            parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
            execute: (_args, context) => ({
              toolCallId: context.toolCallId,
              name: "deploy_status",
              value: { ok: true },
              content: [{ type: "text", text: "deploy is green" }],
            }),
          });
        },
      })();
      const arm = async (name, steps) => {
        const s = scripted().queue({ calls: [{ name: "deploy_status", args: { service: "billing" } }] });
        const h = await fabricAgent(join(root, name), {
          config: { exchanges: steps ? { steps: true } : {}, rules: false },
          respond: s.respond,
          extraPackages: [tool],
        });
        try {
          await h.run("one", "is the billing deploy healthy");
          await h.closeSession("one");
          const exchange = (await h.notes()).find((row) => row.metadata?.kind === "exchange");
          return { text: exchange?.text ?? "", d: digest(exchange?.text ?? "") };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "stored-note",
        property: "with exchanges.steps, the turn's tool steps (name, declared argument fields, outcome) are archived with the exchange",
        fires: /deploy_status/.test(on.text) ? 1 : 0,
        reaches: on.d !== off.d,
        correct: /deploy_status/.test(on.text) && /billing/.test(on.text) && !/deploy_status/.test(off.text),
        on: on.d,
        off: off.d,
      };
    },
  },
  {
    id: "timeline",
    async run(root) {
      // Write side: the exchange archive resolves a relative date against the turn's timestamp.
      const h = await fabricAgent(join(root, "archive"), { config: { exchanges: {}, rules: false }, respond: scripted().respond });
      let dates = [];
      try {
        await h.run("one", "Yesterday I bought the red bike.");
        await h.closeSession("one");
        dates = (await h.notes()).find((note) => note.metadata?.kind === "exchange")?.metadata?.dates ?? [];
      } finally {
        await h.close();
      }
      // Read side: from/to windows and time order.
      const l = await lib({});
      await l.fabric.remember({ kind: "fact", content: "bought the red bike", tRef: "2025-03-01T00:00:00.000Z" });
      await l.fabric.remember({ kind: "fact", content: "bought the blue bike", tRef: "2025-05-01T00:00:00.000Z" });
      await l.fabric.remember({ kind: "fact", content: "bought the green bike", tRef: "2025-04-01T00:00:00.000Z" });
      const windowed = (await l.fabric.recall("bought bike", { minSimilarity: 0, from: "2025-03-15", to: "2025-04-30" })).hits;
      const ordered = (await l.fabric.recall("bought bike", { minSimilarity: 0, order: "time" })).hits.map((hit) => hit.content);
      const all = (await l.fabric.recall("bought bike", { minSimilarity: 0 })).hits;
      return {
        surface: "recall-result",
        property:
          "the archive resolves a relative date at write time; from/to keeps only notes dated in the window; order time sorts oldest first",
        control: "trigger-absent",
        fires: dates.length + windowed.length,
        reaches: digest(windowed.map((hit) => hit.content)) !== digest(all.map((hit) => hit.content)),
        correct:
          dates.some((date) => date.resolved?.startsWith("2025-12-31")) &&
          windowed.length === 1 &&
          windowed[0].content.includes("green") &&
          ordered.join("|") === "bought the red bike|bought the green bike|bought the blue bike",
        on: digest(windowed.map((hit) => hit.content)),
        off: digest(all.map((hit) => hit.content)),
        counts: { resolvedDates: dates.length, windowed: windowed.length },
      };
    },
  },
  {
    id: "recall.state-grouping",
    async run() {
      const arm = async (keyed) => {
        const l = await lib({});
        await l.fabric.remember({
          kind: "fact",
          content: "the office is on floor two",
          ...(keyed ? { key: "office.floor" } : {}),
          tRef: "2025-01-01T00:00:00.000Z",
        });
        await l.fabric.remember({
          kind: "fact",
          content: "the office is on floor five now",
          ...(keyed ? { key: "office.floor" } : {}),
          tRef: "2025-06-01T00:00:00.000Z",
        });
        const hits = (await l.fabric.recall("office floor", { minSimilarity: 0 })).hits;
        return {
          marked: hits.filter((hit) => hit.supersededBy).length,
          first: hits[0]?.content ?? "",
          d: digest(hits.map((hit) => [hit.content, Boolean(hit.supersededBy)])),
        };
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "recall-result",
        property: "same-key hits form one group ordered newest first, and the older member carries a supersededBy hint (nothing removed)",
        control: "trigger-absent",
        fires: on.marked,
        reaches: on.d !== off.d,
        correct: on.marked === 1 && /five/.test(on.first) && off.marked === 0,
        on: on.d,
        off: off.d,
      };
    },
  },
  {
    id: "recall.state-wrapper",
    async run(root) {
      const ev = await events();
      const seed = async ({ writer }) => writer.remember({ kind: "fact", content: "the office is on floor five", scope: "project" });
      const arm = async (name, state) => {
        let calls = 0;
        const s = scripted().queue({ calls: [{ name: "memory.recall", args: { query: "office floor" } }] });
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, ...(state ? { state: { model: "worker/main" } } : {}) },
          seed,
          respond: s.respond,
          worker: (request) => {
            calls++;
            const id = /\b([0-9a-f]{12})\b/.exec(receivedText({ messages: request.messages }))?.[1] ?? "aaaaaaaaaaaa";
            return ev.say(`office | floor five | [${id}]`);
          },
        });
        try {
          await h.run("probe", "which floor");
          return { calls, text: resultText(h.toolResults.at(-1)?.result) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "tool-result",
        property: "state adds one model call per explicit recall and prepends a model-generated current-state table to the tool result",
        fires: on.calls,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.calls === 1 && /Current state/.test(on.text) && off.calls === 0 && !/Current state/.test(off.text),
        on: digest(on.text),
        off: digest(off.text),
      };
    },
  },
  {
    id: "tools.explicit-writes",
    async run(root) {
      const s = scripted().queue(
        { calls: [{ name: "memory.insert", args: { kind: "preference", scope: "project", text: "use tabs for indentation" } }] },
        { calls: [{ name: "memory.recall", args: { query: "indentation tabs" } }] },
      );
      const h = await fabricAgent(join(root, "on"), { config: { rules: false }, respond: s.respond });
      try {
        await h.run("probe", "remember: tabs");
        const id = (await h.notes()).find((note) => /tabs/.test(note.text ?? ""))?.id;
        s.queue(
          { calls: [{ name: "memory.replace", args: { id, old: "tabs", new: "spaces" } }] },
          { calls: [{ name: "memory.recall", args: { query: "indentation" } }] },
        );
        await h.run("probe", "find it");
        await h.run("probe", "change it");
        await h.run("probe", "find it again");
        const recalls = h.toolResults.filter((row) => row.name === "memory.recall").map((row) => resultText(row.result));
        const note = (await h.notes()).find((row) => row.id === id);
        return {
          surface: "tool-result",
          property: "memory.insert writes a typed note with agent provenance that recall returns; memory.replace edits that note in place",
          fires: id ? 2 : 0,
          reaches: digest(recalls[0]) !== digest(recalls[1]),
          correct:
            note?.metadata?.kind === "preference" &&
            note?.metadata?.generated?.by === "agent" &&
            /tabs/.test(recalls[0] ?? "") &&
            /spaces/.test(recalls[1] ?? ""),
          on: digest(recalls[1]),
          off: digest(recalls[0]),
        };
      } finally {
        await h.close();
      }
    },
  },
];
