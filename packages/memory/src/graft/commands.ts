import type { CommandDefinition, JsonObject, SessionEntry } from "@arnilo/prism";

import { runGraftExit, runGraftJson } from "./cli.js";
import { persistGraftPatch, resolveLatestGraftState } from "./state.js";
import type { GraftFreshness, GraftMode } from "./types.js";
import type { ResolvedGraftCli } from "./upstream.js";

export interface GraftCommandContext {
  readonly cli: ResolvedGraftCli;
  readonly projectDir: string;
  readonly mode: GraftMode;
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
  readonly childEnv: Readonly<Record<string, string>>;
  /** Budget for structural `graft build` / `graft init` (default 120s − overhead). */
  readonly buildTimeoutMs: number;
  /** Budget for `graft build --deep` (LLM pass; default 600s − overhead). */
  readonly deepBuildTimeoutMs: number;
  /** Stdout cap for build/init children (default 2 MiB). */
  readonly buildMaxResultBytes: number;
  /** Host `graft init` configuration. Neither agents nor yes → the command refuses to spawn. */
  readonly init: { readonly agents: readonly string[]; readonly yes: boolean; readonly wireMcp: boolean };
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly appendEntry: (entry: SessionEntry, options?: { readonly expectedParentId?: string }) => Promise<void>;
  readonly emitStatus: (metadata: Readonly<Record<string, unknown>>) => Promise<void>;
}

type CommandArgs = JsonObject;
type CommandCtx = { readonly sessionId?: string };
type GraftCommandResult = {
  name: string;
  value?: unknown;
  content: [{ type: "text"; text: string }];
  error?: { message: string };
};

function commandText(args: CommandArgs): string {
  if (typeof args.text === "string") return args.text;
  if (typeof args.args === "string") return args.args;
  return "";
}

function flag(args: CommandArgs, name: string): boolean {
  return args[name] === true;
}

function runChild<T>(ctx: GraftCommandContext, argv: readonly string[]) {
  return runGraftJson<T>(ctx.cli, argv, {
    cwd: ctx.projectDir,
    timeoutMs: ctx.timeoutMs,
    maxResultBytes: ctx.maxResultBytes,
    env: ctx.childEnv,
  });
}

function runChildExit(ctx: GraftCommandContext, argv: readonly string[], timeoutMs: number) {
  return runGraftExit(ctx.cli, argv, {
    cwd: ctx.projectDir,
    timeoutMs,
    maxResultBytes: ctx.buildMaxResultBytes,
    env: ctx.childEnv,
  });
}

async function liveCheck(ctx: GraftCommandContext, sessionId?: string): Promise<{ ran: boolean; fresh?: boolean }> {
  const result = await runChild<{ missing?: number; stale?: number; fresh?: boolean; upToDate?: boolean }>(ctx, ["check", "--json"]);
  if (result.value === null) {
    await ctx.emitStatus({ event: "check", ok: false, reason: result.reason });
    return { ran: false };
  }
  const value = result.value;
  const freshness: GraftFreshness = {
    checkedAt: new Date().toISOString(),
    fresh:
      typeof value.upToDate === "boolean"
        ? value.upToDate
        : typeof value.fresh === "boolean"
          ? value.fresh
          : (value.missing ?? 0) + (value.stale ?? 0) === 0,
    missing: value.missing,
    stale: value.stale,
  };
  await persistGraftPatch({
    sessionId,
    patch: { lastCheck: freshness },
    getEntries: ctx.getEntries,
    appendEntry: ctx.appendEntry,
  });
  await ctx.emitStatus({ event: "check", ok: true, fresh: freshness.fresh });
  return { ran: true, fresh: freshness.fresh };
}

async function statusLines(ctx: GraftCommandContext): Promise<string[]> {
  const state = resolveLatestGraftState(await ctx.getEntries());
  const lastCheck = state?.lastCheck;
  const freshness = lastCheck
    ? `${lastCheck.fresh ? "fresh" : "stale"} at ${lastCheck.checkedAt} (missing ${lastCheck.missing ?? "?"}, stale ${lastCheck.stale ?? "?"})`
    : "freshness unknown (run graft check)";
  return [
    `graft • mode ${ctx.mode} • cli ${ctx.cli.kind}`,
    `project ${ctx.projectDir}`,
    `freshness ${freshness}`,
    `budgets: child timeout ${ctx.timeoutMs}ms • stdout cap ${ctx.maxResultBytes}B`,
  ];
}

