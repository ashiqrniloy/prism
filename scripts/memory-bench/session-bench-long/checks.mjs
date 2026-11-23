/**
 * Plan 218.5 Task 4: the long bench's state checks. Every check kind is Session-Bench v3's (`../session-bench/checks.mjs`,
 * imported and never edited) except one: the joint revoke check. A check is data, evaluated on the workspace state at
 * the end of the task that owns it, never by a model (G7). Imports nothing from Prism (G2).
 */
import { CHECK_CLASSES, CHECK_KINDS, evaluateCheck as evaluateV3Check, sameScalar } from "../session-bench/checks.mjs";

/** A `D2` rule revoked later, scored jointly: the still-active rule applied and the revoked one absent. */
export const REVOKE_CLASS = "D2R";
/** v3's classes plus the revoke class; `C` stays last. */
export const LONG_CHECK_CLASSES = Object.freeze([...CHECK_CLASSES.filter((cls) => cls !== "C"), REVOKE_CLASS, "C"]);
/** The memory-dependent classes: every class but the control. */
export const DEPENDENCY_CLASSES = Object.freeze(LONG_CHECK_CLASSES.filter((cls) => cls !== "C"));

/**
 * The one new kind. Every ticket the task created carries each label in `includes` and none in `excludes`, and the task
 * created at least one. An agent that remembers neither rule fails on `includes`; one that remembers both rules but not
 * the revoke fails on `excludes`.
 */
const LONG_EVALUATORS = {
  "created-ticket-labels": (check, state, task) => {
    const created = state.created.tickets
      .filter((row) => row.task === task)
      .map((row) => state.tickets.find((ticket) => ticket.id === row.id));
    return (
      created.length > 0 &&
      created.every((ticket) => (check.includes ?? []).every((label) => ticket?.labels.includes(label))) &&
      created.every((ticket) => (check.excludes ?? []).every((label) => !ticket?.labels.includes(label)))
    );
  },
};

export const LONG_CHECK_KINDS = Object.freeze([...CHECK_KINDS, ...Object.keys(LONG_EVALUATORS)]);

/** One check's verdict on the state at the end of `task`. Unknown kinds fail closed (v3 throws). */
export function evaluateCheck(check, state, task) {
  const evaluate = LONG_EVALUATORS[check.kind];
  return evaluate ? Boolean(evaluate(check, state, task)) : evaluateV3Check(check, state, task);
}

/**
 * The rows of one finished task: v3's row plus the dependent's distance bucket (`before`, `after`; absent on `C` checks).
 * The arm is never an input here: the runner attaches it after scoring (G7).
 */
export function taskCheckRows(session, task, state) {
  return task.checks.map((check) => ({
    session: session.id,
    task: task.n,
    check: check.id,
    class: check.class,
    ...(check.dep ? { dep: check.dep } : {}),
    ...(check.bucket ? { bucket: check.bucket } : {}),
    pass: evaluateCheck(check, state, task.n),
  }));
}

export { sameScalar };
