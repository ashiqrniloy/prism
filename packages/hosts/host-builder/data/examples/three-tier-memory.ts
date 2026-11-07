import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type JsonObject,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Session,
  toolCallContent,
} from "@arnilo/prism";
import { type FabricOntologyPort, MEMORY_FABRIC_SERVICE, memoryFabric, parseConceptBody } from "@arnilo/prism-memory-fabric";
import memoryObservational from "@arnilo/prism-memory-observational";
import memoryWiki from "@arnilo/prism-memory-wiki";

/**
 * The three-tier memory stack in one deterministic run (plan 207 Task 9). Three packages, one store:
 *
 * - **T0, `@arnilo/prism-memory-observational`**: watches the session and records observations.
 * - **T1, `@arnilo/prism-memory-fabric`**: typed notes and verbatim exchanges, the single store of record.
 * - **T2, `@arnilo/prism-memory-wiki`**: a background curator consolidates T1 into one concept per subject,
 *   every claim citing the notes it rests on. The wiki stores nothing of its own: concepts are fabric notes.
 *
 * What the run shows:
 *
 * 1. Three sessions of scripted turns. The model writes one fact note per session with `memory.insert`, and the
 *    fabric archives each exchange.
 * 2. `wiki:consolidate` runs one concept pass. The curator creates the `payments` subject, binds the notes that
 *    belong to it and writes claims that each cite their notes.
 * 3. A fourth session: a note written after the subject exists binds to it at write time (no model call), and
 *    `memory.recall` returns the concept first, then the plain notes. The cited note drills down with `memory.read`.
 * 4. `memory.forget` on a cited note removes the claim that rested on it (the fabric's deletion cascade, no model
 *    call), so a forgotten fact cannot survive in the summary.
 *
 * The three models are scripted in one inline mock provider: `mock/main` runs the turns, `mock/observer` is the
 * observation worker, `mock/curator` is the concept pass. No credential, no network; the fixture text carries no
 * secret. Run: `bun examples/three-tier-memory.ts`
 */

const MAIN_MODEL = { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } } as const;
const FACTS = [
  {
    prompt: "Payments retries use exponential backoff capped at three attempts. Remember that.",
    text: "Payments retries use exponential backoff capped at three attempts.",
    keywords: ["payments", "retries"],
  },
  {
    prompt: "The payments service validates inputs with zod, not yup. Remember that.",
    text: "The payments service validates inputs with zod, not yup.",
    keywords: ["payments", "validation"],
  },
  {
    prompt: "Refunds in the payments service reuse the retry queue. Remember that.",
    text: "Refunds in the payments service reuse the retry queue.",
    keywords: ["payments", "refunds"],
  },
] as const;
const LATE_FACT = "The payments service pages the on-call after the third failed retry.";

type Step = readonly ProviderEvent[] | ((request: ProviderRequest) => readonly ProviderEvent[]);

/** The fixed-order script of `mock/main`. Every turn the host runs consumes exactly the steps it queued. */
const script: Step[] = [];
const insertFact = (id: string, text: string, keywords: readonly string[]): Step => [
  providerToolCall(toolCallContent(id, "memory.insert", { text, kind: "fact", scope: "project", keywords: [...keywords] })),
  providerDone(),
];
const say = (text: string): Step => [providerTextDelta(text), providerDone()];

const lastUserJson = (request: ProviderRequest): { evidence: { id: string; kind: string; text: string }[]; task: string } => {
  const content = request.messages.at(-1)?.content as unknown;
  const text = typeof content === "string" ? content : (content as readonly { text?: string }[]).map((block) => block.text ?? "").join("");
  return JSON.parse(text);
};

interface RecallHit {
  readonly id: string;
  readonly kind: string;
  readonly sources?: readonly string[];
}

/** The concept pass: one `edit_concept` call, built only from what the evidence says. */
function curate(request: ProviderRequest): ProviderEvent[] {
  const { task, evidence } = lastUserJson(request);
  const facts = evidence.filter((note) => note.kind === "fact");
  const edits: JsonObject[] = [];
  if (task === "cluster") {
    edits.push({ op: "create_subject", subject: "payments", title: "Payments service", conceptType: "entity", aliases: ["billing"] });
  }
  for (const note of facts) {
    edits.push({ op: "add_claim", text: note.text, cites: [note.id] });
    if (task === "cluster") edits.push({ op: "bind", noteId: note.id, subject: "payments" });
  }
  return [providerToolCall(toolCallContent("curate-1", "edit_concept", { edits })), providerDone({ inputTokens: 40, outputTokens: 20 })];
}

