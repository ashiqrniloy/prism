/**
 * One source of truth for the TUI's slash commands and key chords. `/help` renders both tables
 * and the completion popup filters `CORE_SLASH_COMMANDS`, so the docs cannot drift from the UI.
 */

export interface SlashCommandInfo {
  readonly name: string;
  readonly description: string;
}

export const CORE_SLASH_COMMANDS: readonly SlashCommandInfo[] = [
  { name: "/new", description: "Create a fresh session for the repository" },
  { name: "/clear", description: "Clear the screen and start a fresh session" },
  { name: "/exit", description: "Quit prism-code" },
  { name: "/tools", description: "List active tools by source, including web availability" },
  { name: "/export [path]", description: "Write the session transcript as markdown" },
  { name: "/resume", description: "Search and resume prior sessions for this repository" },
  { name: "/rename <title>", description: "Set the session title shown in /resume" },
  { name: "/compact", description: "Compact session history with coding LLM summary" },
  { name: "/om", description: "Toggle observational memory for current session (default off)" },
  { name: "/om-model", description: "Select independent model/provider for OM workers" },
  { name: "/om:status", description: "Show observational memory counts and thresholds" },
  { name: "/om:view", description: "Render visible observational memory ledger" },
  { name: "/approval [ask|accept-edits|auto]", description: "Show or set the approval mode" },
  { name: "/permissions [revoke <n>]", description: "List or revoke persisted always-allow rules" },
  { name: "/provider", description: "Select and authenticate AI provider" },
  { name: "/logout [provider]", description: "Revoke and delete stored credentials (never env vars)" },
  { name: "/model", description: "Select active model with live discovery & catalog fallback" },
  { name: "/skills", description: "List discovered skills, layer origins, and loaded states" },
  { name: "/skill <name>", description: "Force-load a skill into the current session" },
  { name: "/mcp [reconnect|login|disable|enable|tools] [id]", description: "Inspect and control MCP servers" },
];

export interface TuiKeyBinding {
  readonly keys: string;
  readonly description: string;
}

export const TUI_KEYBINDINGS: readonly TuiKeyBinding[] = [
  { keys: "Enter", description: "Submit the prompt (including a multi-line one)" },
  { keys: "Shift+Enter / Alt+Enter / Ctrl+J", description: "Insert a newline (a trailing \\ + Enter also continues the line)" },
  { keys: "/", description: "Complete a slash command (Tab/Enter accept)" },
  { keys: "@", description: "Complete and attach a repository file (Tab/Enter accept)" },
  { keys: "Up / Down", description: "Walk prompt history from the first/last buffer line" },
  { keys: "Shift+Tab", description: "Cycle model reasoning effort levels" },
  { keys: "Ctrl+T", description: "Expand/collapse thinking blocks" },
  { keys: "Ctrl+O", description: "Expand/collapse the most recent tool card" },
  { keys: "Esc", description: "Close a popup, or abort the active run" },
  { keys: "Ctrl+C", description: "Clear input, abort a running turn, or exit" },
  { keys: "Ctrl+D", description: "Quit on empty input" },
];

/** `/help` body shared by the transcript command and the tests. */
export function formatHelpText(extensionCommands: readonly SlashCommandInfo[]): string {
  const commandLines = [...CORE_SLASH_COMMANDS, ...extensionCommands].map((cmd) => `• ${cmd.name} - ${cmd.description}`);
  const keyLines = TUI_KEYBINDINGS.map((binding) => `• ${binding.keys} - ${binding.description}`);
  return `Available slash commands:\n${commandLines.join("\n")}\n\nKeybindings:\n${keyLines.join("\n")}`;
}
