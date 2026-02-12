import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import type { ProxyTargetDetailed } from "../types.ts";
import nodeHTTP from "node:http";
import nodeHTTPS from "node:https";
import { getPort, hasEncryptedConnection, setupOutgoing } from "../_utils.ts";
import { webOutgoingMiddleware } from "./web-outgoing.ts";
import { type ProxyMiddleware, defineProxyMiddleware } from "./_utils.ts";

const nativeAgents = { http: nodeHTTP, https: nodeHTTPS };
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * Sets `content-length` to '0' if request is of DELETE type.
 */
export const deleteLength = defineProxyMiddleware((req) => {
  if ((req.method === "DELETE" || req.method === "OPTIONS") && !req.headers["content-length"]) {
    req.headers["content-length"] = "0";
    delete req.headers["transfer-encoding"];
  }
});

/**
 * Sets timeout in request socket if it was specified in options.
 */
export const timeout = defineProxyMiddleware((req, res, options) => {
  if (options.timeout) {
    req.socket.setTimeout(options.timeout, () => {
      req.socket.destroy();
    });
  }
});

/**
 * Sets `x-forwarded-*` headers if specified in config.
 */
export const XHeaders = defineProxyMiddleware((req, res, options) => {
  if (!options.xfwd) {
    return;
  }

  const encrypted = (req as any).isSpdy || hasEncryptedConnection(req);
  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: getPort(req),
    proto: encrypted ? "https" : "http",
  };

  for (const header of ["for", "port", "proto"] as const) {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  }

  req.headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";
});

/**
 * Does the actual proxying. If `forward` is enabled fires up
 * a ForwardStream, same happens for ProxyStream. The request
 * just dies otherwise.
 *
 */
