/**
 * Phase 15 Part B: a host extends a reference adapter instead of writing one from scratch.
 *
 * `extendAdapter` derives a new adapter from `examples/adapters/rpc-server.ts` at definition time:
 *  - `configure` wraps the base plan, appending one extra flag and one bound-worktree overlay;
 *  - `decode` turns the base's `agent.raw` frame for a `custom-file` notification into `agent.file`;
 *  - `descriptor.auth.modes` narrows the policy to the base's api-key modes, dropping the account mode.
 * The derived adapter runs through `processDriver` with `@arnilo/prism-tools/coding` (which owns the
 * `workspace` service and routes `edit` into the session's worktree) and `@arnilo/prism-extensions/approval` in
 * `ask` mode. The scripted binary is the rpc-server dialect: it calls the served `edit` twice, once
 * allowed and once declined by a scripted `HostUi`, then emits a `custom-file` frame the extension
 * decodes. The example prints the captured activity with its `origin`, both decisions, the worktree
 * diff with the overlay excluded, the materialized skill, the extra flag, and `agent.inspect()` notes
 * naming the base and the extension.
 * Imports only `@arnilo/prism`, `/driver-kit`, `/testing`, `@arnilo/prism-hosts/driver-process`,
 * `@arnilo/prism-tools/coding`, `@arnilo/prism-extensions/approval`, the reference adapter and its dialect, and
 * Node built-ins. No vendor name. Run: npm run build:core && bun examples/custom-adapter.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AgentEvent, createAgent, createMemorySessionStore, definePackage, type PackageInstance, type Skill } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { createScriptedCli, createScriptedHostUi, type ScriptedRecordEntry, type ScriptStep } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, extendAdapter, processDriver } from "@arnilo/prism-hosts/driver-process";
import approval from "@arnilo/prism-extensions/approval";
import toolsCoding, { type WorkspaceService } from "@arnilo/prism-tools/coding";
import { rpcServerDialect } from "./adapters/rpc-server.dialect.js";
import { rpcServer } from "./adapters/rpc-server.js";

type Agent = Awaited<ReturnType<typeof createAgent>>;

/** The overlay the extension writes into the bound worktree; it is excluded from the diff. */
const OVERLAY = ".rpc-server/extended.json";
/** A stable identity for git in the fixture, so no user-level configuration is read. */
const GIT_ENV = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };

/** What the extension reports back to the example. */
interface Evidence {
  readonly materializedSkills: string[];
}

/** The extension: an extra flag, an overlay, a decoder for the base's raw frame, and a narrowed policy. */
function extendRpcServer(evidence: Evidence): AgentAdapter {
  return extendAdapter(rpcServer, {
    name: "custom-adapter",
    revision: "2",
    configure: (base) => async (spec, ctx) => {
      const plan = await base(spec, ctx);
      if (ctx.skills) evidence.materializedSkills.push(...ctx.skills.pathToSkill.keys());
      return {
        ...plan,
        args: [...(plan.args ?? []), "--custom-flag"],
        overlays: [{ path: OVERLAY, content: JSON.stringify({ extended: true }) }],
      };
    },
    decode: (base) => (frame) => {
      const f = frame as { method?: unknown; params?: { type?: unknown; data?: unknown } };
      if (f?.method === "item/raw" && f.params?.type === "custom-file") {
        const data = (f.params.data ?? {}) as { path?: unknown; change?: unknown };
        return {
          ...base(frame),
          activity: [
            {
              kind: "file",
              path: String(data.path ?? ""),
              change: data.change === "created" || data.change === "deleted" || data.change === "moved" ? data.change : "modified",
              source: "agent",
            },
          ],
        };
      }
      return base(frame);
    },
    descriptor: { auth: { modes: rpcServer.descriptor.auth.modes.filter((mode) => mode.kind === "api-key") } },
  });
}

/** What the vendor's own loop asks the served tools to do, in order. */
const VENDOR_SCRIPT: readonly ScriptStep[] = [
  { mcp: { method: "tools/call", params: { name: "edit", arguments: { path: "a.txt", edits: [{ oldText: "one", newText: "edited" }] } } } },
  {
    mcp: { method: "tools/call", params: { name: "edit", arguments: { path: "a.txt", edits: [{ oldText: "edited", newText: "again" }] } } },
  },
  { out: { kind: "raw", vendor: "rpc-server", type: "custom-file", data: { path: "b.txt", change: "created" } } },
  { out: { kind: "message.delta", content: { type: "text", text: "Edited a.txt." } } },
];

const reviewNotes: Skill = { name: "review-notes", description: "Review before editing.", instructions: "Read the notes first." };

/** Reads the package's `workspace` service once the packages are set up, so the example can bind a worktree. */
function workspaceProbe(): { readonly package: PackageInstance; readonly service: () => WorkspaceService | undefined } {
  let service: WorkspaceService | undefined;
  const instance = definePackage({
    name: "custom-adapter-workspace-probe",
    version: "1.0.0",
    requires: { api: 1 },
    setup: ({ services }) => {
      service = services.consume<WorkspaceService>("workspace");
    },
  })();
  return { package: instance, service: () => service };
}

const eventName = (event: AgentEvent): string => (event.type === "package.event" ? event.name : event.type);

