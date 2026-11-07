import type { CallToolResult, GetPromptResult, ReadResourceResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import manifest from "../package.json" with { type: "json" };
import { checkPackage } from "./check/conformance.js";
import { inspectHost } from "./check/inspect.js";
import { checkManifest } from "./check/manifest.js";
import { DEFAULT_CHECK_TIMEOUT_MS, MAX_CHECK_TIMEOUT_MS } from "./check/runner.js";
import { type CheckTargets, findTarget, resolveCheckTargets } from "./check/targets.js";
import { HostBuilderError } from "./errors.js";
import { type LoadHostBuilderIndexOptions, loadHostBuilderIndex } from "./indexes.js";
import { lookupApi } from "./lookup/api.js";
import { boundedJson, byteLength, MAX_RESULT_BYTES, truncateBytes, truncationMarker } from "./lookup/bound.js";
import { DocsIndex } from "./lookup/docs.js";
import { lookupError } from "./lookup/errors.js";
import { lookupExamples } from "./lookup/examples.js";
import { checkVersion } from "./version.js";

export interface HostBuilderMcpOptions extends LoadHostBuilderIndexOptions {
  /** The host project. Docs are read from `<root>/node_modules/@arnilo/` and the installed Prism version from the same place. */
  readonly root: string;
  /** Turns a version mismatch from a tool error into a `warning` field on every result. */
  readonly allowVersionMismatch?: boolean;
  /** `file#export` of async functions that return an `Agent`, for `prism_inspect_host`. Resolved under `root` at creation. */
  readonly entries?: readonly string[];
  /** `file#export` of package definitions or factories, for `prism_check_package`. Resolved under `root` at creation. */
  readonly packages?: readonly string[];
  /** Let `prism_check_manifest` import project-scope packages (what `prism verify --trust-project` does). */
  readonly trustProject?: boolean;
  /** Seconds a check may run before its child is killed (default 30, at most 120). */
  readonly checkTimeoutSeconds?: number;
  /** Names of environment variables the check child may see besides PATH, HOME, TMPDIR and PRISM_HOME. */
  readonly passEnv?: readonly string[];
}

const SKILL_PATH = "node_modules/@arnilo/prism-host-builder/skills/prism-host-builder/SKILL.md";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

const CHECK = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function failure(error: unknown): CallToolResult {
  if (error instanceof HostBuilderError) return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.message}` }] };
  throw error;
}

function prompt(body: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text: body } }] };
}

/**
 * The host-builder MCP server: four read-only lookup tools, the installed docs as resources, and three prompts.
 *
 * Tools check the project's installed `@arnilo/prism` version against the indexes before answering; a mismatch is
 * a tool error unless `allowVersionMismatch` is set. Resources are the pages installed under
 * `<root>/node_modules/@arnilo/`; a page whose real path leaves `node_modules` is refused. Nothing here writes,
 * runs host code, calls a model or opens the network. The exception is the three check tools
 * (`prism_inspect_host`, `prism_check_manifest`, `prism_check_package`): each runs the host's own code in a
 * bounded child process, only for targets the server was started with, never for a path a tool call supplies.
 */
export function createHostBuilderMcpServer(options: HostBuilderMcpOptions): McpServer {
  const { root } = options;
  const allowMismatch = options.allowVersionMismatch === true;
  const indexOptions: LoadHostBuilderIndexOptions = options.dataDir === undefined ? {} : { dataDir: options.dataDir };
  const docs = new DocsIndex(root);
  const targets: CheckTargets = resolveCheckTargets(root, options.entries, options.packages);
  const checkSettings = {
    root,
    timeoutMs: Math.min(options.checkTimeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_MS / 1000, MAX_CHECK_TIMEOUT_MS / 1000) * 1000,
    passEnv: options.passEnv ?? [],
  };
  const flagHelp = (flag: string) =>
    `No ${flag} target is configured. Restart the server with ${flag} <file>#<export> (for example: prism-host-builder mcp ${flag} src/agent.ts#createInspectionAgent); a check runs only code the user named at start.`;
  const server = new McpServer(
    { name: "prism-host-builder", version: manifest.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  /** Runs a lookup after the version check; adds the mismatch warning when one was allowed. */
  async function answer(run: () => Promise<object> | object): Promise<CallToolResult> {
    try {
      const api = await loadHostBuilderIndex("api", indexOptions);
      const { warning } = checkVersion(root, api.prismVersion, allowMismatch);
      const result = await run();
      return text(boundedJson(warning === undefined ? result : { warning, ...result }));
    } catch (error) {
      return failure(error);
    }
  }

  server.registerTool(
    "prism_api",
    {
      title: "Prism API lookup",
      description:
        "Look up a public Prism name. Pass `symbol` for an exact export name (case-sensitive), or `query` for words matched against names, signatures and summaries; `package` limits either to one package (for example @arnilo/prism-approval). Returns signature, package, import specifier, docs pages and examples. An unknown name returns the nearest names.",
      inputSchema: z.object({
        symbol: z.string().max(200).optional(),
        query: z.string().max(200).optional(),
        package: z.string().max(200).optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      answer(async () =>
        lookupApi(await loadHostBuilderIndex("api", indexOptions), {
          ...(args.symbol !== undefined ? { symbol: args.symbol } : {}),
          ...(args.query !== undefined ? { query: args.query } : {}),
          ...(args.package !== undefined ? { package: args.package } : {}),
        }),
      ),
  );

  server.registerTool(
    "prism_errors",
    {
      title: "Prism error code lookup",
      description:
        "Look up an error code (`ERR_PRISM_*` or a short code such as `model_required`): meaning, owning package, declaring file:line, related docs, and the fix the host-builder skill lists. An unknown code returns the nearest codes.",
      inputSchema: z.object({ code: z.string().min(1).max(200) }),
      annotations: READ_ONLY,
    },
    (args) => answer(async () => lookupError(await loadHostBuilderIndex("errors", indexOptions), args.code)),
  );

  server.registerTool(
    "prism_examples",
    {
      title: "Prism examples",
      description:
        "Find CI-tested examples by `query` (words) and/or `package` (an imported package), or pass `path` (for example examples/define-package.ts) to read one example's source. Only examples in the shipped index are served.",
      inputSchema: z.object({
        query: z.string().max(200).optional(),
        package: z.string().max(200).optional(),
        path: z.string().max(300).optional(),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      answer(async () =>
        lookupExamples(
          await loadHostBuilderIndex("examples", indexOptions),
          {
            ...(args.query !== undefined ? { query: args.query } : {}),
            ...(args.package !== undefined ? { package: args.package } : {}),
            ...(args.path !== undefined ? { path: args.path } : {}),
          },
          indexOptions,
        ),
      ),
  );

  server.registerTool(
    "prism_docs",
    {
      title: "Prism docs search",
      description:
        "Search the Prism docs pages and package READMEs installed in this project (node_modules/@arnilo). Returns heading-anchored excerpts with a prism-docs:// URI to read the whole page. Every word of the query must appear in a section.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      annotations: READ_ONLY,
    },
    (args) => answer(() => docs.search(args.query)),
  );

  server.registerTool(
    "prism_inspect_host",
    {
      title: "Inspect the host's agent",
      description:
        "Runs the configured inspection factory (`--entry`) in a child process, returns `agent.inspect()` (packages, tools, skills with requiresTools, hooks, slot owners, status notes) and disposes the agent. EXECUTES the host's own code, which can spawn processes and read the allowlisted environment; the factory should build the agent on the mock provider and run nothing. Pass `entry` as one of the configured names.",
      inputSchema: z.object({ entry: z.string().min(1).max(500) }),
      annotations: CHECK,
    },
    (args) =>
      answer(async () => {
        if (targets.entries.length === 0) return { configured: [], guidance: flagHelp("--entry") };
        const target = findTarget(root, targets.entries, args.entry);
        if (target === undefined)
          return {
            ok: false,
            error: { message: `"${args.entry}" is not a configured entry.` },
            configured: targets.entries.map((entry) => entry.name),
          };
        return { ...(await inspectHost(checkSettings, target)) };
      }),
  );

  server.registerTool(
    "prism_check_manifest",
    {
      title: "Check the Prism manifest",
      description:
        "Runs what `prism verify` does for this project: re-hashes every installed package and re-checks its config against its schema. A project-scope package is imported (so its code runs) only when the server was started with `--trust-project`; otherwise it gets the integrity check alone and `configChecked` is false. Takes no arguments.",
      inputSchema: z.object({}),
      annotations: CHECK,
    },
    () => answer(async () => ({ ...(await checkManifest(checkSettings, options.trustProject === true)) })),
  );

  server.registerTool(
    "prism_check_package",
    {
      title: "Check a package with packageConformance",
      description:
        "Runs `packageConformance` from the installed @arnilo/prism/testing on a configured package (`--package`) and returns each check's result. EXECUTES the package's code on a mock provider in a child process. Pass `package` as one of the configured names.",
      inputSchema: z.object({ package: z.string().min(1).max(500) }),
      annotations: CHECK,
    },
    (args) =>
      answer(async () => {
        if (targets.packages.length === 0) return { configured: [], guidance: flagHelp("--package") };
        const target = findTarget(root, targets.packages, args.package);
        if (target === undefined)
          return {
            ok: false,
            error: { message: `"${args.package}" is not a configured package.` },
            configured: targets.packages.map((entry) => entry.name),
          };
        return { ...(await checkPackage(checkSettings, target)) };
      }),
  );

  for (const page of docs.listPages()) {
    server.registerResource(
      `${page.package.replace(/^@arnilo\//, "")}/${page.path}`,
      page.uri,
      { title: page.display, mimeType: "text/markdown" },
      async (uri): Promise<ReadResourceResult> => {
        const read = docs.read(page.uri);
        if (read === undefined)
          throw new HostBuilderError("ERR_PRISM_HOST_BUILDER_INDEX", `${page.display} is not readable inside ${root}/node_modules.`);
        const cut = truncateBytes(read.text, MAX_RESULT_BYTES - 128);
        const body = cut.truncated ? `${cut.text}${truncationMarker(byteLength(read.text) - byteLength(cut.text))}` : cut.text;
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] };
      },
    );
  }

  server.registerPrompt(
    "build-host",
    {
      title: "Build a Prism host",
      description: "Build or extend a Prism host: load the skill, choose with the decision trees, build, verify.",
      argsSchema: z.object({ goal: z.string().max(2000).optional() }),
    },
    (args) =>
      prompt(
        [
          `Build a Prism host${args.goal ? ` for this goal: ${args.goal}` : ""}.`,
          `1. Read the host-builder skill at ${SKILL_PATH} and follow its workflow.`,
          "2. Choose the host library, store, slot owners, approval and provider with references/choosing.md. Confirm every name with prism_api before you import it.",
          "3. Start from a tested example (prism_examples) instead of writing from memory. Read the page it names (prism_docs).",
          "4. Verify with references/verification.md: typecheck, the mock provider and agent.inspect(). Report what ran and what you could not run.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "add-capability",
    {
      title: "Add a capability to a Prism host",
      description: "Add one capability (a tool, hook, package, provider, store or server) to an existing Prism host.",
      argsSchema: z.object({ capability: z.string().min(1).max(500) }),
    },
    (args) =>
      prompt(
        [
          `Add this capability to the Prism host in this project: ${args.capability}.`,
          `1. Read the host-builder skill at ${SKILL_PATH} and the matching entry in references/recipes.md.`,
          "2. Place it with references/layout.md (kernel, package or host code) and check the public surface rule.",
          "3. Look up each name with prism_api and each error you meet with prism_errors. Copy the tested example, then change the model to the host's.",
          "4. Keep fail-closed behavior and secret refs intact (references/security.md). Verify with references/verification.md.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "upgrade-host",
    {
      title: "Upgrade a Prism host",
      description: "Move a Prism host to the installed version: read the version, the migration notes and check for retired names.",
    },
    () =>
      prompt(
        [
          "Upgrade the Prism host in this project to the installed @arnilo/prism version.",
          `1. Read the installed version in node_modules/@arnilo/prism/package.json, then the host-builder skill at ${SKILL_PATH} and references/upgrading.md.`,
          '2. Read the installed migration page (prism_docs with query "migrate") and apply each retired-name row to the host\'s code.',
          "3. Search the host's code for every retired name in the table. A hit is a change to make, not a name to alias.",
          "4. Typecheck, load the agent on the mock provider and read agent.inspect() (references/verification.md). Report what you changed and what you could not check.",
        ].join("\n"),
      ),
  );

  return server;
}
