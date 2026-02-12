import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  RequestOptions,
  ServerResponse,
} from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import type { Socket } from "node:net";
import type { ProxyServer } from "../src/server.ts";
import type { ProxyServerOptions, ProxyTargetDetailed } from "../src/types.ts";

// --- setupOutgoing ---

export type OutgoingOptions = Omit<RequestOptions & HttpsRequestOptions, "headers"> & {
  headers?: OutgoingHttpHeaders & Record<string, unknown>;
};

export function createOutgoing(): OutgoingOptions {
  return {};
}

// --- IncomingMessage stubs ---

export function stubIncomingMessage(overrides: Record<string, unknown> = {}): IncomingMessage {
  return { method: "GET", url: "/", headers: {}, ...overrides } as unknown as IncomingMessage;
}

// --- ServerResponse stub ---

export function stubServerResponse(overrides: Record<string, unknown> = {}): ServerResponse {
  return overrides as unknown as ServerResponse;
}

// --- Socket stub ---

export function stubSocket(overrides: Record<string, unknown> = {}): Socket {
  return overrides as unknown as Socket;
}

// --- Middleware options ---

export type MiddlewareOptions = ProxyServerOptions & {
  target: URL | ProxyTargetDetailed;
  forward: URL;
};

export function stubMiddlewareOptions(overrides: Record<string, unknown> = {}): MiddlewareOptions {
  return overrides as unknown as MiddlewareOptions;
}

// --- ProxyServer stub ---

export function stubProxyServer(overrides: Record<string, unknown> = {}): ProxyServer {
  return overrides as unknown as ProxyServer;
}
