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
import memorySystem, { MEMORY_LTM_SERVICE, type MemoryLtmPort } from "@arnilo/prism-memory-system";
import { createMarkdownWikiStore, parseConceptBody, wiki } from "@arnilo/prism-knowledge/wiki";

/**
 * Memory and the wiki in one deterministic run (plan 216 Task 3; plan 207 Task 9 first wrote it as the three-tier
 * stack). Memory and knowledge are separate packages:
 *
 * - **`@arnilo/prism-memory-system`**: its session tiers watch the session and record observations; its long-term
 *   memory (`ltm`) holds typed notes and verbatim exchanges, the store of record, and offers the wiki one read-only
 *   port, `memory.ltm`, and nothing else.
 * - **`@arnilo/prism-knowledge/wiki`**: concepts, claims and subject bindings in its own markdown store under `wiki.root`; a
 *   background curator consolidates evidence into one concept per subject, every claim citing the notes it rests on.
 *
 * What the run shows:
 *
 * 1. Three sessions of scripted turns. The model writes one fact note per session with `memory.insert`, and the
 *    long-term memory archives each exchange.
 * 2. `wiki:consolidate` runs one concept pass. The curator creates the `payments` subject, binds the notes that
 *    belong to it and writes claims that each cite their LTM note ids. Memory gains no concept: the concept is a file
 *    in the wiki's store.
 * 3. A fourth session: a note written after the subject exists is bound by the wiki on its next pass (deterministic, no
 *    model call for the binding) and cited. `wiki.search` returns the concept with the ids each claim cites, and
 *    `wiki.read` drills down to a cited memory note.
 * 4. `memory.forget` on a cited note removes the claim that rested on it: the wiki reads memory's deletion feed, with no
 *    model call, so a forgotten fact cannot survive in the summary.
 *
 * The three models are scripted in one inline mock provider: `mock/main` runs the turns, `mock/observer` is the
 * observation worker, `mock/curator` is the concept pass. No credential, no network; the fixture text carries no
 * secret. Run: `bun examples/memory-and-wiki.ts`
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

interface SearchHit {
  readonly id: string;
  readonly subject: string;
  readonly cited: readonly string[];
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

/**
 * The observation worker: one `record_event` call, sourced from the first entry its prompt lists. It records the same
 * statement every pass, so habituation keeps one record and raises its count.
 */
