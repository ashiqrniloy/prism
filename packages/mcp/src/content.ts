import type { ContentBlock, ErrorInfo } from "@arnilo/prism";
import { McpBridgeError } from "./types.js";

type McpContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "audio"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "resource";
      readonly resource: {
        readonly uri: string;
        readonly text?: string;
        readonly blob?: string;
        readonly mimeType?: string;
      };
    }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name: string;
      readonly description?: string;
      readonly mimeType?: string;
      readonly size?: number;
    };

export interface MapMcpContentOptions {
  readonly maxResultBytes: number;
}

export interface MapMcpContentResult {
  readonly content: readonly ContentBlock[];
  readonly truncated: boolean;
  readonly bytesUsed: number;
}

export function estimateUtf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function mapMcpContentToBlocks(
  content: readonly McpContentBlock[] | undefined,
  options: MapMcpContentOptions,
): MapMcpContentResult {
  if (!content?.length) {
    return { content: [], truncated: false, bytesUsed: 0 };
  }

  const blocks: ContentBlock[] = [];
  let bytesUsed = 0;
  let truncated = false;

  for (const block of content) {
    if (bytesUsed >= options.maxResultBytes) {
      truncated = true;
      break;
    }

    const remaining = options.maxResultBytes - bytesUsed;

    switch (block.type) {
      case "text": {
        const text = truncateUtf8(block.text, remaining);
        if (!text) {
          truncated = true;
          break;
        }
        const size = estimateUtf8Bytes(text);
        bytesUsed += size;
        blocks.push({ type: "text", text });
        if (text.length < block.text.length) truncated = true;
        break;
      }
      case "image": {
        const dataBytes = estimateBase64DecodedBytes(block.data);
        if (dataBytes > remaining) {
          truncated = true;
          break;
        }
        bytesUsed += dataBytes;
        blocks.push({
          type: "image",
          mimeType: block.mimeType,
          data: block.data,
        });
        break;
      }
      case "audio": {
        const summary = `[audio content ${block.mimeType}, ${estimateBase64DecodedBytes(block.data)} bytes]`;
        const text = truncateUtf8(summary, remaining);
        if (!text) {
          truncated = true;
          break;
        }
        bytesUsed += estimateUtf8Bytes(text);
        blocks.push({ type: "text", text });
        break;
      }
      case "resource": {
        const resource = block.resource;
        const body = resource.text ?? (resource.blob ? `[blob ${resource.mimeType ?? "application/octet-stream"}]` : "");
        const text = truncateUtf8(
          `Resource ${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ""}: ${body}`,
          remaining,
        );
        if (!text) {
          truncated = true;
          break;
        }
        bytesUsed += estimateUtf8Bytes(text);
        blocks.push({ type: "text", text });
        break;
      }
      case "resource_link": {
        const parts = [
          `Resource link ${block.name}: ${block.uri}`,
          block.description,
          block.mimeType ? `mime=${block.mimeType}` : undefined,
          block.size !== undefined ? `size=${block.size}` : undefined,
        ].filter(Boolean);
        const text = truncateUtf8(parts.join(" — "), remaining);
        if (!text) {
          truncated = true;
          break;
        }
        bytesUsed += estimateUtf8Bytes(text);
        blocks.push({ type: "text", text });
        break;
      }
      default:
        break;
    }
  }

  return { content: blocks, truncated, bytesUsed };
}

export function summarizeMcpContent(content: readonly McpContentBlock[] | undefined): string {
  if (!content?.length) return "MCP tool returned no content";
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "resource") {
      parts.push(block.resource.text ?? block.resource.uri);
    } else {
      parts.push(`[${block.type}]`);
    }
  }
  return parts.join("\n").trim() || "MCP tool returned empty content";
}

export function mcpCallError(message: string, code = "ERR_PRISM_MCP_TOOL"): ErrorInfo {
  return { name: "McpToolError", message, code };
}

function estimateBase64DecodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (estimateUtf8Bytes(text) <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateUtf8Bytes(text.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

export function assertMcpContentWithinLimit(
  content: readonly McpContentBlock[] | undefined,
  maxResultBytes: number,
): void {
  const mapped = mapMcpContentToBlocks(content, { maxResultBytes });
  if (mapped.truncated) {
    throw new McpBridgeError(
      `MCP tool result exceeds maxResultBytes (${maxResultBytes}); received at least ${mapped.bytesUsed} bytes`,
    );
  }
}
