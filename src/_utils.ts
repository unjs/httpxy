import httpNative from "node:http";
import httpsNative from "node:https";
import net from "node:net";
import type { ProxyAddr, ProxyServerOptions, ProxyTarget, ProxyTargetDetailed } from "./types.ts";
import type { Http2ServerRequest } from "node:http2";

const upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i;

/**
 * Simple Regex for testing if protocol is https
 */
export const isSSL = /^https|wss/;

/**
 * Node.js HTTP/2 accepts pseudo headers and it may conflict
 * with request options.
 *
 * Let's just blacklist those potential conflicting pseudo
 * headers.
 */
const HTTP2_HEADER_BLACKLIST = [":method", ":path", ":scheme", ":authority"];

/**
 * Copies the right headers from `options` and `req` to
 * `outgoing` which is then used to fire the proxied
 * request.
 *
 * Examples:
 *
 *    common.setupOutgoing(outgoing, options, req)
 *    // => { host: ..., hostname: ...}
 *
 * @param outgoing Base object to be filled with required properties
 * @param options Config object passed to the proxy
 * @param req Request Object
 * @param forward String to select forward or target
 *
 * @return Outgoing Object with all required properties set
 *
 * @api private
 */
export function setupOutgoing(
  outgoing: httpNative.RequestOptions & httpsNative.RequestOptions,
  options: ProxyServerOptions & {
    target: ProxyTarget;
    forward?: ProxyTarget;
    ca?: string;
    method?: string;
  },
  req: httpNative.IncomingMessage | Http2ServerRequest,
  forward?: "forward" | "target",
): httpNative.RequestOptions | httpsNative.RequestOptions {
  outgoing.port =
    (options[forward || "target"] as URL).port ||
    (isSSL.test((options[forward || "target"] as URL).protocol ?? "http") ? 443 : 80);

  for (const e of [
    "host",
    "hostname",
    "socketPath",
    "pfx",
    "key",
    "passphrase",
    "cert",
    "ca",
    "ciphers",
    "secureProtocol",
  ] as const) {
    const value = (options[forward || "target"] as ProxyTargetDetailed)[e];
    outgoing[e] = value as any;
  }

  outgoing.method = options.method || req.method;
  outgoing.headers = { ...req.headers };

  // before clean up HTTP/2 blacklist header, we might wanna override host first
  if (req.headers?.[":authority"]) {
    outgoing.headers.host = req.headers[":authority"] as string;
  }
  // host override must happen before composing/merging the final outgoing headers

  if (options.headers) {
    outgoing.headers = { ...outgoing.headers, ...options.headers };
  }

  if (req.httpVersionMajor > 1) {
    // ignore potential conflicting HTTP/2 pseudo headers
    for (const header of HTTP2_HEADER_BLACKLIST) {
      delete outgoing.headers[header];
    }
  }

  if (options.auth) {
    outgoing.auth = options.auth;
  }

  if (options.ca) {
    outgoing.ca = options.ca;
  }

  if (isSSL.test((options[forward || "target"] as URL).protocol ?? "http")) {
    outgoing.rejectUnauthorized = options.secure === undefined ? true : options.secure;
  }

  outgoing.agent = options.agent || false;
  outgoing.localAddress = options.localAddress;

  //
  // Remark: If we are false and not upgrading, set the connection: close. This is the right thing to do
  // as node core doesn't handle this COMPLETELY properly yet.
  //
  if (!outgoing.agent) {
    outgoing.headers = outgoing.headers || {};
    if (
      typeof outgoing.headers.connection !== "string" ||
      !upgradeHeader.test(outgoing.headers.connection)
    ) {
      outgoing.headers.connection = "close";
    }
  }

  // the final path is target path + relative path requested by user:
  const target = options[forward || "target"];
  const targetPath = target && options.prependPath !== false ? (target as URL).pathname || "" : "";

  const reqUrl = req.url || "";
  const qIdx = reqUrl.indexOf("?");
  const reqPath = qIdx === -1 ? reqUrl : reqUrl.slice(0, qIdx);
  const reqSearch = qIdx === -1 ? "" : reqUrl.slice(qIdx);
  const normalizedPath = reqPath ? (reqPath[0] === "/" ? reqPath : "/" + reqPath) : "/";
  let outgoingPath = options.toProxy ? "/" + reqUrl : normalizedPath + reqSearch;

  //
  // Remark: ignorePath will just straight up ignore whatever the request's
  // path is. This can be labeled as FOOT-GUN material if you do not know what
  // you are doing and are using conflicting options.
  //
  outgoingPath = options.ignorePath ? "" : outgoingPath;
  outgoing.path = joinURL(targetPath, outgoingPath);

  if (options.changeOrigin) {
    outgoing.headers.host =
      requiresPort(outgoing.port, (options[forward || "target"] as URL).protocol) &&
      !hasPort(outgoing.host)
        ? outgoing.host + ":" + outgoing.port
        : (outgoing.host ?? undefined);
  }
  return outgoing;
}

