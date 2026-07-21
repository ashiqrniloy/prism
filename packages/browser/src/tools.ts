/**
 * Model-facing browser tools: browser_open, browser_snapshot, browser_act, browser_close.
 * All tools are statically exclusive; the manager also serializes per-run.
 */
import {
  assertExecutionAllowed,
  ExecutionDeniedError,
  type ContentBlock,
  type ExecutionPolicy,
  type JsonObject,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import type { BrowserDownloadOptions } from "./downloads.js";
import { BrowserError } from "./errors.js";
import type { BrowserLimitOptions } from "./limits.js";
import {
  createBrowserManager,
  type BrowserManager,
  type CreateBrowserManagerOptions,
} from "./manager.js";
import type { BrowserNetworkPolicy } from "./network.js";
import { buildBrowserExecutionAction, classifyBrowserOperation } from "./policy.js";
import type { BrowserActRequest, BrowserActionName, PlaywrightBrowser } from "./types.js";
import type { BrowserUploadOptions } from "./uploads.js";

export interface BrowserToolsOptions {
  readonly browser?: PlaywrightBrowser;
  readonly manager?: BrowserManager;
  readonly executionPolicy?: ExecutionPolicy;
  readonly limits?: BrowserLimitOptions;
  readonly networkPolicy?: BrowserNetworkPolicy;
  readonly uploads?: BrowserUploadOptions;
  readonly downloads?: BrowserDownloadOptions;
  readonly beforeSideEffect?: CreateBrowserManagerOptions["beforeSideEffect"];
}

const ACTION_NAMES = new Set<BrowserActionName>([
  "navigate",
  "click",
  "type",
  "fill",
  "select",
  "check",
  "uncheck",
  "scroll",
  "wait",
  "dialog",
  "select_page",
  "upload",
  "screenshot",
  "download_release",
]);

function errorResult(toolName: string, toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: toolName,
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function messageOf(error: unknown): string {
  if (error instanceof BrowserError) return error.message;
  if (error instanceof ExecutionDeniedError) return error.decision.reason ?? error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveManager(options: BrowserToolsOptions = {}): BrowserManager {
  if (options.manager) return options.manager;
  if (!options.browser) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_INPUT",
      "createBrowserTools requires browser or manager",
    );
  }
  const managerOptions: CreateBrowserManagerOptions = {
    browser: options.browser,
    limits: options.limits,
    networkPolicy: options.networkPolicy,
    uploads: options.uploads,
    downloads: options.downloads,
    beforeSideEffect: options.beforeSideEffect,
  };
  return createBrowserManager(managerOptions);
}

async function enforceBrowserPolicy(
  policy: ExecutionPolicy | undefined,
  toolCallId: string,
  toolName: string,
  action: {
    operation: string;
    paths?: readonly string[];
    dialogResponse?: "accept" | "dismiss";
    pageKind?: "main" | "popup";
    url?: string;
    metadata?: Readonly<Record<string, unknown>>;
  },
): Promise<{ allowed: true } | { allowed: false; result: ToolResult }> {
  if (!policy) return { allowed: true };
  try {
    const execAction = buildBrowserExecutionAction({
      operation: action.operation,
      paths: action.paths,
      dialogResponse: action.dialogResponse,
      pageKind: action.pageKind,
      url: action.url,
      metadata: action.metadata,
      runId: typeof action.metadata?.runId === "string" ? action.metadata.runId : undefined,
      sessionId: typeof action.metadata?.sessionId === "string" ? action.metadata.sessionId : undefined,
      pageId: typeof action.metadata?.pageId === "string" ? action.metadata.pageId : undefined,
    });
    await assertExecutionAllowed(policy, execAction);
    return { allowed: true };
  } catch (error) {
    return { allowed: false, result: errorResult(toolName, toolCallId, messageOf(error)) };
  }
}

function parseActRequest(args: JsonObject): BrowserActRequest {
  const action = args.action;
  if (typeof action !== "string" || !ACTION_NAMES.has(action as BrowserActionName)) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "browser_act requires a supported action");
  }
  const clip =
    args.clip && typeof args.clip === "object" && !Array.isArray(args.clip)
      ? (args.clip as Record<string, unknown>)
      : undefined;
  const request: BrowserActRequest = {
    action: action as BrowserActionName,
    ...(args.target !== undefined ? { target: args.target as BrowserActRequest["target"] } : {}),
    ...(typeof args.snapshotId === "string" ? { snapshotId: args.snapshotId } : {}),
    ...(typeof args.pageId === "string" ? { pageId: args.pageId } : {}),
    ...(typeof args.url === "string" ? { url: args.url } : {}),
    ...(typeof args.text === "string" ? { text: args.text } : {}),
    ...(Array.isArray(args.values) ? { values: args.values.map(String) } : {}),
    ...(Array.isArray(args.paths) ? { paths: args.paths.map(String) } : {}),
    ...(typeof args.downloadId === "string" ? { downloadId: args.downloadId } : {}),
    ...(args.fullPage === true ? { fullPage: true } : {}),
    ...(clip &&
    typeof clip.x === "number" &&
    typeof clip.y === "number" &&
    typeof clip.width === "number" &&
    typeof clip.height === "number"
      ? { clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } }
      : {}),
    ...(args.direction === "up" || args.direction === "down" ? { direction: args.direction } : {}),
    ...(typeof args.amount === "number" ? { amount: args.amount } : {}),
    ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.dialogResponse === "accept" || args.dialogResponse === "dismiss"
      ? { dialogResponse: args.dialogResponse }
      : {}),
    ...(typeof args.promptText === "string" ? { promptText: args.promptText } : {}),
  };
  return request;
}

