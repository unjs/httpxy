import { Agent, createServer, type Server } from "node:http";
import { connect } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createProxyServer, proxyFetch } from "../src/index.ts";
import { listenOn } from "./_utils.ts";

const LIMIT = 64 * 1024;
const TOTAL = 8 * 1024 * 1024;

let upstream: Server;
let upstreamPort: number;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    if (Number(req.headers["content-length"]) > LIMIT) {
      res.writeHead(413, { "content-type": "text/plain" });
      res.end("too large");
      return;
    }
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
  });
  upstreamPort = await listenOn(upstream);
});

afterAll(async () => {
  await new Promise<void>((r) => upstream.close(() => r()));
});

interface Outcome {
  statuses: string[];
  written: number;
  error?: string;
}

function uploadThenPipeline(port: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const chunk = Buffer.alloc(64 * 1024, 0x78);
    const socket = connect(port, "127.0.0.1");
    let written = 0;
    let received = "";
    let error: string | undefined;
    const statuses = () => [...received.matchAll(/^HTTP\/1\.1 (\d{3})/gm)].map((m) => m[1]!);
    const finish = () => resolve({ statuses: statuses(), written, error });
    socket.on("data", (d) => {
      received += d.toString("latin1");
      if (statuses().length === 2) {
        socket.end();
      }
    });
    socket.on("error", (err: NodeJS.ErrnoException) => (error = err.code));
    socket.on("close", finish);
    const pump = () => {
      while (written < TOTAL) {
        written += chunk.length;
        if (!socket.write(chunk)) {
          socket.once("drain", pump);
          return;
        }
      }
      socket.write("GET /small HTTP/1.1\r\nHost: localhost\r\n\r\n");
    };
    socket.on("connect", () => {
      socket.write(`POST /big HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${TOTAL}\r\n\r\n`);
      pump();
    });
    setTimeout(() => socket.destroy(), 10_000).unref();
  });
}

function busySockets(agent: Agent) {
  return Object.values(agent.sockets).reduce((n, list) => n + (list?.length ?? 0), 0);
}

async function expectDrained(outcome: Outcome, agent: Agent) {
  expect(outcome.error).toBeUndefined();
  expect(outcome.written).toBe(TOTAL);
  expect(outcome.statuses).toEqual(["413", "200"]);
  await vi.waitFor(() => expect(busySockets(agent)).toBe(0));
  agent.destroy();
}

describe("upstream responds before the request body is fully written", () => {
  it("proxyFetch keeps draining the client body and the connection stays usable", async () => {
    const agent = new Agent({ keepAlive: true });
    const front = createServer(async (req, res) => {
      const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
      const upstreamRes = await proxyFetch(
        `http://127.0.0.1:${upstreamPort}`,
        `http://localhost${req.url}`,
        { method: req.method, headers: req.headers as Record<string, string>, body: body as any },
        { agent },
      );
      res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers));
      res.end(await upstreamRes.text());
    });
    const port = await listenOn(front);
    try {
      await expectDrained(await uploadThenPipeline(port), agent);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
    }
  });

  it("proxy.web keeps draining the client body and the connection stays usable", async () => {
    const agent = new Agent({ keepAlive: true });
    const proxy = createProxyServer({ target: `http://127.0.0.1:${upstreamPort}`, agent });
    const front = createServer((req, res) => {
      proxy.web(req, res);
    });
    const port = await listenOn(front);
    try {
      await expectDrained(await uploadThenPipeline(port), agent);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
    }
  });
});
