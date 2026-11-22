/**
 * Plan 218.3 Task 9: Session-Bench's deterministic state checks. A check is data (`{ id, class, kind, ... }`); it is
 * evaluated on the workspace state at the end of the task that owns it, never by a model (G7). Imports nothing from
 * Prism (G2).
 */

/** Dependency classes (README "Dependency classes"). `C` checks depend on no earlier task. */
export const CHECK_CLASSES = Object.freeze(["D1", "D2", "D3", "D4", "C"]);

const createdIn = (state, task, kind) => state.created[kind].filter((row) => row.task === task);
const firstCreatedKey = (state, task, prefix) =>
  state.changes.find((row) => row.task === task && row.kind === "config" && row.created && row.key.startsWith(prefix))?.key;

/**
 * A stored value equals the expected one when their string forms match (v2, plan 218.3 Task 11): `set_config` and the
 * ticket tools accept strings, numbers and booleans, and `get_config` shows no type, so `"719"` is the agent's 719 and
 * `"false"` its false. v1 compared with `===` and failed every string-typed right answer on the first live model.
 */
export const sameScalar = (actual, expected) =>
  actual === expected || (["string", "number", "boolean"].includes(typeof actual) && String(actual).trim() === String(expected));

const EVALUATORS = {
  "config-equals": (check, state) => sameScalar(state.config[check.key], check.value),
  "ticket-field": (check, state) => sameScalar(state.tickets.find((row) => row.id === check.id)?.[check.field], check.value),
  "tickets-status": (check, state) =>
    check.closed.every((id) => state.tickets.find((row) => row.id === id)?.status === "closed") &&
    check.open.every((id) => state.tickets.find((row) => row.id === id)?.status === "open"),
  "created-ticket-labelled": (check, state, task) => {
    const ids = createdIn(state, task, "tickets").map((row) => row.id);
    return ids.length > 0 && ids.every((id) => state.tickets.find((row) => row.id === id)?.labels.includes(check.label));
  },
  "message-posted": (check, state, task) => {
    const posted = createdIn(state, task, "messages").filter((row) => row.channel === check.channel);
    return (
      posted.length > 0 &&
      posted.every((row) => (check.includes ?? []).every((text) => row.text.includes(text))) &&
      posted.every((row) => (check.excludes ?? []).every((text) => !row.text.includes(text)))
    );
  },
  "flag-created": (check, state, task) => {
    const key = firstCreatedKey(state, task, check.prefix);
    return key !== undefined && sameScalar(state.config[key], false);
  },
  // v3: `othersOff` (the feature's look-alikes) must stay off, so turning on every candidate is not a pass.
  "flag-on": (check, state) => {
    const key = firstCreatedKey(state, check.sourceTask, check.prefix);
    return (
      key !== undefined &&
      sameScalar(state.config[key], true) &&
      (check.othersOff ?? []).every((other) => other === key || !sameScalar(state.config[other], true))
    );
  },
};

export const CHECK_KINDS = Object.freeze(Object.keys(EVALUATORS));

/** One check's verdict on the state at the end of `task`. Unknown kinds fail closed. */
export function evaluateCheck(check, state, task) {
  const evaluate = EVALUATORS[check.kind];
  if (!evaluate) throw new Error(`SessionBenchCheck: unknown check kind ${check.kind}`);
  return Boolean(evaluate(check, state, task));
}

/**
 * The rows of one finished task: `{ session, task, check, class, dep, pass }`. The arm is never an input here: the
 * runner attaches it after scoring (G7).
 */
export function taskCheckRows(session, task, state) {
  return task.checks.map((check) => ({
    session: session.id,
    task: task.n,
    check: check.id,
    class: check.class,
    ...(check.dep ? { dep: check.dep } : {}),
    pass: evaluateCheck(check, state, task.n),
  }));
}
