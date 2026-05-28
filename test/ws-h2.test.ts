import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer, type IncomingMessage } from "node:http";
import { type AddressInfo, type Socket } from "node:net";
import {
  connect as h2Connect,
  createSecureServer,
  type ClientHttp2Session,
  type Http2SecureServer,
} from "node:http2";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as ws from "ws";

import { proxyH2Upgrade, proxyH2UpgradeSelfLoop } from "../src/ws-h2.ts";

const tlsOpts = {
  key: readFileSync(join(__dirname, "fixtures", "agent2-key.pem")),
  cert: readFileSync(join(__dirname, "fixtures", "agent2-cert.pem")),
};

// ---------------------------------------------------------------------------
// Fixture: h1 WebSocket echo server.
// ---------------------------------------------------------------------------
let upstreamHttp: HttpServer;
let upstreamWs: ws.WebSocketServer;
let upstreamPort: number;
let lastUpstreamHeaders: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  upstreamHttp = createServer();
  upstreamWs = new ws.WebSocketServer({ server: upstreamHttp });
  upstreamWs.on("connection", (socket, req) => {
    lastUpstreamHeaders = req.headers;
    socket.on("message", (msg) => socket.send("echo:" + msg.toString("utf8")));
  });
  await new Promise<void>((r) => upstreamHttp.listen(0, "127.0.0.1", r));
  upstreamPort = (upstreamHttp.address() as AddressInfo).port;
});

afterAll(() => {
  upstreamWs?.close();
  upstreamHttp?.close();
});

// ---------------------------------------------------------------------------
// Helper: spin up an h2 server that uses proxyH2Upgrade on extended-CONNECT.
// ---------------------------------------------------------------------------
type H2BridgeFactory = (
  stream: import("node:http2").ServerHttp2Stream,
  headers: import("node:http2").IncomingHttpHeaders,
) => Promise<void>;

