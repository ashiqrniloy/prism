import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentSession,
  type AIProvider,
  type CommandDefinition,
  type CommandDrivers,
  type CommandExecutionContext,
  type CommandResult,
  type JsonObject,
  type Message,
  type ModelConfig,
  type OAuthLoginCallbacks,
  redactSessionEntry,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  type SessionEntry,
  type SessionSearchHit,
  type SessionStore,
  type ToolDefinition,
} from "@arnilo/prism";
import type { AgentSdkDefinition } from "@arnilo/prism-agent-sdk";
import { createMcpClientAuth, createMcpOAuthFetch, type McpStreamableHttpTransport } from "@arnilo/prism-mcp";
import { createMemoryStatusCommand, createMemoryViewCommand } from "@arnilo/prism-memory/compaction/observational-memory";
import { PRISM_CODE_APPROVAL_MODES, type PrismCodeApprovalController, type PrismCodeApprovalMode } from "../approval.js";
import type { PrismCodeConfig, PrismCodeMcpServer } from "../config.js";
import type { PrismCodeCredentialManager } from "../credentials.js";
import { PrismCodeExecutionError } from "../errors.js";
import { createMcpAuthOptions } from "../mcp.js";
import { describeProviderCredentialStatus, formatProviderCredentialStatus, logoutProvider } from "../oauth.js";
import { ObservationalMemoryCoordinator } from "../observational-memory.js";
import {
  defaultModelForProvider,
  getShippedProvider,
  getStaticModelsForProvider,
  listModelsForProvider,
  type ProviderCache,
  resolveProvider,
  SHIPPED_PROVIDERS,
  validateProviderKey,
  validateThinkingLevel,
} from "../providers.js";
import {
  compactSession,
  deriveSessionTitle,
  ensureDurableSessionRecord,
  formatSessionOption,
  getCanonicalWorkspaceRoot,
  searchRepoSessions,
  setSessionTitle,
} from "../sessions.js";
import { formatSkillsList, inspectSkills } from "../skills.js";
import { BUNDLED_CODING_TOOLS } from "../tools.js";
import type { WebToolResolution } from "../web.js";
import type { PickerComponent, UiPickerOption } from "./components/picker.js";
import type { StatusFooterComponent } from "./components/status.js";
import type { MessageStreamComponent } from "./components/stream.js";
import { formatHelpText } from "./keybindings.js";
import type { TuiState } from "./reducer.js";

export interface CommandContext {
  state: TuiState;
  picker: PickerComponent;
  stream: MessageStreamComponent;
  status: StatusFooterComponent;
  credentialManager: PrismCodeCredentialManager;
  /** Shared provider cache: `/compact` resolves through it and `/logout` clears it. */
  providerCache?: ProviderCache;
  currentModel: ModelConfig;
  session?: AgentSession;
  definition?: AgentSdkDefinition;
  config: PrismCodeConfig;
  store: SessionStore;
  omCoordinator?: ObservationalMemoryCoordinator;
  /** Host approval controller; `/approval` and `/permissions` are no-ops without it. */
  approval?: PrismCodeApprovalController;
  onUpdateState: (patch: Partial<TuiState>) => void;
  onUpdateModel: (model: ModelConfig) => void;
  onSwitchSession?: (session: AgentSession, initialEntries?: readonly SessionEntry[]) => Promise<void>;
  promptSecret?: (promptText: string) => Promise<string | undefined>;
  /** Host-opt-in drivers forwarded to contributed extension commands (never model-visible). */
  commandDrivers?: CommandDrivers;
  /** Recomputes the MCP footer from the plane's cached status (no network). */
  refreshMcpFooter?: () => void;
  /** Session-scoped MCP tool disable/enable control (host-owned; absent without a tool registry). */
  mcpSession?: McpSessionControl;
  /** Host hook for `/exit`; absent outside the TUI. */
  requestExit?: (code?: number) => void;
  /** Web plane resolution for `/tools` (mode, tool names, `unavailableReason`). */
  webResolution?: WebToolResolution;
}

export interface McpSessionControl {
  readonly disabled: ReadonlySet<string>;
  disable(serverId: string): { readonly removed: number } | { readonly error: string };
  enable(serverId: string): { readonly restored: number } | { readonly error: string };
}

export interface SlashCommandResult {
  readonly handled: boolean;
  readonly message?: string;
}

/** Bounded rendering for contributed command output; long wiki reports are truncated. */
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024;

function boundCommandText(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_COMMAND_OUTPUT_BYTES) return text;
  return `${text.slice(0, MAX_COMMAND_OUTPUT_BYTES)}\n[output truncated]`;
}

/**
 * Parses slash-command arguments: `key=value` pairs win, a single URL is `{ url }`,
 * otherwise remaining text is `{ text }`. Never forwards raw slash text to the provider.
 */
