/**
 * Plan 217 Task 5: the offline long-session coding fixture (`fixtures/memory-model/long-session/`).
 *
 * `session.json` is a replayed coding session (ledgerkit 0.4: 7 plan tasks over 14 user turns and 88 tool calls);
 * `annotations.json` holds the hand-written expected STM events, task states, per-task changes and verification, and
 * the related task pairs. Both are hashed in `index.json`: a changed byte fails {@link loadLongSessionFixture}, so a
 * deliberate edit re-pins the index in the same change.
 *
 * The S1 counter ({@link rederivationCalls}) is shared with the live `long-session` family
 * (`work-outcome/long-session.mjs`): a `grep`, `read` or `bash` call in task B whose target names something task A
 * changed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LONG_SESSION_DIR = join(import.meta.dir, "fixtures/memory-model/long-session");
export const LONG_SESSION_FILES = Object.freeze(["session.json", "annotations.json"]);
/** Tools whose calls can re-derive what an earlier task changed (S1). */
export const REDERIVATION_TOOLS = Object.freeze(["grep", "read_file", "read", "bash"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Hashes of the fixture files as committed; `index.json` pins them. */
export function longSessionHashes(dir = LONG_SESSION_DIR) {
  return Object.fromEntries(LONG_SESSION_FILES.map((file) => [file, sha256(readFileSync(join(dir, file)))]));
}

/** Expand one call's output: an array of lines, or a deterministic `generate` template. */
export function expandOutput(call) {
  if (Array.isArray(call.output)) return call.output.join("\n");
  const spec = call.generate;
  if (!spec) throw new Error(`long-session fixture: call ${call.id} has no output`);
  const lines = [...spec.head];
  for (let i = 1; i <= spec.count; i++)
    lines.push(
      spec.template
        .replaceAll("{i}", String(i))
        .replaceAll("{ms}", String((i * 37) % 97))
        .replaceAll("{file}", spec.files[i % spec.files.length]),
    );
  lines.push(...spec.tail);
  return lines.join("\n");
}

/**
 * Load, verify and expand the fixture. `{plan}` in a user turn becomes the plan text and `{secret}` (in outputs and
 * chunk texts) the seeded fake secret.
 */
export function loadLongSessionFixture(dir = LONG_SESSION_DIR) {
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const hashes = longSessionHashes(dir);
  for (const file of LONG_SESSION_FILES)
    if (index.sha256?.[file] !== hashes[file])
      throw new Error(`long-session fixture: ${file} hashes to ${hashes[file]}, index.json pins ${index.sha256?.[file]}`);
  const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8"));
  const annotations = JSON.parse(readFileSync(join(dir, "annotations.json"), "utf8"));
  const secret = session.seededSecret;
  const fill = (text) => text.replaceAll("{secret}", secret).replaceAll("{plan}", session.plan.join("\n"));
  const turns = session.turns.map((turn) => ({
    ...turn,
    user: fill(turn.user),
    calls: turn.calls.map((call) => ({ ...call, output: fill(expandOutput(call)) })),
  }));
  const calls = new Map(turns.flatMap((turn) => turn.calls.map((call) => [call.id, { ...call, turn: turn.id, task: turn.task }])));
  const events = annotations.events.map((event) => ({
    ...event,
    chunks: (event.chunks ?? []).map((chunk) => ({ ...chunk, text: fill(chunk.text) })),
  }));
  const steps = new Set(
    turns.flatMap((turn) => [`${turn.id}:user`, `${turn.id}:reply`, ...turn.calls.flatMap((c) => [c.id, `${c.id}:call`])]),
  );
  for (const event of events)
    for (const source of [...event.sources, ...event.chunks.map((chunk) => chunk.source)])
      if (!steps.has(source)) throw new Error(`long-session fixture: ${event.id} cites unknown step ${source}`);
  return {
    index,
    hashes,
    secret,
    plan: session.plan.join("\n"),
    turns,
    calls,
    events,
    taskStates: annotations.taskStates,
    tasks: annotations.tasks,
    related: annotations.related,
    expected: annotations.expected,
    /** Message entries the replay appends: per turn a user and a reply message, per call a tool call and a result. */
    messageEntries: turns.reduce((sum, turn) => sum + 2 + turn.calls.length * 2, 0),
  };
}

/** The string a call targets: its path, pattern or command. */
export function callTarget(call) {
  const args = call.args ?? call.arguments ?? {};
  return [args.path, args.pattern, args.command, args.query].filter((value) => typeof value === "string").join(" ");
}

/**
 * S1: calls in task `b` that re-derive what task `a` changed — a `grep`, `read` or `bash` call whose target names one
 * of `a`'s targets. `calls` are `{ id?, name | tool, args }` in task `b`, in order.
 */
export function rederivationCalls(calls, targets) {
  const named = targets.filter(Boolean);
  return calls.filter((call) => {
    const tool = call.name ?? call.tool;
    if (!REDERIVATION_TOOLS.includes(tool)) return false;
    const target = callTarget(call);
    return named.some((value) => target.includes(value));
  });
}
