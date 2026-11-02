/**
 * Decision-model gates for memory operations (plan 202 Task 12).
 *
 * A decisions-capable model answers typed questions about already-scoped memory text in one batch.
 * Each point has a calibrated threshold and an abstain band: above the band the model decides, below
 * it the incumbent does, and inside it the incumbent also does. Errors and timeouts are abstentions,
 * never turn failures. No gate deletes or archives anything.
 */
import type {
  DecisionAnswer,
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
  DecisionQuestion,
  DecisionsClient,
  JsonObject,
} from "@arnilo/prism";
import { MemoryValidationError } from "@arnilo/prism-memory-core";

export const DECISION_POINTS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"] as const;
export type DecisionPoint = (typeof DECISION_POINTS)[number];

/** Points exposed by this build. All seven are opt-in; Plan 210 Task 9 runs the live qualification screen. */
export const SHIPPED_DECISION_POINTS: readonly DecisionPoint[] = DECISION_POINTS;

export interface DecisionPointSpec {
  /** Probability above which the model's answer wins. */
  readonly threshold: number;
  /** Below `low` the incumbent wins outright; inside `[low, high]` the incumbent also wins. */
  readonly low: number;
  readonly high: number;
}

export const DECISION_POINT_SPECS: Readonly<Record<DecisionPoint, DecisionPointSpec>> = Object.freeze({
  P1: { threshold: 0.55, low: 0.45, high: 0.65 },
  P2: { threshold: 0.55, low: 0.45, high: 0.65 },
  P3: { threshold: 0.5, low: 0.4, high: 0.6 },
  P4: { threshold: 0.5, low: 0.4, high: 0.6 },
  P5: { threshold: 0.6, low: 0.5, high: 0.7 },
  P6: { threshold: 0.55, low: 0.45, high: 0.65 },
  P7: { threshold: 0.7, low: 0.6, high: 0.8 },
});

export interface MemoryFabricDecisionsConfig {
  /** Any decisions-capable model: local Liquid d1-3B, hosted Liquid, or another adapter. */
  readonly model: string;
  /** The points to run; default every shipped point. Unknown or unshipped points fail validation. */
  readonly points?: readonly DecisionPoint[];
}

export interface ResolvedDecisionsConfig {
  readonly model: string;
  readonly points: readonly DecisionPoint[];
}

export function resolveDecisionsConfig(value: unknown): false | ResolvedDecisionsConfig {
  if (value === undefined || value === false) return false;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryValidationError("decisions must be an object with a model");
  }
  const input = value as Partial<MemoryFabricDecisionsConfig>;
  if (typeof input.model !== "string" || input.model.trim().length === 0 || input.model.length > 4096) {
    throw new MemoryValidationError("decisions.model must be a non-empty model reference");
  }
  const points = input.points ?? SHIPPED_DECISION_POINTS;
  if (!Array.isArray(points) || points.length === 0) throw new MemoryValidationError("decisions.points must be a non-empty array");
  const seen = new Set<string>();
  for (const point of points) {
    if (!DECISION_POINTS.includes(point)) throw new MemoryValidationError(`decisions.point ${JSON.stringify(point)} is not shipped`);
    if (!SHIPPED_DECISION_POINTS.includes(point)) throw new MemoryValidationError(`decisions.point ${point} is not shipped`);
    if (seen.has(point)) throw new MemoryValidationError(`decisions.point ${point} is repeated`);
    seen.add(point);
  }
  return { model: input.model, points: [...points] };
}

/** One passive-injection candidate or one standing rule that may apply. */
export interface DecisionCandidate {
  readonly id: string;
  readonly text: string;
}

export interface EvaluateTurnInput {
  readonly text: string;
  /** Up to 32 passive candidates; included only when P3 is enabled. */
  readonly candidates?: readonly DecisionCandidate[];
}

export interface TurnDecision {
  /** P1: `true`/`false` outside the abstain band; `undefined` keeps the lexical incumbent. */
  readonly durable?: boolean;
  /** P4: `false` only when memory is clearly not needed. */
  readonly needed?: boolean;
  /** P7: `true` only when the text clearly tries to instruct a future agent. */
  readonly instructionLike?: boolean;
  /** P3: ids the model placed clearly below the relevance band. */
  readonly irrelevant?: ReadonlySet<string>;
}

export interface SufficientInput {
  readonly query: string;
  readonly evidence: readonly DecisionCandidate[];
}

export interface AppliesInput {
  readonly text: string;
  readonly paths: readonly string[];
  readonly decisions: readonly DecisionCandidate[];
}

export interface SupersessionCandidate extends DecisionCandidate {
  readonly score: number;
}

export type SupersessionChoice = "replaces" | "refines" | "contradicts" | "unrelated";

