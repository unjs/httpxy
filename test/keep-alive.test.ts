import { Agent, createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultAgents } from "../src/_utils.ts";
import { proxyFetch } from "../src/fetch.ts";
import { createProxyServer } from "../src/index.ts";

// The upstream announces `Keep-Alive: timeout=2`, so the default agents may reuse a pooled
// socket for 1 s (Node's default `agentKeepAliveTimeoutBuffer` is 1 s); the upstream closes
// it after 3 s. Blocking the event loop stops both timers and the upstream's close from
// running before the next request picks a socket (nitrojs/nitro#4693).

let upstream: Server;
let upstreamURL: string;
let connections = 0;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  upstream.keepAliveTimeout = 2000;
  upstream.on("connection", () => connections++);
  await listen(upstream);
  upstreamURL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(() => {
  upstream.closeAllConnections();
  upstream.close();
});

describe("default keep-alive agents", () => {
  describe("proxyFetch", () => {
    const send = async (method: string) => {
      const res = await proxyFetch(upstreamURL, `${upstreamURL}/`, {
        method,
        body: method === "POST" ? "x" : undefined,
      });
      return res.text();
    };

    it("opens a new connection once the upstream keep-alive timeout has passed", async () => {
      expect(await send("GET")).toBe("ok");
      const before = connections;
      blockEventLoop(3500);
      expect(await send("POST")).toBe("ok");
      expect(connections).toBe(before + 1);
    }, 10_000);

    it("reuses the connection within the upstream keep-alive timeout", async () => {
      expect(await send("GET")).toBe("ok");
      const before = connections;
      blockEventLoop(200);
      expect(await send("POST")).toBe("ok");
      expect(connections).toBe(before);
    });

    it("opens a new connection when the response body is read after the timeout", async () => {
      expect(await send("GET")).toBe("ok");
      const res = await proxyFetch(upstreamURL, `${upstreamURL}/`);
      const before = connections;
      blockEventLoop(3500);
      // The socket returns to the pool only now, long after the upstream started its idle timer.
      expect(await res.text()).toBe("ok");
      expect(await send("POST")).toBe("ok");
      expect(connections).toBe(before + 1);
    }, 10_000);
  });

  describe("agent", () => {
    it("opens a new connection after a blocking response `end` handler", async () => {
      const get = (onEnd?: () => void) =>
        new Promise<string>((resolve, reject) => {
          const req = request(`${upstreamURL}/`, { agent: defaultAgents.http }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => {
              onEnd?.();
              resolve(body);
            });
          });
          req.on("error", reject);
          req.end();
        });

      expect(await get()).toBe("ok");
      const before = connections;
      let next: Promise<string> | undefined;
      await get(() => {
        blockEventLoop(3500);
        // Node pools the socket on the next tick, after this handler; ask for one right after.
        process.nextTick(() => (next = get()));
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(await next).toBe("ok");
      expect(connections).toBe(before + 1);
    }, 10_000);
  });

  describe("ProxyServer", () => {
    let front: Server;
    let frontPort: number;
    // `agent: false` would send `connection: close`, which the proxy forwards upstream.
    const client = new Agent({ keepAlive: true });

    beforeAll(async () => {
      const proxy = createProxyServer({ target: upstreamURL });
      front = createServer((req, res) => {
        // Synchronous work right before proxying, in the same event loop turn.
        blockEventLoop(Number(req.headers["x-block-ms"] || 0));
        proxy.web(req, res).catch((error: NodeJS.ErrnoException) => {
          res.statusCode = 502;
          res.end(error.code);
        });
      });
      await listen(front);
      frontPort = (front.address() as AddressInfo).port;
    });

    afterAll(() => {
      client.destroy();
      front.closeAllConnections();
      front.close();
    });

    const send = (method: string, blockMs = 0) =>
      new Promise<string>((resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: frontPort,
            method,
            path: "/",
            headers: { "x-block-ms": blockMs },
            agent: client,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => resolve(`${res.statusCode} ${body}`));
          },
        );
        req.on("error", reject);
        req.end(method === "POST" ? "x" : undefined);
      });

    it("opens a new upstream connection once the keep-alive timeout has passed", async () => {
      expect(await send("GET")).toBe("200 ok");
      const before = connections;
      expect(await send("POST", 3500)).toBe("200 ok");
      expect(connections).toBe(before + 1);
    }, 10_000);

    it("reuses the upstream connection within the keep-alive timeout", async () => {
      expect(await send("GET")).toBe("200 ok");
      const before = connections;
      expect(await send("POST", 200)).toBe("200 ok");
      expect(connections).toBe(before);
    });
  });
});

function listen(server: Server) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function blockEventLoop(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
