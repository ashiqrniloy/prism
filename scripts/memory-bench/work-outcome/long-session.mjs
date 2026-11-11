/**
 * Plan 217 Task 5: the live long-session coding family (S1, gate M-1).
 *
 * One session per persona holds six coding tasks. Two are related pairs: task 3 needs what task 1 changed (a renamed
 * function and its module) and task 6 needs what task 4 changed (a config key and its new value). Tasks 2 and 5 read a
 * large log, so the earlier task has left the context window by the time its dependent task starts; only memory (or
 * re-deriving from the files) can supply it.
 *
 * S1 counts, per related task, the searches and guesses in the dependent task: every `grep`, and every `read_file`
 * of a path that does not exist (`searchRederivationCalls` in `../long-session.mjs`). Plan 217 Task 6 replaced the
 * earlier count of every `grep`/`read_file` naming a target, which scored an agent's ordinary verification reads. Tasks 1 and 4 name neither the file nor the symbol they change, so
 * tasks 3 and 6 depend on what the agent found, not on the user's own prompt. The targets are hidden labels: the
 * agent never sees them.
 *
 *   timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --family long-session --offline [--partition dev]
 *
 * The family is not a W-criteria family (`work-outcome-criteria.json` is frozen and pins two families): its partitions
 * live in `work-outcome-long-session.json`, drawn label-blind once (`draw.mjs` pattern) and pinned by `idsHash`.
 * Live runs are plan 217 Task 6's (campaign machinery); the `OM-before` arm runs from the pinned pre-216 revision,
 * where `@arnilo/prism-memory-observational` resolves.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { searchRederivationCalls } from "../long-session.mjs";
import { ROBUSTNESS_PARTITIONS, robustnessIdsHash } from "../robustness.mjs";

export const LONG_SESSION_FAMILY = "long-session";
/** The original twelve personas, drawn label-blind into dev / heldout-a / heldout-b (plan 217 Task 5). */
export const LONG_SESSION_BASE_COUNT = 12;
/**
 * The dev extension (owner decision `m1DevPersonas`, 2026-11-10): `ls12`-`ls23`, every one in dev. The rule is fixed
 * before any of them runs and reads ids only, so it is label-blind by construction; the held-out partitions and the
 * first twelve personas are unchanged (a persona's content is a function of its id).
 */
export const LONG_SESSION_DEV_EXTENSION = 12;
export const LONG_SESSION_PERSONA_COUNT = LONG_SESSION_BASE_COUNT + LONG_SESSION_DEV_EXTENSION;
/** Personas per partition: [dev, heldout-a, heldout-b]. */
export const LONG_SESSION_STRATA = Object.freeze({ "long-session-coding": [4, 4, 4] });
export const LONG_SESSION_SEED = "prism-217-long-session";
export const LONG_SESSION_ARMS = Object.freeze(["memory-off", "STM", "OM-before"]);
export const LONG_SESSION_REPORT_KIND = "long-session-report-v1";
/** The provider-view budget every arm shares: the memory system's gate, and the kernel's entry gate without it. */
export const LONG_SESSION_CONTEXT = Object.freeze({ maxTokens: 6_000, thresholdEntries: 12, keepRecentEntries: 6 });
export const LONG_SESSION_STM_MODEL = "worker/stm";
const PARTITION_FILE = new URL("../work-outcome-long-session.json", import.meta.url);

const hex = (value) => createHash("sha256").update(value).digest("hex");

/** The ids the label-blind three-way draw reads: the original twelve. */
export const longSessionPersonaIds = () => Array.from({ length: LONG_SESSION_BASE_COUNT }, (_, index) => `ls${index}`);
/** The dev extension's ids, in the draw's seed order. */
export const longSessionExtensionIds = () =>
  Array.from({ length: LONG_SESSION_DEV_EXTENSION }, (_, index) => `ls${LONG_SESSION_BASE_COUNT + index}`).sort((a, b) =>
    hex(`${LONG_SESSION_SEED}:${a}`).localeCompare(hex(`${LONG_SESSION_SEED}:${b}`)),
  );

/** Label-blind draw: ids ordered by `SHA-256(seed + ":" + id)`; it reads ids only. Throws when the stratum is short. */
export function drawLongSessionPartitions(ids = longSessionPersonaIds()) {
  const unique = [...new Set(ids.map(String))];
  const abilities = Object.fromEntries(ROBUSTNESS_PARTITIONS.map((partition) => [partition, {}]));
  const residualPool = {};
  for (const [stratum, sizes] of Object.entries(LONG_SESSION_STRATA)) {
    const needed = sizes.reduce((sum, size) => sum + size, 0);
    if (unique.length < needed) throw new Error(`LongSessionDraw: ${stratum} has ${unique.length} of ${needed}`);
    const ordered = [...unique].sort((a, b) => hex(`${LONG_SESSION_SEED}:${a}`).localeCompare(hex(`${LONG_SESSION_SEED}:${b}`)));
    let start = 0;
    ROBUSTNESS_PARTITIONS.forEach((partition, index) => {
      abilities[partition][stratum] = ordered.slice(start, start + sizes[index]);
      start += sizes[index];
    });
    residualPool[stratum] = unique.length - needed;
  }
  return { seed: LONG_SESSION_SEED, abilities, residualPool, idsHash: robustnessIdsHash(abilities) };
}

