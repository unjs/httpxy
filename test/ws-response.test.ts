import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { createServer as createTCPServer, type AddressInfo, type Socket } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createProxyServer, proxyUpgrade } from "../src/index.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: Server | ReturnType<typeof createTCPServer>) {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

function getResponse(port: number) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      headers: { connection: "Upgrade", upgrade: "websocket" },
    });
    req.on("response", resolve);
    req.on("error", reject);
    req.end();
  });
}

async function readBody(response: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe.each(["proxyUpgrade", "ProxyServer.ws"] as const)("%s rejection responses", (api) => {
  async function proxyTo(port: number, onSocket?: (socket: Socket) => void) {
    const target = `http://127.0.0.1:${port}`;
    const proxy = createProxyServer({ target });
    const server = createServer();
    server.on("upgrade", (req, socket, head) => {
      onSocket?.(socket as Socket);
      const pending =
        api === "proxyUpgrade"
          ? proxyUpgrade(target, req, socket, head)
          : proxy.ws(req, socket as Socket, {}, head);
      pending.catch(() => {});
    });
    return listen(server);
  }

  it("relays a chunked rejection with valid downstream framing", async () => {
    const port = await listen(
      createServer((_req, res) => {
        res.writeHead(401, "Authentication Required", {
          "set-cookie": ["first=1", "second=2"],
          "www-authenticate": "Basic realm=websocket",
          "content-type": "text/plain; charset=utf-8",
          "x-message": "café",
        });
        res.write("permission ");
        res.end("denied: café");
      }),
    );
    const response = await getResponse(await proxyTo(port));
    expect(await readBody(response)).toBe("permission denied: café");
    expect(response.complete).toBe(true);
    expect(response.statusCode).toBe(401);
    expect(response.statusMessage).toBe("Authentication Required");
    expect(response.headers["set-cookie"]).toEqual(["first=1", "second=2"]);
    expect(response.headers["www-authenticate"]).toBe("Basic realm=websocket");
    expect(response.headers["x-message"]).toBe("café");
    expect(response.headers.connection).toBe("close");
  });

  it("preserves fixed-length rejection bodies", async () => {
    const body = "forbidden";
    const port = await listen(
      createServer((_req, res) => {
        res.writeHead(403, { "content-length": Buffer.byteLength(body) });
        res.end(body);
      }),
    );
    const response = await getResponse(await proxyTo(port));
    expect(await readBody(response)).toBe(body);
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(body)));
    expect(response.headers["transfer-encoding"]).toBeUndefined();
    expect(response.headers.connection).toBe("close");
  });

  it.each([
    ["Connection", "forbidden"],
    ["Connection", ""],
    ["Proxy-Connection", "forbidden"],
    ["Proxy-Connection", ""],
  ])("preserves a length nominated by %s for body %j", async (header, body) => {
    const length = Buffer.byteLength(body);
    const port = await listen(
      createTCPServer((socket) => {
        socket.once("data", () =>
          socket.end(
            `HTTP/1.1 403 Forbidden\r\n${header}: Content-Length\r\nContent-Length: ${length}\r\n\r\n${body}`,
          ),
        );
      }),
    );
    const response = await getResponse(await proxyTo(port));
    expect(await readBody(response)).toBe(body);
    expect(response.headers["content-length"]).toBe(String(length));
    expect(response.headers["transfer-encoding"]).toBeUndefined();
    expect(response.headers["proxy-connection"]).toBeUndefined();
    expect(response.headers.connection).toBe("close");
    expect(response.complete).toBe(true);
  });

  it.each(["gzip, chunked", "gzip"])("preserves the %s transfer coding", async (encoding) => {
    const body = gzipSync("compressed rejection");
    const port = await listen(
      createServer((_req, res) => {
        res.writeHead(403, { "transfer-encoding": encoding, connection: "close" });
        res.end(body);
      }),
    );
    const response = await getResponse(await proxyTo(port));
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(body);
    expect(response.headers["transfer-encoding"]).toBe(encoding);
    expect(response.complete).toBe(true);
  });

  it.each([204, 304])("preserves bodyless status %s", async (statusCode) => {
    const port = await listen(
      createServer((_req, res) => {
        res.writeHead(statusCode);
        res.end();
      }),
    );
    const response = await getResponse(await proxyTo(port));
    expect(await readBody(response)).toBe("");
    expect(response.statusCode).toBe(statusCode);
    expect(response.headers["content-length"]).toBeUndefined();
    expect(response.headers["transfer-encoding"]).toBeUndefined();
    expect(response.complete).toBe(true);
  });

  it.each(["Connection", "Proxy-Connection"])(
    "preserves a 304 representation length nominated by %s",
    async (header) => {
      const port = await listen(
        createTCPServer((socket) => {
          socket.once("data", () =>
            socket.end(
              `HTTP/1.1 304 Not Modified\r\n${header}: Content-Length\r\nContent-Length: 20\r\n\r\n`,
            ),
          );
        }),
      );
      const response = await getResponse(await proxyTo(port));
      expect(await readBody(response)).toBe("");
      expect(response.statusCode).toBe(304);
      expect(response.headers["content-length"]).toBe("20");
      expect(response.headers["transfer-encoding"]).toBeUndefined();
      expect(response.complete).toBe(true);
    },
  );

  it("streams rejection bodies larger than 64 KiB", async () => {
    const firstChunkRead = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const body = "x".repeat(8 * 1024 * 1024);
    const port = await listen(
      createServer(async (_req, res) => {
        res.writeHead(403);
        res.write("first");
        await firstChunkRead.promise;
        res.end(body);
        finished.resolve();
      }),
    );
    const response = await getResponse(await proxyTo(port));
    response.once("data", () => firstChunkRead.resolve());
    try {
      expect(await readBody(response)).toBe("first" + body);
      expect(response.complete).toBe(true);
    } finally {
      firstChunkRead.resolve();
      await finished.promise;
    }
  });

  it("cancels the upstream body when the downstream socket closes", async () => {
    const upstreamClosed = Promise.withResolvers<void>();
    const port = await listen(
      createServer((_req, res) => {
        res.once("close", () => upstreamClosed.resolve());
        res.writeHead(403);
        res.write("still streaming");
      }),
    );
    let downstream: Socket;
    const proxyPort = await proxyTo(port, (socket) => {
      downstream = socket;
    });
    const response = await getResponse(proxyPort);
    response.on("error", () => {});
    downstream!.destroy();
    await upstreamClosed.promise;
  });

  it("removes response headers nominated by Connection", async () => {
    const port = await listen(
      createServer((_req, res) => {
        res.writeHead(403, {
          connection: "keep-alive, X-Private",
          "proxy-connection": "X-Proxy-Private",
          "keep-alive": "timeout=5",
          "x-private": "first hop",
          "x-proxy-private": "first hop",
          "content-length": "0",
        });
        res.end();
      }),
    );
    const response = await getResponse(await proxyTo(port));
    await readBody(response);
    expect(response.headers.connection).toBe("close");
    for (const name of ["keep-alive", "proxy-connection", "x-private", "x-proxy-private"]) {
      expect(response.headers[name]).toBeUndefined();
    }
  });

  it.each([
    "Content-Length: 20\r\n\r\nshort",
    "Connection: close, Content-Length\r\nContent-Length: 20\r\n\r\nshort",
    "Proxy-Connection: Content-Length\r\nContent-Length: 20\r\n\r\nshort",
    "Transfer-Encoding: chunked\r\n\r\n5\r\nshort\r\n",
  ])("does not complete a truncated response: %s", async (payload) => {
    const port = await listen(
      createTCPServer((socket) => {
        socket.once("data", () => socket.end("HTTP/1.1 403 Forbidden\r\n" + payload));
      }),
    );
    const response = await getResponse(await proxyTo(port));
    await expect(readBody(response)).rejects.toThrow();
    expect(response.complete).toBe(false);
  });
});
