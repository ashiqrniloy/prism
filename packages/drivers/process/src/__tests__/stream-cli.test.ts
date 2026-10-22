import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, createAgent } from "@arnilo/prism";
import { createProfiles, createRunDirectory } from "@arnilo/prism/driver-kit";
import { createScriptedCli, type ScriptedDialect, type ScriptStep } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, processDriver } from "@arnilo/prism-driver-process";
import { type AdapterConformanceFixtures, adapterConformance } from "@arnilo/prism-driver-process/testing";

// Computed imports keep unpublished examples outside the package declaration build's rootDir.
const exampleRoot = "../../../../../examples/adapters/";
const { streamCli }: { streamCli: AgentAdapter } = await import(`${exampleRoot}stream-cli.ts`);
const { streamCliDialect, streamCliFixtures }: { streamCliDialect: ScriptedDialect; streamCliFixtures: AdapterConformanceFixtures } =
  await import(`${exampleRoot}stream-cli.dialect.ts`);

test("stream_cli_passes_adapter_conformance", async () => {
  const result = await adapterConformance(streamCli, { dialect: streamCliDialect, fixtures: streamCliFixtures });
  expect(result.legs.filter((leg) => leg.status === "skipped").map((leg) => leg.name)).toEqual(["deployment", "unknown_request_fails"]);
  expect(result.legs).toHaveLength(21);
}, 180_000);

