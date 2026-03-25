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

describe("middleware pass exceptions", () => {
  it("should forward synchronous pass errors to error event", async () => {
    const target = await new Promise<{
      close: () => Promise<void>;
      url: string;
    }>((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.end("ok");
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          close: () =>
            new Promise<void>((r, j) => {
              server.close((e) => (e ? j(e) : r()));
            }),
          url: `http://127.0.0.1:${port}/`,
        });
      });
    });

    const proxy = createProxyServer({ target: target.url });

    // Inject a middleware pass that throws synchronously (simulates ERR_INVALID_HTTP_TOKEN)
    const testError = new TypeError("Invalid character in header");
    proxy.before("web", "", () => {
      throw testError;
    });

    const proxyServer = await new Promise<{
      close: () => Promise<void>;
      url: string;
    }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void proxy.web(req, res);
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          close: () =>
            new Promise<void>((r, j) => {
              server.close((e) => (e ? j(e) : r()));
            }),
          url: `http://127.0.0.1:${port}/`,
        });
      });
    });

    try {
      // With an error listener, the error should be emitted, not thrown
      const errorPromise = new Promise<Error>((resolve) => {
        proxy.on("error", (err, _req, res) => {
          resolve(err);
          // End the response so the request doesn't hang
          if (res && "writeHead" in res && !res.headersSent) {
            res.writeHead(502);
            res.end();
          }
        });
      });

      // The request may fail since the proxy errored before sending a response
      await $fetch(proxyServer.url, { ignoreResponseError: true }).catch(() => {});

      const emittedError = await errorPromise;
      expect(emittedError).toBe(testError);
    } finally {
      proxy.close();
      await proxyServer.close();
      await target.close();
    }
  });

  it("should reject promise when no error listener and pass throws", async () => {
    const target = await new Promise<{
      close: () => Promise<void>;
      url: string;
    }>((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.end("ok");
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          close: () =>
            new Promise<void>((r, j) => {
              server.close((e) => (e ? j(e) : r()));
            }),
          url: `http://127.0.0.1:${port}/`,
        });
      });
    });

    const proxy = createProxyServer({ target: target.url });

    // Inject a middleware pass that throws synchronously
    const testError = new TypeError("Invalid character in header");
    proxy.before("web", "", () => {
      throw testError;
    });

    const proxyServer = await new Promise<{
      close: () => Promise<void>;
      url: string;
    }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void proxy.web(req, res).catch(() => {
          res.statusCode = 502;
          res.end("error");
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          close: () =>
            new Promise<void>((r, j) => {
              server.close((e) => (e ? j(e) : r()));
            }),
          url: `http://127.0.0.1:${port}/`,
        });
      });
    });

    try {
      // No error listener - the promise should reject with the thrown error
      const response = await $fetch.raw(proxyServer.url, {
        ignoreResponseError: true,
      });
      expect(response.status).toBe(502);
    } finally {
      proxy.close();
      await proxyServer.close();
      await target.close();
    }
  });
});