export const stream = defineProxyMiddleware((req, res, options, server, head, callback) => {
  // And we begin!
  server.emit("start", req, res, options.target || options.forward);

  const http = nativeAgents.http;
  const https = nativeAgents.https;

  const maxRedirects =
    typeof options.followRedirects === "number"
      ? options.followRedirects
      : options.followRedirects
        ? 5
        : 0;

  if (options.forward) {
    // If forward enable, so just pipe the request
    const forwardReq = (options.forward.protocol === "https:" ? https : http).request(
      setupOutgoing(options.ssl || {}, options, req, "forward"),
    );

    // error handler (e.g. ECONNRESET, ECONNREFUSED)
    // Handle errors on incoming request as well as it makes sense to
    const forwardError = createErrorHandler(forwardReq, options.forward);
    req.on("error", forwardError);
    forwardReq.on("error", forwardError);

    (options.buffer || req).pipe(forwardReq);
    if (!options.target) {
      res.end();
      return;
    }
  }

  // Request initalization
  const proxyReq = (options.target.protocol === "https:" ? https : http).request(
    setupOutgoing(options.ssl || {}, options, req),
  );

  // Enable developers to modify the proxyReq before headers are sent
  proxyReq.on("socket", (_socket) => {
    if (server && !proxyReq.getHeader("expect")) {
      server.emit("proxyReq", proxyReq, req, res, options);
    }
  });

  // allow outgoing socket to timeout so that we could
  // show an error page at the initial request
  if (options.proxyTimeout) {
    proxyReq.setTimeout(options.proxyTimeout, function () {
      proxyReq.abort();
    });
  }

  // Ensure we abort proxy if request is aborted
  req.on("aborted", function () {
    proxyReq.abort();
  });

  // Abort proxy request when client disconnects
  res.on("close", function () {
    if (!res.writableFinished) {
      proxyReq.destroy();
    }
  });

  // handle errors in proxy and incoming request, just like for forward proxy
  const proxyError = createErrorHandler(proxyReq, options.target);
  req.on("error", proxyError);
  proxyReq.on("error", proxyError);

  function createErrorHandler(proxyReq: ClientRequest, url: URL | ProxyTargetDetailed) {
    return function proxyError(err: Error) {
      if (req.socket.destroyed && (err as NodeJS.ErrnoException).code === "ECONNRESET") {
        server.emit("econnreset", err, req, res, url);
        return proxyReq.abort();
      }

      if (callback) {
        callback(err, req, res, url);
      } else {
        server.emit("error", err, req, res, url);
      }
    };
  }

  // Buffer request body when following redirects (needed for 307/308 replay)
  let bodyBuffer: Buffer | undefined;
  if (maxRedirects > 0) {
    const chunks: Buffer[] = [];
    const source = options.buffer || req;
    source.on("data", (chunk: Buffer) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      proxyReq.write(chunk);
    });
    source.on("end", () => {
      bodyBuffer = Buffer.concat(chunks);
      proxyReq.end();
    });
    source.on("error", (err: Error) => {
      proxyReq.destroy(err);
    });
  } else {
    (options.buffer || req).pipe(proxyReq);
  }

  function handleResponse(proxyRes: IncomingMessage, redirectCount: number, currentUrl: URL) {
    const statusCode = proxyRes.statusCode!;

    if (
      maxRedirects > 0 &&
      redirectStatuses.has(statusCode) &&
      redirectCount < maxRedirects &&
      proxyRes.headers.location
    ) {
      // Drain the redirect response body
      proxyRes.resume();

      const location = new URL(proxyRes.headers.location, currentUrl);

      // 301/302/303 → GET without body; 307/308 → preserve method and body
      const preserveMethod = statusCode === 307 || statusCode === 308;
      const redirectMethod = preserveMethod ? req.method || "GET" : "GET";

      const isHTTPS = location.protocol === "https:";
      const agent = isHTTPS ? https : http;

      // Build headers from original request
      const redirectHeaders: Record<string, string | string[] | undefined> = { ...req.headers };
      if (options.headers) {
        Object.assign(redirectHeaders, options.headers);
      }
      redirectHeaders.host = location.host;

      // Strip sensitive headers on cross-origin redirects
      if (location.host !== currentUrl.host) {
        delete redirectHeaders.authorization;
        delete redirectHeaders.cookie;
      }

      // Drop body-related headers when method changes to GET
      if (!preserveMethod) {
        delete redirectHeaders["content-length"];
        delete redirectHeaders["content-type"];
        delete redirectHeaders["transfer-encoding"];
      }

      const redirectOpts: nodeHTTP.RequestOptions = {
        hostname: location.hostname,
        port: location.port || (isHTTPS ? 443 : 80),
        path: location.pathname + location.search,
        method: redirectMethod,
        headers: redirectHeaders,
        agent: options.agent || false,
      };

      if (isHTTPS) {
        (redirectOpts as nodeHTTPS.RequestOptions).rejectUnauthorized =
          options.secure === undefined ? true : options.secure;
      }

      const redirectReq = agent.request(redirectOpts);

      if (server && !redirectReq.getHeader("expect")) {
        server.emit("proxyReq", redirectReq, req, res, options);
      }

      if (options.proxyTimeout) {
        redirectReq.setTimeout(options.proxyTimeout, () => {
          redirectReq.abort();
        });
      }

      const redirectError = createErrorHandler(redirectReq, location);
      redirectReq.on("error", redirectError);

      redirectReq.on("response", (nextRes: IncomingMessage) => {
        handleResponse(nextRes, redirectCount + 1, location);
      });

      if (preserveMethod && bodyBuffer && bodyBuffer.length > 0) {
        redirectReq.end(bodyBuffer);
      } else {
        redirectReq.end();
      }

      return;
    }

    // Non-redirect response (or max redirects exceeded)
    if (server) {
      server.emit("proxyRes", proxyRes, req, res);
    }

    if (!res.headersSent && !options.selfHandleResponse) {
      for (const pass of webOutgoingMiddleware) {
        if (pass(req, res, proxyRes, options)) {
          break;
        }
      }
    }

    if (res.finished) {
      if (server) {
        server.emit("end", req, res, proxyRes);
      }
    } else {
      res.on("close", function () {
        proxyRes.destroy();
      });
      proxyRes.on("end", function () {
        if (server) {
          server.emit("end", req, res, proxyRes);
        }
      });
      if (!options.selfHandleResponse) {
        proxyRes.pipe(res);
      }
    }
  }

  proxyReq.on("response", function (proxyRes) {
    handleResponse(proxyRes, 0, options.target as URL);
  });
});

export const webIncomingMiddleware: readonly ProxyMiddleware<ServerResponse>[] = [
  deleteLength,
  timeout,
  XHeaders,
  stream,
] as const;