async function run(script: readonly ScriptStep[], rewrite = false) {
  const root = mkdtempSync(join(tmpdir(), "stream-reference-"));
  const cli = createScriptedCli({ dialect: streamCliDialect, script });
  try {
    await createProfiles({ root, driver: adapterDriver(streamCli) }).create("test", { mode: "key", principal: "test" });
    const agent = await createAgent({
      packages: [processDriver(streamCli)],
      packageConfig: {
        [streamCli.name]: { ...streamCliFixtures.config(cli), name: "test", profile: "test", profilesRoot: root, principal: "test" },
      },
      hooks: (hooks) => {
        hooks.on("tool.call", () => (rewrite ? { rewrite: { path: "rewritten.txt" } } : "allow"));
      },
    });
    const session = await agent.session({ create: true });
    const events: AgentEvent[] = [];
    const subscription = session.subscribe({ acrossRuns: true });
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    try {
      expect((await session.run("go")).error).toBeUndefined();
    } finally {
      await session.close();
      await pump;
    }
    return { record: cli.record(), events };
  } finally {
    cli.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

test("stream_cli_rewrite_reaches_binary", async () => {
  const { record } = await run([{ hook: { id: "rewrite", tool: "edit", args: { path: "original.txt" } } }], true);
  const answer = record.find((item) => item.event === "hook-result");
  expect(answer?.event === "hook-result" && JSON.parse(answer.stdout)).toEqual({
    decision: "allow",
    updatedInput: { path: "rewritten.txt" },
  });
}, 30_000);

test("stream_cli_subagent_nesting", async () => {
  const { events } = await run([
    { raw: '{"type":"subagent","phase":"started","parentToolId":"parent","name":"review"}' },
    { raw: '{"type":"tool_use","id":"child","name":"read","input":{}}' },
    { raw: '{"type":"subagent","phase":"completed","parentToolId":"parent"}' },
  ]);
  const nested = events.find((event) => event.type === "tool.started");
  expect(nested).toMatchObject({ origin: { depth: 1, subagentId: "parent", parentToolCallId: "parent" } });
}, 30_000);

test("stream_cli_materializes_spec_and_restores_transcript", async () => {
  const root = mkdtempSync(join(tmpdir(), "stream-config-"));
  const runDir = await createRunDirectory(root, "test");
  try {
    await runDir.writeFile("skills/review/SKILL.md", "review notes");
    const plan = await streamCli.configure(
      {
        name: "test",
        profile: "test",
        model: "small",
        effort: "high",
        systemPrompt: { replace: "review" },
        builtinTools: { allow: ["read"], deny: ["shell"] },
        subagents: { review: { name: "review", profile: "test" } },
      },
      {
        runDir,
        home: root,
        cwd: root,
        resume: { entries: [] },
        hook: { argv: ["relay"], command: "relay" },
        endpoint: { transport: "http", url: "http://127.0.0.1:1/mcp", headerEnv: "STREAM_TEST_BEARER" },
        skills: {
          root: join(runDir.path, "skills"),
          pathToSkill: new Map([["review", join(runDir.path, "skills/review/SKILL.md")]]),
          extra: [],
        },
      },
    );
    expect(plan.args).toEqual(
      expect.arrayContaining([
        "--model",
        "small",
        "--effort",
        "high",
        "--allow-tools",
        "read",
        "--deny-tools",
        "shell",
        "--plugin",
        join(runDir.path, "plugin"),
      ]),
    );
    expect(JSON.parse(readFileSync(join(runDir.path, "settings.json"), "utf8"))).toMatchObject({
      systemPrompt: { mode: "replace" },
      hooks: { preTool: ["relay"], stop: ["relay"] },
    });
    expect(JSON.parse(readFileSync(join(runDir.path, "plugin/manifest.json"), "utf8"))).toMatchObject({ skills: "skills" });
    expect(readFileSync(join(runDir.path, "plugin/skills/review/SKILL.md"), "utf8")).toBe("review notes");
    expect(JSON.parse(readFileSync(join(runDir.path, "mcp.json"), "utf8"))).toEqual({
      strict: true,
      endpoint: { transport: "http", url: "http://127.0.0.1:1/mcp", headerEnv: "STREAM_TEST_BEARER" },
    });
    await streamCli.configure(
      { name: "test", profile: "test", systemPrompt: { append: "extra notes" } },
      { runDir, home: root, cwd: root, resume: { entries: [] }, hook: { argv: ["relay"], command: "relay" } },
    );
    expect(JSON.parse(readFileSync(join(runDir.path, "settings.json"), "utf8"))).toMatchObject({ systemPrompt: { mode: "append" } });
    expect(readFileSync(join(runDir.path, "prompt.md"), "utf8")).toBe("extra notes");
    assert(streamCli.session.restore && streamCli.session.archive);
    const restored = await streamCli.session.restore(["first\n", "second\n"], { runDir, home: root, cwd: root });
    expect(restored.args).toEqual(["--resume-file", join(runDir.path, "transcript.jsonl")]);
    expect(await streamCli.session.archive({ runDir, home: root, cwd: root })).toEqual(["second\n"]);
  } finally {
    await runDir.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("stream_cli_stop_status_notices_and_unknown_frames", () => {
  assert(streamCli.hooks && streamCli.notices);
  const codec = streamCli.hooks.codec;
  expect(codec.decode('{"type":"stop","reason":"done"}')).toEqual({ kind: "stop", reason: "done" });
  expect(JSON.parse(codec.encode({ end: { continue: true, reason: "review again" } }).stdout)).toEqual({ decision: "continue" });
  expect(JSON.parse(codec.encode({ end: { continue: false } }).stdout)).toEqual({ decision: "stop" });
  expect(() => codec.decode('{"type":"unknown"}')).toThrow();
  for (const category of ["rate_limit", "quota", "billing", "auth"] as const) {
    const decoded = streamCli.decode({ type: "retry", category, message: "stop" });
    assert(decoded.activity[0]);
    expect(streamCli.notices(decoded.activity[0])).toEqual({ code: category });
  }
  expect(streamCli.decode({ type: "new-frame" })).toEqual({ activity: [], unmapped: true });
  expect(streamCli.profile.parseStatus({ exitCode: 0, stdout: '{"signedIn":true}' })).toEqual({ signedIn: true });
  expect(streamCli.profile.parseStatus({ exitCode: 0, stdout: "invalid" })).toEqual({ signedIn: false });
});

test("stream_cli_locate_reports_inherited_home_and_hides_it_under_strict_flags", () => {
  assert(streamCliFixtures.home && streamCliDialect.locate);
  const planted = Object.values(streamCliFixtures.home);
  const files = new Map(planted.map((item) => [join("/fake", item.path), item.content]));
  const input = { argv: [] as string[], env: { HOME: "/fake" }, cwd: "/", readFile: (path: string) => files.get(path) };
  expect(streamCliDialect.locate(input).loaded).toEqual([...files.keys()]);
  expect(streamCliDialect.locate({ ...input, argv: ["--no-user-config"] }).loaded).toEqual([]);
  const raw = { kind: "raw", vendor: "stream-cli", type: "custom", data: { ok: true } } as const;
  expect(streamCliDialect.parseFrame(streamCliDialect.frames(raw))).toEqual({ kind: "frame", frame: raw });
  expect(streamCliDialect.parseFrame("invalid")).toBeUndefined();
});

test("stream_cli_local_account_refuses_hosted_before_spawn", async () => {
  const root = mkdtempSync(join(tmpdir(), "stream-policy-"));
  const cli = createScriptedCli({ dialect: streamCliDialect, script: [] });
  try {
    await createProfiles({ root, driver: adapterDriver(streamCli) }).create("test", { mode: "account", principal: "test" });
    const agent = await createAgent({
      packages: [processDriver(streamCli)],
      packageConfig: {
        [streamCli.name]: {
          ...streamCliFixtures.config(cli),
          name: "test",
          profile: "test",
          profilesRoot: root,
          principal: "test",
          deployment: "hosted",
        },
      },
    });
    const session = await agent.session({ create: true });
    try {
      expect((await session.run("go")).error?.message).toContain("plan_login_not_permitted");
      expect(cli.record().filter((item) => item.event === "argv")).toEqual([]);
    } finally {
      await session.close();
    }
  } finally {
    cli.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
