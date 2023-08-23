import { listen } from "listhen";
import { createProxyServer } from "../src";

async function main() {
  const main = await listen(
    (req, res) => {
      res.end(
        JSON.stringify({
          method: req.method,
          path: req.url,
          headers: req.headers,
        }),
      );
    },
    { port: 3000, name: "main" },
  );

  const httpProxy = createProxyServer();

  await listen(
    async (req, res) => {
      try {
        await httpProxy.web(req, res, {
          target: main.url,
        });
      } catch (error) {
        console.error(error);
        res.statusCode = 500;
        res.end("Proxy error: " + error.toString());
      }
    },
    { port: 3001, name: "proxy" },
  );
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
