import type { Message } from "prism";

export interface FileOperationDetails {
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
}

export function collectFileOperations(messages: readonly Message[]): FileOperationDetails {
  const readFiles = new Set<string>();
  const modifiedFiles = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "tool_call") continue;
      const path = typeof block.arguments.path === "string" ? block.arguments.path : undefined;
      if (!path) continue;
      if (block.name === "read") readFiles.add(path);
      if (block.name === "write" || block.name === "edit") modifiedFiles.add(path);
    }
  }

  for (const path of modifiedFiles) readFiles.delete(path);
  return { readFiles: [...readFiles].sort(), modifiedFiles: [...modifiedFiles].sort() };
}

export function formatFileOperations(details: FileOperationDetails): string {
  const sections: string[] = [];
  if (details.readFiles.length) sections.push(`<read-files>\n${details.readFiles.join("\n")}\n</read-files>`);
  if (details.modifiedFiles.length) sections.push(`<modified-files>\n${details.modifiedFiles.join("\n")}\n</modified-files>`);
  return sections.join("\n\n");
}
