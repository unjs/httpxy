import { describe, it, expect } from "vitest";
import * as httpProxy from "../src/index.ts";
import semver from "semver";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import fs from "node:fs";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-https-proxy-test.js

let initialPort = 1024;
const getPort = () => initialPort++;

describe("lib/http-proxy.js", () => {
  describe("HTTPS #createProxyServer", () => {
    describe("HTTPS to HTTP", () => {
      it("should proxy the request en send back the response", async () => {
        const { promise, resolve } = Promise.withResolvers<void>();

        const ports = { source: getPort(), proxy: getPort() };
        const source = http.createServer(function (req, res) {
          expect(req.method).to.eql("GET");
          expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(ports.proxy);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + ports.source);
        });

        source.listen(ports.source);

        const proxy = httpProxy
          .createProxyServer({
            target: "http://localhost:" + ports.source,
            ssl: {
              key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
              cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
              ciphers: "AES128-GCM-SHA256",
            },
          })
          .listen(ports.proxy);

        https
          .request(
            {
              host: "localhost",
              port: ports.proxy,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
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

    describe("HTTP to HTTPS", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();
        const ports = { source: getPort(), proxy: getPort() };
        const source = https.createServer(
          {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
          function (req, res) {
            expect(req.method).to.eql("GET");
            expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(ports.proxy);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello from " + ports.source);
          },
        );

        source.listen(ports.source);

        const proxy = httpProxy
          .createProxyServer({
            target: "https://localhost:" + ports.source,
            // Allow to use SSL self signed
            secure: false,
          })
          .listen(ports.proxy);

        http
          .request(
            {
              hostname: "localhost",
              port: ports.proxy,
              method: "GET",
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
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

    describe("HTTPS to HTTPS", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const ports = { source: getPort(), proxy: getPort() };
        const source = https.createServer(
          {
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          },
          function (req, res) {
            expect(req.method).to.eql("GET");
            expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(ports.proxy);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello from " + ports.source);
          },
        );

        source.listen(ports.source);

        const proxy = httpProxy
          .createProxyServer({
            target: "https://localhost:" + ports.source,
            ssl: {
              key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
              cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
              ciphers: "AES128-GCM-SHA256",
            },
            secure: false,
          })
          .listen(ports.proxy);

        https
          .request(
            {
              host: "localhost",
              port: ports.proxy,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
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

    describe("HTTPS not allow SSL self signed", () => {
      it.todo("should fail with error", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();
        const ports = { source: getPort(), proxy: getPort() };
        const source = https
          .createServer({
            key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
            cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
            ciphers: "AES128-GCM-SHA256",
          })
          .listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          target: "https://localhost:" + ports.source,
          secure: true,
        });

        proxy.listen(ports.proxy);

        proxy.on("error", function (err, req, res) {
          expect(err).toBeInstanceOf(Error);
          if (semver.gt(process.versions.node, "0.12.0")) {
            expect(err.toString()).toBe("Error: unable to verify the first certificate");
          } else {
            expect(err.toString()).toBe("Error: DEPTH_ZERO_SELF_SIGNED_CERT");
          }
          resolve();
        });

        http
          .request({
            hostname: "localhost",
            port: ports.proxy,
            method: "GET",
          })
          .end();

        await promise;
      });
    });

    describe("HTTPS to HTTP using own server", () => {
      it("should proxy the request en send back the response", async () => {
        const { resolve, promise } = Promise.withResolvers<void>();

        const ports = { source: getPort(), proxy: getPort() };
        const source = http.createServer(function (req, res) {
          expect(req.method).to.eql("GET");
          expect(Number.parseInt(req.headers.host!.split(":")[1]!)).to.eql(ports.proxy);
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Hello from " + ports.source);
        });

        source.listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          agent: new http.Agent({ maxSockets: 2 }),
        });

        const ownServer = https
          .createServer(
            {
              key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
              cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
              ciphers: "AES128-GCM-SHA256",
            },
            function (req, res) {
              proxy.web(req, res, {
                target: "http://localhost:" + ports.source,
              });
            },
          )
          .listen(ports.proxy);

        https
          .request(
            {
              host: "localhost",
              port: ports.proxy,
              path: "/",
              method: "GET",
              rejectUnauthorized: false,
            },
            function (res) {
              expect(res.statusCode).to.eql(200);

              res.on("data", function (data) {
                expect(data.toString()).to.eql("Hello from " + ports.source);
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
