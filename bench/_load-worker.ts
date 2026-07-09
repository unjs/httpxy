// Load-generator worker — one instance per driver thread.
//
// Owns a share of the total connections, fires closed-loop keep-alive requests
// until its deadline, and posts raw latency samples + counters back to the main
// thread, which merges them into a single result. Runs on its own libuv event
// loop, so N of these can saturate a fast proxy that one JS thread cannot.

import http from "node:http";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";

export interface LoadWorkerData {
  port: number;
  method: string;
  headers: http.OutgoingHttpHeaders;
  body: Uint8Array | null;
  connections: number;
  durationMs: number;
}

export interface LoadWorkerResult {
  latencies: Float64Array; // nanoseconds, unsorted
  bytesRead: number;
  non2xx: number;
  errors: number;
  count: number;
  elapsedSec: number;
}

const { port, method, headers, body, connections, durationMs } = workerData as LoadWorkerData;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: connections,
  maxFreeSockets: connections,
});

const requestOptions: http.RequestOptions = {
  host: "127.0.0.1",
  port,
  path: "/",
  method,
  headers,
  agent,
};

const latencies: number[] = [];
let bytesRead = 0;
let non2xx = 0;
let errors = 0;

function once(): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = http.request(requestOptions, (res) => {
      let len = 0;
      res.on("data", (c: Buffer) => {
        len += c.length;
      });
      res.on("end", () => {
        latencies.push((performance.now() - start) * 1e6); // → ns
        bytesRead += len;
        if (res.statusCode! < 200 || res.statusCode! >= 300) non2xx++;
        resolve();
      });
      res.on("error", () => {
        errors++;
        resolve();
      });
    });
    req.on("error", () => {
      errors++;
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

async function connection(deadline: number) {
  while (performance.now() < deadline) {
    await once();
  }
}

const start = performance.now();
const deadline = start + durationMs;
await Promise.all(Array.from({ length: connections }, () => connection(deadline)));
const elapsedSec = (performance.now() - start) / 1000;
agent.destroy();

const samples = Float64Array.from(latencies);
const result: LoadWorkerResult = {
  latencies: samples,
  bytesRead,
  non2xx,
  errors,
  count: samples.length,
  elapsedSec,
};
parentPort!.postMessage(result, [samples.buffer]);
