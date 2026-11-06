#!/usr/bin/env bun
/**
 * Plan 209 Task 5: the work-outcome suite runner.
 *
 *   timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline [--partition dev] [--output report.json]
 *
 * Every session is one `runScenario` (plan 200) over a fresh `createAgent`, driven by the evals user simulator and
 * graded by `createStateMatchScorer` plus the scripted checks in `metrics.mjs`. A persona's sessions share one
 * persistent SQLite fabric store per arm, so memory is the only channel between sessions. The offline mode replaces
 * the answer model and the simulator model with request-driven mocks (no hidden labels enter either) and the claim
 * panel with plan 208's scripted judges; it proves every metric computes. Live runs are plan 209 Task 6 (gate W-1)
 * and plan 210 Task 9; they pass `providers`, `model`, `simulatorModel` and `judges` to {@link runWorkOutcome}.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedHostUi } from "@arnilo/prism/testing";
import { createStateMatchScorer, createUserSimulator, runScenario } from "@arnilo/prism-evals";
import { createSqliteMemoryStores } from "@arnilo/prism-memory-core/sqlite";
import fabric, { parseMemoryNoteMetadata } from "@arnilo/prism-memory-fabric";
import { memoryWiki } from "@arnilo/prism-memory-wiki";
import { tokens } from "../injection-log.mjs";
import { curatorStats, isCuratorRequest } from "../ontology-arm.mjs";
import { createClaimPanel, judgeClaims, scriptedJudges, summarizeGroup } from "../ontology-audit.mjs";
import { mockCuratorEdits } from "../replay.mjs";
import {
  assertWorkReportHasNoText,
  evaluateRow,
  gradeSession,
  partitionPersonas,
  summarizeRows,
  WORK_OUTCOME_ARMS,
  WORK_OUTCOME_CRITERIA,
  WORK_OUTCOME_METRIC_VERSION,
  workOutcomeManifestPin,
} from "./metrics.mjs";
import {
  createWorkPersona,
  familyVocabulary,
  personaIds,
  simulatorGoal,
  WORK_OUTCOME_FAMILIES,
  WORK_OUTCOME_POISON,
  WORK_OUTCOME_STOP,
} from "./personas.mjs";

export const WORK_OUTCOME_REPORT_KIND = "work-outcome-report-v1";
const SESSION_MAX_TURNS = 8;
const SIMULATOR_TIMEOUT_MS = 300_000;
/** Tries per session; only transport faults are retried (never a scored outcome such as the agent's own run limit). */
const SESSION_ATTEMPTS = 3;
/** Session failures that are the agent's own outcome and are scored as they are. */
export const SCORED_SESSION_FAILURES = new Set(["ERR_PRISM_RUN_LIMIT"]);
const sessionFailureCode = (result) => result.error?.code ?? result.finalResult?.error?.code ?? result.finalResult?.status ?? "unknown";
const QUESTION_RULE =
  "Before writing, if a field value is not known from this conversation or from memory, ask the user on one line starting `QUESTION:` that names each missing field in backticks, and do not write yet.";

const hex = (value) => createHash("sha256").update(value).digest("hex");
const projectId = (project) => `${project}--${hex(project).slice(0, 8)}`;
const valuePattern = (key) => new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} = \`([^\`]+)\``, "g");
const lastValue = (text, key) => [...text.matchAll(valuePattern(key))].at(-1)?.[1];
const plainText = (content) =>
  Array.isArray(content) ? content.map((block) => (block.type === "text" ? block.text : "")).join("") : String(content ?? "");
const isContextMessage = (message) => Array.isArray(message.metadata?.contextBlocks);

/** Arm configs exactly as work-outcome-criteria.json states them; `wiki` adds the ontology tier. */
export function armConfig(arm, { offline = false } = {}) {
  const declared = WORK_OUTCOME_CRITERIA.arms[arm];
  if (!declared || !WORK_OUTCOME_ARMS.includes(arm)) throw new Error(`WorkOutcomeArguments: unknown arm ${arm}`);
  return {
    fabric: declared.fabric ? structuredClone(declared.fabric) : null,
    wiki: arm === "P+W+O" ? { consolidate: offline ? { minNotes: 2 } : {} } : null,
  };
}

/**
 * The offline answer model: request-driven, so no persona label, schedule or answer enters it. It reads the
 * request (tools, transcript, memory context and tool results) and acts like a careful agent with one bad prior:
 * the action tool's usual default value.
 */
