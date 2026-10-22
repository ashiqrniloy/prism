import type { ToolCapabilityKind } from "../../contracts.js";

export const ALL_TOOL_EFFECTS: readonly ToolCapabilityKind[] = ["read", "write", "execute", "network", "external"];

/** Maps a vendor tool name to its effects. An unknown name gets every effect, so it is gated as the riskiest. */
export function effectsTable(entries: Readonly<Record<string, readonly ToolCapabilityKind[]>>): (name: string) => readonly ToolCapabilityKind[] {
  const table = new Map(Object.entries(entries));
  return (name) => table.get(name) ?? ALL_TOOL_EFFECTS;
}
