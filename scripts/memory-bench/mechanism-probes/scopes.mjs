/** Plan 210 Task 2: scope probes (user, project, path, agent, team store, shadowing). */
import { join } from "node:path";
import { digest, fabricAgent, packages, resultText, scripted } from "./harness.mjs";
import { lib } from "./lifecycle.mjs";

const PROJECT_A = "projects/alpha--11111111";
const PROJECT_B = "projects/beta--22222222";

/** Two project fabrics over one store, each reading the shared user and agent scopes above it. */
async function twoProjects() {
  const { fabric } = await packages();
  const l = await lib({});
  const user = l.make("user");
  const agent = l.make("agent");
  const projectFabric = (resourceId) => {
    const memory = l.make(resourceId);
    return fabric.createMemoryFabric({
      memory,
      scopes: [
        { level: "project", memory },
        { level: "agent", memory: agent },
        { level: "user", memory: user },
      ],
      vectorStore: l.store,
      consolidate: false,
    });
  };
  return { a: projectFabric(PROJECT_A), b: projectFabric(PROJECT_B), l };
}

const ids = async (f, query, options = {}) => (await f.recall(query, { minSimilarity: 0, kinds: ["all"], ...options })).hits.map((hit) => hit.id);

export const probes = [
  {
    id: "scope.user",
    async run() {
      const { a, b } = await twoProjects();
      const shared = await a.remember({ kind: "preference", scope: "user", content: "prefer dark mode in every editor" });
      const local = await a.remember({ kind: "preference", scope: "project", content: "prefer dark mode in this repo only" });
      const seen = await ids(b, "prefer dark mode editor repo");
      return {
        surface: "recall-result",
        property: "a user-scope note written in one project is recalled in another; a project note is not",
        fires: seen.includes(shared.id) ? 1 : 0,
        reaches: seen.includes(shared.id),
        correct: seen.includes(shared.id) && !seen.includes(local.id),
        on: digest(seen.includes(shared.id)),
        off: digest(seen.includes(local.id)),
      };
    },
  },
  {
    id: "scope.project",
    async run() {
      const { a, b } = await twoProjects();
      const note = await a.remember({ kind: "fact", scope: "project", content: "the alpha service listens on port 7443" });
      const inA = await ids(a, "alpha service port");
      const inB = await ids(b, "alpha service port");
      return {
        surface: "recall-result",
        property: "a project note is recalled in its own project and never in another project sharing the store",
        fires: inA.includes(note.id) ? 1 : 0,
        reaches: digest(inA) !== digest(inB),
        correct: inA.includes(note.id) && !inB.includes(note.id),
        on: digest(inA),
        off: digest(inB),
      };
    },
  },
  {
    id: "scope.path",
    async run() {
      const { fabric } = await packages();
      const l = await lib({ scopes: (make, memory) => [{ level: "project", memory }, { level: "agent", memory: make("agent") }] });
      const path = await l.fabric.remember({ kind: "fact", scope: "path", appliesTo: ["src/api/**"], content: "handlers return problem json errors" });
      const plain = await l.fabric.remember({ kind: "fact", scope: "project", content: "handlers return problem json errors" });
      const gap = async (touchedPaths) => {
        const hits = (await l.fabric.recall("handlers problem json errors", { minSimilarity: 0, touchedPaths })).hits;
        const score = (id) => hits.find((hit) => hit.id === id)?.score ?? Number.NaN;
        return score(path.id) - score(plain.id);
      };
      const matched = await gap(["src/api/users.ts"]);
      const unmatched = await gap(["docs/readme.md"]);
      void fabric;
      return {
        surface: "recall-result",
        property: "a path note earns the path prior (0.15 over project 0.10) only when a touched path matches its glob; otherwise it ranks as a project note",
        fires: matched > 0.001 ? 1 : 0,
        reaches: Math.abs(matched - unmatched) > 0.001,
        correct: matched > 0.001 && Math.abs(unmatched) <= 0.001,
        on: digest(Math.round(matched * 1000)),
        off: digest(Math.round(unmatched * 1000)),
      };
    },
  },
  {
    id: "scope.agent",
    async run() {
      const { a, b } = await twoProjects();
      const lesson = await a.remember({ kind: "fact", scope: "agent", content: "the vendored sdk needs node twenty" });
      const seen = await ids(b, "vendored sdk node twenty");
      return {
        surface: "recall-result",
        property: "an agent-scope note is shared across projects for the same agent",
        fires: seen.includes(lesson.id) ? 1 : 0,
        reaches: seen.includes(lesson.id),
        correct: seen.includes(lesson.id),
        on: digest(seen),
        off: digest([]),
      };
    },
  },
  {
    id: "scope.team-store",
    async run(root) {
      const { testing } = await packages();
      const arm = async (name, team) => {
        const ui = testing.createScriptedHostUi({ confirm: true });
        const s = scripted();
        // The team store opens only when its directory exists in the checkout (documented).
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(root, name, ".prism/memory"), { recursive: true });
        const h = await fabricAgent(join(root, name), {
          config: { rules: false, store: "markdown", ...(team ? { team: { dir: ".prism/memory", write: "ask" } } : {}) },
          respond: s.respond,
          agentOptions: { host: { ui: ui.ui } },
        });
        try {
          s.queue({ calls: [{ name: "memory.insert", args: { kind: "fact", scope: "project", text: "release notes live in the changelog folder" } }] });
          await h.run("one", "note it");
          // The markdown store is the package's own; read the id from the insert's result.
          const id = /Remembered ([0-9a-f]{12})/.exec(resultText(h.toolResults.findLast((row) => row.name === "memory.insert")?.result))?.[1];
          const shared = team && id ? await h.command("memory:share", { id }, "one").catch((error) => ({ error: String(error?.message ?? error) })) : undefined;
          const status = await h.command("memory:status", {}, "one");
          await h.closeSession("one");
          s.queue({ calls: [{ name: "memory.recall", args: { query: "release notes changelog folder" } }] });
          await h.run("two", "where are release notes");
          const value = h.toolResults.findLast((row) => row.name === "memory.recall")?.result?.value;
          const levels = (value?.hits ?? []).map((hit) => hit.level);
          return { shared, team: status?.team, levels, text: resultText(h.toolResults.at(-1)?.result) };
        } finally {
          await h.close();
        }
      };
      const on = await arm("on", true);
      const off = await arm("off", false);
      const teamNotes = (on.team?.verified ?? 0) + (on.team?.candidate ?? 0);
      return {
        surface: "tool-result",
        property: "memory:share copies a note into the checked-in team store after a confirmation; recall reads team notes as a read-only level",
        fires: teamNotes,
        reaches: digest(on.levels) !== digest(off.levels),
        correct: teamNotes >= 1 && on.levels.includes("team") && !off.levels.includes("team"),
        on: digest(on.levels),
        off: digest(off.levels),
        counts: { teamNotes },
      };
    },
  },
  {
    id: "scope.shadowing",
    async run() {
      const arm = async (sameKey) => {
        const { a } = await twoProjects();
        const wide = await a.remember({ kind: "preference", scope: "user", key: "package-manager", content: "prefer pnpm for project scripts" });
        const narrow = await a.remember({ kind: "preference", scope: "project", key: sameKey ? "package-manager" : "package-manager-local", content: "prefer npm for project release scripts" });
        const result = await a.recall("prefer pnpm npm project scripts", { minSimilarity: 0, kinds: ["all"] });
        return {
          hits: result.hits.map((hit) => hit.id),
          shadowed: result.explain.filter((entry) => entry.shadowedBy === narrow.id).length,
          wide: wide.id,
          narrow: narrow.id,
        };
      };
      const on = await arm(true);
      const off = await arm(false);
      return {
        surface: "recall-result",
        property: "a narrower note with the same key hides the wider one (explain names it shadowedBy); different keys both return",
        fires: on.shadowed,
        reaches: on.hits.length !== off.hits.length,
        correct: on.shadowed === 1 && !on.hits.includes(on.wide) && on.hits.includes(on.narrow) && off.hits.includes(off.wide),
        on: digest(on.hits.length),
        off: digest(off.hits.length),
      };
    },
  },
];
