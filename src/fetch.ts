import type { IncomingMessage, RequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { ProxyAddr } from "./types.ts";
import { defaultAgents, isSSL, joinURL, parseAddr } from "./_utils.ts";

/**
 * Options for {@link proxyFetch}.
 */
export interface ProxyFetchOptions {
  /**
   * Timeout in milliseconds for the upstream request.
   * Rejects with an error if the upstream does not respond within this time.
   */
  timeout?: number;
  /**
   * Add `x-forwarded-for`, `x-forwarded-port`, `x-forwarded-proto`, and
   * `x-forwarded-host` headers derived from the input URL.
   * Default: `false`.
   */
  xfwd?: boolean;
  /**
   * Rewrite the `Host` header to match the target address.
   * Default: `false` (original host from the input URL is kept).
   */
  changeOrigin?: boolean;
  /**
   * HTTP agent for connection pooling / reuse.
   * Default: `false` (no agent, no keep-alive).
   */
  agent?: any;
  /**
   * Follow HTTP redirects from the upstream.
   * `true` = max 5 hops; number = custom max.
   * Default: `false` (manual redirect, raw 3xx responses are returned).
   */
  followRedirects?: boolean | number;
  /**
   * TLS options forwarded to `https.request` (e.g. `{ rejectUnauthorized: false }`).
   * Also controls certificate verification — set `rejectUnauthorized: false` to skip.
   * Default: none.
   */
  ssl?: Record<string, unknown>;
}

/**
 * Proxy a request to a specific server address (TCP host/port or Unix socket)
 * using web standard {@link Request}/{@link Response} interfaces.
 *
 * Supports both HTTP and HTTPS upstream targets.
 *
 * @param addr - The target server address. Can be a URL string (`http://host:port`, `https://host:port`, `unix:/path`), or an object with `host`/`port` for TCP or `socketPath` for Unix sockets.
 * @param input - The request URL (string or URL) or a {@link Request} object.
 * @param inputInit - Optional {@link RequestInit} or {@link Request} to override method, headers, and body.
 * @param opts - Optional proxy options.
 */
export async function proxyFetch(
  addr: string | ProxyAddr,
  input: string | URL | Request,
  inputInit?: RequestInit | Request,
  opts?: ProxyFetchOptions,
) {
  const resolvedAddr = parseAddr(addr);

  // Detect protocol and base path from addr string
  let useHTTPS = false;
  let addrBasePath = "";
  if (typeof addr === "string" && !addr.startsWith("unix:")) {
    const addrURL = new URL(addr);
    useHTTPS = isSSL.test(addrURL.protocol);
    if (addrURL.pathname && addrURL.pathname !== "/") {
      addrBasePath = addrURL.pathname;
    }
  }

  let url: URL;
  let init: RequestInit | undefined;

  if (input instanceof Request) {
    url = new URL(input.url);
    init = {
      ...toInit(input),
      ...toInit(inputInit),
    };
  } else {
    url = new URL(input);
    init = toInit(inputInit);
  }
  init = {
    redirect: "manual",
    ...init,
  };
  if (init.body) {
    (init as RequestInit & { duplex: string }).duplex = "half";
  }

  // Merge addr base path with request path
  const requestPath = url.pathname + url.search;
  const path = addrBasePath ? joinURL(addrBasePath, requestPath) : requestPath;

  const reqHeaders: Record<string, string | string[]> = {};
  if (init.headers) {
    // Fast path: plain object — direct assign, no iteration needed
    if (!(init.headers instanceof Headers) && !Array.isArray(init.headers)) {
      Object.assign(reqHeaders, init.headers);
    } else {
      // Headers or [key, value][] — both are iterable pairs
      for (const [key, value] of init.headers as Iterable<[string, string]>) {
        const existing = reqHeaders[key];
        if (existing === undefined) {
          reqHeaders[key] = value;
        } else {
          reqHeaders[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
        }
      }
    }
  }

  // Add x-forwarded-* headers derived from the input URL
  if (opts?.xfwd) {
    if (!reqHeaders["x-forwarded-for"]) {
      reqHeaders["x-forwarded-for"] = url.hostname;
    }
    if (!reqHeaders["x-forwarded-port"]) {
      reqHeaders["x-forwarded-port"] = url.port || (url.protocol === "https:" ? "443" : "80");
    }
    if (!reqHeaders["x-forwarded-proto"]) {
      reqHeaders["x-forwarded-proto"] = url.protocol.replace(":", "");
    }
    if (!reqHeaders["x-forwarded-host"]) {
      reqHeaders["x-forwarded-host"] = url.host;
    }
  }

  // Rewrite Host header to match the target address
  if (opts?.changeOrigin) {
    if (resolvedAddr.socketPath) {
      reqHeaders.host = "localhost";
    } else {
      const targetHost = resolvedAddr.host || "localhost";
      const targetPort = resolvedAddr.port;
      const defaultPort = useHTTPS ? 443 : 80;
      reqHeaders.host =
        targetPort && targetPort !== defaultPort ? `${targetHost}:${targetPort}` : targetHost;
    }
  }

  const maxRedirects =
    typeof opts?.followRedirects === "number"
      ? opts.followRedirects
      : opts?.followRedirects
        ? 5
        : 0;

  // Buffer body only when redirects need replay; otherwise stream through
  const body = maxRedirects > 0 ? await _bufferBody(init.body) : _toNodeStream(init.body);

  // Default to keep-alive agent for connection reuse
  const agent =
    opts?.agent !== undefined
      ? opts.agent || false
      : useHTTPS
        ? defaultAgents.https
        : defaultAgents.http;

  const res = await _sendRequest(
    useHTTPS ? httpsRequest : httpRequest,
    init.method || "GET",
    path,
    reqHeaders,
    resolvedAddr,
    body,
    {
      signal: init.signal || undefined,
      agent,
      timeout: opts?.timeout,
      ssl: opts?.ssl,
      maxRedirects,
      redirectCount: 0,
      originalHeaders: reqHeaders,
    },
  );

  // Build Response — use plain header pairs to avoid Headers object overhead
  const resHeaders: [string, string][] = [];
  const rawHeaders = res.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i]!;
    const keyLower = key.toLowerCase();
    if (
      keyLower === "transfer-encoding" ||
      keyLower === "keep-alive" ||
      keyLower === "connection"
    ) {
      continue;
    }
    resHeaders.push([key, rawHeaders[i + 1]!]);
  }

  const hasBody = res.statusCode !== 204 && res.statusCode !== 304;
  return new Response(hasBody ? (Readable.toWeb(res) as ReadableStream) : null, {
    status: res.statusCode,
    statusText: res.statusMessage,
    headers: resHeaders,
  });
}

