import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { definePackage, type ToolDefinition } from "@arnilo/prism";
import { harness } from "./fixtures/harness.js";

test("process_driver_claims_loop_without_model_and_inspects_probe", async () => {
  const h = await harness();
  try {
    expect(JSON.stringify(h.agent.inspect().slots.loop)).toContain("test-process-driver");
    expect(h.inspection()).toMatchObject({
      adapter: { name: "test-process-driver", revision: "1" },
      binary: { version: "1.2.3" },
      capture: "mapped",
      deployment: "local",
      isolation: "strict",
    });
    expect((await h.session.run("go")).error).toBeUndefined();
  } finally {
    await h.close();
  }
});

test("vendor_options_validated_by_adapter_schema", async () => {
  await expect(
    harness({
      adapter: (a) => ({ ...a, vendor: { type: "object", properties: { mode: { type: "string" } }, additionalProperties: false } }),
      config: { vendor: { unknown: true } },
    }),
  ).rejects.toThrow("unknown");
});

test("missing_binary_is_status_note_and_driver_unavailable", async () => {
  const h = await harness({ config: { binary: "/does-not-exist" } });
  try {
    expect(JSON.stringify(h.agent.inspect().statusNotes)).toContain("binary not found");
    expect((await h.session.run("go")).error?.message).toContain("driver_unavailable");
  } finally {
    await h.close();
  }
});

test("unparsable_version_is_driver_unavailable", async () => {
  const h = await harness({ adapter: (a) => ({ ...a, binary: { ...a.binary, version: () => undefined } }) });
  try {
    expect((await h.session.run("go")).error?.message).toContain("driver_unavailable");
  } finally {
    await h.close();
  }
});

test("run_pipeline_materializes_files_overlays_and_env", async () => {
  let runPath = "";
  let cwd = "";
  let layoutRead = false;
  const workspace = definePackage({
    name: "test-workspace",
    version: "1.0.0",
    requires: { api: 1 },
    setup(api) {
      api.services.provide("workspace", { worktree: { bound: () => ({ path: cwd }) } });
    },
  });
  const h = await harness({
    packages: [workspace],
    agent: { skills: { add: [{ name: "review", instructions: "Review first" }] } },
    config: { skills: ["review"] },
    source: `import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).once('line', () => {
 const data = { argv: process.argv.slice(2), blocked: process.env.BLOCKED_TOKEN ?? null, home: process.env.NEUTRAL_HOME, contents: readFileSync(process.argv.at(-1),'utf8'), overlay: readFileSync('rules.md','utf8'), exclude: readFileSync('.git/info/exclude','utf8') };
 console.log(JSON.stringify({kind:'notice',level:'info',code:'record',message:JSON.stringify(data)}));
 console.log(JSON.stringify({type:'turn.done'}));
});`,
    adapter: (a) => ({
      ...a,
      configure: async (_, ctx) => {
        runPath = ctx.runDir.path;
        layoutRead = readFileSync(ctx.skills?.pathToSkill.get("review") ?? "", "utf8").includes("Review first");
        expect(ctx.hook.argv).toContain("relay");
        return {
          args: [join(runPath, "settings.json")],
          env: { BLOCKED_TOKEN: "must-drop" },
          files: [{ path: "settings.json", content: "settings" }],
          overlays: [{ path: "rules.md", content: "rules" }],
        };
      },
    }),
  });
  cwd = join(h.root, "worktree");
  mkdirSync(join(cwd, ".git/info"), { recursive: true });
  try {
    const result = await h.session.run("go");
    expect(result.error).toBeUndefined();
    expect(layoutRead).toBe(true);
    expect(existsSync(runPath)).toBe(false);
    expect(existsSync(join(cwd, "rules.md"))).toBe(false);
    expect(readFileSync(join(cwd, ".git/info/exclude"), "utf8")).not.toContain("rules.md");
    const events = JSON.stringify(h.events);
    expect(events).toContain("settings");
    expect(events).toContain('"blocked\\":null');
  } finally {
    await h.close();
  }
});

test("workspace_files_adapter_without_bound_worktree_is_worktree_required", async () => {
  const h = await harness({
    adapter: (a) => ({ ...a, descriptor: { ...a.descriptor, controls: { ...a.descriptor.controls, isolation: "workspace-files" } } }),
  });
  try {
    expect((await h.session.run("go")).error?.message).toContain("worktree_required");
  } finally {
    await h.close();
  }
});

for (const path of ["/tmp/escape", "../escape"])
  test(`adapter_file_path_rejected_${path}`, async () => {
    const h = await harness({ adapter: (a) => ({ ...a, configure: () => ({ files: [{ path, content: "bad" }] }) }) });
    try {
      expect((await h.session.run("go")).error?.message).toContain("profile_invalid");
    } finally {
      await h.close();
    }
  });

test("serve_tools_mounted_only_when_selected_and_secrets_absent", async () => {
  let mounted = false;
  const tool: ToolDefinition = {
    name: "lookup",
    description: "lookup",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ toolCallId: "test", name: "lookup", value: { ok: true } }),
  };
  const h = await harness({
    agent: { tools: { add: [tool] } },
    config: { prismTools: ["lookup"] },
    source: `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).once('line',()=>{
 console.log(JSON.stringify({kind:'notice',level:'info',code:'echo',message:process.env.PRISM_MCP_TOKEN}));
 console.error(process.env.PRISM_MCP_TOKEN); process.exit(1);
});`,
    adapter: (a) => ({
      ...a,
      configure: async (_, ctx) => {
        expect(ctx.endpoint?.transport).toBe("http");
        const descriptor = JSON.parse(readFileSync(join(ctx.runDir.path, "relay.json"), "utf8"));
        expect(descriptor).not.toHaveProperty("token");
        // The broker token is available only to the child, never to configure.
        mounted = true;
        return {};
      },
    }),
  });
  try {
    const result = await h.session.run("go");
    expect(mounted).toBe(true);
    expect(result.error?.message).toContain("[REDACTED]");
    expect(JSON.stringify(h.events)).toContain("[REDACTED]");
    expect(JSON.stringify([result, h.agent.inspect(), h.inspection()])).not.toMatch(/[a-f0-9]{64}/);
  } finally {
    await h.close();
  }
});

test("permission_tool_mounts_without_selected_tools", async () => {
  const h = await harness({
    script: [{ mcp: { method: "tools/list" } }, { out: { type: "turn.done" } }],
    adapter: (a) => ({
      ...a,
      permissionTool: "permission",
      configure: (_, ctx) => ({ args: ["--mcp-endpoint", JSON.stringify(ctx.endpoint)] }),
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    const calls = h.cli.record().filter((entry) => entry.event === "mcp");
    expect(JSON.stringify(calls)).toContain("permission");
  } finally {
    await h.close();
  }
});

test("no_mcp_endpoint_without_selected_tools", async () => {
  let configured = false;
  const h = await harness({
    adapter: (a) => ({
      ...a,
      configure: (_, ctx) => {
        expect(ctx.endpoint).toBeUndefined();
        configured = true;
        return {};
      },
    }),
  });
  try {
    expect((await h.session.run("go")).error).toBeUndefined();
    expect(configured).toBe(true);
  } finally {
    await h.close();
  }
});
