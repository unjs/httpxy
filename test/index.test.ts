import { expect, it, describe } from "vitest";
import { listen, Listener } from "listhen";
import { $fetch } from "ofetch";
import { createProxyServer, ProxyServer, ProxyServerOptions } from "../src";

describe("httpxy", () => {
  let mainListener: Listener;
  let proxyListener: Listener;
  let proxy: ProxyServer;

  let lastResolved: any;
  let lastRejected: any;

  const maskResponse = (obj: any) => ({
    ...obj,
    headers: { ...obj.headers, connection: "<>", host: "<>" },
  });

  const makeProxy = async (options: ProxyServerOptions) => {
    mainListener = await listen((req, res) => {
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          headers: req.headers,
        }),
      );
    });

    proxy = createProxyServer(options);

    proxyListener = await listen(async (req, res) => {
      lastResolved = false;
      lastRejected = undefined;
      try {
        await proxy.web(req, res, { target: mainListener.url + "base" });
        lastResolved = true;
      } catch (error) {
        lastRejected = error;
        res.statusCode = 500;
        res.end("Proxy error: " + error.toString());
      }
    });
  }

  it("works", async () => {
    await makeProxy({});
    const mainResponse = await $fetch(mainListener.url + "base/test?foo");
    const proxyResponse = await $fetch(proxyListener.url + "test?foo");

    expect(maskResponse(await mainResponse)).toMatchObject(
      maskResponse(proxyResponse),
    );

    expect(proxyResponse.path).toBe("/base/test?foo");

    expect(lastResolved).toBe(true);
    expect(lastRejected).toBe(undefined);
  });

  it("should avoid normalize url", async () => {
    await makeProxy({ normalizeUrl: false });
    const mainResponse = await $fetch(mainListener.url + "base//test?foo");
    const proxyResponse = await $fetch(proxyListener.url + "test?foo");

    expect(maskResponse(await mainResponse)).toMatchObject(
      maskResponse(proxyResponse),
    );

    expect(proxyResponse.path).toBe("/base//test?foo");

    expect(lastResolved).toBe(true);
    expect(lastRejected).toBe(undefined);
  });

});