export function parseCommandArgs(parts: readonly string[]): JsonObject {
  if (parts.length === 0) return {};
  if (parts.some((part) => /^[A-Za-z][\w-]*=/.test(part))) {
    const args: Record<string, string> = {};
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const key = part.slice(0, eq);
      let value = part.slice(eq + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      args[key] = value;
    }
    return args;
  }
  const [first] = parts;
  if (parts.length === 1 && first && /^https?:\/\//i.test(first)) return { url: first };
  return { text: parts.join(" ") };
}

/**
 * Dispatches slash commands entered by user (e.g. /provider, /model, /new, /resume, /compact).
 * Returns { handled: true } if text starts with '/' and was processed.
 */
export async function handleSlashCommand(commandText: string, context: CommandContext): Promise<SlashCommandResult> {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();

  switch (command) {
    case "new": {
      return executeNewSessionCommand(context);
    }
    case "clear": {
      return executeClearCommand(context);
    }
    case "exit": {
      return executeExitCommand(context);
    }
    case "tools": {
      return executeToolsCommand(context);
    }
    case "export": {
      return executeExportCommand(context, parts[1]);
    }
    case "resume": {
      return executeResumeSessionCommand(context);
    }
    case "rename": {
      return executeRenameCommand(context, parts.slice(1).join(" ") || undefined);
    }
    case "compact": {
      return executeCompactCommand(context);
    }
    case "provider": {
      return executeProviderCommand(context);
    }
    case "logout": {
      return executeLogoutCommand(context, parts[1]);
    }
    case "model": {
      return executeModelCommand(context);
    }
    case "om": {
      return executeOmToggleCommand(context);
    }
    case "om-model": {
      return executeOmModelCommand(context);
    }
    case "om:status": {
      return executeOmStatusCommand(context);
    }
    case "om:view": {
      return executeOmViewCommand(context, parts[1]);
    }
    case "approval": {
      return executeApprovalCommand(context, parts[1]);
    }
    case "permissions": {
      return executePermissionsCommand(context, parts.slice(1));
    }
    case "skills": {
      return executeSkillsCommand(context);
    }
    case "mcp": {
      return executeMcpCommand(context, parts.slice(1));
    }
    case "skill": {
      return executeSkillCommand(context, parts.slice(1));
    }
    case "help": {
      const extensionLines = (context.definition?.commands ?? [])
        .filter((cmd) => cmd.name !== "skills" && cmd.name !== "skill")
        .map((cmd) => ({ name: `/${cmd.name}`, description: cmd.description ?? "custom command" }));
      context.stream.appendOrUpdate({
        id: `help_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: formatHelpText(extensionLines),
        finished: true,
      });
      return { handled: true };
    }
    default: {
      const extensionCommands = (context.definition?.commands ?? []).filter((cmd) => cmd.name.toLowerCase() === command);
      if (extensionCommands.length > 1) {
        context.stream.appendOrUpdate({
          id: `cmd_collision_${Date.now()}`,
          type: "error",
          message: `Duplicate command "/${command}" is registered more than once; refusing to dispatch.`,
        });
        return { handled: true };
      }
      const extensionCommand = extensionCommands[0];
      if (extensionCommand) {
        return executeExtensionCommand(context, extensionCommand, parts.slice(1));
      }
      context.stream.appendOrUpdate({
        id: `unknown_cmd_${Date.now()}`,
        type: "error",
        message: `Unknown command "/${command}". Type /help for available commands.`,
      });
      return { handled: true };
    }
  }
}

async function executeApprovalCommand(context: CommandContext, rawMode: string | undefined): Promise<SlashCommandResult> {
  const mode = rawMode?.toLowerCase();
  const current = context.approval?.getMode() ?? context.state.footer.approval ?? "ask";
  if (!mode) {
    context.stream.appendOrUpdate({
      id: `cmd_approval_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Approval mode: ${current}\nUsage: /approval ask|accept-edits|auto`,
      finished: true,
    });
    return { handled: true };
  }
  if (!PRISM_CODE_APPROVAL_MODES.includes(mode as PrismCodeApprovalMode)) {
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: `Unknown approval mode "${mode}". Usage: /approval ask|accept-edits|auto`,
    });
    return { handled: true };
  }
  if (!context.approval) {
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: "Approval mode is not controllable in this session.",
    });
    return { handled: true };
  }
  const next = mode as PrismCodeApprovalMode;
  context.approval.setMode(next);
  context.onUpdateState({ footer: { ...context.state.footer, approval: next } });
  context.status.update({ approval: next });
  context.stream.appendOrUpdate({
    id: `cmd_approval_${Date.now()}`,
    type: "message",
    role: "assistant",
    text:
      next === "auto"
        ? "Approval mode: auto - all tool calls are allowed except execution security hard denies."
        : `Approval mode: ${next}.`,
    finished: true,
  });
  return { handled: true };
}

function describePermissionRule(rule: { readonly tool: string; readonly commandPrefix?: string }): string {
  return rule.commandPrefix ? `${rule.tool} (${rule.commandPrefix})` : rule.tool;
}

async function executePermissionsCommand(context: CommandContext, args: readonly string[]): Promise<SlashCommandResult> {
  const rules = context.approval?.listRules() ?? [];
  if ((args[0] ?? "").toLowerCase() === "revoke") {
    const index = Number.parseInt(args[1] ?? "", 10);
    const removed = context.approval?.removeRule(index - 1);
    if (removed) {
      context.stream.appendOrUpdate({
        id: `cmd_permissions_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: `Revoked: ${describePermissionRule(removed)}`,
        finished: true,
      });
    } else {
      context.stream.appendOrUpdate({
        id: `cmd_permissions_${Date.now()}`,
        type: "error",
        message: `No always-allow rule at index ${Number.isSafeInteger(index) ? index : "?"}.`,
      });
    }
    return { handled: true };
  }
  const text =
    rules.length === 0
      ? "No persisted always-allow rules for this repository."
      : `Persisted always-allow rules for this repository:\n${rules
          .map((rule, i) => `${i + 1}. ${describePermissionRule(rule)}`)
          .join("\n")}\nRevoke with /permissions revoke <n>`;
  context.stream.appendOrUpdate({
    id: `cmd_permissions_${Date.now()}`,
    type: "message",
    role: "assistant",
    text,
    finished: true,
  });
  return { handled: true };
}

async function executeSkillsCommand(context: CommandContext): Promise<SlashCommandResult> {
  const loadedNames = context.session?.getLoadedSkillNames ? context.session.getLoadedSkillNames() : [];
  const skillsVal = context.definition?.agent.config.skills;
  const activeSkills = Array.isArray(skillsVal)
    ? skillsVal
    : skillsVal && typeof (skillsVal as any).list === "function"
      ? [...(skillsVal as any).list()]
      : undefined;
  const skills = await inspectSkills(context.config, {
    loadedSkillNames: loadedNames,
    activeSkills,
  });
  const text = formatSkillsList(skills);
  context.stream.appendOrUpdate({
    id: `cmd_skills_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: boundCommandText(text),
    finished: true,
  });
  return { handled: true };
}

async function executeSkillCommand(context: CommandContext, rawArgs: readonly string[]): Promise<SlashCommandResult> {
  const name = rawArgs.join(" ").trim();
  if (!name) {
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: "/skill requires a skill name. Usage: /skill <name>",
    });
    return { handled: true };
  }
  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: "No active session to load skill into.",
    });
    return { handled: true };
  }
  context.session.restoreLoadedSkills?.([name]);
  context.stream.appendOrUpdate({
    id: `cmd_skill_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Loaded skill "${name}" for this session.`,
    finished: true,
  });
  return { handled: true };
}

/**
 * Executes a contributed `CommandDefinition` (e.g. the four wiki commands) with the
 * session context and host drivers. Output and errors are bounded; duplicate names
 * fail closed above.
 */
async function executeExtensionCommand(
  context: CommandContext,
  command: CommandDefinition,
  rawArgs: readonly string[],
): Promise<SlashCommandResult> {
  const args = parseCommandArgs(rawArgs);
  const execContext: CommandExecutionContext = {
    ...(context.session ? { sessionId: context.session.id } : {}),
    ...(context.commandDrivers ? { drivers: context.commandDrivers } : {}),
    metadata: {
      ...(context.session ? { session: context.session } : {}),
    },
  };

  let result: CommandResult;
  try {
    result = await command.execute(args, execContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: `/${command.name} failed: ${boundCommandText(message)}`,
    });
    return { handled: true };
  }

  if (result.error) {
    context.stream.appendOrUpdate({
      id: `cmd_err_${Date.now()}`,
      type: "error",
      message: `/${command.name} failed: ${boundCommandText(result.error.message)}`,
    });
    return { handled: true };
  }

  const text = (result.content ?? [])
    .map((block) => (block.type === "text" ? block.text : undefined))
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  if (text.length > 0) {
    context.stream.appendOrUpdate({
      id: `cmd_${command.name}_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: boundCommandText(text),
      finished: true,
    });
  }
  return { handled: true };
}

/** Applies a model choice: active model, footer, status, and revalidated effort. */
function applyModelSelection(context: CommandContext, model: ModelConfig): string {
  context.onUpdateModel(model);
  const effort = validateThinkingLevel(model, context.state.footer.effort);
  context.status.update({ model: model.model, effort });
  context.onUpdateState({
    footer: {
      ...context.state.footer,
      model: model.model,
      effort,
    },
  });
  return effort;
}

/**
 * Shows the model picker for a provider and returns the chosen model (undefined when cancelled).
 * Callers pass discovered models or the shipped static catalog; the first entry is the default.
 */
async function showModelPicker(
  context: CommandContext,
  providerId: string,
  models: readonly import("../providers.js").DiscoveredModelInfo[],
): Promise<ModelConfig | undefined> {
  const desc = getShippedProvider(providerId);
  const pickerOptions: UiPickerOption[] = models.map((m) => {
    const badge = m.isLive ? "[live]" : m.isStale ? "[offline/cached]" : "[catalog]";
    const name = m.model.displayName ?? m.model.model;
    const descText = `${badge} ${m.model.limits ? `ctx: ${m.model.limits.contextWindow?.toLocaleString() ?? "?"}` : ""}`;
    return {
      name: `${m.model.model} (${name})`,
      value: m.model.model,
      description: descText,
    };
  });

  const selected = await context.picker.show(`Select Model (${desc?.name ?? providerId})`, pickerOptions);
  if (!selected) return undefined;
  return (models.find((m) => m.model.model === selected.value) ?? models[0])?.model;
}

