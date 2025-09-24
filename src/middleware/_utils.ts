import type { IncomingMessage, OutgoingMessage } from "node:http";
import type { ProxyServer } from "../server";
import type { ProxyServerOptions } from "../types";

export type ProxyMiddleware = (
  req: IncomingMessage,
  res: OutgoingMessage,
  opts?: ProxyServerOptions & { target: URL; forward: URL },
  server?: ProxyServer,
  head?: Buffer,
  callback?: (
    err: any,
    req: IncomingMessage,
    socket: OutgoingMessage,
    url?: any,
  ) => void,
) => void | true;

export function defineProxyMiddleware(m: ProxyMiddleware) {
  return m;
}

export type ProxyOutgoingMiddleware = (
  req: IncomingMessage,
  res: OutgoingMessage,
  proxyRes: IncomingMessage,
  opts?: ProxyServerOptions & { target: URL; forward: URL },
) => void | true;

export function defineProxyOutgoingMiddleware(m: ProxyOutgoingMiddleware) {
  return m;
}
