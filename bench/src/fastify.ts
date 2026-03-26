import Fastify from "fastify";
import httpProxy from "@fastify/http-proxy";

const PORT = Number(process.env.PORT) || 3004;
const TARGET = process.env.TARGET || "http://target:3000";

const app = Fastify();
await app.register(httpProxy, { upstream: TARGET });
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`@fastify/http-proxy listening on :${PORT} -> ${TARGET}`);
