import { describe, it, expect } from "vitest";
import * as common from "../src/_utils.ts";
import { createOutgoing, stubIncomingMessage, stubSocket } from "./_stubs.ts";

// Source: https://github.com/http-party/node-http-proxy/blob/master/test/lib-http-proxy-common-test.js

// Difference from http-proxy is that we always ensure leading slash on path

describe("lib/http-proxy/common.js", () => {
  describe("#setupOutgoing", () => {
    it("should setup the correct headers", () => {
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: "false" },
        }),
      );

      expect(outgoing.host).to.eql("hey");
      expect(outgoing.hostname).to.eql("how");
      expect(outgoing.socketPath).to.eql("are");
      expect(outgoing.port).to.eql("you");
      expect(outgoing.agent).to.eql("?");

      expect(outgoing.method).to.eql("i");
      expect(outgoing.path).to.eql("/am"); // leading slash is new in httpxy

      expect(outgoing.headers!.pro).to.eql("xy");
      expect(outgoing.headers!.fizz).to.eql("bang");
      expect(outgoing.headers!.overwritten).to.eql(true);
      expect(outgoing.localAddress).to.eql("local.address");
      expect(outgoing.auth).to.eql("username:pass");
    });

    it("should not override agentless upgrade header", () => {
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: "false" },
        }),
      );
      expect(outgoing.headers!.connection).to.eql("upgrade");
    });

    it("should not override agentless connection: contains upgrade", () => {
      const outgoing = createOutgoing();
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
          headers: { connection: "keep-alive, upgrade" }, // this is what Firefox sets
        },
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: "false" },
        }),
      );
      expect(outgoing.headers!.connection).to.eql("keep-alive, upgrade");
    });

    it("should override agentless connection: contains improper upgrade", () => {
      // sanity check on upgrade regex
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: "false" },
        }),
      );
      expect(outgoing.headers!.connection).to.eql("close");
    });

    it("should override agentless non-upgrade header to close", () => {
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy", overwritten: "false" },
        }),
      );
      expect(outgoing.headers!.connection).to.eql("close");
    });

    it("should set the agent to false if none is given", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        { target: "http://localhost" },
        stubIncomingMessage({
          url: "/",
        }),
      );
      expect(outgoing.agent).to.eql(false);
    });

    it("set the port according to the protocol", () => {
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
          headers: { pro: "xy" },
        }),
      );

      expect(outgoing.host).to.eql("how");
      expect(outgoing.hostname).to.eql("are");
      expect(outgoing.socketPath).to.eql("you");
      expect(outgoing.agent).to.eql("?");

      expect(outgoing.method).to.eql("i");
      expect(outgoing.path).to.eql("/am");
      expect(outgoing.headers!.pro).to.eql("xy");

      expect(outgoing.port).to.eql(443);
    });

    it("should keep the original target path in the outgoing path", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        { target: URL.parse("http://localhost/some-path")! },
        stubIncomingMessage({
          url: "am",
        }),
      );

      expect(outgoing.path).to.eql("/some-path/am");
    });

    it("should keep the original forward path in the outgoing path", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: "http://localhost",
          forward: URL.parse("http://localhost/some-path")!,
        },
        stubIncomingMessage({
          url: "am",
        }),
        "forward",
      );

      expect(outgoing.path).to.eql("/some-path/am");
    });

    it("should properly detect https/wss protocol without the colon", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: {
            protocol: "https",
            host: "whatever.com",
          },
        },
        stubIncomingMessage({ url: "/" }),
      );

      expect(outgoing.port).to.eql(443);
    });

    it("should not prepend the target path to the outgoing path with prependPath = false", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://localhost/hellothere")!,
          prependPath: false,
        },
        stubIncomingMessage({ url: "hi" }),
      );

      expect(outgoing.path).to.eql("/hi");
    });

    it("should properly join paths", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://localhost/forward")!,
        },
        stubIncomingMessage({ url: "/static/path" }),
      );

      expect(outgoing.path).to.eql("/forward/static/path");
    });

    it("should preserve multiple consecutive slashes in path (#80)", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        { target: "http://localhost:3004" },
        stubIncomingMessage({ url: "//test" }),
      );
      expect(outgoing.path).to.eql("//test");
    });

    it("should preserve multiple consecutive slashes with query string (#80)", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        { target: "http://localhost:3004" },
        stubIncomingMessage({
          url: "//test?foo=bar",
        }),
      );
      expect(outgoing.path).to.eql("//test?foo=bar");
    });

    it("should not modify the query string", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://localhost/forward")!,
        },
        stubIncomingMessage({
          url: "/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2",
        }),
      );

      expect(outgoing.path).to.eql(
        "/forward/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2",
      );
    });

    //
    // This is the proper failing test case for the common.join problem
    //
    it("should correctly format the toProxy URL", () => {
      const outgoing = createOutgoing();
      const google = "https://google.com";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        stubIncomingMessage({ url: google }),
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    it("should not replace :\\ to :\\\\ when no https word before", () => {
      const outgoing = createOutgoing();
      const google = "https://google.com:/join/join.js";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        stubIncomingMessage({ url: google }),
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    it("should not replace :\\ to \\\\ when no http word before", () => {
      const outgoing = createOutgoing();
      const google = "http://google.com:/join/join.js";
      common.setupOutgoing(
        outgoing,
        {
          target: URL.parse("http://sometarget.com:80")!,
          toProxy: true,
        },
        stubIncomingMessage({ url: google }),
      );

      expect(outgoing.path).to.eql("/" + google);
    });

    describe("when using ignorePath", () => {
      it("should ignore the path of the `req.url` passed in but use the target path", () => {
        const outgoing = createOutgoing();
        const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            ignorePath: true,
          },
          stubIncomingMessage({ url: "/more/crazy/pathness" }),
        );

        expect(outgoing.path).to.eql("/some/crazy/path/whoooo");
      });

      it("and prependPath: false, it should ignore path of target and incoming request", () => {
        const outgoing = createOutgoing();
        const myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            ignorePath: true,
            prependPath: false,
          },
          stubIncomingMessage({ url: "/more/crazy/pathness" }),
        );

        expect(outgoing.path).to.eql("/");
      });
    });

    describe("when using changeOrigin", () => {
      it("should correctly set the port to the host when it is a non-standard port using URL.parse", () => {
        const outgoing = createOutgoing();
        const myEndpoint = "https://myCouch.com:6984";
        common.setupOutgoing(
          outgoing,
          {
            target: URL.parse(myEndpoint)!,
            changeOrigin: true,
          },
          stubIncomingMessage({ url: "/" }),
        );

        expect(outgoing.headers!.host).to.eql("mycouch.com:6984");
      });

      it("should correctly set the port to the host when it is a non-standard port when setting host and port manually (which ignores port)", () => {
        const outgoing = createOutgoing();
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
          stubIncomingMessage({ url: "/" }),
        );
        expect(outgoing.headers!.host).to.eql("mycouch.com:6984");
      });
    });

    it("should pass through https client parameters", () => {
      const outgoing = createOutgoing();
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
        stubIncomingMessage({
          method: "i",
          url: "am",
        }),
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
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: { host: "localhost", protocol: "https:" },
          ca: "my-top-level-ca",
        } as any,
        stubIncomingMessage({ url: "/" }),
      );
      expect(outgoing.ca).eql("my-top-level-ca");
    });

    it("should handle overriding the `method` of the http request", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        {
          target: "https://whooooo.com",
          method: "POST",
        },
        stubIncomingMessage({ method: "GET", url: "" }),
      );

      expect(outgoing.method).eql("POST");
    });

    it("should handle empty pathname target", () => {
      const outgoing = createOutgoing();
      common.setupOutgoing(
        outgoing,
        { target: URL.parse("http://localhost")! },
        stubIncomingMessage({
          url: "",
        }),
      );

      expect(outgoing.path).toBe("/");
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

  describe("#parseAddr", () => {
    it("should default to port 80 for http", () => {
      expect(common.parseAddr("http://localhost")).to.eql({ host: "localhost", port: 80 });
    });

    it("should default to port 443 for https", () => {
      expect(common.parseAddr("https://localhost")).to.eql({ host: "localhost", port: 443 });
    });

    it("should default to port 443 for wss", () => {
      expect(common.parseAddr("wss://localhost")).to.eql({ host: "localhost", port: 443 });
    });

    it("should default to port 80 for ws", () => {
      expect(common.parseAddr("ws://localhost")).to.eql({ host: "localhost", port: 80 });
    });

    it("should use explicit port over protocol default", () => {
      expect(common.parseAddr("https://localhost:8443")).to.eql({ host: "localhost", port: 8443 });
    });

    it("should parse unix socket path", () => {
      expect(common.parseAddr("unix:/tmp/sock")).to.eql({ socketPath: "/tmp/sock" });
    });

    it("should pass through a valid ProxyAddr with port", () => {
      const addr = { host: "127.0.0.1", port: 3000 };
      expect(common.parseAddr(addr)).to.eql(addr);
    });

    it("should pass through a valid ProxyAddr with socketPath", () => {
      const addr = { socketPath: "/tmp/proxy.sock" };
      expect(common.parseAddr(addr)).to.eql(addr);
    });

    it("should throw for ProxyAddr missing port and socketPath", () => {
      expect(() => common.parseAddr({} as any)).to.toThrowError(
        /ProxyAddr must have either `port` or `socketPath`/,
      );
    });
  });

  describe("#setupSocket", () => {
    it("should setup a socket", () => {
      const socketConfig = {
          timeout: undefined as number | undefined,
          nodelay: false,
          keepalive: false,
        },
        sock = stubSocket({
          setTimeout: function (num: number) {
            socketConfig.timeout = num;
          },
          setNoDelay: function (bol: boolean) {
            socketConfig.nodelay = bol;
          },
          setKeepAlive: function (bol: boolean) {
            socketConfig.keepalive = bol;
          },
        });
      const returnValue = common.setupSocket(sock);

      expect(socketConfig.timeout).to.eql(0);
      expect(socketConfig.nodelay).to.eql(true);
      expect(socketConfig.keepalive).to.eql(true);
    });
  });
});