/**
 * /provider slash command:
 * 1. Shows searchable picker with all shipped provider adapters.
 * 2. On selection, runs appropriate auth flow (API key masked input, OAuth device/URL, or host setup).
 * 3. Never echoes secrets in stream or logs.
 * 4. Failed or aborted auth leaves previous credentials intact.
 */
export async function executeProviderCommand(context: CommandContext): Promise<SlashCommandResult> {
  const options: UiPickerOption[] = await Promise.all(
    SHIPPED_PROVIDERS.map(async (p) => {
      const status = await describeProviderCredentialStatus(p, context.credentialManager);
      return {
        name: p.name,
        value: p.id,
        description: `${formatProviderCredentialStatus(status)} | ${p.authKinds.join(", ")} | ${p.description}`,
      };
    }),
  );

  const selected = await context.picker.show("Select AI Provider", options);
  if (!selected) {
    return { handled: true, message: "provider_selection_cancelled" }; // Cancelled by user
  }

  const providerId = selected.value;
  const desc = getShippedProvider(providerId);
  if (!desc) {
    return { handled: true, message: "provider_selection_cancelled" };
  }

  // Check current auth status
  const isAuthed = await context.credentialManager.hasCredentials(providerId);

  if (desc.authKinds.includes("ambient")) {
    context.stream.appendOrUpdate({
      id: `prov_ambient_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Switched provider to ${desc.name} (ambient/local runtime).`,
      finished: true,
    });
  } else if (desc.authKinds.includes("host_setup")) {
    context.stream.appendOrUpdate({
      id: `prov_setup_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Selected ${desc.name}. This enterprise provider requires environment credentials (e.g. AWS IAM, Entra tokens, or ADC). See docs/providers/${desc.packageSubpath}.md.`,
      finished: true,
    });
  } else if (!isAuthed && desc.authKinds.includes("api_key")) {
    // Prompt for API key
    if (context.promptSecret) {
      const key = await context.promptSecret(`Enter ${desc.defaultEnvVar ?? "API key"} for ${desc.name}: `);
      if (key && key.trim().length > 0) {
        const trimmed = key.trim();
        // Verify against the provider's model-list endpoint before storing; a failed check never persists silently.
        const validation = await validateProviderKey(providerId, trimmed, { signal: AbortSignal.timeout(5_000) });
        if (!validation.ok) {
          const decision = await context.picker.show(
            `Could not verify the ${desc.name} API key (${validation.reason ?? "unknown error"}). Save it anyway?`,
            [
              { name: "Save anyway", value: "save", description: "Store the key as entered" },
              { name: "Discard", value: "discard", description: "Nothing is stored; pick the provider again" },
            ],
          );
          if (decision?.value !== "save") {
            context.stream.appendOrUpdate({
              id: `prov_unverified_${Date.now()}`,
              type: "error",
              message: `Authentication cancelled for ${desc.name}: the key could not be verified. Nothing was stored.`,
            });
            return { handled: true, message: "auth_cancelled" };
          }
        }
        try {
          await context.credentialManager.setApiKey(providerId, trimmed);
        } catch (error) {
          context.stream.appendOrUpdate({
            id: `prov_key_failed_${Date.now()}`,
            type: "error",
            message: `Could not store the ${desc.name} API key: ${error instanceof Error ? error.message : String(error)}`,
          });
          return { handled: true, message: "auth_failed" };
        }
        // Drop any instance built against the previous (or missing) credential.
        context.providerCache?.clear();
        context.stream.appendOrUpdate({
          id: `prov_key_saved_${Date.now()}`,
          type: "message",
          role: "assistant",
          text: validation.unverifiable
            ? `Stored API key for ${desc.name} (the provider ships no key-check endpoint, so it was saved unchecked).`
            : `Verified and stored API key for ${desc.name} in secure credential store.`,
          finished: true,
        });
      } else {
        context.stream.appendOrUpdate({
          id: `prov_cancel_${Date.now()}`,
          type: "error",
          message: `Authentication cancelled for ${desc.name}. Previous credentials preserved.`,
        });
        return { handled: true, message: "auth_cancelled" };
      }
    } else {
      context.stream.appendOrUpdate({
        id: `prov_ambient_note_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: `Using ambient ${desc.defaultEnvVar ?? "API key"} for ${desc.name}.`,
        finished: true,
      });
    }
  } else if (!isAuthed && desc.authKinds.includes("oauth")) {
    // OAuth flow
    try {
      await runOAuthLogin(providerId, desc.packageSubpath, context);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      context.stream.appendOrUpdate({
        id: `oauth_err_${Date.now()}`,
        type: "error",
        message: `OAuth login failed for ${desc.name}: ${msg}. Previous credentials preserved.`,
      });
      return { handled: true, message: "auth_failed" };
    }
  }

  // Switch provider, default to its catalog model (never a literal "default"), then open the model picker.
  context.status.update({ provider: providerId });
  context.onUpdateState({ footer: { ...context.state.footer, provider: providerId } });

  // A model already pinned for this provider wins: `--model opencode-go/<id>` (or a stored pick) must
  // not be replaced by the catalog default just because the user ran /provider to add the key.
  const preferred = await defaultModelForProvider(providerId);
  if (preferred && context.currentModel.provider !== providerId) applyModelSelection(context, preferred);

  const catalog = await getStaticModelsForProvider(providerId);
  if (catalog.length === 0) {
    if (!preferred) {
      // Host-defined catalogs (Azure deployments, Bedrock profiles, Vertex endpoints): keep the model id.
      applyModelSelection(context, { ...context.currentModel, provider: providerId });
      context.stream.appendOrUpdate({
        id: `prov_host_models_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: `Selected ${desc.name}. Model ids for this provider are host-defined; keeping "${context.currentModel.model}". Set model in prism-code.json if needed.`,
        finished: true,
      });
    }
    return { handled: true };
  }

  const ordered = preferred ? [preferred, ...catalog.filter((m) => m.model !== preferred.model)] : [...catalog];
  const chosen = await showModelPicker(
    context,
    providerId,
    ordered.map((model) => ({ model, isLive: false })),
  );
  if (chosen) applyModelSelection(context, chosen);

  return { handled: true };
}

/**
 * /model slash command:
 * 1. Checks that active provider is authenticated.
 * 2. Calls live model discovery (listModelsForProvider) with static catalog fallback on timeout/error.
 * 3. Shows searchable picker with model choices.
 * 4. Revalidates effort level against selected model.
 */
