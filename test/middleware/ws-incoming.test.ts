import { describe, it, expect } from "vitest";
import * as wsIncoming from "../../src/middleware/ws-incoming.ts";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-passes-ws-incoming-test.js

describe("middleware:ws-incoming", () => {
  describe("#checkMethodAndHeader", () => {
    it("should drop non-GET connections", () => {
      let destroyCalled = false;
      const stubRequest = {
          method: "DELETE",
          headers: {},
        },
        stubSocket = {
          destroy: () => {
            // Simulate Socket.destroy() method when call
            destroyCalled = true;
          },
        };
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubRequest as any,
        stubSocket as any,
        {} as any,
        {} as any,
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should drop connections when no upgrade header", () => {
      let destroyCalled = false;
      const stubRequest = {
        method: "GET",
        headers: {},
      };
      const stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubRequest as any,
        stubSocket as any,
        {} as any,
        {} as any,
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should drop connections when upgrade header is different of `websocket`", () => {
      let destroyCalled = false;
      const stubRequest = {
          method: "GET",
          headers: {
            upgrade: "anotherprotocol",
          },
        },
        stubSocket = {
          destroy: () => {
            // Simulate Socket.destroy() method when call
            destroyCalled = true;
          },
        };
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubRequest as any,
        stubSocket as any,
        {} as any,
        {} as any,
      );
      expect(returnValue).toBe(true);
      expect(destroyCalled).toBe(true);
    });

    it("should return nothing when all is ok", () => {
      let destroyCalled = false;
      const stubRequest = {
        method: "GET",
        headers: {
          upgrade: "websocket",
        },
      };
      const stubSocket = {
        destroy: () => {
          // Simulate Socket.destroy() method when call
          destroyCalled = true;
        },
      };
      const returnValue = wsIncoming.checkMethodAndHeader(
        stubRequest as any,
        stubSocket as any,
        {} as any,
        {} as any,
      );
      expect(returnValue).toBe(undefined);
      expect(destroyCalled).toBe(false);
    });
  });

  describe("#XHeaders", () => {
    it("return if no forward request", () => {
      const returnValue = wsIncoming.XHeaders({} as any, {} as any, {} as any, {} as any);
      expect(returnValue).toBe(undefined);
    });

    it("set the correct x-forwarded-* headers from req.connection", () => {
      const stubRequest = {
        connection: {
          remoteAddress: "192.168.1.2",
          remotePort: "8080",
        },
        headers: {
          host: "192.168.1.2:8080",
        } as any,
      };
      wsIncoming.XHeaders(stubRequest as any, {} as any, { xfwd: true } as any, {} as any);
      expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.2");
      expect(stubRequest.headers["x-forwarded-port"]).toBe("8080");
      expect(stubRequest.headers["x-forwarded-proto"]).toBe("ws");
    });

    it("set the correct x-forwarded-* headers from req.socket", () => {
      const stubRequest = {
        socket: {
          remoteAddress: "192.168.1.3",
          remotePort: "8181",
        },
        connection: {
          pair: true,
        },
        headers: {
          host: "192.168.1.3:8181",
        } as any,
      };
      wsIncoming.XHeaders(stubRequest as any, {} as any, { xfwd: true } as any, {} as any);
      expect(stubRequest.headers["x-forwarded-for"]).toBe("192.168.1.3");
      expect(stubRequest.headers["x-forwarded-port"]).toBe("8181");
      expect(stubRequest.headers["x-forwarded-proto"]).toBe("wss");
    });
  });
});
