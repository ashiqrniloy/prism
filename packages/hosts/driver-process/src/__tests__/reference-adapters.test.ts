import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage } from "@arnilo/prism";
import { assertIsolation, createProfiles, createRunDirectory } from "@arnilo/prism/driver-kit";
import { createScriptedCli, type ScriptedDialect } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, type ConfigureContext, processDriver } from "@arnilo/prism-hosts/driver-process";
import type { AdapterConformanceFixtures } from "@arnilo/prism-hosts/driver-process/testing";

// Computed imports keep unpublished examples outside the package declaration build's rootDir.
const exampleRoot = "../../../../../examples/adapters/";
const { workspaceConfig }: { workspaceConfig: AgentAdapter } = await import(`${exampleRoot}workspace-config.ts`);
const {
  workspaceConfigDialect,
  workspaceConfigFixtures,
}: { workspaceConfigDialect: ScriptedDialect; workspaceConfigFixtures: AdapterConformanceFixtures } = await import(
  `${exampleRoot}workspace-config.dialect.ts`
);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
/** Legs a reference adapter may skip, by name. Anything else must pass. */
const ALLOWED_SKIPS: Record<string, readonly string[]> = {
  "stream-cli": ["deployment", "unknown_request_fails"],
  "rpc-server": ["deployment", "fail_closed", "fail_closed_response"],
  "workspace-config": ["deployment", "unknown_request_fails"],
};

test("reference_adapters_pass_adapter_conformance", () => {
  const output = execFileSync(process.execPath, ["examples/adapters/conformance.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 280_000,
  });
  const summaries = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { adapter: string; legs: { name: string; status: string; reason?: string }[] });
  expect(summaries.map((summary) => summary.adapter).sort()).toEqual(["rpc-server", "stream-cli", "workspace-config"]);
  for (const summary of summaries) {
    expect(summary.legs).toHaveLength(21);
    for (const leg of summary.legs) expect(["passed", "skipped"]).toContain(leg.status);
    const skipped = summary.legs.filter((leg) => leg.status === "skipped");
    expect(skipped.map((leg) => leg.name).sort()).toEqual([...(ALLOWED_SKIPS[summary.adapter] ?? [])].sort());
    for (const leg of skipped) expect(typeof leg.reason).toBe("string");
  }
}, 300_000);

test("workspace_config_requires_worktree_under_strict", () => {
  expect(() => assertIsolation(workspaceConfig.descriptor, { isolation: "strict" })).toThrow("worktree_required");
  expect(assertIsolation(workspaceConfig.descriptor, { isolation: "strict", worktree: "/work" }).mechanism).toBe("workspace-files");
});

test("workspace_config_fail_closed_is_printed_deny", () => {
  assert(workspaceConfig.hooks);
  const failClosed = { exitCode: 0, stdout: '{"decision":"deny","reason":"prism relay unavailable"}' };
  expect(workspaceConfig.hooks.failClosed).toEqual(failClosed);
  expect(workspaceConfig.hooks.codec.encode({ allow: false, reason: "denied", message: "nope" })).toEqual({
    exitCode: 0,
    stdout: '{"decision":"deny","reason":"nope"}',
  });
  expect(workspaceConfig.hooks.codec.encode({ allow: true })).toEqual({ exitCode: 0, stdout: '{"decision":"allow"}' });
  expect(workspaceConfig.hooks.codec.encode({ end: { continue: false } })).toEqual({ exitCode: 0, stdout: '{"decision":"stop"}' });
});

test("workspace_config_next_turn_steer", () => {
  expect(workspaceConfig.descriptor.controls.steer).toBe("next-turn");
  expect(workspaceConfig.encode.steer).toBeUndefined();
  const held = workspaceConfig.encode.prompt([{ role: "user", content: [{ type: "text", text: "change course" }] }], {});
  expect(held).toEqual({ type: "prompt", text: "change course" });
  expect(workspaceConfigDialect.decodeInput(JSON.stringify(held))).toEqual({ kind: "user", text: "change course" });
});

test("workspace_config_thinking_tokens_only", () => {
  expect(workspaceConfig.decode({ type: "delta", block: "thinking", text: "secret" })).toEqual({ activity: [], unmapped: true });
  const decoded = workspaceConfig.decode({
    type: "result",
    conversationId: "c",
    usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 7 },
  });
  expect(decoded.turnEnd).toBe(true);
  expect(decoded.sessionId).toBe("c");
  expect((decoded.activity[0] as unknown as { usage: Record<string, number> }).usage).toEqual({
    inputTokens: 1,
    outputTokens: 2,
    thinkingTokens: 7,
  });
});

