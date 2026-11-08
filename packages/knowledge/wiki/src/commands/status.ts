import type { JsonObject, PackageCommand, SessionContext } from "@arnilo/prism";
import type { WikiOntologyPort } from "../ontology/port.js";
import type { WikiPassReport } from "../consolidate/pass.js";
import type { WikiStatusReport, WikiStatusScope } from "../types.js";
import { renderPass } from "./consolidate.js";

export const WIKI_STATUS_COMMAND_NAME = "wiki:status";

/**
 * Counts the wiki per readable scope: concepts, and the ones that need a pass with their reasons, and says whether
 * long-term memory is attached. Reads the wiki's store only (no model call, no note text), plus the last pass and its cost.
 */
export async function wikiStatus(port: WikiOntologyPort, last?: WikiPassReport, signal?: AbortSignal): Promise<WikiStatusReport> {
  await port.refresh(signal === undefined ? {} : { signal });
  const scopes: WikiStatusScope[] = [];
  for (const scope of port.scopes()) {
    const [subjects, dirty] = await Promise.all([
      port.subjects(scope, signal === undefined ? {} : { signal }),
      port.dirty(scope, signal === undefined ? {} : { signal }),
    ]);
    const reasons: Record<string, number> = {};
    for (const entry of dirty) for (const reason of entry.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    scopes.push({ scope, subjects: subjects.length, dirty: dirty.length, reasons });
  }
  return {
    memory: port.memory(),
    sources: (await port.store.sources()).length,
    scopes,
    subjects: scopes.reduce((sum, entry) => sum + entry.subjects, 0),
    dirty: scopes.reduce((sum, entry) => sum + entry.dirty, 0),
    ...(last === undefined ? {} : { last }),
  };
}

export function renderWikiStatus(report: WikiStatusReport): string {
  const lines = report.scopes.map((entry) => {
    const reasons = Object.entries(entry.reasons)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => `${reason} ${count}`)
      .join(", ");
    return `- ${entry.scope}: ${entry.subjects} subject${entry.subjects === 1 ? "" : "s"}, ${entry.dirty} dirty${reasons ? ` (${reasons})` : ""}`;
  });
  return [
    `wiki: ${report.subjects} subject${report.subjects === 1 ? "" : "s"}, ${report.dirty} dirty, ${report.sources} source${report.sources === 1 ? "" : "s"}.`,
    report.memory ? "memory: attached (read-only, memory.ltm)." : "memory: not installed; the wiki runs on its own sources.",
    ...lines,
    ...(report.last === undefined ? ["last pass: none in this process."] : [`last pass: ${renderPass(report.last)}`]),
  ].join("\n");
}

/** `wiki:status`. */
export function createWikiStatusCommand(
  port: () => WikiOntologyPort | undefined,
  last: (session?: SessionContext) => WikiPassReport | undefined = () => undefined,
): PackageCommand {
  return {
    name: WIKI_STATUS_COMMAND_NAME,
    description: "Report the ontology tier: concept notes and dirty subjects per scope. Makes no model call.",
    async run(_args, context): Promise<JsonObject> {
      const ontology = port();
      if (ontology === undefined) return { text: "wiki: not available." };
      const report = await wikiStatus(ontology, last(context.session));
      return { ...(report as unknown as JsonObject), text: renderWikiStatus(report) };
    },
  };
}
