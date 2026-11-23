/**
 * Plan 218.5 Task 4: the long bench's session builder. A session is a pure function of its id and the benchmark seed:
 * 100 tasks in four phases of 25, each phase with its own scope (a numbered plan, one step per task), the workspace
 * state, the labelled dependencies and every task's checks and scripted plan.
 *
 * Session-Bench v3 is read, never edited: the families, the filler vocabulary, the seeded generator and the workspace
 * are imported. v3 does not export its job makers, so the four jobs are written again here at the long bench's artifact
 * size. The only Prism import reached is the kernel's estimator through `./pressure.mjs`; nothing reaches the memory
 * system (G2).
 *
 * Layout (task numbers; the buckets come from plan 218.5 Task 2's measured overflow point):
 *
 * - **1–10, sources.** Every rule, fact, own decision and first value, at most two per task.
 * - **20–38, `before` dependents.** One per task, before the densest session's pool overflow (task 39).
 * - **40–52, mid sources.** A rule is revoked and two ship days change again.
 * - **64–100, `after` dependents.** One per task, after the mean overflow task plus 10 (task 63). One ship day changes a
 *   third time inside this range (70–80), with a dependent on each side of the change.
 *
 * A dependency row is one check occasion: a standing rule checked four times is four rows that share a `group` and
 * their sources. Every row keeps v3's shape (`sources`, `dependent`, `answer`, `evidence`), so v3's plan format applies.
 */
import { CHARS_PER_TOKEN, estimateTokens, FLAG_LOOKALIKES, rngFor, SIDE_ARTIFACT_TOKENS } from "../session-bench/templates/build.mjs";
import { DAYS, FAMILIES, FILLER, PEOPLE, TOKEN_WORDS } from "../session-bench/templates/families.mjs";
import { REVOKE_CLASS } from "./checks.mjs";
import { LONG_JOB_ARTIFACT_TOKENS } from "./pressure.mjs";

export const LONG_TASKS = 100;
export const PHASE_TASKS = 25;
/** The pre-registered distance buckets (the gate record's `design.buckets`): by the dependent's task number. */
export const BUCKETS = Object.freeze({ beforeBelowTask: 39, afterAboveTask: 63 });
export const bucketOf = (task) => (task < BUCKETS.beforeBelowTask ? "before" : task > BUCKETS.afterAboveTask ? "after" : null);
/** Where each kind of part may sit (inclusive task ranges). */
export const LAYOUT = Object.freeze({
  sources: Object.freeze([1, 10]),
  before: Object.freeze([20, BUCKETS.beforeBelowTask - 1]),
  midSources: Object.freeze([40, 52]),
  after: Object.freeze([BUCKETS.afterAboveTask + 1, LONG_TASKS]),
  lateChange: Object.freeze([70, 80]),
  /** Fewest tasks from the late change to the dependent that needs its value. */
  lateChangeGap: 10,
});
/** Dependents per session, class and bucket: every `D1`–`D4` class has twice as many `after` as `before`. */
export const CLASS_LAYOUT = Object.freeze({
  D1: Object.freeze({ before: 1, after: 2 }),
  D2: Object.freeze({ before: 3, after: 6 }),
  D3: Object.freeze({ before: 1, after: 2 }),
  D4: Object.freeze({ before: 3, after: 6 }),
  [REVOKE_CLASS]: Object.freeze({ before: 0, after: 2 }),
});
/** Most sources one task carries, as in v3. */
export const MAX_SOURCES_PER_TASK = 2;
/**
 * A job artifact is built to a drawn size plus at most this much: the last filler line, and a prose file's blank lines.
 * Sizes are drawn from the range less this slack, so every artifact stays inside `LONG_JOB_ARTIFACT_TOKENS`.
 */
export const ARTIFACT_SLACK_TOKENS = 250;
/**
 * Rule jobs per session, as in v3. Each adds a rule's keys to the config, and `get_config` with no key lists them all:
 * that listing is the largest output an agent without memory reads (the `D3` re-derivation), so it has to stay an
 * artifact-sized output.
 */
