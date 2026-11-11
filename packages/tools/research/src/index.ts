/**
 * `@arnilo/prism-tools/research` — research skills, a source ledger, and a citation check.
 *
 * `tool.result` records sources from the configured tool names. `cite` returns a `[[cite:<id>]]`
 * marker for a ledger id. `run.end` continues while repairs remain, then records a failed verdict.
 * `maxRepairs: 0` spends no extra model turn.
 */

import { fileURLToPath } from "node:url";
import { definePackage, type JsonValue, type PackageInstance, type SessionContext, type ToolResult } from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };

import { citationDecision, citationIds, citeMarker, lastAssistantText, unresolvedIds, withLedgerLine } from "./check.js";
import { type ToolsResearchConfig, toolsResearchConfigSchema } from "./config.js";
import { EMPTY_STATE, ledgerLine, type ResearchState, recordSources, sourcesIn } from "./ledger.js";

const PACKAGE = "@arnilo/prism-tools/research";

interface Flags {
  readonly missingNoted: boolean;
  readonly capNoted: boolean;
}

const EMPTY_FLAGS: Flags = { missingNoted: false, capNoted: false };

const definition = definePackage<ToolsResearchConfig>({
  name: PACKAGE,
  version: manifest.version,
  description: "Research skills, a per-session source ledger, cite, and a bounded citation check.",
  requires: { api: 1 },
  capabilities: ["session-state"],
  config: toolsResearchConfigSchema,
  setup(prism) {
    // Session state stores JSON. ResearchState is that object; it has no index signature.
    const research = prism.state.session("research", EMPTY_STATE as unknown as JsonValue);
    const flags = prism.state.agent("flags", EMPTY_FLAGS);
    const sourceTools = new Set(prism.config.sourceTools ?? []);

    const noteMissing = (): void => {
      const current = flags.get();
      if (current.missingNoted) return;
      const registered = new Set(prism.tools.list().map((tool) => tool.name));
      const missing = [...sourceTools].filter((name) => !registered.has(name));
      if (missing.length === 0) return;
      prism.status.note("info", `source tools not registered: ${missing.join(", ")}`);
      flags.set({ ...flags.get(), missingNoted: true });
    };

    const read = (session: SessionContext): ResearchState => (research.get(session) as unknown as ResearchState | undefined) ?? EMPTY_STATE;

    prism.hooks.on(
      "tool.result",
      (result, context) => {
        noteMissing();
        if (!sourceTools.has(result.name) || result.error !== undefined || context.session === undefined) return undefined;
        const before = read(context.session);
        const recorded = recordSources(before, sourcesIn(result.name, result.value, prism.config.redactQuery ?? []), {
          tool: result.name,
          toolCallId: result.toolCallId,
          fetchedAt: new Date().toISOString(),
          maxSources: prism.config.maxSources ?? 500,
        });
        if (recorded.cappedNow && !flags.get().capNoted) {
          prism.status.note("warn", `ledger reached maxSources (${prism.config.maxSources}); further sources are not recorded`);
          flags.set({ ...flags.get(), capNoted: true });
        }
        if (recorded.state === before) return undefined;
        research.set(context.session, recorded.state as unknown as JsonValue);
        return recorded.added.length === 0 ? undefined : withLedgerLine(result, ledgerLine(recorded.added));
      },
      { id: "ledger" },
    );

    prism.hooks.on(
      "run.end",
      (payload, context) => {
        noteMissing();
        if (context.session === undefined) return undefined;
        const current = read(context.session);
        const decision = citationDecision(
          current,
          unresolvedIds(citationIds(lastAssistantText(payload.history)), current.entries, prism.config.requireCitations === true),
          prism.config.maxRepairs ?? 1,
        );
        research.set(context.session, decision.state as unknown as JsonValue);
        if (decision.state.verdict === "failed") {
          context.emit("research.citations.unresolved", { unresolved: [...decision.state.unresolved] });
        }
        return decision.continueReason === undefined ? undefined : { continue: { reason: decision.continueReason } };
      },
      { id: "citations" },
    );

    prism.tools.register({
      name: "cite",
      description:
        "Return a [[cite:<id>]] marker for a source already in this session's ledger. Fails with unknown_source when the id was not fetched.",
      effects: [],
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          quote: { type: "string", maxLength: 500 },
        },
        required: ["id"],
      },
      execute(args, context): ToolResult {
        const id = typeof args.id === "string" ? args.id : "";
        const known = context.session !== undefined && read(context.session).entries.some((entry) => entry.id === id);
        if (!known) {
          return {
            toolCallId: context.toolCallId,
            name: "cite",
            error: { code: "unknown_source", message: `unknown source ${id}` },
            content: [{ type: "text", text: `unknown_source: ${id}` }],
          };
        }
        return {
          toolCallId: context.toolCallId,
          name: "cite",
          value: { id },
          content: [{ type: "text", text: citeMarker(id) }],
        };
      },
    });

    prism.commands.register({
      name: "research.verify",
      description: "Return the citation verdict, unresolved ids, and ledger size for a session.",
      run(_args, context) {
        if (context.session === undefined) return { verdict: "pending", unresolved: [], ledgerSize: 0 };
        const state = read(context.session);
        return { verdict: state.verdict, unresolved: [...state.unresolved], ledgerSize: state.entries.length };
      },
    });

    prism.skills.addDir(fileURLToPath(new URL("../skills", import.meta.url)));
  },
});

export default definition;

/** The package with config baked in, for `packages: [toolsResearch({ maxRepairs: 0 })]`. */
export function toolsResearch(config: ToolsResearchConfig = {}): PackageInstance {
  return definition(config);
}
