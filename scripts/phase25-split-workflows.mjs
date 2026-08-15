import { splitModule } from "./phase25-split-engine.mjs";

splitModule({
  src: "packages/workflows/src/run.ts",
  families: [
    {
      name: "main",
      ranges: [
        [62, 337],
        [1208, 1227],
      ],
    },
    { name: "scheduler", ranges: [[338, 549]] },
    { name: "node-execution", ranges: [[550, 953]] },
    { name: "skip", ranges: [[954, 1033]] },
    { name: "checkpoint", ranges: [[1035, 1150]] },
    { name: "validation", ranges: [[1151, 1207]] },
  ],
});
