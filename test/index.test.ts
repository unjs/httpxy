import { afterAll, describe, expect, it } from "vitest";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { $fetch } from "ofetch";
import { createProxyServer, ProxyServer, type ProxyServerOptions } from "../src/index.ts";

type Listener = {
  close: () => Promise<void>;
  url: string;
};

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  return new Promise<Listener>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handler(req, res);
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
        url: `http://127.0.0.1:${port}/`,
      });
    });
  });
}

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
        res.end("Proxy error: " + (error as Error).toString());
      }
    });
  };

  afterAll(async () => {
    await proxyListener?.close();
    await mainListener?.close();
    proxy?.close();
  });

  it("works", async () => {
    await makeProxy({});
    const mainResponse = await $fetch(mainListener.url + "base/test?foo");
    const proxyResponse = await $fetch(proxyListener.url + "test?foo");

    expect(maskResponse(await mainResponse)).toMatchObject(maskResponse(proxyResponse));

    expect(proxyResponse.path).toBe("/base/test?foo");

    expect(lastResolved).toBe(true);
    expect(lastRejected).toBe(undefined);
  });

  it("should avoid normalize url", async () => {
    const mainResponse = await $fetch(mainListener.url + "base/a/b//c");
    const proxyResponse = await $fetch(proxyListener.url + "a/b//c");

    expect(maskResponse(await mainResponse)).toMatchObject(maskResponse(proxyResponse));

    expect(proxyResponse.path).toBe("/base/a/b//c");

    expect(lastResolved).toBe(true);
    expect(lastRejected).toBe(undefined);
  });
});
