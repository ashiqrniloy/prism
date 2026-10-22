// @types/bun's globals (notably its `fetch.preconnect`) conflict with the `fetch` shapes in
// @arnilo/prism-mcp and @arnilo/prism-memory-rag, which @arnilo/prism-remote's network transport imports.
// The reference host serves a worker over stdio only, so `tsconfig.json` maps "bun" here: a shim that
// declares just the exports the transport needs.
declare module "bun" {
  export interface BunServer<T = unknown> {
    readonly hostname: string;
    readonly port: number;
    stop(closeActiveConnections?: boolean): Promise<void> | void;
    upgrade(request: Request, options: { data: T }): boolean;
  }
  export interface BunWebSocket<T> {
    readonly data: T;
    send(payload: string | Uint8Array): number;
    close(code?: number, reason?: string): void;
  }
  export interface BunServeOptions<T = unknown> {
    readonly hostname?: string;
    readonly port?: number;
    readonly maxRequestBodySize?: number;
    fetch(request: Request, server: BunServer<T>): Response | undefined | Promise<Response | undefined>;
    readonly websocket?: {
      readonly data: T;
      readonly maxPayloadLength?: number;
      readonly backpressureLimit?: number;
      readonly closeOnBackpressureLimit?: boolean;
      readonly idleTimeout?: number;
      open?(ws: BunWebSocket<T>): void;
      message?(ws: BunWebSocket<T>, message: string | Uint8Array): void;
      close?(ws: BunWebSocket<T>, code: number, reason: string): void;
    };
  }
  export function serve<T>(options: BunServeOptions<T>): BunServer<T>;
  export const secrets: {
    get(options: { readonly service: string; readonly name: string }): Promise<string | undefined>;
  };
}
