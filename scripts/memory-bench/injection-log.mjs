import { definePackage } from "@arnilo/prism";
export const tokens = (text) => Math.ceil(text.length / 4);
export const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
const sources = new Set(["om", "fabric-working", "fabric-semantic", "fabric-directory", "fabric-rules"]);
function sourceOf(block) {
  if (sources.has(block.metadata?.source)) return block.metadata.source;
  const name = block.title ?? block.id ?? "";
  if (name === "observational-memory") return "om";
  if (/working/i.test(name)) return "fabric-working";
  if (/semantic|memory-recall/i.test(name)) return "fabric-semantic";
  if (/directory/i.test(name)) return "fabric-directory";
}
/** Bench-only request observer; contents remain in memory for judging, never in reports. */
export function injectionLogger(state) {
  return definePackage({
    name: "memory-bench-injections",
    version: "0.13.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("model.request", (request) => {
        if (state.phase !== "answer") return;
        const turn = ++state.turns;
        const blocks = [
          ...(request.context ?? []),
          ...request.messages.flatMap((message) =>
            (message.metadata?.contextBlocks ?? []).map((block, index) => ({
              title: block.title,
              content: message.content[index * 2]?.type === "text" ? message.content[index * 2].text : textOf(message.content),
              metadata: { source: block.source, itemIds: block.itemIds, tokens: block.tokens, coverageById: block.coverageById },
            })),
          ),
          ...request.messages.filter(
            (message) =>
              sources.has(message.metadata?.source) &&
              !(request.context ?? []).some(
                (block) =>
                  message.role === "system" && textOf(message.content) === `${block.title ?? "Context"}:\n${textOf(block.content)}`,
              ),
          ),
        ];
        const seen = new Set();
        for (const block of blocks) {
          const source = sourceOf(block);
          if (!source) continue;
          const text = textOf(block.content);
          const key = `${source}:${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const ids = block.metadata?.itemIds;
          const itemIds = Array.isArray(ids) && ids.length ? ids : [`block:${block.title ?? source}`];
          const itemTexts = itemIds.map(
            (id) =>
              text
                .split("\n")
                .filter((line) => line.includes(`[${id}]`))
                .join("\n") || text,
          );
          const weights = itemTexts.map((item) => Math.max(1, item.length));
          const totalWeight = weights.reduce((n, weight) => n + weight, 0);
          const count = block.metadata?.tokens ?? tokens(text);
          let allocated = 0;
          state.injectedContextTokens += count;
          itemIds.forEach((id, index) => {
            const item = {
              questionId: state.questionId,
              turn,
              id,
              source,
              tokens: index === itemIds.length - 1 ? count - allocated : Math.floor((count * weights[index]) / totalWeight),
              placement: request.context?.includes(block) ? "prefix" : "tail",
              granularity: Array.isArray(ids) && ids.length ? "item" : "block",
              label: null,
              coverage: block.metadata?.coverageById?.[id] ?? null,
              cited: false,
            };
            allocated += item.tokens;
            state.injections.push(item);
            state.injectionText.set(item, itemTexts[index]);
          });
        }
      });
    },
  });
}
