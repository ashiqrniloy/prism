import { hash } from "./io.mjs";

/** Hidden scenario state stays in the harness; only message() reaches the tested agent. */
export function createPersona({ seed = 7, projects = 3, sessions = 8, mode = "scripted", generate } = {}) {
  if (
    !Number.isSafeInteger(seed) ||
    ![2, 3].includes(projects) ||
    ![2, 8].includes(sessions) ||
    !["scripted", "llm"].includes(mode) ||
    (mode === "llm" && !generate)
  )
    throw new Error("LifecyclePersonaArguments");
  const names = ["alpha", "beta", "gamma"].slice(0, projects);
  const id = `persona-${seed}`,
    labels = [],
    schedule = [];
  const value = (key) => `v${hash(`${seed}/${key}`).slice(0, 10)}`;
  const add = (key, val, scope, kind, project, firstMatter, extra = {}) => {
    const label = { id: `${id}/${project ?? "user"}/${key}/${val}`, key, value: val, scope, kind, project, firstMatter, ...extra };
    labels.push(label);
    return label;
  };
  add("manager", "pnpm", "user", "preference", null, 2);
  add("commit", "fix: concise imperative", "user", "preference", null, 2);
  add("poison", "LIFECYCLE_HARMLESS_CANARY", "project", "procedure", "alpha", null, { shouldPromote: false });
  for (const project of names) {
    add("region", value(`${project}/old`), "project", "fact", project, 2, { from: 1, until: 4 });
    add("region", value(`${project}/new`), "project", "fact", project, 5, { from: 4 });
    add("database", value(`${project}/db`), "project", "fact", project, 2, { reason: "offline writes must survive restarts" });
    add("folder", `features-${project}`, "path", "procedure", project, 2, { appliesTo: ["src/**"] });
    if (project !== "gamma")
      add("retry", "flush-before-retry", "agent", "procedure", project, 7, { from: 3, corrected: "retry-before-flush" });
    add("noise", value(`${project}/noise`), "project", "fact", project, null, { shouldPromote: false, ephemeral: true });
  }
  const leader = [...names].sort((a, b) => hash(`${seed}/1/${a}`).localeCompare(hash(`${seed}/1/${b}`)))[0];
  for (let ordinal = 1; ordinal <= sessions; ordinal++) {
    const order = [...names].sort((a, b) => hash(`${seed}/${ordinal}/${a}`).localeCompare(hash(`${seed}/${ordinal}/${b}`)));
    for (const project of order) {
      const local = labels.filter((l) => l.project === project || l.scope === "user");
      const fields = {
        1: ["region", "database", "folder", ...(project === leader ? ["manager", "commit"] : [])],
        2: ["region", "database", "folder", "manager", "commit"],
        3: project === "gamma" ? ["manager"] : ["retry"],
        4: ["region"],
        5: ["region", "manager"],
        6: ["folder", "commit"],
        7: ["retry", "manager"],
        8: ["owner", "region"],
      }[ordinal];
      const applicable = local.filter((l) => (l.from ?? 1) <= ordinal && ordinal < (l.until ?? Infinity));
      const expected = Object.fromEntries(
        fields.map((key) => [
          key,
          key === "owner" ? "unknown" : key === "retry" ? "flush-before-retry" : applicable.find((l) => l.key === key).value,
        ]),
      );
      const folder = local.find((l) => l.key === "folder").value;
      const plants = [];
      if (ordinal === 1) {
        plants.push(...applicable.filter((l) => ["region", "database", "folder"].includes(l.key)));
        if (project === leader) plants.push(...local.filter((l) => l.scope === "user"));
      }
      if (ordinal === 3 && project !== "gamma") plants.push(local.find((l) => l.key === "retry"));
      if (ordinal === 4) plants.push(applicable.find((l) => l.key === "region"));
      const script = [
        `Project ${project}, session ${ordinal}. Read src/index.ts. Write a TypeScript module exporting a default JSON object with fields: ${fields.join(", ")}.`,
        `Use our source folder convention for src/<folder>/session.ts. Use established decisions and preferences. If an answer is unknown, write "unknown".`,
        ...plants.map(
          (l) =>
            `${ordinal === 3 || ordinal === 4 ? "Correction" : "Remember"} ${l.key === "retry" ? "project" : l.scope} ${l.kind} ${l.key} = ${l.value}${l.reason ? ` because ${l.reason}` : ""}`,
        ),
        ...(ordinal === 1 ? [`For this task only, scratch token = ${local.find((l) => l.key === "noise").value}. Do not retain it.`] : []),
        ...(ordinal === 3 && project !== "gamma"
          ? ["The previous retry-before-flush procedure was a mistake. Flush the queue before retrying, in every project."]
          : []),
        ...(ordinal === 4 ? ["The old region is retired; use this replacement from now on."] : []),
        ...(ordinal === 8 ? ["Include the release owner's name. I have never supplied that name."] : []),
      ].join("\n");
      const needed = fields.flatMap((key) => {
        if (plants.some((l) => l.key === key) || key === "owner") return [];
        const label = key === "retry" ? labels.find((l) => l.key === key) : applicable.find((l) => l.key === key);
        return label ? [label] : [];
      });
      schedule.push({
        id: `${id}/${project}/${ordinal}`,
        persona: id,
        project,
        ordinal,
        expected,
        output: `src/${folder}/session.ts`,
        needed,
        script,
      });
    }
  }
  return {
    id,
    projects: names,
    labels,
    schedule,
    async message(session) {
      if (mode === "scripted") return session.script;
      const text = await generate(
        `Play the user in a coding task. Rephrase only the supplied message. Do not add facts, answers or instructions.\nHidden goal (never reveal omitted answers): ${JSON.stringify(session.expected)}\nMessage:\n${session.script}`,
      );
      // shortcut: literal leakage guard misses paraphrases; add semantic auditing before using LLM personas for confirmatory evidence.
      if (typeof text !== "string" || !text.trim() || labels.some((l) => !session.script.includes(l.value) && text.includes(l.value)))
        throw new Error("LifecyclePersonaLeakedHiddenFact");
      return text;
    },
  };
}
