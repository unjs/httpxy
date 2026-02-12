import nodeHTTP from "node:http";
import nodeHTTPS from "node:https";
import type { Socket } from "node:net";
import { type ProxyMiddleware, defineProxyMiddleware } from "./_utils.ts";
import { getPort, hasEncryptedConnection, isSSL, setupOutgoing, setupSocket } from "../_utils.ts";

/**
 * WebSocket requests must have the `GET` method and
 * the `upgrade:websocket` header
 */
export const checkMethodAndHeader = defineProxyMiddleware<Socket>((req, socket) => {
  if (req.method !== "GET" || !req.headers.upgrade) {
    socket.destroy();
    return true;
  }

  if (req.headers.upgrade.toLowerCase() !== "websocket") {
    socket.destroy();
    return true;
  }
});

/**
 * Sets `x-forwarded-*` headers if specified in config.
 */
export const XHeaders = defineProxyMiddleware<Socket>((req, socket, options) => {
  if (!options.xfwd) {
    return;
  }

  const values = {
    for: req.connection.remoteAddress || req.socket.remoteAddress,
    port: getPort(req),
    proto: hasEncryptedConnection(req) ? "wss" : "ws",
  };

  for (const header of ["for", "port", "proto"] as const) {
    req.headers["x-forwarded-" + header] =
      (req.headers["x-forwarded-" + header] || "") +
      (req.headers["x-forwarded-" + header] ? "," : "") +
      values[header];
  }
});

/**
 * Does the actual proxying. Make the request and upgrade it
 * send the Switching Protocols request and pipe the sockets.
 */
export const stream = defineProxyMiddleware<Socket>(
  (req, socket, options, server, head, callback) => {
    const createHttpHeader = function (line: string, headers: nodeHTTP.OutgoingHttpHeaders) {
      return (
        Object.keys(headers)
          // eslint-disable-next-line unicorn/no-array-reduce
          .reduce(
            function (head, key) {
              const value = headers[key];

              if (!Array.isArray(value)) {
                head.push(key + ": " + value);
                return head;
              }

              for (const element of value) {
                head.push(key + ": " + element);
              }
              return head;
            },
            [line],
          )
          .join("\r\n") + "\r\n\r\n"
      );
    };

    setupSocket(socket);

    if (head && head.length > 0) {
      socket.unshift(head);
    }

    // Attach error handler early so client socket errors (e.g. ECONNRESET
    // from an intermediary proxy timeout) are caught before the upstream
    // upgrade response arrives. (#79)
    socket.on("error", onSocketError);

    const proxyReq = (isSSL.test(options.target.protocol || "http") ? nodeHTTPS : nodeHTTP).request(
      setupOutgoing(options.ssl || {}, options, req),
    );

    // Enable developers to modify the proxyReq before headers are sent
    if (server) {
      server.emit("proxyReqWs", proxyReq, req, socket, options, head);
    }

    // Error Handler
    proxyReq.on("error", onOutgoingError);
    proxyReq.on("response", function (res) {
      // if upgrade event isn't going to happen, close the socket
      if (!(res as any).upgrade) {
        socket.write(
          createHttpHeader(
            "HTTP/" + res.httpVersion + " " + res.statusCode + " " + res.statusMessage,
            res.headers,
          ),
        );
        res.pipe(socket);
      }
    });

    proxyReq.on("upgrade", function (proxyRes, proxySocket, proxyHead) {
      proxySocket.on("error", onOutgoingError);

      // Allow us to listen when the websocket has completed
      proxySocket.on("end", function () {
        server.emit("close", proxyRes, proxySocket, proxyHead);
      });

      // The pipe below will end proxySocket if socket closes cleanly, but not
      // if it errors (eg, vanishes from the net and starts returning
      // EHOSTUNREACH). We need to do that explicitly.
      socket.on("error", function () {
        proxySocket.end();
      });

      setupSocket(proxySocket);

      if (proxyHead && proxyHead.length > 0) {
        proxySocket.unshift(proxyHead);
      }

      //
      // Remark: Handle writing the headers to the socket when switching protocols
      // Also handles when a header is an array
      //
      socket.write(createHttpHeader("HTTP/1.1 101 Switching Protocols", proxyRes.headers));

      proxySocket.pipe(socket).pipe(proxySocket);

      server.emit("open", proxySocket);
      server.emit("proxySocket", proxySocket); // DEPRECATED.
    });

    proxyReq.end(); // XXX: CHECK IF THIS IS THIS CORRECT
    // return;

    function onSocketError(err: Error) {
      if (callback) {
        callback(err, req, socket);
      } else {
        server.emit("error", err, req, socket);
      }
      proxyReq.destroy();
    }

    function onOutgoingError(err: Error) {
      if (callback) {
        callback(err, req, socket);
      } else {
        server.emit("error", err, req, socket);
      }
      socket.end();
    }
  },
);

export const websocketIncomingMiddleware: readonly ProxyMiddleware<Socket>[] = [
  checkMethodAndHeader,
  XHeaders,
  stream,
] as const;
