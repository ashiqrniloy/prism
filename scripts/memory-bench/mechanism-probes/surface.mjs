/** Plan 210 Task 2: whole-surface probes (coding preset, durable stores, toggle/status, scoped policy). */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { digest, fabricAgent, lastValue, packages, resultText, scripted } from "./harness.mjs";

async function embeddings() {
  const { prism } = await packages();
  const core = await import("@arnilo/prism-memory-core");
  const embedder = core.createHashEmbedder({ dimensions: 8, id: "probe-embeddings" });
  return prism.definePackage({
    name: "@probe/embeddings",
    version: "0.0.0",
    requires: { api: 1 },
    setup(api) {
      api.services.provide("embeddings", embedder);
    },
  })();
}

export const probes = [
  {
    id: "preset.coding",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, preset) => {
        const ui = testing.createScriptedHostUi({ confirm: true });
        const h = await fabricAgent(join(root, name), { config: preset ? { preset } : {}, respond: scripted().respond, agentOptions: { host: { ui: ui.ui } } });
        try {
          await h.run("one", "Make sure to run the linter before every commit.");
          const status = await h.command("memory:status", {}, "one");
          await h.closeSession("one");
          await h.run("two", "hello");
          const notes = await h.notes();
          return {
            preset: status?.preset,
            exchanges: notes.filter((note) => note.metadata?.kind === "exchange").length,
            captured: notes.filter((note) => note.metadata?.kind === "procedure").length,
            asked: ui.requestsOf("confirm").length,
            d: digest(h.requests.at(-1)?.request.context),
          };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", "coding");
      const off = await arm("off", undefined);
      return {
        surface: "request",
        property: "the coding preset turns on the exchange archive, confirmed rule capture and the coding rules block, and memory:status names it",
        fires: on.exchanges + on.captured,
        reaches: on.d !== off.d,
        correct: on.preset === "coding" && on.exchanges >= 1 && on.captured === 1 && on.asked === 1 && off.exchanges === 0 && off.captured === 0,
        on: on.d,
        off: off.d,
        counts: { exchanges: on.exchanges, captured: on.captured },
      };
    },
  },
  {
    id: "stores.durable",
    async run(root) {
      const arm = async (name, store) => {
        const dir = join(root, name);
        const first = await fabricAgent(dir, {
          config: { rules: false, ...(store ? { store } : {}) },
          respond: scripted().queue({ calls: [{ name: "memory.insert", args: { kind: "fact", text: "the oncall rotation flips on mondays" } }] }).respond,
        });
        try {
          await first.run("one", "note it");
        } finally {
          await first.close();
        }
        const second = await fabricAgent(dir, {
          config: { rules: false, ...(store ? { store } : {}) },
          respond: scripted().queue({ calls: [{ name: "memory.recall", args: { query: "oncall rotation mondays" } }] }).respond,
        });
        try {
          await second.run("two", "when does oncall flip");
          return { hits: lastValue(second)?.hits?.length ?? 0, d: digest(resultText(second.toolResults.at(-1)?.result)) };
        } finally {
          await second.close();
        }
      };
      const on = await arm("sqlite", undefined);
      const off = await arm("memory", "memory");
      return {
        surface: "tool-result",
        property: "a SQLite-backed note written by one agent is recalled by a new agent on the same store; the in-memory store loses it",
        fires: on.hits,
        reaches: on.d !== off.d,
        correct: on.hits === 1 && off.hits === 0,
        on: on.d,
        off: off.d,
        finding: "Postgres is not probed offline (no database in the free run); its integration suites stay the evidence.",
      };
    },
  },
  {
    id: "fabric.toggle-status",
    async run(root) {
      const seed = async ({ writer }) => writer.remember({ kind: "fact", content: "the staging cluster runs in frankfurt", scope: "project" });
      const h = await fabricAgent(join(root, "arm"), { config: { rules: false, inject: { query: "user", minSimilarity: 0 } }, seed, respond: scripted().respond });
      try {
        await h.run("probe", "where does the staging cluster run");
        const onTools = h.requests.at(-1)?.request.tools ?? [];
        const status = await h.command("memory:status", {}, "probe");
        const toggled = await h.command("memory", {}, "probe");
        await h.run("probe", "where does the staging cluster run again");
        const offTools = h.requests.at(-1)?.request.tools ?? [];
        return {
          surface: "request",
          property: "the memory toggle hides every fabric tool for the session; memory:status counts notes by lifecycle status",
          fires: toggled?.enabled === false ? 1 : 0,
          reaches: onTools.includes("memory.recall") && !offTools.includes("memory.recall"),
          correct: toggled?.enabled === false && status?.verified + status?.candidate === 1 && !offTools.some((name) => name.startsWith("memory.")),
          on: digest(onTools),
          off: digest(offTools),
          finding: "Inspectability now rests on the named test memory_toggle_and_status_commands_are_inspectable (package.test.ts).",
        };
      } finally {
        await h.close();
      }
    },
  },
  {
    id: "scoped.policy",
    async run(root) {
      const arm = async (name, minSimilarity) => {
        const scopeRoot = join(root, name, "scopes");
        await mkdir(scopeRoot, { recursive: true });
        const s = scripted().queue({
          calls: [
            { name: "memory.insert", args: { path: "canary.md", text: "canary rollout protects deploys" } },
            // Lexical coverage 4/5 (one extra term): admitted at 0.35, refused at a floor of 1.
            { name: "memory.recall", args: { query: "canary rollout protects deploys nightly" } },
          ],
        });
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, scoped: { scopeRoot, policy: { activation: { minSimilarity } } } },
          respond: s.respond,
          extraPackages: [await embeddings()],
        });
        try {
          await h.run("probe", "remember and recall");
          return { hits: lastValue(h)?.hits?.length ?? 0, d: digest(resultText(h.toolResults.at(-1)?.result)) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", 0.35);
      const off = await arm("off", 1);
      return {
        surface: "tool-result",
        property: "the scoped policy's activation floor admits a matching scoped note at the default 0.35 and refuses it at 1",
        fires: on.hits,
        reaches: on.d !== off.d,
        correct: on.hits >= 1 && off.hits === 0,
        on: on.d,
        off: off.d,
        counts: { hitsOn: on.hits, hitsOff: off.hits },
      };
    },
  },
];
