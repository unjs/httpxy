import { describe, it, expect } from "vitest";
import * as common from "../src/_utils.ts";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-common-test.js

// Difference from http-proxy is that we always ensure leading slash on path

describe("lib/http-proxy/common.js", () => {
  describe("#setupOutgoing", () => {
    it("should setup the correct headers", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: "?",
          target: {
            host: "hey",
            hostname: "how",
            socketPath: "are",
            port: "you",
          },
          // @ts-expect-error
          headers: { fizz: "bang", overwritten: true },
          localAddress: "local.address",
          auth: "username:pass",
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: false },
        },
      );

      expect(outgoing.host).to.eql("hey");
      expect(outgoing.hostname).to.eql("how");
      expect(outgoing.socketPath).to.eql("are");
      expect(outgoing.port).to.eql("you");
      expect(outgoing.agent).to.eql("?");

      expect(outgoing.method).to.eql("i");
      expect(outgoing.path).to.eql("/am"); // leading slash is new in httpxy

      expect(outgoing.headers.pro).to.eql("xy");
      expect(outgoing.headers.fizz).to.eql("bang");
      expect(outgoing.headers.overwritten).to.eql(true);
      expect(outgoing.localAddress).to.eql("local.address");
      expect(outgoing.auth).to.eql("username:pass");
    });

    it("should not override agentless upgrade header", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: undefined,
          target: {
            host: "hey",
            hostname: "how",
            socketPath: "are",
            port: "you",
          },
          headers: { connection: "upgrade" },
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: false },
        } as any,
      );
      expect(outgoing.headers.connection).to.eql("upgrade");
    });

    it("should not override agentless connection: contains upgrade", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: undefined,
          target: {
            host: "hey",
            hostname: "how",
            socketPath: "are",
            port: "you",
          } as any,
          headers: { connection: "keep-alive, upgrade" }, // this is what Firefox sets
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: false },
        } as any,
      );
      expect(outgoing.headers.connection).to.eql("keep-alive, upgrade");
    });

    it("should override agentless connection: contains improper upgrade", () => {
      // sanity check on upgrade regex
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: undefined,
          target: {
            host: "hey",
            hostname: "how",
            socketPath: "are",
            port: "you",
          },
          headers: { connection: "keep-alive, not upgrade" },
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: false },
        } as any,
      );
      expect(outgoing.headers.connection).to.eql("close");
    });

    it("should override agentless non-upgrade header to close", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: undefined,
          target: {
            host: "hey",
            hostname: "how",
            socketPath: "are",
            port: "you",
          },
          headers: { connection: "xyz" },
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: false },
        } as any,
      );
      expect(outgoing.headers.connection).to.eql("close");
    });

    it("should set the agent to false if none is given", () => {
      const outgoing = {} as any;
      common.setupOutgoing(outgoing, { target: "http://localhost" }, {
        url: "/",
      } as any);
      expect(outgoing.agent).to.eql(false);
    });

    it("set the port according to the protocol", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: "?",
          target: {
            host: "how",
            hostname: "are",
            socketPath: "you",
            protocol: "https:",
          },
        },
        {
          method: "i",
          url: "am",
          headers: { pro: "xy" },
        } as any,
      );

      expect(outgoing.host).to.eql("how");
      expect(outgoing.hostname).to.eql("are");
      expect(outgoing.socketPath).to.eql("you");
      expect(outgoing.agent).to.eql("?");

      expect(outgoing.method).to.eql("i");
      expect(outgoing.path).to.eql("/am");
      expect(outgoing.headers.pro).to.eql("xy");

      expect(outgoing.port).to.eql(443);
    });

    it("should keep the original target path in the outgoing path", () => {
      const outgoing = {} as any;
      common.setupOutgoing(outgoing, { target: { path: "some-path" } }, {
        url: "am",
      } as any);

      expect(outgoing.path).to.eql("some-path/am");
    });

    it("should keep the original forward path in the outgoing path", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: {},
          forward: {
            path: "some-path",
          },
        },
        {
          url: "am",
        } as any,
        "forward",
      );

      expect(outgoing.path).to.eql("some-path/am");
    });

    it("should properly detect https/wss protocol without the colon", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: {
            protocol: "https",
            host: "whatever.com",
          },
        },
        { url: "/" } as any,
      );

      expect(outgoing.port).to.eql(443);
    });

    it("should not prepend the target path to the outgoing path with prependPath = false", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: { path: "hellothere" },
          prependPath: false,
        },
        { url: "hi" } as any,
      );

      expect(outgoing.path).to.eql("/hi");
    });

    it("should properly join paths", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: { path: "/forward" },
        },
        { url: "/static/path" } as any,
      );

      expect(outgoing.path).to.eql("/forward/static/path");
    });

    it("should not modify the query string", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: { path: "/forward" },
        },
        {
          url: "/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2",
        } as any,
      );

      expect(outgoing.path).to.eql(
        "/forward/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2",
      );
    });

    //
    // This is the proper failing test case for the common.join problem
    //
    it("should correctly format the toProxy URL", () => {
      const outgoing = {} as any;
      const google = "https://google.com";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        { url: google } as any,
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    it("should not replace :\\ to :\\\\ when no https word before", () => {
      const outgoing = {} as any;
      const google = "https://google.com:/join/join.js";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        { url: google } as any,
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    it("should not replace :\\ to \\\\ when no http word before", () => {
      const outgoing = {} as any;
      const google = "http://google.com:/join/join.js";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        { url: google } as any,
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    describe("when using ignorePath", () => {
      it("should ignore the path of the `req.url` passed in but use the target path", () => {
        const outgoing = {} as any;
        const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            ignorePath: true,
          },
          { url: "/more/crazy/pathness" } as any,
        );

        expect(outgoing.path).to.eql("/some/crazy/path/whoooo");
      });

      it("and prependPath: false, it should ignore path of target and incoming request", () => {
        const outgoing = {} as any;
        const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            ignorePath: true,
            prependPath: false,
          },
          { url: "/more/crazy/pathness" } as any,
        );

        expect(outgoing.path).to.eql("/");
      });
    });

    describe("when using changeOrigin", () => {
      it("should correctly set the port to the host when it is a non-standard port using url.parse", () => {
        const outgoing = {} as any;
        const myEndpoint = "https://myCouch.com:6984";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            changeOrigin: true,
          },
          { url: "/" } as any,
        );

        expect(outgoing.headers.host).to.eql("mycouch.com:6984");
      });

      it("should correctly set the port to the host when it is a non-standard port when setting host and port manually (which ignores port)", () => {
        const outgoing = {} as any;
        common.setupOutgoing(
          outgoing,
          {
            target: {
              protocol: "https:",
              host: "mycouch.com",
              port: 6984,
            },
            changeOrigin: true,
          },
          { url: "/" } as any,
        );
        expect(outgoing.headers.host).to.eql("mycouch.com:6984");
      });
    });

    it("should pass through https client parameters", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          agent: "?",
          target: {
            host: "how",
            hostname: "are",
            socketPath: "you",
            protocol: "https:",
            pfx: "my-pfx",
            key: "my-key",
            passphrase: "my-passphrase",
            cert: "my-cert",
            ca: "my-ca",
            ciphers: "my-ciphers",
            secureProtocol: "my-secure-protocol",
          },
        },
        {
          method: "i",
          url: "am",
        } as any,
      );

      expect(outgoing.pfx).eql("my-pfx");
      expect(outgoing.key).eql("my-key");
      expect(outgoing.passphrase).eql("my-passphrase");
      expect(outgoing.cert).eql("my-cert");
      expect(outgoing.ca).eql("my-ca");
      expect(outgoing.ciphers).eql("my-ciphers");
      expect(outgoing.secureProtocol).eql("my-secure-protocol");
    });

    it("should set ca from top-level options", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: { host: "localhost", protocol: "https:" },
          ca: "my-top-level-ca",
        } as any,
        { url: "/", headers: {} } as any,
      );
      expect(outgoing.ca).eql("my-top-level-ca");
    });

    it("should handle overriding the `method` of the http request", () => {
      const outgoing = {} as any;
      common.setupOutgoing(
        outgoing,
        {
          target: "https://whooooo.com",
          method: "POST",
        },
        { method: "GET", url: "" } as any,
      );

      expect(outgoing.method).eql("POST");
    });

    // url.parse('').path => null
    it("should not pass null as last arg to #urlJoin", () => {
      const outgoing = {} as any;
      common.setupOutgoing(outgoing, { target: { path: "" } }, {
        url: "",
      } as any);

      expect(outgoing.path).toBe("/"); // leading slash is new in httpxy
    });
  });

  describe("#joinURL", () => {
    it("should insert slash when base has no trailing slash and path has no leading slash", () => {
      expect(common.joinURL("foo", "bar")).to.eql("foo/bar");
    });

    it("should return path when base is undefined", () => {
      expect(common.joinURL(undefined, "/path")).to.eql("/path");
    });

    it("should return base when path is undefined", () => {
      expect(common.joinURL("/base", undefined)).to.eql("/base");
    });

    it("should return / when both are undefined", () => {
      expect(common.joinURL(undefined, undefined)).to.eql("/");
    });

    it("should strip duplicate slash when both have slash", () => {
      expect(common.joinURL("/base/", "/path")).to.eql("/base/path");
    });

    it("should concat when base has trailing slash and path has no leading slash", () => {
      expect(common.joinURL("/base/", "path")).to.eql("/base/path");
    });
  });

  describe("#rewriteCookieProperty", () => {
    it("should return original cookie when domain is not in config and no wildcard", () => {
      const cookie = "hello; domain=other.com; path=/";
      const result = common.rewriteCookieProperty(cookie, { "specific.com": "new.com" }, "domain");
      expect(result).to.eql("hello; domain=other.com; path=/");
    });
  });

  describe("#requiresPort", () => {
    it("should return false for ftp on port 21", () => {
      expect(common.requiresPort(21, "ftp")).to.eql(false);
    });

    it("should return true for ftp on non-standard port", () => {
      expect(common.requiresPort(8021, "ftp")).to.eql(true);
    });

    it("should return false for gopher on port 70", () => {
      expect(common.requiresPort(70, "gopher")).to.eql(false);
    });

    it("should return true for gopher on non-standard port", () => {
      expect(common.requiresPort(8070, "gopher")).to.eql(true);
    });

    it("should return false for file protocol", () => {
      expect(common.requiresPort(0, "file")).to.eql(false);
      expect(common.requiresPort(8080, "file")).to.eql(false);
    });

    it("should return false for unknown protocol on port 0", () => {
      expect(common.requiresPort(0, "unknown")).to.eql(false);
    });

    it("should return true for unknown protocol on non-zero port", () => {
      expect(common.requiresPort(8080, "unknown")).to.eql(true);
    });

    it("should return false when port is falsy", () => {
      expect(common.requiresPort(0, "http")).to.eql(false);
    });

    it("should handle protocol with colon", () => {
      expect(common.requiresPort(80, "http:")).to.eql(false);
      expect(common.requiresPort(8080, "http:")).to.eql(true);
    });
  });

  describe("#setupSocket", () => {
    it("should setup a socket", () => {
      const socketConfig = {
          timeout: undefined as number | undefined,
          nodelay: false,
          keepalive: false,
        },
        stubSocket = {
          setTimeout: function (num: number) {
            socketConfig.timeout = num;
          },
          setNoDelay: function (bol: boolean) {
            socketConfig.nodelay = bol;
          },
          setKeepAlive: function (bol: boolean) {
            socketConfig.keepalive = bol;
          },
        };
      const returnValue = common.setupSocket(stubSocket as any);

      expect(socketConfig.timeout).to.eql(0);
      expect(socketConfig.nodelay).to.eql(true);
      expect(socketConfig.keepalive).to.eql(true);
    });
  });
});
