import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandDefinition, JsonObject } from "@arnilo/prism";
import { MemoryValidationError } from "../../errors.js";
import { createMemoryFabric } from "../../fabric/index.js";
import { createHashEmbedder, createMemory } from "../../index.js";
import { createScopedMemoryPolicy, type ScopedMemoryPolicy } from "../policy.js";
import { probePrecisionAt3 } from "./precision-probe.js";
import { probeLocomoRecall } from "./recall-probe.js";

type SeedNote = { readonly id?: string; readonly content: string };
type AbTask = {
  readonly id: string;
  readonly query: string;
  readonly expected: string;
  readonly notes?: readonly SeedNote[];
};
type FakeProvider = (input: { readonly query: string; readonly context: string }) => { readonly text: string; readonly turns: number };

function defaultFake(input: { readonly query: string; readonly context: string }): { readonly text: string; readonly turns: number } {
  return { text: input.context.trim() || "unknown", turns: 1 };
}

function rate(flags: readonly boolean[]): number {
  return flags.length === 0 ? 0 : flags.filter(Boolean).length / flags.length;
}

async function bind(): Promise<{ fabric: ReturnType<typeof createMemoryFabric>; policy: ScopedMemoryPolicy }> {
  const scopeRoot = await mkdtemp(join(tmpdir(), "scoped-eval-"));
  const memory = createMemory({
    tenantId: "eval",
    resourceId: scopeRoot,
    threadId: "eval",
    embedder: createHashEmbedder({ dimensions: 32 }),
  });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  return { fabric, policy: createScopedMemoryPolicy({ memory, fabric, scopeRoot }) };
}

async function seed(fabric: ReturnType<typeof createMemoryFabric>, notes: readonly SeedNote[]): Promise<void> {
  for (const note of notes) {
    await fabric.remember({
      kind: "fact",
      content: note.content,
      ...(note.id === undefined ? {} : { id: note.id }),
      consent: { visible: true, source: "agent" },
    });
  }
}

async function runTask(task: AbTask, on: boolean, fake: FakeProvider): Promise<{ ok: boolean; turns: number }> {
  const { fabric, policy } = await bind();
  if (on) await seed(fabric, task.notes ?? []);
  const hits = on ? (await policy.recall(task.query)).hits : [];
  const out = fake({ query: task.query, context: hits.map((hit) => hit.content).join("\n") });
  const text = typeof out.text === "string" ? out.text : "";
  const turns = typeof out.turns === "number" && Number.isFinite(out.turns) ? out.turns : 1;
  return { ok: text.includes(task.expected), turns };
}

export async function runScopedMemoryEval(input: {
  readonly fixtures: {
    readonly ab?: { readonly helps?: readonly AbTask[]; readonly cannot?: readonly AbTask[] };
    readonly precision?: {
      readonly notes: readonly SeedNote[];
      readonly queries: readonly { readonly query: string; readonly relevantIds: readonly string[] }[];
      readonly floor?: number;
    };
    readonly locomo?: {
      readonly notes: readonly SeedNote[];
      readonly questions: readonly { readonly query: string; readonly expectedId: string }[];
    };
  };
  readonly fakeProvider?: FakeProvider;
}): Promise<{
  readonly winRate: { readonly off: number; readonly on: number };
  readonly precisionAt3: number;
  readonly precisionAlert: boolean;
  readonly health: Awaited<ReturnType<ScopedMemoryPolicy["health"]>>;
  readonly locomo: { readonly answered: number; readonly total: number; readonly failedClosed: number };
  readonly tasks: readonly {
    readonly id: string;
    readonly off: { readonly ok: boolean; readonly turns: number };
    readonly on: { readonly ok: boolean; readonly turns: number };
  }[];
}> {
  if (input === null || typeof input !== "object") throw new MemoryValidationError("fixtures");
  if ("memory" in input || "policy" in input || "fabric" in input || "vectorStore" in input) {
    throw new MemoryValidationError("runScopedMemoryEval is fixture-only");
  }
  const fixtures = input.fixtures;
  if (fixtures === null || typeof fixtures !== "object") throw new MemoryValidationError("fixtures");
  const fake = input.fakeProvider ?? defaultFake;
  if (typeof fake !== "function") throw new MemoryValidationError("fakeProvider");

  const tasks = [];
  const offFlags: boolean[] = [];
  const onFlags: boolean[] = [];
  for (const task of [...(fixtures.ab?.helps ?? []), ...(fixtures.ab?.cannot ?? [])]) {
    const off = await runTask(task, false, fake);
    const on = await runTask(task, true, fake);
    tasks.push({ id: task.id, off, on });
    offFlags.push(off.ok);
    onFlags.push(on.ok);
  }

  let precisionAt3 = 0;
  let precisionAlert = false;
  if (fixtures.precision) {
    const { fabric, policy } = await bind();
    await seed(fabric, fixtures.precision.notes);
    precisionAt3 = (await probePrecisionAt3(policy, fixtures.precision.queries)).precisionAt3;
    const floor = fixtures.precision.floor ?? 0.5;
    precisionAlert = precisionAt3 < floor;
  }

  let locomo = { answered: 0, total: 0, failedClosed: 0 };
  if (fixtures.locomo) {
    const { fabric, policy } = await bind();
    await seed(fabric, fixtures.locomo.notes);
    locomo = await probeLocomoRecall(
      policy,
      new Set(fixtures.locomo.notes.map((note) => note.id).filter((id): id is string => typeof id === "string")),
      fixtures.locomo.questions,
    );
  }

  const { policy } = await bind();
  return {
    winRate: { off: rate(offFlags), on: rate(onFlags) },
    precisionAt3,
    precisionAlert,
    health: await policy.health(),
    locomo,
    tasks,
  };
}

export function createScopedMemoryHealthCommand(options: { readonly policy: ScopedMemoryPolicy }): CommandDefinition {
  if (typeof options?.policy?.health !== "function") throw new MemoryValidationError("policy");
  return {
    name: "scoped-memory:health",
    description: "Show scoped memory health counts and rates.",
    parameters: { type: "object" } as JsonObject,
    async execute() {
      const value = await options.policy.health();
      const text = `Scoped memory: ${value.notes.candidate} candidate / ${value.notes.verified} verified / ${value.notes.archived} archived. conversion=${value.conversionRate} activation=${value.activationRate} duplication=${value.duplicationRate}.`;
      return { name: "scoped-memory:health", value, content: [{ type: "text", text }] };
    },
  };
}
