import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import { webIncomingMiddleware } from "./middleware/web-incoming.ts";
import { websocketIncomingMiddleware } from "./middleware/ws-incoming.ts";
import type { ProxyServerOptions, ProxyTarget } from "./types.ts";
import type { ProxyMiddleware, ResOfType } from "./middleware/_utils.ts";
import type net from "node:net";

export interface ProxyServerEventMap<
  Req extends http.IncomingMessage | http2.Http2ServerRequest = http.IncomingMessage,
  Res extends http.ServerResponse | http2.Http2ServerResponse = http.ServerResponse,
> {
  error: [err: Error, req?: Req, res?: Res | net.Socket, target?: URL | ProxyTarget];
  start: [req: Req, res: Res, target: URL | ProxyTarget];
  econnreset: [err: Error, req: Req, res: Res, target: URL | ProxyTarget];
  proxyReq: [proxyReq: http.ClientRequest, req: Req, res: Res, options: ProxyServerOptions];
  proxyReqWs: [
    proxyReq: http.ClientRequest,
    req: Req,
    socket: net.Socket,
    options: ProxyServerOptions,
    head: any,
  ];
  proxyRes: [proxyRes: http.IncomingMessage, req: Req, res: Res];
  end: [req: Req, res: Res, proxyRes: http.IncomingMessage];
  open: [proxySocket: net.Socket];
  /** @deprecated */
  proxySocket: [proxySocket: net.Socket];
  close: [proxyRes: Req, proxySocket: net.Socket, proxyHead: any];
}

// eslint-disable-next-line unicorn/prefer-event-target
export class ProxyServer<
  Req extends http.IncomingMessage | http2.Http2ServerRequest = http.IncomingMessage,
  Res extends http.ServerResponse | http2.Http2ServerResponse = http.ServerResponse,
> extends EventEmitter<ProxyServerEventMap<Req, Res>> {
  // we use http2.Http2Server to handle HTTP/1.1 HTTPS as well (with allowHTTP1 enabled)
  private _server?: http.Server | http2.Http2SecureServer;

  _webPasses: ProxyMiddleware<http.ServerResponse>[] = [...webIncomingMiddleware];
  _wsPasses: ProxyMiddleware<net.Socket>[] = [...websocketIncomingMiddleware];

  options: ProxyServerOptions;

  web: (req: Req, res: Res, opts?: ProxyServerOptions, head?: any) => Promise<void>;

  ws: (req: Req, socket: net.Socket, opts: ProxyServerOptions, head?: any) => Promise<void>;

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
  listen(port: number, hostname?: string) {
    interface ListenerCallback {
      (
        req: http.IncomingMessage | http2.Http2ServerRequest,
        res: http.ServerResponse | http2.Http2ServerResponse,
      ): Promise<void>;
    }

    const closure: ListenerCallback = (req, res) => {
      return this.web(req as any, res as any);
    };

    if (this.options.http2) {
      this._server = http2.createSecureServer({ ...this.options.ssl, allowHTTP1: true }, closure);
    } else if (this.options.ssl) {
      this._server = https.createServer(this.options.ssl, closure);
    } else {
      this._server = http.createServer(closure);
    }

    if (this.options.ws) {
      this._server.on("upgrade", (req, socket, head) => {
        this.ws(req, socket, head).catch(() => {});
      });
    }

    this._server.listen(port, hostname);

    return this;
  }

  /**
   * A function that closes the inner webserver and stops listening on given port
   */
  close(callback?: () => void) {
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
  _getPasses<Type extends "ws" | "web">(type: Type): ProxyMiddleware<ResOfType<Type>>[] {
    return (type === "ws" ? this._wsPasses : this._webPasses) as unknown as ProxyMiddleware<
      ResOfType<Type>
    >[];
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

function _createProxyFn<
  Type extends "web" | "ws",
  ProxyServerReq extends http.IncomingMessage | http2.Http2ServerRequest,
  ProxyServerRes extends http.ServerResponse | http2.Http2ServerResponse,
>(type: Type, server: ProxyServer<ProxyServerReq, ProxyServerRes>) {
  return function (
    this: ProxyServer<ProxyServerReq, ProxyServerRes>,
    req: ProxyServerReq,
    res: ResOfType<Type>,
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
        server as ProxyServer<
          http.IncomingMessage | http2.Http2ServerRequest,
          http.ServerResponse | http2.Http2ServerResponse
        >,
        head,
        (error) => {
          if (server.listenerCount("error") > 0) {
            server.emit("error", error, req, res as ProxyServerRes | net.Socket);
            _resolve();
          } else {
            _reject(error);
          }
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
