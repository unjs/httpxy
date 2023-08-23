import { expect, it, describe, beforeAll } from "vitest";
import { listen, Listener } from "listhen";
import { $fetch } from "ofetch";
import { createProxyServer, ProxyServer } from "../src";

describe("httpxy", () => {
  let mainListener: Listener;
  let proxyListener: Listener;
  let proxy: ProxyServer;

  let lastResolved: any;
  let lastRejected: any;

  beforeAll(async () => {
    mainListener = await listen((req, res) => {
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          headers: req.headers,
        }),
      );
    });

    proxy = createProxyServer({});

    proxyListener = await listen(async (req, res) => {
      lastResolved = false;
      lastRejected = undefined;
      try {
        await proxy.web(req, res, { target: mainListener.url });
        lastResolved = true;
      } catch (error) {
        lastRejected = error;
        res.statusCode = 500;
        res.end("Proxy error: " + error.toString());
      }
    });
  });

  it("works", async () => {
    const mainResponse = await $fetch(mainListener.url + "?foo");
    const proxyResponse = await $fetch(proxyListener.url + "?foo");

    const maskResponse = (obj: any) => ({
      ...obj,
      headers: { ...obj.headers, connection: "<>", host: "<>" },
    });

    expect(maskResponse(await mainResponse)).toMatchObject(
      maskResponse(proxyResponse),
    );

    expect(lastResolved).toBe(true);
    expect(lastRejected).toBe(undefined);
  });
});
