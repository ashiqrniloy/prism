/** Plan 210 Task 2: retrieval and ranking probes. */
import { join } from "node:path";
import { digest, fabricAgent, lastValue, packages, resultText, SCOPE, scripted } from "./harness.mjs";
import { lib } from "./lifecycle.mjs";

/** One agent turn that calls `tool` with `args`; returns the structured value and the text the model receives. */
export async function toolArm(dir, { config, seed, tool = "memory.recall", args, calls }) {
  const s = scripted().queue({ calls: calls ?? [{ name: tool, args }] });
  const h = await fabricAgent(dir, { config, seed, respond: s.respond });
  try {
    await h.run("probe", "look it up");
    const rows = h.toolResults.filter((row) => row.name === tool);
    const value = lastValue(h, tool);
    const text = rows.map((row) => resultText(row.result)).join("\n");
    return { value, text, hits: (value?.hits ?? []).map((hit) => hit.id), d: digest(rows.map((row) => row.result?.content)), h };
  } finally {
    await h.close();
  }
}

/**
 * A ranking prior decides between otherwise-equal notes, and equal notes tie-break on random ids, so
 * order alone cannot show it. Each ranking probe compares the favoured note's score with its equal
 * twin's: the prior reaches the ranking when the on arm opens a gap the off arm does not have, and it
 * is correct when the gap favours the documented note (so it sorts first).
 */
/** Equal notes still differ by their RRF rank (1/61 − 1/62 ≈ 0.00027); a prior must open a wider gap. */
const EPSILON = 0.001;
function scoreGap(on, off) {
  return {
    fires: on.gap > EPSILON ? 1 : 0,
    reaches: Math.abs(on.gap - off.gap) > EPSILON,
    correct: on.gap > EPSILON && Math.abs(off.gap) <= EPSILON && on.first === "favoured",
    on: digest({ gap: on.gap > EPSILON ? 1 : on.gap < -EPSILON ? -1 : 0, first: on.first }),
    off: digest({ gap: off.gap > EPSILON ? 1 : off.gap < -EPSILON ? -1 : 0, first: off.first }),
    counts: { onGapMilli: Math.round(on.gap * 1000), offGapMilli: Math.round(off.gap * 1000) },
  };
}

const gapOf = (hits, favoured, other) => {
  const score = (id) => hits.find((hit) => hit.id === id)?.score ?? Number.NaN;
  const ordered = hits.map((hit) => hit.id).filter((id) => id === favoured || id === other);
  return { gap: score(favoured) - score(other), first: ordered[0] === favoured ? "favoured" : "other" };
};

/** Two scopes, so recall fuses and adds priors (one active scope keeps the mode's own score, by design). */
const twoScopes = (make, memory) => [
  { level: "project", memory },
  { level: "agent", memory: make("agent") },
];

