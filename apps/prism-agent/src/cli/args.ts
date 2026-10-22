export type AgentName = "orchestrator" | "coding" | "research";

export type DecisionArg = { readonly approvalId: string; readonly outcome: "allow" | "deny" };

export type RunArgs = {
  readonly command: "run";
  readonly agent: AgentName;
  readonly config?: string;
  readonly session?: string;
  readonly prompt: string;
};

export type ResumeArgs = {
  readonly command: "resume";
  readonly agent?: AgentName;
  readonly config?: string;
  readonly session: string;
  readonly decisions: readonly DecisionArg[];
};

export type AcpArgs = {
  readonly command: "acp";
  readonly agent: AgentName;
  readonly config?: string;
};

export type ScheduleArgs = {
  readonly command: "schedule";
  readonly config?: string;
};

export type CliArgs = RunArgs | ResumeArgs | AcpArgs | ScheduleArgs;

export class UsageError extends Error {
  readonly exitCode = 2;
  constructor(message = "usage") {
    super(message);
    this.name = "UsageError";
  }
}

const AGENTS = new Set<AgentName>(["orchestrator", "coding", "research"]);

export function formatUsage(): string {
  return `prism-agent — reference host

Usage:
  prism-agent run [--agent orchestrator|coding|research] [--config <file>] [--session <id>] <prompt>
  prism-agent resume --session <id> [--config <file>] [--agent orchestrator|coding|research] [--decision <approvalId>=allow|deny]...
  prism-agent acp [--agent orchestrator|coding|research] [--config <file>]
  prism-agent schedule [--config <file>]

Exit codes: 0 completed, 1 run failed, 2 usage or config, 3 suspended, 4 research citations failed.
Precedence: 2 > 3 > 1 > 4 > 0.
`;
}

function agentName(value: string | undefined, fallback: AgentName | undefined): AgentName {
  const name = value ?? fallback;
  if (name === undefined || !AGENTS.has(name as AgentName)) throw new UsageError("unknown --agent");
  return name as AgentName;
}

function decision(value: string): DecisionArg {
  const eq = value.indexOf("=");
  const approvalId = eq === -1 ? "" : value.slice(0, eq);
  const outcome = eq === -1 ? "" : value.slice(eq + 1);
  if (approvalId.length === 0 || (outcome !== "allow" && outcome !== "deny")) throw new UsageError("bad --decision");
  return { approvalId, outcome };
}

/** Hand-written flag parser. One positional prompt for `run`. No CLI dependency. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const command = argv[0];
  if (command !== "run" && command !== "resume" && command !== "acp" && command !== "schedule") throw new UsageError();
  let agent: string | undefined;
  let config: string | undefined;
  let session: string | undefined;
  const decisions: DecisionArg[] = [];
  const positionals: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    const take = (flag: string): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`missing value for ${flag}`);
      i += 1;
      return value;
    };
    if (token === "--agent") agent = take(token);
    else if (token === "--config") config = take(token);
    else if (token === "--session") session = take(token);
    else if (token === "--decision") decisions.push(decision(take(token)));
    else if (token.startsWith("--")) throw new UsageError(`unknown flag ${token}`);
    else positionals.push(token);
  }
  if (command === "run") {
    if (positionals.length !== 1 || positionals[0]?.length === 0) throw new UsageError("run needs one prompt");
    return { command, agent: agentName(agent, "orchestrator"), config, session, prompt: positionals[0] };
  }
  if (positionals.length !== 0) throw new UsageError();
  if (command === "resume") {
    if (session === undefined || session.length === 0) throw new UsageError("resume needs --session");
    return { command, agent: agent === undefined ? undefined : agentName(agent, undefined), config, session, decisions };
  }
  if (command === "schedule") {
    if (agent !== undefined || session !== undefined || decisions.length > 0) throw new UsageError("schedule takes only --config");
    return { command, config };
  }
  return { command, agent: agentName(agent, "orchestrator"), config };
}