export function workOutcomeAgentMock(state) {
  return {
    id: "mock",
    async *generate(request) {
      const names = request.tools?.map((tool) => tool.name) ?? [];
      let call;
      let text = "Done.";
      if (isCuratorRequest(request)) {
        if (!request.messages.some((message) => message.role === "tool")) call = ["edit_concept", { edits: mockCuratorEdits(request) }];
      } else if (names.includes("write_file")) ({ call, text } = mockWorkerStep(request, names));
      if (call) yield providerToolCall(toolCallContent(`wo-${++state.calls}`, ...call));
      else yield providerTextDelta(text);
      const inputTokens = tokens(JSON.stringify(request));
      state.inputTokens += inputTokens;
      yield providerDone({ inputTokens, outputTokens: 4, totalTokens: inputTokens + 4, cacheReadTokens: 0 });
    },
  };
}

function mockWorkerStep(request, names) {
  const messages = request.messages;
  const userIndexes = messages.flatMap((message, index) => (message.role === "user" && !isContextMessage(message) ? [index] : []));
  const taskIndex = userIndexes.findLast((index) => /with fields: /.test(plainText(messages[index].content)));
  const latest = userIndexes.at(-1);
  const task = plainText(messages[taskIndex]?.content);
  const fields = /with fields: ([^.]+)\./.exec(task)?.[1].split(", ") ?? [];
  const visible = `${JSON.stringify(request.context ?? [])}\n${JSON.stringify(messages)}`;
  const callsAfter = (start) =>
    messages
      .slice(start + 1)
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.content ?? [])
      .filter((block) => block.type === "tool_call");
  const sinceTask = callsAfter(taskIndex);
  const thisTurn = callsAfter(latest);
  const did = (calls, name, test = () => true) => calls.some((block) => block.name === name && test(block.arguments ?? {}));
  const actionTool = request.tools.find((tool) =>
    Object.values(tool.parameters?.properties ?? {}).some((property) => /usual default: `/.test(property.description ?? "")),
  );
  const actionArg = actionTool && Object.keys(actionTool.parameters.properties)[0];
  const actionLabel = actionTool && /the ([a-z ]+) \(usual default/.exec(actionTool.parameters.properties[actionArg].description)?.[1];
  const actionDefault = actionTool && /usual default: `([^`]+)`/.exec(actionTool.parameters.properties[actionArg].description)?.[1];
  const actionRequested = /Then (?:run the tests|send the update)\./.test(task);
  // What the user said in this session wins over memory; memory and the rest of the request fill the gaps.
  const said = messages
    .slice(taskIndex)
    .filter((message) => message.role === "user" && !isContextMessage(message))
    .map((message) => plainText(message.content))
    .join("\n");
  const known = (key) => lastValue(said, key) ?? lastValue(visible, key);
  const values = Object.fromEntries(fields.map((key) => [key, known(key)]));
  const unknown = fields.filter((key) => values[key] === undefined);
  const actionValue = actionLabel ? (known(actionLabel) ?? actionDefault) : undefined;
  const asked = messages
    .slice(taskIndex + 1)
    .some((message) => message.role === "assistant" && plainText(message.content).includes("QUESTION:"));

  // A nudge in the tail: record the lesson it asks for, citing the exchange it names.
  const tail = messages.at(-1);
  const nudge = tail && isContextMessage(tail) ? /evidence: \["([a-f0-9]{12})"\]/.exec(plainText(tail.content))?.[1] : undefined;
  if (nudge && names.includes("memory.insert") && !did(thisTurn, "memory.insert")) {
    const key = actionLabel && known(actionLabel) ? actionLabel : fields.find((field) => values[field] !== undefined);
    if (key) {
      const value = key === actionLabel ? actionValue : values[key];
      return {
        call: ["memory.insert", { kind: "procedure", tags: ["lesson"], text: `Lesson: the ${key} = \`${value}\`.`, evidence: [nudge] }],
      };
    }
  }
  // Orientation: without a known folder or sign-off convention, read the project first.
  if (fields[1] && values[fields[1]] === undefined) {
    for (const path of ["src/index.ts", "README.md"])
      if (!did(sinceTask, "read_file", (args) => args.path === path)) return { call: ["read_file", { path }] };
  }
  if (
    names.includes("memory.recall") &&
    (unknown.length || (actionRequested && actionLabel && !known(actionLabel))) &&
    !did(sinceTask, "memory.recall")
  )
    return { call: ["memory.recall", { query: [...unknown, ...(actionRequested && actionLabel ? [actionLabel] : [])].join(" ") }] };
  if (unknown.length && !asked) return { text: `QUESTION: what are ${unknown.map((key) => `\`${key}\``).join(", ")}?` };
  if (!did(sinceTask, "write_file")) {
    const data = Object.fromEntries(fields.map((key) => [key, values[key] ?? "unknown"]));
    const folder = /^[a-z0-9-]+$/.test(data[fields[1]] ?? "") ? data[fields[1]] : "unknown";
    return { call: ["write_file", { path: `src/${folder}/record.ts`, text: `export default ${JSON.stringify(data)};\n` }] };
  }
  const latestText = plainText(messages[latest]?.content);
  if (
    actionRequested &&
    actionTool &&
    !did(thisTurn, actionTool.name) &&
    (!did(sinceTask, actionTool.name) || (actionLabel && latestText.includes(actionLabel)))
  )
    return { call: [actionTool.name, { [actionArg]: actionValue }] };
  // Cite ids the recall tool showed, so use-based verification is measured (as the lifecycle mock does).
  const shown = [
    ...new Set(
      messages
        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        .flatMap((block) =>
          block.type === "tool_result" && Array.isArray(block.result?.hits) ? block.result.hits.map((hit) => hit.id) : [],
        )
        .filter((id) => typeof id === "string"),
    ),
  ];
  const ran = actionTool ? [...callsAfter(taskIndex)].reverse().find((block) => block.name === actionTool.name) : undefined;
  const cites = shown.length ? ` ${shown.map((id) => `[${id}]`).join(" ")}` : "";
  return { text: ran ? `Done. Ran \`${ran.arguments[actionArg]}\`.${cites}` : `Done.${cites}` };
}

/** Offline stand-in for the simulator model: follows the JSON data in its goal and nothing else. */
export function scriptedUserMock() {
  return {
    id: "mock-user",
    async *generate(request) {
      const prompt = plainText(request.messages.findLast((message) => message.role === "user")?.content);
      const sim = JSON.parse(prompt.slice(prompt.indexOf("{")));
      const data = JSON.parse(sim.goal.slice(sim.goal.indexOf("Data: ") + 6));
      const turns = sim.turns ?? [];
      const last = turns.at(-1);
      let reply = sim.stop;
      if (!last) reply = data.opening;
      else if (last.assistant.includes("QUESTION:")) {
        const keys = [...last.assistant.matchAll(/`([a-z ]+)`/g)].map((match) => match[1]);
        reply = keys
          .map((key) =>
            data.answers[key] !== undefined ? `${key} = \`${data.answers[key]}\`.` : `I do not know \`${key}\`; use your default.`,
          )
          .join(" ");
      } else if (data.wrong && last.assistant.includes(data.wrong) && turns.filter((turn) => turn.user === data.correction).length < 2)
        reply = data.correction;
      else if (last.user === data.correction) reply = data.thanks;
      yield providerTextDelta(reply || sim.stop);
      yield providerDone({ inputTokens: tokens(prompt), outputTokens: 8, totalTokens: tokens(prompt) + 8, cacheReadTokens: 0 });
    },
  };
}

/** A test command: the persona's wrong default, one of its right choices, or a command naming a test runner. */
export function isTestCommand(value, v) {
  return value === v.action.wrong || (v.action.choices ?? []).includes(value) || /\b(test|tests|check|vitest|jest|spec)\b/.test(value);
}

/** Fixture tools for one session. They write only into `env` and the project root; values never leave the harness. */
function sessionTools({ root, env, family }) {
  const v = familyVocabulary(family);
  const read = {
    name: "read_file",
    description: "Read a project file.",
    parameters: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] },
    async execute(args, context) {
      if (!["src/index.ts", "README.md"].includes(args.path)) throw new Error("WorkOutcomeFixturePath");
      const text = await readFile(join(root, args.path), "utf8");
      return { toolCallId: context.toolCallId, name: "read_file", value: { path: args.path, text }, content: [{ type: "text", text }] };
    },
  };
  const write = {
    name: "write_file",
    description: `Write the requested record as \`export default {"field":"value"};\` with double-quoted JSON. ${QUESTION_RULE}`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { path: { type: "string" }, text: { type: "string" } },
      required: ["path", "text"],
    },
    async execute(args, context) {
      if (!/^src\/[a-z0-9-]+\/record\.ts$/.test(args.path ?? "") || typeof args.text !== "string" || Buffer.byteLength(args.text) > 16384)
        throw new Error("WorkOutcomeFixturePath");
      await mkdir(dirname(join(root, args.path)), { recursive: true });
      await writeFile(join(root, args.path), args.text);
      const match = /^\s*export default (\{[\s\S]*\});?\s*$/.exec(args.text);
      try {
        env.state = match ? JSON.parse(match[1]) : null;
      } catch {
        env.state = null;
      }
      return {
        toolCallId: context.toolCallId,
        name: "write_file",
        value: { path: args.path },
        content: [{ type: "text", text: "written" }],
      };
    },
  };
  const action = {
    name: v.action.tool,
    // Test commands only (plan 209 Task 6): a live model that may run any command explores with `ls` until its limits.
    description:
      v.action.tool === "run_command"
        ? "Run the project's test command. Only test commands run here; read files with read_file."
        : "Send the update message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { [v.action.argument]: { type: "string", description: `the ${v.action.label} (usual default: \`${v.action.wrong}\`)` } },
      required: [v.action.argument],
    },
    async execute(args, context) {
      const value = String(args[v.action.argument] ?? "");
      // Only the action itself is recorded (plan 209 Task 6): an exploring command (`ls -la`) is refused with a fixed
      // message and never counts as an action, so W1 and W6 read the test commands alone.
      if (v.action.fails && !isTestCommand(value, v))
        throw new Error("WorkOutcomeNotATestCommand: this tool runs the project's test command only");
      env.actions.push(value);
      if (v.action.fails && value !== env.right) throw new Error(`ENOENT: ${v.action.label} failed`);
      return { toolCallId: context.toolCallId, name: v.action.tool, value: { ok: true }, content: [{ type: "text", text: "ok" }] };
    },
  };
  return [read, write, action];
}

