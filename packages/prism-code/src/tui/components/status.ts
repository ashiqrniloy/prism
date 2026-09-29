import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Usage } from "@arnilo/prism";
import { BoxRenderable, type CliRenderer, fg, StyledText, stringToStyledText, type TextChunk, TextRenderable } from "@opentui/core";
import type { PrismCodeApprovalMode } from "../../approval.js";
import type { UiFooterStatus } from "../reducer.js";

export function detectGitBranch(cwd: string): string | undefined {
  try {
    const gitDir = resolve(cwd, ".git");
    if (!existsSync(gitDir)) return undefined;

    const headPath = resolve(gitDir, "HEAD");
    if (!existsSync(headPath)) return undefined;

    const content = readFileSync(headPath, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) {
      return content.slice("ref: refs/heads/".length);
    }
    // Detached HEAD — return short hash
    return content.slice(0, 7) || "detached";
  } catch {
    return undefined;
  }
}

export function formatFooterLeft(repoPath?: string, branch?: string, width = 80): string {
  const repoName = repoPath ? basename(repoPath) : "workspace";
  const branchLabel = branch ? `@ ${branch}` : "(no git)";

  if (width < 50) {
    // Narrow display: show only branch or shortened repo
    return branch ? `${branch}` : `${repoName}`;
  }

  return `${repoName} ${branchLabel}`;
}

export function formatFooterRight(model: string, effort: string, approval: PrismCodeApprovalMode = "ask", width = 80): string {
  // The approval mode stays visible at all times: `auto` must never be silent (plan 137 Task 8).
  const approvalLabel = approval === "auto" ? "AUTO" : approval;
  if (width < 50) {
    return `${model.split("/").pop() ?? model} [${approvalLabel}]`;
  }
  return `${model} [effort: ${effort}] [approvals:${approvalLabel}]`;
}

/** MCP counts for the footer; a bare number keeps the legacy "N connected" rendering. */
export type McpFooterStatus = number | { readonly connected: number; readonly total?: number; readonly failed?: number };

export function formatMcpStatus(mcp: McpFooterStatus): string {
  if (typeof mcp === "number") return `MCP: ${mcp} connected`;
  if (mcp.total === undefined) return `MCP: ${mcp.connected} connected`;
  const failedPart = mcp.failed && mcp.failed > 0 ? ` (${mcp.failed} failed)` : "";
  return `MCP: ${mcp.connected}/${mcp.total}${failedPart}`;
}

/** Context/usage inputs for the footer details line; all fields come from reducer state. */
export interface FooterUsageMeter {
  readonly contextTokens?: number;
  readonly contextCap?: number;
  readonly contextSource?: "reported" | "estimated";
  readonly usage?: Usage;
}

/** One rendered details fragment; `color` is set only for the context segment warning/danger states. */
export interface FooterDetailSegment {
  readonly text: string;
  readonly color?: string;
}

export const CONTEXT_WARN_RATIO = 0.7;
export const CONTEXT_DANGER_RATIO = 0.9;
export const CONTEXT_WARN_COLOR = "#fbbf24";
export const CONTEXT_DANGER_COLOR = "#f87171";

/** Compact token counts: `42k`, `1.2M` (matches the plan's meter example). */
export function formatTokenCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function contextSegment(meter: FooterUsageMeter): FooterDetailSegment | undefined {
  const { contextTokens, contextCap, contextSource } = meter;
  if (contextTokens === undefined) return undefined;
  const tilde = contextSource === "estimated" ? "~" : "";
  if (contextCap === undefined || contextCap <= 0) {
    return { text: `ctx ${tilde}${formatTokenCount(contextTokens)}` };
  }
  const ratio = contextTokens / contextCap;
  const percent = Math.min(999, Math.max(0, Math.round(ratio * 100)));
  const color = ratio >= CONTEXT_DANGER_RATIO ? CONTEXT_DANGER_COLOR : ratio >= CONTEXT_WARN_RATIO ? CONTEXT_WARN_COLOR : undefined;
  return {
    text: `ctx ${tilde}${formatTokenCount(contextTokens)}/${formatTokenCount(contextCap)} ${percent}%`,
    ...(color ? { color } : {}),
  };
}