async function handleStatus(name: string, ctx: GraftCommandContext, args: CommandArgs, context: CommandCtx): Promise<GraftCommandResult> {
  let lines = await statusLines(ctx);
  if (flag(args, "check")) {
    await liveCheck(ctx, context.sessionId);
    lines = await statusLines(ctx);
  }
  return { name, content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleBuild(name: string, ctx: GraftCommandContext, args: CommandArgs): Promise<GraftCommandResult> {
  const deep = flag(args, "deep");
  let argv = ["build"];
  let timeoutMs = ctx.buildTimeoutMs;
  if (deep) {
    // Graft's own LLM client needs the host-configured model; the key rides in the child env
    // (never argv — it would leak via ps/logs). Refuse to spawn unconfigured.
    const provider = ctx.childEnv.GRAFT_PROVIDER;
    const model = ctx.childEnv.GRAFT_MODEL;
    const apiKey = ctx.childEnv.GRAFT_API_KEY;
    if (!provider || !model || !apiKey) {
      const text =
        "graft build --deep requires the host to configure deepModel (or providerEnv GRAFT_PROVIDER / GRAFT_MODEL / GRAFT_API_KEY) on createGraftExtension; refusing to spawn without a configured model.";
      return { name, error: { message: text }, content: [{ type: "text", text }] };
    }
    argv = [
      "build",
      "--deep",
      "--provider",
      provider,
      "--model",
      model,
      ...(ctx.childEnv.GRAFT_BASE_URL ? ["--base-url", ctx.childEnv.GRAFT_BASE_URL] : []),
    ];
    timeoutMs = ctx.deepBuildTimeoutMs;
  }
  const result = await runChildExit(ctx, argv, timeoutMs);
  await ctx.emitStatus({ event: "build", ok: result.ok, ...(deep ? { deep } : {}) });
  const text = result.ok
    ? `graft graph rebuilt${deep ? " (deep)" : ""}.`
    : `graft build failed (${result.reason ?? `exit ${result.exitCode}`}).${result.detail ? `\n${result.detail}` : ""}`;
  return {
    name,
    value: { deep, stdout: result.stdout.slice(-2000) },
    content: [{ type: "text", text }],
    error: result.ok ? undefined : { message: text },
  };
}

async function handleInit(name: string, ctx: GraftCommandContext): Promise<GraftCommandResult> {
  if (ctx.init.agents.length === 0 && !ctx.init.yes) {
    const text =
      "graft init requires initAgents or initYes on createGraftExtension — the child has no TTY and upstream writes nothing without one.";
    return { name, error: { message: text }, content: [{ type: "text", text }] };
  }
  // Host-fixed argv: never write user-level state (--no-global); Prism provides its own
  // MCP/hook/statusline surfaces, so those stay off unless the host opts in.
  const argv = [
    "init",
    "--no-global",
    ...(ctx.init.wireMcp ? [] : ["--no-mcp"]),
    "--no-hooks",
    "--no-statusline",
    ...ctx.init.agents.flatMap((agent) => ["--agents", agent]),
    ...(ctx.init.yes ? ["--yes"] : []),
  ];
  const result = await runChildExit(ctx, argv, ctx.buildTimeoutMs);
  await ctx.emitStatus({ event: "init", ok: result.ok });
  const text = result.ok
    ? `graft init complete${ctx.init.agents.length ? ` (agents: ${ctx.init.agents.join(", ")})` : " (--yes)"}.`
    : `graft init failed (${result.reason ?? `exit ${result.exitCode}`}).${result.detail ? `\n${result.detail}` : ""}`;
  return {
    name,
    value: { agents: [...ctx.init.agents], yes: ctx.init.yes, stdout: result.stdout.slice(-2000) },
    content: [{ type: "text", text }],
    error: result.ok ? undefined : { message: text },
  };
}

async function handleCheck(name: string, ctx: GraftCommandContext, context: CommandCtx): Promise<GraftCommandResult> {
  const live = await liveCheck(ctx, context.sessionId);
  const text = live.ran ? `graft freshness: ${live.fresh ? "fresh" : "stale"}.` : "graft check failed.";
  return { name, value: live, content: [{ type: "text", text }], error: live.ran ? undefined : { message: text } };
}

async function handleViz(name: string, ctx: GraftCommandContext, args: CommandArgs): Promise<GraftCommandResult> {
  // viz opens a port/browser: auto-open requires explicit opt-in; default passes --no-open.
  const argv = ["viz", ...(flag(args, "open") ? [] : ["--no-open"])];
  if (typeof args.port === "number" && Number.isFinite(args.port)) argv.push("--port", String(Math.trunc(args.port)));
  if (typeof args.export === "string" && args.export.trim() !== "") argv.push("--export", args.export);
  const result = await runChild(ctx, argv);
  await ctx.emitStatus({ event: "viz", ok: result.ok });
  const text = result.ok
    ? `graft viz handled (${flag(args, "open") ? "browser allowed" : "no browser"}).`
    : `graft viz failed (${result.reason ?? "non-zero exit"}).`;
  return { name, value: result.value, content: [{ type: "text", text }], error: result.ok ? undefined : { message: text } };
}

export function createGraftCommands(ctx: GraftCommandContext): readonly CommandDefinition[] {
  const main: CommandDefinition = {
    name: "graft",
    description:
      "graft graph control. Subcommands: status [check:true], build [deep:true], check, viz [open/port/export], init. Empty reports status.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "status | build | check | viz" },
        deep: { type: "boolean" },
        check: { type: "boolean", description: "with status: live freshness check" },
        open: { type: "boolean", description: "viz only: allow browser auto-open (default off)" },
        port: { type: "number" },
        export: { type: "string" },
      },
    } as JsonObject,
    async execute(args, context) {
      const primary = commandText(args).trim().toLowerCase().split(/\s+/)[0] || "status";
      switch (primary) {
        case "status":
          return handleStatus("graft", ctx, args, context);
        case "build":
          return handleBuild("graft", ctx, args);
        case "check":
          return handleCheck("graft", ctx, context);
        case "viz":
          return handleViz("graft", ctx, args);
        case "init":
          return handleInit("graft", ctx);
        default:
          return {
            name: "graft",
            error: { message: `Unknown graft subcommand "${primary}". Use status, build, check, viz, or init.` },
            content: [{ type: "text", text: `Unknown graft subcommand "${primary}".` }],
          };
      }
    },
  };

  const alias = (name: string, description: string, execute: CommandDefinition["execute"]): CommandDefinition => ({
    name,
    description,
    parameters: main.parameters,
    execute,
  });

  return [
    main,
    alias("graft-build", "Run `graft build`. Pass deep:true for --deep (needs the host-configured deepModel).", (args, _context) =>
      handleBuild("graft-build", ctx, { ...args, text: "build" }).then((result) => ({ ...result, name: "graft-build" })),
    ),
    alias(
      "graft-init",
      "Run `graft init` non-interactively: always --no-global; host opts in via initAgents/initYes; --no-mcp/--no-hooks/--no-statusline by default.",
      () => handleInit("graft-init", ctx),
    ),
    alias(
      "graft-build-deep",
      "Run `graft build --deep` with the host-configured model (deepModel). Errors without one; the API key never appears on argv.",
      (args) => handleBuild("graft-build-deep", ctx, { ...args, deep: true }).then((result) => ({ ...result, name: "graft-build-deep" })),
    ),
    alias("graft-check", "Live graft freshness check.", (_args, context) => handleCheck("graft-check", ctx, context)),
    alias("graft-viz", "Serve the graft viewer (default --no-open). Pass open:true to allow the browser.", (args) =>
      handleViz("graft-viz", ctx, { ...args, text: "viz" }),
    ),
  ];
}
