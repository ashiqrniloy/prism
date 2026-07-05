import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createMockProvider,
  createProviderResolver,
  createSecretRedactor,
  createSkillRegistry,
  createToolRegistry,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type AgentEvent,
  type AIProvider,
  type ArtifactParser,
  type ArtifactRepairer,
  type ArtifactValidator,
  type ContextProvider,
  type Skill,
  type ToolDefinition,
  type ToolResult,
} from "@arnilo/prism";
import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

// Phase 32 — Synapta-facing integration example and boundary lock.
//
// This demo proves that a third party can use Prism with its own providers,
// tools, and skills plus optional first-party ones, opt a run into the
// generate-validate-revise loop with its own schema validator, observe
// artifact/refinement events, and keep all Synapta/domain types out of Prism.
// No network, no real credentials — everything runs against the mock provider.

// Host-owned schema (Synapta's own type). Prism never imports it.
interface ReleaseNote {
  readonly title: string;
  readonly body: string;
}

const FAKE_SECRET = "FAKE_SECRET_PHASE32TOKEN";

const parser: ArtifactParser<unknown> = (text) => {
  try {
    const value = JSON.parse(text) as ReleaseNote;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse failed" };
  }
};

const validator: ArtifactValidator<unknown> = (value) => {
  const note = value as ReleaseNote;
  const errors: { readonly path?: string; readonly message: string }[] = [];
  if (!note.title) errors.push({ path: "title", message: "missing title" });
  if (!note.body) errors.push({ path: "body", message: "missing body" });
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

const repairer: ArtifactRepairer<unknown> = (_value, failure) => ({
  role: "user",
  content: [
    {
      type: "text",
      text: `Fix these issues: ${failure.errors?.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ")}`,
    },
  ],
});

const firstPartyEcho: ToolDefinition = {
  name: "first-party/echo",
  description: "First-party echo tool (simulated package contribution)",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute(args, ctx): ToolResult {
    return { toolCallId: ctx.toolCallId, name: "first-party/echo", value: (args as { text: string }).text };
  },
};

const thirdPartyFetchSchema: ToolDefinition = {
  name: "acme/fetch-schema",
  description: "Third-party schema fetcher (host-owned tool)",
  parameters: { type: "object", properties: {} },
  execute(_args, ctx): ToolResult {
    return {
      toolCallId: ctx.toolCallId,
      name: "acme/fetch-schema",
      value: "schema: title and body strings",
    };
  },
};

const schemaContextProvider: ContextProvider = {
  name: "acme/schema-context",
  resolve() {
    return [
      {
        id: "schema-ctx",
        title: "Release note schema",
        content: "Release notes are JSON objects with title and body strings.",
      },
    ];
  },
};

const schemaSkill: Skill = {
  name: "schema-skill",
  description: "Activates schema context and the schema tool",
  instructions: "Use the release-note schema. Do not claim sandboxing.",
  context: [schemaContextProvider],
  toolNames: ["acme/fetch-schema"],
};

async function collectEvents(subscription: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of subscription) events.push(event);
  return events;
}

async function setupTempPromptFiles(): Promise<{
  workspace: string;
  global: string;
  layers: Awaited<ReturnType<typeof loadSystemPromptFiles>>;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "prism-synapta-ws-"));
  const global = await mkdtemp(join(tmpdir(), "prism-synapta-global-"));
  await mkdir(join(global, ".prism", "agent"), { recursive: true });
  // Include a fake secret in SYSTEM.md so the redactor has something to scrub.
  await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), `Global rule: prefer concise JSON. Secret: ${FAKE_SECRET}`);
  await writeFile(join(workspace, "AGENTS.md"), "Project rule: always output valid JSON release notes.");

  const trust = createPathTrustPolicy({ trustedRoots: [workspace] });
  const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, globalRoot: global, trust });
  return { workspace, global, layers };
}

