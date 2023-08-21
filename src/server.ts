import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
// import type { Duplex } from "node:stream";
import { webIncomingMiddleware } from "./middleware/web-incoming";
import { websocketIncomingMiddleware } from "./middleware/ws-incoming";
import { ProxyServerOptions } from "./types";
import { ProxyMiddleware } from "./middleware/_utils";

// eslint-disable-next-line unicorn/prefer-event-target
export class ProxyServer extends EventEmitter {
  _server?: http.Server | https.Server;

  webPasses: readonly ProxyMiddleware[] = webIncomingMiddleware;
  wsPasses: readonly ProxyMiddleware[] = websocketIncomingMiddleware;

  options: ProxyServerOptions;

  web: (
    req: http.IncomingMessage,
    res: http.OutgoingMessage,
    opts?: ProxyServerOptions,
  ) => any;

  ws: (
    req: http.IncomingMessage,
    socket: http.OutgoingMessage,
    opts: ProxyServerOptions,
  ) => any;

  /**
   * Creates the proxy server with specified options.
   * @param options - Config object passed to the proxy
   */
  constructor(options: ProxyServerOptions = {}) {
    super();

    this.options = options || {};
    this.options.prependPath = options.prependPath !== false;

    this.web = _createRightProxy("web")(this);
    this.ws = _createRightProxy("ws")(this);
  }

  /**
   * A function that wraps the object in a webserver, for your convenience
   * @param port - Port to listen on
   * @param hostname - The hostname to listen on
   */
  listen(port: number, hostname: string) {
    const closure = (req, res) => {
      this.web(req, res);
    };

    this._server = this.options.ssl
      ? https.createServer(this.options.ssl, closure)
      : http.createServer(closure);

    if (this.options.ws) {
      this._server.on("upgrade", (req, socket, head) => {
        // @ts-expect-error
        this.ws(req, socket, head);
      });
    }

    this._server.listen(port, hostname);

    return this;
  }

  /**
   * A function that closes the inner webserver and stops listening on given port
   */
  close(callback: () => void) {
    if (this._server) {
      // Wrap callback to nullify server after all open connections are closed.
      this._server.close((...args) => {
        this._server = undefined;
        if (callback) {
          Reflect.apply(callback, undefined, args);
        }
      });
    }
  }

  before(type, passName, callback) {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = [...(type === "ws" ? this.wsPasses : this.webPasses)];
    let i: false | number = false;

    for (const [idx, v] of passes.entries()) {
      if (v.name === passName) {
        i = idx;
      }
    }

    if (i === false) {
      throw new Error("No such pass");
    }

    passes.splice(i, 0, callback);
  }

  after(type, passName, callback) {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = [...(type === "ws" ? this.wsPasses : this.webPasses)];
    let i: boolean | number = false;

    for (const [idx, v] of passes.entries()) {
      if (v.name === passName) {
        i = idx;
      }
    }

    if (i === false) {
      throw new Error("No such pass");
    }

    passes.splice(i++, 0, callback);
  }
}

/**
 * Creates the proxy server.
 *
 * Examples:
 *
 *    httpProxy.createProxyServer({ .. }, 8000)
 *    // => '{ web: [Function], ws: [Function] ... }'
 *
 * @param {Object} Options Config object passed to the proxy
 *
 * @return {Object} Proxy Proxy object with handlers for `ws` and `web` requests
 *
 * @api public
 */
export function createProxyServer(options: ProxyServerOptions) {
  return new ProxyServer(options);
}

// --- Internal ---

/**
 * Returns a function that creates the loader for
 * either `ws` or `web`'s  passes.
 *
 * Examples:
 *
 *    httpProxy.createRightProxy('ws')
 *    // => [Function]
 *
 * @param {String} Type Either 'ws' or 'web'
 *
 * @return {Function} Loader Function that when called returns an iterator for the right passes
 *
 * @api private
 */

function _createRightProxy(type) {
  return function (server: ProxyServer) {
    return function (
      req: http.IncomingMessage,
      res: http.OutgoingMessage,
      opts: ProxyServerOptions,
    ) {
      const passes = type === "ws" ? this.wsPasses : this.webPasses;

      const requestOptions = { ...opts, ...server.options };

      for (const key of ["target", "forward"]) {
        if (typeof requestOptions[key] === "string") {
          requestOptions[key] = new URL(requestOptions[key]);
        }
      }

      if (!requestOptions.target && !requestOptions.forward) {
        return this.emit(
          "error",
          new Error("Must provide a proper URL as target"),
        );
      }

      for (const pass of passes) {
        /**
         * Call of passes functions
         * pass(req, res, options, head)
         *
         * In WebSockets case the `res` variable
         * refer to the connection socket
         * pass(req, socket, options, head)
         */
        if (
          pass(
            req,
            res,
            requestOptions,
            server,
            undefined /* head */,
            undefined /* cb */,
          )
        ) {
          // passes can return a truthy value to halt the loop
          break;
        }
      }
    };
  };
}
