/** Plan 210 Task 2: delivery-tier probes (passive tail, filters, rules, cues, directory, decision points). */
import { join } from "node:path";
import { answerAll, blocksOf, decider, digest, fabricAgent, lastValue, packages, receivedText, resultText, scripted, tailSourceText, tailText } from "./harness.mjs";

const PASSIVE = { inject: { query: "user", minSimilarity: 0 }, rules: false };

/** A fake `read` tool: the fabric records touched paths from file tools named read/edit/write. */
async function fileTools() {
  const { prism } = await packages();
  return prism.definePackage({
    name: "@probe/file-tools",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      api.tools.register({
        name: "read",
        description: "Read a file.",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        execute: (args, context) => ({ toolCallId: context.toolCallId, name: "read", value: { path: args.path }, content: [{ type: "text", text: "file body" }] }),
      });
    },
  })();
}

/** Run `turns` user turns in one session and return every main-model request. */
async function turns(dir, { config, seed, texts, plans = [], extraPackages = [], worker, after }) {
  const s = scripted().queue(...plans);
  const h = await fabricAgent(dir, { config, seed, respond: s.respond, extraPackages, worker });
  try {
    for (const text of texts) await h.run("probe", text);
    const extra = after ? await after(h) : undefined;
    return { requests: h.requests.map((row) => row.request), toolResults: h.toolResults, notes: await h.notes(), extra, workerRequests: h.workerRequests.length };
  } finally {
    await h.close();
  }
}

const lastRequest = (arm) => arm.requests.at(-1);
const reqDigest = (arm) => digest(arm.requests.map((request) => ({ context: request.context, messages: request.messages })));

const seedFacts = async ({ writer }) => {
  await writer.remember({ kind: "fact", content: "the staging cluster runs in frankfurt and fails over to dublin", scope: "project" });
  await writer.remember({ kind: "fact", content: "lunch orders close at eleven on fridays", scope: "project" });
};

