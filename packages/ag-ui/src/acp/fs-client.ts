/**
 * Client-backed editor filesystem adapter (Phase 10 Task 3).
 *
 * Wraps the ACP `fs/read_text_file` / `fs/write_text_file` client methods
 * behind a minimal read/write interface the host can wire into coding tools.
 * The agent builds this adapter only when the client advertised the matching
 * capability; each method additionally fails closed on an explicit mask.
 * Payloads honor the AG-UI maxTextBytes cap (frozen, no new knob).
 */
import { methods, type AgentContext, type ReadTextFileRequest, type WriteTextFileRequest } from "@agentclientprotocol/sdk";
import { DEFAULT_MAX_TEXT_BYTES, HARD_MAX_TEXT_BYTES } from "../limits.js";
import { AcpError } from "./errors.js";

export interface AcpClientFilesystem {
  readTextFile(input: {
    readonly path: string;
    /** 1-based start line. */
    readonly line?: number;
    /** Maximum lines to return. */
    readonly limit?: number;
  }): Promise<{ readonly text: string }>;
  writeTextFile(input: { readonly path: string; readonly content: string }): Promise<void>;
}

export interface AcpClientFilesystemOptions {
  /** Explicit per-method gate; false => ERR_PRISM_ACP_CAPABILITY (mirrors the client's advertisement). */
  readonly readTextFile?: boolean;
  readonly writeTextFile?: boolean;
  /** UTF-8 payload cap per call (default/hard from AgUiLimitOptions maxTextBytes). */
  readonly maxBytes?: number;
}

export function createAcpClientFilesystem(
  client: AgentContext,
  sessionId: string,
  options: AcpClientFilesystemOptions = {},
): AcpClientFilesystem {
  const maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES, HARD_MAX_TEXT_BYTES);
  if (!sessionId) throw new AcpError("ERR_PRISM_ACP_INPUT", "filesystem sessionId is required");

  return {
    async readTextFile(input) {
      if (options.readTextFile === false) throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "Client did not advertise fs/read_text_file");
      if (!input.path) throw new AcpError("ERR_PRISM_ACP_INPUT", "readTextFile path is required");
      for (const [name, value] of [
        ["line", input.line],
        ["limit", input.limit],
      ] as const) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
          throw new AcpError("ERR_PRISM_ACP_INPUT", `${name} must be a positive integer`);
        }
      }
      const request: ReadTextFileRequest = { sessionId, path: input.path, line: input.line, limit: input.limit };
      const response = await client.request(methods.client.fs.readTextFile, request);
      if (Buffer.byteLength(response.content, "utf8") > maxBytes) {
        throw new AcpError("ERR_PRISM_ACP_LIMIT", `fs/read_text_file response exceeds ${maxBytes} bytes`);
      }
      return { text: response.content };
    },

    async writeTextFile(input) {
      if (options.writeTextFile === false) throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "Client did not advertise fs/write_text_file");
      if (!input.path) throw new AcpError("ERR_PRISM_ACP_INPUT", "writeTextFile path is required");
      if (Buffer.byteLength(input.content, "utf8") > maxBytes) {
        throw new AcpError("ERR_PRISM_ACP_LIMIT", `fs/write_text_file content exceeds ${maxBytes} bytes`);
      }
      const request: WriteTextFileRequest = { sessionId, path: input.path, content: input.content };
      await client.request(methods.client.fs.writeTextFile, request);
    },
  };
}
