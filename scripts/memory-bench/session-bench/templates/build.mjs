/**
 * Plan 218.3 Task 9: Session-Bench's session builder. A session is a pure function of its id and the benchmark seed:
 * one scope document (a numbered plan, one step per task), 8-14 task prompts, the workspace state, the labelled
 * dependencies and every task's checks and scripted plan. Imports nothing from Prism (G2).
 *
 * Layout. Every task has a job: a control piece of work over one large artifact (a log, a channel, a rule report, a
 * guide) with its own `C` check, so the context grows by one large tool output per task. Dependency sources (a fact
 * read, a user-only statement, an own decision, a superseded value) ride on the first tasks, at most two per task;
 * dependents fill the last tasks, one each. The first dependent task comes at least four tasks after the last source
 * task, so three whole tasks (each over 1.5 windows / 3 of output) lie between every source and its dependent.
 */
import { createHash } from "node:crypto";
import { DAYS, FAMILIES, FILLER, PEOPLE, TOKEN_WORDS } from "./families.mjs";

/** Characters per token for sizing: Prism's own estimate for English text is about 3.5. */
export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN);
/** A job's artifact, in tokens (seeded inside the range). */
export const JOB_ARTIFACT_TOKENS = Object.freeze([17_000, 18_500]);
/** A tool-fact host or stale document, in tokens. */
export const SIDE_ARTIFACT_TOKENS = Object.freeze([2_500, 4_000]);
export const TASKS_PER_SESSION = Object.freeze([8, 14]);
/** Fewest whole tasks between a dependency's last source and its dependent. */
export const MIN_TASK_GAP = 3;
/** Pre-existing look-alike flags per feature (v3): a D3 dependent must turn on its own flag and leave these off. */
export const FLAG_LOOKALIKES = Object.freeze(["legacy", "pilot", "shadow"]);

