import { expect, it, describe, beforeAll } from "vitest";
import { listen, Listener } from "listhen";
import { $fetch } from "ofetch";
import { createProxyServer, ProxyServer } from "../src";

describe("httpxy", () => {
  let mainListener: Listener;
  let proxyListener: Listener;
  let proxy: ProxyServer;

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

    proxyListener = await listen((req, res) => {
      proxy.web(req, res, { target: mainListener.url });
    });
  });

  it("works", async () => {
    const mainResponse = await $fetch(mainListener.url);
    const proxyResponse = await $fetch(proxyListener.url);

    const maskResponse = (obj: any) => ({
      ...obj,
      headers: { ...obj.headers, connection: "<>", host: "<>" },
    });

    expect(maskResponse(await mainResponse)).toMatchObject(
      maskResponse(proxyResponse),
    );
  });
});
