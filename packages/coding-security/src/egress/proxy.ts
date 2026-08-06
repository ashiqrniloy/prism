/** Allow-list egress proxy: HTTP forward proxy + CONNECT tunnel, deny-all default, pinned DNS, audit. */

import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { assertPinned, isPrivateAddress, resolvePinned, type AddressResolver } from "./dns-pin.js";
import { resolveEgressLimits, type EgressLimitOptions, type ResolvedEgressLimits } from "./limits.js";
import type { EgressPolicy } from "./policy.js";
import { EgressError, type EgressAuditRecord, type EgressErrorCode } from "./types.js";

export interface EgressProxyEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface EgressAttestation {
  readonly proxyEndpoint: string;
  readonly denyDirectEgress: true;
  readonly policyFingerprint: string;
  readonly policyVersion: number;
  readonly startedAt: string;
}

export interface EgressProxyStats {
  readonly activeConnections: number;
  readonly totalConnections: number;
  readonly totalBytes: number;
  readonly denied: number;
}

export interface EgressProxy {
  /** Bind the listener. Inert until called; default 127.0.0.1:0. */
  readonly start: (options?: { readonly host?: string; readonly port?: number }) => Promise<EgressProxyEndpoint>;
  readonly endpoint: () => EgressProxyEndpoint;
  /** Attestation for sandbox composition; throws until started. */
  readonly attestation: () => EgressAttestation;
  /** Explicit policy reload; bumps policyVersion. */
  readonly reloadPolicy: (policy: EgressPolicy) => void;
  readonly stats: () => EgressProxyStats;
  readonly close: () => Promise<void>;
}

export interface CreateAllowListEgressProxyOptions {
  readonly policy: EgressPolicy;
  readonly audit?: (record: EgressAuditRecord) => void;
  readonly limits?: EgressLimitOptions;
  /** Test seam: replace DNS resolution. */
  readonly resolve?: AddressResolver;
}

interface Target {
  readonly host: string;
  readonly port: number;
  readonly protocol: "http" | "https";
  readonly path: string;
  readonly hostHeader: string;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function splitHostPort(authority: string): { host: string; port: number | undefined } {
  const trimmed = authority.trim();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close < 0) return { host: trimmed, port: undefined };
    const rest = trimmed.slice(close + 1);
    return { host: trimmed.slice(1, close), port: rest.startsWith(":") ? Number(rest.slice(1)) : undefined };
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon < 0) return { host: trimmed, port: undefined };
  const port = Number(trimmed.slice(colon + 1));
  return { host: trimmed.slice(0, colon), port: Number.isInteger(port) && port > 0 ? port : undefined };
}

function parseTarget(req: IncomingMessage): Target | undefined {
  const url = req.url ?? "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    const protocol = parsed.protocol === "https:" ? "https" : "http";
    if (protocol === "https") return undefined; // https absolute-form requires CONNECT; fail closed
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 80,
      protocol,
      path: parsed.pathname + parsed.search,
      hostHeader: parsed.host,
    };
  }
  const hostHeader = req.headers.host;
  if (!hostHeader) return undefined;
  const { host, port } = splitHostPort(hostHeader);
  if (!host) return undefined;
  return { host, port: port ?? 80, protocol: "http", path: url, hostHeader };
}

function parseLocation(location: string, base: Target): Target | undefined {
  let parsed: URL;
  try {
    parsed = new URL(location, `http://${base.hostHeader}`);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:") return undefined; // https redirects require CONNECT; fail closed
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 80,
    protocol: "http",
    path: parsed.pathname + parsed.search,
    hostHeader: parsed.host,
  };
}

/** Bounded, backpressured pipe with a byte cap. */
function pipeBounded(src: Readable, dest: Writable, maxBytes: number, onExceed: () => void, onBytes?: (n: number) => void): void {
  let total = 0;
  src.on("data", (chunk: Buffer) => {
    total += chunk.length;
    onBytes?.(chunk.length);
    if (total > maxBytes) {
      onExceed();
      src.destroy();
      dest.destroy();
      return;
    }
    if (!dest.write(chunk)) {
      src.pause();
      dest.once("drain", () => src.resume());
    }
  });
  src.on("end", () => dest.end());
  src.on("error", () => dest.destroy());
  dest.on("error", () => src.destroy());
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }
  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

