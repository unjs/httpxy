import * as http from "node:http";
import * as https from "node:https";
import * as httpProxy from "../src";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { Agent, fetch } from "undici";

let initialPort = 4096;
const getPort = () => initialPort++;

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
  describe("http2 -> http", () => {
    const httpPort = getPort();
    const proxyPort = getPort();

    const source = http
      .createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("hello httpxy\n");
        res.end();
      })
      .listen(httpPort);

    const proxy = httpProxy
      .createProxyServer({
        target: {
          host: "localhost",
          port: httpPort,
        },
        ssl: {
          key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
          cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
        },
        http2: true,
        // Allow to use SSL self signed
        secure: false,
      })
      .listen(proxyPort);

    it("target http server should be working", async () => {
      const r = await (
        await fetch(`http://localhost:${httpPort}`, { dispatcher: http1Agent })
      ).text();
      expect(r).toContain("hello httpxy");
    });

    it("fetch proxy server over http1", async () => {
      const r = await (
        await fetch(`https://localhost:${proxyPort}`, { dispatcher: http1Agent })
      ).text();
      expect(r).toContain("hello httpxy");
    });

    it("fetch proxy server over http2", async () => {
      const resp = await fetch(`https://localhost:${proxyPort}`, { dispatcher: http2Agent });
      const r = await resp.text();
      expect(r).toContain("hello httpxy");
    });

    afterAll(async () => {
      // cleans up
      await new Promise<void>((resolve) => proxy.close(resolve));
      source.close();
    });
  });

  // TODO: fix this test
  describe.skip("http2 -> https", () => {
    const httpsPort = getPort();
    const proxyPort = getPort();

    const source = https
      .createServer(
        {
          key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
          cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
        },
        function (req, res) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("hello httpxy");
        },
      )
      .listen(httpsPort);

    const proxy = httpProxy
      .createProxyServer({
        target: {
          host: "localhost",
          port: httpsPort,
        },
        ssl: {
          key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
          cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
        },
        http2: true,
        // Allow to use SSL self signed
        secure: false,
      })
      .listen(proxyPort);

    it("target https server should be working", async () => {
      const r = await (
        await fetch(`https://localhost:${httpsPort}`, { dispatcher: http1Agent })
      ).text();
      expect(r).toContain("hello httpxy");
    });

    it("fetch proxy server over http1", async () => {
      const r = await (
        await fetch(`https://localhost:${proxyPort}`, { dispatcher: http1Agent })
      ).text();
      expect(r).toContain("hello httpxy");
    });

    it("fetch proxy server over http2", async () => {
      const resp = await fetch(`https://localhost:${proxyPort}`, { dispatcher: http2Agent });
      const r = await resp.text();
      expect(r).toContain("hello httpxy");
    });

    afterAll(async () => {
      // cleans up
      await new Promise<void>((resolve) => proxy.close(resolve));
      source.close();
    });
  });
});
