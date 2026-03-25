import { describe, it } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { createProxyServer } from "../src/index.ts";
import { proxyUpgrade } from "../src/ws.ts";

/**
 * Regression test for writing to a destroyed socket during WS upgrade.
 * Upstream: https://github.com/http-party/node-http-proxy/pull/1433
 *
 * When a WS upgrade request hits a target that responds with a plain HTTP
 * response (no upgrade), the proxy writes the response back to the client
 * socket. If the client socket is already destroyed by that point, calling
 * `socket.write()` throws and crashes the process.
 */

function listenOn(server: http.Server | net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("ws: write to destroyed socket", () => {
  it("ProxyServer.ws() should not crash when socket is destroyed before upstream responds", async () => {
    // Target server that responds with a normal HTTP 404 (no upgrade)
    const target = http.createServer((_req, res) => {
      // Delay so the client socket can be destroyed first
      setTimeout(() => {
        res.writeHead(404);
        res.end("Not Found");
      }, 50);
    });
    const targetPort = await listenOn(target);

    const proxy = createProxyServer({
      target: `http://127.0.0.1:${targetPort}`,
      ws: true,
    });

    // Suppress proxy error events (expected when socket is destroyed)
    proxy.on("error", () => {});

    const proxyServer = http.createServer();
    proxyServer.on("upgrade", (req, socket, head) => {
      // Destroy the socket before the target has a chance to respond
      setTimeout(() => {
        socket.destroy();
      }, 10);
      proxy.ws(req, socket as net.Socket, {}, head);
    });
    const proxyPort = await listenOn(proxyServer);

    // Open a raw TCP connection and send a WS upgrade request
    const socket = net.connect(proxyPort, "127.0.0.1");

    const { promise, resolve } = Promise.withResolvers<void>();

    socket.on("connect", () => {
      socket.write(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${proxyPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
    });

    socket.on("error", () => {
      // Expected — connection closed
    });

    // Wait for the target response to arrive and verify no crash
    setTimeout(() => {
      target.close();
      proxyServer.close();
      proxy.close();
      resolve();
    }, 200);

    await promise;
  });

  it("proxyUpgrade() should not crash when socket is destroyed before upstream responds", async () => {
    // Target server that responds with a normal HTTP 404 (no upgrade)
    const target = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(404);
        res.end("Not Found");
      }, 50);
    });
    const targetPort = await listenOn(target);

    const server = http.createServer();
    server.on("upgrade", (req, socket, head) => {
      // Destroy the socket before the upstream response arrives
      setTimeout(() => {
        socket.destroy();
      }, 10);
      proxyUpgrade(`http://127.0.0.1:${targetPort}`, req, socket, head).catch(() => {
        // Expected rejection — upstream didn't upgrade
      });
    });
    const serverPort = await listenOn(server);

    const socket = net.connect(serverPort, "127.0.0.1");

    const { promise, resolve } = Promise.withResolvers<void>();

    socket.on("connect", () => {
      socket.write(
        "GET / HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${serverPort}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
    });

    socket.on("error", () => {
      // Expected — connection closed
    });

    setTimeout(() => {
      target.close();
      server.close();
      resolve();
    }, 200);

    await promise;
  });
});
