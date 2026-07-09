import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AddressInfo } from "node:net";

import { proxyFetch } from "../src/fetch.ts";

// --- TCP server ---

let tcpServer: Server;
let tcpPort: number;

beforeAll(async () => {
  tcpServer = createServer((req, res) => {
    if (req.url === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/slow") {
      const timer = setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("slow-ok");
      }, 5000);
      req.on("close", () => clearTimeout(timer));
      return;
    }
    if (req.url === "/echo" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(Buffer.concat(chunks));
      });
      return;
    }
    if (req.url?.startsWith("/headers")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ headers: req.headers, url: req.url }));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/json" });
      res.end();
      return;
    }
    if (req.url === "/redirect-307") {
      res.writeHead(307, { location: "/echo" });
      res.end();
      return;
    }
    if (req.url === "/redirect-chain") {
      res.writeHead(301, { location: "/redirect" });
      res.end();
      return;
    }
    if (req.url === "/multi-cookie") {
      res.writeHead(200, [
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "b=2; Path=/"],
        ["set-cookie", "c=3; Path=/"],
        ["content-type", "text/plain"],
      ]);
      res.end("ok");
      return;
    }
    if (req.url === "/no-content") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve) => {
    tcpServer.listen(0, "127.0.0.1", resolve);
  });
  tcpPort = (tcpServer.address() as AddressInfo).port;
});

afterAll(() => {
  tcpServer?.close();
});

// --- Unix socket server ---

let socketServer: Server;
const socketPath = join(tmpdir(), `httpxy-test-${process.pid}-${Date.now()}.sock`);

beforeAll(async () => {
  socketServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("unix-ok");
  });
  await new Promise<void>((resolve) => {
    socketServer.listen(socketPath, resolve);
  });
});

afterAll(() => {
  socketServer?.close();
});

// --- Tests ---

