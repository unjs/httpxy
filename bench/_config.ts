// Shared benchmark configuration for the runners (bench.ts + standalone.ts).

export interface ProxyDef {
  name: string;
  script: string;
  port: number;
}

export const TARGET_PORT = 3000;

export const PROXIES: ProxyDef[] = [
  { name: "httpxy.server", script: "bench/src/httpxy-server.ts", port: 3001 },
  { name: "httpxy.proxyFetch", script: "bench/src/httpxy-fetch.ts", port: 3002 },
  { name: "fast-proxy", script: "bench/src/fast-proxy.ts", port: 3003 },
  { name: "@fastify/http-proxy", script: "bench/src/fastify.ts", port: 3004 },
  { name: "http-proxy-3", script: "bench/src/http-proxy-3.ts", port: 3005 },
  { name: "http-proxy", script: "bench/src/http-proxy.ts", port: 3006 },
];

// ~1KB JSON POST payload
export const POST_BODY = JSON.stringify({
  message: "hello world".repeat(30),
  ts: 1234567890,
  padding: "x".repeat(1024 - 360),
});
