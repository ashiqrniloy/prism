/**
 * How a driver hands its binary an MCP endpoint. The binary is what speaks MCP; the kernel only describes where
 * to reach the server and which environment variable holds the bearer token. `serveTools` returns one of these,
 * and the scripted CLI (Task 3) consumes it, so neither a driver nor `/testing` imports a host library.
 */
export type McpEndpoint =
  | {
      /** Streamable HTTP: the binary POSTs JSON-RPC 2.0 to `url`. */
      readonly transport: "http";
      readonly url: string;
      /** The environment variable the binary reads the bearer token from. The token is never part of the endpoint. */
      readonly headerEnv: string;
    }
  | {
      /** stdio: the binary spawns `command args` once per run and exchanges JSONL frames. */
      readonly transport: "stdio";
      readonly command: string;
      readonly args: readonly string[];
    };