test("workspace_config_locate_reports_overlay_and_hides_home", () => {
  assert(workspaceConfigDialect.locate && workspaceConfigFixtures.home);
  const manifestFiles = [".agents/agents/test.md", ".agents/hooks.json", ".agents/mcp.json"];
  const planted = Object.values(workspaceConfigFixtures.home).map((item) => join("/fake", item.path));
  const files = new Map<string, string>([
    [".agents/manifest.json", JSON.stringify({ files: manifestFiles })],
    [".agents/agents/test.md", "agent"],
    [".agents/hooks.json", JSON.stringify({ PreToolUse: [{ command: ["relay", "hook"] }] })],
    [".agents/mcp.json", JSON.stringify({ endpoint: null })],
    ...Object.values(workspaceConfigFixtures.home).map((item) => [join("/fake", item.path), item.content] as const),
  ]);
  const input = { argv: [] as string[], env: { HOME: "/fake" }, cwd: "/", readFile: (path: string) => files.get(path) };
  const located = workspaceConfigDialect.locate(input);
  expect(located.hookCommand).toEqual(["relay", "hook"]);
  expect(located.loaded).toEqual(expect.arrayContaining([...manifestFiles, ...planted]));
  expect(workspaceConfigDialect.locate({ ...input, argv: ["--no-user-config"] }).loaded).toEqual(manifestFiles);
});

test("workspace_config_materializes_worktree_overlays", async () => {
  const root = mkdtempSync(join(tmpdir(), "ws-config-"));
  const runDir = await createRunDirectory(root, "test");
  try {
    await runDir.writeFile("skills/review/SKILL.md", "review notes");
    const plan = await workspaceConfig.configure(
      {
        name: "test",
        profile: "test",
        model: "small",
        systemPrompt: { replace: "review" },
        builtinTools: { allow: ["read"], deny: ["shell"] },
        subagents: { helper: { name: "helper", profile: "test" } },
      },
      {
        runDir,
        home: root,
        cwd: root,
        resume: { entries: [] },
        hook: { argv: ["relay", "hook", "--run", "x"], command: "'relay' 'hook' '--run' 'x'" },
        skills: {
          root: join(runDir.path, "skills"),
          pathToSkill: new Map([["review", join(runDir.path, "skills/review/SKILL.md")]]),
          extra: [],
        },
      } as unknown as ConfigureContext,
    );
    const overlays = new Map(plan.overlays?.map((file) => [file.path, file.content]));
    const content = (key: string): string => {
      const value = overlays.get(key);
      assert(value !== undefined, `missing overlay ${key}`);
      return value;
    };
    expect(plan.args).toEqual(expect.arrayContaining(["--agent", "test", "--no-user-config"]));
    expect(overlays.get(".agents/agents/test.md")).toBe("---\ntools: [read]\n---\n\nreview\n");
    expect(overlays.get(".agents/rules/prism-deny.md")).toContain("shell");
    expect(overlays.get(".agents/agents/helper.md")).toContain("subagent: true");
    expect(JSON.parse(content(".agents/hooks.json"))).toEqual({
      PreToolUse: [{ type: "command", command: ["relay", "hook", "--run", "x"] }],
    });
    expect(overlays.get(".agents/skills/review/SKILL.md")).toBe("review notes");
    const manifest = JSON.parse(content(".agents/manifest.json"));
    expect(manifest.files).toEqual([...overlays.keys()].filter((path) => path !== ".agents/manifest.json"));
  } finally {
    await runDir.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace_config_local_account_refuses_hosted_before_spawn", async () => {
  const root = mkdtempSync(join(tmpdir(), "ws-policy-"));
  const cli = createScriptedCli({ dialect: workspaceConfigDialect, script: [] });
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  execFileSync("git", ["init", "--quiet", worktree]);
  try {
    await createProfiles({ root, driver: adapterDriver(workspaceConfig) }).create("test", { mode: "account", principal: "test" });
    const agent = await createAgent({
      packages: [
        processDriver(workspaceConfig),
        definePackage({
          name: "workspace-config-test-workspace",
          version: "1.0.0",
          requires: { api: 1 },
          setup(prism) {
            prism.services.provide("workspace", { worktree: { bound: () => ({ path: worktree }) } });
          },
        }),
      ],
      packageConfig: {
        [workspaceConfig.name]: {
          ...workspaceConfigFixtures.config(cli),
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