// --- Internal ---

function toInit(init?: RequestInit | Request): RequestInit | undefined {
  if (!init) {
    return undefined;
  }
  if (init instanceof Request) {
    return {
      method: init.method,
      headers: init.headers,
      body: init.body,
      duplex: init.body ? "half" : undefined,
    } as RequestInit;
  }
  return init;
}

/** Convert body to a Node.js Readable or Buffer for streaming without buffering. */
function _toNodeStream(body: BodyInit | null | undefined): Readable | Buffer | undefined {
  if (!body) {
    return undefined;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return Buffer.from(body as ArrayBuffer);
  }
  if (body instanceof ReadableStream) {
    return Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  }
  if (body instanceof Blob) {
    return Readable.fromWeb(body.stream() as import("node:stream/web").ReadableStream);
  }
  return Buffer.from(String(body));
}

/** Normalize any body type to Buffer (or undefined) for redirect replay. */
async function _bufferBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (!body) {
    return undefined;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return Buffer.from(body as ArrayBuffer);
  }
  if (body instanceof ReadableStream) {
    const readable = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  return Buffer.from(String(body));
}

const _redirectStatuses = new Set([301, 302, 303, 307, 308]);

interface _RequestOpts {
  signal?: AbortSignal;
  agent?: any;
  timeout?: number;
  ssl?: Record<string, unknown>;
  maxRedirects: number;
  redirectCount: number;
  originalHeaders: Record<string, string | string[]>;
}

function _sendRequest(
  doRequest: typeof httpRequest,
  method: string,
  path: string,
  headers: Record<string, string | string[]>,
  addr: ProxyAddr,
  body: Buffer | Readable | undefined,
  opts: _RequestOpts,
): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const reqOpts: RequestOptions = {
      method,
      path,
      headers,
      agent: opts.agent,
    };

    if (addr.socketPath) {
      reqOpts.socketPath = addr.socketPath;
    } else {
      reqOpts.hostname = addr.host || "localhost";
      reqOpts.port = addr.port;
    }

    if (opts.signal) {
      reqOpts.signal = opts.signal;
    }

    if (opts.ssl) {
      Object.assign(reqOpts, opts.ssl);
    }

    const req = doRequest(reqOpts, (res) => {
      const statusCode = res.statusCode!;

      if (
        opts.maxRedirects > 0 &&
        _redirectStatuses.has(statusCode) &&
        opts.redirectCount < opts.maxRedirects &&
        res.headers.location
      ) {
        res.resume();

        const currentURL = new URL(path, `http://${addr.host || "localhost"}:${addr.port || 80}`);
        const location = new URL(res.headers.location, currentURL);
        const redirectHTTPS = isSSL.test(location.protocol);

        const preserveMethod = statusCode === 307 || statusCode === 308;
        const redirectMethod = preserveMethod ? method : "GET";

        const redirectHeaders: Record<string, string | string[]> = {
          ...opts.originalHeaders,
        };
        redirectHeaders.host = location.host;

        if (location.host !== currentURL.host) {
          delete redirectHeaders.authorization;
          delete redirectHeaders.cookie;
        }

        if (!preserveMethod) {
          delete redirectHeaders["content-length"];
          delete redirectHeaders["content-type"];
          delete redirectHeaders["transfer-encoding"];
        }

        _sendRequest(
          redirectHTTPS ? httpsRequest : httpRequest,
          redirectMethod,
          location.pathname + location.search,
          redirectHeaders,
          {
            host: location.hostname,
            port: Number(location.port) || (redirectHTTPS ? 443 : 80),
          },
          preserveMethod ? body : undefined,
          { ...opts, redirectCount: opts.redirectCount + 1 },
        ).then(resolve, reject);
        return;
      }

      resolve(res);
    });

    req.on("error", reject);

    if (opts.timeout) {
      req.setTimeout(opts.timeout, () => {
        req.destroy(new Error("Proxy request timed out"));
      });
    }

    if (body instanceof Readable) {
      body.on("error", (err) => {
        req.destroy(err);
        reject(err);
      });
      body.pipe(req);
    } else if (body) {
      req.end(body);
    } else {
      req.end();
    }
  });
}
