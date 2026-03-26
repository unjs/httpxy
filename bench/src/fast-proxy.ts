import http from "node:http";
import fastProxy from "fast-proxy";

const PORT = Number(process.env.PORT) || 3003;
const TARGET = process.env.TARGET || "http://target:3000";

const { proxy } = fastProxy({ base: TARGET });
const server = http.createServer((req, res) => {
  proxy(req, res, req.url!, {});
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`fast-proxy listening on :${PORT} -> ${TARGET}`);
});
