import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { ProxyServer } from "../server.ts";
import type { ProxyServerOptions, ProxyTargetDetailed } from "../types.ts";

export type ResOfType<T extends "web" | "ws"> = T extends "ws"
  ? T extends "web"
    ? ServerResponse | Socket
    : Socket
  : T extends "web"
    ? ServerResponse
    : never;

export type ProxyMiddleware<T extends ServerResponse | Socket> = (
  req: IncomingMessage,
  res: T,
  opts: ProxyServerOptions & {
    target: URL | ProxyTargetDetailed;
    forward: URL;
  },
  server: ProxyServer,
  head?: Buffer,
  callback?: (err: any, req: IncomingMessage, socket: T, url?: any) => void,
) => void | true;

export function defineProxyMiddleware<T extends ServerResponse | Socket = ServerResponse>(
  m: ProxyMiddleware<T>,
) {
  return m;
}

export type ProxyOutgoingMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  proxyRes: IncomingMessage,
  opts: ProxyServerOptions & {
    target: URL | ProxyTargetDetailed;
    forward: URL;
  },
) => void | true;

export function defineProxyOutgoingMiddleware(m: ProxyOutgoingMiddleware) {
  return m;
}
