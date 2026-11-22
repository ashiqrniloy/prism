/**
 * Plan 218.3 Task 9: Session-Bench's scripted agents. Each task carries a plan of tool calls; a dependent step has a
 * `known` branch (the agent still has the dependency) and an `unknown` branch (it re-derives from the workspace when it
 * can, else acts without it). The three scripted agents differ only in what they know:
 *
 * - `oracle`: knows every dependency (the ground truth). G3: it must pass every check.
 * - `amnesic`: each task in a fresh context with the scope only; knows none. G4: it must fail every `D2` and `D4`
 *   check and pass every `C` check.
 * - the offline mock model in `run.mjs` knows a dependency when its evidence string is visible in the request it is
 *   sent (transcript, compaction summary, memory block), so the arms' context handling decides what it knows.
 *
 * Imports nothing from Prism (G2).
 */
import { taskCheckRows } from "./checks.mjs";
import { createWorkspace, READ_TOOLS } from "./env/workspace.mjs";
import { estimateTokens } from "./templates/build.mjs";

/** The tool calls of one task, given which dependencies the agent knows. */
export function planCalls(task, knows) {
  return task.plan.flatMap((step) => (step.dep === undefined ? step.calls : knows(step.dep) ? step.known : step.unknown));
}

/** The task's closing reply: what was done and what was learned, as a working agent would report it. */
export function doneText(task, knows) {
  const notes = task.notes.map((note) => (typeof note === "string" ? note : knows(note.dep) ? note.known : note.unknown));
  return `Task ${task.n} done: ${notes.join("; ")}.`;
}

/** Dependencies whose sources lie in an earlier task: the only ones a task can know or not know. */
export const taskDependencies = (session, task) => session.deps.filter((dep) => dep.dependent === task.n);

/**
 * Re-derivation calls of one task: a read of an object an earlier task already read (a file, a ticket, a channel, a
 * config key or listing, a rule report, a search), counted per task from the workspace's call log.
 */
export function rederivationCounts(calls) {
  const seen = new Map();
  const counts = {};
  for (const call of calls) {
    counts[call.task] ??= { rederivations: 0, toolCalls: 0 };
    counts[call.task].toolCalls++;
    if (!call.read || !call.object) continue;
    const first = seen.get(call.object);
    if (first === undefined) seen.set(call.object, call.task);
    else if (first < call.task) counts[call.task].rederivations++;
  }
  return counts;
}

/**
 * Run a scripted agent straight against the workspace (no model, no Prism). Returns check rows, per-task re-derivation
 * counts and the token trace (prompt, tool outputs and reply per task) the generator's size guards read.
 */
export function runScripted(session, mode) {
  if (mode !== "oracle" && mode !== "amnesic") throw new Error(`SessionBenchAgent: unknown scripted agent ${mode}`);
  const knows = () => mode === "oracle";
  const ws = createWorkspace(session.env);
  const rows = [];
  const trace = [];
  for (const task of session.tasks) {
    ws.task = task.n;
    let tokens = estimateTokens(task.prompt);
    for (const [name, args] of planCalls(task, knows)) tokens += estimateTokens(ws.call(name, args));
    tokens += estimateTokens(doneText(task, knows));
    trace.push({ task: task.n, tokens });
    rows.push(...taskCheckRows(session, task, ws.state));
  }
  const counts = rederivationCounts(ws.calls);
  return {
    rows,
    tasks: session.tasks.map((task) => ({ session: session.id, task: task.n, ...(counts[task.n] ?? { rederivations: 0, toolCalls: 0 }) })),
    trace,
  };
}

export { READ_TOOLS };