export function longSessionPartitionFile() {
  const draw = drawLongSessionPartitions();
  const extension = longSessionExtensionIds();
  const abilities = structuredClone(draw.abilities);
  abilities.dev["long-session-coding"] = [...abilities.dev["long-session-coding"], ...extension];
  return {
    seed: draw.seed,
    draw: `SHA-256("${draw.seed}:" + id), ascending inside the family stratum`,
    source: "work-outcome/long-session.mjs (project-owned synthetic generator); ids only",
    strata: LONG_SESSION_STRATA,
    part: "dev | heldout-a | heldout-b; dev is plan 217 Task 6's gate M-1; heldout-a and heldout-b belong to the memory model's gate A",
    residualPool: draw.residualPool,
    extension: {
      decision: "m1DevPersonas (memory-model-criteria.json ownerDecisions, 2026-11-10)",
      rule: `ls${LONG_SESSION_BASE_COUNT}-ls${LONG_SESSION_PERSONA_COUNT - 1} all join dev, in the draw's seed order; the three-way draw of the first ${LONG_SESSION_BASE_COUNT} is unchanged`,
      dev: extension,
      baseIdsHash: draw.idsHash,
    },
    idsHash: robustnessIdsHash(abilities),
    abilities,
  };
}

/** The committed partitions; refuses a file that no longer re-derives from the ids. */
export async function longSessionPartitions() {
  const file = JSON.parse(await readFile(PARTITION_FILE, "utf8"));
  const expected = longSessionPartitionFile();
  if (file.idsHash !== expected.idsHash || robustnessIdsHash(file.abilities) !== file.idsHash)
    throw new Error("LongSessionPartitions: work-outcome-long-session.json no longer matches its draw");
  return file;
}

const WORDS = ["total", "ledger", "invoice", "payout", "balance", "refund"];

/** One persona: seeded names (hidden labels), project files, six task prompts and the related pairs' targets. */
export function createLongSessionPersona(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= LONG_SESSION_PERSONA_COUNT)
    throw new Error("LongSessionArguments: persona index out of range");
  const id = `ls${index}`;
  const seed = (key) => hex(`${LONG_SESSION_SEED}/${id}/${key}`);
  const word = WORDS[Number.parseInt(seed("word").slice(0, 8), 16) % WORDS.length];
  const Word = word[0].toUpperCase() + word.slice(1);
  const moduleBase = `${word}-${seed("module").slice(0, 4)}`;
  const modulePath = `src/${moduleBase}.ts`;
  const from = `format${Word}${seed("from").slice(0, 4)}`;
  const to = `render${Word}${seed("to").slice(0, 4)}`;
  const configPath = `config/${seed("config").slice(0, 6)}.json`;
  const key = `retry_${seed("key").slice(0, 4)}`;
  const before = 2 + (Number.parseInt(seed("before").slice(0, 4), 16) % 4);
  const after = before + 3 + (Number.parseInt(seed("after").slice(0, 4), 16) % 5);
  const log = (name, count, fail) =>
    Array.from(
      { length: count },
      (_, i) =>
        `[${name}] step ${i + 1}/${count}: ${fail(i) ? "FAILED" : "ok"} ${seed(`${name}${i}`).slice(0, 24)} ${i % 7 === 3 ? "warning: deprecated option" : ""}`,
    ).join("\n");
  const files = {
    "README.md": `# ${word} service\n\nRun the tests with the run_tests tool.\n`,
    [modulePath]: `export function ${from}(cents: number): string {\n  return (cents / 100).toFixed(2);\n}\n`,
    "src/cli.ts": `import { ${from} } from "./${moduleBase}";\n\nexport function main(args: string[]): string {\n  return ${from}(Number(args[0] ?? 0));\n}\n`,
    [`test/${moduleBase}.test.ts`]: `import { ${from} } from "../src/${moduleBase}";\n\ntest("formats cents", () => expect(${from}(1234)).toBe("12.34"));\n`,
    [configPath]: `${JSON.stringify({ timeout_ms: 5000, [key]: before }, null, 2)}\n`,
  };
  // The large logs come in four parts, so a filler task spans more entries than the kernel keeps recent.
  for (let part = 1; part <= 4; part++) {
    files[`logs/build-${part}.log`] = log(`build${part}`, 105, () => false);
    files[`logs/deploy-${part}.log`] = log(`deploy${part}`, 105, (i) => i % 37 === 11);
  }
  const tasks = [
    {
      // Plan 217 Task 6: the prompt names neither the function nor its module, so task 3 depends on what the agent found.
      id: "task1",
      prompt: `Task 1. Rename the function that formats cents (src/cli.ts uses it) to \`${to}\` everywhere in this project (its definition and every caller), then run the tests.`,
    },
    {
      id: "task2",
      prompt:
        "Task 2. Read the build log, in four parts logs/build-1.log to logs/build-4.log, and tell me how many lines report a warning.",
    },
    {
      id: "task3",
      prompt:
        'Task 3. Create src/report.ts exporting `summary(cents: number): string`, which returns "summary: " followed by the result of the function you renamed in task 1 (import it from its module). Run the tests.',
    },
    {
      // Plan 217 Task 6: the prompt names neither the config file nor the key, so task 6 depends on what the agent found.
      id: "task4",
      prompt: `Task 4. The ${word} service retries too few times: raise its retry limit in the project config from ${before} to ${after}. Run the tests.`,
    },
    {
      id: "task5",
      prompt: "Task 5. Read the deploy log, in four parts logs/deploy-1.log to logs/deploy-4.log, and list the steps that failed.",
    },
    {
      id: "task6",
      prompt:
        "Task 6. Write docs/retries.md with one line naming the config file and the key you changed in task 4, and its new value. Run the tests.",
    },
  ];
  return {
    id,
    family: LONG_SESSION_FAMILY,
    files,
    tasks,
    pairs: [
      { id: "rename", a: "task1", b: "task3", targets: [modulePath, moduleBase, from, to] },
      { id: "config", a: "task4", b: "task6", targets: [configPath, key] },
    ],
    // Hidden labels for the checks; never in a prompt the agent reads before its own task names them.
    labels: { modulePath, moduleBase, from, to, configPath, key, before, after },
  };
}