/** `↑1.2M ↓48k`; cache reads count as input because providers report them outside `inputTokens`. */
export function formatTokenTotals(usage?: Usage): string | undefined {
  if (!usage) return undefined;
  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
  const output = usage.outputTokens ?? 0;
  const parts: string[] = [];
  if (input > 0) parts.push(`↑${formatTokenCount(input)}`);
  if (output > 0) parts.push(`↓${formatTokenCount(output)}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };

/** Cost is rendered only when pricing was reported (`Usage.cost`); estimates are never priced. */
export function formatUsageCost(usage?: Usage): string | undefined {
  const cost = usage?.cost;
  if (cost === undefined || cost <= 0) return undefined;
  const currency = usage?.currency ?? "USD";
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
  return symbol ? `${symbol}${cost.toFixed(2)}` : `${cost.toFixed(2)} ${currency}`;
}

/**
 * Details line fragments in render order: MCP, OM, context meter, cumulative tokens, cost, notice.
 * A width budget drops the cost first, then the token totals (narrow terminals).
 */
export function footerDetailSegments(
  mcp: McpFooterStatus,
  meter: FooterUsageMeter = {},
  omStatus?: string,
  modelNotice?: string,
  width?: number,
): FooterDetailSegment[] {
  const segments: FooterDetailSegment[] = [{ text: formatMcpStatus(mcp) }];
  if (omStatus) segments.push({ text: ` | OM: ${omStatus}` });
  const ctx = contextSegment(meter);
  if (ctx) segments.push({ text: ` | ${ctx.text}`, ...(ctx.color ? { color: ctx.color } : {}) });
  const totals = formatTokenTotals(meter.usage);
  if (totals) segments.push({ text: ` | ${totals}` });
  const cost = formatUsageCost(meter.usage);
  if (cost) segments.push({ text: ` | ${cost}` });
  if (modelNotice) segments.push({ text: ` | ${modelNotice}` });

  if (width !== undefined && width > 0) {
    const length = (): number => segments.reduce((sum, segment) => sum + segment.text.length, 0);
    const drop = (text: string): void => {
      const index = segments.findIndex((segment) => segment.text === ` | ${text}`);
      if (index >= 0) segments.splice(index, 1);
    };
    if (cost && length() > width) drop(cost);
    if (totals && length() > width) drop(totals);
  }
  return segments;
}

export function formatFooterDetails(
  mcp: McpFooterStatus,
  meter: FooterUsageMeter = {},
  omStatus?: string,
  modelNotice?: string,
  width?: number,
): string {
  return footerDetailSegments(mcp, meter, omStatus, modelNotice, width)
    .map((segment) => segment.text)
    .join("");
}

function styledDetails(segments: readonly FooterDetailSegment[]): StyledText {
  const chunks: TextChunk[] = [];
  for (const segment of segments) {
    if (segment.color) chunks.push(fg(segment.color)(segment.text));
    else chunks.push(...stringToStyledText(segment.text).chunks);
  }
  return new StyledText(chunks);
}

export class StatusFooterComponent {
  readonly root: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly leftText: TextRenderable;
  private readonly rightText: TextRenderable;
  private readonly detailsText: TextRenderable;
  private status: UiFooterStatus;

  constructor(renderer: CliRenderer, initialStatus: UiFooterStatus) {
    this.renderer = renderer;
    this.status = initialStatus;

    this.root = new BoxRenderable(renderer, {
      flexDirection: "column",
      height: 2,
      paddingLeft: 1,
      paddingRight: 1,
    });

    const topLine = new BoxRenderable(renderer, {
      flexDirection: "row",
      justifyContent: "space-between",
      height: 1,
    });

    this.leftText = new TextRenderable(renderer, {
      content: formatFooterLeft(this.status.repo, this.status.branch),
    });

    this.rightText = new TextRenderable(renderer, {
      content: formatFooterRight(this.status.model, this.status.effort, this.status.approval),
    });

    topLine.add(this.leftText);
    topLine.add(this.rightText);

    this.detailsText = new TextRenderable(renderer, {
      content: this.renderDetails(),
    });

    this.root.add(topLine);
    this.root.add(this.detailsText);
  }

  private getOmStatusLabel(): string | undefined {
    if (this.status.omEnabled === undefined) return undefined;
    if (!this.status.omEnabled) return "off";
    return this.status.omModel ? `on (${this.status.omModel})` : "on";
  }

  private renderDetails(width?: number): StyledText {
    return styledDetails(
      footerDetailSegments(
        { connected: this.status.connectedMcpCount, total: this.status.mcpTotalCount, failed: this.status.mcpFailedCount },
        {
          contextTokens: this.status.contextTokens,
          contextCap: this.status.contextCap,
          contextSource: this.status.contextSource,
          usage: this.status.usageTotals,
        },
        this.getOmStatusLabel(),
        this.status.modelNotice,
        width ?? this.renderer.width,
      ),
    );
  }

  update(statusPatch: Partial<UiFooterStatus>, width?: number): void {
    this.status = { ...this.status, ...statusPatch };
    const available = width ?? this.renderer.width;
    this.leftText.content = formatFooterLeft(this.status.repo, this.status.branch, available);
    this.rightText.content = formatFooterRight(this.status.model, this.status.effort, this.status.approval, available);
    this.detailsText.content = this.renderDetails(available);
  }
}
