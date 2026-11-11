import { join } from "node:path";
import {
  definePackage,
  type JsonObject,
  type ModelProvider,
  type PackageInstance,
  type ProviderEvent,
  type ProviderRequest,
} from "@arnilo/prism";
import { providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createMarkdownWikiStore, parseConceptBody } from "@arnilo/prism-knowledge/wiki";
import type { HostConfig } from "../host/config.js";
import { createResearchWorker } from "../host/research.js";
import { runTurn, textOf } from "./conversational-memory.js";

const FACTS = [
  "Payments retries use exponential backoff capped at three attempts.",
  "The payments service validates inputs with zod, not yup.",
  "Refunds in the payments service reuse the retry queue.",
] as const;

export interface OntologyMemoryResult {
  /** Concepts the config-selected wiki package wrote in its pass. */
  readonly concepts: number;
  /** The `wiki.search` output of the fourth session. */
  readonly recalled: string;
  /** The concept's claims after the pass, and after `memory.forget` removed one cited note. */
  readonly claims: readonly string[];
  readonly claimsAfterForget: readonly string[];
}

interface SearchHit {
  readonly id: string;
  readonly subject: string;
  readonly cited: readonly string[];
}

/**
 * Three sessions leave fact notes in memory; one `wiki:consolidate` writes a cited concept, in the wiki's own store, on
 * the config-selected `ontologyModel`; a fourth session's `wiki.search` returns the concept with the ids its claims
 * cite; `memory.forget` on a cited note removes its claim (the wiki reads the deletion feed). The models are scripted
 * in one inline provider (`mock/m` runs the turns, `mock/curator` the pass).
 */
export async function ontologyMemory(config: HostConfig): Promise<OntologyMemoryResult> {
  const script: ProviderEvent[][] = [];
  const curatorModels: string[] = [];
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request: ProviderRequest) {
      if (request.model.model === "curator") {
        curatorModels.push(request.model.model);
        const content = request.messages.at(-1)?.content as unknown;
        const text =
          typeof content === "string" ? content : (content as readonly { text?: string }[]).map((block) => block.text ?? "").join("");
        const { task, evidence } = JSON.parse(text) as { task: string; evidence: { id: string; kind: string; text: string }[] };
        const edits: JsonObject[] =
          task === "cluster"
            ? [{ op: "create_subject", subject: "payments", title: "Payments service", conceptType: "entity", aliases: [] }]
            : [];
        for (const note of evidence.filter((entry) => entry.kind === "fact")) {
          edits.push({ op: "add_claim", text: note.text, cites: [note.id] });
          if (task === "cluster") edits.push({ op: "bind", noteId: note.id, subject: "payments" });
        }
        yield providerToolCall(toolCallContent("curate-1", "edit_concept", { edits }));
        yield providerDone();
        return;
      }
      const step = script.shift();
      if (step === undefined) throw new Error("the scripted main model has no step left");
      yield* step;
    },
  };
  const wiring: readonly PackageInstance[] = [
    definePackage({
      name: "@prism-agent/ontology-scenario",
      version: "0.0.0",
      description: "The scenario's scripted provider.",
      requires: { api: 1 },
      setup(prism) {
        prism.providers.register(provider);
      },
    })(),
  ];
  const agent = await createResearchWorker(
    { ...config, memory: "conversational", ontology: true, ontologyModel: "mock/curator" },
    { packages: wiring },
  );
  // The wiki's own store on disk, read as a person would; `wiki:status` first lets the wiki catch up with memory.
  const claimsOf = async (): Promise<string[]> => {
    await agent.commands.run("wiki:status", {});
    const [concept] = await createMarkdownWikiStore({ root: join(config.workspace, ".prism", "wiki") }).concepts("project");
    return concept === undefined ? [] : parseConceptBody(concept.body, { allowUncited: true }).claims.map((claim) => claim.text);
  };
  try {
    for (const [index, text] of FACTS.entries()) {
      script.push(
        [
          providerToolCall(
            toolCallContent(`insert-${index}`, "memory.insert", { text, kind: "fact", scope: "project", keywords: ["payments"] }),
          ),
          providerDone(),
        ],
        [providerTextDelta("Noted."), providerDone()],
      );
      const session = await agent.session({ create: true });
      await runTurn(session, `${text} Remember that.`);
      await session.close();
    }
    const pass = (await agent.commands.run("wiki:consolidate", {})) as { subjects: number };
    const claims = await claimsOf();

    script.push(
      [providerToolCall(toolCallContent("search-1", "wiki.search", { query: "payments service retries" })), providerDone()],
      (() => [providerTextDelta("Retries use exponential backoff."), providerDone()])(),
    );
    const fourth = await agent.session({ create: true });
    const events = await runTurn(fourth, "What do we know about the payments service?");
    const recalled = events.find((event) => event.type === "tool.completed" && event.name === "wiki.search");
    if (recalled?.type !== "tool.completed") throw new Error("the scripted wiki.search did not run");
    const hits = (recalled.result.value as { concepts?: readonly SearchHit[] } | undefined)?.concepts ?? [];
    const cited = hits[0]?.cited[0];
    if (cited === undefined) throw new Error("the concept hit names no cited note");

    script.push(
      [providerToolCall(toolCallContent("forget-1", "memory.forget", { id: cited })), providerDone()],
      [providerTextDelta("Forgotten."), providerDone()],
    );
    await runTurn(fourth, "Forget that note.");
    await fourth.close();
    return { concepts: pass.subjects, recalled: textOf(recalled.result), claims, claimsAfterForget: await claimsOf() };
  } finally {
    await agent.dispose();
  }
}