/** Which task checks pass on the files as they are (`run_tests` and the grader). */
export function longSessionChecks(files, labels) {
  const source = Object.entries(files)
    .filter(([path]) => /^(src|test)\//.test(path))
    .map(([, text]) => text)
    .join("\n");
  let config;
  try {
    config = JSON.parse(files[labels.configPath] ?? "");
  } catch {
    config = undefined;
  }
  const report = files["src/report.ts"] ?? "";
  const docs = files["docs/retries.md"] ?? "";
  return {
    task1: (files[labels.modulePath] ?? "").includes(`export function ${labels.to}(`) && !new RegExp(`\\b${labels.from}\\b`).test(source),
    task3: report.includes("summary") && report.includes(labels.to) && report.includes(labels.moduleBase),
    task4: config?.[labels.key] === labels.after && config?.timeout_ms === 5000,
    task6: docs.includes(labels.configPath) && docs.includes(labels.key) && docs.includes(String(labels.after)),
  };
}

const CHECK_MESSAGES = {
  task1: "task 1: the renamed function is not defined, or the old name is still used",
  task3: "task 3: src/report.ts does not export summary built on the renamed function",
  task4: "task 4: the config value is not the requested one",
  task6: "task 6: docs/retries.md does not name the config file, key and new value",
};

/** Project tools over a temp directory. Paths stay inside it; every call is logged with its task. */
function projectTools(root, persona, log) {
  const files = { ...persona.files };
  const safe = (path) => {
    const clean = normalize(String(path ?? "")).replace(/^\.\/+/, "");
    if (!clean || clean.startsWith("..") || clean.startsWith("/")) throw new Error("LongSessionPath: path outside the project");
    return clean;
  };
  const reply = (context, name, text) => {
    log.eligibleChars = (log.eligibleChars ?? 0) + String(text).length;
    return { toolCallId: context.toolCallId, name, value: text, content: [{ type: "text", text }] };
  };
  const record = (name, args) => log.calls.push({ task: log.task, name, args: structuredClone(args ?? {}) });
  const persist = async (path) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), files[path]);
  };
  const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
  return {
    files,
    tools: [
      {
        name: "read_file",
        description: "Read a project file.",
        parameters: object({ path: { type: "string" } }, ["path"]),
        execute(args, context) {
          record("read_file", args);
          const path = safe(args.path);
          // A guessed path is a re-derivation probe (S1); reading an existing file is not.
          if (files[path] === undefined) log.calls.at(-1).missing = true;
          return reply(context, "read_file", files[path] ?? `no such file: ${path}`);
        },
      },
      {
        name: "grep",
        description: "Search project files for a literal string; answers path:line:text lines.",
        parameters: object({ pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
        execute(args, context) {
          record("grep", args);
          const pattern = String(args.pattern ?? "");
          // Plan 217 Task 6 (gate M-1 run 1): `path: "."` normalised to "." and matched no file, so every
          // directory-wide grep answered "(no matches)". A root path searches everything; a directory, its files.
          const raw = String(args.path ?? "").trim();
          const scope = !raw || /^\.?\/?$/.test(raw) ? "" : safe(raw).replace(/\/+$/, "");
          const inScope = (path) => !scope || path === scope || path.startsWith(`${scope}/`);
          const hits = Object.entries(files)
            .filter(([path]) => inScope(path))
            .flatMap(([path, text]) =>
              text.split("\n").flatMap((line, index) => (pattern && line.includes(pattern) ? [`${path}:${index + 1}:${line}`] : [])),
            )
            .slice(0, 50);
          return reply(context, "grep", hits.length ? hits.join("\n") : "(no matches)");
        },
      },
      {
        name: "edit_file",
        description: "Replace every occurrence of `find` with `replace` in a project file.",
        parameters: object({ path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } }, [
          "path",
          "find",
          "replace",
        ]),
        async execute(args, context) {
          record("edit_file", args);
          const path = safe(args.path);
          if (files[path] === undefined) return reply(context, "edit_file", `no such file: ${path}`);
          const count = String(args.find) ? files[path].split(String(args.find)).length - 1 : 0;
          files[path] = files[path].split(String(args.find)).join(String(args.replace ?? ""));
          await persist(path);
          return reply(context, "edit_file", `Edited ${path}: ${count} replacement${count === 1 ? "" : "s"}`);
        },
      },
      {
        name: "write_file",
        description: "Write a project file.",
        parameters: object({ path: { type: "string" }, text: { type: "string" } }, ["path", "text"]),
        async execute(args, context) {
          record("write_file", args);
          const path = safe(args.path);
          if (typeof args.text !== "string" || Buffer.byteLength(args.text) > 16_384) throw new Error("LongSessionWrite: text too large");
          files[path] = args.text;
          await persist(path);
          return reply(context, "write_file", `Wrote ${path}`);
        },
      },
      {
        name: "run_tests",
        description: "Run the project's tests.",
        parameters: object({}, []),
        execute(_args, context) {
          record("run_tests", {});
          const started = log.started;
          const checks = Object.entries(longSessionChecks(files, persona.labels)).filter(([task]) => started.has(task));
          const failed = checks.filter(([, pass]) => !pass).map(([task]) => CHECK_MESSAGES[task]);
          const text = failed.length
            ? `${checks.length - failed.length} passed, ${failed.length} failed\n${failed.join("\n")}`
            : `${checks.length} passed, 0 failed`;
          return reply(context, "run_tests", text);
        },
      },
    ],
  };
}

