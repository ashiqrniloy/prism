/**
 * Phase 10 Task 6 — rich prompt content.
 *
 * `projectAcpPrompt` turns a client `session/prompt` ContentBlock[] into a safe
 * host-bound projection: baseline text + resource_link always allowed; image,
 * audio, and embedded resources accepted only when the client advertised the
 * matching `promptCapabilities` AND the host media policy still approves, then
 * bounded by the frozen part/byte caps. ACP media arrives as base64 payloads
 * (no URL fetching), so the only untrusted surface is MIME type and size —
 * both validated here, fail-closed.
 */
import { AcpError } from "./errors.js";

/** One validated media part, forwarded to the host as base64 data. */
export interface AcpPromptMedia {
  readonly type: "image" | "audio" | "file";
  /** Validated MIME type (image/* or audio/* for image/audio; blob resources keep their own). */
  readonly mediaType: string;
  /** Base64-encoded payload. */
  readonly data: string;
  readonly name?: string;
}

/** Safe host-bound projection of one ACP prompt. */
export interface AcpPromptResult {
  /** Joined, redacted-free text (caller applies its own redactor) plus resource_link/embedded-text markers. */
  readonly text: string;
  readonly media?: readonly AcpPromptMedia[];
}

export interface AcpPromptOptions {
  readonly maxBlocks: number;
  readonly maxTextBytes: number;
  readonly maxMediaParts: number;
  readonly maxMediaBytes: number;
  readonly capabilities: { readonly image: boolean; readonly audio: boolean; readonly embeddedContext: boolean };
  /** Re-checked at prompt time (the advertise-time gate alone can go stale). */
  readonly policy?: { readonly media?: () => boolean | Promise<boolean>; readonly embedded?: () => boolean | Promise<boolean> };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function estimateBase64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function mediaBlock(
  kind: "image" | "audio" | "file",
  mimeType: string,
  data: string,
  name: string | undefined,
  count: number,
  bytes: number,
  options: AcpPromptOptions,
): AcpPromptMedia {
  if (count >= options.maxMediaParts) throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt media parts exceed the configured limit");
  if (mimeType.length === 0 || (kind !== "file" && !mimeType.startsWith(`${kind}/`)) || mimeType.length > 256) {
    throw new AcpError("ERR_PRISM_ACP_INPUT", `ACP prompt media has an invalid mimeType '${mimeType}'`);
  }
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) {
    throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP prompt media data is not valid base64");
  }
  const decoded = estimateBase64DecodedBytes(data);
  if (decoded <= 0 || bytes + decoded > options.maxMediaBytes) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt media exceeds the configured byte limit");
  }
  return { type: kind, mediaType: mimeType, data, ...(name ? { name } : {}) };
}

/**
 * Validates and projects one ACP prompt. Baseline: text + resource_link blocks.
 * `image`/`audio` require the client advertisement AND the host media policy;
 * `resource` requires `embeddedContext` (text resources join the text, blob
 * resources become media parts). Throws AcpError on any violation — the prompt
 * is rejected before any provider call.
 */
export async function projectAcpPrompt(prompt: readonly { readonly type: string }[], options: AcpPromptOptions): Promise<AcpPromptResult> {
  if (prompt.length === 0 || prompt.length > options.maxBlocks) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt block count exceeds the configured limit");
  }
  let text = "";
  let textBytes = 0;
  let mediaBytes = 0;
  const media: AcpPromptMedia[] = [];
  for (const block of prompt) {
    switch (block.type) {
      case "text": {
        const value = (block as { readonly text?: unknown }).text;
        if (typeof value !== "string") throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP prompt text block has no text");
        textBytes += Buffer.byteLength(value, "utf8");
        if (textBytes > options.maxTextBytes) throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt text exceeds the configured limit");
        text += value;
        break;
      }
      case "resource_link": {
        const link = block as { readonly name?: unknown; readonly uri?: unknown };
        const name = typeof link.name === "string" ? link.name : "";
        const uri = typeof link.uri === "string" ? link.uri : "";
        const marker = `[resource_link: ${name}${uri ? ` (${uri})` : ""}]`;
        textBytes += Buffer.byteLength(marker, "utf8");
        if (textBytes > options.maxTextBytes) throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt text exceeds the configured limit");
        text += marker;
        break;
      }
      case "image": {
        if (!options.capabilities.image)
          throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "client sent image content without advertising promptCapabilities.image");
        if (!(await options.policy?.media?.())) throw new AcpError("ERR_PRISM_ACP_POLICY", "host media policy denied ACP image content");
        const blockValue = block as { readonly data?: unknown; readonly mimeType?: unknown; readonly uri?: unknown };
        if (typeof blockValue.mimeType !== "string" || typeof blockValue.data !== "string") {
          throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP image block is missing data or mimeType");
        }
        media.push(mediaBlock("image", blockValue.mimeType, blockValue.data, undefined, media.length, mediaBytes, options));
        mediaBytes += estimateBase64DecodedBytes(blockValue.data);
        break;
      }
      case "audio": {
        if (!options.capabilities.audio)
          throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "client sent audio content without advertising promptCapabilities.audio");
        if (!(await options.policy?.media?.())) throw new AcpError("ERR_PRISM_ACP_POLICY", "host media policy denied ACP audio content");
        const blockValue = block as { readonly data?: unknown; readonly mimeType?: unknown };
        if (typeof blockValue.mimeType !== "string" || typeof blockValue.data !== "string") {
          throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP audio block is missing data or mimeType");
        }
        media.push(mediaBlock("audio", blockValue.mimeType, blockValue.data, undefined, media.length, mediaBytes, options));
        mediaBytes += estimateBase64DecodedBytes(blockValue.data);
        break;
      }
      case "resource": {
        if (!options.capabilities.embeddedContext) {
          throw new AcpError(
            "ERR_PRISM_ACP_CAPABILITY",
            "client sent embedded content without advertising promptCapabilities.embeddedContext",
          );
        }
        if (!(await options.policy?.embedded?.()))
          throw new AcpError("ERR_PRISM_ACP_POLICY", "host embedded policy denied ACP resource content");
        const resource = (block as { readonly resource?: unknown }).resource;
        if (!resource || typeof resource !== "object")
          throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP resource block has no resource payload");
        const contents = resource as {
          readonly text?: unknown;
          readonly blob?: unknown;
          readonly mimeType?: unknown;
          readonly name?: unknown;
          readonly uri?: unknown;
        };
        if (typeof contents.text === "string") {
          const marker = contents.uri && typeof contents.uri === "string" ? `[resource: ${contents.uri}]\n${contents.text}` : contents.text;
          textBytes += Buffer.byteLength(marker, "utf8");
          if (textBytes > options.maxTextBytes) throw new AcpError("ERR_PRISM_ACP_LIMIT", "ACP prompt text exceeds the configured limit");
          text += marker;
        } else if (typeof contents.blob === "string") {
          const mimeType =
            typeof contents.mimeType === "string" && contents.mimeType.length > 0 ? contents.mimeType : "application/octet-stream";
          const name = typeof contents.name === "string" ? contents.name : typeof contents.uri === "string" ? contents.uri : undefined;
          media.push(mediaBlock("file", mimeType, contents.blob, name, media.length, mediaBytes, options));
          mediaBytes += estimateBase64DecodedBytes(contents.blob);
        } else {
          throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP embedded resource has neither text nor blob contents");
        }
        break;
      }
      default:
        throw new AcpError("ERR_PRISM_ACP_INPUT", `ACP prompt contains unsupported block type '${String(block.type)}'`);
    }
  }
  return { text, ...(media.length > 0 ? { media } : {}) };
}
