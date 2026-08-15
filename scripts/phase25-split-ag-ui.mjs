import { splitModule } from "./phase25-split-engine.mjs";

splitModule({
  src: "packages/ag-ui/src/acp/agent.ts",
  families: [
    { name: "types", ranges: [[62, 157]] },
    { name: "core", ranges: [[158, 523]] },
    { name: "coding", ranges: [[524, 540]] },
    {
      name: "registry",
      ranges: [
        [541, 609],
        [672, 678],
      ],
    },
    {
      name: "forward-notify",
      ranges: [
        [610, 671],
        [679, 703],
      ],
    },
    { name: "permission-elicit", ranges: [[704, 792]] },
    { name: "decision", ranges: [[793, 817]] },
    { name: "abort-truncate", ranges: [[818, 836]] },
  ],
});
