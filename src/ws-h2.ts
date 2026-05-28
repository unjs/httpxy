import type { IncomingHttpHeaders, ServerHttp2Stream } from "node:http2";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { connect as netConnect } from "node:net";
import { randomBytes } from "node:crypto";
import type { ProxyAddr } from "./types.ts";
import { parseAddr } from "./_utils.ts";

/**
 * Options for {@link proxyH2Upgrade}.
 */
export interface ProxyH2UpgradeOptions {
  /**
   * Extra headers to include in the upstream upgrade request.
   * Default: none.
   */
  headers?: Record<string, string>;
  /**
   * TLS options forwarded to `https.request`. Use `rejectUnauthorized: false`
   * for self-signed certs.
   * Default: none.
   */
  ssl?: Record<string, unknown>;
  /**
   * Whether to verify upstream TLS certificates.
   * Default: `true`.
   */
  secure?: boolean;
  /**
   * Idle timeout (ms) waiting for the upstream's 101 response.
   * Default: 15_000.
   */
  timeout?: number;
  /**
   * Override the request path sent upstream.
   * Default: the h2 stream's `:path` header.
   */
  path?: string;
}

const FORWARD_HEADERS = [
  "sec-websocket-protocol",
  "sec-websocket-extensions",
  "origin",
  "user-agent",
];

/**
 * Bridge a WebSocket-over-HTTP/2 (RFC 8441 extended-CONNECT) stream to an
 * upstream HTTP/1.1 WebSocket endpoint.
 *
 * Listen for `stream` events on an `Http2SecureServer` where
 * `headers[":method"] === "CONNECT"` and `headers[":protocol"] === "websocket"`,
 * then hand the stream + headers + target to this function. It opens a fresh
 * h1.1 `Upgrade` request to the upstream, waits for `101 Switching Protocols`,
 * and pipes raw bytes between the h2 stream and the upstream socket.
 *
 * This complements {@link proxyUpgrade}, which handles the same job for
 * browsers/clients speaking HTTP/1.1 (with `req.headers.upgrade ==="websocket"`).
 *
 * @param addr - Target server address (same shape as {@link proxyUpgrade}).
 * @param stream - The h2 server stream carrying the extended-CONNECT request.
 * @param headers - The h2 headers object received with the stream event.
 * @param opts - Optional proxy options.
 * @returns A promise resolved once the bridge is set up, rejected on error.
 *
 * @example
 * ```ts
 * import { proxyH2Upgrade } from "httpxy";
 * import { createSecureServer } from "node:http2";
 *
 * const server = createSecureServer({ key, cert, allowHTTP1: true, settings: { enableConnectProtocol: true } });
 * server.on("stream", (stream, headers) => {
 *   if (headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket") {
 *     proxyH2Upgrade("https://backend:443", stream, headers).catch((err) => {
 *       stream.respond({ ":status": 502 });
 *       stream.end();
 *     });
 *   }
 * });
 * ```
 */
export function proxyH2Upgrade(
  addr: string | ProxyAddr,
  stream: ServerHttp2Stream,
  headers: IncomingHttpHeaders,
  opts: ProxyH2UpgradeOptions = {},
): Promise<void> {
  const resolvedAddr = parseAddr(addr);
  const path = opts.path ?? getHeader(headers, ":path") ?? "/";
  const useSSL =
    typeof addr === "string" && !addr.startsWith("unix:")
      ? new URL(addr).protocol === "https:" || new URL(addr).protocol === "wss:"
      : false;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const wsKey = randomBytes(16).toString("base64");
    const outgoingHeaders: Record<string, string> = {
      Host: resolvedAddr.host || "localhost",
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": wsKey,
    };
    for (const h of FORWARD_HEADERS) {
      const v = getHeader(headers, h);
      if (v) outgoingHeaders[h] = v;
    }
    if (opts.headers) {
      Object.assign(outgoingHeaders, opts.headers);
    }

    const doRequest = useSSL ? httpsRequest : httpRequest;
    const upstreamReq = doRequest({
      hostname: resolvedAddr.host,
      port: resolvedAddr.port,
      path,
      method: "GET",
      headers: outgoingHeaders,
      timeout: opts.timeout ?? 15_000,
      rejectUnauthorized: opts.secure !== false,
      ...opts.ssl,
      socketPath: resolvedAddr.socketPath,
    });

    upstreamReq.once("timeout", () => {
      upstreamReq.destroy();
      settle(new Error(`Upstream did not respond with 101 within ${opts.timeout ?? 15_000}ms`));
    });

    upstreamReq.once("upgrade", (res, socket, head) => {
      const respond: Record<string, string | number> = { ":status": 200 };
      for (const h of ["sec-websocket-protocol", "sec-websocket-extensions"]) {
        const v = res.headers[h];
        if (typeof v === "string") respond[h] = v;
      }
      try {
        stream.respond(respond);
      } catch (err) {
        socket.destroy();
        settle(err as Error);
        return;
      }
      if (head?.length) stream.write(head);
      socket.pipe(stream);
      stream.pipe(socket);
      const teardown = () => {
        socket.destroy();
        if (!stream.destroyed && !stream.closed) stream.close();
      };
      stream.on("close", teardown);
      socket.on("close", teardown);
      stream.on("error", teardown);
      socket.on("error", teardown);
      settle();
    });

    upstreamReq.once("response", (res) => {
      if (settled) return;
      try {
        stream.respond({ ":status": res.statusCode || 502 });
        stream.end();
      } catch {
        /* stream already closed */
      }
      settle(new Error(`Upstream returned ${res.statusCode} (expected 101)`));
    });

    upstreamReq.once("error", (err) => {
      if (settled) return;
      try {
        stream.respond({ ":status": 502 });
        stream.end();
      } catch {
        /* stream already closed */
      }
      settle(err);
    });

    upstreamReq.end();
  });
}

