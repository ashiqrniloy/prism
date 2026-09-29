/**
 * Plan 137 Task 9: offline long-run e2e for the Prism Code agent loop.
 *
 * Drives the real `assembleAppAgent` loop (planning tool, skills plane, todo continuation stop
 * hook, approval policy) with a scripted in-memory provider for 300 tool rounds, a transcript
 * that grows past the context window, and a mid-run compaction cycle. Deterministic and
 * hermetic: no network, no provider credential, no packed install.
 *
 * Asserts:
 *   - 300 `read` tool rounds complete with no run-limit error and a clean final stop;
 *   - at least one mid-run compaction (`compaction_finished`) and no `compaction_failed`;
 *   - the plan written once at the start survives the cut (pinned entries) and a premature
 *     text-only stop is still continued by the todo stop hook (steer seen by the model);
 *   - `load_skill` loads one skill from each configured layer (config, project, prism home);
 *   - a `shell` call denied by the `ask` approval policy reaches the model as a tool result.
 *
 * Also records per-turn assembly time (start-to-start provider intervals) for the task note.
 */

import { afterAll as after, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { assembleAppAgent, createPrismCodeApprovalPolicy } from "@arnilo/prism-code";

const ROUNDS = 300;
/** Several tool rounds per model turn keep the e2e short while the transcript still grows. */
const READS_PER_TURN = 10;
/** One probe that the `ask` policy refuses (no interactive approver in this scenario). */
const DENIED_SHELL_AFTER_ROUNDS = 150;
/** Marker of the pending plan as the `todo_write` tool renders it. */
const OPEN_PLAN_MARKER = "- [ ] s1: long-run step 1";

const SKILLS = [
  { name: "cfg-layer-alpha", marker: "CONFIG_LAYER_MARKER", layer: "config" },
  { name: "proj-layer-beta", marker: "PROJECT_LAYER_MARKER", layer: "project" },
  { name: "prism-layer-gamma", marker: "PRISM_HOME_LAYER_MARKER", layer: "prism" },
];

const TODO_ITEMS = Array.from({ length: 10 }, (_, index) => ({
  id: `s${index + 1}`,
  content: `long-run step ${index + 1}`,
  status: "pending",
}));

function skillSource(skill) {
  return `---\nname: ${skill.name}\ndescription: ${skill.name} long-run fixture\n---\n\n# ${skill.name}\n\n${skill.marker}\n`;
}

function flatten(value) {
  return JSON.stringify(value);
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Scripted provider: decides the next turn from the request it receives plus its own counters,
 * so compaction (which rewrites history) cannot desynchronize the script.
 */
function createLongRunProvider({ readPath }) {
  const stats = {
    mainTurns: 0,
    summaryRequests: 0,
    readRounds: 0,
    continuations: 0,
    denials: 0,
    loadedSkills: new Map(),
    turnDeltas: [],
    messageCounts: [],
    completed: false,
    prematureStopSent: false,
    shellSent: false,
    todosWritten: false,
    todosClosed: false,
    /** A compaction already ran before this turn's request (the transcript carries a summary). */
    compacted: false,
    /** The plan written before the cut is still in the request (pinned), next to a summary. */
    planSurvivedCut: false,
  };
  let lastTurnStart;

  const provider = {
    id: "mock",
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason;
      // The compaction summarizer request carries no tools; answer it and move on.
      if ((request.tools ?? []).length === 0) {
        stats.summaryRequests += 1;
        yield providerTextDelta("Summary of the previous work: steps 1..n read notes.txt.");
        yield providerDone();
        return;
      }

      const started = performance.now();
      if (lastTurnStart !== undefined) stats.turnDeltas.push(started - lastTurnStart);
      lastTurnStart = started;
      stats.mainTurns += 1;
      const turn = stats.mainTurns;
      stats.messageCounts.push(request.messages.length);

      const transcript = flatten(request.messages);
      // The assembled JSON has no whitespace between adjacent tool results, so each capture must
      // stop at the JSON string boundary; a bare `\S+` would swallow the following result.
      for (const match of transcript.matchAll(/Loaded skill ([^ "\\]+) for this session\. Skill directory: ([^"\\]+)/g)) {
        stats.loadedSkills.set(match[1], match[2]);
      }
      if (/Open todo items \(\d+\)/.test(transcript)) stats.continuations += 1;
      if (/approval required for shell/.test(transcript)) stats.denials += 1;
      // A summary system message only exists after a compaction cut.
      if (/Summary:\\n/.test(transcript)) stats.compacted = true;
      if (stats.compacted && transcript.includes(OPEN_PLAN_MARKER)) stats.planSurvivedCut = true;
      const skillsLoaded = SKILLS.every((skill) => stats.loadedSkills.has(skill.name));

      /** @type {{ text?: string, calls?: Array<{ name: string, args: Record<string, unknown> }> }} */
      let step;
      if (!skillsLoaded) {
        step = { calls: SKILLS.map((skill) => ({ name: "load_skill", args: { name: skill.name } })) };
      } else if (stats.readRounds >= ROUNDS && !stats.todosClosed) {
        stats.todosClosed = true;
        step = {
          calls: [{ name: "todo_write", args: { todos: TODO_ITEMS.map((item) => ({ ...item, status: "completed" })) } }],
        };
      } else if (!stats.todosWritten) {
        stats.todosWritten = true;
        step = { calls: [{ name: "todo_write", args: { todos: TODO_ITEMS } }] };
      } else if (!stats.prematureStopSent && stats.compacted) {
        // Text-only stop after a cut that removed the plan from the transcript: only the pinned
        // entries keep it readable, and only then can the hook continue on the open items.
        stats.prematureStopSent = true;
        step = { text: "Premature stop: the remaining steps look small enough to call this done." };
      } else if (!stats.shellSent && stats.readRounds >= DENIED_SHELL_AFTER_ROUNDS) {
        stats.shellSent = true;
        step = { calls: [{ name: "shell", args: { command: "echo long-run-e2e" } }] };
      } else if (stats.readRounds < ROUNDS) {
        const count = Math.min(READS_PER_TURN, ROUNDS - stats.readRounds);
        stats.readRounds += count;
        step = { calls: Array.from({ length: count }, () => ({ name: "read", args: { path: readPath } })) };
      } else {
        stats.completed = true;
        step = { text: "All done." };
      }

      if (step.calls) {
        for (const [index, call] of step.calls.entries()) {
          yield providerToolCall(toolCallContent(`call_${turn}_${index}`, call.name, call.args));
        }
      } else {
        yield providerTextDelta(step.text);
      }
      yield providerDone();
    },
  };

  return { provider, stats };
}

let tempRoot;
const temps = [];
async function makeTemp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `prism-long-run-${prefix}-`));
  temps.push(dir);
  return dir;
}

