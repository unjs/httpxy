import { describe, it, expect } from "vitest";

import * as webPasses from "../../src/middleware/web-incoming.ts";
import * as httpProxy from "../../src/index.ts";
import concat from "concat-stream";
import async from "async";
import url from "node:url";
import http from "node:http";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-passes-web-incoming-test.js

describe("middleware:web-incoming", () => {
  describe("#deleteLength", () => {
    it("should change `content-length` for DELETE requests", () => {
      const stubRequest = {
        method: "DELETE",
        headers: {} as any,
      };
      webPasses.deleteLength(stubRequest as any, {} as any, {} as any, {} as any);
      expect(stubRequest.headers["content-length"]).to.eql("0");
    });

    it("should change `content-length` for OPTIONS requests", () => {
      const stubRequest = {
        method: "OPTIONS",
        headers: {} as any,
      };
      webPasses.deleteLength(stubRequest as any, {} as any, {} as any, {} as any);
      expect(stubRequest.headers["content-length"]).to.eql("0");
    });

    it("should remove `transfer-encoding` from empty DELETE requests", () => {
      const stubRequest = {
        method: "DELETE",
        headers: {
          "transfer-encoding": "chunked",
        } as any,
      };
      webPasses.deleteLength(stubRequest as any, {} as any, {} as any, {} as any);
      expect(stubRequest.headers["content-length"]).to.eql("0");
      expect(stubRequest.headers).to.not.have.key("transfer-encoding");
    });
  });

  describe("#timeout", () => {
    it("should set timeout on the socket", () => {
      let done = false;
      const stubRequest = {
        socket: {
          setTimeout: function (value: any) {
            done = value;
          },
        },
      };

      webPasses.timeout(stubRequest as any, {} as any, { timeout: 5000 } as any, {} as any);
      expect(done).to.eql(5000);
    });
  });

  describe("#XHeaders", () => {
    const stubRequest = {
      connection: {
        remoteAddress: "192.168.1.2",
        remotePort: "8080",
      },
      headers: {
        host: "192.168.1.2:8080",
      } as any,
    };

    it("set the correct x-forwarded-* headers", () => {
      webPasses.XHeaders(stubRequest as any, {} as any, { xfwd: true } as any, {} as any);
      expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.2");
      expect(stubRequest.headers["x-forwarded-port"]).toBe("8080");
      expect(stubRequest.headers["x-forwarded-proto"]).toBe("http");
    });
  });
});

describe("#stream middleware direct tests", () => {
  it("should emit error on server when callback is not provided", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();

    const EventEmitter = (await import("node:events")).EventEmitter;
    const server = Object.assign(new EventEmitter(), {
      _webPasses: [],
      _wsPasses: [],
    }) as any;

    server.on("error", (err: Error) => {
      expect(err).toBeInstanceOf(Error);
      resolve();
    });

    // Call stream directly without callback (6th arg)
    const stubReq = Object.assign(new (await import("node:stream")).PassThrough(), {
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1" },
      connection: { remoteAddress: "127.0.0.1" },
      socket: { remoteAddress: "127.0.0.1", destroyed: false },
    });
    const stubRes = Object.assign(new (await import("node:stream")).PassThrough(), {
      headersSent: false,
      finished: false,
      setHeader: () => {},
      writeHead: () => {},
      statusCode: 200,
    });

    webPasses.stream(
      stubReq as any,
      stubRes as any,
      { target: new URL(`http://127.0.0.1:54322`), forward: undefined as any } as any,
      server as any,
      undefined,
      // No callback - this will trigger line 131
      undefined,
    );

    await promise;
  });

  it("should emit end event when res.finished is true", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const source = http.createServer((_req, res) => {
      res.end("done");
    });
    await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
    const sourcePort = (source.address() as any).port;

    const proxy = httpProxy.createProxyServer({
      target: `http://127.0.0.1:${sourcePort}`,
      selfHandleResponse: true,
    });

    const proxyServer = http.createServer((req, res) => {
      proxy.once("proxyRes", (_proxyRes, _pReq, pRes) => {
        // End the response before proxyRes piping would happen
        pRes.end("early-end");
      });

      proxy.once("end", () => {
        source.close();
        proxyServer.close();
        resolve();
      });

      proxy.web(req, res);
    });

    await new Promise<void>((r) => proxyServer.listen(0, "127.0.0.1", r));
    const proxyPort = (proxyServer.address() as any).port;

    http.request(`http://127.0.0.1:${proxyPort}/`, () => {}).end();
    await promise;
  });
});

