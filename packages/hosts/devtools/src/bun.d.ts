// @types/bun's globals add `fetch.preconnect`, which conflicts with the plain `fetch` shapes in
// @arnilo/prism-mcp and @arnilo/prism-rag. The package's tsconfig scopes `types` to
// node + bun-types/test.d.ts, so the two Bun globals this host uses are declared here.
declare const Bun: {
  serve(options: {
    readonly hostname?: string;
    readonly port?: number;
    readonly fetch: (request: Request) => Response | Promise<Response>;
  }): {
    readonly hostname: string;
    readonly port: number;
    stop(closeActiveConnections?: boolean): Promise<void> | void;
  };
  readonly Transpiler: new (options: {
    readonly loader: "ts" | "tsx" | "js" | "jsx";
    readonly target: "browser" | "bun" | "node";
  }) => {
    transformSync(source: string): string;
  };
};
