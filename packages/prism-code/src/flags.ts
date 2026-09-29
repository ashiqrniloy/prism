import type { PrismCodeConfig } from "./config.js";

export interface CliFlags {
  readonly prompt?: string;
  readonly mode?: "tui" | "print" | "json" | "acp";
  readonly config?: string;
  readonly session?: string;
  /** `--continue`: resume the most recent session for the current repository. */
  readonly continueRecent?: boolean;
  /** `--resume`: open the interactive session picker at startup (TUI only). */
  readonly resume?: boolean;
  /** `--trust-project-mcp`: trust servers declared by the project config for this run without prompting. */
  readonly trustProjectMcp?: boolean;
  readonly model?: string;
  readonly provider?: string;
  readonly noAgentsMd?: boolean;
  readonly noSystemMd?: boolean;
  readonly maxTurns?: number;
  readonly maxCost?: number;
  /** Headless approval override: `deny` refuses, `edits` allows in-repo edits, `all` allows everything but hard denies. */
  readonly approve?: "deny" | "edits" | "all";
  readonly help?: boolean;
  readonly version?: boolean;
  /** Machine-readable output for `prism-code doctor`. */
  readonly json?: boolean;
  readonly subcommand?: string;
  readonly positionals?: readonly string[];
}

export function parseFlags(argv: readonly string[]): CliFlags {
  let prompt: string | undefined;
  let mode: "tui" | "print" | "json" | "acp" | undefined;
  let config: string | undefined;
  let session: string | undefined;
  let continueRecent = false;
  let resume = false;
  let trustProjectMcp = false;
  let model: string | undefined;
  let provider: string | undefined;
  let maxTurns: number | undefined;
  let maxCost: number | undefined;
  let approve: "deny" | "edits" | "all" | undefined;
  let noAgentsMd = false;
  let noSystemMd = false;
  let help = false;
  let version = false;
  let json = false;
  let subcommand: string | undefined;
  const positionals: string[] = [];

  let i = 0;
  // Check if first argument is a subcommand (e.g., "acp", "doctor")
  if (argv.length > 0 && argv[0] && !argv[0].startsWith("-")) {
    const first = argv[0].toLowerCase();
    if (first === "acp") {
      subcommand = "acp";
      mode = "acp";
      i = 1;
    } else if (first === "doctor") {
      subcommand = "doctor";
      i = 1;
    }
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-v" || arg === "--version") {
      version = true;
    } else if (arg === "-p" || arg === "--prompt") {
      i++;
      if (i < argv.length) prompt = argv[i];
    } else if (arg.startsWith("-p=")) {
      prompt = arg.slice(3);
    } else if (arg.startsWith("--prompt=")) {
      prompt = arg.slice(9);
    } else if (arg === "-m" || arg === "--mode") {
      i++;
      if (i < argv.length) {
        const val = argv[i]?.toLowerCase();
        if (val === "tui" || val === "print" || val === "json" || val === "acp") {
          mode = val;
        }
      }
    } else if (arg.startsWith("--mode=")) {
      const val = arg.slice(7).toLowerCase();
      if (val === "tui" || val === "print" || val === "json" || val === "acp") {
        mode = val;
      }
    } else if (arg === "-c" || arg === "--config") {
      i++;
      if (i < argv.length) config = argv[i];
    } else if (arg.startsWith("--config=")) {
      config = arg.slice(9);
    } else if (arg === "--session") {
      i++;
      if (i < argv.length) session = argv[i];
    } else if (arg.startsWith("--session=")) {
      session = arg.slice(10);
    } else if (arg === "--continue") {
      continueRecent = true;
    } else if (arg === "--resume") {
      resume = true;
    } else if (arg === "--trust-project-mcp") {
      trustProjectMcp = true;
    } else if (arg === "--model") {
      i++;
      if (i < argv.length) model = argv[i];
    } else if (arg.startsWith("--model=")) {
      model = arg.slice(8);
    } else if (arg === "--provider") {
      i++;
      if (i < argv.length) provider = argv[i];
    } else if (arg.startsWith("--provider=")) {
      provider = arg.slice(11);
    } else if (arg === "--no-agents-md") {
      noAgentsMd = true;
    } else if (arg === "--no-system-md") {
      noSystemMd = true;
    } else if (arg === "--max-turns") {
      i++;
      const next = argv[i];
      if (next !== undefined) {
        const val = Number.parseInt(next, 10);
        if (Number.isSafeInteger(val) && val >= 1) maxTurns = val;
      }
    } else if (arg.startsWith("--max-turns=")) {
      const val = Number.parseInt(arg.slice(12), 10);
      if (Number.isSafeInteger(val) && val >= 1) maxTurns = val;
    } else if (arg === "--max-cost") {
      i++;
      const next = argv[i];
      if (next !== undefined) {
        const val = Number.parseFloat(next);
        if (Number.isFinite(val) && val >= 0) maxCost = val;
      }
    } else if (arg.startsWith("--max-cost=")) {
      const val = Number.parseFloat(arg.slice(11));
      if (Number.isFinite(val) && val >= 0) maxCost = val;
    } else if (arg === "--approve") {
      i++;
      const next = argv[i];
      if (next === "deny" || next === "edits" || next === "all") approve = next;
    } else if (arg.startsWith("--approve=")) {
      const val = arg.slice(10);
      if (val === "deny" || val === "edits" || val === "all") approve = val;
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  // If prompt was not passed with -p, but positionals exist and not in acp/doctor mode, first positional can be prompt
  if (!prompt && positionals.length > 0 && mode !== "acp" && subcommand !== "acp" && subcommand !== "doctor") {
    prompt = positionals[0];
  }

  return {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(continueRecent ? { continueRecent } : {}),
    ...(resume ? { resume } : {}),
    ...(trustProjectMcp ? { trustProjectMcp } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(maxCost !== undefined ? { maxCost } : {}),
    ...(approve !== undefined ? { approve } : {}),
    noAgentsMd,
    noSystemMd,
    help,
    version,
    ...(json ? { json } : {}),
    ...(subcommand !== undefined ? { subcommand } : {}),
    positionals,
  };
}

export function applyFlagOverlay(config: PrismCodeConfig, flags: CliFlags): PrismCodeConfig {
  let model = config.model;

  if (flags.model || flags.provider) {
    let resolvedProvider = flags.provider ?? model?.provider;
    let resolvedModel = model?.model ?? "default";

    if (flags.model) {
      if (flags.model.includes("/")) {
        const [p, m] = flags.model.split("/", 2);
        if (p) resolvedProvider = p;
        if (m) resolvedModel = m;
      } else if (flags.model.includes(":")) {
        const [p, m] = flags.model.split(":", 2);
        if (p) resolvedProvider = p;
        if (m) resolvedModel = m;
      } else {
        resolvedModel = flags.model;
      }
    }

    model = {
      ...(model ?? {}),
      provider: resolvedProvider ?? "openai",
      model: resolvedModel,
    };
  }

  let instructions = config.instructions;
  if (flags.noAgentsMd || flags.noSystemMd) {
    instructions = {
      ...(instructions ?? {}),
      ...(flags.noAgentsMd ? { agentsMd: false } : {}),
      ...(flags.noSystemMd ? { systemMd: false } : {}),
    };
  }

  let limits = config.limits;
  if (flags.maxTurns !== undefined || flags.maxCost !== undefined) {
    const existing = limits ?? {};
    let nextTurns = existing.maxTurns;
    if (flags.maxTurns !== undefined) {
      if (existing.maxTurns !== undefined && existing.maxTurns !== null && typeof existing.maxTurns === "number") {
        nextTurns = Math.min(existing.maxTurns, flags.maxTurns);
      } else {
        nextTurns = flags.maxTurns;
      }
    }
    let nextCost = existing.maxCost;
    if (flags.maxCost !== undefined) {
      if (existing.maxCost !== undefined) {
        if (typeof existing.maxCost === "number") {
          nextCost = { amount: Math.min(existing.maxCost, flags.maxCost), currency: "USD" };
        } else {
          nextCost = {
            amount: Math.min(existing.maxCost.amount, flags.maxCost),
            currency: existing.maxCost.currency ?? "USD",
          };
        }
      } else {
        nextCost = { amount: flags.maxCost, currency: "USD" };
      }
    }
    limits = {
      ...existing,
      ...(nextTurns !== undefined ? { maxTurns: nextTurns } : {}),
      ...(nextCost !== undefined ? { maxCost: nextCost } : {}),
    };
  }

  return {
    ...config,
    ...(model ? { model } : {}),
    ...(instructions ? { instructions } : {}),
    ...(limits ? { limits } : {}),
  };
}
