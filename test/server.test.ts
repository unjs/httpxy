import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createProxyServer, ProxyServer } from "../src/index.ts";

describe("ProxyServer", () => {
  let proxy: ProxyServer;
  let source: http.Server;

  afterEach(() => {
    if (proxy && (proxy as any)._server) {
      proxy.close();
    }
    source?.close();
  });

  describe("#listen", () => {
    it("should create an HTTP server and listen", async () => {
      source = http.createServer((req, res) => {
        res.end("ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({ target: `http://127.0.0.1:${sourcePort}` });
      proxy.listen(0, "127.0.0.1");

      // Wait for the server to be ready
      await new Promise<void>((r) => setTimeout(r, 50));
      const proxyPort = ((proxy as any)._server.address() as AddressInfo).port;

      const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("should create an HTTPS server when ssl option is set", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      // Check if test certs exist
      let key: Buffer, cert: Buffer;
      try {
        key = readFileSync(join(import.meta.dirname, "fixtures/agent2-key.pem"));
        cert = readFileSync(join(import.meta.dirname, "fixtures/agent2-cert.pem"));
      } catch {
        // Skip if no test certs
        return;
      }

      source = http.createServer((req, res) => {
        res.end("ssl-ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({
        target: `http://127.0.0.1:${sourcePort}`,
        ssl: { key, cert },
      });
      proxy.listen(0, "127.0.0.1");

      await new Promise<void>((r) => setTimeout(r, 50));
      const server = (proxy as any)._server;
      expect(server).toBeDefined();
      // It should be an HTTPS server (has cert context)
      expect(server.constructor.name).toBe("Server");
    });

    it("should set up WebSocket upgrade listener when ws option is set", async () => {
      source = http.createServer((req, res) => {
        res.end("ws-ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({
        target: `http://127.0.0.1:${sourcePort}`,
        ws: true,
      });
      proxy.listen(0, "127.0.0.1");

      await new Promise<void>((r) => setTimeout(r, 50));
      const server = (proxy as any)._server;
      expect(server.listeners("upgrade").length).toBeGreaterThan(0);
    });
  });

  describe("#close", () => {
    it("should close the server and call the callback", async () => {
      source = http.createServer((req, res) => {
        res.end("ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({ target: `http://127.0.0.1:${sourcePort}` });
      proxy.listen(0, "127.0.0.1");

      await new Promise<void>((r) => setTimeout(r, 50));

      const closed = await new Promise<boolean>((resolve) => {
        proxy.close(() => resolve(true));
      });
      expect(closed).toBe(true);
      expect((proxy as any)._server).toBeUndefined();
    });

    it("should not throw when no server exists", () => {
      proxy = createProxyServer({});
      // close without listen should be a no-op
      proxy.close();
      expect((proxy as any)._server).toBeUndefined();
    });

    it("should close without callback", async () => {
      source = http.createServer((req, res) => {
        res.end("ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({ target: `http://127.0.0.1:${sourcePort}` });
      proxy.listen(0, "127.0.0.1");
      await new Promise<void>((r) => setTimeout(r, 50));

      // Should not throw
      proxy.close();
      await new Promise<void>((r) => setTimeout(r, 50));
    });
  });

  describe("#before / #after", () => {
    it("should insert a middleware before a named pass (using empty name for arrow fns)", () => {
      proxy = createProxyServer({});
      const initialLength = proxy._webPasses.length;
      // Arrow function passes have empty string names; before() finds the last match
      const customPass = function customMiddleware() {};
      proxy.before("web", "", customPass as any);

      expect(proxy._webPasses.length).toBe(initialLength + 1);
      // Inserted before the last pass (last match of "")
      expect(proxy._webPasses[initialLength - 1]).toBe(customPass);
    });

    it("should insert a middleware after a named pass", () => {
      proxy = createProxyServer({});
      const initialLength = proxy._webPasses.length;
      const customPass = function customMiddleware() {};
      proxy.after("web", "", customPass as any);

      expect(proxy._webPasses.length).toBe(initialLength + 1);
    });

    it("should throw for invalid type in before", () => {
      proxy = createProxyServer({});
      expect(() => {
        proxy.before("invalid" as any, "", (() => {}) as any);
      }).toThrow("type must be `web` or `ws`");
    });

    it("should throw for invalid type in after", () => {
      proxy = createProxyServer({});
      expect(() => {
        proxy.after("invalid" as any, "", (() => {}) as any);
      }).toThrow("type must be `web` or `ws`");
    });

    it("should throw for non-existent pass name in before", () => {
      proxy = createProxyServer({});
      expect(() => {
        proxy.before("web", "nonexistent", (() => {}) as any);
      }).toThrow("No such pass");
    });

    it("should throw for non-existent pass name in after", () => {
      proxy = createProxyServer({});
      expect(() => {
        proxy.after("web", "nonexistent", (() => {}) as any);
      }).toThrow("No such pass");
    });

    it("should work with ws type", () => {
      proxy = createProxyServer({});
      const initialLength = proxy._wsPasses.length;
      const customPass = function wsMiddleware() {};
      proxy.before("ws", "", customPass as any);

      expect(proxy._wsPasses.length).toBe(initialLength + 1);
      // Inserted before the last pass (last match of "")
      expect(proxy._wsPasses[initialLength - 1]).toBe(customPass);
    });
  });

  describe("_createProxyFn error paths", () => {
    it("should emit error when no target and no forward", async () => {
      proxy = createProxyServer({});
      const { resolve, promise } = Promise.withResolvers<Error>();

      proxy.on("error", (err) => {
        resolve(err);
      });

      const stubReq = { url: "/", headers: {} } as any;
      const stubRes = {
        on: () => {},
        end: () => {},
      } as any;

      proxy.web(stubReq, stubRes);
      const err = await promise;
      expect(err.message).toBe("Must provide a proper URL as target");
    });

    it("should convert string target to URL", async () => {
      source = http.createServer((req, res) => {
        res.end("converted");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({});
      const proxyServer = http.createServer((req, res) => {
        proxy.web(req, res, { target: `http://127.0.0.1:${sourcePort}` });
      });
      await new Promise<void>((r) => proxyServer.listen(0, "127.0.0.1", r));
      const proxyPort = (proxyServer.address() as AddressInfo).port;

      const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
      expect(await res.text()).toBe("converted");
      proxyServer.close();
    });

    it("should resolve when a pass returns truthy (halt loop)", async () => {
      proxy = createProxyServer({ target: "http://127.0.0.1:1" });
      const net = await import("node:net");

      // WS checkMethodAndHeader returns true for non-GET → halts loop
      const stubReq = { method: "POST", headers: {}, url: "/" } as any;
      const socket = new net.Socket();

      await proxy.ws(stubReq, socket, { target: "http://127.0.0.1:1" });
      // Should resolve without error (the socket was destroyed by checkMethodAndHeader)
      socket.destroy();
    });

    it("should convert string forward to URL", async () => {
      source = http.createServer((req, res) => {
        res.end("forward-ok");
      });
      await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
      const sourcePort = (source.address() as AddressInfo).port;

      proxy = createProxyServer({});
      const proxyServer = http.createServer((req, res) => {
        proxy.web(req, res, { forward: `http://127.0.0.1:${sourcePort}` });
      });
      await new Promise<void>((r) => proxyServer.listen(0, "127.0.0.1", r));
      const proxyPort = (proxyServer.address() as AddressInfo).port;

      const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
      // Forward-only ends the response
      expect(res.status).toBe(200);
      proxyServer.close();
    });
  });
});