// From https://github.com/unjs/h3/blob/e8adfa/src/utils/internal/path.ts#L16C1-L36C2
export function joinURL(base: string | undefined, path: string | undefined): string {
  if (!base || base === "/") {
    return path || "/";
  }
  if (!path || path === "/") {
    return base || "/";
  }
  // eslint-disable-next-line unicorn/prefer-at
  const baseHasTrailing = base[base.length - 1] === "/";
  const pathHasLeading = path[0] === "/";
  if (baseHasTrailing && pathHasLeading) {
    return base + path.slice(1);
  }
  if (!baseHasTrailing && !pathHasLeading) {
    return base + "/" + path;
  }
  return base + path;
}

/**
 * Set the proper configuration for sockets,
 * set no delay and set keep alive, also set
 * the timeout to 0.
 *
 * Examples:
 *
 *    common.setupSocket(socket)
 *    // => Socket
 *
 * @param socket instance to setup
 *
 * @return Return the configured socket.
 *
 * @api private
 */

export function setupSocket(socket: net.Socket): net.Socket {
  socket.setTimeout(0);
  socket.setNoDelay(true);

  socket.setKeepAlive(true, 0);

  return socket;
}

/**
 * Get the port number from the host. Or guess it based on the connection type.
 *
 * @param req Incoming HTTP request.
 *
 * @return The port number.
 *
 * @api private
 */
export function getPort(req: httpNative.IncomingMessage | Http2ServerRequest): string {
  const hostHeader = (req.headers[":authority"] as string | undefined) || req.headers.host;
  const res = hostHeader ? hostHeader.match(/:(\d+)/) : "";
  if (res) {
    return res[1]!;
  }
  return hasEncryptedConnection(req) ? "443" : "80";
}

/**
 * Check if the request has an encrypted connection.
 *
 * @param req Incoming HTTP request.
 *
 * @return Whether the connection is encrypted or not.
 *
 * @api private
 */
export function hasEncryptedConnection(
  req: httpNative.IncomingMessage | Http2ServerRequest,
): boolean {
  // req.connection.pair probably does not exist anymore
  if ("connection" in req) {
    if ("encrypted" in req.connection) {
      return req.connection.encrypted;
    }
    if ("pair" in req.connection) {
      return !!req.connection.pair;
    }
  }
  // Since Node.js v16 we now have req.socket
  if ("socket" in req) {
    if ("encrypted" in req.socket) {
      return req.socket.encrypted;
    }
    if ("pair" in req.socket) {
      return !!req.socket.pair;
    }
  }

  return false;
}

/**
 * Rewrites or removes the domain of a cookie header
 *
 * @param header
 * @param config, mapping of domain to rewritten domain.
 *        '*' key to match any domain, null value to remove the domain.
 *
 * @api private
 */
export function rewriteCookieProperty(
  header: string,
  config: Record<string, string>,
  property: string,
): string;
export function rewriteCookieProperty(
  header: string | string[],
  config: Record<string, string>,
  property: string,
): string | string[];
export function rewriteCookieProperty(
  header: string | string[],
  config: Record<string, string>,
  property: string,
): string | string[] {
  if (Array.isArray(header)) {
    return header.map(function (headerElement) {
      return rewriteCookieProperty(headerElement, config, property);
    });
  }
  return header.replace(
    new RegExp(String.raw`(;\s*` + property + "=)([^;]+)", "i"),
    function (match, prefix, previousValue) {
      let newValue;
      if (previousValue in config) {
        newValue = config[previousValue];
      } else if ("*" in config) {
        newValue = config["*"];
      } else {
        // no match, return previous value
        return match;
      }
      // replace or remove value
      return newValue ? prefix + newValue : "";
    },
  );
}

/**
 * Parse and validate a proxy address.
 *
 * @param addr - URL string (`http://host:port`, `ws://host:port`, `unix:/path`) or a `ProxyAddr` object.
 *
 * @api private
 */
export function parseAddr(addr: string | ProxyAddr): ProxyAddr {
  if (typeof addr === "string") {
    if (addr.startsWith("unix:")) {
      return { socketPath: addr.slice(5) };
    }
    const url = new URL(addr);
    return {
      host: url.hostname,
      port: Number(url.port) || (isSSL.test(url.protocol) ? 443 : 80),
    };
  }
  if (!addr.socketPath && !addr.port) {
    throw new Error("ProxyAddr must have either `port` or `socketPath`");
  }
  return addr;
}

/**
 * Check the host and see if it potentially has a port in it (keep it simple)
 *
 * @returns Whether we have one or not
 *
 * @api private
 */
export function hasPort(host: string | null | undefined): boolean {
  return host ? !!~host.indexOf(":") : false;
}

/**
 * Check if the port is required for the protocol
 *
 * Ported from https://github.com/unshiftio/requires-port/blob/master/index.js
 *
 * @returns Whether the port is required for the protocol
 *
 * @api private
 */
export function requiresPort(_port: string | number, _protocol: string | undefined): boolean {
  const protocol = _protocol?.split(":")[0];
  const port = +_port;

  if (!port) return false;

  switch (protocol) {
    case "http":
    case "ws": {
      return port !== 80;
    }

    case "https":
    case "wss": {
      return port !== 443;
    }

    case "ftp": {
      return port !== 21;
    }

    case "gopher": {
      return port !== 70;
    }

    case "file": {
      return false;
    }
  }

  return port !== 0;
}
