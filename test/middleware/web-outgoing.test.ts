import { describe, it, expect, beforeEach } from "vitest";

import * as webOutgoing from "../../src/middleware/web-outgoing.ts";
import { stubIncomingMessage, stubServerResponse, stubMiddlewareOptions } from "../_stubs.ts";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-passes-web-outgoing-test.js

describe("middleware:web-outgoing", () => {
  const ctx: any = {};

  describe("#setRedirectHostRewrite", () => {
    beforeEach(() => {
      ctx.req = {
        headers: {
          host: "ext-auto.com",
        },
      };
      ctx.proxyRes = {
        statusCode: 301,
        headers: {
          location: "http://backend.com/",
        },
      };
      ctx.options = {
        target: "http://backend.com",
      };
    });

    describe("rewrites location host with hostRewrite", () => {
      beforeEach(() => {
        ctx.options.hostRewrite = "ext-manual.com";
      });
      for (const code of [201, 301, 302, 307, 308]) {
        it("on " + code, () => {
          ctx.proxyRes.statusCode = code;
          webOutgoing.setRedirectHostRewrite(
            ctx.req,
            stubServerResponse(),
            ctx.proxyRes,
            ctx.options,
          );
          expect(ctx.proxyRes.headers.location).to.eql("http://ext-manual.com/");
        });
      }

      it("not on 200", () => {
        ctx.proxyRes.statusCode = 200;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("not when hostRewrite is unset", () => {
        delete ctx.options.hostRewrite;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("takes precedence over autoRewrite", () => {
        ctx.options.autoRewrite = true;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://ext-manual.com/");
      });

      it("not when the redirected location does not match target host", () => {
        ctx.proxyRes.statusCode = 302;
        ctx.proxyRes.headers.location = "http://some-other/";
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://some-other/");
      });

      it("not when the redirected location does not match target port", () => {
        ctx.proxyRes.statusCode = 302;
        ctx.proxyRes.headers.location = "http://backend.com:8080/";
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com:8080/");
      });
    });

    describe("rewrites location host with autoRewrite", () => {
      beforeEach(() => {
        ctx.options.autoRewrite = true;
      });
      for (const code of [201, 301, 302, 307, 308]) {
        it("on " + code, () => {
          ctx.proxyRes.statusCode = code;
          webOutgoing.setRedirectHostRewrite(
            ctx.req,
            stubServerResponse(),
            ctx.proxyRes,
            ctx.options,
          );
          expect(ctx.proxyRes.headers.location).to.eql("http://ext-auto.com/");
        });
      }

      it("not on 200", () => {
        ctx.proxyRes.statusCode = 200;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("not when autoRewrite is unset", () => {
        delete ctx.options.autoRewrite;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("not when the redirected location does not match target host", () => {
        ctx.proxyRes.statusCode = 302;
        ctx.proxyRes.headers.location = "http://some-other/";
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://some-other/");
      });

      it("not when the redirected location does not match target port", () => {
        ctx.proxyRes.statusCode = 302;
        ctx.proxyRes.headers.location = "http://backend.com:8080/";
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com:8080/");
      });
    });

    describe("rewrites location protocol with protocolRewrite", () => {
      beforeEach(() => {
        ctx.options.protocolRewrite = "https";
      });
      for (const code of [201, 301, 302, 307, 308]) {
        it("on " + code, () => {
          ctx.proxyRes.statusCode = code;
          webOutgoing.setRedirectHostRewrite(
            ctx.req,
            stubServerResponse(),
            ctx.proxyRes,
            ctx.options,
          );
          expect(ctx.proxyRes.headers.location).to.eql("https://backend.com/");
        });
      }

      it("not on 200", () => {
        ctx.proxyRes.statusCode = 200;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("not when protocolRewrite is unset", () => {
        delete ctx.options.protocolRewrite;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("http://backend.com/");
      });

      it("works together with hostRewrite", () => {
        ctx.options.hostRewrite = "ext-manual.com";
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("https://ext-manual.com/");
      });

      it("works together with autoRewrite", () => {
        ctx.options.autoRewrite = true;
        webOutgoing.setRedirectHostRewrite(
          ctx.req,
          stubServerResponse(),
          ctx.proxyRes,
          ctx.options,
        );
        expect(ctx.proxyRes.headers.location).to.eql("https://ext-auto.com/");
      });
    });
  });

  describe("#setConnection", () => {
    it("set the right connection with 1.0 - `close`", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: "1.0",
          headers: { connection: undefined },
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection).to.eql("close");
    });

    it("set the right connection with 1.0 - req.connection", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: "1.0",
          headers: { connection: "hey" },
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection).to.eql("hey");
    });

    it("set the right connection - req.connection", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: undefined,
          headers: { connection: "hola" },
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection).to.eql("hola");
    });

    it("set the right connection (HTTP/1.1) - req.connection", () => {
      const proxyRes = { headers: {} as any };
      webOutgoing.setConnection(
        {
          httpVersion: "1.0",
          httpVersionMajor: 1,
          headers: {
            connection: "hola",
          },
        } as any,
        {} as any,
        proxyRes as any,
        {} as any,
      );

      expect(proxyRes.headers.connection).to.eql("hola");
    });

    it("set the right connection (HTTP/2) - req.connection", () => {
      const proxyRes = { headers: {} as any };
      webOutgoing.setConnection(
        {
          httpVersion: "2.0",
          httpVersionMajor: 2,
          headers: {
            connection: "hola",
          },
        } as any,
        {} as any,
        proxyRes as any,
        {} as any,
      );

      expect(proxyRes.headers.connection).to.eql(undefined);
    });

    it("set the right connection - `keep-alive`", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: undefined,
          headers: { connection: undefined },
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection).to.eql("keep-alive");
    });

    it("don`t set connection with 2.0 if exist", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: "2.0",
          headers: { connection: "namstey" },
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection).to.eql(undefined);
    });

    it("don`t set connection with 2.0 if doesn`t exist", () => {
      const proxyRes = stubIncomingMessage({ headers: {} });
      webOutgoing.setConnection(
        stubIncomingMessage({
          httpVersion: "2.0",
          headers: {},
        }),
        stubServerResponse(),
        proxyRes,
        stubMiddlewareOptions(),
      );

      expect(proxyRes.headers.connection as any).to.eql(undefined);
    });
  });

  describe("#writeStatusCode", () => {
    it("should write status code", () => {
      const res = stubServerResponse({
        writeHead: function (n: number) {
          expect(n).to.eql(200);
        },
      });

      webOutgoing.writeStatusCode(
        stubIncomingMessage(),
        res,
        stubIncomingMessage({ statusCode: 200 }),
        stubMiddlewareOptions(),
      );
    });

    it("should write status code with statusMessage", () => {
      const res = stubServerResponse();
      webOutgoing.writeStatusCode(
        stubIncomingMessage(),
        res,
        stubIncomingMessage({ statusCode: 404, statusMessage: "Not Found" }),
        stubMiddlewareOptions(),
      );
      expect(res.statusCode).to.eql(404);
      expect(res.statusMessage).to.eql("Not Found");
    });

    it("should write status code without statusMessage", () => {
      const res = stubServerResponse();
      webOutgoing.writeStatusCode(
        stubIncomingMessage(),
        res,
        stubIncomingMessage({ statusCode: 200 }),
        stubMiddlewareOptions(),
      );
      expect(res.statusCode).to.eql(200);
      expect(res.statusMessage).to.eql(undefined);
    });
  });

  describe("#writeHeaders", () => {
    beforeEach(() => {
      ctx.proxyRes = {
        headers: {
          hey: "hello",
          how: "are you?",
          "set-cookie": ["hello; domain=my.domain; path=/", "there; domain=my.domain; path=/"],
        },
      };
      ctx.rawProxyRes = {
        headers: {
          hey: "hello",
          how: "are you?",
          "set-cookie": ["hello; domain=my.domain; path=/", "there; domain=my.domain; path=/"],
        },
        rawHeaders: [
          "Hey",
          "hello",
          "How",
          "are you?",
          "Set-Cookie",
          "hello; domain=my.domain; path=/",
          "Set-Cookie",
          "there; domain=my.domain; path=/",
        ],
      };
      ctx.res = {
        setHeader: function (k: string, v: string) {
          // https://nodejs.org/api/http.html#http_message_headers
          // Header names are lower-cased
          ctx.res.headers[k.toLowerCase()] = v;
        },
        headers: {} as Record<string, any>,
      };
    });

    it("writes headers", () => {
      const options = {};
      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers.hey).to.eql("hello");
      expect(ctx.res.headers.how).to.eql("are you?");

      expect(ctx.res.headers["set-cookie"]).toBeInstanceOf(Array);
      expect(ctx.res.headers["set-cookie"]).to.have.length(2);
    });

    it("writes raw headers", () => {
      const options = {};
      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.rawProxyRes, options as any);

      expect(ctx.res.headers.hey).to.eql("hello");
      expect(ctx.res.headers.how).to.eql("are you?");

      expect(ctx.res.headers["set-cookie"]).toBeInstanceOf(Array);
      expect(ctx.res.headers["set-cookie"]).to.have.length(2);
    });

    it("rewrites path", () => {
      const options = {
        cookiePathRewrite: "/dummyPath",
      };

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; domain=my.domain; path=/dummyPath");
    });

    it("does not rewrite path", () => {
      const options = {};

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; domain=my.domain; path=/");
    });

    it("removes path", () => {
      const options = {
        cookiePathRewrite: "",
      };

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; domain=my.domain");
    });

    it("does not rewrite domain", () => {
      const options = {};

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; domain=my.domain; path=/");
    });

    it("rewrites domain", () => {
      const options = {
        cookieDomainRewrite: "my.new.domain",
      };

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; domain=my.new.domain; path=/");
    });

    it("removes domain", () => {
      const options = {
        cookieDomainRewrite: "",
      };

      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello; path=/");
    });

    it("rewrites headers with advanced configuration", () => {
      const options = {
        cookieDomainRewrite: {
          "*": "",
          "my.old.domain": "my.new.domain",
          "my.special.domain": "my.special.domain",
        },
      };
      ctx.proxyRes.headers["set-cookie"] = [
        "hello-on-my.domain; domain=my.domain; path=/",
        "hello-on-my.old.domain; domain=my.old.domain; path=/",
        "hello-on-my.special.domain; domain=my.special.domain; path=/",
      ];
      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.proxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.contain("hello-on-my.domain; path=/");
      expect(ctx.res.headers["set-cookie"]).to.contain(
        "hello-on-my.old.domain; domain=my.new.domain; path=/",
      );
      expect(ctx.res.headers["set-cookie"]).to.contain(
        "hello-on-my.special.domain; domain=my.special.domain; path=/",
      );
    });

    it("rewrites raw headers with advanced configuration", () => {
      const options = {
        cookieDomainRewrite: {
          "*": "",
          "my.old.domain": "my.new.domain",
          "my.special.domain": "my.special.domain",
        },
      };
      ctx.rawProxyRes.headers["set-cookie"] = [
        "hello-on-my.domain; domain=my.domain; path=/",
        "hello-on-my.old.domain; domain=my.old.domain; path=/",
        "hello-on-my.special.domain; domain=my.special.domain; path=/",
      ];
      ctx.rawProxyRes.rawHeaders = [
        ...ctx.rawProxyRes.rawHeaders,
        "Set-Cookie",
        "hello-on-my.domain; domain=my.domain; path=/",
        "Set-Cookie",
        "hello-on-my.old.domain; domain=my.old.domain; path=/",
        "Set-Cookie",
        "hello-on-my.special.domain; domain=my.special.domain; path=/",
      ];
      webOutgoing.writeHeaders(stubIncomingMessage(), ctx.res, ctx.rawProxyRes, options as any);

      expect(ctx.res.headers["set-cookie"]).to.include("hello-on-my.domain; path=/");
      expect(ctx.res.headers["set-cookie"]).to.contain(
        "hello-on-my.old.domain; domain=my.new.domain; path=/",
      );
      expect(ctx.res.headers["set-cookie"]).to.contain(
        "hello-on-my.special.domain; domain=my.special.domain; path=/",
      );
    });

    it("skips undefined header values", () => {
      const proxyRes = {
        headers: {
          hey: "hello",
          undef: undefined,
        },
      };
      const headers: any = {};
      const res = {
        setHeader: function (k: string, v: string) {
          headers[k.toLowerCase()] = v;
        },
      };
      webOutgoing.writeHeaders(
        stubIncomingMessage(),
        res as any,
        proxyRes as any,
        stubMiddlewareOptions(),
      );
      expect(headers.hey).to.eql("hello");
      expect(headers).to.not.have.key("undef");
    });
  });

  it("#removeChunked", () => {
    const proxyRes = {
      headers: {
        "transfer-encoding": "hello",
      },
    };
    webOutgoing.removeChunked(
      stubIncomingMessage({ httpVersion: "1.0" }),
      stubServerResponse(),
      proxyRes as any,
      stubMiddlewareOptions(),
    );
    expect(proxyRes.headers["transfer-encoding"]).to.eql(undefined);
  });
});
