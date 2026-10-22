import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDockerSandbox } from "../../packages/tools/coding/src/security/docker-sandbox.ts";
import historyIndex from "./coding-history-index.json" with { type: "json" };
import historyPins from "./coding-history-pins.json" with { type: "json" };
import { DATASETS, loadPinnedArtifact, MemoryBenchDatasetError, normalizeCodingItem } from "./datasets.mjs";
import dream from "./fixtures/dreambench-swe-item.json" with { type: "json" };
import vibe from "./fixtures/vibemembench-item.json" with { type: "json" };
import { summarize } from "./report.mjs";

export const CODING_SUITES = ["dreambench-swe", "vibemembench"];
export const VIBE_REVISION = "11164976b4f920cdb0d0cd570ca572e49acea1e8";
const mean = (values) => (values.length ? values.reduce((a, b) => a + Number(b), 0) / values.length : null);
export function codingAccess(suite, verdict) {
  const gate = verdict ?? {
    license: DATASETS[suite]?.license,
    available: suite === "vibemembench",
    reason: "Public DreamBench-SWE v2 excludes hidden scoring oracles, reference solutions and fixture git history; schema smoke only.",
  };
  if (gate.license !== "Apache-2.0") throw new MemoryBenchDatasetError("Coding benchmark licence not permitted");
  if (verdict && !gate.available) throw new MemoryBenchDatasetError(gate.reason ?? "Coding benchmark data unavailable");
  return { ...gate, date: "2026-10-21" };
}
const issue = (id) => Number(/-(\d+)$/.exec(id)?.[1] ?? NaN);
export function earlierHistories(row, index = historyIndex) {
  const repo = row.repo.replace("/", "__").toLowerCase();
  return index
    .filter((pin) => {
      const parts = pin.path.split("/");
      return parts[2].toLowerCase() === repo && Number.isSafeInteger(issue(parts[3])) && issue(parts[3]) < issue(row.instance_id);
    })
    .sort((a, b) => issue(a.path.split("/")[3]) - issue(b.path.split("/")[3]));
}
export function summarizeCoding(suite, rows) {
  if (suite === "vibemembench") return { Resolved: mean(rows.map((r) => r.correct)), agentSteps: mean(rows.map((r) => r.agentSteps)) };
  return {
    passes: rows.filter((r) => r.correct).length,
    total: rows.length,
    staleUseRate: mean(rows.map((r) => r.staleUse).filter((v) => typeof v === "boolean")),
    repeatedErrorRate: mean(rows.map((r) => r.repeatedError).filter((v) => typeof v === "boolean")),
  };
}
export function parseVibeGrade({ exitCode, passed, expected }) {
  return exitCode === 0 && expected.length > 0 && JSON.stringify([...passed].sort()) === JSON.stringify([...expected].sort());
}
export function codingMetadata(suite) {
  return {
    access: codingAccess(suite),
    baselines:
      suite === "vibemembench"
        ? [
            { arm: "deepseek-v4-pro / memory off", Resolved: 0.671, agentSteps: 50.3 },
            { arm: "deepseek-v4-pro / frozen verified experience", Resolved: 0.671, agentSteps: 47.6 },
          ]
        : [
            { arm: "v2 B0 no memory", passes: 21, total: 180 },
            { arm: "v2 probe hybrid", passes: 95, total: 180 },
          ],
    baselineSource:
      suite === "vibemembench"
        ? "https://github.com/AlibabaResearch/DAMO-ConvAI/blob/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench/README.md"
        : "https://github.com/iroiro147/dreambench-swe/blob/d340bb2eaf3a81691820ef0683cd652753a9fa5a/analysis/fold/v2_tables.tex",
    comparability:
      "Descriptive only: Prism uses different providers, agent, tools, memory construction, budgets and seed counts. VibeMemBench record-form arms are disputed. Agent steps count solver model requests, excluding memory workers. Offline schema smoke is not a scored run. No paper-comparable claim.",
  };
}
export function codingSchemaReport(options) {
  const suite = options.suite;
  const item = normalizeCodingItem(suite === "vibemembench" ? vibe : dream, suite);
  return summarize({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    suite,
    config: options.config ?? "full",
    provider: "none",
    model: "none",
    judge: "none",
    status: options.offline ? "schema-smoke" : "unavailable",
    schemaItems: options.offline ? 1 : 0,
    schemaItemId: options.offline ? item.id : null,
    dataset: DATASETS[suite],
    coding: codingMetadata(suite),
    metrics: summarizeCoding(suite, []),
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    turns: 0,
    injections: [],
    injectedContextTokens: 0,
    results: [],
  });
}

