import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import {
  connect as h2Connect,
  createSecureServer,
  type ClientHttp2Session,
  type Http2SecureServer,
  type ServerHttp2Stream,
  type IncomingHttpHeaders as Http2Headers,
} from "node:http2";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as ws from "ws";

import { proxyH2Upgrade } from "../src/ws-h2.ts";

const tlsOpts = {
  key: readFileSync(join(__dirname, "fixtures", "agent2-key.pem")),
  cert: readFileSync(join(__dirname, "fixtures", "agent2-cert.pem")),
};

// ---------------------------------------------------------------------------
// Fixture: h1 WebSocket echo server. Captures the headers from the most
// recent upgrade so tests can assert the bridge forwarded them.
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
// Helper: spin up an h2 server that hands every extended-CONNECT stream to
// `bridge`. Each test gets its own server so listeners can't leak between
// cases (the previous suite kept a singleton, which masked failures).
// ---------------------------------------------------------------------------
type Bridge = (stream: ServerHttp2Stream, headers: Http2Headers) => Promise<void>;

const openBridges = new Set<Http2SecureServer>();

async function startBridge(bridge: Bridge): Promise<{ server: Http2SecureServer; port: number }> {
  const server = createSecureServer({
    ...tlsOpts,
    allowHTTP1: true,
    settings: { enableConnectProtocol: true },
  });
  // Adding any `connect` listener disables Node's default 405-on-CONNECT path.
  server.on("connect", () => {});
  server.on("stream", (raw, headers) => {
    // Node's typings widen the runtime `ServerHttp2Stream` to its base; cast once.
    const stream = raw as ServerHttp2Stream;
    if (headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket") {
      bridge(stream, headers).catch(() => {});
    } else {
      try {
        stream.respond({ ":status": 404 });
        stream.end();
      } catch {
        /* */
      }
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openBridges.add(server);
  return { server, port: (server.address() as AddressInfo).port };
}

afterEach(() => {
  for (const s of openBridges) s.close();
  openBridges.clear();
});

// ---------------------------------------------------------------------------
// Helper: open an h2 client and issue an extended-CONNECT, returning the
// :status, response headers, and any bytes received over the tunnelled stream
// before the connection was closed.
// ---------------------------------------------------------------------------
type ConnectResult = {
  status: number;
  responseHeaders: Record<string, string | string[] | undefined>;
  body: Buffer;
};

async function dial(
  port: number,
  opts: {
    path?: string;
    extraHeaders?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<ConnectResult> {
  const client: ClientHttp2Session = h2Connect(`https://127.0.0.1:${port}`, {
    rejectUnauthorized: false,
  });
  await new Promise<void>((r) => client.once("connect", () => r()));
  const stream = client.request({
    ":method": "CONNECT",
    ":protocol": "websocket",
    ":path": opts.path ?? "/",
    ":authority": `127.0.0.1:${port}`,
    ...opts.extraHeaders,
  });

  const response = await new Promise<{
    status: number;
    responseHeaders: Record<string, string | string[] | undefined>;
  }>((resolve) => {
    stream.once("response", (hdrs) =>
      resolve({ status: Number(hdrs[":status"] ?? 0), responseHeaders: hdrs }),
    );
  });

  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  await Promise.race([
    new Promise<void>((r) => stream.once("close", () => r())),
    new Promise<void>((r) => stream.once("end", () => r())),
    new Promise<void>((r) => setTimeout(r, opts.timeoutMs ?? 200)),
  ]);
  stream.destroy();
  client.destroy();
  return { ...response, body: Buffer.concat(chunks) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proxyH2Upgrade", () => {
  it("bridges an h2 extended-CONNECT to an h1 WebSocket upstream and responds with :status 200", async () => {
    const { port } = await startBridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${upstreamPort}`, stream, headers),
    );
    const r = await dial(port);
    expect(r.status).toBe(200);
  });

  it("forwards sec-websocket-protocol, sec-websocket-extensions, origin, and user-agent", async () => {
    const { port } = await startBridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${upstreamPort}`, stream, headers),
    );
    await dial(port, {
      extraHeaders: {
        "sec-websocket-protocol": "chat,superchat",
        "sec-websocket-extensions": "permessage-deflate",
        origin: "https://app.example.com",
        "user-agent": "test-agent/1.0",
      },
    });
    expect(lastUpstreamHeaders["sec-websocket-protocol"]).toBe("chat,superchat");
    expect(lastUpstreamHeaders["sec-websocket-extensions"]).toBe("permessage-deflate");
    expect(lastUpstreamHeaders["origin"]).toBe("https://app.example.com");
    expect(lastUpstreamHeaders["user-agent"]).toBe("test-agent/1.0");
  });

  it("responds with :status 502 when the upstream is not listening", async () => {
    const { port } = await startBridge((stream, headers) =>
      // Port 1 is reserved/unbound — connect refused.
      proxyH2Upgrade("http://127.0.0.1:1", stream, headers),
    );
    const r = await dial(port, { timeoutMs: 2000 });
    expect(r.status).toBe(502);
  });

  it("propagates the upstream's non-101 status (e.g. 404 from a server that refuses to upgrade)", async () => {
    const rejecter = createServer();
    rejecter.on("upgrade", (_req, socket) => {
      socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
    });
    await new Promise<void>((r) => rejecter.listen(0, "127.0.0.1", r));
    const rejectPort = (rejecter.address() as AddressInfo).port;

    const { port } = await startBridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${rejectPort}`, stream, headers),
    );
    const r = await dial(port, { timeoutMs: 2000 });
    expect(r.status).toBe(404);
    rejecter.close();
  });

  it("responds with :status 502 when the upstream accepts the TCP connection but never sends 101", async () => {
    // Black-hole server: accepts TCP, never writes — exercises the timeout path
    // that CodeRabbit flagged (the previous version rejected the Promise but
    // never responded to the h2 client, leaving the browser hanging).
    const blackhole = createServer();
    await new Promise<void>((r) => blackhole.listen(0, "127.0.0.1", r));
    const blackholePort = (blackhole.address() as AddressInfo).port;

    const { port } = await startBridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${blackholePort}`, stream, headers, { timeout: 150 }),
    );
    const r = await dial(port, { timeoutMs: 2000 });
    expect(r.status).toBe(502);
    blackhole.close();
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

    const { port } = await startBridge((stream, headers) =>
      proxyH2Upgrade(`http://127.0.0.1:${sniffPort}`, stream, headers, { path: "/override" }),
    );
    await dial(port, { path: "/ignored", timeoutMs: 1000 });
    expect(observedPath).toBe("/override");
    sniffer.close();
  });
});
