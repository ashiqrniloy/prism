import { splitModule } from "./phase25-split-engine.mjs";

splitModule({
  src: "packages/server/src/handler.ts",
  families: [
    { name: "consts", ranges: [[39, 45]] },
    { name: "core", ranges: [[46, 477]] },
    {
      name: "routing",
      ranges: [
        [478, 563],
        [817, 823],
      ],
    },
    {
      name: "authorize",
      ranges: [
        [564, 618],
        [790, 793],
      ],
    },
    {
      name: "readers",
      ranges: [
        [619, 789],
        [794, 816],
      ],
    },
    { name: "policy", ranges: [[824, 859]] },
    { name: "sse", ranges: [[860, 952]] },
    { name: "respond", ranges: [[953, 1005]] },
  ],
});