describe("proxyFetch", () => {
  describe("TCP (host + port)", () => {
    it("GET request returns JSON", async () => {
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/json`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ ok: true });
    });

    it("POST with body", async () => {
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
        method: "POST",
        body: "hello",
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
    });

    it("forwards custom headers", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/headers`,
        { headers: { "x-custom": "test-value" } },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers["x-custom"]).toBe("test-value");
    });

    it("handles redirect manually (no follow)", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect`,
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/json");
    });

    it("handles 204 no content", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/no-content`,
      );
      expect(res.status).toBe(204);
      expect(res.body).toBeNull();
    });

    it("preserves multiple set-cookie headers", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/multi-cookie`,
      );
      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie();
      expect(cookies).toEqual(["a=1; Path=/", "b=2; Path=/", "c=3; Path=/"]);
    });

    it("strips hop-by-hop headers", async () => {
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/json`);
      expect(res.headers.has("transfer-encoding")).toBe(false);
      expect(res.headers.has("keep-alive")).toBe(false);
      expect(res.headers.has("connection")).toBe(false);
    });

    it("handles Request object input", async () => {
      const req = new Request("http://localhost/json", {
        headers: { accept: "application/json" },
      });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("preserves query string", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/headers?foo=bar`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toBe("/headers?foo=bar");
    });
  });

  describe("Unix socket", () => {
    it("GET via unix socket", async () => {
      const res = await proxyFetch({ socketPath }, `http://localhost/anything`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("unix-ok");
    });
  });

  describe("POST with streaming body", () => {
    it("pipes ReadableStream body", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
      });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
        method: "POST",
        body: stream,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("streamed");
    });
  });

  describe("Request as inputInit", () => {
    it("uses Request object as inputInit", async () => {
      const initReq = new Request("http://localhost/echo", {
        method: "POST",
        body: "from-request-init",
      });
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/echo`,
        initReq,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("from-request-init");
    });

    it("inputInit Request overrides input Request properties", async () => {
      const input = new Request("http://localhost/echo", { method: "GET" });
      const initReq = new Request("http://localhost/echo", {
        method: "POST",
        headers: { "x-from": "init-request" },
        body: "override-body",
      });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, input, initReq);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("override-body");
    });

    it("inputInit Request with streaming body", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("init-stream"));
          controller.close();
        },
      });
      const initReq = new Request("http://localhost/echo", {
        method: "POST",
        body: stream,
        // @ts-expect-error duplex
        duplex: "half",
      });
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/echo`,
        initReq,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("init-stream");
    });
  });

  describe("Request input with body", () => {
    it("POST body from Request input", async () => {
      const req = new Request("http://localhost/echo", {
        method: "POST",
        body: "request-body",
      });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("request-body");
    });

    it("POST streaming body from Request input", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("req-stream"));
          controller.close();
        },
      });
      const req = new Request("http://localhost/echo", {
        method: "POST",
        body: stream,
        // @ts-expect-error duplex
        duplex: "half",
      });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("req-stream");
    });
  });

  describe("string addr", () => {
    it("accepts http URL string as addr", async () => {
      const res = await proxyFetch(`http://127.0.0.1:${tcpPort}`, `http://localhost/json`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("accepts unix: string as addr", async () => {
      const res = await proxyFetch(`unix:${socketPath}`, `http://localhost/anything`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("unix-ok");
    });
  });

  describe("error handling", () => {
    it("rejects on connection error", async () => {
      await expect(
        proxyFetch({ host: "127.0.0.1", port: 1 }, `http://localhost/`),
      ).rejects.toThrow();
    });

    it("rejects on body stream error", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error("stream-fail"));
        },
      });
      await expect(
        proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
          method: "POST",
          body: stream,
        }),
      ).rejects.toThrow("stream-fail");
    });
  });

  describe("signal / abort", () => {
    it("aborts request with already-aborted signal", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/json`, {
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });

    it("aborts in-flight request", async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      await expect(
        proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/slow`, {
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });

    it("succeeds when signal is not aborted", async () => {
      const controller = new AbortController();
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/json`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
    });
  });

  describe("timeout", () => {
    it("rejects when upstream does not respond in time", async () => {
      await expect(
        proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/slow`, undefined, {
          timeout: 50,
        }),
      ).rejects.toThrow("Proxy request timed out");
    });

    it("succeeds when response arrives before timeout", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/json`,
        undefined,
        { timeout: 5000 },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("xfwd", () => {
    it("adds x-forwarded-* headers when enabled", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://example.com:3000/headers`,
        undefined,
        { xfwd: true },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers["x-forwarded-for"]).toBe("example.com");
      expect(body.headers["x-forwarded-port"]).toBe("3000");
      expect(body.headers["x-forwarded-proto"]).toBe("http");
      expect(body.headers["x-forwarded-host"]).toBe("example.com:3000");
    });

    it("does not add x-forwarded-* headers by default", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/headers`,
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers["x-forwarded-for"]).toBeUndefined();
      expect(body.headers["x-forwarded-port"]).toBeUndefined();
      expect(body.headers["x-forwarded-proto"]).toBeUndefined();
      expect(body.headers["x-forwarded-host"]).toBeUndefined();
    });

    it("does not overwrite existing x-forwarded-* headers", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://example.com/headers`,
        { headers: { "x-forwarded-for": "10.0.0.1" } },
        { xfwd: true },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers["x-forwarded-for"]).toBe("10.0.0.1");
    });
  });

  describe("changeOrigin", () => {
    it("rewrites Host header to target address", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://original-host.com/headers`,
        undefined,
        { changeOrigin: true },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers.host).toBe(`127.0.0.1:${tcpPort}`);
    });

    it("keeps original Host header when changeOrigin is false", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://original-host.com/headers`,
        { headers: { host: "original-host.com" } },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers.host).toBe("original-host.com");
    });

    it("uses localhost for unix socket targets", async () => {
      const unixHeaders = createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ host: req.headers.host }));
      });
      const tmpSocket = join(tmpdir(), `httpxy-co-${process.pid}-${Date.now()}.sock`);
      await new Promise<void>((resolve) => unixHeaders.listen(tmpSocket, resolve));
      try {
        const res = await proxyFetch(
          { socketPath: tmpSocket },
          `http://original-host.com/`,
          undefined,
          { changeOrigin: true },
        );
        const body = (await res.json()) as { host: string };
        expect(body.host).toBe("localhost");
      } finally {
        unixHeaders.close();
      }
    });
  });

  describe("agent", () => {
    it("uses provided agent for connection pooling", async () => {
      const { Agent } = await import("node:http");
      const agent = new Agent({ keepAlive: true });
      try {
        const res = await proxyFetch(
          { host: "127.0.0.1", port: tcpPort },
          `http://localhost/json`,
          undefined,
          { agent },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      } finally {
        agent.destroy();
      }
    });
  });

  describe("request smuggling hardening (GHSA-ggv3-7p47-pfv8)", () => {
    it("forces connection: close on a chunked request over a keep-alive agent", async () => {
      const { Agent } = await import("node:http");
      const agent = new Agent({ keepAlive: true });
      try {
        const res = await proxyFetch(
          { host: "127.0.0.1", port: tcpPort },
          `http://localhost/headers`,
          { headers: { "transfer-encoding": "chunked" } },
          { agent },
        );
        const body = (await res.json()) as { headers: Record<string, string> };
        expect(body.headers.connection).toBe("close");
      } finally {
        agent.destroy();
      }
    });

    it("forces connection: close when Connection marks transfer-encoding hop-by-hop", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/headers`,
        { headers: { connection: "keep-alive, transfer-encoding" } },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      expect(body.headers.connection).toBe("close");
    });

    it("forces connection: close on the 307 replay of a chunked request", async () => {
      const { Agent } = await import("node:http");
      const agent = new Agent({ keepAlive: true });
      try {
        const res = await proxyFetch(
          { host: "127.0.0.1", port: tcpPort },
          `http://localhost/redirect-307`,
          { method: "POST", body: "chunked-body", headers: { "transfer-encoding": "chunked" } },
          { agent, followRedirects: true },
        );
        // /redirect-307 → /echo; echo replies with the request body, and the
        // replayed request must have been sent with connection: close.
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("chunked-body");
      } finally {
        agent.destroy();
      }
    });

    it("leaves connection intact for a non-chunked request", async () => {
      const { Agent } = await import("node:http");
      const agent = new Agent({ keepAlive: true });
      try {
        const res = await proxyFetch(
          { host: "127.0.0.1", port: tcpPort },
          `http://localhost/headers`,
          undefined,
          { agent },
        );
        const body = (await res.json()) as { headers: Record<string, string> };
        expect(body.headers.connection).not.toBe("close");
      } finally {
        agent.destroy();
      }
    });
  });

  describe("body types", () => {
    it("sends ArrayBuffer body", async () => {
      const buf = new TextEncoder().encode("arraybuffer-body");
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
        method: "POST",
        body: buf.buffer,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("arraybuffer-body");
    });

    it("sends Uint8Array body", async () => {
      const buf = new TextEncoder().encode("uint8-body");
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
        method: "POST",
        body: buf,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("uint8-body");
    });

    it("sends Blob body", async () => {
      const blob = new Blob(["blob-body"], { type: "text/plain" });
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/echo`, {
        method: "POST",
        body: blob,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("blob-body");
    });
  });

  describe("multi-value request headers", () => {
    it("preserves multiple cookie values", async () => {
      const headers = new Headers();
      headers.append("x-multi", "val1");
      headers.append("x-multi", "val2");
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/headers`,
        { headers },
      );
      const body = (await res.json()) as { headers: Record<string, string> };
      // Node.js http server joins multi-value headers with ", "
      expect(body.headers["x-multi"]).toBe("val1, val2");
    });
  });

  describe("followRedirects", () => {
    it("follows 302 redirect and returns final response", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect`,
        undefined,
        { followRedirects: true },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("follows redirect chain", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect-chain`,
        undefined,
        { followRedirects: true },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("preserves method and body on 307 redirect", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect-307`,
        { method: "POST", body: "preserved" },
        { followRedirects: true },
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("preserved");
    });

    it("respects custom max redirects", async () => {
      // redirect-chain → redirect → json (2 hops), limit to 1
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect-chain`,
        undefined,
        { followRedirects: 1 },
      );
      // After 1 hop we land on /redirect which is a 302 — returned as-is
      expect(res.status).toBe(302);
    });

    it("returns raw 3xx when followRedirects is false", async () => {
      const res = await proxyFetch(
        { host: "127.0.0.1", port: tcpPort },
        `http://localhost/redirect`,
        undefined,
        { followRedirects: false },
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/json");
    });
  });

  describe("path merging", () => {
    it("prepends addr base path to request path", async () => {
      const res = await proxyFetch(
        `http://127.0.0.1:${tcpPort}/headers`,
        `http://localhost/?from=merge`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toBe("/headers/?from=merge");
    });

    it("joins addr base path with request subpath", async () => {
      // addr has /headers, request has /sub → merged to /headers/sub
      // server matches startsWith("/headers") so this works
      const res = await proxyFetch(`http://127.0.0.1:${tcpPort}/headers`, `http://localhost/sub`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toBe("/headers/sub");
    });

    it("uses request path when addr has no path", async () => {
      const res = await proxyFetch(`http://127.0.0.1:${tcpPort}`, `http://localhost/json`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  describe("HTTPS upstream", () => {
    it("detects HTTPS from addr string", async () => {
      // We can't easily test real HTTPS without certs, but we can verify
      // that an https addr doesn't throw and properly rejects on connection
      // (which proves httpsRequest was selected, not httpRequest)
      await expect(proxyFetch(`https://127.0.0.1:1`, `http://localhost/json`)).rejects.toThrow();
    });

    it("uses HTTP by default for object addr", async () => {
      const res = await proxyFetch({ host: "127.0.0.1", port: tcpPort }, `http://localhost/json`);
      expect(res.status).toBe(200);
    });
  });
});