/** One MCP `tools/call` result the vendor recorded: the error flag and its text. */
type McpEntry = Extract<ScriptedRecordEntry, { readonly event: "mcp" }>;
function decisionOf(entry: McpEntry | undefined): { readonly isError: boolean; readonly text: string } {
  if (entry === undefined) return { isError: false, text: "" };
  if ("error" in entry) return { isError: true, text: JSON.stringify(entry.error) };
  const result = entry.result as { readonly isError?: boolean; readonly content?: readonly { readonly text?: string }[] } | undefined;
  return { isError: result?.isError === true, text: (result?.content ?? []).map((block) => block.text ?? "").join("") };
}

/** Runs one git command in the fixture repository, failing loudly. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", env: GIT_ENV });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

export async function demo(): Promise<Record<string, unknown>> {
  const base = mkdtempSync(join(tmpdir(), "ex-ca-"));
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main", "."]);
  git(repo, ["config", "user.name", "Prism Example"]);
  git(repo, ["config", "user.email", "example@prism.local"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "seed"]);

  const evidence: Evidence = { materializedSkills: [] };
  const extended = extendRpcServer(evidence);
  const cli = createScriptedCli({ dialect: rpcServerDialect, script: VENDOR_SCRIPT });
  const probe = workspaceProbe();
  const profilesRoot = join(base, "p");

  // The scripted terminal allows the first edit (confirm, then select `once`) and declines the second.
  let confirms = 0;
  const ui = createScriptedHostUi((request) => {
    if (request.kind === "select") return "once";
    if (request.kind === "confirm") {
      confirms += 1;
      return confirms === 1;
    }
    return { status: "unavailable" };
  });

  try {
    const profiles = createProfiles({ root: profilesRoot, driver: adapterDriver(extended), host: { ui: ui.ui }, binary: process.execPath });
    await profiles.create("custom", { mode: "key", principal: "u1" });

    const agent: Agent = await createAgent({
      id: "custom-adapter-demo",
      ownership: { tenantId: "example" },
      principal: { kind: "user", id: "u1" },
      packages: [
        processDriver(extended)({
          binary: cli.command[0] as string,
          args: cli.command.slice(1),
          name: "custom-agent",
          profile: "custom",
          profilesRoot,
          principal: "u1",
          systemPrompt: { replace: "You are the custom agent." },
          prismTools: ["edit"],
          skills: ["review-notes"],
        }),
        toolsCoding({ root: repo, workspace: { worktreeRoot: join(base, "w") } }),
        approval({ mode: "ask" }),
        probe.package,
      ],
      host: { ui: ui.ui },
      slots: { store: createMemorySessionStore() },
      skills: { add: [reviewNotes] },
    });

    const session = await agent.session();
    const workspace = probe.service();
    if (workspace === undefined) throw new Error("no workspace service: the coding package must provide one");
    const worktree = await workspace.worktree.create({ sessionId: session.id });

    const events: AgentEvent[] = [];
    // The driver writes the adapter's overlays into the worktree and removes them when the run ends, so
    // presence has to be sampled while the vendor runs.
    let overlayDuringRun = false;
    const pump = (async () => {
      for await (const event of session.subscribe()) {
        events.push(event);
        if (!overlayDuringRun) overlayDuringRun = existsSync(join(worktree.path, OVERLAY));
      }
    })();
    const result = await session.run("Edit a.txt, then report.");
    await session.close();
    await pump.catch(() => undefined);

    const { changes, truncated } = await workspace.diff(worktree.path);
    const worktreeFile = readFileSync(join(worktree.path, "a.txt"), "utf8").trim();
    const view = agent.inspect();
    const note = view.statusNotes.find((entry) => entry.package === extended.name);
    const inspection = (note === undefined ? {} : JSON.parse(note.message)) as {
      readonly adapter?: {
        readonly name: string;
        readonly revision: string;
        readonly extends?: { readonly name: string; readonly revision: string };
      };
    };
    await worktree.dispose({ force: true });
    await agent.dispose();

    const argv = cli.record().find((entry) => entry.event === "argv");
    const calls = cli.record().filter((entry): entry is McpEntry => entry.event === "mcp" && entry.method === "tools/call");
    const captured = [
      ...new Map(
        events
          .filter((event) => event.origin !== undefined)
          .map((event) => [
            `${eventName(event)}|${event.origin?.kind}|${event.origin?.depth}`,
            { name: eventName(event), kind: event.origin?.kind, depth: event.origin?.depth },
          ]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      status: result.status,
      adapter: {
        name: inspection.adapter?.name,
        revision: inspection.adapter?.revision,
        base: inspection.adapter?.extends?.name,
        baseRevision: inspection.adapter?.extends?.revision,
      },
      extraFlag: argv !== undefined && "argv" in argv ? argv.argv.includes("--custom-flag") : false,
      activity: captured,
      decisions: {
        allowed: decisionOf(calls[0]),
        declined: decisionOf(calls[1]),
        confirmRequests: ui.requestsOf("confirm").length,
        selectRequests: ui.requestsOf("select").length,
      },
      worktreeFile,
      diff: { changes: changes.map((change) => `${change.change} ${change.path}`), truncated },
      overlay: { path: OVERLAY, presentDuringRun: overlayDuringRun, excluded: !changes.some((change) => change.path === OVERLAY) },
      materializedSkills: [...new Set(evidence.materializedSkills)],
    };
  } finally {
    cli.dispose();
    rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await demo()));
}
