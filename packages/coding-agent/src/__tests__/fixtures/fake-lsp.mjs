#!/usr/bin/env node
/**
 * Minimal fake LSP server for network-free tests.
 * Env:
 *   FAKE_LSP_CRASH_AFTER_INIT=1 — exit after initialized
 *   FAKE_LSP_DIAG_DIALECT=alt — alternate diagnostic shape (still LSP-valid)
 */
import { pathToFileURL } from "node:url";

let buf = Buffer.alloc(0);
const rootUri = process.env.FAKE_LSP_ROOT_URI ?? pathToFileURL(process.cwd()).href;
const crashAfterInit = process.env.FAKE_LSP_CRASH_AFTER_INIT === "1";
const diagDialect = process.env.FAKE_LSP_DIAG_DIALECT ?? "default";
const diagCount = Number(process.env.FAKE_LSP_DIAG_COUNT ?? "1");
const pullDiags = process.env.FAKE_LSP_PULL === "1";
/** @type {Map<string, string>} */
const openDocs = new Map();
/** @type {Map<string, number>} */
const docVersions = new Map();

function buildDiags(uri) {
  const version = docVersions.get(uri) ?? 1;
  if (diagDialect === "alt") {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 2,
        message: `alt-warning-v${version}`,
        source: "fake-alt",
        code: "A1",
      },
    ];
  }
  return Array.from({ length: diagCount }, (_, i) => ({
    range: { start: { line: i, character: 0 }, end: { line: i, character: 3 } },
    severity: 1,
    message:
      diagCount === 1
        ? version === 1
          ? "fake-error"
          : `fake-error-v${version}`
        : version === 1
          ? `fake-error-${i}`
          : `fake-error-v${version}-${i}`,
    source: "fake",
    code: 101,
  }));
}

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  if (method === "initialize") {
    respond(id, {
      capabilities: {
        workspaceSymbolProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        renameProvider: true,
        textDocumentSync: 1,
        ...(pullDiags ? { diagnosticProvider: { identifier: "fake", interFileDependencies: false, workspaceDiagnostics: false } } : {}),
      },
    });
    return;
  }

  if (method === "initialized") {
    if (crashAfterInit) {
      process.exit(1);
    }
    return;
  }

  if (method === "shutdown") {
    respond(id, null);
    return;
  }
  if (method === "exit") {
    process.exit(0);
  }

  if (method === "textDocument/didOpen") {
    const doc = params?.textDocument;
    if (doc?.uri && typeof doc.text === "string") {
      openDocs.set(doc.uri, doc.text);
      docVersions.set(doc.uri, doc.version ?? 1);
      notify("textDocument/publishDiagnostics", { uri: doc.uri, diagnostics: buildDiags(doc.uri) });
    }
    return;
  }

  if (method === "textDocument/didChange") {
    const doc = params?.textDocument;
    const changes = params?.contentChanges;
    if (doc?.uri) {
      const version = doc.version ?? ((docVersions.get(doc.uri) ?? 1) + 1);
      docVersions.set(doc.uri, version);
      const last = Array.isArray(changes) ? changes[changes.length - 1] : undefined;
      if (last && typeof last.text === "string") openDocs.set(doc.uri, last.text);
      notify("textDocument/publishDiagnostics", { uri: doc.uri, diagnostics: buildDiags(doc.uri) });
    }
    return;
  }

  if (method === "textDocument/diagnostic") {
    const uri = params?.textDocument?.uri;
    if (!uri || !pullDiags) {
      respond(id, null);
      return;
    }
    const version = docVersions.get(uri) ?? 1;
    const resultId = `rid-${version}`;
    if (params?.previousResultId === resultId) {
      respond(id, { kind: "unchanged", resultId });
      return;
    }
    respond(id, { kind: "full", items: buildDiags(uri), resultId });
    return;
  }

  if (method === "workspace/symbol") {
    const uri = [...openDocs.keys()][0] ?? `${rootUri}/src/a.ts`;
    respond(id, [
      {
        name: params?.query ? `sym:${params.query}` : "sym",
        kind: 12,
        location: { uri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } },
      },
    ]);
    return;
  }

  if (method === "textDocument/definition" || method === "textDocument/references") {
    const uri = params?.textDocument?.uri ?? `${rootUri}/src/a.ts`;
    const loc = {
      uri,
      range: {
        start: { line: params?.position?.line ?? 0, character: params?.position?.character ?? 0 },
        end: { line: params?.position?.line ?? 0, character: (params?.position?.character ?? 0) + 1 },
      },
    };
    respond(id, method === "textDocument/references" ? [loc, loc] : loc);
    return;
  }

  if (method === "textDocument/hover") {
    respond(id, { contents: { kind: "plaintext", value: "hover:fake" } });
    return;
  }

  if (method === "textDocument/rename") {
    const uri = params?.textDocument?.uri;
    const newName = params?.newName ?? "renamed";
    if (!uri || !openDocs.has(uri)) {
      respond(id, { changes: {} });
      return;
    }
    const text = openDocs.get(uri);
    // Rename first identifier-like token "foo" if present, else char at position.
    const idx = text.indexOf("foo");
    if (idx >= 0) {
      const before = text.slice(0, idx);
      const line = before.split("\n").length - 1;
      const character = before.length - (before.lastIndexOf("\n") + 1);
      respond(id, {
        changes: {
          [uri]: [
            {
              range: {
                start: { line, character },
                end: { line, character: character + 3 },
              },
              newText: newName,
            },
          ],
        },
      });
      return;
    }
    respond(id, {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            newText: newName,
          },
        ],
      },
    });
    return;
  }

  if (id !== undefined) {
    respond(id, null);
  }
}

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) break;
    const header = buf.subarray(0, sep).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      process.stderr.write("bad header\n");
      process.exit(2);
    }
    const len = Number(match[1]);
    const start = sep + 4;
    if (buf.length < start + len) break;
    const body = buf.subarray(start, start + len).toString("utf8");
    buf = buf.subarray(start + len);
    try {
      handle(JSON.parse(body));
    } catch (e) {
      process.stderr.write(`${String(e)}\n`);
    }
  }
});
