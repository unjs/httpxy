import http from "node:http";
import httpProxy from "http-proxy";

const PORT = Number(process.env.PORT) || 3006;
const TARGET = process.env.TARGET || "http://target:3000";

const proxy = httpProxy.createProxyServer({ target: TARGET });
const server = http.createServer((req, res) => {
  proxy.web(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`http-proxy listening on :${PORT} -> ${TARGET}`);
});
