import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RagHit } from "../types.js";

/** Shared rerank-adapter test fixtures (loopback server + hit builder). */

export type ServerHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export function reliefHit(id: string, score: number, retrievalRank: number): RagHit {
  return {
    id,
    citationId: id,
    sourceId: "src",
    index: Number(id.split("#")[1]!.slice(1)) - 1,
    start: 0,
    end: 4,
    text: `text ${id}`,
    score,
    retrievalRank,
    provenance: {
      sourceId: "src",
      chunkId: id,
      citationId: id,
      provider: "host",
      tenantId: "t",
      resourceId: "r",
      corpusId: "c",
      retrieval: "vector",
      retrievedAt: "0",
    },
    trust: { untrusted: true, inert: true, injectionCapable: true },
  };
}

export async function withRerankServer(handler: ServerHandler, fn: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}