after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

describe("Prism Code offline long run (300 tool rounds)", () => {
  it("compacts mid-run, continues past a premature stop, loads every skill layer, refuses shell in ask mode, and stops clean", async () => {
    tempRoot = await makeTemp("root");
    const workspace = join(tempRoot, "repo");
    const home = join(tempRoot, "home");
    const configSkills = join(tempRoot, "config-skills");
    await mkdir(workspace, { recursive: true });
    await mkdir(join(home, "agent", "skills"), { recursive: true });
    await mkdir(join(configSkills), { recursive: true });

    // One skill per layer root that `resolveSkillRoots` discovers.
    const layerDirs = new Map([
      ["config", configSkills],
      ["project", join(workspace, ".agents", "agent", "skills")],
      ["prism", join(home, "agent", "skills")],
    ]);
    for (const skill of SKILLS) {
      const dir = layerDirs.get(skill.layer);
      const target = join(dir, skill.name);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), skillSource(skill));
    }

    // ~1.7KB per `read`: 300 rounds stack ~500KB of raw transcript (far beyond the 48k window)
    // so compaction has something real to summarize, while keeping per-turn assembly cheap.
    const notes = Array.from({ length: 30 }, (_, index) => `line ${index + 1}: long-run fixture content for the transcript`).join("\n");
    await writeFile(join(workspace, "notes.txt"), `${notes}\n`);

    const previousHome = process.env.PRISM_HOME;
    process.env.PRISM_HOME = home;
    try {
      const { provider, stats } = createLongRunProvider({ readPath: "notes.txt" });
      const approval = createPrismCodeApprovalPolicy({ roots: [workspace], cwd: workspace, mode: "ask" });
      const config = {
        cwd: workspace,
        model: { provider: "mock", model: "long-run-test", limits: { contextWindow: 48_000, maxOutputTokens: 2_000 } },
        skills: { dirs: [configSkills] },
        // LLM coding compaction above the strategy's keep budget (derived from the window), so
        // every compaction has entries to summarize and the transcript stays bounded mid-run.
        compaction: { strategy: "coding", trigger: "threshold_tokens", tokens: 30_000 },
      };

      const definition = await assembleAppAgent(config, provider, approval.policy);
      const session = definition.createSession();
      const events = [];
      const eventsDone = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();

      const result = await session.run("Work through the 300-step plan, keeping the todo list current.");
      await eventsDone;

      const compactions = events.filter((event) => event.type === "compaction_finished");
      const failures = events.filter((event) => event.type === "compaction_failed");

      // Clean final stop with no run limit: 300 rounds is more than any default cap.
      assert.equal(result.status, "succeeded", `status ${result.status}: ${result.stopDetail ?? ""}`);
      assert.equal(result.text, "All done.");
      assert.equal(result.limit, undefined, `unexpected run limit: ${JSON.stringify(result.limit)}`);
      assert.notEqual(result.stopReason, "hook_limit", "the todo hook must not hit the continuation cap");
      assert.equal(stats.completed, true);
      assert.equal(stats.readRounds, ROUNDS);

      // Mid-run compaction: the transcript passed the window's compact threshold and was compacted.
      assert.ok(compactions.length >= 1, `expected compaction_finished, saw ${events.map((e) => e.type).join(", ")}`);
      assert.equal(failures.length, 0, `compaction_failed: ${JSON.stringify(failures)}`);
      assert.ok(stats.summaryRequests >= 1, "the summarizer leg must hit the provider");
      // A compaction must actually shrink the assembled transcript, not just emit an event.
      assert.ok(
        Math.min(...stats.messageCounts) < Math.max(...stats.messageCounts),
        `compaction must shrink the transcript, counts stayed at ${stats.messageCounts[0]}`,
      );

      // Todo continuation after the premature text-only stop, with the plan pinned through the cut.
      assert.equal(stats.prematureStopSent, true);
      assert.equal(stats.planSurvivedCut, true, "the plan written before the cut must stay in the transcript");
      assert.ok(stats.continuations >= 1, "the model must see the open-todo continuation steer");

      // Skills loaded from every layer through load_skill.
      for (const skill of SKILLS) {
        const dir = stats.loadedSkills.get(skill.name);
        assert.ok(dir, `load_skill never loaded ${skill.name}`);
        assert.ok(dir.startsWith(layerDirs.get(skill.layer)), `${skill.name} loaded from ${dir}, expected the ${skill.layer} layer`);
      }

      // The `ask` policy refuse the shell probe with a model-visible message.
      assert.equal(stats.shellSent, true);
      assert.ok(stats.denials >= 1, "the denied shell result must reach the model");

      // Per-turn assembly time: record and assert no super-linear growth.
      const early = mean(stats.turnDeltas.slice(0, 10));
      const late = mean(stats.turnDeltas.slice(-10));
      const worst = Math.max(...stats.turnDeltas);
      console.log(
        `[e2e-long-run] turns=${stats.mainTurns} compactions=${compactions.length} summaries=${stats.summaryRequests} ` +
          `assembly mean first10=${early.toFixed(2)}ms last10=${late.toFixed(2)}ms max=${worst.toFixed(2)}ms`,
      );
      assert.ok(Number.isFinite(late), "per-turn assembly timing must be recorded");
      assert.ok(late < early * 20 + 50, `per-turn assembly grew super-linearly: first10=${early}ms last10=${late}ms`);
    } finally {
      if (previousHome === undefined) delete process.env.PRISM_HOME;
      else process.env.PRISM_HOME = previousHome;
    }
  }, 120_000);
});
