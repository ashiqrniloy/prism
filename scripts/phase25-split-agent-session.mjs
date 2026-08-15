import { splitModule } from "./phase25-split-engine.mjs";

splitModule({
  src: "src/agent-session.ts",
  families: [
    { name: "create-agent", ranges: [[124, 136]] },
    { name: "session", ranges: [[137, 1786]] }, // RuntimeAgentSession class (>600: single cohesive TS class; method-extraction deferred — recorded reason)
    { name: "event-subscriber", ranges: [[1787, 1855]] },
    { name: "helpers", ranges: [[1856, 2049]] },
  ],
});