async function runToolDispatchDemo(
  tools: ReturnType<typeof createToolRegistry>,
  skills: ReturnType<typeof createSkillRegistry>,
  layers: Awaited<ReturnType<typeof loadSystemPromptFiles>>,
): Promise<{ toolResults: string[]; redacted: boolean }> {
  // Single-shot loop (default) demonstrates tool dispatch with the registered
  // first-party and third-party tools. The generate-validate-revise loop does
  // not dispatch tools, so tool dispatch is shown in its own run.
  const captured: string[] = [];
  const firstPartyToolProvider = createMockProvider(
    [
      providerToolCall({ type: "tool_call", id: "tc_1", name: "first-party/echo", arguments: { text: "hello" } }),
      providerToolCall({ type: "tool_call", id: "tc_2", name: "acme/fetch-schema", arguments: {} }),
      providerTextDelta("Done."),
      providerDone(),
    ],
    {
      id: "first-party/mock",
      onRequest: (request) => {
        const systemText = request.messages
          .flatMap((m) => m.content)
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");
        captured.push(systemText);
      },
    },
  );

  const agent = createAgent({
    model: { provider: "first-party/mock", model: "demo" },
    providerSource: createProviderResolver([firstPartyToolProvider]),
    instructions: "You are a helpful assistant.",
    systemPrompt: layers,
    tools,
    skills,
    redactor: createSecretRedactor([FAKE_SECRET]),
  });

  const session = agent.createSession({ id: "tool-session" });
  const reader = collectEvents(session.subscribe());
  await session.run("Call the tools.", { activeSkills: ["schema-skill"] });
  const events = await reader;

  const toolResults = events
    .filter((e) => e.type === "tool_execution_finished")
    .map((e) => String(e.result.value ?? ""));

  const redacted = captured.some((text) => text.includes("[REDACTED]") && !text.includes(FAKE_SECRET));
  return { toolResults, redacted };
}

async function runArtifactLoopDemo(
  tools: ReturnType<typeof createToolRegistry>,
  skills: ReturnType<typeof createSkillRegistry>,
  layers: Awaited<ReturnType<typeof loadSystemPromptFiles>>,
): Promise<{ artifactSequence: string[]; finishedOk: boolean }> {
  // Custom third-party provider that returns invalid JSON on the first turn,
  // then valid JSON once the repairer asks for a fix.
  const artifactProvider: AIProvider = {
    id: "third-party/mock",
    async *generate(request) {
      const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
      const text = lastUser?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
      const isRevision = text.toLowerCase().includes("fix");
      if (isRevision) {
        yield providerTextDelta(JSON.stringify({ title: "Release 1.0", body: "First stable release." }));
      } else {
        yield providerTextDelta(JSON.stringify({ title: "" }));
      }
      yield providerDone();
    },
  };

  const agent = createAgent({
    model: { provider: "third-party/mock", model: "demo" },
    providerSource: createProviderResolver([artifactProvider]),
    instructions: "You are a helpful assistant.",
    systemPrompt: layers,
    tools,
    skills,
    redactor: createSecretRedactor([FAKE_SECRET]),
  });

  const session = agent.createSession({ id: "artifact-session" });
  const reader = collectEvents(session.subscribe());
  await session.run("Write a release note as JSON.", {
    activeSkills: ["schema-skill"],
    loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
  });
  const events = await reader;

  const artifactSequence = events
    .filter((e) =>
      [
        "artifact_validation_started",
        "artifact_validation_finished",
        "artifact_revision_started",
        "artifact_finished",
        "artifact_failed",
      ].includes(e.type),
    )
    .map((e) => e.type);

  const finished = events.find((e) => e.type === "artifact_finished");
  const finishedOk = finished?.type === "artifact_finished" && finished.result.ok === true;

  return { artifactSequence, finishedOk };
}

export async function demo(): Promise<{
  toolResults: string[];
  redacted: boolean;
  artifactSequence: string[];
  finishedOk: boolean;
}> {
  const { layers } = await setupTempPromptFiles();
  const tools = createToolRegistry([firstPartyEcho, thirdPartyFetchSchema]);
  const skills = createSkillRegistry([schemaSkill]);

  const { toolResults, redacted } = await runToolDispatchDemo(tools, skills, layers);
  const { artifactSequence, finishedOk } = await runArtifactLoopDemo(tools, skills, layers);

  return { toolResults, redacted, artifactSequence, finishedOk };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));

  // Fail fast if the demo does not behave as expected.
  if (!result.redacted) throw new Error("expected fake secret to be redacted");
  if (!result.finishedOk) throw new Error("expected artifact_finished with ok === true");
  const expected = [
    "artifact_validation_started",
    "artifact_validation_finished",
    "artifact_revision_started",
    "artifact_validation_started",
    "artifact_validation_finished",
    "artifact_finished",
  ];
  if (JSON.stringify(result.artifactSequence) !== JSON.stringify(expected)) {
    throw new Error(`unexpected artifact sequence: ${JSON.stringify(result.artifactSequence)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
