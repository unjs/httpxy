import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as ws from "ws";

import type { ProxyAddr } from "../src/types.ts";
import { proxyUpgrade } from "../src/ws.ts";

// --- WebSocket echo server ---

let wsServer: ws.WebSocketServer;
let httpServer: Server;
let wsPort: number;

beforeAll(async () => {
  httpServer = createServer();
  wsServer = new ws.WebSocketServer({ server: httpServer });

  wsServer.on("connection", (socket) => {
    socket.on("message", (msg) => {
      socket.send("echo:" + msg.toString("utf8"));
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  wsPort = (httpServer.address() as AddressInfo).port;
});

afterAll(() => {
  wsServer?.close();
  httpServer?.close();
});

// --- Helper: create a local HTTP server that uses proxyUpgrade on upgrade ---

function createProxyServer(addr: string | ProxyAddr, opts?: Parameters<typeof proxyUpgrade>[4]) {
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket, head) => {
    proxyUpgrade(addr, req, socket, head, opts).catch(() => {});
  });

  return server;
}

async function listenServer(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

// --- Tests ---

describe("proxyUpgrade", () => {
  describe("validate ws upgrade request", () => {
    it("rejects non-GET method", async () => {
      const { Duplex } = await import("node:stream");
      const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });

      const req = {
        method: "POST",
        headers: { upgrade: "websocket" },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      await expect(
        proxyUpgrade({ host: "127.0.0.1", port: 1 }, req, socket),
      ).rejects.toThrow("Not a valid WebSocket upgrade request");

      expect(socket.destroyed).toBe(true);
    });

    it("rejects missing upgrade header", async () => {
      const { Duplex } = await import("node:stream");
      const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });

      const req = {
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      await expect(
        proxyUpgrade({ host: "127.0.0.1", port: 1 }, req, socket),
      ).rejects.toThrow("Not a valid WebSocket upgrade request");

      expect(socket.destroyed).toBe(true);
    });

    it("rejects non-websocket upgrade header", async () => {
      const { Duplex } = await import("node:stream");
      const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });

      const req = {
        method: "GET",
        headers: { upgrade: "h2c" },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      await expect(
        proxyUpgrade({ host: "127.0.0.1", port: 1 }, req, socket),
      ).rejects.toThrow("Not a valid WebSocket upgrade request");

      expect(socket.destroyed).toBe(true);
    });
  });

  it("should proxy websocket messages", async () => {
    const proxy = createProxyServer({ host: "127.0.0.1", port: wsPort });
    const proxyPort = await listenServer(proxy);

    const { promise, resolve } = Promise.withResolvers<void>();
    const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

    client.on("open", () => {
      client.send("hello");
    });

    client.on("message", (msg) => {
      expect(msg.toString("utf8")).toBe("echo:hello");
      client.close();
      proxy.close(() => resolve());
    });

    await promise;
  });

  it("should accept URL string as addr", async () => {
    const proxy = createProxyServer(`ws://127.0.0.1:${wsPort}`);
    const proxyPort = await listenServer(proxy);

    const { promise, resolve } = Promise.withResolvers<void>();
    const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

    client.on("open", () => {
      client.send("url-addr");
    });

    client.on("message", (msg) => {
      expect(msg.toString("utf8")).toBe("echo:url-addr");
      client.close();
      proxy.close(() => resolve());
    });

    await promise;
  });

  it("should reject on connection error", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = createServer();

    server.on("upgrade", (req, socket, head) => {
      proxyUpgrade({ host: "127.0.0.1", port: 1 }, req, socket, head).catch((err) => {
        expect(err).toBeDefined();
        resolve();
      });
    });

    const port = await listenServer(server);
    const client = new ws.WebSocket("ws://127.0.0.1:" + port);

    client.on("error", () => {
      // Expected — upstream connection fails
    });

    await promise;
    server.close();
  });

  it("should add x-forwarded headers when xfwd is set", async () => {
    // Create a target that echoes upgrade request headers
    const targetServer = createServer();
    const targetWs = new ws.WebSocketServer({ server: targetServer });

    targetWs.on("connection", (socket, req) => {
      socket.send(
        JSON.stringify({
          "x-forwarded-for": req.headers["x-forwarded-for"],
          "x-forwarded-port": req.headers["x-forwarded-port"],
          "x-forwarded-proto": req.headers["x-forwarded-proto"],
        }),
      );
    });

    await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
    const targetPort = (targetServer.address() as AddressInfo).port;

    const proxy = createProxyServer({ host: "127.0.0.1", port: targetPort }, { xfwd: true });
    const proxyPort = await listenServer(proxy);

    const { promise, resolve } = Promise.withResolvers<void>();
    const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

    client.on("message", (msg) => {
      const headers = JSON.parse(msg.toString("utf8"));
      expect(headers["x-forwarded-for"]).toBeDefined();
      expect(headers["x-forwarded-port"]).toBeDefined();
      expect(headers["x-forwarded-proto"]).toBe("ws");
      client.close();
      targetWs.close();
      targetServer.close();
      proxy.close(() => resolve());
    });

    await promise;
  });

  it("should reject when upstream responds without upgrading", async () => {
    // Target is a plain HTTP server that never upgrades — just returns 404
    const targetServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
    const targetPort = (targetServer.address() as AddressInfo).port;

    const server = createServer();
    const { promise, resolve } = Promise.withResolvers<void>();

    server.on("upgrade", (req, socket, head) => {
      proxyUpgrade({ host: "127.0.0.1", port: targetPort }, req, socket, head)
        .then(() => {
          expect.unreachable("should not resolve on non-upgrade response");
        })
        .catch((err) => {
          expect(err.message).toContain("did not upgrade the connection");
          resolve();
        });
    });

    const port = await listenServer(server);
    const client = new ws.WebSocket("ws://127.0.0.1:" + port);
    client.on("error", () => {
      // Expected — proxy relays the non-upgrade response
    });

    await promise;
    targetServer.close();
    server.close();
  }, 5000);

  it("should not emit undefined header values", async () => {
    // Create a target server that responds to upgrade with headers containing undefined
    const targetServer = createServer();

    targetServer.on("upgrade", (req, socket) => {
      // Manually craft a 101 response with a header that has no value
      // to simulate an upstream that sends sec-websocket-protocol without a value
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n" +
          "\r\n",
      );
      // Keep socket open for piping
      req.socket.pipe(socket).pipe(req.socket);
    });

    await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
    const targetPort = (targetServer.address() as AddressInfo).port;

    const proxy = createProxyServer({ host: "127.0.0.1", port: targetPort });
    const proxyPort = await listenServer(proxy);

    const { promise, resolve } = Promise.withResolvers<void>();

    // Use raw net connection to inspect the raw upgrade response bytes
    const net = await import("node:net");
    const sock = net.connect(proxyPort, "127.0.0.1", () => {
      sock.write(
        "GET / HTTP/1.1\r\n" +
          "Host: 127.0.0.1:" +
          proxyPort +
          "\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    sock.on("data", (data) => {
      const response = data.toString();
      // The response headers should never contain literal "undefined"
      expect(response).not.toContain(": undefined");
      sock.destroy();
      targetServer.close();
      proxy.close(() => resolve());
    });

    await promise;
  });

  it("should preserve multiple set-cookie headers in upgrade response", async () => {
    const targetServer = createServer();

    targetServer.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n" +
          "Set-Cookie: a=1\r\n" +
          "Set-Cookie: b=2\r\n" +
          "Set-Cookie: c=3\r\n" +
          "\r\n",
      );
      req.socket.pipe(socket).pipe(req.socket);
    });

    await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
    const targetPort = (targetServer.address() as AddressInfo).port;

    const proxy = createProxyServer({ host: "127.0.0.1", port: targetPort });
    const proxyPort = await listenServer(proxy);

    const { promise, resolve } = Promise.withResolvers<void>();

    const sock = connect(proxyPort, "127.0.0.1", () => {
      sock.write(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${proxyPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    sock.on("data", (data) => {
      const response = data.toString();
      // All three Set-Cookie values must appear as separate headers
      const cookies = [...response.matchAll(/set-cookie: (.+)/gi)].map((m) => m[1]!.trim());
      expect(cookies).toContain("a=1");
      expect(cookies).toContain("b=2");
      expect(cookies).toContain("c=3");
      sock.destroy();
      targetServer.close();
      proxy.close(() => resolve());
    });

    await promise;
  });

  it("should resolve with the proxy socket", async () => {
    const server = createServer();

    const { promise, resolve } = Promise.withResolvers<void>();

    server.on("upgrade", async (req, socket, head) => {
      const proxySocket = await proxyUpgrade(
        { host: "127.0.0.1", port: wsPort },
        req,
        socket,
        head,
      );
      expect(proxySocket).toBeDefined();
      expect(proxySocket.writable).toBe(true);
      resolve();
    });

    const port = await listenServer(server);
    const client = new ws.WebSocket("ws://127.0.0.1:" + port);

    client.on("open", () => {
      client.close();
    });

    await promise;
    server.close();
  });

  it("should forward non-empty head buffer to upstream", async () => {
    // Raw target that captures all data received after the upgrade handshake
    const targetServer = createServer();
    const received: Buffer[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    targetServer.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.on("data", (chunk: Buffer) => {
        received.push(Buffer.from(chunk));
        // Give a small delay for all data to arrive, then close
        setTimeout(() => socket.destroy(), 20);
      });
      socket.on("close", () => {
        const all = Buffer.concat(received);
        expect(all.toString()).toContain("head-payload-data");
        resolve();
      });
    });

    await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
    const targetPort = (targetServer.address() as AddressInfo).port;

    // Proxy server that injects a non-empty head buffer
    const server = createServer();

    server.on("upgrade", (req, socket, _head) => {
      const syntheticHead = Buffer.from("head-payload-data");
      proxyUpgrade({ host: "127.0.0.1", port: targetPort }, req, socket, syntheticHead).catch(
        () => {},
      );
    });

    const port = await listenServer(server);

    // Raw client — send upgrade request, then immediately close writable side
    const sock = connect(port, "127.0.0.1", () => {
      sock.end(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    sock.on("error", () => {});

    await promise;
    targetServer.close();
    server.close();
  });

  describe("disconnect scenarios", () => {
    it("client socket error before upgrade rejects and destroys proxy request", async () => {
      // Slow target: never completes the upgrade
      const targetServer = createServer();
      targetServer.on("upgrade", () => {
        // Intentionally hang — never respond
      });

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const { promise, resolve } = Promise.withResolvers<void>();
      const server = createServer();

      server.on("upgrade", (req, socket, head) => {
        const result = proxyUpgrade(
          { host: "127.0.0.1", port: targetPort },
          req,
          socket,
          head,
        );

        // Emit an error on the client socket after a short delay
        // (upstream upgrade is still pending)
        setTimeout(() => {
          socket.destroy(new Error("client socket error"));
        }, 30);

        result
          .then(() => {
            expect.unreachable("should not resolve when client socket errors");
          })
          .catch((err) => {
            expect(err.message).toBe("client socket error");
            resolve();
          });
      });

      const port = await listenServer(server);
      const client = new ws.WebSocket("ws://127.0.0.1:" + port);
      client.on("error", () => {
        // Expected
      });

      await promise;
      targetServer.close();
      server.close();
    });

    it("client disconnect before upgrade rejects the promise", async () => {
      // Slow target: waits before completing the WS handshake
      const targetServer = createServer();
      const targetWs = new ws.WebSocketServer({ noServer: true });

      targetServer.on("upgrade", (req, socket, head) => {
        // Delay the upgrade to give the client time to disconnect
        setTimeout(() => {
          targetWs.handleUpgrade(req, socket, head, (client) => {
            targetWs.emit("connection", client, req);
          });
        }, 200);
      });

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const { promise, resolve } = Promise.withResolvers<void>();
      const server = createServer();

      server.on("upgrade", (req, socket, head) => {
        proxyUpgrade({ host: "127.0.0.1", port: targetPort }, req, socket, head)
          .then(() => {
            expect.unreachable("should not resolve when client disconnects early");
          })
          .catch((err) => {
            expect(err).toBeDefined();
            resolve();
          });
      });

      const port = await listenServer(server);

      // Use a raw socket so we can destroy it mid-handshake
      const sock = connect(port, "127.0.0.1", () => {
        sock.write(
          "GET / HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${port}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "\r\n",
        );
        // Destroy before the upstream can complete the upgrade
        setTimeout(() => sock.destroy(), 50);
      });

      await promise;
      targetWs.close();
      targetServer.close();
      server.close();
    });

    it("client disconnect after upgrade ends the upstream socket", async () => {
      const targetServer = createServer();
      const targetWs = new ws.WebSocketServer({ server: targetServer });

      const { promise, resolve } = Promise.withResolvers<void>();

      targetWs.on("connection", (socket) => {
        socket.on("close", () => {
          // Upstream sees the close after client disconnects
          resolve();
        });
      });

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const proxy = createProxyServer({ host: "127.0.0.1", port: targetPort });
      const proxyPort = await listenServer(proxy);

      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("open", () => {
        // Forcefully terminate the client connection
        client.terminate();
      });

      await promise;
      targetWs.close();
      targetServer.close();
      proxy.close();
    });

    it("client socket error after upgrade ends the upstream proxy socket", async () => {
      const targetServer = createServer();
      const targetWs = new ws.WebSocketServer({ server: targetServer });

      const { promise, resolve } = Promise.withResolvers<void>();

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const server = createServer();

      server.on("upgrade", async (req, socket, head) => {
        const proxySocket = await proxyUpgrade(
          { host: "127.0.0.1", port: targetPort },
          req,
          socket,
          head,
        );

        proxySocket.on("close", () => {
          resolve();
        });

        // Emit an error on the client socket after upgrade is complete
        // This triggers the post-upgrade error handler: sock.once("error", () => { proxySocket.end() })
        socket.destroy(new Error("post-upgrade client error"));
      });

      const port = await listenServer(server);
      const client = new ws.WebSocket("ws://127.0.0.1:" + port);
      client.on("error", () => {});

      await promise;
      targetWs.close();
      targetServer.close();
      server.close();
    });

    it("server disconnect during upgrade rejects the promise", async () => {
      // Target server that immediately destroys the socket on upgrade
      const targetServer = createServer();
      targetServer.on("upgrade", (_req, socket) => {
        socket.destroy();
      });

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const { promise, resolve } = Promise.withResolvers<void>();
      const server = createServer();

      server.on("upgrade", (req, socket, head) => {
        proxyUpgrade({ host: "127.0.0.1", port: targetPort }, req, socket, head)
          .then(() => {
            expect.unreachable("should not resolve when server destroys during upgrade");
          })
          .catch((err) => {
            expect(err).toBeDefined();
            resolve();
          });
      });

      const port = await listenServer(server);
      const client = new ws.WebSocket("ws://127.0.0.1:" + port);
      client.on("error", () => {
        // Expected
      });

      await promise;
      targetServer.close();
      server.close();
    });

    it("server disconnect after upgrade ends the client socket", async () => {
      const targetServer = createServer();
      const targetWs = new ws.WebSocketServer({ server: targetServer });

      targetWs.on("connection", (socket) => {
        // Once connected, forcefully terminate the server-side socket
        setTimeout(() => socket.terminate(), 50);
      });

      await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
      const targetPort = (targetServer.address() as AddressInfo).port;

      const proxy = createProxyServer({ host: "127.0.0.1", port: targetPort });
      const proxyPort = await listenServer(proxy);

      const { promise, resolve } = Promise.withResolvers<void>();
      const client = new ws.WebSocket("ws://127.0.0.1:" + proxyPort);

      client.on("close", () => {
        // Client sees the close after server disconnects
        resolve();
      });

      client.on("error", () => {
        // May fire before close on some platforms
      });

      await promise;
      targetWs.close();
      targetServer.close();
      proxy.close();
    });
  });
});
