import * as http from "node:http";
import * as https from "node:https";
import * as httpProxy from "../src/index.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, afterAll } from "vitest";

import { Agent, fetch } from "undici";
import { listenOn, proxyListen } from "./https-proxy.test.ts";
import { inspect } from "node:util";

const http1Agent = new Agent({
  allowH2: false,
  connect: {
    // Allow to use SSL self signed
    rejectUnauthorized: false,
  },
});
const http2Agent = new Agent({
  allowH2: true,
  connect: {
    // Allow to use SSL self signed
    rejectUnauthorized: false,
  },
});

describe("http/2 listener", () => {
  describe("http2 -> http", async () => {
    const source = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello from " + sourcePort);
    });
    const sourcePort = await listenOn(source);

    const proxy = httpProxy.createProxyServer({
      target: "http://127.0.0.1:" + sourcePort,
      ssl: {
        key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
        cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
      },
      http2: true,
      // Allow to use SSL self signed
      secure: false,
    });
    const proxyPort = await proxyListen(proxy);

    it("target http server should be working", async () => {
      try {
        const r = await (
          await fetch(`http://127.0.0.1:${sourcePort}`, { dispatcher: http1Agent })
        ).text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    it("fetch proxy server over http1", async () => {
      try {
        const r = await (
          await fetch(`https://127.0.0.1:${proxyPort}`, { dispatcher: http1Agent })
        ).text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    it("fetch proxy server over http2", async () => {
      try {
        const resp = await fetch(`https://127.0.0.1:${proxyPort}`, { dispatcher: http2Agent });
        const r = await resp.text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    afterAll(async () => {
      // cleans up
      await new Promise<void>((resolve) => proxy.close(resolve));
      source.close();
    });
  });

  describe("http2 -> https", async () => {
    const source = https.createServer(
      {
        key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
        cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
        ciphers: "AES128-GCM-SHA256",
      },
      function (req, res) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + sourcePort);
      },
    );
    const sourcePort = await listenOn(source);

    const proxy = httpProxy.createProxyServer({
      target: "https://127.0.0.1:" + sourcePort,
      ssl: {
        key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
        cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
      },
      http2: true,
      // Allow to use SSL self signed
      secure: false,
    });
    const proxyPort = await proxyListen(proxy);

    it("target https server should be working", async () => {
      try {
        const r = await (
          await fetch(`https://127.0.0.1:${sourcePort}`, { dispatcher: http1Agent })
        ).text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    it("fetch proxy server over http1", async () => {
      try {
        const r = await (
          await fetch(`https://127.0.0.1:${proxyPort}`, { dispatcher: http1Agent })
        ).text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    it("fetch proxy server over http2", async () => {
      try {
        const resp = await fetch(`https://127.0.0.1:${proxyPort}`, { dispatcher: http2Agent });
        const r = await resp.text();
        expect(r).to.eql("Hello from " + sourcePort);
      } catch (err) {
        expect.fail("Failed to fetch target server: " + inspect(err));
      }
    });

    afterAll(async () => {
      // cleans up
      await new Promise<void>((resolve) => proxy.close(resolve));
      source.close();
    });
  });
});
