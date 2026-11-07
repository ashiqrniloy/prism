import { createDefaultCompactor, definePackage } from "@arnilo/prism";

/** The team's own package: keeps the kernel's deterministic compaction and adds a `local:ping` command. */
export default definePackage({
  name: "@acme/local-compaction",
  version: "1.0.0",
  requires: { api: 1 },
  capabilities: ["slot:compaction"],
  setup(prism) {
    prism.slots.compaction.provide(createDefaultCompactor());
    prism.commands.register({ name: "local:ping", description: "Answers pong.", run: () => "pong" });
  },
});
