import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";

import { runGraftJson } from "./cli.js";
import type { GraftMode } from "./types.js";
import type { ResolvedGraftCli } from "./upstream.js";

export interface GraftToolsContext {
  readonly cli: ResolvedGraftCli;
  readonly projectDir: string;
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
  readonly childEnv: Readonly<Record<string, string>>;
}

type ArgvBuild = (args: JsonObject) => string[];

interface GraftToolSpec {
  readonly name: string;
  readonly cliCommand: string;
  readonly description: string;
  readonly parameters: JsonObject;
  /** Build argv after the subcommand; throws a bounded message on invalid enum values. */
  readonly buildArgv: ArgvBuild;
}

function str(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function num(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(args: JsonObject, key: string): boolean {
  return args[key] === true;
}

function enumValue(args: JsonObject, key: string, allowed: readonly string[]): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

/** Single place where graft flag order/shape is normalized. */
const SPECS: readonly GraftToolSpec[] = [
  {
    name: "graft_ask",
    cliCommand: "ask",
    description:
      "Ask the graft context graph a natural-language question about architecture or behavior. Returns node titles with file:line locators — open the located files before editing. Read-only.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language question." },
        scope: { type: "string", description: "Optional subdirectory to restrict the question to." },
        count: { type: "number", description: "Max results (default 3)." },
        source: { type: "boolean", description: "Include short source excerpts." },
      },
      required: ["query"],
    } as JsonObject,
    buildArgv(args) {
      const query = str(args, "query");
      if (!query) throw new Error("query is required");
      const argv = [query];
      const scope = str(args, "scope");
      if (scope) argv.push("--in", scope);
      const count = num(args, "count");
      if (count !== undefined) argv.push("-n", String(Math.trunc(count)));
      if (bool(args, "source")) argv.push("--source");
      return argv;
    },
  },
  {
    name: "graft_grep",
    cliCommand: "grep",
    description:
      "Regex search over every indexed file, grouped by enclosing symbol and ranked by in-edge coupling. Prefer graft_ask for questions. Read-only.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression." },
        ignoreCase: { type: "boolean" },
        fixed: { type: "boolean", description: "Treat pattern as literal text." },
        scope: { type: "string", description: "Optional subdirectory restriction." },
      },
      required: ["pattern"],
    } as JsonObject,
    buildArgv(args) {
      const pattern = str(args, "pattern");
      if (!pattern) throw new Error("pattern is required");
      const argv = [pattern];
      if (bool(args, "ignoreCase")) argv.push("-i");
      if (bool(args, "fixed")) argv.push("--fixed");
      const scope = str(args, "scope");
      if (scope) argv.push("--in", scope);
      return argv;
    },
  },
  {
    name: "graft_callers",
    cliCommand: "callers",
    description: "List direct dependents/callees of a symbol in the graft graph. Read-only.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        direction: { type: "string", enum: ["in", "out"], description: "in = who uses it (default), out = what it uses." },
        depth: { type: "number" },
      },
      required: ["symbol"],
    } as JsonObject,
    buildArgv(args) {
      const symbol = str(args, "symbol");
      if (!symbol) throw new Error("symbol is required");
      const argv = [symbol];
      const direction = enumValue(args, "direction", ["in", "out"]);
      if (direction) argv.push("--direction", direction);
      const depth = num(args, "depth");
      if (depth !== undefined) argv.push("-d", String(Math.trunc(depth)));
      return argv;
    },
  },
  {
    name: "graft_skeleton",
    cliCommand: "skeleton",
    description: "File outline (symbols without full source) from the graft graph. Read-only.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative file path." } },
      required: ["path"],
    } as JsonObject,
    buildArgv(args) {
      const path = str(args, "path");
      if (!path) throw new Error("path is required");
      return [path];
    },
  },
  {
    name: "graft_map",
    cliCommand: "map",
    description: "Token-budgeted repo overview: directory clusters, local hubs, global hotspots by coupling. Read-only.",
    parameters: {
      type: "object",
      properties: { maxDirs: { type: "number", description: "Cap on directory clusters shown." } },
    } as JsonObject,
    buildArgv(args) {
      const argv: string[] = [];
      const maxDirs = num(args, "maxDirs");
      if (maxDirs !== undefined) argv.push("--max-dirs", String(Math.trunc(maxDirs)));
      return argv;
    },
  },
  {
    name: "graft_blast",
    cliCommand: "blast",
    description: "Blast radius of a file/symbol change: everything reachable via graph edges. Read-only.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path (or symbol path)." },
        base: { type: "string", description: "Git ref to diff against." },
        depth: { type: "number" },
      },
      required: ["path"],
    } as JsonObject,
    buildArgv(args) {
      const path = str(args, "path");
      if (!path) throw new Error("path is required");
      const argv = [path];
      const base = str(args, "base");
      if (base) argv.push("--base", base);
      const depth = num(args, "depth");
      if (depth !== undefined) argv.push("--depth", String(Math.trunc(depth)));
      // ponytail: blast stays --json only; markdown passthrough needs a raw-text
      // runner branch — add when an agent actually wants it.
      return argv;
    },
  },
];

