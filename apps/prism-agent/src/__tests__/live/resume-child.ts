/**
 * The journey's second process (plan 215 Task 32, scenario 3). It builds the same agent as the suite over
 * the same SQLite file, opens the suspended session by id, resumes it with the decisions it is given, and
 * prints one JSON line: the resumed run's events and what it spent against the remaining budget.
 * Provider selection and the key come from the inherited environment; the key is never an argument.
 */
import type { AgentEvent, Decision, ModelConfig } from "@arnilo/prism";
import { buildJourneyAgent, collect, JourneyBudget, type JourneyWorkspace, journeyProvider } from "./fixture.js";

export interface ResumeChildInput {
  readonly workspace: JourneyWorkspace;
  readonly model: ModelConfig;
  readonly sessionId: string;
  readonly decisions: readonly Decision[];
  readonly remaining: { readonly maxRequests: number; readonly maxInputTokens: number };
}

export interface ResumeChildOutput {
  readonly events: readonly AgentEvent[];
  readonly requests: number;
  readonly inputTokens: number;
  readonly tripped?: string;
  readonly error?: string;
}

async function main(input: ResumeChildInput): Promise<ResumeChildOutput> {
  const budget = new JourneyBudget(input.remaining.maxRequests, input.remaining.maxInputTokens);
  const agent = await buildJourneyAgent({
    provider: journeyProvider(process.env),
    model: input.model,
    workspace: input.workspace,
    budget,
    sqlite: true,
  });
  try {
    const session = await agent.session({ id: input.sessionId });
    const events = await collect(session.resume(input.decisions));
    return {
      events,
      requests: budget.requests,
      inputTokens: budget.inputTokens,
      ...(budget.tripped === undefined ? {} : { tripped: budget.tripped }),
    };
  } catch (error) {
    return {
      events: [],
      requests: budget.requests,
      inputTokens: budget.inputTokens,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  } finally {
    await agent.dispose();
  }
}

const raw = process.argv[2];
if (raw === undefined) process.exit(2);
process.stdout.write(`${JSON.stringify(await main(JSON.parse(raw) as ResumeChildInput))}\n`);