export async function executeModelCommand(context: CommandContext): Promise<SlashCommandResult> {
  const currentProviderId = context.state.footer.provider;
  const desc = getShippedProvider(currentProviderId);

  // Check auth
  const isAuthed = await context.credentialManager.hasCredentials(currentProviderId);
  if (!isAuthed && desc && desc.authKinds.includes("api_key")) {
    context.stream.appendOrUpdate({
      id: `model_unauthed_${Date.now()}`,
      type: "error",
      message: `Provider "${currentProviderId}" is not authenticated. Please run /provider first.`,
    });
    return { handled: true };
  }

  context.stream.appendOrUpdate({
    id: `model_discovering_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Discovering models for ${desc?.name ?? currentProviderId}...`,
    finished: true,
  });

  // Live model discovery with static fallback
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 6000);

  let models: readonly import("../providers.js").DiscoveredModelInfo[] = [];
  try {
    models = await listModelsForProvider(currentProviderId, {
      credentialManager: context.credentialManager,
      signal: abortController.signal,
      ttlMs: 0,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `model_err_${Date.now()}`,
      type: "error",
      message: `Model discovery failed: ${msg}`,
    });
    return { handled: true };
  } finally {
    clearTimeout(timeoutId);
  }

  if (models.length === 0) {
    context.stream.appendOrUpdate({
      id: `no_models_${Date.now()}`,
      type: "error",
      message: `No models found for provider "${currentProviderId}".`,
    });
    return { handled: true };
  }

  const chosenModel = await showModelPicker(context, currentProviderId, models);
  if (!chosenModel) {
    return { handled: true }; // Cancelled
  }
  const newEffort = applyModelSelection(context, chosenModel);

  context.stream.appendOrUpdate({
    id: `model_selected_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Switched active model to ${chosenModel.displayName ?? chosenModel.model} [effort: ${newEffort}].`,
    finished: true,
  });

  return { handled: true };
}

/**
 * Executes registered OAuth login flow without leaking credentials into TUI history.
 */
async function runOAuthLogin(providerId: string, _subpath: string, context: CommandContext): Promise<void> {
  const callbacks: OAuthLoginCallbacks = {
    onAuth: async (authUrl: string) => {
      context.stream.appendOrUpdate({
        id: `oauth_url_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: `Open this URL in your browser to authorize:\n${authUrl}`,
        finished: true,
      });
    },
    onDeviceCode: async (deviceCode: { userCode: string; verificationUri: string }) => {
      context.stream.appendOrUpdate({
        id: `oauth_code_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: `Device authorization code: ${deviceCode.userCode}\nVisit: ${deviceCode.verificationUri}`,
        finished: true,
      });
    },
    onPrompt: async (promptText: string) => {
      if (context.promptSecret) {
        return context.promptSecret(promptText);
      }
      return undefined;
    },
  };

  if (providerId === "openai-codex") {
    const mod = await import("@arnilo/prism-providers/openai");
    const credentials = await mod.openAICodexOAuthProvider.login(callbacks);
    await context.credentialManager.setOAuth(providerId, credentials);
  } else if (providerId === "xai") {
    const mod = await import("@arnilo/prism-providers/xai");
    const oauthProvider = mod.createXaiOAuthProvider();
    const credentials = await oauthProvider.login(callbacks);
    await context.credentialManager.setOAuth(providerId, credentials);
  }
  // A previously cached instance would keep serving the old (or missing) credential.
  context.providerCache?.clear();
}

/**
 * /logout [provider]:
 * 1. Resolves the provider (explicit arg, or a picker over providers with stored credentials).
 * 2. Revokes upstream OAuth tokens when the provider supports it, then always deletes the stored
 *    OAuth and API-key entries locally (fail closed).
 * 3. Never touches environment variables, and never echoes token or key values.
 */
export async function executeLogoutCommand(context: CommandContext, providerArg?: string): Promise<SlashCommandResult> {
  let providerId = providerArg?.trim().toLowerCase();

  if (providerId && !getShippedProvider(providerId)) {
    context.stream.appendOrUpdate({
      id: `logout_unknown_${Date.now()}`,
      type: "error",
      message: `Unknown provider "${providerArg}". Usage: /logout [provider]`,
    });
    return { handled: true };
  }

  if (!providerId) {
    let stored: Array<{ provider: string; kind: string }>;
    try {
      stored = await listStoredCredentialProviders(context.credentialManager);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.stream.appendOrUpdate({
        id: `logout_store_${Date.now()}`,
        type: "error",
        message: `Cannot read the credential store: ${message}`,
      });
      return { handled: true };
    }

    if (stored.length === 0) {
      context.stream.appendOrUpdate({
        id: `logout_none_${Date.now()}`,
        type: "error",
        message:
          "No stored credentials to remove. /logout deletes stored API keys and OAuth tokens; environment variables must be unset in your shell.",
      });
      return { handled: true };
    }
    if (stored.length === 1) {
      providerId = stored[0]?.provider;
    } else {
      const choice = await context.picker.show(
        "Sign out of which provider?",
        stored.map((entry) => ({
          name: getShippedProvider(entry.provider)?.name ?? entry.provider,
          value: entry.provider,
          description: entry.kind,
        })),
      );
      providerId = choice?.value;
    }
  }

  if (!providerId) return { handled: true };

  const result = await logoutProvider(providerId, context.credentialManager);
  const name = getShippedProvider(providerId)?.name ?? providerId;
  const removed: string[] = [];
  if (result.oauthDeleted) removed.push(result.oauthRevoked ? "revoked and deleted OAuth tokens" : "deleted stored OAuth tokens");
  if (result.apiKeyDeleted) removed.push("deleted stored API key");

  const text =
    removed.length > 0
      ? `Signed out of ${name}: ${removed.join(", ")}.${result.revokeError ? ` Upstream revocation failed (${result.revokeError}); stored credentials were deleted locally.` : ""} Environment variables are not affected.`
      : `No stored credentials found for ${name}. Environment variables (if any) are not affected.`;
  if (removed.length > 0) {
    // The cached instance may hold the credentials we just deleted; force a fresh resolution.
    context.providerCache?.clear();
    context.stream.appendOrUpdate({
      id: `logout_done_${Date.now()}`,
      type: "message",
      role: "assistant",
      text,
      finished: true,
    });
  } else {
    context.stream.appendOrUpdate({ id: `logout_none_${Date.now()}`, type: "error", message: text });
  }

  return { handled: true };
}

/** Providers with stored OAuth or API-key entries; never includes env-only providers. */
async function listStoredCredentialProviders(
  credentialManager: PrismCodeCredentialManager,
): Promise<Array<{ provider: string; kind: string }>> {
  const store = credentialManager.getStore();
  const seen = new Map<string, string>();
  for (const entry of await store.listOAuth()) {
    if (!seen.has(entry.provider)) seen.set(entry.provider, "oauth");
  }
  for (const record of await store.list()) {
    if (record.provider && !seen.has(record.provider)) seen.set(record.provider, "stored key");
  }
  return [...seen].map(([provider, kind]) => ({ provider, kind }));
}

/**
 * /new slash command:
 * Creates and persists a fresh session record with same trusted repo settings and no prior transcript.
 * Refuses if a run is currently active.
 */
/** `/clear`: wipe the transcript, then start a fresh session (alias of `/new` with a screen clear). */
export async function executeClearCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `clear_err_${Date.now()}`,
      type: "error",
      message: "Cannot clear while a run is in progress.",
    });
    return { handled: true };
  }
  context.stream.clear();
  return executeNewSessionCommand(context);
}

/** `/exit`: host-owned shutdown; never reached without a TUI host hook. */
export function executeExitCommand(context: CommandContext): SlashCommandResult {
  if (!context.requestExit) {
    context.stream.appendOrUpdate({
      id: `exit_err_${Date.now()}`,
      type: "error",
      message: "/exit is not available in this host.",
    });
    return { handled: true };
  }
  context.requestExit(0);
  return { handled: true };
}

/** Names of tools currently registered in the session (MCP session-disable removes them). */
function activeToolNames(context: CommandContext): ReadonlySet<string> {
  const tools = context.definition?.agent.config.tools as unknown;
  const registry = tools && !Array.isArray(tools) ? (tools as { list?: () => readonly ToolDefinition[] }) : undefined;
  const names = new Set<string>();
  for (const tool of registry?.list?.() ?? []) names.add(tool.name);
  return names;
}

