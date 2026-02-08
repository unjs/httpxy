import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
// import type { Duplex } from "node:stream";
import { webIncomingMiddleware } from "./middleware/web-incoming";
import { websocketIncomingMiddleware } from "./middleware/ws-incoming";
import { type ProxyServerOptions, type ProxyTarget } from "./types";
import { ProxyMiddleware, type ResOfType } from "./middleware/_utils";
import type net from "node:net";

export interface ProxyServerEventMap {
  error: [err: Error, req?: http.IncomingMessage, res?: http.ServerResponse<http.IncomingMessage> | net.Socket, target?: URL | ProxyTarget];
  start: [req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, target: URL | ProxyTarget];
  econnreset: [err: Error, req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, target: URL | ProxyTarget];
  proxyReq: [proxyReq: http.ClientRequest, req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, options: ProxyServerOptions];
  proxyReqWs: [proxyReq: http.ClientRequest, req: http.IncomingMessage, socket: net.Socket, options: ProxyServerOptions, head: any];
  proxyRes: [proxyRes: http.IncomingMessage, req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>];
  end: [req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, proxyRes: http.IncomingMessage];
  open: [proxySocket: net.Socket];
  /** @deprecated */
  proxySocket: [proxySocket: net.Socket];
  close: [proxyRes: http.IncomingMessage, proxySocket: net.Socket, proxyHead: any]
}

// eslint-disable-next-line unicorn/prefer-event-target
export class ProxyServer extends EventEmitter<ProxyServerEventMap> {
  private _server?: http.Server | https.Server;

  _webPasses: ProxyMiddleware<http.ServerResponse>[] = [
    ...webIncomingMiddleware,
  ];
  _wsPasses: ProxyMiddleware<net.Socket>[] = [...websocketIncomingMiddleware];

  options: ProxyServerOptions;

  web: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    opts?: ProxyServerOptions,
    head?: any,
  ) => Promise<void>;

  ws: (
    req: http.IncomingMessage,
    socket: net.Socket,
    opts: ProxyServerOptions,
    head?: any,
  ) => Promise<void>;

  /**
   * Creates the proxy server with specified options.
   * @param options - Config object passed to the proxy
   */
  constructor(options: ProxyServerOptions = {}) {
    super();

    this.options = options || {};
    this.options.prependPath = options.prependPath !== false;

    this.web = _createProxyFn("web", this);
    this.ws = _createProxyFn("ws", this);
  }

  /**
   * A function that wraps the object in a webserver, for your convenience
   * @param port - Port to listen on
   * @param hostname - The hostname to listen on
   */
  listen(port: number, hostname: string) {
    const closure = (req: http.IncomingMessage, res: http.ServerResponse) => {
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

  before<Type extends "ws" | "web">(
    type: Type,
    passName: string,
    pass: ProxyMiddleware<ResOfType<Type>>,
  ) {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = this._getPasses(type);
    let i: false | number = false;
    for (const [idx, v] of passes.entries()) {
      if (v.name === passName) {
        i = idx;
      }
    }
    if (i === false) {
      throw new Error("No such pass");
    }
    passes.splice(i, 0, pass);
  }

  after<Type extends "ws" | "web">(
    type: Type,
    passName: string,
    pass: ProxyMiddleware<ResOfType<Type>>,
  ) {
    if (type !== "ws" && type !== "web") {
      throw new Error("type must be `web` or `ws`");
    }
    const passes = this._getPasses(type);
    let i: boolean | number = false;
    for (const [idx, v] of passes.entries()) {
      if (v.name === passName) {
        i = idx;
      }
    }
    if (i === false) {
      throw new Error("No such pass");
    }
    passes.splice(i++, 0, pass);
  }

  /** @internal */
  _getPasses<Type extends "ws" | "web">(
    type: Type,
  ): ProxyMiddleware<ResOfType<Type>>[] {
    return (type === "ws"
      ? this._wsPasses
      : this._webPasses) as unknown as ProxyMiddleware<ResOfType<Type>>[];
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
export function createProxyServer(options: ProxyServerOptions = {}) {
  return new ProxyServer(options);
}

// --- Internal ---

function _createProxyFn<Type extends "web" | "ws">(
  type: Type,
  server: ProxyServer,
) {
  type Res = ResOfType<Type>;
  return function (
    this: ProxyServer,
    req: http.IncomingMessage,
    res: Res,
    opts?: ProxyServerOptions,
    head?: any,
  ): Promise<void> {
    const requestOptions = { ...opts, ...server.options };

    for (const key of ["target", "forward"] as const) {
      if (typeof requestOptions[key] === "string") {
        requestOptions[key] = new URL(requestOptions[key]);
      }
    }

    if (!requestOptions.target && !requestOptions.forward) {
      this.emit("error", new Error("Must provide a proper URL as target"));
      return Promise.resolve();
    }

    let _resolve!: () => void;
    let _reject: (error: any) => void;
    const callbackPromise = new Promise<void>((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    res.on("close", () => {
      _resolve();
    });
    res.on("error", (error: any) => {
      _reject(error);
    });

    for (const pass of server._getPasses(type)) {
      const stop = pass(
        req,
        res,
        requestOptions as ProxyServerOptions & { target: URL; forward: URL },
        server,
        head,
        (error) => {
          _reject(error);
        },
      );
      // Passes can return a truthy value to halt the loop
      if (stop) {
        _resolve();
        break;
      }
    }

    return callbackPromise;
  };
}
