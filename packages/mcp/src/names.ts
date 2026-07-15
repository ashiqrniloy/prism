export function defaultMcpNamePrefix(serverId: string): string {
  return `mcp:${serverId}:`;
}

export function formatMcpToolName(prefix: string, remoteName: string): string {
  return `${prefix}${remoteName}`;
}

export function assertValidServerId(serverId: string): void {
  if (!serverId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(serverId)) {
    throw new Error(
      "serverId must be a non-empty identifier (letters, digits, ., _, -; must not start with . or -)",
    );
  }
}