export const MAX_FIX_RULE_JOBS = 2;
/** Ship-day statements per train: [in tasks 1–10, in the mid range, in the late range]. Changes = statements − 1. */
const TRAIN_STATEMENTS = Object.freeze([Object.freeze([2, 1, 0]), Object.freeze([3, 0, 0]), Object.freeze([2, 1, 1])]);

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const slug = (text) => text.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const range = ([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const call = (name, args = {}) => [name, args];

function sentence(rng) {
  const { verbs, nouns, adjectives, topics } = FILLER;
  return `${capital(rng.pick(verbs))} the ${rng.pick(adjectives)} ${rng.pick(nouns)} for ${rng.pick(topics)}; the ${rng.pick(nouns)} looks ${rng.pick(adjectives)}.`;
}

/**
 * Lines of `line()` until they and `inserts` together reach `chars`, with the inserts placed at seeded positions after
 * the first line. `width` is what one line adds to the text (its length and its separator).
 */
function sized(rng, chars, inserts, line, width = (text) => text.length + 1) {
  const lines = [];
  let size = inserts.reduce((sum, text) => sum + width(text), 0);
  while (size < chars || lines.length < 2) {
    const text = line(lines.length);
    lines.push(text);
    size += width(text);
  }
  for (const item of inserts) lines.splice(rng.int(1, lines.length - 1), 0, item);
  return lines;
}

const toMessage = (line) => {
  const at = line.indexOf(": ");
  return { author: line.slice(0, at), text: line.slice(at + 2) };
};
const chatter = (rng, tokens, inserts = []) =>
  sized(rng, Math.round(tokens * CHARS_PER_TOKEN), inserts, () => `${rng.pick(PEOPLE)}: ${sentence(rng)}`);
const prose = (rng, tokens, title, inserts = []) =>
  [
    `# ${title}`,
    ...sized(
      rng,
      Math.round(tokens * CHARS_PER_TOKEN) - title.length - 2,
      inserts,
      () => Array.from({ length: rng.int(3, 6) }, () => sentence(rng)).join(" "),
      (text) => text.length + 2,
    ),
  ].join("\n\n");

function logText(rng, service, tokens, errors) {
  const levels = ["INFO", "DEBUG", "WARN", "INFO"];
  const stamp = (i) =>
    `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}Z`;
  const line = (i, level, status) =>
    `${stamp(i)} ${level} ${service} req=${rng.hex(8)} path=/${rng.pick(FILLER.paths)}/${rng.int(1, 999)} status=${status} latency=${rng.int(3, 900)}ms`;
  const failures = Array.from({ length: errors }, (_, i) => `${line(i, "ERROR", 500)} msg=upstream ${rng.pick(FILLER.nouns)} failed`);
  return sized(rng, Math.round(tokens * CHARS_PER_TOKEN), failures, (i) =>
    line(i, rng.pick(levels), rng.pick([200, 200, 201, 204, 304, 404])),
  ).join("\n");
}

/** A job: the task's control piece of work, one artifact of 6,000–9,000 tokens, one `C` check. Its read comes first. */
function makeJob(kind, { rng, family, env, ticket, n }) {
  const size = rng.int(LONG_JOB_ARTIFACT_TOKENS[0], LONG_JOB_ARTIFACT_TOKENS[1] - ARTIFACT_SLACK_TOKENS);
  const service = rng.pick(family.services);
  if (kind === "count-errors") {
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
    const channel = `#ops-${service}-${n}`;
    const title = () => `${service} ${rng.pick(FILLER.nouns)} ${rng.pick(FILLER.adjectives)}`;
    const resolved = Array.from({ length: rng.int(2, 3) }, () => ticket(title()));
    const keep = ticket(title());
    env.messages[channel] = chatter(rng, size, [
      ...resolved.map((id) => `${rng.pick(PEOPLE)}: resolved ${id}, verified on the ${rng.pick(FILLER.nouns)}.`),
      `${rng.pick(PEOPLE)}: ${keep} is not fixed yet, keep it open.`,
    ]).map(toMessage);
    return {
      step: `${service} ops channel ${n}: close the ${service} tickets the ops channel reports as resolved`,
      sentence: `Read ${channel} and close every ticket it reports as resolved; leave the others as they are.`,
      checks: [{ class: "C", kind: "tickets-status", closed: resolved, open: [keep] }],
      plan: [{ calls: [call("read_messages", { channel }), ...resolved.map((id) => call("update_ticket", { id, status: "closed" }))] }],
      note: `closed ${resolved.join(", ")}`,
    };
  }
  if (kind === "fix-rule") {
    const rule = `${service}-rule-${n}`;
    // The report is the artifact: one `PASS key = value (note)` line per key. Long notes keep the config listing small.
    const keys = [];
    const header = `rule ${rule}: 0000 passed, 1 failed\n`.length;
    for (let chars = header; chars < size * CHARS_PER_TOKEN; ) {
      const key = `${service}.r${n}.${rng.pick(FILLER.paths)}_${rng.pick(FILLER.topics)}_${keys.length}`;
      const value = rng.int(1, 9999);
      const note = `${rng.pick(FILLER.topics)} bound for the ${rng.pick(FILLER.adjectives)} ${rng.pick(FILLER.nouns)}, ${rng.pick(FILLER.verbs)} after the ${rng.pick(FILLER.adjectives)} ${rng.pick(FILLER.nouns)} ${rng.pick(FILLER.topics)} review`;
      keys.push([key, value, note]);
      chars += `PASS ${key} = ${value} (${note})\n`.length;
    }
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
    const area = rng.pick(family.areas);
    const [owner, former] = rng.shuffle(PEOPLE);
    const path = `docs/guides/${slug(area)}-${n}.md`;
    env.files[path] = prose(rng, size, `${capital(area)} guide ${n}`, [`Former owner: ${former}.`, `Owner: ${owner}.`]);
    const id = ticket(`Assign an owner for ${area} (guide ${n})`);
    return {
      step: `${area} owner ${n}: assign the ${area} ticket to the owner named in the ${area} guide ${n}`,
      sentence: `Read ${path} and assign ticket ${id} to the ${area} owner it names.`,
      checks: [{ class: "C", kind: "ticket-field", id, field: "assignee", value: owner }],
      plan: [{ calls: [call("read_file", { path }), call("update_ticket", { id, assignee: owner })] }],
      note: `assigned ${id} to ${owner}`,
    };
  }
  throw new Error(`SessionBenchLongBuild: unknown job ${kind}`);
}

/**
 * A thread is one dependency's story: its sources (`early`, `mid`, `late`, in order; the layout sets each `task`) and
 * `dependent(id, task)`, which builds the dependent part and its row once every source has its task.
 */
const sourceTasks = (thread, before) =>
  [...thread.early, ...thread.mid, ...thread.late].map((source) => source.task).filter((task) => task < before);
const dependentRow = (thread, id, task, fields) => ({
  id,
  class: thread.class,
  group: thread.group,
  bucket: bucketOf(task),
  sources: sourceTasks(thread, task),
  dependent: task,
  ...fields,
});
const depCheck = (row, check) => ({ class: row.class, dep: row.id, bucket: row.bucket, ...check });

/** `D1`: a value a tool read early, applied later. Every fact of a session is the same parameter of another service. */
function factThread(k, { rng, family, env, ticket, fresh, param, values }) {
  const side = () => rng.int(...SIDE_ARTIFACT_TOKENS);
  const service = fresh(family.services, "services");
  const key = `${service}.${param}`;
  const value = values();
  const other = values();
  env.config[key] = other + 5;
  const evidence = `${key} to ${value}`;
  const distractor = `${key} to ${other}`;
  const apply = call("set_config", { key, value });
  let source;
  let rederive;
  let step;
  let dependentSentence;
  if (family.d1Host === "file") {
    const path = `docs/runbook-${service}.md`;
    env.files[path] = prose(rng, side(), `${capital(service)} runbook`, [`Recommended change: set ${evidence}.`]);
    env.files[`docs/archive/runbook-${service}-old.md`] = prose(rng, 600, `${capital(service)} runbook (old)`, [
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
    step = `apply the ${service} runbook's recommended config change`;
    dependentSentence = `Apply the config change that the ${service} runbook you reviewed recommends.`;
  } else if (family.d1Host === "ticket") {
    const id = ticket(`${service} ${param} incident`, prose(rng, side(), `${service} ${param} incident`, [`Resolution: set ${evidence}.`]));
    ticket(`${service} ${param} incident (last year)`, `Resolution: set ${distractor}.`, "closed");
    source = {
      step: `triage the ${service} ${param} incident ticket`,
      sentence: `Also triage ticket ${id}: read it and set its status to triaged.`,
      checks: [{ class: "C", kind: "ticket-field", id, field: "status", value: "triaged" }],
      plan: [{ calls: [call("get_ticket", { id }), call("update_ticket", { id, status: "triaged" })] }],
      note: `${id} resolution: set ${evidence}`,
    };
    rederive = [call("list_tickets", { status: "triaged" }), call("get_ticket", { id })];
    step = `apply the config change from the ${service} incident`;
    dependentSentence = `Apply the config change that the ${service} incident ticket you triaged calls for.`;
  } else {
    const channel = `#${service}-notes`;
    const [decider, proposer] = rng.shuffle(PEOPLE);
    const lines = chatter(rng, side());
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
    step = `apply the ${service} config decision`;
    dependentSentence = `Apply the ${service} config decision from ${channel}.`;
  }
  const thread = { class: "D1", group: `fact${k}`, early: [source], mid: [], late: [] };
  thread.dependent = (id, task) => {
    const row = dependentRow(thread, id, task, { answer: String(value), evidence, distractor });
    return {
      row,
      step,
      sentence: dependentSentence,
      checks: [depCheck(row, { kind: "config-equals", key, value })],
      plan: [{ dep: id, known: [apply], unknown: [...rederive, apply] }],
      note: { dep: id, known: `set ${evidence}`, unknown: `set ${evidence} after re-reading` },
    };
  };
  return thread;
}

/** `D3`: a flag the agent names itself, turned on later. Three look-alikes per feature exist from the start. */
function flagThread(k, { family, fresh }) {
  const feature = fresh(family.features, "features");
  const name = `flags.${feature}_rollout`;
  const legacy = `flags.${feature}_legacy`;
  const source = {
    step: `add a feature flag for ${feature}`,
    sentence: `Also add a feature flag for ${feature} under flags. in config, set to false; choose its name yourself.`,
    checks: [{ class: "C", kind: "flag-created", prefix: "flags." }],
    plan: [{ calls: [call("set_config", { key: name, value: false })] }],
    note: `added ${name} = false for ${feature}`,
  };
  const thread = { class: "D3", group: `flag${k}`, early: [source], mid: [], late: [] };
  thread.dependent = (id, task) => {
    const row = dependentRow(thread, id, task, { answer: name, evidence: name, distractor: legacy });
    return {
      row,
      step: `turn on the ${feature} feature flag`,
      sentence: `Turn on the feature flag you added for ${feature}.`,
      checks: [
        depCheck(row, {
          kind: "flag-on",
          prefix: "flags.",
          sourceTask: source.task,
          othersOff: FLAG_LOOKALIKES.map((suffix) => `flags.${feature}_${suffix}`),
        }),
      ],
      plan: [
        {
          dep: id,
          known: [call("set_config", { key: name, value: true })],
          unknown: [call("get_config", {}), call("set_config", { key: legacy, value: true })],
        },
      ],
      note: { dep: id, known: `turned on ${name}`, unknown: `turned on ${legacy}` },
    };
  };
  return thread;
}

/**
 * `D2` and `D2R`: two ticket label rules said only in conversation; the second is revoked in the mid range. Before the
 * revoke a new ticket is checked for the standing label. After it, jointly: the standing label on, the retired one off.
 */
function labelThread({ rng, fresh, subject }) {
  const standing = `${fresh(TOKEN_WORDS, "words")}-${rng.int(10, 99)}`;
  const retired = `${fresh(TOKEN_WORDS, "words")}-${rng.int(10, 99)}`;
  const revoke = {
    step: "note the change to the team's ticket labelling rules",
    sentence: `Rule change: the label ${retired} is retired. From now on do not put it on the tickets you create; the other ticket rule still holds.`,
    plan: [],
    note: `rule change: the label ${retired} is retired`,
  };
  const thread = {
    class: "D2",
    group: "labels",
    early: [
      {
        step: "note the team's ticket labelling rule",
        sentence: `Team rule, said only here: every ticket you create from now on must carry the label ${standing}.`,
        plan: [],
        note: `rule: new tickets carry the label ${standing}`,
      },
      {
        step: "note the team's second ticket labelling rule",
        sentence: `Another team rule, said only here: every ticket you create from now on must also carry the label ${retired}.`,
        plan: [],
        note: `rule: new tickets also carry the label ${retired}`,
      },
    ],
    mid: [revoke],
    late: [],
  };
  thread.dependent = (id, task) => {
    const about = subject();
    const title = `Follow up on the ${about}`;
    const revoked = task > revoke.task;
    const row = revoked
      ? {
          ...dependentRow(thread, id, task, { answer: standing, evidence: `the label ${retired} is retired`, standing, absent: retired }),
          class: REVOKE_CLASS,
        }
      : dependentRow(thread, id, task, { answer: standing, evidence: standing });
    const labels = revoked ? [standing] : [standing, retired];
    return {
      row,
      step: `open a follow-up ticket for the ${about}`,
      sentence: `Open a ticket to follow up on the ${about}.`,
      checks: [
        depCheck(
          row,
          revoked
            ? { kind: "created-ticket-labels", includes: [standing], excludes: [retired] }
            : { kind: "created-ticket-labelled", label: standing },
        ),
      ],
      plan: [{ dep: id, known: [call("create_ticket", { title, labels })], unknown: [call("create_ticket", { title })] }],
      note: { dep: id, known: `opened a follow-up ticket labelled ${labels.join(" and ")}`, unknown: "opened a follow-up ticket" },
    };
  };
  return thread;
}

/** `D2`: a signature for one team channel, said only in conversation. The other channel's signature must stay out. */
function signatureThread(k, team, { rng, env, fresh, subject }) {
  const channel = `#${team}-status`;
  const sig = `-- ${fresh(TOKEN_WORDS, "words")}${rng.int(10, 99)}`;
  env.messages[channel] = chatter(rng, 300).map(toMessage);
  const thread = {
    class: "D2",
    group: `signature${k}`,
    sig,
    early: [
      {
        step: `note the house style for ${channel}`,
        sentence: `House style, said only here: end every message you post in ${channel} with "${sig}".`,
        plan: [],
        note: `style: messages in ${channel} end with "${sig}"`,
      },
    ],
    mid: [],
    late: [],
  };
  thread.dependent = (id, task) => {
    const about = subject();
    const text = `Status: the ${about} is under way.`;
    const row = dependentRow(thread, id, task, { variant: "signature", answer: sig, evidence: sig });
    return {
      row,
      step: `post a status update on the ${about} in ${channel}`,
      sentence: `Post a one-line status update on the ${about} in ${channel}.`,
      checks: [depCheck(row, { kind: "message-posted", channel, includes: [sig], excludes: thread.others })],
      plan: [
        {
          dep: id,
          known: [call("post_message", { channel, text: `${text} ${sig}` })],
          unknown: [call("post_message", { channel, text })],
        },
      ],
      note: { dep: id, known: `posted the status update signed "${sig}"`, unknown: "posted the status update" },
    };
  };
  return thread;
}

/**
 * `D4`: one team's release train. The user states its ship day and changes it 2 or 3 times; every dependent needs the
 * day current at its task. The train's document keeps the first day. Trains share the five weekdays (look-alike values).
 */
function trainThread(k, team, [early, mid, late], { rng, env }) {
  const days = rng.shuffle(DAYS).slice(0, early + mid + late);
  const path = `docs/trains/${team}-train.md`;
  env.files[path] = prose(rng, rng.int(...SIDE_ARTIFACT_TOKENS), `${capital(team)} release train`, [`Ship day: ${days[0]}.`]);
  const evidence = (day) => `the ${team} train ships on ${day}`;
  const statements = days.map((day, i) =>
    i === 0
      ? {
          day,
          step: `note the planned ship day of the ${team} train`,
          sentence: `Planning note: ${evidence(day)}.`,
          plan: [],
          note: `planned: ${evidence(day)}`,
        }
      : {
          day,
          step: `note the change to the ${team} train's ship day`,
          sentence: `Change of plan: ${evidence(day)}, not ${days[i - 1]}.`,
          plan: [],
          note: `changed: ${evidence(day)}`,
        },
  );
  const thread = {
    class: "D4",
    group: `train${k}`,
    early: statements.slice(0, early),
    mid: statements.slice(early, early + mid),
    late: statements.slice(early + mid),
  };
  thread.dependent = (id, task) => {
    const said = statements.filter((statement) => statement.task < task);
    const current = said.at(-1).day;
    const row = dependentRow(thread, id, task, {
      answer: current,
      evidence: evidence(current),
      distractor: days[0],
      superseded: said.slice(0, -1).map((statement) => statement.day),
      document: path,
    });
    return {
      row,
      step: `announce the ${team} train's ship day in #release`,
      sentence: `Announce the ${team} train's ship day in #release.`,
      // v3's rule: the current day only; a correct announcement may name the change.
      checks: [depCheck(row, { kind: "message-posted", channel: "#release", includes: [current] })],
      plan: [
        {
          dep: id,
          known: [call("post_message", { channel: "#release", text: `${capital(evidence(current))}.` })],
          unknown: [call("read_file", { path }), call("post_message", { channel: "#release", text: `${capital(evidence(days[0]))}.` })],
        },
      ],
      note: { dep: id, known: `announced: ${evidence(current)}`, unknown: `announced: ${evidence(days[0])}` },
    };
  };
  return thread;
}

/** Tasks 1–10 for every thread's early sources: in order inside a thread, two per task at most, one flag per task. */
function placeEarly(rng, threads, id) {
  const load = new Map();
  const flagTasks = new Set();
  // Threads with the most sources first, then the flags (one per task: the flag check reads the task's first new key).
  const order = threads
    .map((thread, at) => ({ thread, at }))
    .sort(
      (a, b) =>
        b.thread.early.length - a.thread.early.length || Number(b.thread.class === "D3") - Number(a.thread.class === "D3") || a.at - b.at,
    );
  for (const { thread } of order) {
    const open = rng
      .shuffle(range(LAYOUT.sources))
      .filter((task) => (load.get(task) ?? 0) < MAX_SOURCES_PER_TASK && !(thread.class === "D3" && flagTasks.has(task)));
    if (open.length < thread.early.length) throw new Error(`SessionBenchLongBuild: ${id} has no source task left for ${thread.group}`);
    const tasks = open.slice(0, thread.early.length).sort((a, b) => a - b);
    thread.early.forEach((source, i) => {
      source.task = tasks[i];
      load.set(tasks[i], (load.get(tasks[i]) ?? 0) + 1);
      if (thread.class === "D3") flagTasks.add(tasks[i]);
    });
  }
}

/**
 * Build one session. `family` is a v3 FAMILIES entry; `seed` the benchmark seed; `index` the session's number in its
 * family. Returns the session spec (plain JSON).
 */
export function buildLongSession(family, index, seed) {
  const id = `sbl-${family.short}-${String(index).padStart(2, "0")}`;
  const rng = rngFor(`${seed}:${id}`);
  const env = {
    files: { "README.md": `# ${family.title}\n\nWorkspace for the ${family.teams.join(", ")} teams.\n` },
    tickets: [],
    messages: { "#release": chatter(rng, 400).map(toMessage) },
    config: {},
    rules: [],
  };
  let ticketNo = 100;
  const ticket = (title, body = "", status = "open") => {
    const row = { id: `T-${ticketNo++}`, title, status, assignee: "", labels: [], body };
    env.tickets.push(row);
    return row.id;
  };
  for (let i = 0; i < 6; i++)
    ticket(
      `${rng.pick(family.services)} ${rng.pick(FILLER.nouns)} ${rng.pick(FILLER.topics)}`,
      sentence(rng),
      rng.pick(["open", "closed"]),
    );
  for (const feature of family.features) for (const suffix of FLAG_LOOKALIKES) env.config[`flags.${feature}_${suffix}`] = false;

  const used = { services: new Set(), features: new Set(), words: new Set(), subjects: new Set(), values: new Set() };
  const fresh = (list, kind) => {
    const left = list.filter((item) => !used[kind].has(item));
    if (!left.length) throw new Error(`SessionBenchLongBuild: ${id} ran out of ${kind}`);
    const item = rng.pick(left);
    used[kind].add(item);
    return item;
  };
  /** A value or a subject no other dependency of the session uses. */
  const unique = (kind, make) => {
    for (let tries = 0; tries < 1_000; tries++) {
      const item = make();
      if (used[kind].has(item)) continue;
      used[kind].add(item);
      return item;
    }
    throw new Error(`SessionBenchLongBuild: ${id} ran out of ${kind}`);
  };
  const ctx = {
    rng,
    family,
    env,
    ticket,
    fresh,
    param: rng.pick(family.params),
    values: () => unique("values", () => rng.int(10, 990) * 10),
    subject: () => unique("subjects", () => `${rng.pick(family.services)} ${rng.pick(FILLER.nouns)} clean-up`),
  };

  // --- threads --------------------------------------------------------------------------------------------------------
  const facts = [1, 2, 3].map((k) => factThread(k, ctx));
  const flags = [1, 2, 3].map((k) => flagThread(k, ctx));
  const labels = labelThread(ctx);
  const signatures = rng
    .shuffle(family.teams)
    .slice(0, 2)
    .map((team, k) => signatureThread(k + 1, team, ctx));
  signatures.forEach((thread) => {
    thread.others = signatures.filter((other) => other !== thread).map((other) => other.sig);
  });
  const trains = rng.shuffle(family.teams).map((team, k) => trainThread(k + 1, team, TRAIN_STATEMENTS[k], ctx));
  const threads = [...facts, ...flags, labels, ...signatures, ...trains];

  // --- sources --------------------------------------------------------------------------------------------------------
  placeEarly(rng, threads, id);
  const mid = threads.flatMap((thread) => thread.mid);
  const midTasks = rng.shuffle(range(LAYOUT.midSources)).slice(0, mid.length);
  mid.forEach((source, i) => {
    source.task = midTasks[i];
  });
  const late = threads.flatMap((thread) => thread.late);
  if (late.length !== 1) throw new Error(`SessionBenchLongBuild: ${id} expects one late change, has ${late.length}`);
  late[0].task = rng.int(...LAYOUT.lateChange);
  const lateTrain = trains.find((thread) => thread.late.length);

  // --- dependents: one per task -----------------------------------------------------------------------------------------
  const split = (list) => {
    const [first, ...rest] = rng.shuffle(list);
    return { before: [first], after: rest };
  };
  const single = [split(facts), split(flags)];
  const before = rng.shuffle([...single.flatMap((row) => row.before), labels, ...signatures, ...trains]);
  // The late train's two `after` dependents sit on each side of its late change; every other one is drawn.
  const after = rng.shuffle([
    ...single.flatMap((row) => row.after),
    labels,
    labels,
    ...signatures.flatMap((thread) => [thread, thread, thread]),
    ...trains.filter((thread) => thread !== lateTrain).flatMap((thread) => [thread, thread]),
  ]);
  const placed = [];
  rng
    .shuffle(range(LAYOUT.before))
    .slice(0, before.length)
    .forEach((task, i) => {
      placed.push({ thread: before[i], task });
    });
  const lateTask = late[0].task;
  const fixed = [rng.int(LAYOUT.after[0], lateTask - 1), rng.int(lateTask + LAYOUT.lateChangeGap, LAYOUT.after[1])];
  for (const task of fixed) placed.push({ thread: lateTrain, task });
  rng
    .shuffle(range(LAYOUT.after).filter((task) => task !== lateTask && !fixed.includes(task)))
    .slice(0, after.length)
    .forEach((task, i) => {
      placed.push({ thread: after[i], task });
    });
  placed.sort((a, b) => a.task - b.task);
  const dependents = placed.map(({ thread, task }, i) => ({ task, ...thread.dependent(`dep${String(i + 1).padStart(2, "0")}`, task) }));
  const deps = dependents.map((dependent) => dependent.row);
  for (const [cls, want] of Object.entries(CLASS_LAYOUT))
    for (const bucket of ["before", "after"]) {
      const have = deps.filter((dep) => dep.class === cls && dep.bucket === bucket).length;
      if (have !== want[bucket])
        throw new Error(`SessionBenchLongBuild: ${id} has ${have} ${cls} ${bucket} dependents, expected ${want[bucket]}`);
    }

  // --- tasks ----------------------------------------------------------------------------------------------------------
  let fixRules = 0;
  const offset = rng.int(0, family.jobs.length - 1);
  const tasks = Array.from({ length: LONG_TASKS }, (_, i) => {
    let kind = family.jobs[(offset + i) % family.jobs.length];
    if (kind === "fix-rule" && ++fixRules > MAX_FIX_RULE_JOBS) kind = "count-errors";
    return { n: i + 1, job: kind, parts: [makeJob(kind, { ...ctx, n: i + 1 })] };
  });
  if (ticketNo > 900) throw new Error(`SessionBenchLongBuild: ${id} seeds ${ticketNo - 100} tickets; ids from T-900 belong to the agent`);
  for (const source of threads.flatMap((thread) => [...thread.early, ...thread.mid, ...thread.late]))
    tasks[source.task - 1].parts.push(source);
  for (const dependent of dependents) {
    if (tasks[dependent.task - 1].parts.length > 1)
      throw new Error(`SessionBenchLongBuild: ${id} task ${dependent.task} holds a dependent and another part`);
    tasks[dependent.task - 1].parts.push(dependent);
  }

  const phases = Array.from({ length: LONG_TASKS / PHASE_TASKS }, (_, k) => {
    const own = tasks.slice(k * PHASE_TASKS, (k + 1) * PHASE_TASKS);
    return {
      n: k + 1,
      from: own[0].n,
      to: own.at(-1).n,
      scope: [
        `Session plan, phase ${k + 1} of ${LONG_TASKS / PHASE_TASKS}: ${family.title}`,
        ...own.map((task) => `${task.n}. ${capital(task.parts.map((part) => part.step).join("; then "))}.`),
      ].join("\n"),
    };
  });
  return {
    id,
    family: family.id,
    phases,
    tasks: tasks.map((task) => ({
      n: task.n,
      phase: Math.ceil(task.n / PHASE_TASKS),
      job: task.job,
      prompt: `Task ${task.n}. ${task.parts.map((part) => part.sentence).join(" ")}`,
      checks: task.parts.flatMap((part, p) => (part.checks ?? []).map((check, c) => ({ id: `t${task.n}.${p}.${c}`, ...check }))),
      plan: task.parts.flatMap((part) => part.plan),
      notes: task.parts.flatMap((part) => (part.note ? [part.note] : [])),
    })),
    deps,
    env,
  };
}

/** Every phase scope of a session as one text (what a leak check reads). */
export const scopeText = (session) => session.phases.map((phase) => phase.scope).join("\n");

export { estimateTokens, FAMILIES };
