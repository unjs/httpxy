import http from "node:http";
import { createProxyServer } from "http-proxy-3";

const PORT = Number(process.env.PORT) || 3005;
const TARGET = process.env.TARGET || "http://target:3000";

const proxy = createProxyServer({ target: TARGET });
const server = http.createServer((req, res) => {
  proxy.web(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`http-proxy-3 listening on :${PORT} -> ${TARGET}`);
});
