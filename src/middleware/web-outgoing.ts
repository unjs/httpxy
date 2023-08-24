import { rewriteCookieProperty } from "../_utils";
import {
  ProxyOutgoingMiddleware,
  defineProxyOutgoingMiddleware,
} from "./_utils";

const redirectRegex = /^201|30([1278])$/;

/**
 * If is a HTTP 1.0 request, remove chunk headers
 */
const removeChunked = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  if (req.httpVersion === "1.0") {
    delete proxyRes.headers["transfer-encoding"];
  }
});

/**
 * If is a HTTP 1.0 request, set the correct connection header
 * or if connection header not present, then use `keep-alive`
 */
const setConnection = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  if (req.httpVersion === "1.0") {
    proxyRes.headers.connection = req.headers.connection || "close";
  } else if (req.httpVersion !== "2.0" && !proxyRes.headers.connection) {
    proxyRes.headers.connection = req.headers.connection || "keep-alive";
  }
});

const setRedirectHostRewrite = defineProxyOutgoingMiddleware(
  (req, res, proxyRes, options) => {
    if (
      (options.hostRewrite || options.autoRewrite || options.protocolRewrite) &&
      proxyRes.headers.location &&
      redirectRegex.test(String(proxyRes.statusCode))
    ) {
      const target = new URL(options.target);
      const u = new URL(proxyRes.headers.location);

      // Make sure the redirected host matches the target host before rewriting
      if (target.host !== u.host) {
        return;
      }

      if (options.hostRewrite) {
        u.host = options.hostRewrite;
      } else if (options.autoRewrite) {
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
const writeHeaders = defineProxyOutgoingMiddleware(
  (req, res, proxyRes, options) => {
    let rewriteCookieDomainConfig = options.cookieDomainRewrite;
    let rewriteCookiePathConfig = options.cookiePathRewrite;
    const preserveHeaderKeyCase = options.preserveHeaderKeyCase;
    let rawHeaderKeyMap;
    const setHeader = function (key, header) {
      if (header === undefined) {
        return;
      }
      if (rewriteCookieDomainConfig && key.toLowerCase() === "set-cookie") {
        header = rewriteCookieProperty(
          header,
          rewriteCookieDomainConfig,
          "domain",
        );
      }
      if (rewriteCookiePathConfig && key.toLowerCase() === "set-cookie") {
        header = rewriteCookieProperty(header, rewriteCookiePathConfig, "path");
      }
      res.setHeader(String(key).trim(), header);
    };

    if (typeof rewriteCookieDomainConfig === "string") {
      // also test for ''
      rewriteCookieDomainConfig = { "*": rewriteCookieDomainConfig };
    }

    if (typeof rewriteCookiePathConfig === "string") {
      // also test for ''
      rewriteCookiePathConfig = { "*": rewriteCookiePathConfig };
    }

    // message.rawHeaders is added in: v0.11.6
    // https://nodejs.org/api/http.html#http_message_rawheaders
    if (preserveHeaderKeyCase && proxyRes.rawHeaders !== undefined) {
      rawHeaderKeyMap = {};
      for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
        const key = proxyRes.rawHeaders[i];
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
  },
);

/**
 * Set the statusCode from the proxyResponse
 */
const writeStatusCode = defineProxyOutgoingMiddleware((req, res, proxyRes) => {
  // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
  if (proxyRes.statusMessage) {
    // @ts-expect-error
    res.statusCode = proxyRes.statusCode;
    // @ts-expect-error
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