/** Tests only: the project tools of a persona over an in-memory file set, by name. */
export function longSessionProjectToolsForTest(persona) {
  const log = { task: "task1", started: new Set(["task1"]), calls: [], eligibleChars: 0 };
  return Object.fromEntries(
    projectTools(join(tmpdir(), `long-session-test-${persona.id}`), persona, log).tools.map((tool) => [tool.name, tool]),
  );
}

const plain = (content) =>
  Array.isArray(content) ? content.map((block) => (block.type === "text" ? block.text : "")).join("") : String(content ?? "");
const isContextMessage = (message) => Array.isArray(message.metadata?.contextBlocks);

/**
 * The offline agent: request-driven, it never reads a label. It acts on the latest task prompt and takes what an
 * earlier task changed from what it can see (transcript, memory context); when it cannot see it, it re-derives it from
 * the files, which is what S1 counts.
 */
export function longSessionAgentMock() {
  let calls = 0;
  return {
    id: "mock",
    async *generate(request) {
      const step = mockStep(request);
      if (step.call) yield providerToolCall(toolCallContent(`ls-${++calls}`, ...step.call));
      else yield providerTextDelta(step.text);
      yield providerDone();
    },
  };
}

function mockStep(request) {
  const messages = request.messages;
  // The task prompt, or (once the kernel compacted it into the summary) the latest task the summary names.
  const promptIndex = messages.findLastIndex((m) => m.role === "user" && !isContextMessage(m) && /^Task \d\./.test(plain(m.content)));
  const summaryIndex = messages.findLastIndex((m) => m.role === "system");
  const taskIndex = promptIndex >= 0 ? promptIndex : summaryIndex;
  const task =
    promptIndex >= 0
      ? plain(messages[promptIndex].content)
      : ([...plain(messages[summaryIndex]?.content).matchAll(/Task \d\. [^\n]*/g)].at(-1)?.[0] ?? "");
  const since = messages.slice(taskIndex + 1);
  const calls = since.filter((m) => m.role === "assistant").flatMap((m) => (m.content ?? []).filter((b) => b.type === "tool_call"));
  const did = (name, test = () => true) => calls.some((c) => c.name === name && test(c.arguments ?? {}));
  const visible = `${JSON.stringify(request.context ?? [])}\n${messages
    .slice(0, taskIndex)
    .map((m) => plain(m.content))
    .join("\n")}`;
  let match = /rename the function that formats cents \(src\/cli\.ts uses it\) to `(\w+)`/i.exec(task);
  if (match) {
    const [, to] = match;
    // Discover the function from the CLI's import, then find every use.
    if (!did("read_file", (a) => a.path === "src/cli.ts")) return { call: ["read_file", { path: "src/cli.ts" }] };
    const from = /import \{ (\w+) \}/.exec(readResult(since, "src/cli.ts") ?? "")?.[1];
    if (!from) return { text: "Task 1: could not find the function." };
    if (!did("grep")) return { call: ["grep", { pattern: from, path: "." }] };
    const hits = [
      ...new Set(
        (calls.find((c) => c.name === "grep") ? grepResult(since) : "")
          .split("\n")
          .map((l) => l.split(":")[0])
          .filter((p) => p && p !== "(no matches)"),
      ),
    ];
    for (const path of hits)
      if (!did("edit_file", (a) => a.path === path)) return { call: ["edit_file", { path, find: from, replace: to }] };
    if (!did("run_tests")) return { call: ["run_tests", {}] };
    const module = hits.find((p) => /^src\/(?!cli)/.test(p)) ?? hits[0];
    return { text: `Task 1 done: renamed \`${from}\` to \`${to}\` in ${module} and its callers (${hits.join(", ")}); tests pass.` };
  }
  match = /four parts (logs\/[a-z]+)-1\.log/.exec(task);
  if (match) {
    const parts = [1, 2, 3, 4].map((part) => `${match[1]}-${part}.log`);
    for (const path of parts) if (!did("read_file", (a) => a.path === path)) return { call: ["read_file", { path }] };
    const text = parts.map((path) => readResult(since, path) ?? "").join("\n");
    return {
      text: /warning/.test(task)
        ? `${text.split("\n").filter((l) => /warning/.test(l)).length} lines report a warning.`
        : `${text.split("\n").filter((l) => /FAILED/.test(l)).length} steps failed.`,
    };
  }
  if (/function you renamed in task 1/.test(task)) {
    let known = /renamed `\w+` to `(\w+)` in (src\/[\w.-]+)\.ts/.exec(visible);
    if (!known) {
      // Re-derive: find exported functions, then read the module that is not the CLI.
      if (!did("grep")) return { call: ["grep", { pattern: "export function" }] };
      const path = grepResult(since)
        .split("\n")
        .map((l) => l.split(":")[0])
        .find((p) => /^src\/(?!cli|report)/.test(p));
      if (path && !did("read_file", (a) => a.path === path)) return { call: ["read_file", { path }] };
      const name = /export function (\w+)\(/.exec(readResult(since, path) ?? "")?.[1];
      known = name && path ? [null, name, path.replace(/\.ts$/, "")] : null;
    }
    if (known && !did("write_file")) {
      const [, name, module] = known;
      const base = module.replace(/^src\//, "");
      return {
        call: [
          "write_file",
          {
            path: "src/report.ts",
            text: `import { ${name} } from "./${base}";\n\nexport function summary(cents: number): string {\n  return \`summary: \${${name}(cents)}\`;\n}\n`,
          },
        ],
      };
    }
    if (!did("run_tests")) return { call: ["run_tests", {}] };
    return { text: "Task 3 done: src/report.ts exports summary; tests run." };
  }
  match = /raise its retry limit in the project config from (\d+) to (\d+)/.exec(task);
  if (match) {
    const [, before, after] = match;
    // Discover the config file and key: the line that holds the current retry value.
    if (!did("grep")) return { call: ["grep", { pattern: "retry", path: "config" }] };
    const line = grepResult(since)
      .split("\n")
      .find((l) => l.includes(`: ${before}`));
    const path = line?.split(":")[0];
    const key = /"(\w+)": \d+/.exec(line ?? "")?.[1];
    if (!path || !key) return { text: "Task 4: could not find the retry setting." };
    if (!did("edit_file")) return { call: ["edit_file", { path, find: `"${key}": ${before}`, replace: `"${key}": ${after}` }] };
    if (!did("run_tests")) return { call: ["run_tests", {}] };
    return { text: `Task 4 done: set \`${key}\` to ${after} in ${path}; tests pass.` };
  }
  if (/config file and the key you changed in task 4/.test(task)) {
    let known = /set `(\w+)` to (\d+) in (config\/[\w.-]+?\.json)/.exec(visible);
    if (!known) {
      if (!did("grep")) return { call: ["grep", { pattern: "timeout_ms" }] };
      const path = grepResult(since)
        .split("\n")
        .map((l) => l.split(":")[0])
        .find((p) => p.startsWith("config/"));
      if (path && !did("read_file", (a) => a.path === path)) return { call: ["read_file", { path }] };
      let parsed;
      try {
        parsed = JSON.parse(readResult(since, path) ?? "");
      } catch {
        parsed = undefined;
      }
      const key = parsed && Object.keys(parsed).find((k) => k !== "timeout_ms");
      known = key ? [null, key, String(parsed[key]), path] : null;
    }
    if (known && !did("write_file")) {
      const [, key, value, path] = known;
      return { call: ["write_file", { path: "docs/retries.md", text: `${path}: ${key} = ${value}\n` }] };
    }
    if (!did("run_tests")) return { call: ["run_tests", {}] };
    return { text: "Task 6 done: docs/retries.md written; tests run." };
  }
  return { text: "Done." };
}

function grepResult(since) {
  const index = since.findIndex(
    (m) => m.role === "assistant" && (m.content ?? []).some((b) => b.type === "tool_call" && b.name === "grep"),
  );
  const block = since.slice(index + 1).find((m) => m.role === "tool")?.content?.[0];
  return String(typeof block?.result === "string" ? block.result : plain(block?.content ?? ""));
}

function readResult(since, path) {
  const index = since.findIndex(
    (m) =>
      m.role === "assistant" &&
      (m.content ?? []).some((b) => b.type === "tool_call" && b.name === "read_file" && b.arguments?.path === path),
  );
  if (index < 0) return undefined;
  const block = since.slice(index + 1).find((m) => m.role === "tool")?.content?.[0];
  return String(typeof block?.result === "string" ? block.result : plain(block?.content ?? ""));
}

/**
 * The offline STM worker: an outcome per assistant reply and a request per task prompt, citing the batch's ids, in
 * the record shape its tool offers (`record_event` here; `record_observation` in the pinned pre-216 tree).
 */
export function longSessionWorkerMock() {
  return {
    id: "worker",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const shape = tools.includes("record_event") ? "event" : tools.includes("record_observation") ? "observation" : null;
      if (!shape || request.messages.some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      const prompt = request.messages
        .filter((m) => m.role === "user")
        .map((m) => plain(m.content))
        .join("\n");
      let n = 0;
      for (const line of prompt.split("\n")) {
        const match = /^\[[^\]]+\] \[([^\]]+)\] message: (\{"role":"(user|assistant)".*)$/.exec(line);
        if (!match) continue;
        let message;
        try {
          message = JSON.parse(match[2]);
        } catch {
          continue;
        }
        const text = plain(message.content);
        const kind =
          match[3] === "user" && /^Task \d\./.test(text)
            ? "request"
            : match[3] === "assistant" && /^Task \d done:/.test(text)
              ? "outcome"
              : null;
        if (!kind || !text) continue;
        const description = text.slice(0, 400);
        const args =
          shape === "event"
            ? { kind, description, sourceEntryIds: [match[1]], relevance: "high" }
            : { content: description, sourceEntryIds: [match[1]], relevance: "high" };
        yield providerToolCall(toolCallContent(`w${++n}`, shape === "event" ? "record_event" : "record_observation", args));
      }
      yield providerDone();
    },
  };
}

/**
 * The memory package of an arm: none, this tree's session tiers, or the pinned tree's observational package. Offline
 * the worker is the mock route `worker/stm`; live it is the arm's answer model (as in the robustness suites). The STM
 * arm's chunk store is metered (gate M-1's chunk bytes at peak); the pinned tree has no chunks.
 */
async function armMemory(arm, { workerModel = LONG_SESSION_STM_MODEL, chunkMeter, stmOverrides = {} } = {}) {
  if (arm === "memory-off") return [];
  if (arm === "STM") {
    const { default: memorySystem } = await import("@arnilo/prism-memory-system");
    const meter = chunkMeter ? [await (await import("../chunk-meter.mjs")).chunkMeterPackage(chunkMeter)] : [];
    return [
      ...meter,
      memorySystem({
        enabled: true,
        stm: { model: workerModel, triggerTokens: 1_000, ...stmOverrides },
        wm: false,
        context: { compactAt: { maxTokens: LONG_SESSION_CONTEXT.maxTokens }, recentMessages: 4 },
      }),
    ];
  }
  if (arm === "OM-before") {
    let observational;
    try {
      const historicalPackage = "@arnilo/prism-memory-observational"; // Resolved only in the pinned pre-216 checkout.
      observational = await import(historicalPackage);
    } catch {
      throw new Error(
        "LongSessionArguments: OM-before runs from the pinned pre-216 revision (baselines.json omBefore.revision; plan 217 Task 6)",
      );
    }
    return [
      observational.default({
        enabled: true,
        observer: { model: workerModel, messageTokens: 1_000 },
        context: { compactAt: { maxTokens: LONG_SESSION_CONTEXT.maxTokens }, recentMessages: 4 },
      }),
    ];
  }
  throw new Error(`LongSessionArguments: unknown arm ${arm}`);
}

/** The session-memory worker tools of both trees: STM (`record_event`), the pre-216 observer, reflector and dropper. */
export const LONG_SESSION_WORKER_TOOLS = Object.freeze(["record_event", "record_observation", "record_reflection", "drop_observations"]);
const estimate = (chars) => Math.ceil(chars / 4);

/**
 * Wrap the arm's providers so worker calls are counted apart from the main agent's (S4), and the main agent's output
 * joins the eligible transcript. Usage is the provider's when it reports one, else `ceil(len/4)` (offline mocks).
 */
export function meteredLongSessionProviders(providers, meter, log) {
  return providers.map((provider) => ({
    ...provider,
    async *generate(request) {
      const worker = (request.tools ?? []).some((tool) => LONG_SESSION_WORKER_TOOLS.includes(tool.name));
      const row = worker ? meter.worker : meter.main;
      row.calls++;
      let outputChars = 0;
      let usage;
      // The consumer stops reading at `done`, so the tally runs in `finally`, not after the loop.
      try {
        for await (const chunk of provider.generate(request)) {
          if (chunk.type === "content_delta" && chunk.content?.type === "text") outputChars += chunk.content.text.length;
          else if (chunk.type === "tool_call") outputChars += JSON.stringify(chunk.call?.arguments ?? {}).length;
          else if (chunk.type === "tool_call_delta") outputChars += chunk.argumentsText?.length ?? 0;
          else if (chunk.type === "usage" || chunk.type === "done") usage = chunk.usage ?? usage;
          yield chunk;
        }
      } finally {
        row.inputTokens += usage?.inputTokens ?? estimate(JSON.stringify(request.messages ?? []).length);
        row.outputTokens += usage?.outputTokens ?? estimate(outputChars);
        if (!worker) log.eligibleChars = (log.eligibleChars ?? 0) + outputChars;
      }
    },
  }));
}

/**
 * One persona on one arm: the six tasks in one session; rows per related pair (ids and counts only). `compactor`
 * replaces memory-off's default compactor (tests pass `createDefaultCompactor({ maxSummaryChars: 1 })`, a no-carry
 * control).
 */
export async function runLongSessionPersona({ persona, arm, providers, model, temp, compactor, workerModel, usage, stmOverrides }) {
  if (compactor && arm !== "memory-off") throw new Error("LongSessionArguments: a compactor override is for memory-off only");
  const root = join(temp, `${persona.id}-${arm.replace(/[^A-Za-z0-9-]/g, "_")}`);
  for (const [path, text] of Object.entries(persona.files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const log = { task: undefined, started: new Set(), calls: [], eligibleChars: 0 };
  const project = projectTools(root, persona, log);
  const meter = {
    worker: { calls: 0, inputTokens: 0, outputTokens: 0 },
    main: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };
  const chunkMeter = arm === "STM" ? { bytes: 0, peakBytes: 0, chunks: 0, puts: 0, deletes: 0 } : null;
  const agent = await createAgent({
    model,
    packages: [
      providerPackage("long-session-providers", meteredLongSessionProviders(providers, meter, log)),
      ...(await armMemory(arm, {
        ...(workerModel ? { workerModel } : {}),
        ...(chunkMeter ? { chunkMeter } : {}),
        ...(stmOverrides ? { stmOverrides } : {}),
      })),
    ],
    tools: { add: project.tools },
    slots: { store: createMemorySessionStore(), ...(compactor ? { compaction: compactor } : {}) },
    // The kernel's own compaction gate (memory-off; the memory arms vote with their own gate and own the slot).
    compaction: { thresholdEntries: LONG_SESSION_CONTEXT.thresholdEntries, keepRecentEntries: LONG_SESSION_CONTEXT.keepRecentEntries },
    limits: {
      maxTurns: 24,
      maxToolCalls: 24,
      maxInputTokens: 400_000,
      maxTotalTokens: 450_000,
      maxOutputTokens: 40_000,
      maxWallTimeMs: 900_000,
    },
  });
  const tasks = {};
  try {
    const session = await agent.session({ id: `${persona.id}-${arm}`, create: true });
    for (const task of persona.tasks) {
      log.task = task.id;
      log.started.add(task.id);
      log.eligibleChars += task.prompt.length;
      const result = await session.run(task.prompt);
      tasks[task.id] = {
        status: result?.status ?? "unknown",
        ...(result?.error?.code ? { code: result.error.code } : {}),
        calls: log.calls.filter((call) => call.task === task.id).length,
      };
    }
    await session.close();
  } finally {
    await agent.dispose();
  }
  const checks = longSessionChecks(project.files, persona.labels);
  // Gate M-1 (S4 and the cost rows): one usage row per persona-arm, ids and counts only.
  usage?.push({
    persona: persona.id,
    arm,
    worker: { ...meter.worker },
    main: { ...meter.main },
    eligibleTokens: estimate(log.eligibleChars),
    chunkStorePeakBytes: chunkMeter ? chunkMeter.peakBytes : null,
    tasks: Object.fromEntries(
      Object.entries(tasks).map(([id, task]) => [id, { status: task.status, ...(task.code ? { code: task.code } : {}) }]),
    ),
  });
  return persona.pairs.map((pair) => {
    const calls = log.calls.filter((call) => call.task === pair.b);
    return {
      family: LONG_SESSION_FAMILY,
      persona: persona.id,
      arm,
      pair: pair.id,
      rederivations: searchRederivationCalls(calls).length,
      toolCalls: calls.length,
      success: Boolean(checks[pair.b]),
      sourceSucceeded: Boolean(checks[pair.a]),
      status: tasks[pair.b]?.status ?? "missing",
    };
  });
}

/**
 * A persona-arm's faults: a task that neither completed nor stopped on the agent's own run limits is a provider or
 * harness fault, never a score (the work-outcome rule), so the job fails and resumes instead of counting it.
 */
export function longSessionFaults(usageRows) {
  return usageRows.flatMap((row) =>
    Object.entries(row.tasks ?? {})
      .filter(([, task]) => !["completed", "stopped"].includes(task.status) && task.code !== "ERR_PRISM_RUN_LIMIT")
      .map(([task, value]) => ({ persona: row.persona, arm: row.arm, task, status: value.status, code: value.code ?? null })),
  );
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/** Run the family on one partition. Offline replaces the answer and STM models with request-driven mocks. */
export async function runLongSession({ partition = "dev", arms, personaLimit, offline = false, providers, model, checkpoint } = {}) {
  if (!offline && (!providers || !model)) throw new Error("LongSessionArguments: live runs pass providers and model");
  const file = await longSessionPartitions();
  const ids = Object.values(file.abilities[partition] ?? {}).flat();
  if (!ids.length) throw new Error(`LongSessionArguments: no partition ${partition}`);
  const chosenArms = arms ?? (offline ? ["memory-off", "STM"] : [...LONG_SESSION_ARMS]);
  const personas = ids.slice(0, personaLimit ?? ids.length).map((id) => createLongSessionPersona(Number(id.slice(2))));
  const temp = await mkdtemp(join(tmpdir(), "prism-long-session-"));
  const started = performance.now();
  const rows = {};
  const usage = [];
  try {
    for (const arm of chosenArms) {
      rows[arm] = [];
      for (const persona of personas) {
        // A live persona-arm resumes from its checkpoint (interruptions cost only wall time); a failed one is not kept.
        const key = { persona: persona.id, arm };
        const saved = await checkpoint?.load(key);
        if (saved) {
          rows[arm].push(...saved.rows);
          usage.push(saved.usage);
          continue;
        }
        const own = [];
        const personaRows = await runLongSessionPersona({
          persona,
          arm,
          providers: offline ? [longSessionAgentMock(), longSessionWorkerMock()] : providers,
          model: offline ? { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } } : model,
          // Live, the worker is the answer model itself, as in the robustness suites.
          ...(offline ? {} : { workerModel: `${model.provider}/${model.model}` }),
          temp,
          usage: own,
        });
        rows[arm].push(...personaRows);
        usage.push(...own);
        if (checkpoint && !longSessionFaults(own).length) await checkpoint.save(key, { rows: personaRows, usage: own[0] });
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const summary = Object.fromEntries(
    chosenArms.map((arm) => [
      arm,
      {
        relatedTasks: rows[arm].length,
        rederivationsPerRelatedTask: mean(rows[arm].map((row) => row.rederivations)),
        successRate: mean(rows[arm].map((row) => (row.success ? 1 : 0))),
      },
    ]),
  );
  return {
    kind: LONG_SESSION_REPORT_KIND,
    family: LONG_SESSION_FAMILY,
    mode: offline ? "offline" : "live",
    partition,
    partitionIdsHash: file.idsHash,
    metric: "S1: grep/read_file calls in a related task whose target names something the earlier task changed",
    arms: chosenArms,
    personas: personas.map((persona) => persona.id),
    summary,
    rows,
    usage,
    wallMs: Math.round(performance.now() - started),
  };
}

if (import.meta.main && process.argv.includes("--write-partitions")) {
  await writeFile(PARTITION_FILE, `${JSON.stringify(longSessionPartitionFile(), null, 2)}\n`);
  console.log("wrote work-outcome-long-session.json");
}
