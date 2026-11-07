import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv, runCheck } from "../check/runner.js";
import { checkRoot, cleanup, INSPECTION_AGENT, tempDir, write } from "./fixture.js";

afterEach(cleanup);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("check runner", () => {
  it("check_env_allowlist: a variable outside the allowlist is absent in the child", async () => {
    const root = checkRoot();
    const out = join(tempDir("host-builder-env-"), "env.json");
    write(
      root,
      "src/agent.ts",
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(process.env)));\n${INSPECTION_AGENT}`,
    );
    const source = {
      ...process.env,
      OUTSIDE_THE_ALLOWLIST: "outside-value-123",
      PASSED_ON_REQUEST: "passed-value-456",
      OPENAI_API_KEY: "sk-nope",
    };
    const outcome = await runCheck({
      kind: "inspect",
      root,
      file: join(root, "src/agent.ts"),
      exportName: "createInspectionAgent",
      passEnv: ["PASSED_ON_REQUEST"],
      env: source,
    });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const names: string[] = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(names.includes("PRISM_HOST_BUILDER_CHECK"));
    assert.ok(names.includes("PASSED_ON_REQUEST"));
    assert.ok(!names.includes("OUTSIDE_THE_ALLOWLIST"));
    assert.ok(!names.includes("OPENAI_API_KEY"));
    for (const name of names)
      assert.ok(
        ["PATH", "HOME", "TMPDIR", "PRISM_HOME", "PRISM_HOST_BUILDER_CHECK", "PASSED_ON_REQUEST"].includes(name) || name.startsWith("BUN_"),
        name,
      );
  });

  it("childEnv copies only the allowlist and the check marker", () => {
    assert.deepEqual(childEnv([], { PATH: "/bin", SECRET: "x", HOME: "/h" }), { PATH: "/bin", HOME: "/h", PRISM_HOST_BUILDER_CHECK: "1" });
  });

  it("inspect_host_timeout_kills_child: a hanging factory is killed with everything it started", async () => {
    const root = checkRoot();
    const pidFile = join(tempDir("host-builder-pid-"), "pid");
    write(
      root,
      "src/hang.ts",
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
export async function createInspectionAgent() {
  const grandchild = spawn("sleep", ["300"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
  await new Promise(() => {});
}
`,
    );
    const started = Date.now();
    const outcome = await runCheck({
      kind: "inspect",
      root,
      file: join(root, "src/hang.ts"),
      exportName: "createInspectionAgent",
      timeoutMs: 1500,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.timedOut, true);
    assert.match(outcome.error?.message ?? "", /killed/);
    assert.ok(Date.now() - started < 10_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(pid > 0);
    await new Promise((done) => setTimeout(done, 200));
    assert.equal(alive(pid), false, "no process outlives the call");
  });

  it("a child that leaves a process behind after it reports does not leave it running", async () => {
    const root = checkRoot();
    const pidFile = join(tempDir("host-builder-pid-"), "pid");
    write(
      root,
      "src/leak.ts",
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
export async function createInspectionAgent() {
  writeFileSync(${JSON.stringify(pidFile)}, String(spawn("sleep", ["300"], { stdio: "ignore" }).pid));
  return createAgent({ model: { provider: "mock", model: "demo" }, packages: [mockProvider()] });
}
`,
    );
    const outcome = await runCheck({ kind: "inspect", root, file: join(root, "src/leak.ts"), exportName: "createInspectionAgent" });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    await new Promise((done) => setTimeout(done, 200));
    assert.equal(alive(Number(readFileSync(pidFile, "utf8"))), false);
  });

  it("output is capped and marked truncated", async () => {
    const root = checkRoot();
    write(
      root,
      "src/noisy.ts",
      `export async function createInspectionAgent() {\n  await new Promise((done) => process.stdout.write("x".repeat(2 * 1024 * 1024), done));\n  throw new Error("noisy");\n}\n`,
    );
    const outcome = await runCheck({ kind: "inspect", root, file: join(root, "src/noisy.ts"), exportName: "createInspectionAgent" });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.truncated, true);
  });

  it("a child that exits before it reports returns its stderr tail with passed values masked", async () => {
    const root = checkRoot();
    write(
      root,
      "src/dies.ts",
      `export async function createInspectionAgent() {\n  console.error("boom " + process.env.TOKEN_FOR_TEST);\n  process.exit(3);\n}\n`,
    );
    const outcome = await runCheck({
      kind: "inspect",
      root,
      file: join(root, "src/dies.ts"),
      exportName: "createInspectionAgent",
      passEnv: ["TOKEN_FOR_TEST"],
      env: { ...process.env, TOKEN_FOR_TEST: "tok-abcdef-123456" },
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error?.message ?? "", /code 3 before it reported/);
    assert.match(outcome.error?.message ?? "", /boom/);
    assert.ok(!(outcome.error?.message ?? "").includes("tok-abcdef-123456"));
  });

  it("a result over the cap is dropped and marked truncated", async () => {
    const root = checkRoot();
    write(
      root,
      "src/huge.ts",
      `export async function createInspectionAgent() {\n  return { inspect: () => ({ big: "a".repeat(2 * 1024 * 1024) }), dispose: async () => {} };\n}\n`,
    );
    const outcome = await runCheck({ kind: "inspect", root, file: join(root, "src/huge.ts"), exportName: "createInspectionAgent" });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.truncated, true);
    assert.match(outcome.error?.message ?? "", /larger than/);
  });

  it("an export that is missing or not an Agent is a typed ENTRY failure", async () => {
    const root = checkRoot();
    write(root, "src/wrong.ts", `export const notAFunction = 1;\nexport async function notAnAgent() { return {}; }\n`);
    for (const exportName of ["absent", "notAFunction", "notAnAgent"]) {
      const outcome = await runCheck({ kind: "inspect", root, file: join(root, "src/wrong.ts"), exportName });
      assert.equal(outcome.error?.code, "ERR_PRISM_HOST_BUILDER_ENTRY", exportName);
    }
  });
});
