/**
 * Client-backed terminal adapter (Phase 10 Task 3).
 *
 * Maps the ACP `terminal/create|output|wait_for_exit|kill|release` client
 * methods onto ProcessSession-flavored semantics (create → wait/kill/release;
 * ACP terminals are pull-based — no stdin). The agent builds this adapter only
 * when the client advertised `terminal`. Output payloads honor the frozen
 * Phase 9 `process.outputChunkBytes` cap (DEFAULT/HARD), requested as the
 * client-side `outputByteLimit` and verified on every response.
 */
import { methods, type AgentContext, type CreateTerminalRequest } from "@agentclientprotocol/sdk";
import { DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES, HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES } from "@arnilo/prism-coding-agent";
import { AcpError } from "./errors.js";

export interface AcpClientTerminal {
  readonly id: string;
  /** Current output and status without waiting (terminal/output). */
  output(): Promise<{ readonly output: string; readonly truncated: boolean; readonly exitCode?: number | null }>;
  /** Waits for the command to exit (terminal/wait_for_exit). */
  waitForExit(): Promise<{ readonly exitCode?: number | null }>;
  /** Kills the command; the terminal stays valid for output/exit (terminal/kill). */
  kill(): Promise<void>;
  /** Releases terminal resources (terminal/release). */
  release(): Promise<void>;
}

export interface AcpClientTerminals {
  create(input: {
    readonly command: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly env?: readonly { readonly name: string; readonly value: string }[];
    /** Requested client-side retention cap; clamped to maxOutputBytes. */
    readonly outputByteLimit?: number;
  }): Promise<AcpClientTerminal>;
}

export interface AcpClientTerminalsOptions {
  /** Cap per terminal/output response; default/hard from Phase 9 process.outputChunkBytes. */
  readonly maxOutputBytes?: number;
}

export function createAcpClientTerminals(
  client: AgentContext,
  sessionId: string,
  options: AcpClientTerminalsOptions = {},
): AcpClientTerminals {
  const maxOutputBytes = Math.min(options.maxOutputBytes ?? DEFAULT_MAX_PROCESS_OUTPUT_CHUNK_BYTES, HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES);
  if (!sessionId) throw new AcpError("ERR_PRISM_ACP_INPUT", "terminal sessionId is required");

  return {
    async create(input) {
      if (!input.command) throw new AcpError("ERR_PRISM_ACP_INPUT", "terminal command is required");
      if (input.outputByteLimit !== undefined && (!Number.isInteger(input.outputByteLimit) || input.outputByteLimit <= 0)) {
        throw new AcpError("ERR_PRISM_ACP_INPUT", "outputByteLimit must be a positive integer");
      }
      const request: CreateTerminalRequest = {
        sessionId,
        command: input.command,
        args: input.args ? [...input.args] : undefined,
        cwd: input.cwd,
        env: input.env ? input.env.map(({ name, value }) => ({ name, value })) : undefined,
        outputByteLimit: Math.min(input.outputByteLimit ?? maxOutputBytes, maxOutputBytes),
      };
      const response = await client.request(methods.client.terminal.create, request);
      const terminalId = response.terminalId;
      return {
        id: terminalId,
        async output() {
          const current = await client.request(methods.client.terminal.output, { sessionId, terminalId });
          if (Buffer.byteLength(current.output, "utf8") > maxOutputBytes) {
            throw new AcpError("ERR_PRISM_ACP_LIMIT", `terminal/output response exceeds ${maxOutputBytes} bytes`);
          }
          return { output: current.output, truncated: current.truncated, exitCode: current.exitStatus?.exitCode ?? null };
        },
        async waitForExit() {
          const result = await client.request(methods.client.terminal.waitForExit, { sessionId, terminalId });
          return { exitCode: result.exitCode ?? null };
        },
        async kill() {
          await client.request(methods.client.terminal.kill, { sessionId, terminalId });
        },
        async release() {
          await client.request(methods.client.terminal.release, { sessionId, terminalId });
        },
      };
    },
  };
}
