import { definePackage } from "@arnilo/prism";

const FORCE_PUSH = /\bgit\s+push\b[^\n;&|]*(?:--force\b|--force-with-lease\b|\s-f\b)/;

export default definePackage({
  name: "@acme/no-force-push",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.hooks.on("tool.call", (call) => {
      if (call.name !== "shell") return "allow";
      const command = typeof call.args.command === "string" ? call.args.command : "";
      return FORCE_PUSH.test(command) ? { deny: "force push is not allowed" } : "allow";
    });
  },
});
