import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleProviderInput, createExtensionKernel, createLoadedSkillSet, createLoadSkillTool, createMemorySessionStore, createSkillRegistry, createToolRegistry, dispatchToolCall, resolveActiveSkills, toolCallContent, } from "@arnilo/prism";
import { createCavemanExtension } from "@arnilo/prism-caveman";
import { createPonytailExtension } from "@arnilo/prism-ponytail";
const here = dirname(fileURLToPath(import.meta.url));
const cavemanUpstream = join(here, "../packages/prism-caveman/fixtures/upstream-full");
const ponytailUpstream = join(here, "../packages/prism-ponytail/fixtures/upstream-full");
const sessionId = "behavior-demo";
const PONYTAIL_BODY_MARKER = "seen every over-engineered codebase";
const AUDIT_BODY_MARKER = "ponytail-review, repo-wide";
function messageText(request) {
    return request.messages
        .flatMap((message) => message.content)
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
}
function attachCallbacks(store) {
    return {
        appendEntry: async (entry, options) => {
            await store.append(entry, options);
        },
        getEntries: async () => await store.list(sessionId),
    };
}
// Caveman + Ponytail: attach session store, progressive catalog, load_skill, injector slices (network-free).
export async function demo() {
    const store = createMemorySessionStore();
    const callbacks = attachCallbacks(store);
    const kernelBefore = createExtensionKernel({ errorPolicy: "throw" });
    assertInert(kernelBefore.registries.skills.list().length === 0);
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
        createCavemanExtension({
            upstreamPath: cavemanUpstream,
            defaultLevel: "off",
            ...callbacks,
        }),
        createPonytailExtension({
            upstreamPath: ponytailUpstream,
            defaultMode: "off",
            quietStartup: true,
            ...callbacks,
        }),
    ]);
    const skills = kernel.registries.skills.list();
    const registry = createSkillRegistry(skills);
    const loaded = createLoadedSkillSet();
    const loadSkill = createLoadSkillTool({ registry, loaded });
    const toolRegistry = createToolRegistry([loadSkill]);
    const activeNames = ["ponytail", "caveman", "ponytail-audit"];
    const activeSkills = resolveActiveSkills({ registry, names: activeNames });
    await kernel.registries.commands.get("ponytail").execute({ mode: "lite" }, { sessionId });
    await kernel.registries.commands.get("caveman").execute({ level: "lite" }, { sessionId });
    const catalogRequest = await assembleProviderInput({
        model: { provider: "mock", model: "demo" },
        input: "Pick skills",
        skills: activeSkills,
        skillsDisclosure: "progressive",
        loadedSkills: loaded,
        turn: 1,
        sessionId,
        runId: "r1",
        metadata: {},
        signal: new AbortController().signal,
    });
    const catalogText = messageText(catalogRequest);
    const catalogOnly = catalogText.includes("Skill ponytail:") &&
        catalogText.includes("Skill caveman:") &&
        !catalogText.includes(PONYTAIL_BODY_MARKER) &&
        !catalogText.includes(AUDIT_BODY_MARKER);
    const injectorRequest = await assembleProviderInput({
        model: { provider: "mock", model: "demo" },
        input: "Pick skills",
        skills: activeSkills,
        skillsDisclosure: "progressive",
        loadedSkills: loaded,
        instructionInjectors: kernel.registries.instructionInjectors.list(),
        turn: 1,
        sessionId,
        runId: "r1",
        metadata: {},
        signal: new AbortController().signal,
    });
    const injectorText = messageText(injectorRequest);
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
    const loadedRequest = await assembleProviderInput({
        model: { provider: "mock", model: "demo" },
        input: "Audit",
        skills: activeSkills,
        skillsDisclosure: "progressive",
        loadedSkills: loaded,
        instructionInjectors: kernel.registries.instructionInjectors.list(),
        turn: 2,
        sessionId,
        runId: "r1",
        metadata: {},
        signal: new AbortController().signal,
    });
    const loadedText = messageText(loadedRequest);
    const auditBodyLoaded = loadedText.includes(AUDIT_BODY_MARKER);
    const entries = await store.list(sessionId);
    const modeEntries = entries.filter((entry) => entry.kind === "custom" && entry.data.type === "ponytail-mode");
    return {
        skillCount: skills.length,
        extensionsLoaded: kernel.registries.skills.list().length > 0,
        catalogOnly,
        injectorSliceWithoutBody,
        auditBodyLoaded,
        loadedCount: loaded.list().length,
        persistedModeEntries: modeEntries.length,
    };
}
function assertInert(condition) {
    if (!condition)
        throw new Error("expected inert registries before kernel.load");
}
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(JSON.stringify(await demo()));
}
