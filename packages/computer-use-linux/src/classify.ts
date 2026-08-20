export const COMPUTER_USE_LINUX_READ_TOOLS = [
  "doctor",
  "list_apps",
  "list_windows",
  "focused_window",
  "get_app_state",
  // Upstream may move/raise a target while capturing it. The Prism contract
  // treats screenshot as an observation so hosts can inspect before approving input.
  "screenshot",
] as const;

export const COMPUTER_USE_LINUX_SETUP_TOOLS = ["setup_accessibility", "setup_window_targeting"] as const;

export const COMPUTER_USE_LINUX_MUTATING_TOOLS = [
  "activate_window",
  "move_window",
  "resize_window",
  "scroll",
  "click",
  "drag",
  "press_key",
  "type_text",
  "perform_action",
  "set_value",
  ...COMPUTER_USE_LINUX_SETUP_TOOLS,
] as const;

export const COMPUTER_USE_LINUX_TOOL_NAMES = [
  ...COMPUTER_USE_LINUX_READ_TOOLS,
  ...COMPUTER_USE_LINUX_MUTATING_TOOLS.filter(
    (name) => !COMPUTER_USE_LINUX_READ_TOOLS.includes(name as (typeof COMPUTER_USE_LINUX_READ_TOOLS)[number]),
  ),
] as const;

const READ_TOOLS = new Set<string>(COMPUTER_USE_LINUX_READ_TOOLS);
const MUTATING_TOOLS = new Set<string>(COMPUTER_USE_LINUX_MUTATING_TOOLS);

export type ComputerUseLinuxToolClass = "read" | "mutating";

export function classifyComputerUseLinuxTool(name: string): ComputerUseLinuxToolClass | undefined {
  if (READ_TOOLS.has(name)) return "read";
  if (MUTATING_TOOLS.has(name)) return "mutating";
  return undefined;
}

export function isComputerUseLinuxTool(name: string, includeSetupTools = false): boolean {
  const kind = classifyComputerUseLinuxTool(name);
  return (
    kind === "read" ||
    (kind === "mutating" &&
      (includeSetupTools || !COMPUTER_USE_LINUX_SETUP_TOOLS.includes(name as (typeof COMPUTER_USE_LINUX_SETUP_TOOLS)[number])))
  );
}
