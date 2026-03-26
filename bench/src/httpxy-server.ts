import http from "node:http";
import { createProxyServer } from "../../src/index.ts";

const PORT = Number(process.env.PORT) || 3001;
const TARGET = process.env.TARGET || "http://target:3000";

const proxy = createProxyServer({ target: TARGET });
const server = http.createServer((req, res) => {
  proxy.web(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`httpxy server proxy listening on :${PORT} -> ${TARGET}`);
});
