import http from "node:http";
import { proxyFetch } from "../../src/index.ts";

const PORT = Number(process.env.PORT) || 3002;
const TARGET = process.env.TARGET || "http://target:3000";

function collectBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
  });
}

const server = http.createServer(async (req, res) => {
  const body = await collectBody(req);
  const response = await proxyFetch(TARGET, new URL(req.url!, `http://127.0.0.1:${PORT}`), {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body as any,
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) {
    for await (const chunk of response.body) {
      res.write(chunk);
    }
  }
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`httpxy proxyFetch proxy listening on :${PORT} -> ${TARGET}`);
});