const NOT_BUILT_PATTERN = /no graft graph|not built|graft build/i;

export function defineGraftTools(ctx: GraftToolsContext): readonly ToolDefinition[] {
  return SPECS.map((spec) => {
    const execute = async (args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> => {
      let argv: string[];
      try {
        argv = spec.buildArgv(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid arguments";
        return result(spec.name, context, { ok: false }, [{ type: "text", text: message }], message, "invalid_arguments");
      }
      const startedAt = Date.now();
      const outcome = await runGraftJson(ctx.cli, [spec.cliCommand, ...argv, ".", "--json"], {
        cwd: ctx.projectDir,
        timeoutMs: ctx.timeoutMs,
        maxResultBytes: ctx.maxResultBytes,
        env: ctx.childEnv,
        signal: context.signal,
      });
      const ms = Date.now() - startedAt;

      if (outcome.value === null) {
        if (outcome.reason === "parse-error" && outcome.detail && NOT_BUILT_PATTERN.test(outcome.detail)) {
          const hint = "The graft graph is missing or unbuilt. Remediation: run /graft build (or `graft build` in the repo root).";
          return result(spec.name, context, outcome, [{ type: "text", text: hint }], hint, "graft_not_built", ms);
        }
        const text = `graft ${spec.cliCommand} failed (${outcome.reason ?? "unknown"}).`;
        return result(spec.name, context, outcome, [{ type: "text", text }], text, outcome.reason ?? "cli_failed", ms);
      }

      const text = JSON.stringify(outcome.value).slice(0, Math.max(1024, Math.min(ctx.maxResultBytes, 262_144)));
      return {
        toolCallId: context.toolCallId,
        name: spec.name,
        content: [{ type: "text", text }],
        value: outcome.value,
        metadata: {
          graft: { command: spec.cliCommand, ms },
          source: "graft-graph",
          ok: true,
        },
      };
    };

    return {
      name: spec.name,
      kind: "search",
      description: spec.description,
      parameters: spec.parameters,
      effect: { kind: "none", idempotency: "none" },
      execute,
    } satisfies ToolDefinition;
  });
}

function result(
  name: string,
  context: ToolExecutionContext,
  outcome: { ok: boolean },
  content: ToolResult["content"],
  errorMessage: string | undefined,
  code: string | undefined,
  ms?: number,
): ToolResult {
  const cliCommand = name.replace(/^graft_/, "");
  return {
    toolCallId: context.toolCallId,
    name,
    content,
    error: errorMessage ? { name, message: errorMessage, code } : undefined,
    metadata: {
      graft: { command: cliCommand, ...(ms !== undefined ? { ms } : {}) },
      source: "graft-graph",
      ok: outcome.ok,
    },
  };
}

export function shouldRegisterPullTools(mode: GraftMode): boolean {
  return mode === "pull" || mode === "both";
}
