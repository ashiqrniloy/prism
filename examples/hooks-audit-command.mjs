// Fixture for examples/hooks-json.ts — a stand-in for a host audit command.
// Reads the hook payload on stdin, decides from it, answers as JSON on stdout.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  const payload = JSON.parse(raw);
  if (payload.hook_event_name === "PreToolUse" && payload.tool_input?.path?.endsWith(".env")) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "secrets stay out of the audit trail",
        },
      }),
    );
    return;
  }
  if (payload.hook_event_name === "SessionStart") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "Audit trail: every write is logged." },
      }),
    );
    return;
  }
  process.stdout.write(JSON.stringify({ continue: true }));
});