/**
 * Bridge a WebSocket-over-HTTP/2 stream back to the same h2 server over a
 * fresh HTTP/1.1 TLS connection. Useful for in-process WebSocket endpoints
 * served by middleware that only speaks h1 (webpack-dev-server's HMR is the
 * canonical case).
 *
 * The target host/port are read from the h2 server's `address()`; ALPN is
 * forced to `http/1.1` so the server's `allowHTTP1: true` path takes over.
 */
export function proxyH2UpgradeSelfLoop(
  h2Server: { address(): { port: number; address?: string } | string | null },
  stream: ServerHttp2Stream,
  headers: IncomingHttpHeaders,
  opts: ProxyH2UpgradeOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const addr = h2Server.address();
    if (!addr || typeof addr === "string") {
      try {
        stream.respond({ ":status": 502 });
        stream.end();
      } catch {
        /* */
      }
      settle(new Error("h2 server has no listening address"));
      return;
    }

    const path = opts.path ?? getHeader(headers, ":path") ?? "/";
    // Self-loop default: skip cert verification — the upstream IS this same
    // server with whatever cert it was started with (typically dev/self-signed).
    // Callers can override with `secure: true` if they want to validate.
    const upstream = tlsConnect({
      host: "127.0.0.1",
      port: addr.port,
      servername: "localhost",
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: opts.secure === true,
      ...opts.ssl,
    });
    const wsKey = randomBytes(16).toString("base64");
    let headerBuf = Buffer.alloc(0);
    let tunneled = false;

    upstream.once("secureConnect", () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${getHeader(headers, ":authority") || "localhost"}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Version: 13`,
        `Sec-WebSocket-Key: ${wsKey}`,
      ];
      for (const h of ["sec-websocket-protocol", "sec-websocket-extensions", "origin"]) {
        const v = getHeader(headers, h);
        if (v) lines.push(`${h}: ${v}`);
      }
      lines.push("", "");
      upstream.write(lines.join("\r\n"));
    });

    const safeRespond = (status: number, extra?: Record<string, string>) => {
      if (stream.destroyed || stream.closed) return false;
      try {
        stream.respond({ ":status": status, ...extra });
        return true;
      } catch {
        return false;
      }
    };

    const onData = (chunk: Buffer) => {
      if (tunneled || stream.destroyed || stream.closed) {
        upstream.destroy();
        return;
      }
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const end = headerBuf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headerText = headerBuf.slice(0, end).toString();
      const m = headerText.match(/^HTTP\/1\.1 (\d+)/);
      if (!m || m[1] !== "101") {
        if (safeRespond(Number(m?.[1]) || 502)) stream.end();
        upstream.destroy();
        settle(new Error(`Self-loop upstream returned ${m?.[1] || "no-status"}`));
        return;
      }
      const respond: Record<string, string> = {};
      for (const line of headerText.split("\r\n").slice(1)) {
        const kv = line.match(/^([^:]+):\s*(.*)$/);
        if (!kv || kv[1] === undefined || kv[2] === undefined) continue;
        const name = kv[1].toLowerCase();
        if (name === "sec-websocket-protocol" || name === "sec-websocket-extensions") {
          respond[name] = kv[2];
        }
      }
      tunneled = true;
      upstream.removeListener("data", onData);
      if (!safeRespond(200, respond)) {
        upstream.destroy();
        settle(new Error("h2 stream closed before tunnel established"));
        return;
      }
      const leftover = headerBuf.slice(end + 4);
      if (leftover.length) stream.write(leftover);
      upstream.pipe(stream);
      stream.pipe(upstream);
      const teardown = () => {
        upstream.destroy();
        if (!stream.destroyed && !stream.closed) stream.close();
      };
      stream.on("close", teardown);
      upstream.on("close", teardown);
      stream.on("error", teardown);
      upstream.on("error", teardown);
      settle();
    };

    upstream.on("data", onData);
    upstream.on("error", (err) => {
      if (!tunneled) {
        safeRespond(502);
        try {
          stream.end();
        } catch {
          /* */
        }
        settle(err);
      }
    });
  });
}

function getHeader(headers: IncomingHttpHeaders, key: string): string | undefined {
  const v = headers[key];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

// netConnect imported for future Unix-socket support; keep the import live.
void netConnect;
