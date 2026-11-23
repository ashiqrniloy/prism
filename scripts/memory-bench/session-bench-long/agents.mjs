/**
 * Plan 218.5 Task 4: the long bench's scripted agents. The plan format, the two branches of a dependent step and the
 * re-derivation count are Session-Bench v3's (`../session-bench/agents.mjs`, imported and never edited). This file runs
 * them against the long bench's own checks and keeps each task's largest tool output for the size rules.
 *
 * - `oracle`: knows every dependency. It must pass every check.
 * - `amnesic`: knows none. It must fail every `D2`, `D4` and `D2R` check and pass every `C` check.
 *
 * Imports nothing from Prism (G2).
 */
import { doneText, planCalls, rederivationCounts, taskDependencies } from "../session-bench/agents.mjs";
import { createWorkspace } from "../session-bench/env/workspace.mjs";
import { estimateTokens } from "../session-bench/templates/build.mjs";
import { taskCheckRows } from "./checks.mjs";

/**
 * What an agent must still hold to know a dependency: its evidence string, and for a revoke (`D2R`) the standing rule
 * as well. An offline mock knows the dependency only when every string is visible in its request.
 */
export const dependencyEvidence = (dep) => [dep.evidence, ...(dep.standing ? [dep.standing] : [])];

/**
 * Run a scripted agent straight against the workspace (no model, no Prism). Returns check rows, per-task re-derivation
 * counts and the token trace: per task, the prompt, every tool output and the reply, and the largest single output.
 */
export function runScripted(session, mode) {
  if (mode !== "oracle" && mode !== "amnesic") throw new Error(`SessionBenchLongAgent: unknown scripted agent ${mode}`);
  const knows = () => mode === "oracle";
  const ws = createWorkspace(session.env);
  const rows = [];
  const trace = [];
  for (const task of session.tasks) {
    ws.task = task.n;
    let tokens = estimateTokens(task.prompt);
    let largest = 0;
    for (const [name, args] of planCalls(task, knows)) {
      const output = estimateTokens(ws.call(name, args));
      tokens += output;
      largest = Math.max(largest, output);
    }
    tokens += estimateTokens(doneText(task, knows));
    trace.push({ task: task.n, tokens, largest });
    rows.push(...taskCheckRows(session, task, ws.state));
  }
  const counts = rederivationCounts(ws.calls);
  return {
    rows,
    tasks: session.tasks.map((task) => ({ session: session.id, task: task.n, ...(counts[task.n] ?? { rederivations: 0, toolCalls: 0 }) })),
    trace,
  };
}

export { doneText, planCalls, rederivationCounts, taskDependencies };
