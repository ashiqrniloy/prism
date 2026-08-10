/**
 * Model-facing browser tools: browser_open, browser_snapshot, browser_act, browser_close.
 * All tools are statically exclusive; the manager also serializes per-run.
 */
import {
  assertExecutionAllowed,
  type ContentBlock,
  ExecutionDeniedError,
  type ExecutionPolicy,
  type JsonObject,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "@arnilo/prism";
import type { BrowserDownloadOptions } from "./downloads.js";
import { BrowserError } from "./errors.js";
import type { BrowserLimitOptions } from "./limits.js";
import { type BrowserManager, type CreateBrowserManagerOptions, createBrowserManager } from "./manager.js";
import type { BrowserNetworkPolicy } from "./network.js";
import { buildBrowserExecutionAction, classifyBrowserOperation, classifyBrowserToolEffect } from "./policy.js";
import type {
  BrowserActionName,
  BrowserActRequest,
  BrowserCdpOptions,
  BrowserEvaluateRequest,
  BrowserObserveResult,
  PlaywrightBrowser,
} from "./types.js";
import type { BrowserUploadOptions } from "./uploads.js";

export interface BrowserToolsOptions {
  readonly browser?: PlaywrightBrowser;
  readonly manager?: BrowserManager;
  readonly executionPolicy?: ExecutionPolicy;
  readonly limits?: BrowserLimitOptions;
  readonly networkPolicy?: BrowserNetworkPolicy;
  readonly uploads?: BrowserUploadOptions;
  readonly downloads?: BrowserDownloadOptions;
  /** CDP capability gating (default "auto": enabled on Chromium hosts). */
  readonly cdp?: BrowserCdpOptions;
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
  "block_urls",
  "unblock_urls",
  "throttle",
  "emulate",
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
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "createBrowserTools requires browser or manager");
  }
  const managerOptions: CreateBrowserManagerOptions = {
    browser: options.browser,
    limits: options.limits,
    networkPolicy: options.networkPolicy,
    uploads: options.uploads,
    downloads: options.downloads,
    cdp: options.cdp,
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
  const clip = args.clip && typeof args.clip === "object" && !Array.isArray(args.clip) ? (args.clip as Record<string, unknown>) : undefined;
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
    ...(args.dialogResponse === "accept" || args.dialogResponse === "dismiss" ? { dialogResponse: args.dialogResponse } : {}),
    ...(typeof args.promptText === "string" ? { promptText: args.promptText } : {}),
    ...(Array.isArray(args.patterns) ? { patterns: args.patterns.map(String) } : {}),
    ...(args.offline === true ? { offline: true } : {}),
    ...(typeof args.latencyMs === "number" ? { latencyMs: args.latencyMs } : {}),
    ...(typeof args.downloadKbps === "number" ? { downloadKbps: args.downloadKbps } : {}),
    ...(typeof args.uploadKbps === "number" ? { uploadKbps: args.uploadKbps } : {}),
    ...(args.reset === true ? { reset: true } : {}),
    ...(typeof args.width === "number" ? { width: args.width } : {}),
    ...(typeof args.height === "number" ? { height: args.height } : {}),
    ...(args.mobile === true ? { mobile: true } : {}),
    ...(typeof args.deviceScaleFactor === "number" ? { deviceScaleFactor: args.deviceScaleFactor } : {}),
    ...(typeof args.userAgent === "string" ? { userAgent: args.userAgent } : {}),
  };
  return request;
}

