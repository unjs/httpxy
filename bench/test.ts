#!/usr/bin/env node
import http from "node:http";
import { createProxyServer, proxyFetch } from "../src/index.ts";
import fastProxy from "fast-proxy";
import { createProxyServer as createHttpProxy3 } from "http-proxy-3";
import httpProxyLegacy from "http-proxy";
import Fastify from "fastify";
import httpProxy from "@fastify/http-proxy";

// --- Config ---

const TARGET_PORT = 9_900;
const HTTPXY_SERVER_PORT = 9_901;
const HTTPXY_FETCH_PORT = 9_902;
const FAST_PROXY_PORT = 9_903;
const FASTIFY_PROXY_PORT = 9_904;
const HTTP_PROXY_3_PORT = 9_905;
const HTTP_PROXY_PORT = 9_906;

const SMALL_BODY = JSON.stringify({ message: "hello world", ts: Date.now() });
const LARGE_BODY = JSON.stringify({
  data: Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `item-${i}`,
    value: Math.random(),
    tags: ["a", "b", "c"],
  })),
});

// --- Target server (echo) ---

function createTargetServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": req.headers["content-type"] || "application/octet-stream",
          "content-length": String(Buffer.concat(chunks).length),
        });
        res.end(Buffer.concat(chunks));
      });
    });
    server.listen(TARGET_PORT, () => resolve(server));
  });
}

// --- Proxy servers setup ---

const TARGET = `http://127.0.0.1:${TARGET_PORT}`;

async function setupHttpxyServer(): Promise<http.Server> {
  const proxy = createProxyServer({ target: TARGET });
  const server = http.createServer((req, res) => {
    proxy.web(req, res);
  });
  return new Promise((resolve) => {
    server.listen(HTTPXY_SERVER_PORT, () => resolve(server));
  });
}

function collectBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
  });
}

async function setupHttpxyFetchServer(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const body = await collectBody(req);
    const response = await proxyFetch(
      TARGET,
      new URL(req.url!, `http://127.0.0.1:${HTTPXY_FETCH_PORT}`),
      {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: body as any,
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
    }
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(HTTPXY_FETCH_PORT, () => resolve(server));
  });
}

async function setupFastProxy(): Promise<{ server: http.Server; close: () => void }> {
  const { proxy, close } = fastProxy({ base: TARGET });
  const server = http.createServer((req, res) => {
    proxy(req, res, req.url!, {});
  });
  return new Promise((resolve) => {
    server.listen(FAST_PROXY_PORT, () => resolve({ server, close }));
  });
}

async function setupFastifyProxy(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify();
  await app.register(httpProxy, { upstream: TARGET });
  await app.listen({ port: FASTIFY_PROXY_PORT });
  return app;
}

async function setupHttpProxy3(): Promise<http.Server> {
  const proxy = createHttpProxy3({ target: TARGET });
  const server = http.createServer((req, res) => {
    proxy.web(req, res);
  });
  return new Promise((resolve) => {
    server.listen(HTTP_PROXY_3_PORT, () => resolve(server));
  });
}

async function setupHttpProxyLegacy(): Promise<http.Server> {
  const proxy = httpProxyLegacy.createProxyServer({ target: TARGET });
  const server = http.createServer((req, res) => {
    proxy.web(req, res);
  });
  return new Promise((resolve) => {
    server.listen(HTTP_PROXY_PORT, () => resolve(server));
  });
}

// --- HTTP helpers ---

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpGet(port: number, path = "/"): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on("error", reject);
  });
}

function httpPost(port: number, body: string, path = "/"): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// --- Main ---

async function main() {
  console.log("Starting servers...");

  const targetServer = await createTargetServer();
  const httpxyServer = await setupHttpxyServer();
  const httpxyFetchServer = await setupHttpxyFetchServer();
  const fastProxySetup = await setupFastProxy();
  const fastifyApp = await setupFastifyProxy();
  const httpProxy3Server = await setupHttpProxy3();
  const httpProxyLegacyServer = await setupHttpProxyLegacy();

  console.log("Validating proxy implementations...");

  const proxies = [
    { name: "httpxy server", port: HTTPXY_SERVER_PORT },
    { name: "httpxy proxyFetch", port: HTTPXY_FETCH_PORT },
    { name: "fast-proxy", port: FAST_PROXY_PORT },
    { name: "@fastify/http-proxy", port: FASTIFY_PROXY_PORT },
    { name: "http-proxy-3", port: HTTP_PROXY_3_PORT },
    { name: "http-proxy", port: HTTP_PROXY_PORT },
  ];

  let allValid = true;

  for (const { name, port } of proxies) {
    const errors: string[] = [];

    const getRes = await httpGet(port);
    if (getRes.status !== 200) {
      errors.push(`GET status=${getRes.status}, expected 200`);
    }
    if (getRes.body !== '{"ok":true}') {
      errors.push(`GET body=${JSON.stringify(getRes.body)}, expected '{"ok":true}'`);
    }

    const postSmall = await httpPost(port, SMALL_BODY);
    if (postSmall.status !== 200) {
      errors.push(`POST(1KB) status=${postSmall.status}, expected 200`);
    }
    if (postSmall.body !== SMALL_BODY) {
      errors.push(
        `POST(1KB) body mismatch: got ${postSmall.body.length} bytes, expected ${SMALL_BODY.length}`,
      );
    }

    const postLarge = await httpPost(port, LARGE_BODY);
    if (postLarge.status !== 200) {
      errors.push(`POST(100KB) status=${postLarge.status}, expected 200`);
    }
    if (postLarge.body !== LARGE_BODY) {
      errors.push(
        `POST(100KB) body mismatch: got ${postLarge.body.length} bytes, expected ${LARGE_BODY.length}`,
      );
    }

    if (errors.length > 0) {
      allValid = false;
      console.log(`  FAIL  ${name}`);
      for (const e of errors) {
        console.log(`        - ${e}`);
      }
    } else {
      console.log(`  OK    ${name}`);
    }
  }

  // Cleanup
  targetServer.close();
  httpxyServer.close();
  httpxyFetchServer.close();
  fastProxySetup.server.close();
  fastProxySetup.close();
  await fastifyApp.close();
  httpProxy3Server.close();
  httpProxyLegacyServer.close();

  if (!allValid) {
    console.error("\nValidation failed.");
    process.exit(1);
  }

  console.log("\nAll implementations valid.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