export function createBrowserTools(options: BrowserToolsOptions = {}): ToolDefinition[] {
  const manager = resolveManager(options);
  const policy = options.executionPolicy;

  const browserOpen: ToolDefinition = {
    name: "browser_open",
    description:
      "Open or reuse the run-owned non-persistent browser context. Optionally navigate to an absolute http(s) URL. Host supplies the Playwright browser; Prism never launches or downloads browsers. External egress requires host contained-proxy attestation.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional absolute http(s) URL to open" },
      },
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("browser_open", toolCallId, "Operation aborted");
      const url = typeof args.url === "string" ? args.url : undefined;
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_open", {
        operation: "open",
        url,
        metadata: { runId: context.runId, sessionId: context.sessionId, url },
      });
      if (!gate.allowed) return gate.result;
      try {
        const result = await manager.open(context.runId, { url, signal: context.signal });
        return {
          toolCallId,
          name: "browser_open",
          content: [
            {
              type: "text",
              text: `Opened browser run=${result.runId} page=${result.pageId} url=${result.url || "(blank)"}`,
            },
          ],
          value: result,
          metadata: { trust: "untrusted_external", pageId: result.pageId },
        };
      } catch (error) {
        return errorResult("browser_open", toolCallId, messageOf(error));
      }
    },
  };

  const browserSnapshot: ToolDefinition = {
    name: "browser_snapshot",
    description:
      "Capture a bounded AI-mode accessibility snapshot with snapshot-scoped refs. Refs are invalid after navigation or action; re-snapshot before interacting by ref. Snapshot text is untrusted external content.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Optional page id; defaults to the active page" },
      },
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("browser_snapshot", toolCallId, "Operation aborted");
      const pageId = typeof args.pageId === "string" ? args.pageId : undefined;
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_snapshot", {
        operation: "snapshot",
        metadata: { runId: context.runId, sessionId: context.sessionId, pageId },
      });
      if (!gate.allowed) return gate.result;
      try {
        const result = await manager.snapshot(context.runId, { pageId, signal: context.signal });
        const header = [
          `snapshotId=${result.snapshotId}`,
          `pageId=${result.pageId}`,
          `url=${result.url}`,
          `title=${result.title}`,
          `refs=${result.refCount}`,
          result.truncated ? `truncatedBy=${result.truncatedBy ?? "yes"}` : "truncated=false",
          "",
          result.ariaSnapshot,
        ].join("\n");
        return {
          toolCallId,
          name: "browser_snapshot",
          content: [{ type: "text", text: header }],
          value: result,
          metadata: {
            trust: "untrusted_external",
            snapshotId: result.snapshotId,
            pageId: result.pageId,
            truncated: result.truncated,
          },
        };
      } catch (error) {
        return errorResult("browser_snapshot", toolCallId, messageOf(error));
      }
    },
  };

  const browserAct: ToolDefinition = {
    name: "browser_act",
    description:
      "Perform one ordered browser action (navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page/upload/screenshot/download_release). Prefer snapshot refs or role/label/testId targets; raw CSS/XPath/evaluate are unsupported. Mutations require ExecutionPolicy approval.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ACTION_NAMES],
        },
        target: {
          type: "object",
          description: "ref | role(+name) | label | testId | text target",
          additionalProperties: true,
        },
        snapshotId: { type: "string" },
        pageId: { type: "string" },
        url: { type: "string" },
        text: { type: "string" },
        values: { type: "array", items: { type: "string" } },
        paths: { type: "array", items: { type: "string" }, description: "Absolute upload paths under approved roots" },
        downloadId: { type: "string" },
        fullPage: { type: "boolean" },
        clip: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          additionalProperties: false,
        },
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number" },
        timeoutMs: { type: "number" },
        dialogResponse: { type: "string", enum: ["accept", "dismiss"] },
        promptText: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("browser_act", toolCallId, "Operation aborted");
      let request: BrowserActRequest;
      try {
        request = parseActRequest(args);
      } catch (error) {
        return errorResult("browser_act", toolCallId, messageOf(error));
      }
      const classified = classifyBrowserOperation(request.action, {
        dialogResponse: request.dialogResponse,
        hasUrl: Boolean(request.url),
      });
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_act", {
        operation: request.action,
        dialogResponse: request.dialogResponse,
        url: request.url,
        paths: request.paths,
        metadata: {
          runId: context.runId,
          sessionId: context.sessionId,
          action: request.action,
          effect: classified.effect,
          pageId: request.pageId,
          url: request.url,
          snapshotId: request.snapshotId,
          downloadId: request.downloadId,
          resource: request.downloadId,
        },
      });
      if (!gate.allowed) return gate.result;
      try {
        const result = await manager.act(context.runId, request, { signal: context.signal });
        const content: ContentBlock[] = [
          {
            type: "text",
            text: `action=${result.action} page=${result.pageId} url=${result.url || "(blank)"}`,
          },
        ];
        if (result.image) content.push(result.image);
        return {
          toolCallId,
          name: "browser_act",
          content,
          value: result,
          metadata: {
            trust: "untrusted_external",
            action: result.action,
            pageId: result.pageId,
            effect: classified.effect,
            ...(result.download ? { downloadId: result.download.downloadId, released: result.download.released } : {}),
            ...(result.screenshotBytes !== undefined ? { screenshotBytes: result.screenshotBytes } : {}),
          },
        };
      } catch (error) {
        return errorResult("browser_act", toolCallId, messageOf(error));
      }
    },
  };

  const browserClose: ToolDefinition = {
    name: "browser_close",
    description:
      "Close the run-owned browser context, pages, listeners, quarantined downloads, and snapshot state. Idempotent. Does not close the host Playwright Browser process.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as JsonObject,
    async execute(_args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_close", {
        operation: "close",
        metadata: { runId: context.runId, sessionId: context.sessionId },
      });
      if (!gate.allowed) return gate.result;
      try {
        await manager.closeRun(context.runId);
        return {
          toolCallId,
          name: "browser_close",
          content: [{ type: "text", text: `Closed browser context for run ${context.runId}` }],
          value: { runId: context.runId, closed: true },
        };
      } catch (error) {
        return errorResult("browser_close", toolCallId, messageOf(error));
      }
    },
  };

  return [browserOpen, browserSnapshot, browserAct, browserClose];
}

export function getBrowserManagerFromTools(options: BrowserToolsOptions): BrowserManager {
  return resolveManager(options);
}