/** A seeded generator (mulberry32 over the first four bytes of SHA-256(key)). */
export function rngFor(key) {
  let a = createHash("sha256").update(key).digest().readUInt32LE(0);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const shuffle = (list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const hex = (n) => Array.from({ length: n }, () => int(0, 15).toString(16)).join("");
  return { next, int, pick, shuffle, hex };
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const slug = (text) => text.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

function sentence(rng) {
  const { verbs, nouns, adjectives, topics } = FILLER;
  return `${capital(rng.pick(verbs))} the ${rng.pick(adjectives)} ${rng.pick(nouns)} for ${rng.pick(topics)}; the ${rng.pick(nouns)} looks ${rng.pick(adjectives)}.`;
}

/** Fill to `chars` with lines from `line()`; returns the lines. */
function fill(chars, line) {
  const lines = [];
  let size = 0;
  while (size < chars) {
    const text = line(lines.length);
    lines.push(text);
    size += text.length + 1;
  }
  return lines;
}

const insertAt = (rng, lines, items) => {
  for (const item of items) lines.splice(rng.int(1, lines.length - 1), 0, item);
  return lines;
};

function logText(rng, service, tokens, errors) {
  const levels = ["INFO", "DEBUG", "WARN", "INFO"];
  const stamp = (i) =>
    `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}Z`;
  const line = (i, level, status) =>
    `${stamp(i)} ${level} ${service} req=${rng.hex(8)} path=/${rng.pick(FILLER.paths)}/${rng.int(1, 999)} status=${status} latency=${rng.int(3, 900)}ms`;
  const lines = fill(Math.round(tokens * CHARS_PER_TOKEN), (i) => line(i, rng.pick(levels), rng.pick([200, 200, 201, 204, 304, 404])));
  const failures = Array.from({ length: errors }, (_, i) => `${line(i, "ERROR", 500)} msg=upstream ${rng.pick(FILLER.nouns)} failed`);
  return insertAt(rng, lines, failures).join("\n");
}

function chatterLines(rng, tokens, people) {
  return fill(Math.round(tokens * CHARS_PER_TOKEN), () => `${rng.pick(people)}: ${sentence(rng)}`);
}

function proseText(rng, tokens, title, inserts = []) {
  const paragraphs = fill(Math.round(tokens * CHARS_PER_TOKEN), () => Array.from({ length: rng.int(3, 6) }, () => sentence(rng)).join(" "));
  return [`# ${title}`, "", ...insertAt(rng, paragraphs, inserts)].join("\n\n");
}

const tokensIn = (rng, [lo, hi]) => rng.int(lo, hi);

/**
 * Build one session. `family` is a FAMILIES entry; `seed` the benchmark seed; `index` the session's number in its
 * family. Returns the session spec (plain JSON).
 */
export function buildSession(family, index, seed) {
  const id = `sb-${family.short}-${String(index).padStart(2, "0")}`;
  const rng = rngFor(`${seed}:${id}`);
  const n = rng.int(...TASKS_PER_SESSION);
  const env = {
    files: { "README.md": `# ${family.title}\n\nWorkspace for the ${family.teams.join(", ")} teams.\n` },
    tickets: [],
    messages: { "#release": chatterLines(rng, 400, PEOPLE).map((text) => toMessage(text)) },
    config: {},
    rules: [],
  };
  let ticketNo = 100;
  const ticket = (title, body = "", status = "open") => {
    const row = { id: `T-${ticketNo++}`, title, status, assignee: "", labels: [], body };
    env.tickets.push(row);
    return row.id;
  };
  // Background tickets and flags, so listings are not trivial.
  for (let i = 0; i < 6; i++)
    ticket(
      `${rng.pick(family.services)} ${rng.pick(FILLER.nouns)} ${rng.pick(FILLER.topics)}`,
      sentence(rng),
      rng.pick(["open", "closed"]),
    );
  // v3 (plan 218.3 Task 12, owner 2026-11-19): three look-alikes per feature, so listing the config does not single out
  // the flag the agent named itself (v2's amnesic agent found it 1 time in 6).
  for (const feature of family.features) for (const suffix of FLAG_LOOKALIKES) env.config[`flags.${feature}_${suffix}`] = false;

  const used = { services: new Set(), features: new Set(), areas: new Set(), words: new Set(), days: new Set() };
  const fresh = (list, kind) => {
    const left = list.filter((item) => !used[kind].has(item));
    const item = rng.pick(left.length ? left : list);
    used[kind].add(item);
    return item;
  };

  // --- dependencies -------------------------------------------------------------------------------------------------
  const classes = ["D2", "D4"];
  if (n >= 10) classes.push("D1", "D3");
  else classes.push(rng.pick(["D1", "D3"]));
  if (n >= 12) classes.push(rng.pick(["D1", "D2"]));
  const deps = [];
  const d2Variants = rng.shuffle(["label", "signature"]);
  for (const [k, cls] of classes.entries()) deps.push(makeDependency(cls, `dep${k + 1}`, { rng, family, env, ticket, fresh, d2Variants }));

  // Sources: D4's first statement leads, its correction closes; at most two per task.
  const d4 = deps.find((dep) => dep.class === "D4");
  const middle = rng.shuffle(deps.filter((dep) => dep !== d4).flatMap((dep) => dep.sources));
  const sources = [d4.sources[0], ...middle, d4.sources[1]];
  const sourceTasks = Math.ceil(sources.length / 2);
  for (const [i, source] of sources.entries()) source.task = 1 + Math.floor(i / 2);
  if (d4.sources[0].task === d4.sources[1].task) throw new Error(`SessionBenchBuild: ${id} puts both D4 statements in one task`);
  const dependentOrder = rng.shuffle(deps);
  for (const [i, dep] of dependentOrder.entries()) dep.dependent.task = n - dependentOrder.length + 1 + i;
  const firstDependent = n - dependentOrder.length + 1;
  if (firstDependent - sourceTasks - 1 < MIN_TASK_GAP)
    throw new Error(`SessionBenchBuild: ${id} leaves ${firstDependent - sourceTasks - 1} tasks between sources and dependents`);

  // --- tasks ----------------------------------------------------------------------------------------------------------
  let fixRules = 0;
  const offset = rng.int(0, family.jobs.length - 1);
  const tasks = Array.from({ length: n }, (_, i) => {
    let kind = family.jobs[(offset + i) % family.jobs.length];
    if (kind === "fix-rule" && ++fixRules > 2) kind = "count-errors";
    const job = makeJob(kind, { rng, family, env, ticket, fresh, n: i + 1 });
    return { n: i + 1, job: kind, parts: [job] };
  });
  for (const source of sources) tasks[source.task - 1].parts.push(source);
  for (const dep of deps) tasks[dep.dependent.task - 1].parts.push(dep.dependent);

  const scope = [
    `Session plan: ${family.title}`,
    ...tasks.map((task) => `${task.n}. ${capital(task.parts.map((part) => part.step).join("; then "))}.`),
  ].join("\n");
  const builtTasks = tasks.map((task) => ({
    n: task.n,
    job: task.job,
    prompt: `Task ${task.n}. ${task.parts.map((part) => part.sentence).join(" ")}`,
    checks: task.parts.flatMap((part, p) => (part.checks ?? []).map((check, c) => ({ id: `t${task.n}.${p}.${c}`, ...check }))),
    plan: task.parts.flatMap((part) => part.plan),
    notes: task.parts.flatMap((part) => (part.note ? [part.note] : [])),
  }));
  return finishSession({
    id,
    family: family.id,
    scope,
    tasks: builtTasks,
    deps: deps.map((dep) => ({
      id: dep.id,
      class: dep.class,
      ...(dep.variant ? { variant: dep.variant } : {}),
      sources: dep.sources.map((source) => source.task),
      dependent: dep.dependent.task,
      answer: dep.answer,
      evidence: dep.evidence,
      ...(dep.distractor ? { distractor: dep.distractor } : {}),
    })),
    env,
  });
}

function toMessage(line) {
  const at = line.indexOf(": ");
  return { author: line.slice(0, at), text: line.slice(at + 2) };
}

const call = (name, args = {}) => [name, args];

/** A job: the task's control piece of work, one large artifact, one `C` check. */
function makeJob(kind, { rng, family, env, ticket, fresh, n }) {
  const size = tokensIn(rng, JOB_ARTIFACT_TOKENS);
  if (kind === "count-errors") {
    const service = rng.pick(family.services);
    const errors = rng.int(4, 19);
    const path = `logs/${service}-${n}.log`;
    const key = `${service}.errors_${n}`;
    env.files[path] = logText(rng, service, size, errors);
    return {
      step: `${service} log errors: count the ERROR lines in the ${service} log ${n} and record the count in config`,
      sentence: `Count the ERROR lines in ${path} and set config key ${key} to that number.`,
      checks: [{ class: "C", kind: "config-equals", key, value: errors }],
      plan: [{ calls: [call("read_file", { path }), call("set_config", { key, value: errors })] }],
      note: `set ${key} to ${errors}`,
    };
  }
  if (kind === "close-resolved") {
    const service = rng.pick(family.services);
    const channel = `#ops-${service}-${n}`;
    const title = () => `${service} ${rng.pick(FILLER.nouns)} ${rng.pick(FILLER.adjectives)}`;
    const resolved = Array.from({ length: rng.int(2, 3) }, () => ticket(title()));
    const keep = ticket(title());
    const lines = chatterLines(rng, size, PEOPLE);
    insertAt(rng, lines, [
      ...resolved.map((id) => `${rng.pick(PEOPLE)}: resolved ${id}, verified on the ${rng.pick(FILLER.nouns)}.`),
      `${rng.pick(PEOPLE)}: ${keep} is not fixed yet, keep it open.`,
    ]);
    env.messages[channel] = lines.map(toMessage);
    return {
      step: `${service} ops channel: close the ${service} tickets the ops channel reports as resolved`,
      sentence: `Read ${channel} and close every ticket it reports as resolved; leave the others as they are.`,
      checks: [{ class: "C", kind: "tickets-status", closed: resolved, open: [keep] }],
      plan: [{ calls: [call("read_messages", { channel }), ...resolved.map((id) => call("update_ticket", { id, status: "closed" }))] }],
      note: `closed ${resolved.join(", ")}`,
    };
  }
  if (kind === "fix-rule") {
    const service = rng.pick(family.services);
    const rule = `${service}-rule-${n}`;
    const count = Math.round((size * CHARS_PER_TOKEN) / 85);
    const keys = Array.from({ length: count }, (_, i) => {
      const key = `${service}.r${n}.${rng.pick(FILLER.paths)}_${rng.pick(FILLER.topics)}_${i}`;
      return [key, rng.int(1, 9999), `${rng.pick(FILLER.topics)} bound for the ${rng.pick(FILLER.adjectives)} ${rng.pick(FILLER.nouns)}`];
    });
    for (const [key, value] of keys) env.config[key] = value;
    const [failKey, expected] = keys[rng.int(0, keys.length - 1)];
    env.config[failKey] = expected + rng.int(1, 500);
    env.rules.push({ id: rule, keys });
    return {
      step: `${service} rule ${n}: run the ${service} rule check and fix the failing config value`,
      sentence: `Run the project check ${rule} and fix the config value it reports as failing.`,
      checks: [{ class: "C", kind: "config-equals", key: failKey, value: expected }],
      plan: [{ calls: [call("run_check", { rule }), call("set_config", { key: failKey, value: expected })] }],
      note: `set ${failKey} to ${expected}`,
    };
  }
  if (kind === "owner-assign") {
    const area = fresh(family.areas, "areas");
    const [owner, former] = rng.shuffle(PEOPLE);
    const path = `docs/${slug(area)}-guide.md`;
    env.files[path] = proseText(rng, size, `${capital(area)} guide`, [`Former owner: ${former}.`, `Owner: ${owner}.`]);
    const id = ticket(`Assign an owner for ${area}`);
    return {
      step: `${area} owner: assign the ${area} ticket to the owner named in the ${area} guide`,
      sentence: `Read ${path} and assign ticket ${id} to the ${area} owner it names.`,
      checks: [{ class: "C", kind: "ticket-field", id, field: "assignee", value: owner }],
      plan: [{ calls: [call("read_file", { path }), call("update_ticket", { id, assignee: owner })] }],
      note: `assigned ${id} to ${owner}`,
    };
  }
  throw new Error(`SessionBenchBuild: unknown job ${kind}`);
}

/** A dependency: its sources (task set later), its dependent part, its answer and the evidence string. */
function makeDependency(cls, depId, { rng, family, env, ticket, fresh, d2Variants }) {
  const side = () => tokensIn(rng, SIDE_ARTIFACT_TOKENS);
  if (cls === "D1") {
    const service = fresh(family.services, "services");
    const param = rng.pick(family.params);
    const key = `${service}.${param}`;
    const value = rng.int(10, 990) * 10;
    let other = rng.int(10, 990) * 10;
    if (other === value) other += 10;
    env.config[key] = other + 5;
    const evidence = `${key} to ${value}`;
    const distractor = `${key} to ${other}`;
    const apply = call("set_config", { key, value });
    let source;
    let rederive;
    let dependentSentence;
    let dependentStep;
    if (family.d1Host === "file") {
      const path = `docs/runbook-${service}.md`;
      env.files[path] = proseText(rng, side(), `${capital(service)} runbook`, [`Recommended change: set ${evidence}.`]);
      env.files[`docs/archive/runbook-${service}-old.md`] = proseText(rng, 600, `${capital(service)} runbook (old)`, [
        `Recommended change: set ${distractor}.`,
      ]);
      const id = ticket(`Review the ${service} runbook`);
      source = {
        step: `review the ${service} runbook`,
        sentence: `Also review ${path} and set ticket ${id} to status reviewed.`,
        checks: [{ class: "C", kind: "ticket-field", id, field: "status", value: "reviewed" }],
        plan: [{ calls: [call("read_file", { path }), call("update_ticket", { id, status: "reviewed" })] }],
        note: `the ${service} runbook recommends: set ${evidence}`,
      };
      rederive = [call("read_file", { path })];
      dependentStep = `apply the ${service} runbook's recommended config change`;
      dependentSentence = `Apply the config change that the ${service} runbook you reviewed recommends.`;
    } else if (family.d1Host === "ticket") {
      const id = ticket(
        `${service} ${param} incident`,
        proseText(rng, side(), `${service} ${param} incident`, [`Resolution: set ${evidence}.`]),
      );
      ticket(`${service} ${param} incident (last year)`, `Resolution: set ${distractor}.`, "closed");
      source = {
        step: `triage the ${service} ${param} incident ticket`,
        sentence: `Also triage ticket ${id}: read it and set its status to triaged.`,
        checks: [{ class: "C", kind: "ticket-field", id, field: "status", value: "triaged" }],
        plan: [{ calls: [call("get_ticket", { id }), call("update_ticket", { id, status: "triaged" })] }],
        note: `${id} resolution: set ${evidence}`,
      };
      rederive = [call("list_tickets", { status: "triaged" }), call("get_ticket", { id })];
      dependentStep = `apply the config change from the ${service} incident`;
      dependentSentence = `Apply the config change that the ${service} incident ticket you triaged calls for.`;
    } else {
      const channel = `#${service}-notes`;
      const [decider, proposer] = rng.shuffle(PEOPLE);
      const lines = chatterLines(rng, side(), PEOPLE);
      lines.splice(1, 0, `${proposer}: proposal, rejected: set ${distractor}.`);
      lines.splice(lines.length - 1, 0, `${decider}: decision: set ${evidence}.`);
      env.messages[channel] = lines.map(toMessage);
      const id = ticket(`Follow up on the ${service} notes`);
      source = {
        step: `assign the ${service} notes follow-up`,
        sentence: `Also read ${channel} and assign ticket ${id} to the person who posted the decision there.`,
        checks: [{ class: "C", kind: "ticket-field", id, field: "assignee", value: decider }],
        plan: [{ calls: [call("read_messages", { channel }), call("update_ticket", { id, assignee: decider })] }],
        note: `${channel} decision: set ${evidence}`,
      };
      rederive = [call("read_messages", { channel })];
      dependentStep = `apply the ${service} config decision`;
      dependentSentence = `Apply the ${service} config decision from ${channel}.`;
    }
    return {
      id: depId,
      class: "D1",
      answer: String(value),
      evidence,
      distractor,
      sources: [source],
      dependent: {
        step: dependentStep,
        sentence: dependentSentence,
        checks: [{ class: "D1", dep: depId, kind: "config-equals", key, value }],
        plan: [{ dep: depId, known: [apply], unknown: [...rederive, apply] }],
        note: { dep: depId, known: `set ${evidence}`, unknown: `set ${evidence} after re-reading` },
      },
    };
  }
  if (cls === "D2") {
    const variant = d2Variants.shift() ?? "label";
    const word = fresh(TOKEN_WORDS, "words");
    const service = rng.pick(family.services);
    const subject = `${service} ${rng.pick(FILLER.nouns)} clean-up`;
    if (variant === "label") {
      const label = `${word}-${rng.int(10, 99)}`;
      const title = `Follow up on the ${subject}`;
      return {
        id: depId,
        class: "D2",
        variant,
        answer: label,
        evidence: label,
        sources: [
          {
            step: "note the team's ticket labelling rule",
            sentence: `Team rule, said only here: every ticket you create from now on must carry the label ${label}.`,
            plan: [],
            note: `rule: new tickets carry the label ${label}`,
          },
        ],
        dependent: {
          step: `open a follow-up ticket for the ${subject}`,
          sentence: `Open a ticket to follow up on the ${subject}.`,
          checks: [{ class: "D2", dep: depId, kind: "created-ticket-labelled", label }],
          plan: [
            {
              dep: depId,
              known: [call("create_ticket", { title, labels: [label] })],
              unknown: [call("create_ticket", { title })],
            },
          ],
          note: { dep: depId, known: `opened a follow-up ticket labelled ${label}`, unknown: "opened a follow-up ticket" },
        },
      };
    }
    const team = rng.pick(family.teams);
    const channel = `#${team}-status`;
    const sig = `-- ${word}${rng.int(10, 99)}`;
    env.messages[channel] ??= chatterLines(rng, 300, PEOPLE).map(toMessage);
    const text = `Status: the ${subject} is under way.`;
    return {
      id: depId,
      class: "D2",
      variant,
      answer: sig,
      evidence: sig,
      sources: [
        {
          step: `note the house style for ${channel}`,
          sentence: `House style, said only here: end every message you post in ${channel} with "${sig}".`,
          plan: [],
          note: `style: messages in ${channel} end with "${sig}"`,
        },
      ],
      dependent: {
        step: `post a status update on the ${subject} in ${channel}`,
        sentence: `Post a one-line status update on the ${subject} in ${channel}.`,
        checks: [{ class: "D2", dep: depId, kind: "message-posted", channel, includes: [sig] }],
        plan: [
          {
            dep: depId,
            known: [call("post_message", { channel, text: `${text} ${sig}` })],
            unknown: [call("post_message", { channel, text })],
          },
        ],
        note: { dep: depId, known: `posted the status update signed "${sig}"`, unknown: "posted the status update" },
      },
    };
  }
  if (cls === "D3") {
    const feature = fresh(family.features, "features");
    const name = `flags.${feature}_rollout`;
    return {
      id: depId,
      class: "D3",
      answer: name,
      evidence: name,
      distractor: `flags.${feature}_legacy`,
      sources: [
        {
          step: `add a feature flag for ${feature}`,
          sentence: `Also add a feature flag for ${feature} under flags. in config, set to false; choose its name yourself.`,
          checks: [{ class: "C", kind: "flag-created", prefix: "flags." }],
          plan: [{ calls: [call("set_config", { key: name, value: false })] }],
          note: `added ${name} = false for ${feature}`,
        },
      ],
      dependent: {
        step: `turn on the ${feature} feature flag`,
        sentence: `Turn on the feature flag you added for ${feature}.`,
        // sourceTask is filled in once the layout places the source.
        checks: [
          {
            class: "D3",
            dep: depId,
            kind: "flag-on",
            prefix: "flags.",
            sourceTask: null,
            othersOff: FLAG_LOOKALIKES.map((suffix) => `flags.${feature}_${suffix}`),
          },
        ],
        plan: [
          {
            dep: depId,
            known: [call("set_config", { key: name, value: true })],
            unknown: [call("get_config", {}), call("set_config", { key: `flags.${feature}_legacy`, value: true })],
          },
        ],
        note: { dep: depId, known: `turned on ${name}`, unknown: `turned on flags.${feature}_legacy` },
      },
    };
  }
  if (cls === "D4") {
    const [before, after] = rng.shuffle(DAYS);
    const path = "docs/release-process.md";
    env.files[path] = proseText(rng, side(), "Release process", [`Ship day: ${before}.`]);
    return {
      id: depId,
      class: "D4",
      answer: after,
      evidence: `ship on ${after}`,
      distractor: before,
      sources: [
        {
          step: "note the planned ship day",
          sentence: `Planning note: we ship on ${before}.`,
          plan: [],
          note: `planned: ship on ${before}`,
        },
        {
          step: "note the change to the ship day",
          sentence: `Change of plan: we ship on ${after}, not ${before}.`,
          plan: [],
          note: `changed: ship on ${after}`,
        },
      ],
      dependent: {
        step: "announce the ship day in #release",
        sentence: "Announce the ship day in #release.",
        // v3 (plan 218.3 Task 12): the new day only; v2 also excluded the old day, which failed a correct announcement
        // that mentions the change (oracle-context passed 2 of 6 in Task 11).
        checks: [{ class: "D4", dep: depId, kind: "message-posted", channel: "#release", includes: [after] }],
        plan: [
          {
            dep: depId,
            known: [call("post_message", { channel: "#release", text: `We ship on ${after}.` })],
            unknown: [call("read_file", { path }), call("post_message", { channel: "#release", text: `We ship on ${before}.` })],
          },
        ],
        note: { dep: depId, known: `announced: ship on ${after}`, unknown: `announced: ship on ${before}` },
      },
    };
  }
  throw new Error(`SessionBenchBuild: unknown class ${cls}`);
}

/** Fill in each D3 dependent check's source task (known only after layout). */
export function finishSession(session) {
  for (const dep of session.deps.filter((row) => row.class === "D3"))
    for (const check of session.tasks[dep.dependent - 1].checks) if (check.kind === "flag-on") check.sourceTask = dep.sources[0];
  return session;
}

export { FAMILIES };
