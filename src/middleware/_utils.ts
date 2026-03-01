import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { ProxyServer } from "../server.ts";
import type { ProxyServerOptions, ProxyTargetDetailed } from "../types.ts";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";

export type ResOfType<T extends "web" | "ws"> = T extends "ws"
  ? T extends "web"
    ? ServerResponse | Http2ServerResponse | Socket
    : Socket
  : T extends "web"
    ? ServerResponse | Http2ServerResponse
    : never;

export type ProxyMiddleware<T extends ServerResponse | Http2ServerResponse | Socket> = (
  req: IncomingMessage | Http2ServerRequest,
  res: T,
  opts: ProxyServerOptions & {
    target: URL | ProxyTargetDetailed;
    forward: URL;
  },
  server: ProxyServer<IncomingMessage | Http2ServerRequest, ServerResponse | Http2ServerResponse>,
  head?: Buffer,
  callback?: (err: any, req: IncomingMessage | Http2ServerRequest, socket: T, url?: any) => void,
) => void | true;

export function defineProxyMiddleware<T extends ServerResponse | Socket = ServerResponse>(
  m: ProxyMiddleware<T>,
) {
  return m;
}

export type ProxyOutgoingMiddleware = (
  req: IncomingMessage | Http2ServerRequest,
  res: ServerResponse | Http2ServerResponse,
  proxyRes: IncomingMessage,
  opts: ProxyServerOptions & {
    target: URL | ProxyTargetDetailed;
    forward: URL;
  },
) => void | true;

export function defineProxyOutgoingMiddleware(m: ProxyOutgoingMiddleware) {
  return m;
}