async function startH2Bridge(
  bridge: H2BridgeFactory,
): Promise<{ server: Http2SecureServer; port: number }> {
  const server = createSecureServer({
    ...tlsOpts,
    allowHTTP1: true,
    settings: { enableConnectProtocol: true },
  });
  // Suppress Node's default 405 for CONNECT — adding any 'connect' listener disables it.
  server.on("connect", () => {});
  server.on("stream", (stream, headers) => {
    // Node's typings for 'stream' on Http2SecureServer use the base Http2Stream;
    // the runtime value is always a ServerHttp2Stream on a server.
    const s = stream as import("node:http2").ServerHttp2Stream;
    if (headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket") {
      bridge(s, headers).catch(() => {});
    } else {
      try {
        s.respond({ ":status": 404 });
        s.end();
      } catch {
        /* */
      }
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

// ---------------------------------------------------------------------------
// Helper: open an h2 client, send a WebSocket extended-CONNECT, read the
// :status response, write a frame, read the echo, return everything.
// ---------------------------------------------------------------------------
type H2ClientResult = {
  status: number;
  responseHeaders: Record<string, string | string[] | undefined>;
  // Raw bytes received over the tunnelled stream (after the :status response).
  body: Buffer;
};

async function dialAndEcho(
  proxyPort: number,
  opts: {
    path?: string;
    extraHeaders?: Record<string, string>;
    writeFrame?: Buffer;
    waitForBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<H2ClientResult> {
  const client: ClientHttp2Session = h2Connect(`https://127.0.0.1:${proxyPort}`, {
    rejectUnauthorized: false,
  });
  await new Promise<void>((r) => client.once("connect", () => r()));
  const headers: Record<string, string> = {
    ":method": "CONNECT",
    ":protocol": "websocket",
    ":path": opts.path ?? "/",
    ":authority": `127.0.0.1:${proxyPort}`,
    ...opts.extraHeaders,
  };
  const stream = client.request(headers);

  const responsePromise = new Promise<{
    status: number;
    responseHeaders: Record<string, string | string[] | undefined>;
  }>((resolve) => {
    stream.once("response", (hdrs) => {
      resolve({
        status: Number(hdrs[":status"] ?? 0),
        responseHeaders: hdrs,
      });
    });
  });

  const bodyChunks: Buffer[] = [];
  let received = 0;
  const want = opts.waitForBytes ?? 0;
  const bodyDone = new Promise<void>((resolve) => {
    if (want === 0) {
      // Caller doesn't expect bytes — wait for response only.
      stream.on("end", () => resolve());
      stream.on("close", () => resolve());
    } else {
      stream.on("data", (chunk: Buffer) => {
        bodyChunks.push(chunk);
        received += chunk.length;
        if (received >= want) resolve();
      });
      stream.on("end", () => resolve());
      stream.on("close", () => resolve());
    }
  });

  // Wait for the response, then optionally write a frame.
  const response = await responsePromise;
  if (opts.writeFrame) stream.write(opts.writeFrame);

  // Wait for echo bytes (or for stream end) with a timeout to keep tests bounded.
  await Promise.race([bodyDone, new Promise<void>((r) => setTimeout(r, opts.timeoutMs ?? 1000))]);

  try {
    stream.close();
  } catch {
    /* */
  }
  client.close();
  return { ...response, body: Buffer.concat(bodyChunks) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proxyH2Upgrade", () => {
  let bridge: { server: Http2SecureServer; port: number };

  afterAll(() => {
    bridge?.server.close();
  });

  it("bridges browser h2 extended-CONNECT to an h1 WebSocket upstream and returns :status 200", async () => {
    bridge = await startH2Bridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${upstreamPort}`, stream, headers),
    );
    const r = await dialAndEcho(bridge.port);
    expect(r.status).toBe(200);
  });

  it("forwards sec-websocket-protocol / extensions / origin / user-agent to the upstream upgrade request", async () => {
    bridge = await startH2Bridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${upstreamPort}`, stream, headers),
    );
    await dialAndEcho(bridge.port, {
      extraHeaders: {
        "sec-websocket-protocol": "chat,superchat",
        origin: "https://app.example.com",
        "user-agent": "test-agent/1.0",
      },
    });
    expect(lastUpstreamHeaders["sec-websocket-protocol"]).toBe("chat,superchat");
    expect(lastUpstreamHeaders["origin"]).toBe("https://app.example.com");
    expect(lastUpstreamHeaders["user-agent"]).toBe("test-agent/1.0");
  });

  it("returns :status 502 when the upstream is not listening", async () => {
    bridge = await startH2Bridge((stream, headers) =>
      proxyH2Upgrade("http://127.0.0.1:1", stream, headers),
    );
    const r = await dialAndEcho(bridge.port, { timeoutMs: 2000 });
    expect(r.status).toBe(502);
  });

  it("returns the upstream's non-101 status code when the upstream rejects the upgrade", async () => {
    // Plain HTTP server that responds 404 to all upgrades.
    const rejecter = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    rejecter.on("upgrade", (_req, socket) => {
      socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
    });
    await new Promise<void>((r) => rejecter.listen(0, "127.0.0.1", r));
    const rejectPort = (rejecter.address() as AddressInfo).port;

    bridge = await startH2Bridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${rejectPort}`, stream, headers),
    );
    const r = await dialAndEcho(bridge.port, { timeoutMs: 2000 });
    expect(r.status).toBe(404);

    rejecter.close();
  });

  it("uses opts.path when provided instead of the h2 :path header", async () => {
    let observedPath = "";
    const sniffer = createServer();
    sniffer.on("upgrade", (req, socket) => {
      observedPath = req.url ?? "";
      socket.destroy();
    });
    await new Promise<void>((r) => sniffer.listen(0, "127.0.0.1", r));
    const sniffPort = (sniffer.address() as AddressInfo).port;

    bridge = await startH2Bridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${sniffPort}`, stream, headers, { path: "/override" }),
    );
    await dialAndEcho(bridge.port, { path: "/ignored", timeoutMs: 1000 });
    expect(observedPath).toBe("/override");

    sniffer.close();
  });
});

describe("proxyH2UpgradeSelfLoop", () => {
  let h2Server: Http2SecureServer;
  let h2Port: number;

  beforeAll(async () => {
    h2Server = createSecureServer({
      ...tlsOpts,
      allowHTTP1: true,
      settings: { enableConnectProtocol: true },
    });
    // A WebSocket endpoint served by this same process — exposed only to h1.1.
    const loopWs = new ws.WebSocketServer({ noServer: true });
    loopWs.on("connection", (socket) => {
      socket.send("self-loop:hello");
    });
    h2Server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      loopWs.handleUpgrade(req, socket, head, (client) => loopWs.emit("connection", client, req));
    });
    h2Server.on("connect", () => {});
    h2Server.on("stream", (stream, headers) => {
      const s = stream as import("node:http2").ServerHttp2Stream;
      if (headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket") {
        proxyH2UpgradeSelfLoop(h2Server, s, headers).catch(() => {});
        return;
      }
      try {
        s.respond({ ":status": 404 });
        s.end();
      } catch {
        /* */
      }
    });
    await new Promise<void>((r) => h2Server.listen(0, "127.0.0.1", r));
    h2Port = (h2Server.address() as AddressInfo).port;
  });

  afterAll(() => {
    h2Server?.close();
  });

  it("tunnels an h2 extended-CONNECT back to the same server over h1.1 and receives the greeting", async () => {
    const r = await dialAndEcho(h2Port, { waitForBytes: 1, timeoutMs: 2000 });
    expect(r.status).toBe(200);
    expect(r.body.toString("utf8")).toContain("self-loop:hello");
  });
});