function observe(request: ProviderRequest): ProviderEvent[] {
  const answered = request.messages.some((message) => message.role === "tool");
  const prompt = request.messages.find((message) => message.role === "user")?.content[0];
  const sourceId = prompt?.type === "text" ? /\[[^\]]+\] \[([^\]]+)\] (?:user|assistant|tool|system):/.exec(prompt.text)?.[1] : undefined;
  if (answered || !sourceId) return [providerDone()];
  return [
    providerToolCall(
      toolCallContent("observe-1", "record_event", {
        kind: "statement",
        description: "The user keeps stating durable facts about the payments service.",
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

const root = await mkdtemp(join(tmpdir(), "prism-memory-and-wiki-"));
const knowledgeRoot = join(root, "wiki");
let ltmPort: () => MemoryLtmPort | undefined = () => undefined;
const probe = definePackage({
  name: "@example/memory-and-wiki-probe",
  version: "0.0.0",
  description: "Lets the demo read memory's read-only port to print and assert what memory stored.",
  requires: { api: 1 },
  setup(prism) {
    ltmPort = () => prism.services.consume<MemoryLtmPort>(MEMORY_LTM_SERVICE);
  },
})();
const providerPackage = definePackage({
  name: "@example/memory-and-wiki-provider",
  version: "0.0.0",
  description: "The demo's scripted provider for the main, observer and curator models.",
  requires: { api: 1 },
  setup(prism) {
    prism.providers.register(provider);
  },
})();

try {
  const agent = await createAgent({
    id: "memory-and-wiki-demo",
    model: MAIN_MODEL,
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage,
      // One memory system. Session memory is inert until a session turns `memory:session` on; `triggerTokens: 1` makes the
      // first turn cross the threshold. Long-term memory (`ltm`) is the store of record; `exchanges: {}` archives every
      // completed turn verbatim.
      memorySystem({ stm: { model: "mock/observer", triggerTokens: 1 }, ltm: { tools: { root }, exchanges: {} } }),
      // The wiki: its own store under `root`. The concept pass runs on the curator model. `minNotes: 50` keeps the
      // automatic accumulation check quiet, so the only passes are the ones run with `wiki:consolidate`.
      wiki({ workspaceRoot: root, root: knowledgeRoot, consolidate: { model: "mock/curator", triggers: ["accumulation"], minNotes: 50 } }),
      probe,
    ],
  });
  const ltm = (): MemoryLtmPort => {
    const found = ltmPort();
    if (found === undefined) throw new Error("the memory.ltm service is not available");
    return found;
  };
  const kinds = async (): Promise<string[]> => (await ltm().scanMetadata("project", { limit: 500 })).notes.map((note) => note.kind);
  // The wiki's own store, read from disk as a person would. `wiki:status` first lets the wiki catch up with memory.
  const conceptClaims = async (): Promise<{ text: string; cites: readonly string[] }[]> => {
    await agent.commands.run("wiki:status", {});
    const [concept] = await createMarkdownWikiStore({ root: knowledgeRoot }).concepts("project");
    if (concept === undefined) return [];
    return parseConceptBody(concept.body, { allowUncited: true }).claims.map((claim) => ({ text: claim.text, cites: claim.cites }));
  };
  const exchangesArchived = async (count: number): Promise<void> => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if ((await kinds()).filter((kind) => kind === "exchange").length >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("the exchange archive did not write every turn");
  };

  // 1. Three sessions. T0 observes the first; every session leaves a fact note and an archived exchange.
  for (const [index, fact] of FACTS.entries()) {
    const session = await agent.session({ id: `session-${index + 1}`, create: true });
    if (index === 0) await agent.commands.run("memory:session", {}, { session });
    script.push(insertFact(`insert-${index + 1}`, fact.text, fact.keywords), say("Noted."));
    await turn(session, fact.prompt);
    await session.close();
    await exchangesArchived(index + 1);
  }
  const stored = await kinds();
  console.log(
    `after 3 sessions: ${stored.filter((kind) => kind === "fact").length} fact notes and ${stored.filter((kind) => kind === "exchange").length} exchanges in memory, no concept yet`,
  );
  assert.equal((await conceptClaims()).length, 0);

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
  assert.equal((await kinds()).includes("concept"), false, "memory holds no concept: the wiki keeps its own store");

  // 3. A fourth session. A note written after the subject exists is bound by the wiki's next pass and cited.
  const fourth = await agent.session({ id: "session-4", create: true });
  script.push(insertFact("insert-4", LATE_FACT, ["payments", "paging"]), say("Noted."));
  await turn(fourth, "A new payments fact: the on-call is paged after the third failed retry. Remember it.");
  await agent.commands.run("wiki:consolidate", {});
  const grown = await conceptClaims();
  console.log(`second pass: the late note bound and cited; ${grown.length} claims`);
  assert.equal(grown.length, FACTS.length + 1);
  assert.ok(grown.some((claim) => claim.text === LATE_FACT));

  script.push(
    [providerToolCall(toolCallContent("search-1", "wiki.search", { query: "payments service retries" })), providerDone()],
    (request) => {
      // The search result is structured: each concept names the note ids its shown claims cite.
      const concepts =
        (request.messages.at(-1)?.content as readonly { result?: { concepts?: readonly SearchHit[] } }[] | undefined)?.[0]?.result
          ?.concepts ?? [];
      const ids = (concepts[0]?.cited ?? []).slice(0, 2);
      return [providerToolCall(toolCallContent("read-1", "wiki.read", { ids })), providerDone()];
    },
    say("The payments service retries with exponential backoff."),
  );
  const events = await turn(fourth, "What do we know about the payments service retries?");
  const searched = textOf(events, "wiki.search");
  const firstLine = searched.split("\n")[0] ?? "";
  console.log(`wiki.search, first hit: ${firstLine.slice(0, 100)}`);
  assert.match(firstLine, /concept payments/, "the concept comes first");
  assert.match(searched, /drill down: wiki\.read/);
  const drilled = textOf(events, "wiki.read");
  console.log(`wiki.read of cited memory notes: ${drilled.slice(0, 160).replace(/\s+/g, " ")}`);
  assert.match(drilled, /payments/i, "the drill-down reached a cited memory note");
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
    `memory.forget: ${grown.length} claims -> ${after.length}; the backoff claim is ${after.some((claim) => claim.text.includes("backoff")) ? "still there" : "gone"}`,
  );
  assert.equal(after.length, grown.length - 1);
  assert.ok(!after.some((claim) => claim.text.includes("exponential backoff")));
  await fifth.close();

  const facts = (await kinds()).filter((kind) => kind === "fact").length;
  const status = (await agent.commands.run("memory:session:status", {}, { session: await agent.session({ id: "session-1" }) })) as {
    observations?: { recorded: number };
  };
  console.log(
    JSON.stringify({
      stored: {
        observations: status.observations?.recorded ?? 0,
        memoryFacts: facts,
        wikiConcepts: 1,
      },
      modelCalls: requests,
    }),
  );
  await agent.dispose();
} finally {
  await rm(root, { recursive: true, force: true });
}
