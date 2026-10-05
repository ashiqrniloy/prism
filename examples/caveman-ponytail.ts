import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProviderInput, createAgent, createLoadedSkillSet, createLoadSkillTool, createMemorySessionStore, createSessionEntry, createSkillRegistry, createToolRegistry, definePackage, dispatchToolCall, type ProviderRequest, providerDone, resolveActiveSkills, type Skill, toolCallContent } from "@arnilo/prism";
import { loadSkillDirectory } from "@arnilo/prism/node/contribution-discovery";
import { mockProvider } from "@arnilo/prism/testing";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "fixtures/behavior-skills/skills");
const sessionId = "behavior-demo";

const PONYTAIL_BODY_MARKER = "seen every over-engineered codebase";
const AUDIT_BODY_MARKER = "ponytail-review, repo-wide";

type HostStore = ReturnType<typeof createMemorySessionStore>;

function messageText(request: Awaited<ReturnType<typeof assembleProviderInput>>): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

interface PersonaOptions {
  /** Command name, mode header prefix, and the SKILL.md whose body becomes the slice. */
  readonly name: "caveman" | "ponytail";
  readonly skills: readonly Skill[];
  readonly store: HostStore;
  /** Session-entry `data.type` used to persist/restore the mode: `caveman-level` / `ponytail-mode`. */
  readonly stateType: string;
}

/**
 * Host-owned persona: no package subpath needed. One extension loads upstream
 * skills from disk, registers a `/mode` command, persists the active mode into
 * session entries, and injects the upstream SKILL.md body every turn while the
 * mode is not `off`.
 */
function personaPackage(options: PersonaOptions) {
  const bodies = new Map(options.skills.map((skill) => [skill.name, skill.instructions ?? ""] as const));
  let mode = "off";
  return definePackage({
    name: `@example/${options.name}`,
    version: "1.0.0",
    requires: { prism: "^0.12.1 || ^0.13.0-0" },
    async setup(prism) {
      const entries = await options.store.list(sessionId);
      for (const entry of entries) {
        const data = entry.kind === "custom" ? (entry.data as { type?: unknown; mode?: unknown }) : undefined;
        if (data?.type === options.stateType && typeof data.mode === "string") mode = data.mode;
      }
      for (const skill of options.skills) prism.skills.register(skill);
      prism.commands.register({
        name: options.name,
        description: `Set the ${options.name} persona mode`,
        args: { type: "object", properties: { mode: { type: "string" } }, additionalProperties: false },
        async run(args) {
          mode = typeof args.mode === "string" ? args.mode : "full";
          const listed = await options.store.list(sessionId);
          const parentId = listed.at(-1)?.id;
          await options.store.append(
            createSessionEntry({
              sessionId,
              parentId,
              kind: "custom",
              data: { type: options.stateType, mode },
            }),
            { expectedParentId: parentId },
          );
          return { mode };
        },
      });
      prism.hooks.on(
        "context.build",
        (draft) => {
          if (mode === "off") return undefined;
          const body = bodies.get(options.name) ?? "";
          const text = `${options.name.toUpperCase()} MODE ACTIVE (${mode})\n\n${body}`;
          const boundary = draft.messages.findIndex((message) => message.role !== "system");
          const at = boundary === -1 ? draft.messages.length : boundary;
          return {
            ...draft,
            messages: [
              ...draft.messages.slice(0, at),
              { id: `${options.name}-mode:${at}`, role: "system", content: [{ type: "text", text }] },
              ...draft.messages.slice(at),
            ],
          };
        },
        { id: `${options.name}-mode` },
      );
    },
  })();
}

// Host-owned persona packages: upstream skills loaded from disk, progressive catalog,
// load_skill, mode injector + session-entry persistence (network-free).
export async function demo() {
  const store = createMemorySessionStore();
  const skills = await loadSkillDirectory(skillsDir);
  const [cavemanSkill, ponytailSkill, auditSkill] = ["caveman", "ponytail", "ponytail-audit"].map((name) => {
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`missing fixture skill: ${name}`);
    return skill;
  });

  const registry = createSkillRegistry([ponytailSkill, cavemanSkill, auditSkill]);
  const loaded = createLoadedSkillSet();
  const loadSkill = createLoadSkillTool({ registry, loaded });
  const toolRegistry = createToolRegistry([loadSkill]);
  const activeNames = ["ponytail", "caveman", "ponytail-audit"];
  const activeSkills = resolveActiveSkills({ registry, names: activeNames });

  const captured: ProviderRequest[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [personaPackage({ name: "caveman", skills: [cavemanSkill], store, stateType: "caveman-level" }), personaPackage({ name: "ponytail", skills: [ponytailSkill, auditSkill], store, stateType: "ponytail-mode" }), mockProvider([[providerDone()]], { onRequest: (request) => captured.push(request) })],
  });
  await agent.commands.run("ponytail", { mode: "lite" });
  await agent.commands.run("caveman", { mode: "full" });
  const session = await agent.session({ id: sessionId, create: true });

  await session.run("Pick skills");
  const catalogText = messageText(captured[0]!);
  // Progressive disclosure: every active skill appears as a one-line catalog entry, and the
  // bodies only reach the transcript once the skill is loaded (or as the persona mode slice).
  const catalogLines = catalogText.split("\n").filter((line) => /^Skill /.test(line));
  const catalogOnly =
    catalogLines.length === 3 &&
    ["ponytail", "caveman", "ponytail-audit"].every((name) => catalogLines.some((line) => line.startsWith(`Skill ${name}:`)));

  const injectorText = catalogText;
  const injectorSliceWithoutBody = injectorText.includes("PONYTAIL MODE ACTIVE") && !injectorText.includes(AUDIT_BODY_MARKER);

  await dispatchToolCall({
    call: toolCallContent("call_1", "load_skill", { name: "ponytail-audit" }),
    registry: toolRegistry,
    context: {
      sessionId,
      runId: "r1",
      toolCallId: "call_1",
      metadata: {
        loadedSkills: loaded,
        activeSkillNames: activeNames,
        activeTools: toolRegistry.list(),
      },
    },
  });

  // The skill body lands once `load_skill` has marked it loaded in the shared set.
  const loadedText = messageText(
    await assembleProviderInput({
      model: { provider: "mock", model: "demo" },
      input: "Audit",
      skills: activeSkills,
      skillsDisclosure: "progressive",
      loadedSkills: loaded,
    }),
  );
  const auditBodyLoaded = loadedText.includes(AUDIT_BODY_MARKER);

  const entries = await store.list(sessionId);
  const modeEntries = entries.filter((entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === "ponytail-mode");

  return {
    skillCount: skills.length,
    extensionsLoaded: agent.inspect().skills.length > 0,
    catalogOnly,
    injectorSliceWithoutBody,
    auditBodyLoaded,
    loadedCount: loaded.list().length,
    persistedModeEntries: modeEntries.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