/** The observation worker: one `record_observation` call, sourced from the first entry its prompt lists. */
function observe(request: ProviderRequest): ProviderEvent[] {
  const answered = request.messages.some((message) => message.role === "tool");
  const prompt = request.messages.find((message) => message.role === "user")?.content[0];
  const sourceId = prompt?.type === "text" ? /\[[^\]]+\] \[([^\]]+)\] message:/.exec(prompt.text)?.[1] : undefined;
  if (answered || !sourceId) return [providerDone()];
  return [
    providerToolCall(
      toolCallContent("observe-1", "record_observation", {
        content: "The user keeps stating durable facts about the payments service.",
        relevance: "high",
        sourceEntryIds: [sourceId],
      }),
    ),
    providerDone(),
  ];
}

const requests = { main: 0, curator: 0, observer: 0 };
const provider: ModelProvider = {
  id: "mock",
  async *generate(request) {
    const model = request.model.model as keyof typeof requests;
    requests[model] = (requests[model] ?? 0) + 1;
    if (model === "curator") return yield* curate(request);
    if (model === "observer") return yield* observe(request);
    const step = script.shift();
    if (step === undefined) throw new Error("the scripted main model has no step left");
    yield* typeof step === "function" ? step(request) : step;
  },
};

/** Runs one scripted turn and returns the tool results the model saw, by tool name. */
async function turn(session: Session, prompt: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const pump = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  await session.run(prompt);
  await pump;
  return events;
}