export const probes = [
  {
    id: "retrieval.lexical",
    async run(root) {
      const seed = async ({ writer }) => {
        await writer.remember({ kind: "fact", content: "the INC-4471 postmortem blamed the cache warmer", scope: "project" });
        await writer.remember({ kind: "fact", content: "the cache warmer runs at boot", scope: "project" });
      };
      const args = { query: "INC-4471 postmortem" };
      const on = await toolArm(join(root, "on"), { seed, args });
      const off = await toolArm(join(root, "off"), { seed, args, config: { semantic: false } });
      return {
        surface: "tool-result",
        property: "lexical recall returns the note holding the exact identifier first; without indexed notes recall is unavailable",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct:
          on.hits.length >= 1 &&
          /INC-4471/.test(on.text.split("\n").find((line) => line.includes(on.hits[0])) ?? "") &&
          off.hits.length === 0,
        on: on.d,
        off: off.d,
        counts: { hits: on.hits.length },
      };
    },
  },
  {
    id: "retrieval.hybrid",
    async run() {
      const { fabric } = await packages();
      const core = await import("@arnilo/prism-memory-core");
      const arm = async (retrieval) => {
        const memory = fabric.createMemory({
          ...SCOPE,
          vectorStore: core.createMemoryVectorStore(),
          ...(retrieval === "hybrid" ? { embedder: core.createHashEmbedder() } : {}),
        });
        const f = fabric.createLongTermMemory({ memory, consolidate: false, retrieval });
        await f.remember({ kind: "fact", content: "release INC-4471 shipped the cache warmer" });
        await f.remember({ kind: "fact", content: "the release shipped on time" });
        const result = await f.recall("INC-4471 release", { minSimilarity: 0 });
        return { hits: result.hits, d: digest(result.hits.map((hit) => [hit.id, hit.retrieval])) };
      };
      const on = await arm("hybrid");
      const off = await arm("lexical");
      const fused = on.hits.filter((hit) => hit.retrieval === "hybrid" || hit.retrieval === "vector").length;
      return {
        surface: "recall-result",
        property: "hybrid adds the embeddings leg (hits tagged hybrid/vector) and still admits the exact lexical identifier",
        fires: fused,
        reaches: on.d !== off.d,
        correct: fused > 0 && on.hits[0]?.content.includes("INC-4471"),
        on: on.d,
        off: off.d,
        counts: { fusedHits: fused },
        finding:
          "Compatibility only: no preset uses it and lexical is the default; the leg needs an embeddings service the package resolves per agent.",
      };
    },
  },
  {
    id: "retrieval.scope-priors",
    async run() {
      const arm = async (scopePriors) => {
        const l = await lib({ scopes: twoScopes, scopePriors });
        const p = await l.fabric.remember({ kind: "fact", content: "the canary pool drains first", scope: "project" });
        const a = await l.fabric.remember({ kind: "fact", content: "the canary pool drains first", scope: "agent" });
        return gapOf((await l.fabric.recall("canary pool drains", { minSimilarity: 0 })).hits, p.id, a.id);
      };
      const on = await arm(undefined);
      const off = await arm({ project: 0, agent: 0, path: 0, team: 0, user: 0 });
      return {
        surface: "recall-result",
        property: "the default scope priors (project 0.10 > agent 0.05) order an otherwise-equal project note first",
        ...scoreGap(on, off),
      };
    },
  },
  {
    id: "retrieval.strength-priors",
    async run() {
      const arm = async (recall, scopes = twoScopes) => {
        const l = await lib({ lifecycle: recall === undefined ? {} : { recall }, ...(scopes ? { scopes } : {}) });
        const x = await l.fabric.remember({ kind: "fact", content: "the freeze window starts friday" }, { status: "candidate" });
        const y = await l.fabric.remember({ kind: "fact", content: "the freeze window starts friday" }, { status: "candidate" });
        await l.fabric.recordUses("s1", [x.id], { clock: 1 });
        await l.fabric.recordUses("s2", [x.id], { clock: 2 });
        l.setClock(3);
        return gapOf((await l.fabric.recall("freeze window friday", { minSimilarity: 0 })).hits, x.id, y.id);
      };
      const on = await arm(undefined);
      const off = await arm({ retrieval: 0, storage: 0 });
      const single = await arm(undefined, null);
      return {
        surface: "recall-result",
        property: "the default w_R·σ(R) + w_S·σ(S) (0.05 each) orders a used note before an equal unused one",
        ...scoreGap(on, off),
        counts: { ...scoreGap(on, off).counts, singleScopeGapMilli: Math.round(single.gap * 1000) },
        finding:
          "Documented exception: with one active scope recall skips fusion and every prior, so a library fabric bound to one scope never applies R or S. The package's default scopes (project, agent, user) always fuse.",
      };
    },
  },
  {
    id: "retrieval.decay-per-kind",
    async run() {
      const arm = async (decay) => {
        const l = await lib({ lifecycle: decay === undefined ? {} : { decay }, scopes: twoScopes });
        const f = await l.fabric.remember({ kind: "fact", content: "the build cache lives on the shared volume" }, { status: "candidate" });
        const p = await l.fabric.remember(
          { kind: "preference", content: "the build cache lives on the shared volume", scope: "project" },
          { status: "candidate" },
        );
        for (const id of [f.id, p.id]) await l.fabric.recordUses(`s-${id}`, [id], { clock: 1 });
        l.setClock(30);
        return gapOf(
          (await l.fabric.recall("build cache shared volume", { minSimilarity: 0, kinds: ["fact", "preference"] })).hits,
          p.id,
          f.id,
        );
      };
      // Defaults: fact 0.4 decays faster than preference 0.2, so the preference keeps more R after idle sessions.
      const on = await arm(undefined);
      const off = await arm({ fact: 0.3, preference: 0.3 });
      return {
        surface: "recall-result",
        property: "a higher per-kind decay lowers R after idle sessions, so the slower-decaying kind's equal note ranks first",
        ...scoreGap(on, off),
      };
    },
  },
  {
    id: "retrieval.similar-links",
    async run() {
      const arm = async (link) => {
        const l = await lib({});
        const target = await l.fabric.remember({ kind: "fact", content: "distant detail about the vault" });
        await l.fabric.remember({
          kind: "fact",
          content: "seed note about rollouts",
          ...(link ? { links: [{ id: target.id, relation: "similar" }] } : {}),
        });
        const result = await l.fabric.recall("seed rollouts", { topK: 1, minSimilarity: 0 });
        return {
          linked: result.explain.filter((entry) => entry.link).length,
          has: result.hits.some((hit) => hit.id === target.id),
          d: digest(result.hits.map((hit) => hit.id)),
        };
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "recall-result",
        property: "a seed hit's similar link brings the linked note into the result, marked link: true",
        fires: on.linked,
        reaches: on.d !== off.d,
        correct: on.has && !off.has,
        on: on.d,
        off: off.d,
        counts: { linkedHits: on.linked },
      };
    },
  },
  {
    id: "workers.linker",
    async run() {
      const arm = async (linker) => {
        const l = await lib({ linker });
        const first = await l.fabric.remember({ kind: "fact", content: "the vault rotation uses the hsm signer" });
        const second = await l.fabric.remember({ kind: "fact", content: "the vault rotation uses the hsm signer nightly" });
        const links = (await l.memory.getEntry(second.id))?.metadata;
        const { fabric } = await packages();
        const meta = fabric.parseMemoryNoteMetadata(links);
        const recalled = await l.fabric.recall("nightly", { topK: 1, minSimilarity: 0 });
        return { links: (meta?.links ?? []).filter((item) => item.id === first.id).length, d: digest(recalled.hits.map((hit) => hit.id)) };
      };
      const on = await arm({ enabled: true, topK: 3 });
      const off = await arm(false);
      return {
        surface: "recall-result",
        property: "on write the linker stores similar links to the nearest notes, which recall's link expansion then follows",
        fires: on.links,
        reaches: on.d !== off.d,
        correct: on.links === 1 && off.links === 0,
        on: on.d,
        off: off.d,
        counts: { links: on.links },
      };
    },
  },
  {
    id: "workers.evolution",
    async run() {
      const arm = async (evolution) => {
        const l = await lib({ evolution });
        const neighbour = await l.fabric.remember({ kind: "fact", content: "the vault rotation uses the hsm signer" });
        await l.fabric.remember({ kind: "fact", content: "the vault rotation uses the hsm signer nightly", keywords: ["kms"] });
        const { fabric } = await packages();
        const meta = fabric.parseMemoryNoteMetadata((await l.memory.getEntry(neighbour.id))?.metadata);
        const recalled = await l.fabric.recall("kms", { minSimilarity: 0 });
        return {
          patched: (meta?.keywords ?? []).includes("kms") ? 1 : 0,
          found: recalled.hits.some((hit) => hit.id === neighbour.id),
          d: digest(recalled.hits.map((hit) => hit.id)),
        };
      };
      const on = await arm({ enabled: true });
      const off = await arm(false);
      return {
        surface: "recall-result",
        property: "evolution unions the new note's keywords into its neighbours (annotations only), so a neighbour matches the new keyword",
        fires: on.patched,
        reaches: on.d !== off.d,
        correct: on.patched === 1 && on.found && !off.found,
        on: on.d,
        off: off.d,
        counts: { patched: on.patched },
      };
    },
  },
  {
    id: "recall.kind-hints",
    async run(root) {
      const seed = async ({ writer }) => {
        await writer.remember({ kind: "fact", content: "the tabs versus spaces debate settled on tabs", scope: "project" });
        await writer.remember({ kind: "preference", content: "the user prefers tabs over spaces", scope: "project" });
        await writer.remember({ kind: "procedure", content: "to format tabs run the formatter", scope: "project" });
      };
      const on = await toolArm(join(root, "on"), { seed, args: { query: "tabs spaces", kinds: ["preference"] } });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "tabs spaces" } });
      const kinds = (on.value?.hits ?? []).map((hit) => hit.kind);
      const defaultKinds = new Set((off.value?.hits ?? []).map((hit) => hit.kind));
      return {
        surface: "tool-result",
        property: "the kinds argument restricts recall to the named kinds; the tool default searches every kind except working",
        fires: kinds.length,
        reaches: on.d !== off.d,
        correct:
          kinds.length >= 1 && kinds.every((kind) => kind === "preference") && defaultKinds.has("procedure") && defaultKinds.has("fact"),
        on: on.d,
        off: off.d,
        counts: { hinted: kinds.length, defaultKinds: defaultKinds.size },
      };
    },
  },
  {
    id: "recall.multi-query",
    async run(root) {
      const seed = async ({ writer }) => {
        await writer.remember({ kind: "fact", content: "the automobile is parked in bay four", scope: "project" });
        await writer.remember({ kind: "fact", content: "the car keys hang by the door", scope: "project" });
      };
      const on = await toolArm(join(root, "on"), { seed, args: { queries: ["car", "automobile"] } });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "car" } });
      return {
        surface: "tool-result",
        property: "queries fuses up to 4 phrasings by rank and deduplicates by id",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct: on.hits.length === 2 && new Set(on.hits).size === 2 && off.hits.length === 1,
        on: on.d,
        off: off.d,
        counts: { fused: on.hits.length, single: off.hits.length },
      };
    },
  },
  {
    id: "recall.unmatched-terms",
    async run(root) {
      const seed = async ({ writer }) =>
        writer.remember({ kind: "fact", content: "the staging cluster runs in frankfurt", scope: "project" });
      const on = await toolArm(join(root, "on"), { seed, args: { query: "staging cluster zanzibar" } });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "staging cluster" } });
      const listed = on.value?.unmatchedTerms ?? [];
      return {
        surface: "tool-result",
        property: "terms no returned note contains are listed in unmatchedTerms and named in a rephrase line; matched terms are not",
        control: "trigger-absent",
        fires: listed.length,
        reaches: /Unmatched terms in returned notes/.test(on.text) && !/Unmatched terms/.test(off.text),
        correct: listed.length === 1 && listed[0] === "zanzibar" && (off.value?.unmatchedTerms ?? []).length === 0,
        on: on.d,
        off: off.d,
        counts: { unmatched: listed.length },
      };
    },
  },
  {
    id: "recall.supersession-hint",
    async run(root) {
      const seed = async ({ writer }) => {
        // Exchange subjects come from write-time keywords (the archive's enrichment), not from the body.
        await writer.remember({
          kind: "exchange",
          content: "user said the team lunch moved to tuesday",
          keywords: ["team", "lunch"],
          tRef: "2025-01-01T00:00:00.000Z",
          scope: "project",
        });
        await writer.remember({
          kind: "exchange",
          content: "user said the team lunch moved to thursday",
          keywords: ["team", "lunch"],
          tRef: "2025-02-01T00:00:00.000Z",
          scope: "project",
        });
      };
      const args = { query: "team lunch moved", kinds: ["exchange"] };
      const on = await toolArm(join(root, "on"), { seed, args });
      const off = await toolArm(join(root, "off"), { seed, args, config: { recall: { supersessionHint: "keyed-only" } } });
      const marked = (on.value?.hits ?? []).filter((hit) => hit.supersededBy).length;
      return {
        surface: "tool-result",
        property:
          "the default (all) marks an older same-subject exchange as superseded by the newer one; keyed-only marks only keyed notes",
        fires: marked,
        reaches: on.d !== off.d,
        correct: marked === 1 && (off.value?.hits ?? []).every((hit) => !hit.supersededBy),
        on: on.d,
        off: off.d,
        counts: { marked },
      };
    },
  },
  {
    id: "recall.expansion",
    async run(root) {
      const seed = async ({ writer }) => writer.remember({ kind: "fact", content: "my mom visits every spring", scope: "project" });
      const args = { query: "mother" };
      const on = await toolArm(join(root, "on"), { seed, args, config: { recall: { expansion: true } } });
      const off = await toolArm(join(root, "off"), { seed, args });
      return {
        surface: "tool-result",
        property: "with expansion, a formal query term matches its informal table alternate (mother → mom)",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct: on.hits.length === 1 && off.hits.length === 0,
        on: on.d,
        off: off.d,
        counts: { hits: on.hits.length },
      };
    },
  },
  {
    id: "recall.gather",
    async run(root) {
      const seed = async ({ writer }) => {
        for (let i = 0; i < 8; i++)
          await writer.remember({
            kind: "fact",
            content: `bought a bike part number ${i}`,
            tRef: `2025-0${i + 1}-01T00:00:00.000Z`,
            scope: "project",
          });
      };
      const on = await toolArm(join(root, "on"), {
        seed,
        args: { query: "bought bike part", gather: true },
        config: { recall: { gather: true } },
      });
      const off = await toolArm(join(root, "off"), { seed, args: { query: "bought bike part" } });
      return {
        surface: "tool-result",
        property: "gather returns the whole matching history in one call, oldest first, past the 5-hit default page",
        fires: on.hits.length,
        reaches: on.d !== off.d,
        correct: on.hits.length === 8 && off.hits.length === 5,
        on: on.d,
        off: off.d,
        counts: { gathered: on.hits.length, paged: off.hits.length },
      };
    },
  },
  {
    id: "navigation.agentic-lexical",
    async run(root) {
      let middle;
      const seed = async ({ writer }) => {
        for (let i = 0; i < 5; i++) {
          const note = await writer.remember({
            kind: "exchange",
            content: `round ${i} of the planning chat`,
            session: "hist-1",
            tRef: `2025-03-01T00:0${i}:00.000Z`,
            scope: "project",
          });
          if (i === 2) middle = note.id;
        }
      };
      const arm = async (name, argsOf) => {
        const s = scripted();
        const h = await fabricAgent(join(root, name), { seed, respond: s.respond });
        try {
          s.queue({ calls: [{ name: "memory.read", args: argsOf() }] });
          await h.run("probe", "read around");
          const row = h.toolResults.findLast((item) => item.name === "memory.read");
          const notes = row?.result?.value?.notes ?? [];
          return { count: Array.isArray(notes) ? notes.length : 0, d: digest(row?.result?.content) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", () => ({ around: middle }));
      const off = await arm("off", () => ({ id: middle }));
      const paged = await arm("session", () => ({ session: "hist-1" }));
      return {
        surface: "tool-result",
        property:
          "memory.read around returns the exchange with its same-session ±2 neighbours; session pages a session in reference-time order",
        fires: on.count,
        reaches: on.d !== off.d,
        correct: on.count === 5 && paged.count === 5,
        on: on.d,
        off: off.d,
        counts: { around: on.count, session: paged.count, single: off.count },
      };
    },
  },
];