export async function codingHistory(row, options = {}) {
  const sessions = [];
  for (const [i, entry] of earlierHistories(row).entries()) {
    const shaPin = historyPins.find((p) => p.path === entry.path);
    const pin = {
      ...entry,
      ...shaPin,
      file: `vibe-history-${createHash("sha256").update(entry.path).digest("hex")}.json`,
      url: `https://huggingface.co/datasets/Tongyi-ConvAI/VibeMemBench/resolve/${VIBE_REVISION}/${entry.path}`,
      license: "Apache-2.0",
      licenseUrl: DATASETS.vibemembench.licenseUrl,
    };
    const data = JSON.parse(await loadPinnedArtifact(pin, options));
    if (!Array.isArray(data.messages)) throw new MemoryBenchDatasetError("Vibe trajectory messages missing");
    sessions.push({
      id: entry.path.split("/")[3],
      date: new Date(Date.UTC(2000, 0, 1, 0, i)).toISOString(),
      messages: data.messages.map((m, j) => ({
        id: `history-${i}-${j}`,
        role: m.role === "user" ? "user" : "assistant",
        text: JSON.stringify(m),
      })),
    });
  }
  return sessions;
}
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const parserPin = {
  file: "vibemembench-log-parsers.py",
  bytes: 128726,
  sha256: "818560dab8da86cecc31cd9484a0f2b770359e59c51613316a391b58a73885e1",
  license: "Apache-2.0",
  licenseUrl: "https://github.com/AlibabaResearch/DAMO-ConvAI/tree/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench",
  url: "https://raw.githubusercontent.com/AlibabaResearch/DAMO-ConvAI/7152cf96809b45343ccc1caf7115a7d3fa43f956/VibeMemBench/scripts/vendor/log_parsers.py",
};
/** Reuse Prism's disposable sandbox; benchmark code never runs on the host. */
export async function prepareCoding(row, options = {}, { createSandbox = createDockerSandbox, dockerCli, gradeLog = gradeVibeLog } = {}) {
  normalizeCodingItem(row, "vibemembench");
  const temp = await mkdtemp(join(tmpdir(), "prism-vibe-"));
  let sandbox;
  const docker = process.env.PRISM_MEMORY_BENCH_DOCKER ?? Bun.which("docker") ?? "/usr/bin/docker";
  const cli = dockerCli ?? ((args) => execFileSync(docker, args, { timeout: 180000, maxBuffer: 1048576, encoding: "utf8" }));
  try {
    cli(["pull", row.image_name]);
    const image = JSON.parse(cli(["image", "inspect", row.image_name, "--format", "{{json .RepoDigests}}"]))?.[0];
    if (!/@sha256:[a-f0-9]{64}$/.test(image ?? "")) throw new Error("MemoryBenchImageDigestMissing");
    const open = async () => {
      const box = await createSandbox({
        docker,
        image,
        sourceRoot: temp,
        user: "1000:1000",
        network: { mode: "none" },
        env: {
          HOME: "/tmp",
          PYTHONPATH: "/workspace/repo/src:/workspace/repo",
          PATH: "/opt/venv/bin:/opt/conda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "safe.directory",
          GIT_CONFIG_VALUE_0: "/workspace/repo",
        },
        limits: { maxCommands: 256, maxOutputBytes: 1048576 },
      });
      try {
        const result = await box.execFile({
          file: "/bin/bash",
          args: [
            "-c",
            `mkdir /workspace/repo && cp -R ${quote(`/${row.repo.split("/")[1]}/.`)} /workspace/repo/ && git -C /workspace/repo reset --hard ${quote(row.base_commit)}`,
          ],
          cwd: "/workspace",
          timeout: 60000,
        });
        if (result.exitCode !== 0) throw new Error("MemoryBenchWorkspaceSetup");
        return box;
      } catch (error) {
        await box.close();
        throw error;
      }
    };
    sandbox = await open();
    const command = async (box, script) => {
      const chunks = [];
      const result = await box.execFile({
        file: "/bin/bash",
        args: ["-c", script],
        cwd: "/workspace/repo",
        timeout: 120000,
        onData: (b) => chunks.push(b),
      });
      return { exitCode: result.exitCode, text: Buffer.concat(chunks).toString("utf8") };
    };
    return {
      image,
      tools: [
        {
          name: "sandbox_command",
          description: "Run a bash command in the isolated repository at /workspace/repo; network is disabled.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { command: { type: "string", maxLength: 32768 } },
            required: ["command"],
          },
          async execute(args, context) {
            if (typeof args.command !== "string" || args.command.length > 32768) throw new Error("MemoryBenchCommandInvalid");
            const value = await command(sandbox, args.command);
            return {
              toolCallId: context.toolCallId,
              name: "sandbox_command",
              value,
              content: [{ type: "text", text: JSON.stringify(value) }],
            };
          },
        },
      ],
      async grade() {
        const diff = await command(sandbox, "git add -N . && git diff --no-ext-diff --no-textconv HEAD");
        if (diff.exitCode !== 0) throw new Error("MemoryBenchPatchCapture");
        await sandbox.close();
        sandbox = undefined;
        if (!diff.text.trim()) return false;
        const commandSpec = row.install_config?.test_cmd;
        const tests = typeof commandSpec === "string" ? [commandSpec] : commandSpec;
        if (
          !Array.isArray(tests) ||
          !tests.length ||
          tests.some((t) => typeof t !== "string") ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.install_config?.log_parser ?? "")
        )
          throw new Error("MemoryBenchOracleSchema");
        // A fresh container prevents the solver from modifying tests, git config or the evaluator.
        await writeFile(join(temp, "solution.patch"), diff.text);
        await writeFile(join(temp, "tests.patch"), row.test_patch);
        sandbox = await open();
        const result = await command(
          sandbox,
          `set -e\ngit apply --3way --recount --ignore-space-change --whitespace=nowarn /workspace/solution.patch\ngit apply --3way --recount --ignore-space-change --whitespace=nowarn /workspace/tests.patch\n${tests.join("\n")}`,
        );
        return gradeLog(row, result, options);
      },
      async close() {
        try {
          await sandbox?.close();
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await sandbox?.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    throw error;
  }
}

/** The pinned upstream parser and normalization define Resolved; no judge model is used. */
export async function gradeVibeLog(row, result, options = {}) {
  const temp = await mkdtemp(join(tmpdir(), "prism-vibe-grade-"));
  try {
    for (const pin of [
      parserPin,
      {
        ...parserPin,
        file: "swe_constants.py",
        bytes: 141,
        sha256: "823dd1ef512d363ed5d4dce05d70f22d7f93b25722cda5b0971f17010f5168a5",
        url: parserPin.url.replace("log_parsers.py", "swe_constants.py"),
      },
      {
        ...parserPin,
        file: "eval.py",
        bytes: 15448,
        sha256: "e580d953b75e5182a66ffd2fecfbf9c756dadd89db767cfd42bd251f956a7108",
        url: parserPin.url.replace("log_parsers.py", "eval.py"),
      },
    ])
      await writeFile(join(temp, pin === parserPin ? "log_parsers.py" : pin.file), await loadPinnedArtifact(pin, options));
    const parsed = JSON.parse(
      execFileSync(
        process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3",
        [
          "-c",
          "import sys,json,importlib.util;sys.path.insert(0,sys.argv[1]);s=importlib.util.spec_from_file_location('upstream',sys.argv[1]+'/eval.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);p=json.load(sys.stdin);v=m.get_parser(p['parser'])(p['text']);print(json.dumps({'passed':[m._normalize_test_name(k) for k,v in v.items() if v=='PASSED'],'expected':[m._normalize_test_name(k) for k in p['expected']]}))",
          temp,
        ],
        {
          input: JSON.stringify({
            parser: row.install_config.log_parser,
            text: result.text,
            expected: [...row.FAIL_TO_PASS, ...row.PASS_TO_PASS],
          }),
          timeout: 30000,
          maxBuffer: 1048576,
          encoding: "utf8",
        },
      ),
    );
    return parseVibeGrade({ exitCode: result.exitCode, ...parsed });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
