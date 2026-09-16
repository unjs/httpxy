import { once } from "node:events";
import { Agent, createServer, request, type Server, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createProxyServer } from "../src/server.ts";
import { proxyUpgrade } from "../src/ws.ts";

const servers = new Set<Server>();
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    [...servers].map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  sockets.clear();
  servers.clear();
});

async function listen(server: Server) {
  servers.add(server);
  server.on("connection", (socket) => sockets.add(socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

function getBody(port: number, agent: Agent) {
  return new Promise<string>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, agent }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

for (const mode of ["proxyUpgrade", "ProxyServer.ws"] as const) {
  describe(`${mode} establishmentTimeout`, () => {
    async function start(
      target: Server | number,
      establishmentTimeout: number | undefined,
      onProxy?: (socket: Socket) => void,
      handleError = true,
      agent?: Agent,
    ) {
      const targetPort = typeof target === "number" ? target : await listen(target);
      const options = { establishmentTimeout, agent };
      const proxy = createProxyServer({ target: `http://127.0.0.1:${targetPort}`, ...options });
      const errors: Error[] = [];
      const failed = Promise.withResolvers<Error>();
      const downstream = Promise.withResolvers<Socket>();
      const settled = Promise.withResolvers<"resolved" | Error>();
      if (mode === "ProxyServer.ws" && handleError) {
        proxy.on("error", (error) => {
          errors.push(error);
          failed.resolve(error);
        });
      }
      const server = createServer();
      server.on("upgrade", (req, socket, head) => {
        downstream.resolve(socket as Socket);
        onProxy?.(socket as Socket);
        const result =
          mode === "proxyUpgrade"
            ? proxyUpgrade(`http://127.0.0.1:${targetPort}`, req, socket, head, options)
            : proxy.ws(req, socket as Socket, {}, head);
        result.then(
          () => settled.resolve("resolved"),
          (error) => {
            errors.push(error);
            failed.resolve(error);
            settled.resolve(error);
          },
        );
      });
      const port = await listen(server);
      const client = connect(port, "127.0.0.1");
      sockets.add(client);
      client.on("error", () => {});
      let response = "";
      client.on("data", (chunk) => {
        response += chunk.toString();
      });
      const closed = once(client, "close");
      await once(client, "connect");
      client.write(
        `GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\n` +
          "Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
      return {
        client,
        errors,
        failed: failed.promise,
        downstream: downstream.promise,
        settled: settled.promise,
        closed,
        response: () => response,
      };
    }

    it("times out a silent upstream and closes both connections once", async () => {
      const target = createServer();
      const connected = once(target, "upgrade");
      const fixture = await start(target, 40);
      const [, upstream] = await connected;
      const upstreamClosed = once(upstream, "close");
      upstream.once("end", () => upstream.end());
      upstream.resume();
      const result = await Promise.race([fixture.failed, delay(400, "still pending")]);
      expect(result).toMatchObject({ code: "ERR_UPSTREAM_UPGRADE_TIMEOUT", statusCode: 504 });
      await Promise.all([fixture.closed, upstreamClosed]);
      await delay(60);
      expect(fixture.errors).toHaveLength(1);
      expect(fixture.response()).toBe("");
    });

    describe.each([true, false])("queued requests with handleError=%s", (handleError) => {
      it.each(["timeout", "downstream close", "downstream error"])(
        "reports %s before an agent socket is available",
        async (failure) => {
          const agent = new Agent({ keepAlive: true, maxSockets: 1 });
          const held = Promise.withResolvers<ServerResponse>();
          let requests = 0;
          let upgrades = 0;
          const target = createServer((_req, res) => {
            if (++requests === 1) held.resolve(res);
            else res.end("next request");
          });
          target.on("upgrade", (_req, socket) => {
            upgrades++;
            socket.destroy();
          });
          const targetPort = await listen(target);
          const occupying = getBody(targetPort, agent);
          const heldResponse = await held.promise;
          try {
            const fixture = await start(
              targetPort,
              failure === "timeout" ? 40 : 1000,
              undefined,
              handleError,
              agent,
            );
            const downstream = await fixture.downstream;
            expect(Object.values(agent.requests).flat()).toHaveLength(1);
            const clientError = Object.assign(new Error("client reset"), { code: "ECONNRESET" });
            if (failure !== "timeout") {
              downstream.destroy(failure === "downstream error" ? clientError : undefined);
            }

            const error = await Promise.race([fixture.failed, delay(400, "still pending")]);
            expect(error).toMatchObject({
              code: failure === "timeout" ? "ERR_UPSTREAM_UPGRADE_TIMEOUT" : "ECONNRESET",
            });
            if (failure === "timeout") expect(error).toMatchObject({ statusCode: 504 });
            if (failure === "downstream error") expect(error).toBe(clientError);
            expect(fixture.errors).toHaveLength(1);
            expect(await fixture.settled).toBe(
              mode === "ProxyServer.ws" && handleError ? "resolved" : error,
            );
            await fixture.closed;
            expect(fixture.response()).toBe("");
            expect(fixture.errors).toHaveLength(1);

            heldResponse.end("released");
            expect(await occupying).toBe("released");
            expect(await getBody(targetPort, agent)).toBe("next request");
            expect(upgrades).toBe(0);
            expect(fixture.errors).toHaveLength(1);
          } finally {
            heldResponse.end();
            await occupying;
            agent.destroy();
          }
        },
      );
    });

    it("does not extend the deadline for informational responses or partial headers", async () => {
      const target = createServer();
      target.on("upgrade", (_req, socket) => {
        socket.on("error", () => {});
        socket.write("HTTP/1.1 103 Early Hints\r\n\r\nHTTP/1.1 401 Unauthorized\r\nX-Slow: ");
        const timer = setInterval(() => socket.write("x"), 10);
        socket.once("close", () => clearInterval(timer));
        socket.once("end", () => socket.end());
        socket.resume();
      });
      const fixture = await start(target, 80);
      expect(await fixture.failed).toMatchObject({ code: "ERR_UPSTREAM_UPGRADE_TIMEOUT" });
      await fixture.closed;
      expect(fixture.response()).toBe("");
    });

    if (mode === "ProxyServer.ws") {
      it("rejects the promise when no error listener handles the timeout", async () => {
        const target = createServer();
        target.on("upgrade", (_req, socket) => socket.resume());
        const fixture = await start(target, 40, undefined, false);
        expect(await fixture.failed).toMatchObject({
          code: "ERR_UPSTREAM_UPGRADE_TIMEOUT",
          statusCode: 504,
        });
        await fixture.closed;
        expect(fixture.errors).toHaveLength(1);
      });
    }

    it("keeps an upgraded tunnel usable after the deadline", async () => {
      const target = createServer();
      target.on("upgrade", (_req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
            "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
        );
        socket.pipe(socket);
      });
      const fixture = await start(target, 80);
      await once(fixture.client, "data");
      await delay(120);
      const echoed = once(fixture.client, "data");
      fixture.client.write("still connected");
      expect((await echoed)[0].toString()).toBe("still connected");
      expect(fixture.errors).toEqual([]);
    });

    it("stops the deadline at non-upgrade headers without limiting the response body", async () => {
      const target = createServer();
      const response = Promise.withResolvers<() => void>();
      target.on("request", (_req, res) => {
        res.writeHead(401, { "Content-Length": "4", Connection: "close" });
        res.write("a");
        response.resolve(() => res.end("bcd"));
      });
      const fixture = await start(target, 80);
      const finish = await response.promise;
      await once(fixture.client, "data");
      await delay(120);
      expect(fixture.client.destroyed).toBe(false);
      finish();
      await fixture.closed;
      expect(fixture.response()).toContain("401 Unauthorized");
      expect(fixture.response()).toContain("abcd");
      expect(fixture.errors).toHaveLength(mode === "proxyUpgrade" ? 1 : 0);
      expect(
        fixture.errors.some(
          (error) => "code" in error && error.code === "ERR_UPSTREAM_UPGRADE_TIMEOUT",
        ),
      ).toBe(false);
    });

    it("clears the deadline on an earlier upstream error", async () => {
      const target = createServer();
      target.on("upgrade", (_req, socket) => socket.destroy());
      const fixture = await start(target, 80);
      expect(await fixture.failed).toMatchObject({ code: "ECONNRESET" });
      await fixture.closed;
      await delay(120);
      expect(fixture.errors).toHaveLength(1);
    });

    it("cancels the pending upstream when the downstream socket closes", async () => {
      const target = createServer();
      const connected = once(target, "upgrade");
      const fixture = await start(target, 80);
      const [, upstream] = await connected;
      const upstreamClosed = once(upstream, "close");
      upstream.once("end", () => upstream.end());
      upstream.resume();
      (await fixture.downstream).destroy();
      await Promise.all([fixture.closed, upstreamClosed]);
      expect(await fixture.failed).toMatchObject({ code: "ECONNRESET" });
      await delay(120);
      expect(fixture.errors).toHaveLength(1);
    });

    it("cancels the upstream request if the downstream socket is already destroyed", async () => {
      const target = createServer();
      let requests = 0;
      target.on("upgrade", () => {
        requests++;
      });
      const fixture = await start(target, 80, (socket) => socket.destroy());
      expect(await fixture.failed).toMatchObject({ code: "ECONNRESET" });
      await fixture.closed;
      await delay(120);
      expect(requests).toBe(0);
      expect(fixture.errors).toHaveLength(1);
    });

    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
      "does not immediately time out with establishmentTimeout=%s",
      async (timeout) => {
        const target = createServer();
        const connected = once(target, "upgrade");
        const fixture = await start(target, timeout);
        await connected;
        await delay(40);
        expect(fixture.client.destroyed).toBe(false);
        expect(fixture.errors).toEqual([]);
      },
    );
  });
}
