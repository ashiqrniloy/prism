/**
 * The two harnesses the parity runner compares: `prism` (the reference host's one-shot coding worker)
 * and `pi` (the reference coding agent, headless). Each entry only *plans* a run: it returns the command,
 * its argv, the environment, and the scratch files to prepare. The runner executes the plan, so the plan
 * can be asserted offline: no key in argv, every written path inside the run's scratch directory.
 */
import { join } from "node:path";

/** Env names a child may inherit. Everything else, including every other provider's key, is dropped. */
const INHERITED_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "SHELL", "BUN_INSTALL"];

/**
 * Provider cells. `proxyPrefix` is the path the proxy forwards under the upstream, `piExtension` the
 * pi extension package that supplies the provider (Task 21 notes).
 */
export const PROVIDERS = {
  commandcode: {
    keyEnv: "COMMAND_CODE_API_KEY",
    upstream: "https://api.commandcode.ai",
    prismBasePath: "/provider/v1",
    piProvider: "commandcode",
    piExtension: "pi-commandcode-provider",
    piExcludeTools: [],
  },
  "ollama-cloud": {
    keyEnv: "OLLAMA_API_KEY",
    upstream: "https://ollama.com",
    prismBasePath: "",
    piProvider: "ollama-cloud",
    piExtension: "pi-ollama-cloud",
    // pi-ollama-cloud adds two web tools; without this its prefix has six tools instead of the four every cell has.
    piExcludeTools: ["ollama_web_search", "ollama_web_fetch"],
  },
};

export function childEnv(base, keyEnv, extra = {}) {
  const env = {};
  for (const name of INHERITED_ENV) if (base[name] !== undefined) env[name] = base[name];
  // The key reaches the child through its environment only, never through argv or a file.
  if (keyEnv !== undefined && base[keyEnv] !== undefined) env[keyEnv] = base[keyEnv];
  return { ...env, ...extra };
}

/** The salted instruction both harnesses carry, so a prefix cached by an earlier run cannot score a first-request hit. */
export function saltLine(runId) {
  return `Parity run ${runId}. This line only identifies the run; ignore it.`;
}

function prismPlan(ctx) {
  const provider = PROVIDERS[ctx.provider];
  const config = join(ctx.scratch, "prism-agent.json");
  return {
    command: process.execPath,
    args: [join(ctx.repoRoot, "scripts/cache-parity/prism-driver.ts"), ctx.task],
    cwd: ctx.workdir,
    env: childEnv(ctx.env, provider.keyEnv, {
      PRISM_PARITY_PROVIDER: ctx.provider,
      PRISM_PARITY_BASE_URL: `${ctx.proxyUrl}${provider.prismBasePath}`,
      PRISM_PARITY_CONFIG: config,
      ...(ctx.route === undefined ? {} : { PRISM_PARITY_ROUTE: ctx.route }),
    }),
    prepare: [
      {
        op: "write",
        path: config,
        // Refs, paths and modes only. `approval: "auto"` is the unattended mode; no `memory`, so no experimental package.
        content: `${JSON.stringify(
          {
            models: { orchestrator: ctx.modelRef, coding: ctx.modelRef, research: ctx.modelRef },
            storePath: join(ctx.scratch, "prism", "sessions.db"),
            workspace: ctx.workdir,
            approval: "auto",
            web: { backend: "searxng", searxngOrigin: "http://127.0.0.1:9" },
          },
          null,
          2,
        )}\n`,
      },
      // The host loads AGENTS.md from the workspace into the system prompt; that is where the run's salt goes.
      { op: "write", path: join(ctx.workdir, "AGENTS.md"), content: `${saltLine(ctx.runId)}\n` },
    ],
  };
}

function piPlan(ctx) {
  const provider = PROVIDERS[ctx.provider];
  const agentDir = join(ctx.scratch, "pi-agent");
  const extensionSource = join(ctx.piHome, "npm", "node_modules", provider.piExtension);
  const prepare = [{ op: "write", path: join(agentDir, "settings.json"), content: "{}\n" }];
  let extensionDir = extensionSource;
  const env = { PI_CODING_AGENT_DIR: agentDir };
  if (ctx.provider === "commandcode") {
    // Documented override: the base URL and a scratch copy of the model catalog (no credentials in it).
    env.COMMANDCODE_API_BASE = `${ctx.proxyUrl}/provider/v1`;
    env.COMMANDCODE_MODELS_CACHE = join(agentDir, "commandcode-models.json");
    prepare.push({ op: "copyFile", from: join(ctx.piHome, "commandcode-models.json"), path: env.COMMANDCODE_MODELS_CACHE });
  } else {
    // pi-ollama-cloud hard-codes its base URL and ignores every override. A run-scoped copy with that one
    // constant changed is the only thing that routes it through the proxy; models, compat and request
    // building stay the extension's own. The evidence says so.
    extensionDir = join(ctx.scratch, "pi-extension", provider.piExtension);
    prepare.push(
      {
        op: "copyDir",
        from: extensionSource,
        path: extensionDir,
        replace: [['const CLOUD_BASE_URL = "https://ollama.com";', `const CLOUD_BASE_URL = "${ctx.proxyUrl}";`]],
        replaceIn: "models.ts",
      },
      { op: "symlink", target: join(ctx.piHome, "npm", "node_modules"), path: join(ctx.scratch, "pi-extension", "node_modules") },
    );
  }
  const args = [
    "-p",
    "--mode",
    "json",
    "--no-session",
    "--no-extensions",
    "-e",
    join(extensionDir, "index.ts"),
    "--no-mcp",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "--model",
    `${provider.piProvider}/${ctx.model}`,
    "--thinking",
    ctx.thinking,
    "--append-system-prompt",
    saltLine(ctx.runId),
    ...(provider.piExcludeTools.length === 0 ? [] : ["--exclude-tools", provider.piExcludeTools.join(",")]),
    ctx.task,
  ];
  return { command: ctx.piBinary ?? "pi", args, cwd: ctx.workdir, env: childEnv(ctx.env, provider.keyEnv, env), prepare };
}

export const HARNESSES = {
  prism: { id: "prism", plan: prismPlan },
  pi: { id: "pi", plan: piPlan },
};
