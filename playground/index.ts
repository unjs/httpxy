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

  const httpProxy = createProxyServer({
    target: main.url,
  });

  await listen(
    (req, res) => {
      httpProxy.web(req, res, { target: main.url });
    },
    { port: 3001, name: "proxy" },
  );
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
