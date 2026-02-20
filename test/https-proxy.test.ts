import { describe, it, expect } from "vitest";
import * as httpProxy from "../src/index.ts";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-https-proxy-test.js

export function listenOn(server: http.Server | https.Server | net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export function proxyListen(
  proxy: ReturnType<typeof httpProxy.createProxyServer>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    proxy.listen(0, "127.0.0.1");
    const server = (proxy as any)._server as net.Server;
    server.once("error", reject);
    server.once("listening", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe("lib/http-proxy.js", () => {
  describe("HTTPS #createProxyServer", () => {
    describe("HTTPS to HTTP", () => {
      it("should proxy the request en send back the response", async () => {
        const { promise, resolve } = Promise.withResolvers<void>();

        const source = http.createServer(function (req, res) {
          expect(req.method).to.eql("GET");
          expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + sourcePort);
        });
        const sourcePort = await listenOn(source);

        const proxy = httpProxy.createProxyServer({
          target: "http://127.0.0.1:" + sourcePort,
          ssl: {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
        });
        const proxyPort = await proxyListen(proxy);

        https
          .request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
                expect(data.toString()).to.eql("Hello from " + sourcePort);
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

    describe("HTTP to HTTPS", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const source = https.createServer(
          {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
          function (req, res) {
            expect(req.method).to.eql("GET");
            expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello from " + sourcePort);
          },
        );
        const sourcePort = await listenOn(source);

        const proxy = httpProxy.createProxyServer({
          target: "https://127.0.0.1:" + sourcePort,
          // Allow to use SSL self signed
          secure: false,
        });
        const proxyPort = await proxyListen(proxy);

        http
          .request(
            {
              hostname: "127.0.0.1",
              port: proxyPort,
              method: "GET",
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
                expect(data.toString()).to.eql("Hello from " + sourcePort);
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

    describe("HTTPS to HTTPS", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const source = https.createServer(
          {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
          function (req, res) {
            expect(req.method).to.eql("GET");
            expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
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
            ciphers: "AES128-GCM-SHA256",
          },
          secure: false,
        });
        const proxyPort = await proxyListen(proxy);

        https
          .request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
                expect(data.toString()).to.eql("Hello from " + sourcePort);
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

    describe("HTTPS not allow SSL self signed", () => {
      it("should fail with error", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const source = https.createServer({
          key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
          cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
          ciphers: "AES128-GCM-SHA256",
        });
        const sourcePort = await listenOn(source);

        const proxy = httpProxy.createProxyServer({
          target: "https://127.0.0.1:" + sourcePort,
          secure: true,
        });
        const proxyPort = await proxyListen(proxy);

        proxy.on("error", function (err) {
          expect(err).toBeInstanceOf(Error);
          expect(err.toString()).toMatch(
            /unable to verify the first certificate|DEPTH_ZERO_SELF_SIGNED_CERT/,
          );
          source.close();
          proxy.close();
          resolve();
        });

        http
          .request({
            hostname: "127.0.0.1",
            port: proxyPort,
            method: "GET",
          })
          .end();

        await promise;
      });
    });

    describe("HTTPS to HTTP using own server", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const source = http.createServer(function (req, res) {
          expect(req.method).to.eql("GET");
          expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(proxyPort);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + sourcePort);
        });
        const sourcePort = await listenOn(source);

        const proxy = httpProxy.createProxyServer({
          agent: new http.Agent({ maxSockets: 2 }),
        });

        const ownServer = https.createServer(
          {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
          function (req, res) {
            proxy.web(req, res, {
              target: "http://127.0.0.1:" + sourcePort,
            });
          },
        );
        const proxyPort = await listenOn(ownServer);

        https
          .request(
            {
              host: "127.0.0.1",
              port: proxyPort,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
                expect(data.toString()).to.eql("Hello from " + sourcePort);
              });

              res.on("end", () => {
                source.close();
                ownServer.close();
                resolve();
              });
            },
          )
          .end();

        await promise;
      });
    });
  });
});
