/** Deterministic graders for the rot curve. No model judges and no task text in evidence. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function normalizeAnswer(answer) {
  return String(answer ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function gradeNeedle(answer, expected) {
  return normalizeAnswer(answer) === normalizeAnswer(expected);
}

/** Wilson score interval for a binomial proportion at 95%. */
export function wilson(successes, total, z = 1.96) {
  if (!Number.isFinite(total) || total <= 0) return [0, 0];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}

/**
 * Largest tested length whose accuracy is within `tolerance` of the zero-length baseline with an
 * overlapping 95% interval. The smallest tested length is returned when none qualify.
 */
export function effectiveInputBudget(arms, { baselineLength = 0, tolerance = 0.05 } = {}) {
  if (!Array.isArray(arms) || arms.length === 0) throw new TypeError("arms must be a non-empty array");
  const sorted = [...arms].sort((left, right) => left.length - right.length);
  const baseline = sorted.find((arm) => arm.length === baselineLength);
  if (!baseline) throw new TypeError(`baseline length ${baselineLength} is missing`);
  const qualifies = (arm) => {
    if (Math.abs(arm.accuracy - baseline.accuracy) > tolerance + 1e-9) return false;
    const [low, high] = arm.interval;
    const [baseLow, baseHigh] = baseline.interval;
    return high >= baseLow && baseHigh >= low;
  };
  const qualifying = sorted.filter(qualifies);
  return qualifying.length > 0 ? qualifying.at(-1).length : sorted[0].length;
}

export async function prepareWorkspace(fixtureRoot, root, task) {
  const workspace = join(root, `${task.id}-${Math.random().toString(36).slice(2, 8)}`);
  await cp(fixtureRoot, workspace, { recursive: true });
  for (const [path, content] of Object.entries(task.setup ?? {})) {
    const target = join(workspace, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return workspace;
}

export async function gradeCoding(workspace, task, { timeoutMs = 30_000 } = {}) {
  const testPath = join(workspace, "test/bugs.test.js");
  const before = await sha256File(testPath);
  if (before === undefined) return { score: 0, reason: "missing_test" };
  const result = spawnSync(process.execPath, ["test", "test/bugs.test.js", "-t", task.testName], {
    cwd: workspace,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const after = await sha256File(testPath);
  if (after !== before) return { score: 0, reason: "tests_modified" };
  if (result.status === 0) return { score: 1 };
  return { score: 0, reason: "test_failed" };
}

export async function gradeToolState(workspace, task) {
  for (const [path, expected] of Object.entries(task.expect)) {
    const actual = await readFile(join(workspace, path), "utf8").catch(() => undefined);
    if (actual === undefined) return { score: 0, reason: "missing_state" };
    if (path.endsWith(".json")) {
      let parsed;
      try {
        parsed = JSON.parse(actual);
      } catch {
        return { score: 0, reason: "invalid_json" };
      }
      if (stable(parsed) !== stable(JSON.parse(expected))) return { score: 0, reason: "wrong_state" };
    } else if (actual !== expected) return { score: 0, reason: "wrong_state" };
  }
  return { score: 1 };
}

export async function gradeTask(task, { workspace, answer }) {
  if (task.kind === "needle") return { score: gradeNeedle(answer, task.answer) ? 1 : 0 };
  if (task.kind === "coding") return gradeCoding(workspace, task);
  if (task.kind === "tools") return gradeToolState(workspace, task);
  throw new TypeError(`Unknown task kind: ${task.kind}`);
}

async function sha256File(path) {
  const bytes = await readFile(path).catch(() => undefined);
  return bytes === undefined ? undefined : createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
