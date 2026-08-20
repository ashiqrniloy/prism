import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { resolveToolPolicy } from "./tool-policy.js";
import {
  AntigravityWorkspaceConfigError,
  DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME,
  type EphemeralWorkspaceConfigHandle,
  type EphemeralWorkspaceConfigOptions,
  MAX_WORKSPACE_CONFIG_BYTES,
} from "./types.js";

const activeWorkspaceLocks = new Set<string>();

export function assertValidWorkspacePath(workspace: string): string {
  if (typeof workspace !== "string" || !workspace.trim()) {
    throw new AntigravityWorkspaceConfigError("Workspace path must be a non-empty string");
  }
  if (/[\0\r\n]/.test(workspace)) {
    throw new AntigravityWorkspaceConfigError("Workspace path contains invalid control characters");
  }
  const resolved = resolve(normalize(workspace));
  if (!existsSync(resolved)) {
    throw new AntigravityWorkspaceConfigError(`Workspace directory does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    throw new AntigravityWorkspaceConfigError(`Workspace path is not a directory: ${resolved}`);
  }
  const real = realpathSync(resolved);
  return real;
}

function assertContainedPath(parent: string, child: string, label: string): void {
  const rel = relative(parent, child);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AntigravityWorkspaceConfigError(`${label} escapes workspace boundary: ${child}`);
  }
}

export function writeEphemeralWorkspaceConfig(options: EphemeralWorkspaceConfigOptions): EphemeralWorkspaceConfigHandle {
  const realWorkspace = assertValidWorkspacePath(options.workspace);

  if (activeWorkspaceLocks.has(realWorkspace)) {
    throw new AntigravityWorkspaceConfigError(`Workspace MCP configuration is currently locked by an active run: ${realWorkspace}`);
  }

  const serverName = options.serverName ?? DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME;
  if (!serverName || !/^[A-Za-z0-9_-]+$/.test(serverName)) {
    throw new AntigravityWorkspaceConfigError(`Invalid MCP server name: ${serverName}`);
  }

  const agentsDir = join(realWorkspace, ".agents");
  const mcpConfigFile = join(agentsDir, "mcp_config.json");
  const settingsFile = join(agentsDir, "settings.json");

  assertContainedPath(realWorkspace, agentsDir, "Agents directory");
  assertContainedPath(realWorkspace, mcpConfigFile, "MCP config file");
  assertContainedPath(realWorkspace, settingsFile, "Settings file");

  // Acquire lock
  activeWorkspaceLocks.add(realWorkspace);

  let agentsDirCreatedByUs = false;
  let backupMcpConfig: string | undefined;
  let backupSettings: string | undefined;
  let settingsWrittenByUs = false;
  let restored = false;

  try {
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
      agentsDirCreatedByUs = true;
    } else {
      const stat = statSync(agentsDir);
      if (!stat.isDirectory()) {
        throw new AntigravityWorkspaceConfigError(`.agents path is not a directory: ${agentsDir}`);
      }
      const realAgents = realpathSync(agentsDir);
      assertContainedPath(realWorkspace, realAgents, "Agents directory realpath");
    }

    if (existsSync(mcpConfigFile)) {
      const content = readFileSync(mcpConfigFile, "utf8");
      if (Buffer.byteLength(content, "utf8") > 1024 * 1024) {
        throw new AntigravityWorkspaceConfigError(`Existing mcp_config.json exceeds 1 MiB`);
      }
      backupMcpConfig = content;
    }

    if (existsSync(settingsFile)) {
      const content = readFileSync(settingsFile, "utf8");
      if (Buffer.byteLength(content, "utf8") > 1024 * 1024) {
        throw new AntigravityWorkspaceConfigError(`Existing settings.json exceeds 1 MiB`);
      }
      backupSettings = content;
    }

    const disabledTools = options.disabledTools ?? options.mcpConfig.disabledTools;
    const mcpConfigBody = {
      mcpServers: {
        [serverName]: {
          ...(options.mcpConfig.command !== undefined ? { command: options.mcpConfig.command } : {}),
          ...(options.mcpConfig.args !== undefined ? { args: [...options.mcpConfig.args] } : {}),
          ...(options.mcpConfig.env !== undefined ? { env: { ...options.mcpConfig.env } } : {}),
          ...(options.mcpConfig.cwd !== undefined ? { cwd: options.mcpConfig.cwd } : {}),
          ...(options.mcpConfig.serverUrl !== undefined ? { serverUrl: options.mcpConfig.serverUrl } : {}),
          ...(options.mcpConfig.headers !== undefined ? { headers: { ...options.mcpConfig.headers } } : {}),
          ...(options.mcpConfig.disabled !== undefined ? { disabled: options.mcpConfig.disabled } : {}),
          ...(disabledTools?.length ? { disabledTools: [...disabledTools] } : {}),
        },
      },
    };

    const mcpConfigJson = `${JSON.stringify(mcpConfigBody, null, 2)}\n`;
    if (Buffer.byteLength(mcpConfigJson, "utf8") > MAX_WORKSPACE_CONFIG_BYTES) {
      throw new AntigravityWorkspaceConfigError(`Generated mcp_config.json exceeds ${MAX_WORKSPACE_CONFIG_BYTES} bytes`);
    }

    atomicWriteFile(mcpConfigFile, mcpConfigJson);

    // Write scoped settings.json for permissions
    const resolvedPolicy = options.toolPolicy
      ? resolveToolPolicy({
          policy: options.toolPolicy,
          serverName,
          allowedMcpTools: options.allowedMcpTools,
        })
      : undefined;

    const allowPermissions =
      options.permissions?.allow ??
      resolvedPolicy?.permissions.allow ??
      (options.allowedMcpTools?.length ? options.allowedMcpTools.map((tool) => `mcp(${serverName}/${tool})`) : [`mcp(${serverName}/*)`]);

    const denyPermissions = options.permissions?.deny ?? resolvedPolicy?.permissions.deny ?? [];

    const settingsBody = {
      permissions: {
        ...(allowPermissions.length ? { allow: allowPermissions } : {}),
        ...(denyPermissions.length ? { deny: denyPermissions } : {}),
      },
    };

    const settingsJson = `${JSON.stringify(settingsBody, null, 2)}\n`;
    atomicWriteFile(settingsFile, settingsJson);
    settingsWrittenByUs = true;

    const restore = async () => {
      if (restored) return;
      restored = true;
      try {
        if (backupMcpConfig !== undefined) {
          atomicWriteFile(mcpConfigFile, backupMcpConfig);
        } else if (existsSync(mcpConfigFile)) {
          rmSync(mcpConfigFile, { force: true });
        }

        if (backupSettings !== undefined) {
          atomicWriteFile(settingsFile, backupSettings);
        } else if (settingsWrittenByUs && existsSync(settingsFile)) {
          rmSync(settingsFile, { force: true });
        }

        if (agentsDirCreatedByUs && existsSync(agentsDir)) {
          try {
            const remaining = readdirSync(agentsDir);
            if (remaining.length === 0) {
              rmdirSync(agentsDir);
            }
          } catch {
            // Ignore cleanup failure for non-empty dir
          }
        }
      } finally {
        activeWorkspaceLocks.delete(realWorkspace);
      }
    };

    return {
      workspace: realWorkspace,
      agentsDir,
      mcpConfigFile,
      settingsFile,
      serverName,
      get restored() {
        return restored;
      },
      restore,
      [Symbol.asyncDispose]: restore,
    };
  } catch (error) {
    activeWorkspaceLocks.delete(realWorkspace);
    throw error;
  }
}

function atomicWriteFile(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp.${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, targetPath);
  } catch (error) {
    if (existsSync(tmpPath)) {
      rmSync(tmpPath, { force: true });
    }
    throw new AntigravityWorkspaceConfigError(`Failed to write file: ${targetPath}`, { cause: error });
  }
}

export async function withEphemeralWorkspaceConfig<T>(
  options: EphemeralWorkspaceConfigOptions,
  fn: (handle: EphemeralWorkspaceConfigHandle) => Promise<T>,
): Promise<T> {
  const handle = writeEphemeralWorkspaceConfig(options);
  try {
    return await fn(handle);
  } finally {
    await handle.restore();
  }
}
