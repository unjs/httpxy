import http from "node:http";

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    res.writeHead(200, {
      "content-type": req.headers["content-type"] || "application/octet-stream",
      "content-length": String(body.length),
    });
    res.end(body);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`target listening on :${PORT}`);
});
