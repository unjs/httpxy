import { assertType, describe, expectTypeOf, it } from "vitest";
import { ProxyServer } from "../src/server";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";

describe("httpxy types", () => {
  it("ProxyServer generic types", () => {
    assertType<ProxyServer>(new ProxyServer());
    assertType<ProxyServer<IncomingMessage, ServerResponse>>(new ProxyServer());
    assertType<ProxyServer<ExpressRequest, ExpressResponse>>(
      new ProxyServer<ExpressRequest, ExpressResponse>(),
    );

    const expressProxyServer = new ProxyServer<ExpressRequest, ExpressResponse>();

    expressProxyServer.on("start", (req, res) => {
      expectTypeOf(req).toEqualTypeOf<ExpressRequest>();
      expectTypeOf(req).toExtend<IncomingMessage>();

      expectTypeOf(res).toEqualTypeOf<ExpressResponse>();
      expectTypeOf(res).toExtend<ServerResponse>();
    });
  });
});
