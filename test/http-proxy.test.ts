import { describe, it, expect } from "vitest";
import * as httpProxy from "../src/index.ts";
import http from "node:http";
import net from "node:net";
import * as ws from "ws";
import * as io from "socket.io";
import SSE from "sse";
import ioClient from "socket.io-client";
import type { AddressInfo } from "node:net";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-test.js

function listenOn(server: http.Server | net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function proxyListen(proxy: ReturnType<typeof httpProxy.createProxyServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    proxy.listen(0, "127.0.0.1");
    const server = (proxy as any)._server as net.Server;
    server.once("error", reject);
    server.once("listening", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("http-proxy", () => {
  describe("#createProxyServer", () => {
    it.skip("should throw without options", () => {
      let error;
      try {
        httpProxy.createProxyServer();
      } catch (error_) {
        error = error_;
      }

      expect(error).to.toBeInstanceOf(Error);
    });

    it("should return an object otherwise", () => {
      const obj = httpProxy.createProxyServer({
        target: "http://www.google.com:80",
      });

      expect(obj.web).to.toBeInstanceOf(Function);
      expect(obj.ws).to.instanceOf(Function);
      expect(obj.listen).to.instanceOf(Function);
    });
  });

  describe("#createProxyServer with forward options and using web-incoming passes", () => {
    it("should pipe the request using web-incoming#stream method", async () => {
      const source = http.createServer();
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        forward: "http://127.0.0.1:" + sourcePort,
      });
      const proxyPort = await proxyListen(proxy);

      const { promise, resolve } = Promise.withResolvers<void>();
      source.on("request", (req, res) => {
        expect(req.method).to.eql("GET");
        expect(Number.parseInt(req.headers.host!.split(":")[1]!)).toBe(proxyPort);
        source.close();
        proxy.close(resolve);
      });

      http.request("http://127.0.0.1:" + proxyPort, () => {}).end();

      await promise;
    });
  });

  describe("#createProxyServer using the web-incoming passes", () => {
    it("should proxy sse", async () => {
      const source = http.createServer();
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:" + sourcePort,
      });
      const proxyPort = await proxyListen(proxy);

      const sse = new SSE(source, { path: "/" });
      sse.on("connection", (client) => {
        client.send("Hello over SSE");
        client.close();
      });

      const options = {
        hostname: "127.0.0.1",
        port: proxyPort,
      };

      const { promise, resolve } = Promise.withResolvers<void>();
      const req = http
        .request(options, (res) => {
          let streamData = "";
          res.on("data", (chunk) => {
            streamData += chunk.toString("utf8");
          });
          res.on("end", () => {
            expect(streamData).to.equal(":ok\n\ndata: Hello over SSE\n\n");
            source.close();
            proxy.close(resolve);
          });
        })
        .end();

      await promise;
    });

    it("should make the request on pipe and finish it", async () => {
      const source = http.createServer();
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:" + sourcePort,
      });
      const proxyPort = await proxyListen(proxy);

      const { promise, resolve } = Promise.withResolvers<void>();
      source.on("request", (req, res) => {
        expect(req.method).to.eql("POST");
        expect(req.headers["x-forwarded-for"]).to.eql("127.0.0.1");
        expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
        source.close();
        proxy.close(() => {});
        resolve();
      });

      http
        .request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            method: "POST",
            headers: {
              "x-forwarded-for": "127.0.0.1",
            },
          },
          () => {},
        )
        .end();

      await promise;
    });
  });

  describe("#createProxyServer using the web-incoming passes", () => {
    it("should make the request, handle response and finish it", async () => {
      const source = http.createServer((req, res) => {
        expect(req.method).to.eql("GET");
        expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + (source.address()! as any).port);
      });
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:" + sourcePort,
        preserveHeaderKeyCase: true,
      });
      const proxyPort = await proxyListen(proxy);

      const { promise, resolve } = Promise.withResolvers<void>();
      http
        .request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            method: "GET",
          },
          (res) => {
            expect(res.statusCode).to.eql(200);
            expect(res.headers["content-type"]).to.eql("text/plain");
            if (res.rawHeaders != undefined) {
              expect(res.rawHeaders.indexOf("Content-Type")).not.to.eql(-1);
              expect(res.rawHeaders.indexOf("text/plain")).not.to.eql(-1);
            }

            res.on("data", (data) => {
              expect(data.toString()).to.eql("Hello from " + sourcePort);
            });

            res.on("end", () => {
              source.close();
              proxy.close(resolve);
            });
          },
        )
        .end();
      await promise;
    });
  });

  describe("#createProxyServer() method with error response", () => {
    it("should make the request and emit the error event", async () => {
      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:1",
      });

      const { promise, resolve } = Promise.withResolvers<void>();
      proxy.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNREFUSED");
        proxy.close(() => {});
        resolve();
      });

      const proxyPort = await proxyListen(proxy);

      http
        .request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            method: "GET",
          },
          () => {},
        )
        .end();

      await promise.catch(() => {});
    });
  });

  describe("#createProxyServer setting the correct timeout value", () => {
    it("should hang up the socket at the timeout", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();

      const source = http.createServer(function (_req, res) {
        setTimeout(() => {
          res.end("At this point the socket should be closed");
        }, 5);
      });
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        target: "http://127.0.0.1:" + sourcePort,
        timeout: 3,
      });
      const proxyPort = await proxyListen(proxy);

      proxy.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNRESET");
      });

      const testReq = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyPort,
          method: "GET",
        },
        () => {},
      );

      testReq.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNRESET");
        proxy.close(() => {});
        source.close();
        resolve();
      });

      testReq.end();
      await promise;
    });
  });

  describe("#createProxyServer with xfwd option", () => {
    it("should not throw on empty http host header", async () => {
      const source = http.createServer();
      const sourcePort = await listenOn(source);

      const proxy = httpProxy.createProxyServer({
        forward: "http://127.0.0.1:" + sourcePort,
        xfwd: true,
      });
      const proxyPort = await proxyListen(proxy);

      const { promise, resolve } = Promise.withResolvers<void>();
      source.on("request", function (req, _res) {
        expect(req.method).to.eql("GET");
        // Host header is forwarded from the original request (not changed to source)
        expect(req.headers["x-forwarded-for"]).toBeDefined();
        source.close();
        proxy.close(resolve);
      });

      const socket = net.connect({ port: proxyPort }, () => {
        socket.write("GET / HTTP/1.0\r\n\r\n");
      });

      socket.on("data", () => {
        socket.end();
      });

      // Ignore socket errors during teardown (server may close before socket drains)
      socket.on("error", () => {});

      http.request("http://127.0.0.1:" + proxyPort, () => {}).end();
      await promise;
    });
  });

  describe("#createProxyServer using the ws-incoming passes", () => {
    it("should proxy the websockets stream", async () => {
      const destiny = new ws.WebSocketServer({ port: 0 });
      await new Promise<void>((r) => destiny.on("listening", r));
      const sourcePort = (destiny.address() as AddressInfo).port;

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;

      const { promise, resolve } = Promise.withResolvers<void>();
      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send("hello there");
      });

      client.on("message", (msg) => {
        expect(msg.toString("utf8")).toBe("Hello over websockets");
        client.close();
        destiny.close();
        proxyServer.close(resolve);
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe("hello there");
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should emit error on proxy error", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();

      const proxy = httpProxy.createProxyServer({
        // Note: we don't ever listen on this port
        target: "ws://127.0.0.1:1",
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;
      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send("hello there");
      });

      let count = 0;
      function maybe_done() {
        count += 1;
        if (count === 2) resolve();
      }

      client.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNRESET");
        maybe_done();
      });

      proxy.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNREFUSED");
        proxyServer.close(() => {});
        maybe_done();
      });
      await promise;
    });

    it("should close client socket if upstream is closed before upgrade", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();

      const server = http.createServer();
      server.on("upgrade", function (req, socket, head) {
        const response = ["HTTP/1.1 404 Not Found", "Content-type: text/html", "", ""];
        socket.write(response.join("\r\n"));
        socket.end();
      });
      const sourcePort = await listenOn(server);

      const proxy = httpProxy.createProxyServer({
        // note: we don't ever listen on this port
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;
      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send("hello there");
      });

      client.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        proxyServer.close(resolve);
      });

      await promise;
    });

    it("should proxy a socket.io stream", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();

      const server = http.createServer();
      const sourcePort = await listenOn(server);

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;
      const destiny = new io.Server(server);

      function startSocketIo() {
        const client = ioClient("ws://127.0.0.1:" + proxyPort);
        client.on("connect", () => {
          client.emit("incoming", "hello there");
        });

        client.on("outgoing", (data: any) => {
          expect(data).toBe("Hello over websockets");
          client.disconnect();
          destiny.close();
          server.close();
          proxyServer.close(resolve);
        });
      }
      startSocketIo();

      destiny.on("connection", (socket) => {
        socket.on("incoming", (msg) => {
          expect(msg).toBe("hello there");
          socket.emit("outgoing", "Hello over websockets");
        });
      });

      await promise;
    });

    it("should emit open and close events when socket.io client connects and disconnects", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();

      const server = http.createServer();
      const sourcePort = await listenOn(server);

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;
      const destiny = new io.Server(server);

      function startSocketIo() {
        const client = ioClient("ws://127.0.0.1:" + proxyPort);
        client.on("connect", () => {
          client.disconnect();
        });
      }
      let count = 0;

      proxyServer.on("open", () => {
        count += 1;
      });

      proxyServer.on("close", () => {
        destiny.close();
        server.close();
        proxyServer.close(() => {});
        expect(count).toBe(1);
        resolve();
      });

      startSocketIo();
      await promise;
    });

    it("should pass all set-cookie headers to client", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();

      const destiny = new ws.WebSocketServer({ port: 0 });
      await new Promise<void>((r) => destiny.on("listening", r));
      const sourcePort = (destiny.address() as AddressInfo).port;

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;

      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("upgrade", (res) => {
        expect(res.headers["set-cookie"]).toHaveLength(2);
      });

      client.on("open", () => {
        client.close();
        destiny.close();
        proxyServer.close(resolve);
      });

      destiny.on("headers", (headers) => {
        headers.push("Set-Cookie: test1=test1", "Set-Cookie: test2=test2");
      });

      await promise;
    });

    it("should detect a proxyReq event and modify headers", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();

      const destiny = new ws.WebSocketServer({ port: 0 });
      await new Promise<void>((r) => destiny.on("listening", r));
      const sourcePort = (destiny.address() as AddressInfo).port;

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });

      proxy.on("proxyReqWs", function (proxyReq, req, socket, options, head) {
        proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
      });

      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;

      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send("hello there");
      });

      client.on("message", (msg: any) => {
        expect(msg.toString("utf8")).toBe("Hello over websockets");
        client.close();
        destiny.close();
        proxyServer.close(resolve);
      });

      destiny.on("connection", function (socket, upgradeReq) {
        expect(upgradeReq.headers["x-special-proxy-header"]).to.eql("foobar");

        socket.on("message", (msg: any) => {
          expect(msg.toString("utf8")).toBe("hello there");
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should forward frames with single frame payload (including on node 4.x)", async () => {
      const { resolve, promise } = await Promise.withResolvers<void>();
      const payload = Array.from({ length: 65_529 }).join("0");

      const destiny = new ws.WebSocketServer({ port: 0 });
      await new Promise<void>((r) => destiny.on("listening", r));
      const sourcePort = (destiny.address() as AddressInfo).port;

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;

      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send(payload);
      });

      client.on("message", (msg) => {
        expect(msg.toString("utf8")).toBe("Hello over websockets");
        client.close();
        destiny.close();
        proxyServer.close(resolve);
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe(payload);
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should forward continuation frames with big payload (including on node 4.x)", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const payload = Array.from({ length: 65_530 }).join("0");

      const destiny = new ws.WebSocketServer({ port: 0 });
      await new Promise<void>((r) => destiny.on("listening", r));
      const sourcePort = (destiny.address() as AddressInfo).port;

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });
      const proxyPort = await proxyListen(proxy);
      const proxyServer = proxy;

      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        client.send(payload);
      });

      client.on("message", (msg) => {
        expect(msg.toString("utf8")).toBe("Hello over websockets");
        client.close();
        destiny.close();
        proxyServer.close(resolve);
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe(payload);
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should not crash when client socket errors before upstream upgrade (issue #79)", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();

      // Backend that delays responding to the upgrade request
      const server = http.createServer();
      server.on("upgrade", (_req, socket) => {
        // Never respond — simulate a slow/hanging backend
        socket.on("error", () => {});
        setTimeout(() => socket.destroy(), 500);
      });
      const sourcePort = await listenOn(server);

      const proxy = httpProxy.createProxyServer({
        target: "ws://127.0.0.1:" + sourcePort,
        ws: true,
      });

      // Intercept the ws stream pass to inject an error on the client socket
      // before the upstream upgrade response arrives
      proxy.before("ws", "", ((_req: any, socket: any) => {
        // After the proxy sets up the upstream request but before the
        // upgrade callback fires, simulate a client disconnect (ECONNRESET)
        setTimeout(() => {
          socket.destroy(new Error("read ECONNRESET"));
        }, 50);
      }) as any);

      const proxyPort = await proxyListen(proxy);

      proxy.on("error", () => {
        // The error should be caught here, not crash the process
        proxy.close(() => {});
        server.close();
        resolve();
      });

      // Use a raw TCP socket to send a WebSocket upgrade request
      const client = net.connect(proxyPort, "127.0.0.1", () => {
        client.write(
          "GET / HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "\r\n",
        );
      });
      client.on("error", () => {});

      await promise;
    });
  });
});
