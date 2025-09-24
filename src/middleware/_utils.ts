import type { IncomingMessage, OutgoingMessage } from "node:http";
import type { Socket } from "node:net";
import type { ProxyServer } from "../server";
import type { ProxyServerOptions, ProxyTargetDetailed } from "../types";

export type ResOfType<T extends "web" | "ws"> = T extends "ws"
  ? T extends "web"
    ? OutgoingMessage | Socket
    : Socket
  : T extends "web"
    ? OutgoingMessage
    : never;

export type ProxyMiddleware<T extends OutgoingMessage | Socket> = (
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

export function defineProxyMiddleware<
  T extends OutgoingMessage | Socket = OutgoingMessage,
>(m: ProxyMiddleware<T>) {
  return m;
}

export type ProxyOutgoingMiddleware = (
  req: IncomingMessage,
  res: OutgoingMessage,
  proxyRes: IncomingMessage,
  opts: ProxyServerOptions & {
    target: URL | ProxyTargetDetailed;
    forward: URL;
  },
) => void | true;

export function defineProxyOutgoingMiddleware(m: ProxyOutgoingMiddleware) {
  return m;
}