/** `/tools`: active inventory grouped by source, with web diagnostics from the assembly. */
export function formatToolInventory(context: CommandContext): string {
  const active = activeToolNames(context);
  const sections: string[] = [];

  const bundled = (defaultOn: boolean): string[] =>
    BUNDLED_CODING_TOOLS.filter((tool) => tool.defaultOn === defaultOn).map((tool) => {
      if (active.has(tool.name)) return `  \u2022 ${tool.name} \u2014 on`;
      const reason = defaultOn ? "excluded or replaced" : tool.category === "check" ? "needs config checks" : "opt-in";
      return `  \u2022 ${tool.name} \u2014 off (${reason})`;
    });
  const builtIn = bundled(true);
  if (builtIn.length > 0) sections.push(`Built-in:\n${builtIn.join("\n")}`);
  const optIn = bundled(false);
  if (optIn.length > 0) sections.push(`Opt-in:\n${optIn.join("\n")}`);

  const mcpStatuses = context.definition?.mcp.status ?? [];
  if (mcpStatuses.length > 0) {
    const disabled = context.mcpSession?.disabled;
    const lines = mcpStatuses.map((status) => {
      const sessionDisabled = disabled?.has(status.serverId) === true;
      const detail = status.error ? ` \u2014 ${status.error}` : status.reason ? ` \u2014 ${status.reason}` : "";
      return `  \u2022 ${status.serverId} \u2014 ${sessionDisabled ? "off (this session)" : status.state}, ${status.toolCount} tools${detail}`;
    });
    sections.push(`MCP:\n${lines.join("\n")}`);
  }

  const web = context.webResolution;
  if (web) {
    const names = web.toolNames.length > 0 ? web.toolNames.join(", ") : "none";
    const reason = web.unavailableReason ? `\n  \u2022 unavailable: ${web.unavailableReason}` : "";
    const notes = web.notes.length > 0 ? `\n  \u2022 ${web.notes.join("\n  \u2022 ")}` : "";
    sections.push(`Web (mode ${web.mode}):\n  \u2022 ${names}${reason}${notes}`);
  }

  const known = new Set(BUNDLED_CODING_TOOLS.map((tool) => tool.name));
  for (const name of web?.toolNames ?? []) known.add(name);
  for (const status of mcpStatuses) {
    for (const tool of context.definition?.mcp.getServerTools(status.serverId) ?? []) known.add(tool.name);
  }
  const custom = [...active].filter((name) => !known.has(name)).sort();
  if (custom.length > 0) sections.push(`User modules:\n${custom.map((name) => `  \u2022 ${name} \u2014 on`).join("\n")}`);

  return `Tools \u2014 ${active.size} active\n${sections.join("\n")}`;
}

export function executeToolsCommand(context: CommandContext): SlashCommandResult {
  context.stream.appendOrUpdate({
    id: `tools_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: boundCommandText(formatToolInventory(context)),
    finished: true,
  });
  return { handled: true };
}

function textBlocksOf(message: Message): string {
  return message.content
    .map((block) => (block.type === "text" && !block.text.startsWith("[attached file: ") ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function entryToMarkdown(entry: SessionEntry): string[] {
  if (entry.kind === "compaction") return ["## Summary", "", entry.summary ?? "", ""];
  const message = entry.message;
  if (!message) return [];

  if (message.role === "user") {
    const text = textBlocksOf(message);
    return text ? ["## User", "", text, ""] : [];
  }
  if (message.role === "tool") {
    const lines: string[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const body = block.error ? `error: ${block.error.message ?? "failed"}` : boundCommandText(String(block.result ?? ""));
      lines.push(`### Tool result: ${block.name}`, "", "```", body, "```", "");
    }
    return lines;
  }
  if (message.role !== "assistant") return [];

  const lines: string[] = [];
  let assistantOpen = false;
  for (const block of message.content) {
    if (block.type === "text") {
      if (!assistantOpen) {
        lines.push("## Assistant", "");
        assistantOpen = true;
      }
      lines.push(block.text, "");
    } else if (block.type === "thinking") {
      lines.push("<details><summary>Thinking</summary>", "", block.text, "", "</details>", "");
    } else if (block.type === "tool_call") {
      lines.push(`### Tool call: ${block.name}`, "", "```json", boundCommandText(JSON.stringify(block.arguments, null, 2)), "```", "");
    } else if (block.type === "tool_result") {
      const body = block.error ? `error: ${block.error.message ?? "failed"}` : boundCommandText(String(block.result ?? ""));
      lines.push(`### Tool result: ${block.name}`, "", "```", body, "```", "");
    }
  }
  return lines;
}

/** Session transcript as markdown; entries arrive already redacted by the caller. */
export function formatSessionMarkdown(sessionId: string, cwd: string, entries: readonly SessionEntry[]): string {
  const lines = [
    `# Prism session ${sessionId}`,
    "",
    `- Repository: \`${cwd}\``,
    `- Exported: ${new Date().toISOString()}`,
    `- Entries: ${entries.length}`,
    "",
    "---",
    "",
  ];
  for (const entry of entries) lines.push(...entryToMarkdown(entry));
  return `${lines.join("\n")}\n`;
}

/** `/export [path]`: writes the transcript as markdown (0600), confirming an overwrite. */
export async function executeExportCommand(context: CommandContext, rawPath: string | undefined): Promise<SlashCommandResult> {
  const session = context.session;
  if (!session) {
    context.stream.appendOrUpdate({
      id: `export_err_${Date.now()}`,
      type: "error",
      message: "No active session to export.",
    });
    return { handled: true };
  }

  const target = rawPath ? resolve(context.config.cwd, rawPath) : resolve(context.config.cwd, `prism-session-${session.id}.md`);
  if (existsSync(target)) {
    const answer = await context.picker.show(`Overwrite ${target}?`, [
      { name: "No", value: "no" },
      { name: "Yes", value: "yes" },
    ]);
    if (answer?.value !== "yes") {
      context.stream.appendOrUpdate({
        id: `export_cancelled_${Date.now()}`,
        type: "message",
        role: "assistant",
        text: "Export cancelled.",
        finished: true,
      });
      return { handled: true };
    }
  }

  const redactor = context.definition?.agent.config.redactor;
  const entries = (await session.entries()).map((entry) => redactSessionEntry(entry, redactor));
  const text = formatSessionMarkdown(session.id, context.config.cwd, entries);
  try {
    writeFileSync(target, text, { mode: 0o600 });
    chmodSync(target, 0o600);
  } catch (error) {
    context.stream.appendOrUpdate({
      id: `export_err_${Date.now()}`,
      type: "error",
      message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { handled: true };
  }

  context.stream.appendOrUpdate({
    id: `export_done_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Exported ${entries.length} entries to ${target}`,
    finished: true,
  });
  return { handled: true };
}

export async function executeNewSessionCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `new_err_${Date.now()}`,
      type: "error",
      message: "Cannot create a new session while a run is in progress.",
    });
    return { handled: true };
  }

  if (!context.definition) {
    context.stream.appendOrUpdate({
      id: `new_err_${Date.now()}`,
      type: "error",
      message: "Agent runtime not initialized.",
    });
    return { handled: true };
  }

  const newSessionId = `session_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const canonicalRoot = getCanonicalWorkspaceRoot(context.config.cwd);

  await ensureDurableSessionRecord(context.store, newSessionId, canonicalRoot, {
    userId: context.config.userId,
  });

  const newSession = context.definition.createSession({
    id: newSessionId,
    metadata: {
      [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: canonicalRoot,
      userId: context.config.userId ?? "local",
    },
  });

  if (context.onSwitchSession) {
    await context.onSwitchSession(newSession, []);
  }

  context.stream.appendOrUpdate({
    id: `new_done_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Created new session: ${newSessionId}`,
    finished: true,
  });
  return { handled: true };
}

/**
 * /rename slash command: sets (or replaces) the session title stored in session metadata.
 * The title is display-only; failures are surfaced without aborting the session.
 */
export async function executeRenameCommand(context: CommandContext, rawTitle: string | undefined): Promise<SlashCommandResult> {
  const redactor = context.definition?.agent.config.redactor;
  const redactedTitle = rawTitle && redactor ? redactor.redact(rawTitle) : rawTitle;
  const title = redactedTitle ? deriveSessionTitle(redactedTitle) : undefined;
  if (!title) {
    context.stream.appendOrUpdate({
      id: `rename_usage_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: "Usage: /rename <title>",
      finished: true,
    });
    return { handled: true };
  }

  const sessionId = context.state.sessionId ?? context.session?.id;
  if (!sessionId) {
    context.stream.appendOrUpdate({
      id: `rename_err_${Date.now()}`,
      type: "error",
      message: "No active session to rename.",
    });
    return { handled: true };
  }

  let updated = false;
  try {
    updated = await setSessionTitle(context.store, sessionId, title);
  } catch (error) {
    context.stream.appendOrUpdate({
      id: `rename_err_${Date.now()}`,
      type: "error",
      message: `Could not rename session: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { handled: true };
  }

  context.stream.appendOrUpdate({
    id: `rename_done_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: updated ? `Session title set: ${title}` : "This session store does not support titles; keeping the session id as its name.",
    finished: true,
  });
  return { handled: true };
}