export function createBrowserTools(options: BrowserToolsOptions = {}): ToolDefinition[] {
  const manager = resolveManager(options);
  const policy = options.executionPolicy;

  const browserOpen: ToolDefinition = {
    name: "browser_open",
    effect: (args) => classifyBrowserToolEffect("open", { hasUrl: typeof args.url === "string" }),
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
    effect: { kind: "none", idempotency: "none" },
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
    effect: (args) =>
      classifyBrowserToolEffect(typeof args.action === "string" ? args.action : "invalid", {
        dialogResponse: args.dialogResponse === "accept" || args.dialogResponse === "dismiss" ? args.dialogResponse : undefined,
      }),
    description:
      "Perform one ordered browser action (navigate/click/type/fill/select/check/uncheck/scroll/wait/dialog/select_page/upload/screenshot/download_release, plus CDP block_urls/unblock_urls/throttle/emulate on Chromium hosts). Prefer snapshot refs or role/label/testId targets; raw CSS/XPath targets are supported as { css } / { xpath } and require ExecutionPolicy approval like other mutations. Mutations require ExecutionPolicy approval.",
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
          description: "ref | role(+name) | label | testId | text | css | xpath target",
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
        patterns: { type: "array", items: { type: "string" }, description: "URL patterns to block (block_urls)" },
        offline: { type: "boolean", description: "throttle: go offline" },
        latencyMs: { type: "number", description: "throttle: latency in ms (0..120000)" },
        downloadKbps: { type: "number", description: "throttle: download throughput kbps (0..1000000)" },
        uploadKbps: { type: "number", description: "throttle: upload throughput kbps (0..1000000)" },
        reset: { type: "boolean", description: "throttle/emulate: reset to defaults" },
        width: { type: "number", description: "emulate: viewport width px" },
        height: { type: "number", description: "emulate: viewport height px" },
        mobile: { type: "boolean", description: "emulate: mobile viewport" },
        deviceScaleFactor: { type: "number", description: "emulate: device scale factor (0.01..10)" },
        userAgent: { type: "string", description: "emulate: user-agent override (only when explicitly supplied)" },
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
    effect: { kind: "none", idempotency: "none" },
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

  const browserEvaluate: ToolDefinition = {
    name: "browser_evaluate",
    effect: () => classifyBrowserToolEffect("evaluate"),
    description:
      "Evaluate a bounded JavaScript expression in the page context via Chrome DevTools Protocol (Chromium hosts; cdp mode auto/on). Arbitrary code execution: requires ExecutionPolicy approval and the side-effect hook. Result is JSON-serializable and capped at maxEvaluateResultBytes; expression capped at maxActionInputBytes.",
    exclusive: true,
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "Optional page id; defaults to the active page" },
        expression: { type: "string", description: "JavaScript expression to evaluate in the page context" },
        awaitPromise: { type: "boolean", description: "Await promise resolution before returning" },
        timeoutMs: { type: "number", description: "Per-action timeout, clamped to actionTimeoutMs" },
      },
      required: ["expression"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult("browser_evaluate", toolCallId, "Operation aborted");
      const expression = typeof args.expression === "string" ? args.expression : undefined;
      if (!expression) return errorResult("browser_evaluate", toolCallId, "expression is required");
      const request: BrowserEvaluateRequest = {
        expression,
        ...(typeof args.pageId === "string" ? { pageId: args.pageId } : {}),
        ...(args.awaitPromise === true ? { awaitPromise: true } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
      };
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_evaluate", {
        operation: "evaluate",
        pageKind: "main",
        metadata: {
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: request.pageId,
          expressionBytes: Buffer.byteLength(expression, "utf8"),
        },
      });
      if (!gate.allowed) return gate.result;
      try {
        const result = await manager.evaluate(context.runId, request, { signal: context.signal });
        const valueText =
          result.value !== undefined
            ? `value=${typeof result.value === "string" ? result.value : JSON.stringify(result.value)}`
            : "value=undefined";
        const lines = [
          `evaluate page=${result.pageId} url=${result.url || "(blank)"}`,
          result.truncated ? `${valueText} (truncated)` : valueText,
        ];
        if (result.exception) lines.push(`exception=${result.exception}`);
        return {
          toolCallId,
          name: "browser_evaluate",
          content: [{ type: "text", text: lines.join("\n") }],
          value: result,
          metadata: {
            trust: "untrusted_external",
            pageId: result.pageId,
            ...(result.truncated ? { truncated: true } : {}),
            ...(result.exception !== undefined ? { exception: true } : {}),
          },
        };
      } catch (error) {
        return errorResult("browser_evaluate", toolCallId, messageOf(error));
      }
    },
  };

  const browserObserve: ToolDefinition = {
    name: "browser_observe",
    effect: { kind: "none", idempotency: "none" },
    description:
      "Drain bounded console and network observations since the previous call (CDP Runtime/Network domains; Chromium hosts). Never captures request/response bodies, cookies, or auth headers. Entries are untrusted external content.",
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
      if (context.signal?.aborted) return errorResult("browser_observe", toolCallId, "Operation aborted");
      const pageId = typeof args.pageId === "string" ? args.pageId : undefined;
      const gate = await enforceBrowserPolicy(policy, toolCallId, "browser_observe", {
        operation: "observe",
        metadata: { runId: context.runId, sessionId: context.sessionId, pageId },
      });
      if (!gate.allowed) return gate.result;
      try {
        const result: BrowserObserveResult = await manager.observe(context.runId, { pageId, signal: context.signal });
        const lines = [
          `observe page=${result.pageId} url=${result.url || "(blank)"} console=${result.console.length} network=${result.network.length}`,
        ];
        for (const entry of result.console.slice(0, 50)) {
          lines.push(`console [${entry.seq}] ${entry.type}: ${entry.args.join(" ").slice(0, 200)}`);
        }
        for (const entry of result.network.slice(0, 50)) {
          const detail =
            entry.phase === "response"
              ? `status=${entry.status}`
              : entry.phase === "failed"
                ? `error=${entry.errorText ?? "unknown"}`
                : `method=${entry.method ?? "?"}`;
          lines.push(`network [${entry.seq}] ${entry.phase} ${detail} ${entry.url.slice(0, 200)}`);
        }
        const remaining = Math.max(0, result.console.length - 50) + Math.max(0, result.network.length - 50);
        if (remaining > 0) lines.push(`(${remaining} more entries in value)`);
        if (result.truncated) lines.push("(ring truncated: earliest entries evicted)");
        return {
          toolCallId,
          name: "browser_observe",
          content: [{ type: "text", text: lines.join("\n") }],
          value: result,
          metadata: { trust: "untrusted_external", pageId: result.pageId, truncated: result.truncated },
        };
      } catch (error) {
        return errorResult("browser_observe", toolCallId, messageOf(error));
      }
    },
  };

  return [browserOpen, browserSnapshot, browserAct, browserClose, browserEvaluate, browserObserve];
}

export function getBrowserManagerFromTools(options: BrowserToolsOptions): BrowserManager {
  return resolveManager(options);
}