const textOf = (events: readonly AgentEvent[], tool: string): string => {
  const done = events.find((event) => event.type === "tool.completed" && event.name === tool);
  if (done?.type !== "tool.completed") throw new Error(`${tool} did not run`);
  return (done.result.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
};

const root = await mkdtemp(join(tmpdir(), "prism-three-tier-"));
let port: () => FabricOntologyPort | undefined = () => undefined;
const probe = definePackage({
  name: "@example/three-tier-probe",
  version: "0.0.0",
  description: "Lets the demo read the fabric's ontology port to print and assert what the stack stored.",
  requires: { api: 1 },
  setup(prism) {
    port = () => prism.services.consume<FabricOntologyPort>(MEMORY_FABRIC_SERVICE);
  },
})();
const providerPackage = definePackage({
  name: "@example/three-tier-provider",
  version: "0.0.0",
  description: "The demo's scripted provider for the main, observer and curator models.",
  requires: { api: 1 },
  setup(prism) {
    prism.providers.register(provider);
  },
})();

try {
  const agent = await createAgent({
    id: "three-tier-memory-demo",
    model: MAIN_MODEL,
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage,
      // T0: inert until a session turns `om` on. `messageTokens: 1` makes the first turn cross the threshold.
      memoryObservational({ observer: { model: "mock/observer", messageTokens: 1 } }),
      // T1: the store of record. `exchanges: {}` archives every completed turn verbatim; `tools.root` is where the
      // notes live and where the wiki would stage an ingested source.
      memoryFabric({ tools: { root }, exchanges: {} }),
      // T2: the concept pass runs on the curator model. `minNotes: 50` keeps the automatic accumulation check quiet,
      // so the demo's only passes are the ones it runs with `wiki:consolidate`, which ignores the threshold.
      memoryWiki({ workspaceRoot: root, consolidate: { model: "mock/curator", triggers: ["accumulation"], minNotes: 50 } }),
      probe,
    ],
  });
  const ontology = (): FabricOntologyPort => {
    const found = port();
    if (found === undefined) throw new Error("the memory.fabric service is not available");
    return found;
  };
  const conceptClaims = async (): Promise<{ text: string; cites: readonly string[] }[]> => {
    const [row] = await ontology().subjects("project");
    if (row === undefined) return [];
    const [concept] = await ontology().read("project", [row.conceptId]);
    return parseConceptBody(concept?.text ?? "", { allowUncited: true }).claims.map((claim) => ({ text: claim.text, cites: claim.cites }));
  };
  const exchangesArchived = async (count: number): Promise<void> => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const { notes } = await ontology().pending("project", { limit: 64 });
      if (notes.filter((note) => note.kind === "exchange").length >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("the exchange archive did not write every turn");
  };

  // 1. Three sessions. T0 observes the first; every session leaves a fact note and an archived exchange.
  for (const [index, fact] of FACTS.entries()) {
    const session = await agent.session({ id: `session-${index + 1}`, create: true });
    if (index === 0) await agent.commands.run("om", {}, { session });
    script.push(insertFact(`insert-${index + 1}`, fact.text, fact.keywords), say("Noted."));
    await turn(session, fact.prompt);
    await session.close();
    await exchangesArchived(index + 1);
  }
  const unbound = (await ontology().pending("project", { limit: 64, unbound: true })).notes;
  console.log(
    `after 3 sessions: ${unbound.filter((n) => n.kind === "fact").length} fact notes and ${unbound.filter((n) => n.kind === "exchange").length} exchanges, none bound to a subject`,
  );
  assert.equal((await ontology().subjects("project")).length, 0);

  // 2. One concept pass: a new subject, claims that each cite a note, and the notes bound to it.
  const pass = (await agent.commands.run("wiki:consolidate", {})) as { subjects: number; edits: number; binds: number; modelCalls: number };
  console.log(
    `wiki:consolidate: ${pass.subjects} concept written, ${pass.edits} edits, ${pass.binds} notes bound, ${pass.modelCalls} model calls`,
  );
  const claims = await conceptClaims();
  assert.equal(claims.length, FACTS.length);
  assert.ok(
    claims.every((claim) => claim.cites.length > 0),
    "every claim cites a note",
  );
  for (const claim of claims) console.log(`  claim: ${claim.text} <- ${claim.cites.join(", ")}`);

  // 3. A fourth session. A note written after the subject exists binds to it at write time, with no model call.
  const fourth = await agent.session({ id: "session-4", create: true });
  script.push(
    insertFact("insert-4", LATE_FACT, ["payments", "paging"]),
    say("Noted."),
    [providerToolCall(toolCallContent("recall-1", "memory.recall", { query: "payments service retries" })), providerDone()],
    (request) => {
      // The recall result is structured: the concept hit names the notes it cites, and the exchanges follow it.
      const hits =
        (request.messages.at(-1)?.content as readonly { result?: { hits?: readonly RecallHit[] } }[] | undefined)?.[0]?.result?.hits ?? [];
      const cited = hits.find((hit) => hit.kind === "concept")?.sources?.[0];
      const exchange = hits.find((hit) => hit.kind === "exchange")?.id;
      // Drill down twice: a note the concept cites, then a verbatim exchange the recall listed after it.
      const ids = [cited, exchange].filter((id): id is string => id !== undefined);
      return [providerToolCall(toolCallContent("read-1", "memory.read", { ids })), providerDone()];
    },
    say("The payments service retries with exponential backoff."),
  );
  await turn(fourth, "A new payments fact: the on-call is paged after the third failed retry. Remember it.");
  const dirty = await ontology().dirty("project");
  console.log(
    `session 4: the new note bound to the subject at write time; dirty: ${dirty.map((d) => `${d.subject} (${d.reasons.join(", ")})`).join("; ")}`,
  );
  assert.deepEqual(
    dirty.map((entry) => entry.subject),
    ["payments"],
  );

  const events = await turn(fourth, "What do we know about the payments service retries?");
  const recalled = textOf(events, "memory.recall");
  const firstLine = recalled.split("\n").find((line) => /^\[?[0-9a-f]{12}\]? /.test(line)) ?? "";
  console.log(`memory.recall, first hit: ${firstLine.slice(0, 100)}`);
  assert.match(firstLine, /concept payments/, "the concept is the first hit");
  assert.match(recalled, /drill down: memory\.read/);
  const drilled = textOf(events, "memory.read");
  console.log(`memory.read of a cited note and an exchange: ${drilled.slice(0, 160).replace(/\s+/g, " ")}`);
  assert.match(drilled, /Remember that\./, "the drill-down reached a verbatim exchange");
  await fourth.close();

  // 4. Forgetting a cited note removes the claim that rested on it.
  const [backoff] = claims.filter((claim) => claim.text.includes("exponential backoff"));
  assert.ok(backoff);
  const forgotten = backoff.cites[0] as string;
  const fifth = await agent.session({ id: "session-5", create: true });
  script.push([providerToolCall(toolCallContent("forget-1", "memory.forget", { id: forgotten })), providerDone()], say("Forgotten."));
  await turn(fifth, "Forget the retry backoff note.");
  const after = await conceptClaims();
  console.log(
    `memory.forget: ${claims.length} claims -> ${after.length}; the backoff claim is ${after.some((claim) => claim.text.includes("backoff")) ? "still there" : "gone"}`,
  );
  assert.equal(after.length, claims.length - 1);
  assert.ok(!after.some((claim) => claim.text.includes("exponential backoff")));
  await fifth.close();

  const stored = (await ontology().pending("project", { limit: 64 })).notes;
  const status = (await agent.commands.run("om:status", {}, { session: await agent.session({ id: "session-1" }) })) as {
    observations?: { recorded: number };
  };
  console.log(
    JSON.stringify({
      tiers: {
        t0Observations: status.observations?.recorded ?? 0,
        t1Facts: stored.filter((note) => note.kind === "fact").length,
        t2Concepts: 1,
      },
      modelCalls: requests,
    }),
  );
  await agent.dispose();
} finally {
  await rm(root, { recursive: true, force: true });
}