/**
 * /resume slash command:
 * Opens searchable chooser of all sessions for the canonical repository root (newest first).
 * Refuses if a run is currently active or if store is in-memory.
 */
export async function executeResumeSessionCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `resume_err_${Date.now()}`,
      type: "error",
      message: "Cannot resume session while a run is in progress.",
    });
    return { handled: true };
  }

  if (context.config.store?.type === "memory" || typeof context.store.searchSessions !== "function") {
    context.stream.appendOrUpdate({
      id: `resume_err_${Date.now()}`,
      type: "error",
      message: "Session resumption is not supported with in-memory session store. Configure a durable SQLite store in prism-code.json.",
    });
    return { handled: true };
  }

  const canonicalRoot = getCanonicalWorkspaceRoot(context.config.cwd);
  let result: { items: readonly SessionSearchHit[]; nextCursor?: string };
  try {
    result = await searchRepoSessions(context.store, {
      workspaceRoot: canonicalRoot,
      limit: 20,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `resume_err_${Date.now()}`,
      type: "error",
      message: msg,
    });
    return { handled: true };
  }

  if (result.items.length === 0) {
    context.stream.appendOrUpdate({
      id: `resume_empty_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `No prior sessions found for repository: ${canonicalRoot}`,
      finished: true,
    });
    return { handled: true };
  }

  const hitsBySessionId = new Map<string, SessionSearchHit>();
  const options: UiPickerOption[] = result.items.map((hit) => {
    hitsBySessionId.set(hit.sessionId, hit);
    const opt = formatSessionOption(hit, context.state.sessionId);
    return {
      name: opt.name,
      value: opt.value,
      description: opt.description,
    };
  });

  const selected = await context.picker.show("Resume Session", options);
  if (!selected) {
    return { handled: true };
  }

  const targetSessionId = selected.value;
  if (targetSessionId === context.state.sessionId) {
    context.stream.appendOrUpdate({
      id: `resume_same_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Already on session ${targetSessionId}`,
      finished: true,
    });
    return { handled: true };
  }

  if (!context.definition) {
    return { handled: true };
  }

  const hit = hitsBySessionId.get(targetSessionId);
  const resumedSession = context.definition.createSession({
    id: targetSessionId,
    leafId: hit?.leafId,
    metadata: {
      [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: canonicalRoot,
      userId: context.config.userId ?? "local",
    },
  });

  const entries = await resumedSession.entries();
  if (context.onSwitchSession) {
    await context.onSwitchSession(resumedSession, entries);
  }

  context.stream.appendOrUpdate({
    id: `resume_done_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: `Resumed session ${targetSessionId}${hit?.leafId ? ` (leaf: ${hit.leafId.slice(0, 8)})` : ""}`,
    finished: true,
  });
  return { handled: true };
}

/**
 * /compact slash command:
 * Compacts session history using createCodingCompactionStrategy with current authenticated provider/model.
 * Refuses while run is active. Leaves session leaf untouched on error.
 */
export async function executeCompactCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `compact_err_${Date.now()}`,
      type: "error",
      message: "Cannot compact session while a run is in progress.",
    });
    return { handled: true };
  }

  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `compact_err_${Date.now()}`,
      type: "error",
      message: "No active session to compact.",
    });
    return { handled: true };
  }

  let provider: AIProvider;
  try {
    provider = context.providerCache
      ? await context.providerCache.prime(context.currentModel)
      : await resolveProvider(context.currentModel, {
          credentialRef: context.config.credentialRef,
          resolver: context.credentialManager.createResolver(),
          credentialManager: context.credentialManager,
        });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `compact_err_${Date.now()}`,
      type: "error",
      message: `Compaction failed: Provider "${context.currentModel.provider}" is not authenticated or could not be resolved. (${msg})`,
    });
    return { handled: true };
  }

  context.stream.appendOrUpdate({
    id: `compact_start_${Date.now()}`,
    type: "message",
    role: "assistant",
    text: "Compacting session history with LLM summary...",
    finished: true,
  });

  try {
    const result = await compactSession({
      session: context.session,
      provider,
      model: context.currentModel,
    });

    context.stream.appendOrUpdate({
      id: `compact_done_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Session history compacted successfully.\n\nSummary:\n${result.summary}`,
      finished: true,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `compact_err_${Date.now()}`,
      type: "error",
      message: `Compaction failed: ${msg}`,
    });
  }

  return { handled: true };
}

/**
 * /om slash command:
 * Toggles observational memory per session off/on (default off).
 * Switching while active run/worker flush is refused safely.
 */
