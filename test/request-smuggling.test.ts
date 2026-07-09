import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as httpProxy from "../src/index.ts";
import { listenOn } from "./_utils.ts";

// End-to-end request-smuggling coverage for GHSA-ggv3-7p47-pfv8, ported from the
// upstream reproduction at
// vercel/next.js/test/production/rewrite-request-smuggling/rewrite-request-smuggling.test.ts
//
// A crafted request declares `Transfer-Encoding: chunked` and hides a second
// `GET /secret` request inside its chunked body. If the proxy lets the upstream
// keep-alive socket be reused after the chunked request, a lenient/desync-prone
// upstream can interpret the leftover body bytes as a pipelined second request and
// execute the smuggled `GET /secret`. The fix forces `Connection: close` on any
// chunked outgoing request, so a close-delimited upstream processes exactly one
// request per connection and the smuggled request is never executed.

const SMUGGLED_MARKER = "GET /secret HTTP/1.1";

/**
 * A deliberately lenient upstream that models a desync-prone server: it reads the
 * first request's head, then — only if the request was NOT close-delimited — scans
 * the remaining bytes on the same connection for a pipelined request line. This is
 * the amplifier the fix removes: with `Connection: close` the upstream stops after
 * one request and the smuggled bytes are discarded; with keep-alive it "executes"
 * the smuggled request.
 */
function createLenientUpstream(recorded: string[], forwardedConnection: string[]): net.Server {
  return net.createServer((socket) => {
    let buffer = "";
    let firstHandled = false;
    let smuggledSeen = false;

    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");

      if (!firstHandled) {
        const headEnd = buffer.indexOf("\r\n\r\n");
        if (headEnd === -1) {
          return;
        }
        firstHandled = true;

        const lines = buffer.slice(0, headEnd).split("\r\n");
        const [method, path] = lines[0]!.split(" ");
        recorded.push(`${method} ${path}`);

        let connection = "";
        for (let i = 1; i < lines.length; i++) {
          const idx = lines[i]!.indexOf(":");
          if (idx !== -1 && lines[i]!.slice(0, idx).trim().toLowerCase() === "connection") {
            connection = lines[i]!.slice(idx + 1)
              .trim()
              .toLowerCase();
          }
        }
        forwardedConnection.push(connection);

        const closeDelimited = connection.includes("close");
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: ${
            closeDelimited ? "close" : "keep-alive"
          }\r\n\r\nrewrite-ok`,
        );
        if (closeDelimited) {
          // Honor close: one request per connection, discard any trailing bytes.
          socket.end();
          return;
        }
      }

      // Keep-alive desync model: treat leftover bytes as pipelined requests.
      if (firstHandled && !smuggledSeen && buffer.includes(SMUGGLED_MARKER)) {
        smuggledSeen = true;
        recorded.push("GET /secret");
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret");
        socket.end();
      }
    });
  });
}

/**
 * Sends a raw smuggling payload: a chunked `method rewritePath` request carrying a
 * hidden `GET /secret` request inside its single chunk.
 */
function sendSmugglingPayload({
  proxyPort,
  connectionHeader,
  method = "DELETE",
  rewritePath = "/rewrites/poc",
}: {
  proxyPort: number;
  connectionHeader: string;
  method?: "DELETE" | "OPTIONS";
  rewritePath?: string;
}): Promise<void> {
  const smuggledRequest = Buffer.from(
    `${SMUGGLED_MARKER}\r\nHost: 127.0.0.1:${proxyPort}\r\n\r\n`,
    "latin1",
  );
  const chunkSize = Buffer.from(
    `${smuggledRequest.length.toString(16).toUpperCase()}\r\n`,
    "latin1",
  );

  const payload = Buffer.concat([
    Buffer.from(
      `${method} ${rewritePath} HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nTransfer-Encoding: chunked\r\nConnection: ${connectionHeader}\r\n\r\n`,
      "latin1",
    ),
    chunkSize,
    smuggledRequest,
    Buffer.from("\r\n0\r\n\r\n", "latin1"),
  ]);

  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      socket.destroy();
      resolve();
    };

    socket.once("connect", () => socket.write(payload));
    socket.on("data", () => {
      // Resolve once the upstream has gone idle after the response(s) — long enough
      // for a keep-alive upstream to have scanned leftover bytes and (without the fix)
      // executed the smuggled request.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 150);
    });
    socket.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      reject(err);
    });
    // Overall cap in case no response ever arrives.
    socket.setTimeout(2000, finish);
  });
}

describe("request smuggling (GHSA-ggv3-7p47-pfv8)", () => {
  let upstream: net.Server;
  let proxyServer: http.Server;
  let proxyPort: number;
  const recorded: string[] = [];
  const forwardedConnection: string[] = [];

  beforeAll(async () => {
    upstream = createLenientUpstream(recorded, forwardedConnection);
    const upstreamPort = await listenOn(upstream);

    const proxy = httpProxy.createProxyServer({
      target: `http://127.0.0.1:${upstreamPort}`,
    });
    proxy.on("error", () => {});

    proxyServer = http.createServer((req, res) => {
      proxy.web(req, res).catch(() => {});
    });
    proxyPort = await listenOn(proxyServer);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  const scenarios: Array<{
    name: string;
    connectionHeader: string;
    method?: "DELETE" | "OPTIONS";
    rewritePath?: string;
  }> = [
    { name: "keep-alive only", connectionHeader: "keep-alive" },
    { name: "keep-alive, upgrade", connectionHeader: "keep-alive, upgrade" },
    { name: "Transfer-Encoding, upgrade", connectionHeader: "Transfer-Encoding, upgrade" },
    {
      name: "OPTIONS with Transfer-Encoding, upgrade",
      connectionHeader: "Transfer-Encoding, upgrade",
      method: "OPTIONS",
    },
    {
      name: "lenient upstream path (non-rfc-strip)",
      connectionHeader: "keep-alive, upgrade",
      method: "OPTIONS",
      rewritePath: "/rewrites/non-rfc-strip",
    },
  ];

  for (const scenario of scenarios) {
    it(`does not smuggle a second request with ${scenario.name}`, async () => {
      recorded.length = 0;
      forwardedConnection.length = 0;

      const method = scenario.method ?? "DELETE";
      const rewritePath = scenario.rewritePath ?? "/rewrites/poc";

      await sendSmugglingPayload({
        proxyPort,
        connectionHeader: scenario.connectionHeader,
        method,
        rewritePath,
      });

      // The legitimate request reaches the upstream...
      expect(recorded).toContain(`${method} ${rewritePath}`);
      // ...but the smuggled request never does.
      expect(recorded).not.toContain("GET /secret");
      // ...because the chunked request was forced to close the upstream socket.
      expect(forwardedConnection[0]).toContain("close");
    });
  }
});