describe("#createProxyServer.web() using own http server", () => {
  it("should proxy the request using the web proxy handler", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      source.close();
      proxyServer.close();
      expect(req.method).to.eql("GET");
      expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(8081);
      resolve();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    http.request("http://localhost:8081", () => {}).end();

    await promise;
  });

  it("should detect a proxyReq event and modify headers", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
    });

    proxy.on("proxyReq", function (proxyReq, req, res, options) {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      source.close();
      proxyServer.close();
      expect(req.headers["x-special-proxy-header"]).to.eql("foobar");
      resolve();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    http.request("http://localhost:8081", () => {}).end();
    await promise;
  });

  it('should skip proxyReq event when handling a request with header "expect: 100-continue" [https://www.npmjs.com/advisories/1486]', async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
    });

    proxy.on("proxyReq", function (proxyReq, req, res, options) {
      proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      source.close();
      proxyServer.close();
      expect(req.headers["x-special-proxy-header"]).to.not.eql("foobar");
      resolve();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    const postData = "".padStart(1025, "x");

    const postOptions = {
      hostname: "localhost",
      port: 8081,
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        expect: "100-continue",
      },
    };

    const req = http.request(postOptions, () => {});
    req.write(postData);
    req.end();

    await promise;
  });

  it("should proxy the request and handle error via callback", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
    });

    const proxyServer = http.createServer(requestHandler);

    async function requestHandler(req: any, res: any) {
      const proxyRes = await proxy.web(req, res).catch((error_) => error_);
      proxyServer.close();
      resolve();
      expect(proxyRes).toBeInstanceOf(Error);
      expect((proxyRes as any).code).toBe("ECONNREFUSED");
    }

    proxyServer.listen("8082");

    http
      .request(
        {
          hostname: "localhost",
          port: "8082",
          method: "GET",
        },
        () => {},
      )
      .end();
    await promise;
  });

  it("should proxy the request and handle error via event listener", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://127.0.0.1:54320",
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req: any, res: any) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        expect(err).toBeInstanceOf(Error);
        expect(errReq).toBe(req);
        expect(errRes).toBe(res);
        expect((err as any).code).toBe("ECONNREFUSED");
        res.end();
        resolve();
      });

      proxy.web(req, res);
    }

    proxyServer.listen(0, "127.0.0.1", () => {
      const port = (proxyServer.address() as any).port;
      http.request({ hostname: "127.0.0.1", port, method: "GET" }, () => {}).end();
    });
    await promise;
  });

  it("should forward the request and handle error via event listener", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      forward: "http://127.0.0.1:54321",
    });

    const proxyServer = http.createServer(requestHandler);

    function requestHandler(req: any, res: any) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNREFUSED");
        res.end();
        resolve();
      });

      proxy.web(req, res);
    }

    proxyServer.listen(0, "127.0.0.1", () => {
      const port = (proxyServer.address() as any).port;
      http.request({ hostname: "127.0.0.1", port, method: "GET" }, () => {}).end();
    });
    await promise;
  });

  it("should proxy the request and handle timeout error (proxyTimeout)", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const net = await import("node:net");

    // Create a TCP server that accepts but never responds
    const blackhole = net.createServer((_socket) => {});

    await new Promise<void>((r) => blackhole.listen(0, "127.0.0.1", r));
    const blackholePort = (blackhole.address() as any).port;

    const proxy = httpProxy.createProxyServer({
      target: `http://127.0.0.1:${blackholePort}`,
      proxyTimeout: 100,
    });

    const proxyServer = http.createServer(requestHandler);

    const started = Date.now();
    function requestHandler(req: any, res: any) {
      proxy.once("error", function (err, errReq, errRes) {
        proxyServer.close();
        blackhole.close();
        expect(err).toBeInstanceOf(Error);
        expect(errReq).toBe(req);
        expect(errRes).toBe(res);
        expect(Date.now() - started).toBeGreaterThan(99);
        expect((err as any).code).toBe("ECONNRESET");
        res.end();
        resolve();
      });

      proxy.web(req, res);
    }

    proxyServer.listen(0, "127.0.0.1", () => {
      const port = (proxyServer.address() as any).port;
      http.request({ hostname: "127.0.0.1", port, method: "GET" }, () => {}).end();
    });
    await promise;
  });

  // Note: req.on("aborted") no longer fires reliably on Node.js v18+
  it.todo("should proxy the request and handle timeout error");

  it("should proxy the request and provide a proxyRes event with the request and response parameters", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
    });

    function requestHandler(req: any, res: any) {
      proxy.once("proxyRes", function (proxyRes, pReq, pRes) {
        source.close();
        proxyServer.close();
        expect(pReq).toBe(req);
        expect(pRes).toBe(res);
        resolve();
      });

      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      res.end("Response");
    });

    proxyServer.listen("8086");
    source.listen("8080");
    http.request("http://localhost:8086", () => {}).end();
    await promise;
  });

  it("should proxy the request and provide and respond to manual user response when using modifyResponse", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
      selfHandleResponse: true,
    });

    function requestHandler(req: any, res: any) {
      proxy.once("proxyRes", function (proxyRes, pReq, pRes) {
        proxyRes.pipe(
          concat(function (body) {
            expect(body.toString("utf8")).eql("Response");
            pRes.end(Buffer.from("my-custom-response"));
          }),
        );
      });

      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      res.end("Response");
    });

    async.parallel(
      [(next) => proxyServer.listen(8086, next), (next) => source.listen(8080, next)],
      function (err) {
        http
          .get("http://localhost:8086", function (res) {
            res.pipe(
              concat(function (body) {
                expect(body.toString("utf8")).eql("my-custom-response");
                source.close();
                proxyServer.close();
                resolve();
              }),
            );
          })
          .once("error", resolve);
      },
    );
    await promise;
  });

  it("should proxy the request and handle changeOrigin option", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
      changeOrigin: true,
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      source.close();
      proxyServer.close();
      expect(req.method).to.eql("GET");
      expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(8080);
      resolve();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    http.request("http://localhost:8081", () => {}).end();
    await promise;
  });

  it("should proxy the request with the Authorization header set", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
      auth: "user:pass",
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      source.close();
      proxyServer.close();
      const auth = Buffer.from(req.headers.authorization.split(" ")[1], "base64");
      expect(req.method).to.eql("GET");
      expect(auth.toString()).to.eql("user:pass");
      resolve();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    http.request("http://localhost:8081", () => {}).end();
    await promise;
  });

  it("should proxy requests to multiple servers with different options", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer();

    // proxies to two servers depending on url, rewriting the url as well
    // http://localhost:8080/s1/ -> http://localhost:8081/
    // http://localhost:8080/ -> http://localhost:8082/
    function requestHandler(req: any, res: any) {
      if (req.url.indexOf("/s1/") === 0) {
        proxy.web(req, res, {
          ignorePath: true,
          target: "http://localhost:8081" + req.url.slice(3),
        });
      } else {
        proxy.web(req, res, {
          target: "http://localhost:8082",
        });
      }
    }

    const proxyServer = http.createServer(requestHandler);

    const source1 = http.createServer(function (req: any, res: any) {
      expect(req.method).to.eql("GET");
      expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(8080);
      expect(req.url).to.eql("/test1");
    });

    const source2 = http.createServer(function (req: any, res: any) {
      source1.close();
      source2.close();
      proxyServer.close();
      expect(req.method).to.eql("GET");
      expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(8080);
      expect(req.url).to.eql("/test2");
      resolve();
    });

    proxyServer.listen("8080");
    source1.listen("8081");
    source2.listen("8082");

    http.request("http://localhost:8080/s1/test1", () => {}).end();
    http.request("http://localhost:8080/test2", () => {}).end();
    await promise;
  });
});

describe.todo("#followRedirects", () => {
  it("should proxy the request follow redirects", async () => {
    const { resolve, promise } = Promise.withResolvers<void>();
    const proxy = httpProxy.createProxyServer({
      target: "http://localhost:8080",
      // followRedirects: true,
    });

    function requestHandler(req: any, res: any) {
      proxy.web(req, res);
    }

    const proxyServer = http.createServer(requestHandler);

    const source = http.createServer(function (req: any, res: any) {
      if (url.parse(req.url).pathname === "/redirect") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }

      res.writeHead(301, { Location: "/redirect" });
      res.end();
    });

    proxyServer.listen("8081");
    source.listen("8080");

    http
      .request("http://localhost:8081", function (res) {
        source.close();
        proxyServer.close();
        expect(res.statusCode).to.eql(200);
        resolve();
      })
      .end();
    await promise;
  });
});
