import { rewriteCookieProperty } from "../_utils.ts";
import { type ProxyOutgoingMiddleware, defineProxyOutgoingMiddleware } from "./_utils.ts";

const redirectRegex = /^201|30([1278])$/;

/**
 * If is a HTTP 1.0 request, remove chunk headers
 */
export const removeChunked = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  if (req.httpVersion === "1.0") {
    delete proxyRes.headers["transfer-encoding"];
  }
});

/**
 * If is a HTTP 1.0 request, set the correct connection header
 * or if connection header not present, then use `keep-alive`
 */
export const setConnection = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  if (req.httpVersion === "1.0") {
    proxyRes.headers.connection = req.headers.connection || "close";
  } else if (req.httpVersion !== "2.0" && !proxyRes.headers.connection) {
    proxyRes.headers.connection = req.headers.connection || "keep-alive";
  }
});

export const setRedirectHostRewrite = defineProxyOutgoingMiddleware(
  (req, res, proxyRes, options) => {
    if (
      (options.hostRewrite || options.autoRewrite || options.protocolRewrite) &&
      proxyRes.headers.location &&
      redirectRegex.test(String(proxyRes.statusCode))
    ) {
      const target =
        options.target instanceof URL ? options.target : new URL(options.target as string | URL);
      const u = new URL(proxyRes.headers.location);

      // Make sure the redirected host matches the target host before rewriting
      if (target.host !== u.host) {
        return;
      }

      if (options.hostRewrite) {
        u.host = options.hostRewrite;
      } else if (options.autoRewrite && req.headers.host) {
        u.host = req.headers.host;
      }
      if (options.protocolRewrite) {
        u.protocol = options.protocolRewrite;
      }

      proxyRes.headers.location = u.toString();
    }
  },
);

/**
 * Copy headers from proxyResponse to response
 * set each header in response object.
 *
 * @param {ClientRequest} Req Request object
 * @param {IncomingMessage} Res Response object
 * @param {proxyResponse} Res Response object from the proxy request
 * @param {Object} Options options.cookieDomainRewrite: Config to rewrite cookie domain
 *
 * @api private
 */
export const writeHeaders = defineProxyOutgoingMiddleware((req, res, proxyRes, options) => {
  const rewriteCookieDomainConfig =
    typeof options.cookieDomainRewrite === "string"
      ? // also test for ''
        { "*": options.cookieDomainRewrite }
      : options.cookieDomainRewrite;
  const rewriteCookiePathConfig =
    typeof options.cookiePathRewrite === "string"
      ? // also test for ''
        { "*": options.cookiePathRewrite }
      : options.cookiePathRewrite;

  const preserveHeaderKeyCase = options.preserveHeaderKeyCase;
  let rawHeaderKeyMap: Record<string, string> | undefined;
  const setHeader = function (key: string, header: string | string[] | undefined) {
    if (header === undefined) {
      return;
    }
    if (rewriteCookieDomainConfig && key.toLowerCase() === "set-cookie") {
      header = rewriteCookieProperty(header, rewriteCookieDomainConfig, "domain");
    }
    if (rewriteCookiePathConfig && key.toLowerCase() === "set-cookie") {
      header = rewriteCookieProperty(header, rewriteCookiePathConfig, "path");
    }
    res.setHeader(String(key).trim(), header);
  };

  // message.rawHeaders is added in: v0.11.6
  // https://nodejs.org/api/http.html#http_message_rawheaders
  if (preserveHeaderKeyCase && proxyRes.rawHeaders !== undefined) {
    rawHeaderKeyMap = {};
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      const key = proxyRes.rawHeaders[i]!;
      rawHeaderKeyMap[key.toLowerCase()] = key;
    }
  }

  for (let key of Object.keys(proxyRes.headers)) {
    const header = proxyRes.headers[key];
    if (preserveHeaderKeyCase && rawHeaderKeyMap) {
      key = rawHeaderKeyMap[key] || key;
    }
    setHeader(key, header);
  }
});

/**
 * Set the statusCode from the proxyResponse
 */
export const writeStatusCode = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
  if (proxyRes.statusMessage) {
    // @ts-expect-error
    res.statusCode = proxyRes.statusCode;
    res.statusMessage = proxyRes.statusMessage;
  } else {
    // @ts-expect-error
    res.statusCode = proxyRes.statusCode;
  }
});

export const webOutgoingMiddleware: readonly ProxyOutgoingMiddleware[] = [
  removeChunked,
  setConnection,
  setRedirectHostRewrite,
  writeHeaders,
  writeStatusCode,
] as const;
