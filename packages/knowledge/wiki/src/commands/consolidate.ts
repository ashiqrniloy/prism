import type { JsonObject, PackageCommand } from "@arnilo/prism";
import type { Curator } from "../consolidate/curator.js";
import { reportJson } from "../consolidate/curator.js";
import type { WikiPassReport } from "../consolidate/pass.js";

export const WIKI_CONSOLIDATE_COMMAND_NAME = "wiki:consolidate";

export function renderPass(report: WikiPassReport): string {
  const calls = `${report.modelCalls} model call${report.modelCalls === 1 ? "" : "s"}${report.correctionCalls > 0 ? ` (${report.correctionCalls} repair)` : ""}`;
  const tokens = `${report.inputTokens} in / ${report.outputTokens} out / ${report.cacheReadTokens} cached tokens`;
  const rejected = report.rejected.trust + report.rejected.secret + report.rejected.invalid;
  const failures = Object.entries(report.failures)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code} ${count}`)
    .join(", ");
  return [
    `${report.trigger} pass ${report.at}: ${report.due} due, ${report.subjects} concept${report.subjects === 1 ? "" : "s"} written, ${report.edits} edit${report.edits === 1 ? "" : "s"}, ${report.binds} bound, ${report.declined} declined, ${report.left} left due.`,
    `${calls}; ${tokens}.`,
    ...(rejected > 0
      ? [`rejected: trust ${report.rejected.trust}, secret ${report.rejected.secret}, invalid ${report.rejected.invalid}.`]
      : []),
    ...(failures ? [`left due: ${failures}.`] : []),
  ].join("\n");
}

/** `wiki:consolidate`: one concept pass now, inline, over every dirty subject in the readable write scopes. */
export function createWikiConsolidateCommand(curator: Curator): PackageCommand {
  return {
    name: WIKI_CONSOLIDATE_COMMAND_NAME,
    description: "Run one concept pass now: consolidate cited evidence into the ontology. Makes model calls, at most one per due subject.",
    async run(_args, context): Promise<JsonObject> {
      const report = await curator.runNow(context.session === undefined ? {} : { session: context.session });
      if (report === undefined) return { text: "wiki: not available." };
      return { ...reportJson(report), text: report.due === 0 ? "wiki: nothing is due." : renderPass(report) };
    },
  };
}