export async function executeOmToggleCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `om_denied_${Date.now()}`,
      type: "error",
      message: "Cannot toggle observational memory while an agent run is active.",
    });
    return { handled: true };
  }

  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `om_err_${Date.now()}`,
      type: "error",
      message: "No active session to toggle observational memory.",
    });
    return { handled: true };
  }

  const coordinator =
    context.omCoordinator ??
    new ObservationalMemoryCoordinator({
      config: context.config,
      store: context.store,
      credentialManager: context.credentialManager,
    });

  if (coordinator.isFlushInFlight(context.session.id)) {
    context.stream.appendOrUpdate({
      id: `om_flush_${Date.now()}`,
      type: "error",
      message: "Cannot toggle observational memory while worker flush is in flight. Please wait.",
    });
    return { handled: true };
  }

  try {
    const result = await coordinator.toggleSession(context.session, context.currentModel, context.store, context.config.cwd);

    const workerModelStr = `${result.workerModel.provider}/${result.workerModel.model}`;
    const statusMsg = result.enabled
      ? `Observational memory enabled for session ${context.session.id} (worker: ${workerModelStr}).`
      : `Observational memory disabled for session ${context.session.id}.`;

    context.stream.appendOrUpdate({
      id: `om_toggle_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: statusMsg,
      finished: true,
    });

    context.status.update({
      omEnabled: result.enabled,
      omModel: result.enabled ? workerModelStr : undefined,
    });

    context.onUpdateState({
      footer: {
        ...context.state.footer,
        omEnabled: result.enabled,
        omModel: result.enabled ? workerModelStr : undefined,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `om_err_${Date.now()}`,
      type: "error",
      message: `Failed to toggle observational memory: ${msg}`,
    });
  }

  return { handled: true };
}

/**
 * /om-model slash command:
 * Lists authenticated models and allows selecting an independent observer/reflector/dropper model.
 * Selection survives new process resume for that session.
 */
export async function executeOmModelCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (context.state.isRunning) {
    context.stream.appendOrUpdate({
      id: `om_model_denied_${Date.now()}`,
      type: "error",
      message: "Cannot change observational memory model while an agent run is active.",
    });
    return { handled: true };
  }

  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `om_model_err_${Date.now()}`,
      type: "error",
      message: "No active session.",
    });
    return { handled: true };
  }

  const coordinator =
    context.omCoordinator ??
    new ObservationalMemoryCoordinator({
      config: context.config,
      store: context.store,
      credentialManager: context.credentialManager,
    });

  if (coordinator.isFlushInFlight(context.session.id)) {
    context.stream.appendOrUpdate({
      id: `om_model_flush_${Date.now()}`,
      type: "error",
      message: "Cannot change observational memory model while worker flush is in flight. Please wait.",
    });
    return { handled: true };
  }

  // 1. Same-model option first
  const options: UiPickerOption[] = [
    {
      name: `Same as active session model (${context.currentModel.provider}/${context.currentModel.model})`,
      value: "__same__",
      description: "Observer, reflector, and dropper use the active session model",
    },
  ];

  // 2. Discover authenticated models across shipped providers
  for (const provider of SHIPPED_PROVIDERS) {
    const isAuthed = await context.credentialManager.hasCredentials(provider.id);
    if (!isAuthed) continue;

    const catalog = await getStaticModelsForProvider(provider.id);
    for (const model of catalog) {
      options.push({
        name: `${provider.id}/${model.model} (${model.displayName ?? model.model})`,
        value: `${provider.id}:${model.model}`,
        description: `Provider: ${provider.name} | ${model.capabilities?.reasoning ? "reasoning" : "standard"}`,
      });
    }
  }

  const selected = await context.picker.show("Select OM Worker Model", options);
  if (!selected) {
    return { handled: true }; // Cancelled
  }

  try {
    let newWorkerModel: ModelConfig | undefined;
    if (selected.value !== "__same__") {
      const [pId, ...mRest] = selected.value.split(":");
      const modelName = mRest.join(":");
      const isAuthed = await context.credentialManager.hasCredentials(pId);
      if (!isAuthed) {
        throw new PrismCodeExecutionError(`Provider "${pId}" is not authenticated. Please run /provider first.`);
      }
      newWorkerModel = { provider: pId, model: modelName };
    }

    const result = await coordinator.setSessionWorkerModel(
      context.session,
      newWorkerModel,
      context.currentModel,
      context.store,
      context.config.cwd,
    );

    const isEnabled = coordinator.isSessionEnabled(context.session.id);
    const workerModelStr = `${result.workerModel.provider}/${result.workerModel.model}`;

    context.stream.appendOrUpdate({
      id: `om_model_set_${Date.now()}`,
      type: "message",
      role: "assistant",
      text: `Observational memory worker model set to ${newWorkerModel ? workerModelStr : `same as session (${workerModelStr})`} for session ${context.session.id}.`,
      finished: true,
    });

    if (isEnabled) {
      context.status.update({
        omModel: workerModelStr,
      });
      context.onUpdateState({
        footer: {
          ...context.state.footer,
          omModel: workerModelStr,
        },
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `om_model_err_${Date.now()}`,
      type: "error",
      message: `Failed to set observational memory model: ${msg}`,
    });
  }

  return { handled: true };
}

/**
 * /om:status slash command:
 * Shows observational memory counts and thresholds for the current session.
 */
export async function executeOmStatusCommand(context: CommandContext): Promise<SlashCommandResult> {
  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `om_status_err_${Date.now()}`,
      type: "error",
      message: "No active session.",
    });
    return { handled: true };
  }

  const coordinator =
    context.omCoordinator ??
    new ObservationalMemoryCoordinator({
      config: context.config,
      store: context.store,
      credentialManager: context.credentialManager,
    });

  try {
    const statusCmd = createMemoryStatusCommand({
      getEntries: async (sid) => {
        if (context.session && context.session.id === sid) {
          return await context.session.entries();
        }
        return await context.store.list(sid);
      },
      runtimeStatus: () => ({
        inFlight: coordinator.isFlushInFlight(context.session?.id ?? ""),
        lastError: coordinator.getLastError(context.session?.id ?? ""),
      }),
    });

    const result = await statusCmd.execute({}, { sessionId: context.session.id, command: "om:status" } as any);
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : JSON.stringify(result.value);

    context.stream.appendOrUpdate({
      id: `om_status_${Date.now()}`,
      type: "message",
      role: "assistant",
      text,
      finished: true,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `om_status_err_${Date.now()}`,
      type: "error",
      message: `Failed to get observational memory status: ${msg}`,
    });
  }

  return { handled: true };
}

/**
 * /om:view slash command:
 * Renders visible observational memory, or full recorded memory with mode=full.
 */
export async function executeOmViewCommand(context: CommandContext, mode?: string): Promise<SlashCommandResult> {
  if (!context.session) {
    context.stream.appendOrUpdate({
      id: `om_view_err_${Date.now()}`,
      type: "error",
      message: "No active session.",
    });
    return { handled: true };
  }

  try {
    const viewCmd = createMemoryViewCommand({
      getEntries: async (sid) => {
        if (context.session && context.session.id === sid) {
          return await context.session.entries();
        }
        return await context.store.list(sid);
      },
    });

    const args: Record<string, string> = {};
    if (mode) {
      args.mode = mode;
    }
    const result = await viewCmd.execute(args, { sessionId: context.session.id, command: "om:view" } as any);
    if (result.error) {
      context.stream.appendOrUpdate({
        id: `om_view_err_${Date.now()}`,
        type: "error",
        message: result.error.message,
      });
      return { handled: true };
    }

    const text = result.content?.[0]?.type === "text" ? result.content[0].text : JSON.stringify(result.value);
    context.stream.appendOrUpdate({
      id: `om_view_${Date.now()}`,
      type: "message",
      role: "assistant",
      text,
      finished: true,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    context.stream.appendOrUpdate({
      id: `om_view_err_${Date.now()}`,
      type: "error",
      message: `Failed to view observational memory: ${msg}`,
    });
  }

  return { handled: true };
}

// ---------------------------------------------------------------------------
// /mcp
// ---------------------------------------------------------------------------

function mcpError(context: CommandContext, message: string): SlashCommandResult {
  context.stream.appendOrUpdate({ id: `mcp_err_${Date.now()}`, type: "error", message });
  return { handled: true };
}

function mcpMessage(context: CommandContext, text: string): void {
  context.stream.appendOrUpdate({
    id: `mcp_msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    text,
    finished: true,
  });
}

function mcpUsage(context: CommandContext, reason?: string): SlashCommandResult {
  mcpMessage(context, `${reason ? `${reason}\n` : ""}Usage: /mcp [reconnect|login|disable|enable|tools] <serverId>`);
  return { handled: true };
}

function mcpServerConfig(context: CommandContext, serverId: string): PrismCodeMcpServer | undefined {
  return context.config.mcp?.servers?.find((server) => server.serverId === serverId);
}

function mcpTransportLabel(server: PrismCodeMcpServer | undefined): string {
  if (!server) return "unknown";
  if (server.url !== undefined) return server.transport ?? "streamable-http";
  return "stdio";
}

function mcpErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMcpServerLine(
  status: {
    readonly serverId: string;
    readonly state: string;
    readonly toolCount: number;
    readonly error?: string;
    readonly reason?: string;
  },
  server: PrismCodeMcpServer | undefined,
  sessionDisabled: boolean,
): string {
  const notes: string[] = [];
  if (sessionDisabled) notes.push("tools disabled for this session");
  if (status.error) notes.push(status.error);
  if (status.reason) notes.push(status.reason);
  const loginHint =
    status.state === "failed" && server?.url !== undefined && server.auth === "oauth" ? ` (run /mcp login ${status.serverId})` : "";
  const detail = notes.length > 0 ? ` — ${notes.join("; ")}` : "";
  return `• ${status.serverId} — ${status.state}, ${status.toolCount} tools, ${mcpTransportLabel(server)}${detail}${loginHint}`;
}

function scheduleMcpReconnect(context: CommandContext, serverId: string): void {
  const definition = context.definition;
  if (!definition) return;
  mcpMessage(context, `Reconnecting MCP server "${serverId}"…`);
  void definition.mcp.reconnect(serverId).then(
    (status) => {
      const error = status.error ? ` — ${status.error}` : "";
      mcpMessage(context, `MCP server "${serverId}": ${status.state}, ${status.toolCount} tools${error}`);
      context.refreshMcpFooter?.();
    },
    (error: unknown) => {
      mcpError(context, `MCP server "${serverId}" reconnect failed: ${mcpErrorMessage(error)}`);
      context.refreshMcpFooter?.();
    },
  );
}

export async function executeMcpCommand(context: CommandContext, args: readonly string[]): Promise<SlashCommandResult> {
  const sub = args[0]?.toLowerCase();
  const serverId = args[1];
  switch (sub) {
    case undefined:
      return renderMcpStatus(context);
    case "reconnect":
      return executeMcpReconnect(context, serverId);
    case "login":
      return executeMcpLogin(context, serverId);
    case "disable":
      return executeMcpSessionToggle(context, serverId, false);
    case "enable":
      return executeMcpSessionToggle(context, serverId, true);
    case "tools":
      return executeMcpTools(context, serverId);
    default:
      return mcpUsage(context, `Unknown /mcp subcommand "${sub}".`);
  }
}

/** Lists cached plane status only: no network calls, no header/env/token values. */
function renderMcpStatus(context: CommandContext): SlashCommandResult {
  context.refreshMcpFooter?.();
  const statuses = context.definition?.mcp.status ?? [];
  if (statuses.length === 0) {
    mcpMessage(context, "No MCP servers configured.");
    return { handled: true };
  }
  const disabled = context.mcpSession?.disabled;
  const lines = statuses.map((status) =>
    formatMcpServerLine(status, mcpServerConfig(context, status.serverId), disabled?.has(status.serverId) ?? false),
  );
  mcpMessage(context, `MCP servers:\n${lines.join("\n")}\nUsage: /mcp reconnect|login|disable|enable|tools <serverId>`);
  return { handled: true };
}

function executeMcpReconnect(context: CommandContext, serverId: string | undefined): SlashCommandResult {
  if (!serverId) return mcpUsage(context, "Missing server id.");
  const definition = context.definition;
  if (!definition) return mcpError(context, "MCP is not available before the agent is assembled.");
  if (!definition.mcp.status.some((status) => status.serverId === serverId)) {
    return mcpError(context, `Unknown MCP server "${serverId}".`);
  }
  // Async by design: reconnect continues in the background so the prompt stays usable.
  scheduleMcpReconnect(context, serverId);
  return { handled: true };
}

async function executeMcpLogin(context: CommandContext, serverId: string | undefined): Promise<SlashCommandResult> {
  if (!serverId) return mcpUsage(context, "Missing server id.");
  const server = mcpServerConfig(context, serverId);
  if (!server || server.url === undefined) {
    return mcpError(context, `MCP server "${serverId}" is not an HTTP server; OAuth login needs a url.`);
  }
  if (server.auth !== "oauth") {
    return mcpError(context, `MCP server "${serverId}" does not declare auth: "oauth".`);
  }
  const disabled = context.definition?.mcp.status.find((status) => status.serverId === serverId);
  if (disabled?.state === "disabled") {
    return mcpError(context, `MCP server "${serverId}" is disabled: ${disabled.reason ?? "not permitted"}`);
  }

  let authorizationUrl: URL | undefined;
  try {
    const authOptions = createMcpAuthOptions(server, {
      credentials: context.credentialManager,
      onRedirectRequired: (url) => {
        authorizationUrl = url;
      },
    });
    const parsed = new URL(server.url);
    const transport: McpStreamableHttpTransport = {
      type: "streamable-http",
      url: server.url,
      allowedOrigins: [parsed.origin],
      ...(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname) ? { allowLoopbackHttp: true } : {}),
      auth: authOptions,
    };
    const auth = createMcpClientAuth(authOptions, { serverUrl: server.url, fetch: createMcpOAuthFetch(transport) });
    const outcome = await auth.ensureAuthorized();
    if (outcome === "REDIRECT") {
      mcpMessage(
        context,
        authorizationUrl
          ? `Open this URL in your browser to authorize MCP server "${serverId}":\n${authorizationUrl.toString()}\nThen paste the callback URL or code here.`
          : `Authorization for MCP server "${serverId}" needs a browser round trip.`,
      );
      const pasted = await context.promptSecret?.(`Paste the callback URL or code for MCP server "${serverId}"`);
      if (!pasted || pasted.trim().length === 0) {
        mcpMessage(context, `MCP login for "${serverId}" cancelled.`);
        return { handled: true };
      }
      const trimmed = pasted.trim();
      await auth.finishAuth(/^https?:\/\//i.test(trimmed) ? new URL(trimmed).searchParams : trimmed);
    }
    mcpMessage(context, `MCP server "${serverId}" is authorized.`);
    scheduleMcpReconnect(context, serverId);
  } catch (error) {
    mcpError(context, `MCP login for "${serverId}" failed: ${mcpErrorMessage(error)}`);
  }
  return { handled: true };
}

function executeMcpSessionToggle(context: CommandContext, serverId: string | undefined, enable: boolean): SlashCommandResult {
  if (!serverId) return mcpUsage(context, "Missing server id.");
  if (!context.mcpSession) return mcpError(context, "Session MCP tool control is unavailable in this session.");
  if (enable) {
    const result = context.mcpSession.enable(serverId);
    if ("error" in result) return mcpError(context, result.error);
    mcpMessage(context, `MCP server "${serverId}": ${result.restored} tool(s) re-enabled for this session.`);
  } else {
    const result = context.mcpSession.disable(serverId);
    if ("error" in result) return mcpError(context, result.error);
    mcpMessage(context, `MCP server "${serverId}": ${result.removed} tool(s) disabled for this session.`);
  }
  return { handled: true };
}

function executeMcpTools(context: CommandContext, serverId: string | undefined): SlashCommandResult {
  if (!serverId) return mcpUsage(context, "Missing server id.");
  const tools = context.definition?.mcp.getServerTools(serverId) ?? [];
  if (tools.length === 0) {
    return mcpError(context, `MCP server "${serverId}" has no tools registered.`);
  }
  const lines = tools.map((tool) => `• ${tool.name}${tool.description ? ` — ${tool.description}` : ""}`);
  mcpMessage(context, boundCommandText(`Tools for MCP server "${serverId}":\n${lines.join("\n")}`));
  return { handled: true };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
