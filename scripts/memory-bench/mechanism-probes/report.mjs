/**
 * Plan 210 Task 2: assemble `mechanisms.json` from the probe rows and the replay rates. Every ledger
 * candidate must have exactly one probe row; a missing or duplicate row is a problem, not a gap.
 */
import { FIXES } from "./fixes.mjs";

export const MECHANISMS_KIND = "210-task2-mechanism-verification";

/**
 * `candidates` are the ledger's current candidates and `known` every ledger row. A row this task moved out of
 * the candidate list (a named inspectability test added) keeps its probe; a probe for an unknown row is a problem.
 */
export function coverageProblems(rows, candidates, known = candidates) {
  const problems = [];
  const seen = new Map();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  for (const id of candidates) if (!seen.has(id)) problems.push(`candidate without a probe: ${id}`);
  for (const [id, count] of seen) if (count > 1) problems.push(`probe reported twice: ${id}`);
  for (const id of seen.keys()) if (!known.includes(id)) problems.push(`probe for a row the ledger does not have: ${id}`);
  return problems;
}

export async function buildReport({ rows, errors = [], candidates, known, replay }) {
  const problems = [...coverageProblems(rows, candidates, known), ...errors.map((error) => `probe error: ${error.id}: ${error.error}`)];
  const rates = replay?.rates ?? {};
  const probes = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ ms: _ms, ...row }) => ({
      ...row,
      ...(rates[row.id] === undefined ? {} : { replay: rates[row.id] }),
      ...(FIXES.some((fix) => fix.features.includes(row.id)) ? { fixes: FIXES.filter((fix) => fix.features.includes(row.id)).map((fix) => fix.id) } : {}),
    }));
  const verdicts = {};
  for (const row of probes) verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
  return {
    schemaVersion: 1,
    kind: MECHANISMS_KIND,
    plan: "210",
    task: "2",
    note: "Offline, deterministic, mock-provider probes of every Task 1 candidate. Counts, hashes and verdicts only; no note or history text.",
    verdictVocabulary: ["works", "never-fires", "no-effect", "wrong-effect"],
    rule: "fires: the mechanism ran (count); reaches: what the agent receives differs with it on vs off (or vs its trigger-absent control); correct: the documented effect. A replay rate under 1% of eligible units is rare.",
    summary: { probes: probes.length, candidatesProbed: candidates.filter((id) => probes.some((row) => row.id === id)).length, verdicts, problems: problems.length, fixes: FIXES.filter((fix) => fix.kind === "fixed").length, reported: FIXES.filter((fix) => fix.kind !== "fixed").length },
    problems,
    fixes: FIXES,
    replay: replay
      ? {
          rareBelow: replay.rareBelow,
          histories: replay.replays,
          skipped: replay.skipped,
          rare: Object.entries(replay.rates)
            .filter(([, rate]) => rate.rare)
            .map(([id]) => id)
            .sort(),
        }
      : { skipped: [{ suite: "all", reason: "replays not run (--no-replay)" }] },
    probes,
  };
}