export function createAllowListEgressProxy(options: CreateAllowListEgressProxyOptions): EgressProxy {
  const limits: ResolvedEgressLimits = resolveEgressLimits(options.limits);
  let policy = options.policy;
  let policyVersion = 0;
  let started = false;
  let startedAt = "";
  let endpoint: EgressProxyEndpoint | undefined;
  let server: Server | undefined;
  let active = 0;
  let total = 0;
  let totalBytes = 0;
  let denied = 0;
  const sockets = new Set<Socket>();
  const semaphore = new Semaphore(limits.concurrentConnections);

  const audit = (record: Omit<EgressAuditRecord, "id" | "ts">): void => {
    options.audit?.({ id: randomUUID(), ts: new Date().toISOString(), ...record });
  };

  const failHttp = (res: ServerResponse, status: number, code: EgressErrorCode, message: string): void => {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(`${code}: ${message}`);
  };

  const handleHttp = (req: IncomingMessage, res: ServerResponse): void => {
    const clientAddress = req.socket.remoteAddress;
    const startedAtMs = Date.now();
    const target = parseTarget(req);
    if (!target) {
      denied += 1;
      audit({
        decision: "deny",
        host: req.headers.host ?? "?",
        port: 0,
        protocol: "http",
        reason: "ERR_PRISM_EGRESS_POLICY: malformed target",
        clientAddress,
      });
      failHttp(res, 400, "ERR_PRISM_EGRESS_POLICY", "malformed request target");
      return;
    }
    const deadline = setTimeout(() => {
      audit({
        decision: "deny",
        host: target.host,
        port: target.port,
        protocol: target.protocol,
        reason: "ERR_PRISM_EGRESS_LIMIT: transfer time exceeded",
        durationMs: Date.now() - startedAtMs,
        clientAddress,
      });
      failHttp(res, 504, "ERR_PRISM_EGRESS_LIMIT", "transfer time exceeded");
    }, limits.transferTimeMs);

    const run = async (current: Target, hop: number, isFirstHop: boolean): Promise<void> => {
      const rule = policy.match(current.host, current.port, current.protocol);
      if (!rule) {
        denied += 1;
        audit({
          decision: "deny",
          host: current.host,
          port: current.port,
          protocol: current.protocol,
          reason: "ERR_PRISM_EGRESS_DENIED: no matching rule",
          durationMs: Date.now() - startedAtMs,
          clientAddress,
        });
        failHttp(res, 403, "ERR_PRISM_EGRESS_DENIED", `egress denied: ${current.host}:${current.port} ${current.protocol}`);
        return;
      }
      let pinned: readonly string[];
      try {
        pinned = await resolvePinned(current.host, options.resolve);
      } catch (error) {
        denied += 1;
        audit({
          decision: "deny",
          host: current.host,
          port: current.port,
          protocol: current.protocol,
          reason: "ERR_PRISM_EGRESS_DNS",
          durationMs: Date.now() - startedAtMs,
          clientAddress,
        });
        failHttp(res, 502, "ERR_PRISM_EGRESS_DNS", error instanceof Error ? error.message : "DNS failure");
        return;
      }
      const connectable = pinned.filter((ip) => !isPrivateAddress(ip) || rule.allowPrivate === true);
      if (connectable.length === 0) {
        denied += 1;
        audit({
          decision: "deny",
          host: current.host,
          port: current.port,
          protocol: current.protocol,
          reason: "ERR_PRISM_EGRESS_DNS: no connectable pinned address",
          durationMs: Date.now() - startedAtMs,
          clientAddress,
        });
        failHttp(res, 502, "ERR_PRISM_EGRESS_DNS", "no connectable pinned address");
        return;
      }
      const upstream = httpRequest({
        host: connectable[0],
        port: current.port,
        method: req.method,
        path: current.path,
        headers: { ...req.headers, host: current.hostHeader },
        setHost: false,
      });
      if (isFirstHop) {
        pipeBounded(req, upstream, limits.requestBytes, () => {
          audit({
            decision: "deny",
            host: current.host,
            port: current.port,
            protocol: current.protocol,
            reason: "ERR_PRISM_EGRESS_LIMIT: request bytes exceeded",
            durationMs: Date.now() - startedAtMs,
            clientAddress,
          });
          failHttp(res, 413, "ERR_PRISM_EGRESS_LIMIT", "request bytes exceeded");
        });
      } else {
        upstream.end();
      }
      const upRes = await new Promise<IncomingMessage>((resolve, reject) => {
        upstream.once("response", resolve);
        upstream.once("error", reject);
      });
      try {
        assertPinned(current.host, upstream.socket?.remoteAddress, connectable);
      } catch (error) {
        denied += 1;
        audit({
          decision: "deny",
          host: current.host,
          port: current.port,
          protocol: current.protocol,
          reason: "ERR_PRISM_EGRESS_DNS: rebinding detected",
          durationMs: Date.now() - startedAtMs,
          clientAddress,
        });
        failHttp(res, 502, "ERR_PRISM_EGRESS_DNS", error instanceof Error ? error.message : "rebinding detected");
        return;
      }
      if (REDIRECT_CODES.has(upRes.statusCode ?? 0) && upRes.headers.location) {
        upRes.resume();
        if (hop >= limits.redirectHops) {
          denied += 1;
          audit({
            decision: "deny",
            host: current.host,
            port: current.port,
            protocol: current.protocol,
            reason: "ERR_PRISM_EGRESS_LIMIT: redirect hops exceeded",
            durationMs: Date.now() - startedAtMs,
            clientAddress,
          });
          failHttp(res, 502, "ERR_PRISM_EGRESS_LIMIT", "redirect hops exceeded");
          return;
        }
        const next = parseLocation(upRes.headers.location, current);
        if (!next) {
          denied += 1;
          audit({
            decision: "deny",
            host: current.host,
            port: current.port,
            protocol: current.protocol,
            reason: "ERR_PRISM_EGRESS_POLICY: redirect target not http",
            durationMs: Date.now() - startedAtMs,
            clientAddress,
          });
          failHttp(res, 502, "ERR_PRISM_EGRESS_POLICY", "redirect target not http");
          return;
        }
        await run(next, hop + 1, false);
        return;
      }
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      pipeBounded(
        upRes,
        res,
        limits.responseBytes,
        () => {
          audit({
            decision: "deny",
            host: current.host,
            port: current.port,
            protocol: current.protocol,
            reason: "ERR_PRISM_EGRESS_LIMIT: response bytes exceeded",
            durationMs: Date.now() - startedAtMs,
            clientAddress,
          });
          failHttp(res, 502, "ERR_PRISM_EGRESS_LIMIT", "response bytes exceeded");
        },
        (n) => {
          totalBytes += n;
        },
      );
      audit({
        decision: "allow",
        host: current.host,
        port: current.port,
        protocol: current.protocol,
        durationMs: Date.now() - startedAtMs,
        clientAddress,
      });
    };

    void (async () => {
      const release = await semaphore.acquire();
      active += 1;
      total += 1;
      res.once("close", () => {
        clearTimeout(deadline);
        active -= 1;
        release();
      });
      try {
        await run(target, 1, true);
      } catch {
        denied += 1;
        audit({
          decision: "deny",
          host: target.host,
          port: target.port,
          protocol: target.protocol,
          reason: "ERR_PRISM_EGRESS_DNS: upstream failure",
          durationMs: Date.now() - startedAtMs,
          clientAddress,
        });
        failHttp(res, 502, "ERR_PRISM_EGRESS_DNS", "upstream failure");
      }
    })();
  };

  const handleConnect = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const clientAddress = socket.remoteAddress;
    const startedAtMs = Date.now();
    const { host, port } = splitHostPort(req.url ?? "");
    const deadline = setTimeout(() => {
      audit({
        decision: "deny",
        host,
        port: port ?? 0,
        protocol: "https",
        reason: "ERR_PRISM_EGRESS_LIMIT: transfer time exceeded",
        durationMs: Date.now() - startedAtMs,
        clientAddress,
      });
      socket.destroy();
    }, limits.transferTimeMs);

    void (async () => {
      const release = await semaphore.acquire();
      active += 1;
      total += 1;
      socket.once("close", () => {
        clearTimeout(deadline);
        active -= 1;
        release();
      });
      try {
        if (!host || port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
          denied += 1;
          audit({
            decision: "deny",
            host: host ?? "?",
            port: port ?? 0,
            protocol: "https",
            reason: "ERR_PRISM_EGRESS_POLICY: malformed CONNECT target",
            clientAddress,
          });
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }
        const rule = policy.match(host, port, "https");
        if (!rule) {
          denied += 1;
          audit({ decision: "deny", host, port, protocol: "https", reason: "ERR_PRISM_EGRESS_DENIED: no matching rule", clientAddress });
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        let pinned: readonly string[];
        try {
          pinned = await resolvePinned(host, options.resolve);
        } catch {
          denied += 1;
          audit({ decision: "deny", host, port, protocol: "https", reason: "ERR_PRISM_EGRESS_DNS", clientAddress });
          socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          socket.destroy();
          return;
        }
        const connectable = pinned.filter((ip) => !isPrivateAddress(ip) || rule.allowPrivate === true);
        if (connectable.length === 0) {
          denied += 1;
          audit({
            decision: "deny",
            host,
            port,
            protocol: "https",
            reason: "ERR_PRISM_EGRESS_DNS: no connectable pinned address",
            clientAddress,
          });
          socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          socket.destroy();
          return;
        }
        const upstream = netConnect({ host: connectable[0], port });
        sockets.add(upstream);
        upstream.once("close", () => sockets.delete(upstream));
        upstream.once("error", () => {
          audit({
            decision: "deny",
            host,
            port,
            protocol: "https",
            reason: "ERR_PRISM_EGRESS_DNS: upstream connect failed",
            clientAddress,
          });
          socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          socket.destroy();
        });
        upstream.once("connect", () => {
          try {
            assertPinned(host, upstream.remoteAddress, connectable);
          } catch (error) {
            denied += 1;
            audit({ decision: "deny", host, port, protocol: "https", reason: "ERR_PRISM_EGRESS_DNS: rebinding detected", clientAddress });
            socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            socket.destroy();
            upstream.destroy();
            return;
          }
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          pipeBounded(
            socket,
            upstream,
            limits.requestBytes,
            () => {
              audit({
                decision: "deny",
                host,
                port,
                protocol: "https",
                reason: "ERR_PRISM_EGRESS_LIMIT: request bytes exceeded",
                clientAddress,
              });
              socket.destroy();
              upstream.destroy();
            },
            (n) => {
              totalBytes += n;
            },
          );
          pipeBounded(
            upstream,
            socket,
            limits.responseBytes,
            () => {
              audit({
                decision: "deny",
                host,
                port,
                protocol: "https",
                reason: "ERR_PRISM_EGRESS_LIMIT: response bytes exceeded",
                clientAddress,
              });
              socket.destroy();
              upstream.destroy();
            },
            (n) => {
              totalBytes += n;
            },
          );
          audit({ decision: "allow", host, port, protocol: "https", clientAddress });
        });
      } catch {
        socket.destroy();
      }
    })();
  };

  const proxy: EgressProxy = {
    async start({ host = "127.0.0.1", port = 0 } = {}) {
      if (started) return endpoint as EgressProxyEndpoint;
      const srv = createServer(handleHttp);
      srv.on("connect", handleConnect);
      srv.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      await new Promise<void>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(port, host, () => {
          srv.removeListener("error", reject);
          resolve();
        });
      });
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        throw new EgressError("ERR_PRISM_EGRESS_POLICY", "proxy failed to bind");
      }
      server = srv;
      endpoint = { host, port: addr.port };
      started = true;
      startedAt = new Date().toISOString();
      return endpoint;
    },
    endpoint() {
      if (!started || !endpoint) throw new EgressError("ERR_PRISM_EGRESS_ATTESTATION", "proxy not started");
      return endpoint;
    },
    attestation() {
      if (!started || !endpoint) {
        throw new EgressError("ERR_PRISM_EGRESS_ATTESTATION", "proxy not started; no attestation available");
      }
      return {
        proxyEndpoint: `http://${endpoint.host}:${endpoint.port}`,
        denyDirectEgress: true,
        policyFingerprint: policy.fingerprint,
        policyVersion,
        startedAt,
      };
    },
    reloadPolicy(next) {
      policy = next;
      policyVersion += 1;
    },
    stats() {
      return { activeConnections: active, totalConnections: total, totalBytes, denied };
    },
    async close() {
      if (!server) return;
      const srv = server;
      server = undefined;
      started = false;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    },
  };
  return proxy;
}