/** One passive turn with a decisions provider; returns the tail text and the decision call keys. */
async function decisionArm(dir, { noul, points, config = PASSIVE, seed = seedFacts, text = "where does the staging cluster run", plans, extraPackages = [] }) {
  const d = await decider(answerAll(noul));
  const arm = await turns(dir, {
    config: { ...config, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
    seed,
    texts: [text],
    plans,
    extraPackages: [d.pkg, ...extraPackages],
  });
  return { ...arm, calls: d.calls, tail: tailText(lastRequest(arm) ?? {}) };
}

export const probes = [
  {
    id: "delivery.passive-tail",
    async run(root) {
      const on = await turns(join(root, "on"), { config: PASSIVE, seed: seedFacts, texts: ["where does the staging cluster run"] });
      const off = await turns(join(root, "off"), { config: { rules: false }, seed: seedFacts, texts: ["where does the staging cluster run"] });
      const tail = tailText(lastRequest(on));
      return {
        surface: "request",
        property: "with inject on, the turn's matching notes are delivered as an untrusted semantic tail after the transcript; the unrelated note is not",
        fires: blocksOf(lastRequest(on), "fabric-semantic").length + (tail ? 1 : 0),
        reaches: reqDigest(on) !== reqDigest(off),
        correct: /frankfurt/.test(tail) && !/lunch/.test(tail) && tailText(lastRequest(off)) === "",
        on: reqDigest(on),
        off: reqDigest(off),
      };
    },
  },
  {
    id: "delivery.precision-filter",
    async run(root) {
      const seed = async ({ writer }) => {
        await writer.remember({ kind: "fact", content: "the staging cluster runs in frankfurt", scope: "project" });
        await writer.remember({ kind: "fact", content: "the cluster picnic is in june", scope: "project" });
      };
      // Six query terms: the picnic note matches one (coverage 1/6, under the 0.2 floor).
      const text = "which city hosts the staging cluster deployment region";
      const on = await turns(join(root, "on"), { config: { inject: { query: "user" }, rules: false }, seed, texts: [text] });
      const off = await turns(join(root, "off"), { config: { inject: { query: "user", minSimilarity: 0, minScore: 0 }, rules: false }, seed, texts: [text] });
      const onTail = tailText(lastRequest(on));
      const offTail = tailText(lastRequest(off));
      return {
        surface: "request",
        property: "the default minSimilarity/minScore floors (0.2) drop a weak single-term match from passive delivery and keep the strong one",
        fires: /picnic/.test(offTail) && !/picnic/.test(onTail) ? 1 : 0,
        reaches: digest(onTail) !== digest(offTail),
        correct: /frankfurt/.test(onTail) && !/picnic/.test(onTail) && /picnic/.test(offTail),
        on: digest(onTail),
        off: digest(offTail),
      };
    },
  },
  {
    id: "delivery.weak-tool-caller",
    async run(root) {
      // A cued turn asks for a selection, list, count, comparison or time order (which, list, when, …).
      const texts = ["which city runs the staging cluster", "list the staging failover targets", "when did the staging cluster move"];
      const status = async (h) => h.command("memory:status", {}, "probe");
      // A partial match (coverage under fullTextScore 0.35) is a pointer card; excerpt mode delivers it whole.
      const longSeed = async ({ writer }) => writer.remember({ kind: "fact", content: "staging approvals need two reviewers from the platform group", scope: "project" });
      const on = await turns(join(root, "on"), { config: PASSIVE, seed: longSeed, texts, after: status });
      const reset = await turns(join(root, "reset"), {
        config: PASSIVE,
        seed: longSeed,
        texts,
        plans: [{ calls: [] }, { calls: [{ name: "memory.recall", args: { query: "staging" } }] }, { calls: [] }],
        after: status,
      });
      const single = await turns(join(root, "single"), { config: PASSIVE, seed: longSeed, texts: texts.slice(0, 1), after: status });
      const first = tailText(on.requests[0]);
      const third = tailText(on.requests[2]);
      return {
        surface: "request",
        property: "passive delivery starts as pointers and switches to excerpts after two cued turns without a memory.* call; a memory call resets it",
        fires: on.extra?.delivery === "excerpts" ? 1 : 0,
        reaches: digest(first) !== digest(third),
        correct: on.extra?.delivery === "excerpts" && reset.extra?.delivery !== "excerpts" && single.extra?.delivery !== "excerpts",
        on: digest(third),
        off: digest(first),
        counts: { switched: on.extra?.delivery === "excerpts" ? 1 : 0, oneTurnSessionSwitched: single.extra?.delivery === "excerpts" ? 1 : 0 },
        finding: "Needs two cued turns in one session; a one-question benchmark session never reaches the switch (oneTurnSessionSwitched 0).",
      };
    },
  },
  {
    id: "delivery.aggregation-abstention",
    async run(root) {
      const seed = async ({ writer }) => writer.remember({ kind: "fact", content: "the staging cluster runs in frankfurt", scope: "project" });
      const s = scripted().queue({ calls: [{ name: "memory.recall", args: { query: "zanzibar ferry timetable staging" } }, { name: "memory.recall", args: { query: "staging cluster" } }] });
      const h = await fabricAgent(join(root, "arm"), { seed, respond: s.respond });
      try {
        await h.run("probe", "look it up");
        const [weak, strong] = h.toolResults.filter((row) => row.name === "memory.recall");
        const description = h.requests[0]?.request.tools?.includes("memory.recall");
        const weakHits = weak?.result?.value?.hits?.length ?? -1;
        const strongHits = strong?.result?.value?.hits?.length ?? -1;
        return {
          surface: "tool-result",
          property: "a weak-only result (best coverage below 0.34) becomes an abstention line naming the terms and scopes; a strong one returns hits",
          control: "trigger-absent",
          fires: weakHits === 0 ? 1 : 0,
          reaches: /no matching memory for:/.test(resultText(weak?.result)) && !/no matching memory/.test(resultText(strong?.result)),
          correct: weakHits === 0 && strongHits === 1 && description === true,
          on: digest(weak?.result?.content),
          off: digest(strong?.result?.content),
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "delivery.directory",
    async run(root) {
      const seed = async ({ writer }) => {
        await writer.remember({ kind: "fact", content: "deploys go through the canary pool", tags: ["deploy"], scope: "project" });
        await writer.remember({ kind: "fact", content: "rollbacks drain the pool first", tags: ["deploy"], scope: "project" });
      };
      const on = await turns(join(root, "on"), { config: { rules: false }, seed, texts: ["hello"] });
      const off = await turns(join(root, "off"), { config: { rules: false, directory: false }, seed, texts: ["hello"] });
      const block = blocksOf(lastRequest(on), "fabric-directory");
      return {
        surface: "request",
        property: "the memory directory block lists note counts and topics (tags) in the context prefix",
        fires: block.length,
        reaches: reqDigest(on) !== reqDigest(off),
        correct: block.length === 1 && /deploy \(2\)|deploy/.test(receivedText({ context: block })) && blocksOf(lastRequest(off), "fabric-directory").length === 0,
        on: reqDigest(on),
        off: reqDigest(off),
      };
    },
  },
  {
    id: "delivery.standing-rules",
    async run(root) {
      const seed = async ({ writer }) => {
        const rule = await writer.remember({ kind: "preference", content: "always run the formatter before committing", scope: "project" });
        await writer.verify(rule.id);
      };
      const on = await turns(join(root, "on"), { seed, texts: ["hello"] });
      const off = await turns(join(root, "off"), { config: { rules: false }, seed, texts: ["hello"] });
      const block = blocksOf(lastRequest(on), "fabric-rules");
      return {
        surface: "request",
        property: "a verified preference in a rule scope is pinned in the standing-rules block of the context prefix",
        fires: block.length,
        reaches: reqDigest(on) !== reqDigest(off),
        correct: block.length === 1 && /formatter/.test(receivedText({ context: block })) && blocksOf(lastRequest(off), "fabric-rules").length === 0,
        on: reqDigest(on),
        off: reqDigest(off),
      };
    },
  },
  {
    id: "delivery.rule-capture",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, capture) => {
        const s = scripted();
        const ui = testing.createScriptedHostUi({ confirm: true });
        // Capture reads the archived user turn, so the exchange archive is on in both arms.
        const h = await fabricAgent(join(root, name), { config: { exchanges: {}, rules: { capture } }, respond: s.respond, agentOptions: { host: { ui: ui.ui } } });
        try {
          await h.run("probe", "Make sure to run the linter before every commit.");
          await h.closeSession("probe");
          await h.run("next", "thanks");
          const notes = await h.notes();
          return { captured: notes.filter((note) => /linter before every commit/.test(note.text ?? "") && note.metadata?.kind !== "exchange").length, asked: ui.requestsOf("confirm").length, rules: receivedText({ context: blocksOf(h.requests.at(-1)?.request ?? {}, "fabric-rules") }) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", "confirm");
      const off = await arm("off", "off");
      return {
        surface: "request",
        property: "with capture confirm, an imperative user turn is proposed as a rule and, once confirmed, written and shown in the rules block",
        fires: on.captured,
        reaches: digest(on.rules) !== digest(off.rules),
        correct: on.captured === 1 && on.asked === 1 && /linter/.test(on.rules) && off.captured === 0 && off.asked === 0,
        on: digest(on.rules),
        off: digest(off.rules),
      };
    },
  },
  {
    id: "delivery.rules-md-reconcile",
    async run(root) {
      const { readFile, readdir, writeFile } = await import("node:fs/promises");
      const arm = async (name, edit) => {
        const s = scripted().queue({ calls: [{ name: "memory.insert", args: { kind: "preference", scope: "project", text: "always run the formatter before committing" } }] });
        // The markdown store (the default with tools.root) is the one with an editable rules.md.
        const dir = join(root, name);
        const h = await fabricAgent(dir, { config: { store: "markdown" }, respond: s.respond });
        try {
          await h.run("one", "remember the formatter rule");
          await h.closeSession("one");
          await h.run("two", "hello");
          await h.closeSession("two");
          const files = (await readdir(dir, { recursive: true })).map(String).filter((path) => path.endsWith("rules.md"));
          let edited = 0;
          for (const file of files) {
            const text = await readFile(join(dir, file), "utf8");
            if (edit && text.includes("formatter")) {
              await writeFile(join(dir, file), text.replace("formatter", "linter"));
              edited++;
            }
          }
          await h.run("three", "hello again");
          return { files: files.length, edited, before: receivedText({ context: blocksOf(h.requests.at(-2)?.request ?? {}, "fabric-rules") }), rules: receivedText({ context: blocksOf(h.requests.at(-1)?.request ?? {}, "fabric-rules") }) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      return {
        surface: "request",
        property: "a person's edit of rules.md is reconciled into notes at the next session start, so that session's rules block shows the edited text",
        fires: on.edited,
        reaches: digest(on.rules) !== digest(off.rules),
        correct: on.edited >= 1 && /formatter/.test(on.before) && /linter/.test(on.rules) && !/formatter/.test(on.rules) && /formatter/.test(off.rules),
        on: digest(on.rules),
        off: digest(off.rules),
        counts: { files: on.files, edited: on.edited },
      };
    },
  },
  {
    id: "delivery.path-cues",
    async run(root) {
      const seed = async ({ writer }) => {
        const note = await writer.remember({ kind: "decision", content: "api handlers validate input with zod", rationale: "one validator", scope: "path", appliesTo: ["src/api/**"] });
        await writer.verify(note.id);
      };
      const arm = async (name, cues) =>
        turns(join(root, name), {
          config: { cues, rules: false },
          seed,
          texts: ["open the handler", "now edit it"],
          plans: [{ calls: [{ name: "read", args: { path: "src/api/users.ts" } }] }, { calls: [] }],
          extraPackages: [await fileTools()],
        });
      const on = await arm("on", true);
      const off = await arm("off", false);
      const onTail = on.requests.map(tailText).join("\n");
      const offTail = off.requests.map(tailText).join("\n");
      return {
        surface: "request",
        property: "after a file tool touches a path, a standing decision whose glob matches is cued in the tail",
        fires: /zod/.test(onTail) ? 1 : 0,
        reaches: digest(onTail) !== digest(offTail),
        correct: /zod/.test(onTail) && !/zod/.test(offTail),
        on: digest(onTail),
        off: digest(offTail),
      };
    },
  },
  {
    id: "delivery.working-memory",
    async run(root) {
      // The working prefix is frozen for a session's cache epoch, so the write shows from the next session.
      const arm = async (name, write) => {
        const s = scripted().queue({ calls: write ? [{ name: "memory.insert", args: { block: "profile", text: "Name: Ada" } }] : [] }, { calls: [] });
        const h = await fabricAgent(join(root, name), { config: { rules: false }, respond: s.respond });
        try {
          await h.run("first", "remember my name");
          await h.closeSession("first");
          await h.run("second", "hello");
          return { requests: h.requests.map((row) => row.request) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      const onText = tailSourceText(lastRequest(on), "fabric-working");
      const offText = tailSourceText(lastRequest(off), "fabric-working");
      return {
        surface: "request",
        property: "a working block written by memory.insert is rendered as the working-memory tail block on later turns",
        fires: /Ada/.test(onText) ? 1 : 0,
        reaches: digest(onText) !== digest(offText),
        correct: /Ada/.test(onText) && !/Ada/.test(offText),
        on: digest(onText),
        off: digest(offText),
      };
    },
  },
  {
    id: "decisions.binding",
    async run(root) {
      const on = await decisionArm(join(root, "on"), { noul: 0.05, points: ["P3", "P4"] });
      const band = await decisionArm(join(root, "band"), { noul: 0.5, points: ["P3", "P4"] });
      const off = await decisionArm(join(root, "off"), { noul: 0.05 });
      return {
        surface: "request",
        property: "decisions binds a decisions model; points share batched calls; an answer inside the abstain band keeps the incumbent",
        fires: on.calls.length,
        reaches: digest(on.tail) !== digest(off.tail),
        correct: on.calls.length === 1 && digest(band.tail) === digest(off.tail) && off.calls.length === 0,
        on: digest(on.tail),
        off: digest(off.tail),
        counts: { calls: on.calls.length, questions: on.calls.flat().length },
      };
    },
  },
  {
    id: "decisions.P1",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, points) => {
        const d = await decider(answerAll(0.05));
        const ui = testing.createScriptedHostUi({ confirm: true });
        const h = await fabricAgent(join(root, name), {
          config: { exchanges: {}, rules: { capture: "confirm" }, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
          respond: scripted().respond,
          extraPackages: [d.pkg],
          agentOptions: { host: { ui: ui.ui } },
        });
        try {
          await h.run("probe", "Make sure to run the linter before every commit.");
          await h.settle();
          return { captured: (await h.notes()).filter((note) => /linter before every commit/.test(note.text ?? "") && note.metadata?.kind !== "exchange").length, calls: d.calls.flat().filter((key) => key === "P1").length };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", ["P1"]);
      const off = await arm("off");
      return {
        surface: "stored-note",
        property: "P1 clearly not durable skips rule capture (and the generative extractor) for that turn",
        fires: on.calls,
        reaches: on.captured !== off.captured,
        correct: on.captured === 0 && off.captured === 1,
        on: digest(on.captured),
        off: digest(off.captured),
        finding: "The extractor leg of P1 runs only with promote on and fresh observational-memory material; this probe drives the capture leg, which shares the same per-turn call.",
      };
    },
  },
  {
    id: "decisions.P2",
    async run(root) {
      const arm = async (name, points) => {
        const d = await decider(answerAll(0.5, "replaces"));
        const s = scripted().queue(
          { calls: [{ name: "memory.insert", args: { kind: "fact", text: "the platform team standup happens at nine every weekday morning in room four" } }] },
          { calls: [{ name: "memory.insert", args: { kind: "fact", text: "the platform team standup happens at ten every weekday morning in room four" } }] },
          { calls: [{ name: "memory.recall", args: { query: "team standup morning" } }] },
        );
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, consolidate: { decider: "model", model: "worker/main" }, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
          respond: s.respond,
          extraPackages: [d.pkg],
        });
        try {
          for (const text of ["note the standup", "it moved", "when is standup"]) await h.run("probe", text);
          const hits = lastValue(h)?.hits ?? [];
          return { calls: d.calls.flat().filter((key) => key.startsWith("P2:")).length, d: digest(hits.map((hit) => [hit.content, Boolean(hit.supersededBy)])), hits: hits.length };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", ["P2"]);
      const off = await arm("off");
      return {
        surface: "tool-result",
        property: "P2 classifies the new note's relation to each consolidation candidate; a confident replaces supersedes the old note",
        fires: on.calls,
        reaches: on.d !== off.d,
        correct: on.calls > 0 && on.hits === 1,
        on: on.d,
        off: off.d,
        counts: { questions: on.calls, hitsOn: on.hits, hitsOff: off.hits },
      };
    },
  },
  {
    id: "decisions.P3",
    async run(root) {
      const on = await decisionArm(join(root, "on"), { noul: 0.05, points: ["P3"] });
      const off = await decisionArm(join(root, "off"), { noul: 0.05 });
      return {
        surface: "request",
        property: "P3 drops passive candidates clearly below the relevance band",
        fires: on.calls.flat().filter((key) => key.startsWith("P3:")).length,
        reaches: digest(on.tail) !== digest(off.tail),
        correct: /frankfurt/.test(off.tail) && !/frankfurt/.test(on.tail),
        on: digest(on.tail),
        off: digest(off.tail),
      };
    },
  },
  {
    id: "decisions.P4",
    async run(root) {
      const on = await decisionArm(join(root, "on"), { noul: 0.05, points: ["P4"] });
      const off = await decisionArm(join(root, "off"), { noul: 0.05 });
      return {
        surface: "request",
        property: "P4 clearly not needed skips passive injection for the turn",
        fires: on.calls.flat().filter((key) => key === "P4").length,
        reaches: digest(on.tail) !== digest(off.tail),
        correct: on.tail === "" && off.tail !== "",
        on: digest(on.tail),
        off: digest(off.tail),
      };
    },
  },
  {
    id: "decisions.P5",
    async run(root) {
      const arm = async (name, points) => {
        const d = await decider(answerAll(0.05));
        const s = scripted().queue({ calls: [{ name: "memory.recall", args: { query: "staging cluster" } }] });
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
          seed: seedFacts,
          respond: s.respond,
          extraPackages: [d.pkg],
        });
        try {
          await h.run("probe", "look it up");
          return { hits: lastValue(h)?.hits?.length ?? -1, calls: d.calls.length, text: resultText(h.toolResults.at(-1)?.result) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", ["P5"]);
      const off = await arm("off");
      return {
        surface: "tool-result",
        property: "P5 clearly not sufficient turns a recall with hits into an abstention",
        fires: on.calls,
        reaches: digest(on.text) !== digest(off.text),
        correct: on.hits === 0 && off.hits >= 1,
        on: digest(on.text),
        off: digest(off.text),
      };
    },
  },
  {
    id: "decisions.P6",
    async run(root) {
      const seed = async ({ writer }) => {
        const note = await writer.remember({ kind: "decision", content: "api handlers validate input with zod", rationale: "one validator", scope: "path", appliesTo: ["src/api/**"] });
        await writer.verify(note.id);
      };
      const arm = async (name, points) => {
        const d = await decider(answerAll(0.05));
        const arm = await turns(join(root, name), {
          config: { rules: false, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
          seed,
          texts: ["open the handler", "now edit it"],
          plans: [{ calls: [{ name: "read", args: { path: "src/api/users.ts" } }] }, { calls: [] }],
          extraPackages: [await fileTools(), d.pkg],
        });
        return { tail: arm.requests.map(tailText).join("\n"), calls: d.calls.length };
      };
      const on = await arm("on", ["P6"]);
      const off = await arm("off");
      return {
        surface: "request",
        property: "P6 drops a path cue the model places clearly below the applies band",
        fires: on.calls,
        reaches: digest(on.tail) !== digest(off.tail),
        correct: /zod/.test(off.tail) && !/zod/.test(on.tail),
        on: digest(on.tail),
        off: digest(off.tail),
      };
    },
  },
  {
    id: "decisions.P7",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, points) => {
        const d = await decider(answerAll(0.95));
        const s = scripted();
        const ui = testing.createScriptedHostUi({ confirm: true });
        const h = await fabricAgent(join(root, name), {
          config: { exchanges: {}, rules: { capture: "confirm" }, ...(points ? { decisions: { model: "decider/d1", points } } : {}) },
          respond: s.respond,
          extraPackages: [d.pkg],
          agentOptions: { host: { ui: ui.ui } },
        });
        try {
          await h.run("probe", "Make sure to run the linter before every commit.");
          await h.settle();
          return { captured: (await h.notes()).filter((note) => /linter before every commit/.test(note.text ?? "") && note.metadata?.kind !== "exchange").length, calls: d.calls.length };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", ["P7"]);
      const off = await arm("off");
      return {
        surface: "stored-note",
        property: "P7 clearly instruction-like refuses rule capture (it only adds refusals)",
        fires: on.calls,
        reaches: on.captured !== off.captured,
        correct: on.captured === 0 && off.captured === 1,
        on: digest(on.captured),
        off: digest(off.captured),
      };
    },
  },
];
