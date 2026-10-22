import { it } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFixtures } from "../record-fixtures.js";

it("record_fixtures_tee_is_transparent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tee-test-"));
  try {
    const command = [
      process.execPath,
      "-e",
      "const s=await Bun.stdin.text(); process.stdout.write(s+'tail'); process.stderr.write('diagnostic'); process.exitCode=7",
    ];
    const run = async (argv: readonly string[]) => {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
      child.stdin.end("one\r\ntwo\n");
      const code = await closed;
      return { stdout, stderr, code };
    };
    const log = join(dir, "log");
    assert.deepEqual(await run(recordFixtures.command(command, log)), await run(command));
    const entries = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(entries, [
      { dir: "in", line: "one" },
      { dir: "in", line: "two" },
      { dir: "out", line: "one" },
      { dir: "out", line: "two" },
      { dir: "out", line: "tail" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("record_fixtures_finish_splits_turns_and_redacts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fixture-test-"));
  try {
    const log = join(dir, "log"),
      out = join(dir, "fixture.json");
    writeFileSync(
      log,
      `${[
        { dir: "out", line: "startup" },
        { dir: "in", line: "first private" },
        { dir: "out", line: "Bearer abc.def-123 private" },
        { dir: "in", line: "second" },
        { dir: "out", line: "done" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n")}\n`,
    );
    await recordFixtures.finish(log, out, { secrets: ["private"], redact: (line) => line.replace("done", "finished") });
    assert.deepEqual(recordFixtures.load(out), {
      version: 1,
      turns: [
        { input: [], output: ["startup"] },
        { input: ["first [redacted]"], output: ["Bearer [redacted] [redacted]"] },
        { input: ["second"], output: ["finished"] },
      ],
    });
    writeFileSync(out, '{"version":2,"turns":[]}');
    assert.throws(() => recordFixtures.load(out), /version/);
    writeFileSync(out, '{"version":1,"turns":[{"input":[1],"output":[]}]}');
    assert.throws(() => recordFixtures.load(out), /fixture/);
    writeFileSync(log, '{"dir":"bad","line":"x"}\n');
    await assert.rejects(async () => recordFixtures.finish(log, out), /record/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("record_fixtures_refuses_surviving_secret", async () => {
  const dir = mkdtempSync(join(tmpdir(), "secret-test-"));
  try {
    const log = join(dir, "log"),
      out = join(dir, "out");
    writeFileSync(log, `${JSON.stringify({ dir: "out", line: "token" })}\n`);
    // The replacement marker itself contains this supplied secret: the final check must refuse it.
    await assert.rejects(
      async () => recordFixtures.finish(log, out, { secrets: ["redacted"], redact: () => "redacted" }),
      /fixture_secret/,
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
