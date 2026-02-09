import { describe, it, expect } from "vitest";
import * as httpProxy from "../src/index.ts";
import http from "node:http";
import net from "node:net";
import * as ws from "ws";
import * as io from "socket.io";
import SSE from "sse";
import ioClient from "socket.io-client";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-test.js

let initialPort = 1024;
const getPort = () => initialPort++;

describe("http-proxy", () => {
  describe("#createProxyServer", () => {
    it.skip("should throw without options", () => {
      let error;
      try {
        httpProxy.createProxyServer();
      } catch (error_) {
        error = error_;
      }

      expect(error).to.toBeInstanceOf(Error);
    });

    it("should return an object otherwise", () => {
      const obj = httpProxy.createProxyServer({
        target: "http://www.google.com:80",
      });

      expect(obj.web).to.toBeInstanceOf(Function);
      expect(obj.ws).to.instanceOf(Function);
      expect(obj.listen).to.instanceOf(Function);
    });
  });

  describe("#createProxyServer with forward options and using web-incoming passes", () => {
    it("should pipe the request using web-incoming#stream method", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy
        .createProxyServer({
          forward: "http://localhost:" + ports.source,
        })
        .listen(ports.proxy, "localhost");

      const { promise, resolve } = Promise.withResolvers<void>();
      const source = http.createServer((req, res) => {
        expect(req.method).to.eql("GET");
        expect(Number.parseInt(req.headers.host!.split(":")[1])).toBe(ports.proxy);
        source.close();
        proxy.close(resolve);
      });

      source.listen(ports.source);
      http.request("http://localhost:" + ports.proxy, () => {}).end();

      await promise;
    });
  });

  describe("#createProxyServer using the web-incoming passes", () => {
    it("should proxy sse", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "http://localhost:" + ports.source,
      });
      const _proxyServer = proxy.listen(ports.proxy, "localhost");
      const source = http.createServer();
      const sse = new SSE(source, { path: "/" });
      sse.on("connection", (client) => {
        client.send("Hello over SSE");
        client.close();
      });

      source.listen(ports.source);

      const options = {
        hostname: "localhost",
        port: ports.proxy,
      };

      const { promise, resolve } = Promise.withResolvers<void>();
      const req = http
        .request(options, (res) => {
          let streamData = "";
          res.on("data", (chunk) => {
            streamData += chunk.toString("utf8");
          });
          res.on("end", () => {
            expect(streamData).to.equal(":ok\n\ndata: Hello over SSE\n\n");
            source.close();
            proxy.close(resolve);
          });
        })
        .end();

      await promise;
    });

    it("should make the request on pipe and finish it", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy
        .createProxyServer({
          target: "http://localhost:" + ports.source,
        })
        .listen(ports.proxy, "localhost");

      const { promise, resolve } = Promise.withResolvers<void>();
      const source = http.createServer((req, res) => {
        expect(req.method).to.eql("POST");
        expect(req.headers["x-forwarded-for"]).to.eql("localhost");
        expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(ports.proxy);
        source.close();
        proxy.close(() => {});
        resolve();
      });

      source.listen(ports.source);

      http
        .request(
          {
            hostname: "localhost",
            port: ports.proxy + "",
            method: "POST",
            headers: {
              "x-forwarded-for": "localhost",
            },
          },
          () => {},
        )
        .end();

      await promise;
    });
  });

  describe("#createProxyServer using the web-incoming passes", () => {
    it("should make the request, handle response and finish it", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy
        .createProxyServer({
          target: "http://localhost:" + ports.source,
          preserveHeaderKeyCase: true,
        })
        .listen(ports.proxy, "localhost");

      const source = http.createServer((req, res) => {
        expect(req.method).to.eql("GET");
        expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(ports.proxy);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Hello from " + (source.address()! as any).port);
      });

      source.listen(ports.source);

      const { promise, resolve } = Promise.withResolvers<void>();
      http
        .request(
          {
            hostname: "localhost",
            port: ports.proxy,
            method: "GET",
          },
          (res) => {
            expect(res.statusCode).to.eql(200);
            expect(res.headers["content-type"]).to.eql("text/plain");
            if (res.rawHeaders != undefined) {
              expect(res.rawHeaders.indexOf("Content-Type")).not.to.eql(-1);
              expect(res.rawHeaders.indexOf("text/plain")).not.to.eql(-1);
            }

            res.on("data", (data) => {
              expect(data.toString()).to.eql("Hello from " + ports.source);
            });

            res.on("end", () => {
              source.close();
              proxy.close(resolve);
            });
          },
        )
        .end();
      await promise;
    });
  });

  describe.todo("#createProxyServer() method with error response", () => {
    it("should make the request and emit the error event", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "http://localhost:" + ports.source,
      });

      const { promise, resolve } = Promise.withResolvers<void>();
      proxy.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe("ECONNREFUSED");
        proxy.close(() => {});
        resolve();
      });

      proxy.listen(ports.proxy, "localhost");

      http
        .request(
          {
            hostname: "localhost",
            port: ports.proxy,
            method: "GET",
          },
          () => {},
        )
        .end();

      await promise.catch(() => {});
    });
  });

  describe.todo("#createProxyServer setting the correct timeout value", () => {
    it("should hang up the socket at the timeout", async () => {
      this.timeout(30);
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy
        .createProxyServer({
          target: "http://localhost:" + ports.source,
          timeout: 3,
        })
        .listen(ports.proxy);

      proxy.on("error", (e) => {
        expect(e).toBe.an(Error);
        expect(e.code).toBe.eql("ECONNRESET");
      });

      const source = http.createServer(function (req, res) {
        setTimeout(() => {
          res.end("At this point the socket should be closed");
        }, 5);
      });

      source.listen(ports.source);

      const testReq = http.request(
        {
          hostname: "localhost",
          port: ports.proxy,
          method: "GET",
        },
        () => {},
      );

      testReq.on("error", (e) => {
        expect(e).toBe.an(Error);
        expect(e.code).toBe.eql("ECONNRESET");
        proxy.close();
        source.close();
        done();
      });

      testReq.end();
    });
  });

  describe.todo("#createProxyServer with xfwd option", () => {
    it("should not throw on empty http host header", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy
        .createProxyServer({
          forward: "http://localhost:" + ports.source,
          xfwd: true,
        })
        .listen(ports.proxy, "localhost");

      const { promise, resolve } = Promise.withResolvers<void>();
      const source = http.createServer(function (req, res) {
        expect(req.method).to.eql("GET");
        expect(Number.parseInt(req.headers.host!.split(":")[1])).to.eql(ports.source);
        source.close();
        proxy.close(resolve);
      });

      source.listen(ports.source);

      const socket = net.connect({ port: ports.proxy }, () => {
        socket.write("GET / HTTP/1.0\r\n\r\n");
      });

      // handle errors
      socket.on("error", () => {
        expect.fail("Unexpected socket error");
      });

      socket.on("data", (data) => {
        socket.end();
      });

      // socket.on("end", () => {
      //   expect("Socket to finish").to.eql("Socket to finish");
      // });
      http.request("http://localhost:" + ports.proxy, () => {}).end();
      await promise;
    });
  });

  // describe('#createProxyServer using the web-incoming passes', () =>  {
  //   it('should emit events correctly', function(done) {
  //     var proxy = httpProxy.createProxyServer({
  //       target: 'http://localhost:8080'
  //     }),

  //     proxyServer = proxy.listen('8081'),

  //     source = http.createServer(function(req, res) {
  //       expect(req.method).to.eql('GET');
  //       expect(req.headers.host.split(':')[1]).to.eql('8081');
  //       res.writeHead(200, {'Content-Type': 'text/plain'})
  //       res.end('Hello from ' + source.address().port);
  //     }),

  //     events = [];

  //     source.listen('8080');

  //     proxy.ee.on('http-proxy:**', function (uno, dos, tres) {
  //       events.push(this.event);
  //     })

  //     http.request({
  //       hostname: 'localhost',
  //       port: '8081',
  //       method: 'GET',
  //     }, function(res) {
  //       expect(res.statusCode).to.eql(200);

  //       res.on('data', (data) => {
  //         expect(data.toString()).to.eql('Hello from 8080');
  //       });

  //       res.on('end', () =>  {
  //         expect(events).to.contain('http-proxy:outgoing:web:begin');
  //         expect(events).to.contain('http-proxy:outgoing:web:end');
  //         source.close();
  //         proxyServer.close();
  //         done();
  //       });
  //     }).end();
  //   });
  // });

  describe("#createProxyServer using the ws-incoming passes", () => {
    it("should proxy the websockets stream", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });
      const proxyServer = proxy.listen(ports.proxy, "localhost");

      const { promise, resolve } = Promise.withResolvers<void>();
      const destiny = new ws.WebSocketServer({ port: ports.source }, () => {
        const client = new ws.WebSocket("ws://localhost:" + ports.proxy);

        client.on("open", () => {
          client.send("hello there");
        });

        client.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe("Hello over websockets");
          client.close();
          destiny.close();
          proxyServer.close(resolve);
        });
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe("hello there");
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it.todo("should emit error on proxy error", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const { promise, resolve } = Promise.withResolvers<void>();
      const proxy = httpProxy.createProxyServer({
          // Note: we don't ever listen on this port
          target: "ws://localhost:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        client = new ws.WebSocket("ws://localhost:" + ports.proxy);

      client.on("open", () => {
        client.send("hello there");
      });

      let count = 0;
      function maybe_done() {
        count += 1;
        if (count === 2) resolve();
      }

      client.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNRESET");
        maybe_done();
      });

      proxy.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe("ECONNREFUSED");
        proxyServer.close(() => {});
        maybe_done();
      });
      await promise;
    });

    it("should close client socket if upstream is closed before upgrade", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();
      const ports = { source: getPort(), proxy: getPort() };
      const server = http.createServer();
      server.on("upgrade", function (req, socket, head) {
        const response = ["HTTP/1.1 404 Not Found", "Content-type: text/html", "", ""];
        socket.write(response.join("\r\n"));
        socket.end();
      });
      server.listen(ports.source);

      const proxy = httpProxy.createProxyServer({
          // note: we don't ever listen on this port
          target: "ws://localhost:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        client = new ws.WebSocket("ws://localhost:" + ports.proxy);

      client.on("open", () => {
        client.send("hello there");
      });

      client.on("error", (err) => {
        expect(err).toBeInstanceOf(Error);
        proxyServer.close(resolve);
      });

      await promise;
    });

    it.todo("should proxy a socket.io stream", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();
      const ports = { source: getPort(), proxy: getPort() },
        proxy = httpProxy.createProxyServer({
          target: "ws://localhost:" + ports.source,
          ws: true,
        }),
        proxyServer = proxy.listen(ports.proxy),
        server = http.createServer(),
        destiny = new io.Server(server);

      function startSocketIo() {
        const client = ioClient("ws://localhost:" + ports.proxy);
        client.on("connect", () => {
          client.emit("incoming", "hello there");
        });

        client.on("outgoing", (data: any) => {
          expect(data).toBe("Hello over websockets");
          server.close();
          proxyServer.close(resolve);
        });
      }
      server.listen(ports.source);
      server.on("listening", startSocketIo);

      destiny.sockets.on("connection", (socket) => {
        socket.on("incoming", (msg) => {
          expect(msg.toString("utf8")).toBe("hello there");
          socket.emit("outgoing", "Hello over websockets");
        });
      });

      await promise;
    });

    it.todo("should emit open and close events when socket.io client connects and disconnects", async () => {
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });
      const proxyServer = proxy.listen(ports.proxy);
      const server = http.createServer();
      const destiny = io.Server.listen(server);

      function startSocketIo() {
        const client = ioClient("ws://localhost:" + ports.proxy, {
          rejectUnauthorized: undefined,
        });
        client.on("connect", () => {
          client.disconnect();
        });
      }
      let count = 0;

      proxyServer.on("open", () => {
        count += 1;
      });

      proxyServer.on("close", () => {
        proxyServer.close();
        server.close();
        destiny.close();
        if (count == 1) {
          done();
        }
      });

      server.listen(ports.source);
      server.on("listening", startSocketIo);
    });

    it.todo("should pass all set-cookie headers to client", async () => {
      const { resolve, promise } = Promise.withResolvers<void>();
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });
      const proxyServer = proxy.listen(ports.proxy);
      const destiny = new ws.WebSocketServer({ port: ports.source }, () => {
        const key = Buffer.from(Math.random().toString()).toString("base64");

        const requestOptions = {
          port: ports.proxy,
          host: "localhost",
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            Host: "ws://localhost",
            "Sec-WebSocket-Version": 13,
            "Sec-WebSocket-Key": key,
          },
        };

        const req = http.request(requestOptions);

        req.on("upgrade", function (res, socket, upgradeHead) {
          // expect(res.headers["set-cookie"].length).toBe(2);
          resolve();
        });

        req.end();
      });

      destiny.on("headers", (headers) => {
        headers.push("Set-Cookie: test1=test1", "Set-Cookie: test2=test2");
      });

      await promise;
    });

    it("should detect a proxyReq event and modify headers", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const ports = { source: getPort(), proxy: getPort() };

      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });

      proxy.on("proxyReqWs", function (proxyReq, req, socket, options, head) {
        proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
      });

      const proxyServer = proxy.listen(ports.proxy);

      const destiny = new ws.WebSocketServer({ port: ports.source }, () => {
        const client = new ws.WebSocket("ws://localhost:" + ports.proxy);

        client.on("open", () => {
          client.send("hello there");
        });

        client.on("message", (msg: any) => {
          expect(msg.toString("utf8")).toBe("Hello over websockets");
          client.close();
          destiny.close();
          proxyServer.close(resolve);
        });
      });

      destiny.on("connection", function (socket, upgradeReq) {
        expect(upgradeReq.headers["x-special-proxy-header"]).to.eql("foobar");

        socket.on("message", (msg: any) => {
          expect(msg.toString("utf8")).toBe("hello there");
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should forward frames with single frame payload (including on node 4.x)", async () => {
      const { resolve, promise } = await Promise.withResolvers<void>();
      const payload = Array.from({ length: 65_529 }).join("0");
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });
      const proxyServer = proxy.listen(ports.proxy);
      const destiny = new ws.WebSocketServer({ port: ports.source }, () => {
        const client = new ws.WebSocket("ws://localhost:" + ports.proxy);

        client.on("open", () => {
          client.send(payload);
        });

        client.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe("Hello over websockets");
          client.close();
          destiny.close();
          proxyServer.close(resolve);
        });
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe(payload);
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });

    it("should forward continuation frames with big payload (including on node 4.x)", async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const payload = Array.from({ length: 65_530 }).join("0");
      const ports = { source: getPort(), proxy: getPort() };
      const proxy = httpProxy.createProxyServer({
        target: "ws://localhost:" + ports.source,
        ws: true,
      });
      const proxyServer = proxy.listen(ports.proxy);
      const destiny = new ws.WebSocketServer({ port: ports.source }, () => {
        const client = new ws.WebSocket("ws://localhost:" + ports.proxy);

        client.on("open", () => {
          client.send(payload);
        });

        client.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe("Hello over websockets");
          client.close();
          destiny.close();
          proxyServer.close(resolve);
        });
      });

      destiny.on("connection", (socket) => {
        socket.on("message", (msg) => {
          expect(msg.toString("utf8")).toBe(payload);
          socket.send("Hello over websockets");
        });
      });

      await promise;
    });
  });
});