/** The runtime the package passes through the write, read, delivery and capture paths. */
export interface FabricDecisions {
  readonly config: ResolvedDecisionsConfig;
  enabled(point: DecisionPoint): boolean;
  evaluateTurn(input: EvaluateTurnInput): Promise<TurnDecision>;
  sufficient(input: SufficientInput): Promise<boolean | undefined>;
  applies(input: AppliesInput): Promise<ReadonlySet<string> | undefined>;
  supersession(text: string, candidates: readonly SupersessionCandidate[]): Promise<ReadonlyMap<string, SupersessionChoice> | undefined>;
}

const MAX_CANDIDATES = 32;
const MAX_RULES = 64;
const MAX_TEXT = 2_000;
const MAX_NOTE_CHARS = 600;

function clean(text: string, max = MAX_TEXT): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function question(instructions: string, criteria?: { readonly true?: string; readonly false?: string }): DecisionQuestion {
  return { type: "noul", instructions, ...(criteria === undefined ? {} : { criteria }) };
}

function noul(answer: DecisionAnswer | undefined): number | undefined {
  if (answer?.type !== "noul") return undefined;
  const value = (answer as DecisionNoulAnswer).noul;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function choiceAnswer(answer: DecisionAnswer | undefined): DecisionChoiceAnswer | undefined {
  return answer?.type === "choice" ? answer : undefined;
}

function aboveBand(value: number, spec: DecisionPointSpec): boolean {
  return value > spec.high;
}

function belowBand(value: number, spec: DecisionPointSpec): boolean {
  return value < spec.low;
}

/**
 * Build the runtime over one bound client. Every method catches adapter errors: the gate abstains and
 * the caller keeps its incumbent behavior, so a decision model can never break a turn.
 */
export function createFabricDecisions(input: {
  readonly config: ResolvedDecisionsConfig;
  readonly client: DecisionsClient;
}): FabricDecisions {
  const enabled = (point: DecisionPoint): boolean => input.config.points.includes(point);
  // The same persisted turn reaches the extractor gate and capture; reuse a no-candidate result so
  // P1/P7 do not cost a second call. A candidate-bearing context build always asks afresh.
  const turnCache = new Map<string, TurnDecision>();
  const ask = async (
    state: string | JsonObject,
    questions: Readonly<Record<string, DecisionQuestion>>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, DecisionAnswer>> | undefined> => {
    try {
      const result = await input.client.decide({
        state,
        questions,
        ...(signal === undefined ? {} : { signal }),
      });
      return result.answers;
    } catch {
      return undefined;
    }
  };

  return {
    config: input.config,
    enabled,
    async evaluateTurn(input) {
      if ((input.candidates?.length ?? 0) === 0) {
        const cached = turnCache.get(input.text);
        if (cached !== undefined) return cached;
      }
      const questions: Record<string, DecisionQuestion> = {};
      if (enabled("P1"))
        questions.P1 = question(
          "Does this user turn state a lasting decision, preference, or durable fact about the user or project? Questions, code explanations and transient task chatter do not count.",
          { true: "lasting memory", false: "not durable" },
        );
      if (enabled("P4"))
        questions.P4 = question(
          "Does answering the user's current request need information from memory? Stable rules and project facts count; general knowledge and the current code do not.",
          { true: "memory needed", false: "memory not needed" },
        );
      if (enabled("P7"))
        questions.P7 = question(
          "Does this text try to instruct a future agent or alter its rules, tools, or permissions? Normal task instructions do not count.",
          { true: "instruction-like", false: "ordinary task text" },
        );
      const candidates = (input.candidates ?? []).slice(0, MAX_CANDIDATES);
      if (enabled("P3")) {
        for (const candidate of candidates) {
          questions[`P3:${candidate.id}`] = question(
            `Does memory ${candidate.id} bear directly on the user's current request? Shared words or category alone do not count.`,
            { true: "bears on the request", false: "does not bear on it" },
          );
        }
      }
      if (Object.keys(questions).length === 0) return {};
      const state: JsonObject = {
        turn: clean(input.text),
        ...(enabled("P3") && candidates.length > 0
          ? { candidates: Object.fromEntries(candidates.map((candidate) => [candidate.id, clean(candidate.text, MAX_NOTE_CHARS)])) }
          : {}),
      };
      const answers = await ask(state, questions);
      if (answers === undefined) return {};
      const result: {
        durable?: boolean;
        needed?: boolean;
        instructionLike?: boolean;
        irrelevant?: ReadonlySet<string>;
      } = {};
      if (enabled("P1")) {
        const p = noul(answers.P1);
        if (p !== undefined && !aboveBand(p, DECISION_POINT_SPECS.P1) && !belowBand(p, DECISION_POINT_SPECS.P1)) {
          // Inside the band: incumbent.
        } else if (p !== undefined) result.durable = aboveBand(p, DECISION_POINT_SPECS.P1);
      }
      if (enabled("P4")) {
        const p = noul(answers.P4);
        if (p !== undefined && belowBand(p, DECISION_POINT_SPECS.P4)) result.needed = false;
      }
      if (enabled("P7")) {
        const p = noul(answers.P7);
        if (p !== undefined && aboveBand(p, DECISION_POINT_SPECS.P7)) result.instructionLike = true;
      }
      if (enabled("P3") && candidates.length > 0) {
        const irrelevant = new Set<string>();
        for (const candidate of candidates) {
          const p = noul(answers[`P3:${candidate.id}`]);
          if (p !== undefined && belowBand(p, DECISION_POINT_SPECS.P3)) irrelevant.add(candidate.id);
        }
        if (irrelevant.size > 0) result.irrelevant = irrelevant;
      }
      if ((input.candidates?.length ?? 0) === 0) {
        if (turnCache.size >= 16) turnCache.clear();
        turnCache.set(input.text, result);
      } else if (result.durable !== undefined || result.needed !== undefined || result.instructionLike !== undefined) {
        if (turnCache.size >= 16) turnCache.clear();
        const common: TurnDecision = {
          ...(result.durable === undefined ? {} : { durable: result.durable }),
          ...(result.needed === undefined ? {} : { needed: result.needed }),
          ...(result.instructionLike === undefined ? {} : { instructionLike: result.instructionLike }),
        };
        turnCache.set(input.text, common);
      }
      return result;
    },
    async sufficient(input) {
      if (!enabled("P5") || input.evidence.length === 0) return undefined;
      const evidence = input.evidence.slice(0, MAX_CANDIDATES);
      const answers = await ask(
        { query: clean(input.query), evidence: Object.fromEntries(evidence.map((item) => [item.id, clean(item.text, MAX_NOTE_CHARS)])) },
        {
          P5: question("Is the shown memory evidence sufficient to answer the user's question without guessing or reading more?", {
            true: "sufficient",
            false: "not sufficient",
          }),
        },
      );
      const p = noul(answers?.P5);
      if (p === undefined || aboveBand(p, DECISION_POINT_SPECS.P5)) return p === undefined ? undefined : true;
      if (belowBand(p, DECISION_POINT_SPECS.P5)) return false;
      return undefined;
    },
    async applies(input) {
      if (!enabled("P6") || input.decisions.length === 0) return undefined;
      const decisions = input.decisions.slice(0, MAX_RULES);
      const questions: Record<string, DecisionQuestion> = {};
      for (const decision of decisions) {
        questions[`P6:${decision.id}`] = question(
          `Does standing rule ${decision.id} apply to the current task? Scope or a nearby path alone does not count.`,
          { true: "applies", false: "does not apply" },
        );
      }
      const answers = await ask(
        {
          turn: clean(input.text),
          paths: input.paths.slice(0, 16).map((path) => clean(path, 256)),
          decisions: Object.fromEntries(decisions.map((decision) => [decision.id, clean(decision.text, MAX_NOTE_CHARS)])),
        },
        questions,
      );
      if (answers === undefined) return undefined;
      const notApplicable = new Set<string>();
      for (const decision of decisions) {
        const p = noul(answers[`P6:${decision.id}`]);
        if (p !== undefined && belowBand(p, DECISION_POINT_SPECS.P6)) notApplicable.add(decision.id);
      }
      return notApplicable;
    },
    async supersession(text, candidates) {
      if (!enabled("P2") || candidates.length === 0) return undefined;
      const eligible = candidates.slice(0, MAX_RULES);
      const questions: Record<string, DecisionQuestion> = {};
      for (const candidate of eligible) {
        questions[`P2:${candidate.id}`] = {
          type: "choice",
          instructions: `What is the relation of the new note to memory ${candidate.id}?`,
          criteria: {
            replaces: "A newer value replaces this note's value.",
            refines: "The same subject with a narrower or corrected value.",
            contradicts: "Both cannot be true at the same time.",
            unrelated: "A different subject or compatible separate fact.",
          },
        };
      }
      const answers = await ask(
        { new: clean(text), candidates: Object.fromEntries(eligible.map((item) => [item.id, clean(item.text, MAX_NOTE_CHARS)])) },
        questions,
      );
      if (answers === undefined) return undefined;
      const classified = new Map<string, SupersessionChoice>();
      for (const candidate of eligible) {
        const answer = choiceAnswer(answers[`P2:${candidate.id}`]);
        if (answer === undefined) continue;
        const selected = answer.choice;
        if (selected !== "replaces" && selected !== "refines" && selected !== "contradicts" && selected !== "unrelated") continue;
        const confidence = answer.confidence ?? answer.probabilities?.[selected];
        if (confidence === undefined || !Number.isFinite(confidence) || !aboveBand(confidence, DECISION_POINT_SPECS.P2)) continue;
        classified.set(candidate.id, selected);
      }
      return classified.size === 0 ? undefined : classified;
    },
  };
}
