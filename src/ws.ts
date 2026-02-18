import type { IncomingMessage, RequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { ProxyAddr } from "./types.ts";
import {
  getPort,
  hasEncryptedConnection,
  isSSL,
  parseAddr,
  setupOutgoing,
  setupSocket,
} from "./_utils.ts";

/**
 * Options for {@link proxyUpgrade}.
 */
export interface ProxyUpgradeOptions {
  /**
   * Add `x-forwarded-for`, `x-forwarded-port`, and `x-forwarded-proto` headers.
   * Default: `false` (headers are not added).
   */
  xfwd?: boolean;
  /**
   * Rewrite the `Host` header to match the target.
   * Default: `false` (original host is kept).
   */
  changeOrigin?: boolean;
  /**
   * Extra headers to include in the upstream upgrade request.
   * Default: none.
   */
  headers?: Record<string, string>;
  /**
   * TLS options forwarded to `https.request`.
   * Default: none.
   */
  ssl?: Record<string, unknown>;
  /**
   * Whether to verify upstream TLS certificates.
   * Default: `true`.
   */
  secure?: boolean;
  /**
   * HTTP/HTTPS agent used for the upstream request.
   * Default: `false` (no keep-alive agent is used).
   */
  agent?: any;
  /**
   * Local interface address to bind for upstream connections.
   * Default: OS-selected local address.
   */
  localAddress?: string;
  /**
   * Basic auth credentials in `username:password` format.
   * Default: none.
   */
  auth?: string;
  /**
   * Prepend the target path to the proxied request path.
   * Default: `true`.
   */
  prependPath?: boolean;
  /**
   * Ignore the incoming request path when building the upstream path.
   * Default: `false` (incoming path is used).
   */
  ignorePath?: boolean;
  /**
   * Send absolute URL in request path when proxying to another proxy.
   * Default: `false` (path-only request target is used).
   */
  toProxy?: boolean;
}

/**
 * Proxy a WebSocket upgrade request to a target address without creating a
 * {@link ProxyServer} instance. Similar to {@link proxyFetch} but for
 * WebSocket upgrades.
 *
 * @param addr - Target server address. Can be a URL string (`http://host:port`, `ws://host:port`, `unix:/path`), or an object with `host`/`port` for TCP or `socketPath` for Unix sockets.
 * @param req - The incoming HTTP upgrade request.
 * @param socket - The network socket between the server and client.
 * @param head - The first packet of the upgraded stream (may be empty).
 * @param opts - Optional proxy options.
 * @returns A promise that resolves with the upstream proxy socket once the
 * WebSocket connection is established, or rejects on error.
 */
export function proxyUpgrade(
  addr: string | ProxyAddr,
  req: IncomingMessage,
  socket: Duplex,
  head?: Buffer,
  opts?: ProxyUpgradeOptions,
): Promise<Socket> {
  const resolvedAddr = parseAddr(addr);

  // Validate WS upgrade request
  if (req.method !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return Promise.reject(new Error("Not a valid WebSocket upgrade request"));
  }

  // Set x-forwarded-* headers
  if (opts?.xfwd) {
    const xfFor = req.headers["x-forwarded-for"];
    const xfPort = req.headers["x-forwarded-port"];
    const xfProto = req.headers["x-forwarded-proto"];
    req.headers["x-forwarded-for"] = `${xfFor ? `${xfFor},` : ""}${req.socket?.remoteAddress}`;
    req.headers["x-forwarded-port"] = `${xfPort ? `${xfPort},` : ""}${getPort(req)}`;
    req.headers["x-forwarded-proto"] =
      `${xfProto ? `${xfProto},` : ""}${hasEncryptedConnection(req) ? "wss" : "ws"}`;
  }

  // Build target URL for setupOutgoing
  const target = _buildTargetURL(resolvedAddr);
  const requestOptions: ProxyUpgradeOptions & { target: URL } = {
    ...opts,
    target,
    prependPath: opts?.prependPath !== false,
  };

  const outgoing = setupOutgoing(
    requestOptions.ssl || {},
    requestOptions as Parameters<typeof setupOutgoing>[1],
    req,
  );

  const sock = socket as Socket;

  return new Promise<Socket>((resolve, reject) => {
    let settled = false;

    setupSocket(sock);

    if (head && head.length > 0) {
      sock.unshift(head);
    }

    sock.once("error", onSocketError);

    const doRequest = isSSL.test(target.protocol) ? httpsRequest : httpRequest;
    const proxyReq = doRequest(outgoing as RequestOptions);

    proxyReq.once("error", onOutgoingError);

    proxyReq.once("response", (res) => {
      // If upgrade event isn't going to happen, relay the response and reject
      if (!(res as any).upgrade) {
        sock.write(
          _createHttpHeader(
            `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`,
            res.headers,
          ),
        );
        res.pipe(sock);
        if (!settled) {
          settled = true;
          reject(new Error("Upstream server did not upgrade the connection"));
        }
      }
    });

    proxyReq.once("upgrade", (proxyRes, proxySocket, proxyHead) => {
      proxySocket.once("error", onOutgoingError);

      sock.removeListener("error", onSocketError);
      sock.once("error", () => {
        proxySocket.end();
      });

      setupSocket(proxySocket);

      if (proxyHead && proxyHead.length > 0) {
        proxySocket.unshift(proxyHead);
      }

      sock.write(_createHttpHeader("HTTP/1.1 101 Switching Protocols", proxyRes.headers));
      proxySocket.pipe(sock).pipe(proxySocket);

      settled = true;
      resolve(proxySocket);
    });

    proxyReq.end();

    function onSocketError(err: Error) {
      proxyReq.destroy();
      if (!settled) {
        settled = true;
        reject(err);
      }
    }

    function onOutgoingError(err: Error) {
      sock.end();
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}

// --- Internal ---

function _buildTargetURL(addr: ProxyAddr): URL {
  if (addr.socketPath) {
    const url = new URL("http://unix");
    (url as any).socketPath = addr.socketPath;
    return url;
  }
  return new URL(`http://${addr.host || "localhost"}${addr.port ? `:${addr.port}` : ""}`);
}

function _createHttpHeader(
  line: string,
  headers: Record<string, string | string[] | undefined>,
): string {
  let result = line;
  for (const key of Object.keys(headers)) {
    const value = headers[key];
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const element of value) {
        result += `\r\n${key}: ${element}`;
      }
    } else {
      result += `\r\n${key}: ${value}`;
    }
  }
  return `${result}\r\n\r\n`;
}
