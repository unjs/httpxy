import http from "node:http";
import { createProxyServer } from "../src/index.ts";

async function main() {
  const main = http.createServer((req, res) => {
    res.end(
      JSON.stringify({
        method: req.method,
        path: req.url,
        headers: req.headers,
      }),
    );
  });
  await new Promise<void>((resolve) => {
    main.listen(3000, "127.0.0.1", resolve);
  });

  const httpProxy = createProxyServer();

  const proxy = http.createServer(async (req, res) => {
    try {
      await httpProxy.web(req, res, {
        target: "http://127.0.0.1:3000",
      });
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end("Proxy error: " + (error as Error).toString());
    }
  });
  await new Promise<void>((resolve) => {
    proxy.listen(3001, "127.0.0.1", resolve);
  });

  console.log("main: http://127.0.0.1:3000");
  console.log("proxy: http://127.0.0.1:3001");
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
