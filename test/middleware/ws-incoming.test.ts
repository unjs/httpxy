import { describe, it, expect } from "vitest";
import * as wsIncoming from "../../src/middleware/ws-incoming.ts";
import {
  stubIncomingMessage,
  stubSocket,
  stubMiddlewareOptions,
  stubProxyServer,
} from "../_stubs.ts";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-passes-ws-incoming-test.js

describe("middleware:ws-incoming", () => {
  describe("#checkMethodAndHeader", () => {
    it("should drop non-GET connections", () => {
      let destroyCalled = false;
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubIncomingMessage({ method: "DELETE", headers: {} }),
        stubSocket({
          destroy: () => {
            destroyCalled = true;
          },
        }),
        stubMiddlewareOptions(),
        stubProxyServer(),
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should drop connections when no upgrade header", () => {
      let destroyCalled = false;
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubIncomingMessage({ method: "GET", headers: {} }),
        stubSocket({
          destroy: () => {
            destroyCalled = true;
          },
        }),
        stubMiddlewareOptions(),
        stubProxyServer(),
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should drop connections when upgrade header is different of `websocket`", () => {
      let destroyCalled = false;
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubIncomingMessage({
          method: "GET",
          headers: { upgrade: "anotherprotocol" },
        }),
        stubSocket({
          destroy: () => {
            destroyCalled = true;
          },
        }),
        stubMiddlewareOptions(),
        stubProxyServer(),
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should return nothing when all is ok", () => {
      let destroyCalled = false;
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubIncomingMessage({
          method: "GET",
          headers: { upgrade: "websocket" },
        }),
        stubSocket({
          destroy: () => {
            destroyCalled = true;
          },
        }),
        stubMiddlewareOptions(),
        stubProxyServer(),
      );
      expect(returnValue).toBe(undefined);
      expect(destroyCalled).toBe(false);
    });
  });

  describe("#XHeaders", () => {
    it("return if no forward request", () => {
      const returnValue = wsIncoming.XHeaders(
        stubIncomingMessage(),
        stubSocket(),
        stubMiddlewareOptions(),
        stubProxyServer(),
      );
      expect(returnValue).toBe(undefined);
    });

    it("set the correct x-forwarded-* headers from req.connection", () => {
      const req = stubIncomingMessage({
        connection: {
          remoteAddress: "192.168.1.2",
          remotePort: "8080",
        },
        headers: {
          host: "192.168.1.2:8080",
        },
      });
      wsIncoming.XHeaders(
        req,
        stubSocket(),
        stubMiddlewareOptions({ xfwd: true }),
        stubProxyServer(),
      );
      expect(req.headers["x-forwarded-for"]).toBe("192.168.1.2");
      expect(req.headers["x-forwarded-port"]).toBe("8080");
      expect(req.headers["x-forwarded-proto"]).toBe("ws");
    });

    it("set the correct x-forwarded-* headers from req.socket", () => {
      const req = stubIncomingMessage({
        socket: {
          remoteAddress: "192.168.1.3",
          remotePort: "8181",
        },
        connection: {
          pair: true,
        },
        headers: {
          host: "192.168.1.3:8181",
        },
      });
      wsIncoming.XHeaders(
        req,
        stubSocket(),
        stubMiddlewareOptions({ xfwd: true }),
        stubProxyServer(),
      );
      expect(req.headers["x-forwarded-for"]).toBe("192.168.1.3");
      expect(req.headers["x-forwarded-port"]).toBe("8181");
      expect(req.headers["x-forwarded-proto"]).toBe("wss");
    });
  });
});