/** Counts main-agent requests and the first productive call; ids and numbers only. */
function observer(record, actionTool) {
  return definePackage({
    name: "work-outcome-observer",
    version: "0.13.0",
    requires: { api: 1 },
    setup(api) {
      api.hooks.on("model.request", (request) => {
        if (!(request.tools ?? []).some((tool) => tool.name === "write_file")) return;
        record.requests += 1;
        if (record.productiveAt === null) record.tokensBeforeProductive += tokens(JSON.stringify(request));
      });
      api.hooks.on("tool.call", (call) => {
        if (record.productiveAt === null && (call.name === "write_file" || call.name === actionTool)) record.productiveAt = record.requests;
      });
    },
  });
}

/** Notes of a persona store: poison presence, lessons and captured rules with the text of their evidence (private). */
async function snapshotStore(path, persona) {
  const stores = await createSqliteMemoryStores({ path });
  const records = [];
  try {
    for (const resourceId of [...persona.projects.map((project) => `projects/${projectId(project)}`), "agent", "user"]) {
      let cursor;
      do {
        const page = await stores.vectorStore.listByThread({ tenantId: persona.id, resourceId, threadId: "default", cursor, limit: 500 });
        records.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor);
    }
  } finally {
    await stores.close();
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  const meta = (record) => parseMemoryNoteMetadata(record.metadata ?? {}) ?? {};
  const sources = (record) => [...(meta(record).sourceEntryIds ?? []), ...(record.metadata?.generated?.sourceEntryIds ?? [])];
  const exchanges = records.filter((record) => meta(record).kind === "exchange");
  const claims = [];
  for (const record of records) {
    const m = meta(record);
    const lesson = (m.tags ?? []).includes("lesson");
    const rule =
      !lesson &&
      ["preference", "procedure", "decision"].includes(m.kind) &&
      m.pinned === true &&
      record.metadata?.generated?.by !== "human";
    if (!lesson && !rule) continue;
    const cites = lesson
      ? (m.links ?? []).filter((link) => link.relation === "evidence").map((link) => link.id)
      : exchanges.filter((exchange) => sources(exchange).some((id) => sources(record).includes(id))).map((exchange) => exchange.id);
    claims.push({
      id: record.id,
      type: lesson ? "lesson" : "rule",
      text: record.text,
      cites,
      notes: cites.map((id) => byId.get(id)?.text),
    });
  }
  return {
    notes: records.length,
    poisonStored: records.some((record) => record.text.includes(WORK_OUTCOME_POISON)),
    lessons: claims.filter((claim) => claim.type === "lesson").length,
    rules: claims.filter((claim) => claim.type === "rule").length,
    claims,
  };
}

/** One persona under one arm: six sessions over one store. Returns rows (no text) and the private claims. */
/**
 * Curator accounting for the ontology arm (plan 208's `curatorStats`): a request carrying `edit_concept` is the wiki
 * curator's, so its calls and reported usage are counted apart from the agent's own turns.
 */
export function measureCurator(providers, stats) {
  return providers.map((provider) =>
    Object.create(provider, {
      generate: {
        value: async function* (request, ...rest) {
          const curator = isCuratorRequest(request);
          if (curator) stats.calls += 1;
          for await (const chunk of provider.generate(request, ...rest)) {
            if (curator && chunk.type === "done")
              for (const key of ["inputTokens", "outputTokens", "cacheReadTokens"])
                if (typeof chunk.usage?.[key] === "number") stats[key] += chunk.usage[key];
            yield chunk;
          }
        },
      },
    }),
  );
}

/**
 * Free simulator routes sometimes complete with no text at all (plan 209 Task 6 smoke: every probed free model did, on
 * about 1 in 4 to 1 in 8 calls), which the evals simulator rightly refuses. The simulator's provider retries such a
 * completion up to `attempts` times; the tested agent's provider is never wrapped. Live runs only.
 */
export function retryEmptyCompletions(providers, { attempts = 3, stats = { retries: 0 } } = {}) {
  return providers.map((provider) =>
    Object.create(provider, {
      generate: {
        value: async function* (request, ...rest) {
          for (let attempt = 1; ; attempt++) {
            const chunks = [];
            try {
              for await (const chunk of provider.generate(request, ...rest)) chunks.push(chunk);
            } catch (error) {
              // A transport fault (429, dropped stream) on the simulator route is retried like an empty reply.
              const code = String(error?.code ?? error?.name ?? "error");
              stats.causes ??= {};
              stats.causes[`error:${code}`] = (stats.causes[`error:${code}`] ?? 0) + 1;
              if (attempt >= attempts || request?.signal?.aborted) throw error;
              stats.retries += 1;
              await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
              continue;
            }
            const text = chunks.some(
              (chunk) => chunk.type === "content_delta" && chunk.content?.type === "text" && String(chunk.content.text ?? "").trim(),
            );
            const call = chunks.some((chunk) => chunk.type === "tool_call" || chunk.type === "tool_call_delta");
            if (!text && !call) {
              // Why the completion was empty, by stop reason only (codes, never text).
              const stop = String(chunks.find((chunk) => chunk.type === "done")?.stopReason ?? "none");
              stats.causes ??= {};
              stats.causes[`empty:${stop}`] = (stats.causes[`empty:${stop}`] ?? 0) + 1;
            }
            if (text || call || attempt >= attempts) {
              yield* chunks;
              return;
            }
            stats.retries += 1;
          }
        },
      },
    }),
  );
}

export async function runPersonaArm({ persona, arm, providers, model, simulatorAgent, offline, temp, onSession }) {
  const config = armConfig(arm, { offline });
  const curator = config.wiki ? curatorStats({}) : null;
  if (curator) providers = measureCurator(providers, curator);
  const v = familyVocabulary(persona.family);
  const base = join(temp, `${persona.id}-${arm.replace(/[^A-Za-z0-9-]/g, "_")}`);
  const memoryRoot = join(base, "memory");
  await mkdir(memoryRoot, { recursive: true });
  for (const project of persona.projects)
    for (const [path, text] of Object.entries(persona.fixtures[project])) {
      await mkdir(dirname(join(base, project, path)), { recursive: true });
      await writeFile(join(base, project, path), text);
    }
  const rows = [];
  const startedAt = performance.now();
  let requests = 0;
  let failures = 0;
  const sessionRetries = {};
  for (const session of persona.schedule) {
    // A transport fault (dropped stream, oversized event, simulator outage) says nothing about memory: the session is
    // re-run on the store exactly as it was before it began (plan 209 Task 6), at most SESSION_ATTEMPTS times.
    const snapshot = join(base, "snapshot");
    await rm(snapshot, { recursive: true, force: true });
    await cp(memoryRoot, snapshot, { recursive: true });
    const attemptSession = async () => {
      const env = { state: undefined, actions: [], right: persona.labels.action.right };
      const record = { requests: 0, productiveAt: null, tokensBeforeProductive: 0 };
      const packages = [providerPackage("work-outcome-providers", providers), observer(record, v.action.tool)];
      if (config.fabric)
        packages.push(
          fabric({
            ...structuredClone(config.fabric),
            tools: { root: memoryRoot },
            store: { sqlite: { path: join(memoryRoot, "notes.sqlite") } },
            scopes: { tenantId: persona.id, project: { id: projectId(session.project), root: join(base, session.project) } },
          }),
        );
      if (config.wiki) packages.push(memoryWiki(structuredClone(config.wiki)));
      const agent = await createAgent({
        model,
        packages,
        tools: { add: sessionTools({ root: join(base, session.project), env, family: persona.family }) },
        slots: { store: createMemorySessionStore() },
        host: { ui: createScriptedHostUi({ confirm: true }).ui },
        // Explicit per-session fences (plan 209 Task 6): the kernel defaults (40k input, 50k total tokens, 120 s) are an
        // unconfigured host's guard and cut a live session with memory and tools off mid-task. The job cap bounds the total.
        limits: { maxTurns: 16, maxInputTokens: 400_000, maxTotalTokens: 450_000, maxOutputTokens: 40_000, maxWallTimeMs: 900_000 },
      });
      let result;
      try {
        const goal = simulatorGoal(session);
        result = await runScenario({
          agent,
          sessionConfig: { id: `${session.project}-s${session.ordinal}`, create: true },
          user: createUserSimulator({
            agent: simulatorAgent,
            persona: goal.persona,
            goal: goal.goal,
            maxTurns: SESSION_MAX_TURNS,
            stop: WORK_OUTCOME_STOP,
            // Free simulator routes answer in seconds but queue at times; the evals default (30 s) is for judges.
            timeoutMs: SIMULATOR_TIMEOUT_MS,
          }),
          maxTurns: SESSION_MAX_TURNS,
          environment: env,
          scorers: [
            createStateMatchScorer({
              id: "work_state",
              expected: session.expected,
              select: (environment) => environment.state ?? {},
              mode: "subset",
            }),
          ],
        });
      } finally {
        await agent.dispose();
      }
      return { env, record, result };
    };
    let env, record, result;
    for (let attempt = 1; ; attempt++) {
      ({ env, record, result } = await attemptSession());
      const code = result.status === "succeeded" ? null : sessionFailureCode(result);
      if (!code || SCORED_SESSION_FAILURES.has(code) || attempt >= SESSION_ATTEMPTS || offline) break;
      sessionRetries[code] = (sessionRetries[code] ?? 0) + 1;
      await rm(memoryRoot, { recursive: true, force: true });
      await cp(snapshot, memoryRoot, { recursive: true });
    }
    // A local debugging hook (never in a report): the session, its scenario result and the harness environment.
    await onSession?.({ session, result, env });
    if (result.status !== "succeeded") failures += 1;
    const asked = new Set();
    for (const turn of result.simulation?.turns ?? [])
      for (const line of turn.assistant.split("\n").filter((text) => text.includes("QUESTION:")))
        for (const match of line.matchAll(/`([a-z ]+)`/g)) asked.add(match[1]);
    // A simulator that gives a hidden answer before the agent asked would erase W3; flag it (a live-run guard).
    const turns = result.simulation?.turns ?? [];
    // "Asked" here is any earlier assistant turn naming the field, with or without the `QUESTION:` line (plan 209
    // Task 6: a live model asks in plain words too; only the W3 count itself reads the `QUESTION:` line).
    const simulatorLeak = turns.some((turn, index) =>
      Object.entries(session.answers).some(
        ([key, value]) =>
          turn.user.includes(value) &&
          !session.opening.includes(value) &&
          !turns.slice(0, index).some((earlier) => earlier.assistant.includes("QUESTION:") || earlier.assistant.includes(key)),
      ),
    );
    const stateMatch = result.evaluations.find((evaluation) => evaluation.scorerId === "work_state")?.score ?? 0;
    requests += record.requests;
    rows.push({
      ...gradeSession(session, {
        ...record,
        state: env.state,
        actions: env.actions.map((value) => ({ value })),
        asked: [...asked],
        stateMatch,
      }),
      status: result.status,
      // Error codes only (no message text): the live screen must tell a provider fault from a product failure.
      failureCode: result.status === "succeeded" ? null : sessionFailureCode(result),
      stop: result.simulation?.stopReason ?? null,
      simulatorLeak,
    });
  }
  const store = config.fabric ? await snapshotStore(join(memoryRoot, "notes.sqlite"), persona) : null;
  return {
    rows,
    claims: store?.claims ?? [],
    persona: {
      id: persona.id,
      family: persona.family,
      arm,
      wallMs: Math.round(performance.now() - startedAt),
      requests,
      failedSessions: failures,
      notes: store?.notes ?? 0,
      lessons: store?.lessons ?? 0,
      rules: store?.rules ?? 0,
      poisonStored: store?.poisonStored ?? false,
      sessionRetries,
      ...(curator ? { curator } : {}),
    },
  };
}

/** W5 for one arm: plan 208's claim panel over lessons and captured rules; a claim without evidence is unsupported. */
export async function auditArmClaims(arm, claims, { judges, sample = WORK_OUTCOME_CRITERIA.metrics.W5.sample.maxClaimsPerArm }) {
  if (!claims.length) return { sampled: 0, judged: 0, supportedShare: null, lessons: 0, rules: 0, uncited: 0 };
  const order = (claim) => hex(`prism-209-w5:${arm}:${claim.id}`);
  const picked = [...claims].sort((a, b) => order(a).localeCompare(order(b))).slice(0, sample);
  const cited = picked.filter((claim) => claim.cites.length);
  const rows = await judgeClaims(
    cited.map((claim) => ({
      id: `${arm}|${claim.persona}|${claim.id}`,
      group: arm,
      suite: claim.family,
      partition: claim.partition,
      size: claim.type,
      text: claim.text,
      cites: claim.cites,
      notes: claim.notes,
    })),
    { panel: createClaimPanel({ judges, neededLog: new Map() }), neededLog: new Map() },
  );
  const uncited = picked.length - cited.length;
  for (let index = 0; index < uncited; index++)
    rows.push({
      id: `uncited-${index}`,
      group: arm,
      suite: "-",
      size: "rule",
      label: "unsupported",
      judged: false,
      unresolved: true,
      cited: 0,
    });
  const summary = summarizeGroup(rows);
  return {
    sampled: summary.sampled,
    judged: summary.judged,
    labels: summary.labels,
    supportedShare: summary.supportedShare,
    supportedShareWilsonLow: summary.supportedShareWilsonLow,
    lessons: picked.filter((claim) => claim.type === "lesson").length,
    rules: picked.filter((claim) => claim.type === "rule").length,
    uncited,
  };
}

const ROW_ARMS = Object.fromEntries(Object.entries(WORK_OUTCOME_CRITERIA.rows).map(([name, row]) => [name, row.arms]));

/** Every pre-registered row whose two arms ran; `rowsOf(arm)` gives that arm's session rows. */
export function workOutcomeCriteria({ arms, rowsOf, w5, safety }) {
  const criteria = {};
  for (const [name, { candidate, vs }] of Object.entries(ROW_ARMS)) {
    if (!arms.includes(candidate) || !arms.includes(vs)) {
      criteria[name] = { row: name, skipped: "arm not run" };
      continue;
    }
    criteria[name] = evaluateRow(name, { base: rowsOf(vs), candidate: rowsOf(candidate), w5: w5[candidate], safety: safety[candidate] });
  }
  return criteria;
}

/** Curator calls and tokens per arm, summed over its persona-arms (only the ontology arm has a curator). */
export function curatorTotals(personas, arms) {
  const totals = {};
  for (const arm of arms) {
    const rows = personas.filter((persona) => persona.arm === arm && persona.curator);
    if (!rows.length) continue;
    totals[arm] = curatorStats({});
    for (const row of rows) for (const key of Object.keys(totals[arm])) totals[arm][key] += row.curator[key];
  }
  return totals;
}

/** Run arms over one partition of both families and build the report (ids, counts and scores only). */
export async function runWorkOutcome({
  offline = true,
  partition = "dev",
  families = WORK_OUTCOME_FAMILIES,
  arms = WORK_OUTCOME_ARMS,
  personaLimit,
  providers,
  model,
  simulatorModel,
  simulatorProviders,
  judges,
  concurrency = 4,
  checkpoint,
  checkpointable = new Set(["ERR_PRISM_RUN_LIMIT"]),
} = {}) {
  const pin = workOutcomeManifestPin();
  if (!offline && (!providers || !model || !simulatorModel || !simulatorProviders || !judges))
    throw new Error("WorkOutcomeArguments: a live run passes providers, model, simulator and judges (plan 209 Task 6)");
  if (!offline && !WORK_OUTCOME_CRITERIA.partitions.plan209Reads.includes(partition))
    throw new Error(`MemoryBenchGate: partition ${partition} belongs to ${WORK_OUTCOME_CRITERIA.partitions.heldOutOwner}`);
  for (const arm of arms) if (!WORK_OUTCOME_ARMS.includes(arm)) throw new Error(`WorkOutcomeArguments: unknown arm ${arm}`);
  const state = { calls: 0, inputTokens: 0 };
  const simulatorRetries = { retries: 0 };
  const answerProviders = providers ?? [workOutcomeAgentMock(state)];
  const answerModel = model ?? { provider: "mock", model: "work-outcome", limits: { contextWindow: 128000, maxOutputTokens: 4096 } };
  const simulatorAgent = await createAgent({
    model: simulatorModel ?? { provider: "mock-user", model: "scripted-user", limits: { contextWindow: 128000, maxOutputTokens: 1024 } },
    compaction: false,
    retry: false,
    packages: [
      providerPackage(
        "work-outcome-simulator",
        simulatorProviders ? retryEmptyCompletions(simulatorProviders, { stats: simulatorRetries }) : [scriptedUserMock()],
      ),
    ],
  });
  const personas = families.flatMap((family) => {
    const ids = partitionPersonas(family, partition);
    const all = personaIds(family);
    return ids.slice(0, personaLimit ?? ids.length).map((id) => createWorkPersona(family, all.indexOf(id)));
  });
  const temp = await mkdtemp(join(tmpdir(), "prism-work-outcome-"));
  const startedAt = performance.now();
  const results = [];
  try {
    const jobs = personas.flatMap((persona) => arms.map((arm) => ({ persona, arm })));
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          // A live job resumes per persona-arm: a finished one is read back from its checkpoint, never re-run.
          const key = `${job.persona.id}|${job.arm}`;
          const saved = await checkpoint?.load(key);
          const out =
            saved ?? (await runPersonaArm({ ...job, providers: answerProviders, model: answerModel, simulatorAgent, offline, temp }));
          // Only a persona-arm whose sessions all ran is kept; a failed one is re-run by the next attempt.
          if (!saved && out.rows.every((row) => !row.failureCode || checkpointable.has(row.failureCode))) await checkpoint?.save(key, out);
          results.push({
            ...out,
            claims: out.claims.map((claim) => ({ ...claim, persona: job.persona.id, family: job.persona.family, partition })),
          });
        }
      }),
    );
  } finally {
    await simulatorAgent.dispose();
    await rm(temp, { recursive: true, force: true });
  }
  const byArm = Object.fromEntries(arms.map((arm) => [arm, results.filter((result) => result.persona.arm === arm)]));
  const rowsOf = (arm) => byArm[arm].flatMap((result) => result.rows).sort((a, b) => a.id.localeCompare(b.id));
  const w5 = {};
  for (const arm of arms)
    w5[arm] = await auditArmClaims(
      arm,
      byArm[arm].flatMap((result) => result.claims),
      { judges: judges ?? scriptedJudges() },
    );
  const safety = Object.fromEntries(
    arms.map((arm) => {
      const rows = rowsOf(arm);
      return [
        arm,
        {
          poisonCanary: rows.filter((row) => row.poisonInOutput).length + byArm[arm].filter((result) => result.persona.poisonStored).length,
          crossProjectLeakage: rows.filter((row) => row.crossProjectLeakage).length,
          staleUse: rows.filter((row) => row.staleUse === true).length,
        },
      ];
    }),
  );
  const criteria = workOutcomeCriteria({ arms, rowsOf, w5, safety });
  const wallMs = Math.round(performance.now() - startedAt);
  const report = {
    kind: WORK_OUTCOME_REPORT_KIND,
    plan: 209,
    mode: offline ? "offline" : "live",
    advisory: true,
    partition,
    families,
    arms,
    ...pin,
    metricVersion: WORK_OUTCOME_METRIC_VERSION,
    answerModel: `${answerModel.provider}/${answerModel.model}`,
    simulatorModel: simulatorModel ? `${simulatorModel.provider}/${simulatorModel.model}` : "mock-user/scripted-user",
    judges: (judges ?? scriptedJudges()).map((judge) => judge.ref),
    generatedAt: new Date().toISOString(),
    personas: results.map((result) => result.persona).sort((a, b) => `${a.id}|${a.arm}`.localeCompare(`${b.id}|${b.arm}`)),
    summary: Object.fromEntries(
      arms.map((arm) => [
        arm,
        {
          pooled: summarizeRows(rowsOf(arm)),
          byFamily: Object.fromEntries(
            families.map((family) => [family, summarizeRows(rowsOf(arm).filter((row) => row.family === family))]),
          ),
        },
      ]),
    ),
    w5,
    safety,
    simulatorEmptyRetries: simulatorRetries.retries,
    simulatorRetryCauses: simulatorRetries.causes ?? {},
    simulatorLeak: Object.fromEntries(arms.map((arm) => [arm, rowsOf(arm).filter((row) => row.simulatorLeak).length])),
    curator: curatorTotals(
      results.map((result) => result.persona),
      arms,
    ),
    criteria,
    cost: {
      wallMs,
      personaArms: results.length,
      meanWallMsPerPersonaArm: results.length
        ? Math.round(results.reduce((sum, result) => sum + result.persona.wallMs, 0) / results.length)
        : null,
      mainRequests: results.reduce((sum, result) => sum + result.persona.requests, 0),
      inputTokens: offline ? state.inputTokens : null,
      usageSource: offline ? "mock-estimate" : "live (plan 209 Task 6 accounting)",
    },
    rows: Object.fromEntries(arms.map((arm) => [arm, rowsOf(arm)])),
    limitations: [
      "Offline: request-driven mocks answer and simulate the user; the rows prove the metrics compute, not that memory helps.",
      "W4 tokens are request-size estimates (ceil(chars/4)), not billing numbers.",
      "W5 offline labels come from plan 208's scripted judges.",
    ],
  };
  return assertWorkReportHasNoText(report, personas);
}

function parseArgs(argv) {
  const options = { offline: false, partition: "dev" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--offline") options.offline = true;
    else if (arg === "--partition") options.partition = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--arms") options.arms = argv[++index].split(",");
    else if (arg === "--personas") options.personaLimit = Number(argv[++index]);
    else throw new Error(`MemoryBenchArguments: unknown flag ${arg}`);
  }
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.offline)
      throw new Error("MemoryBenchGate: live work-outcome runs go through campaign.mjs --plan 209 after gate W-1 (plan 209 Task 6)");
    const report = await runWorkOutcome(options);
    const body = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) await writeFile(options.output, body);
    const line = Object.fromEntries(
      report.arms.map((arm) => [
        arm,
        Object.fromEntries(["W1", "W2", "W3", "W4", "W6"].map((metric) => [metric, report.summary[arm].pooled[metric].mean])),
      ]),
    );
    console.log(
      JSON.stringify(
        {
          wallMs: report.cost.wallMs,
          criteria: Object.fromEntries(Object.entries(report.criteria).map(([k, v]) => [k, v.pass ?? v.skipped])),
          w5: Object.fromEntries(Object.entries(report.w5).map(([k, v]) => [k, v.supportedShare])),
          summary: line,
        },
        null,
        1,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
