import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import * as httpProxy from "../src/index.ts";

/**
 * Bun and Deno each have `node:http`/web-stream compatibility gaps that break
 * individual tests. Gate affected tests with `it.skipIf(isBun)` / `it.skipIf(isDeno)`
 * and add a short comment describing the runtime limitation. Re-enable when
 * the upstream runtime fixes it.
 */
export const isBun = !!(globalThis as { Bun?: unknown }).Bun;
export const isDeno = !!(globalThis as { Deno?: unknown }).Deno;

export function listenOn(server: http.Server | https.Server | net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export function proxyListen(
  proxy: ReturnType<typeof httpProxy.createProxyServer>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    proxy.listen(0, "127.0.0.1");
    const server = (proxy as any)._server as net.Server;
    server.once("error", reject);
    server.once("listening", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}
