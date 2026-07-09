#!/usr/bin/env node

// Standalone benchmark runner — no Docker required.
//
// Spawns the target + each proxy as local Node child processes and drives them
// with a built-in, zero-dependency HTTP load generator.
//
// The load generator is multi-threaded (worker_threads): the connection pool is
// split across N driver threads, each on its own libuv event loop, so a fast proxy
// is not bottlenecked by a single JS thread. Threads default to the driver's pinned
// core count (see below) and are overridable with `-t`.
//
// Isolation: Docker mode pins the target and every proxy to `--cpus=1` while the
// load driver runs unrestricted. We approximate that with `taskset` (Linux only):
// the target and each proxy get a dedicated CPU core, and the load generator is
// pinned to a disjoint upper set of cores so the driver never steals a proxy's
// core. Worker threads inherit the process affinity mask, so the kernel spreads
// them across the driver cores. Off Linux / without taskset this falls back to no
// pinning, and the numbers get noisier (driver, target, and proxy contend for the
// same cores). The Docker `--memory=256m` cap has no portable equivalent and is
// not replicated. Either way, treat results as relative comparisons on this host.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { parseArgs } from "node:util";
import { type BenchResult, info, ok, formatResult, printTable } from "./_report.ts";
import { PROXIES, TARGET_PORT, POST_BODY } from "./_config.ts";
import type { LoadWorkerData, LoadWorkerResult } from "./_load-worker.ts";

// --- Config ---

const { values: args } = parseArgs({
  options: {
    duration: { type: "string", short: "d", default: "10s" },
    connections: { type: "string", short: "c", default: "50" },
    warmup: { type: "string", short: "w", default: "1s" },
    threads: { type: "string", short: "t" },
    sequential: { type: "boolean", short: "s", default: true },
  },
});

const DURATION_MS = parseDuration(args.duration!);
const WARMUP_MS = parseDuration(args.warmup!);
const CONNECTIONS = Number(args.connections);
const SEQUENTIAL = args.sequential!;
const ROOT = `${import.meta.dirname}/..`;
const TARGET = `http://127.0.0.1:${TARGET_PORT}`;
const WORKER_URL = new URL("./_load-worker.ts", import.meta.url);

function parseDuration(v: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/.exec(v.trim());
  if (!m) throw new Error(`Invalid duration: ${v}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms": {
      return n;
    }
    case "m": {
      return n * 60_000;
    }
    default: {
      return n * 1000;
    }
  }
}

// --- CPU isolation plan ---

const CPU_COUNT = os.availableParallelism?.() ?? os.cpus().length;

function tasksetAvailable(): boolean {
  if (process.platform !== "linux") return false;
  try {
    execFileSync("taskset", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Need at least: 1 core for the target, 1 for a proxy, and 2 for the driver.
const PIN = tasksetAvailable() && CPU_COUNT >= 4;

const range = (lo: number, hi: number): number[] =>
  hi < lo ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

// cpu0 → target; lower half → one core per proxy (round-robin if scarce);
// upper half → load generator (disjoint from target + proxies).
const TARGET_CORE = 0;
const GEN_LOW = Math.ceil(CPU_COUNT / 2);
const GENERATOR_CORES = range(GEN_LOW, CPU_COUNT - 1);
const PROXY_CORE_POOL = range(1, GEN_LOW - 1);
const proxyCore = (i: number): number => PROXY_CORE_POOL[i % PROXY_CORE_POOL.length]!;

// Driver threads: default to the number of cores the driver is pinned to (so each
// thread gets a core), else a modest share of the host. Never more than one thread
// per connection.
const DEFAULT_THREADS = PIN ? GENERATOR_CORES.length : Math.max(1, Math.min(4, CPU_COUNT - 2));
const THREADS = Math.max(
  1,
  Math.min(args.threads ? Number(args.threads) : DEFAULT_THREADS, CONNECTIONS),
);

// --- Process management ---

const children: ChildProcess[] = [];

function cleanup() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGKILL");
  }
  children.length = 0;
}

function spawnServer(script: string, port: number, core: number): ChildProcess {
  // Pin to a dedicated core (mimics Docker's `--cpus=1`) when taskset is available.
  const command = PIN ? "taskset" : "node";
  const commandArgs = PIN ? ["-c", String(core), "node", script] : [script];
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), TARGET },
    // Surface crashes on stderr; discard the "listening on ..." chatter.
    stdio: ["ignore", "ignore", "inherit"],
  });
  child.on("error", (error) => {
    console.error(`Failed to spawn ${script}:`, error);
  });
  children.push(child);
  return child;
}

function waitForReady(port: number, retries = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (++attempts >= retries) {
        reject(new Error(`Timed out waiting for port ${port}`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

// --- Load generator (multi-threaded driver) ---

interface LoadOptions {
  port: number;
  method: string;
  headers: http.OutgoingHttpHeaders;
  body?: Buffer;
  connections: number;
  durationMs: number;
}

// Distribute `total` connections as evenly as possible across `threads`.
function splitConnections(total: number, threads: number): number[] {
  const base = Math.floor(total / threads);
  const rem = total % threads;
  return Array.from({ length: threads }, (_, i) => base + (i < rem ? 1 : 0)).filter((n) => n > 0);
}

function runWorker(data: LoadWorkerData): Promise<LoadWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: data });
    worker.once("message", (result: LoadWorkerResult) => {
      void worker.terminate();
      resolve(result);
    });
    worker.once("error", (error) => {
      void worker.terminate();
      reject(error);
    });
  });
}

async function loadTest(opts: LoadOptions): Promise<BenchResult> {
  const { port, method, headers, body, connections, durationMs } = opts;
  const shares = splitConnections(connections, Math.min(THREADS, connections));
  // Exact-size copy so each worker gets its own body (not a slice of Buffer's pool).
  const bodyBytes = body ? Uint8Array.from(body) : null;

  const results = await Promise.all(
    shares.map((conns) =>
      runWorker({ port, method, headers, body: bodyBytes, connections: conns, durationMs }),
    ),
  );

  const non2xx = results.reduce((a, r) => a + r.non2xx, 0);
  const errors = results.reduce((a, r) => a + r.errors, 0);
  if (non2xx > 0) throw new Error(`Non-2xx responses: ${non2xx}`);
  if (errors > 0) throw new Error(`Transport errors: ${errors}`);

  // Merge latency samples from every thread, then derive stats.
  const total = results.reduce((a, r) => a + r.count, 0);
  const merged = new Float64Array(total);
  let offset = 0;
  let bytesRead = 0;
  for (const r of results) {
    merged.set(r.latencies, offset);
    offset += r.count;
    bytesRead += r.bytesRead;
  }
  merged.sort();

  // Threads run concurrently for ~the same span; average their elapsed so rps and
  // throughput reflect aggregate work over the wall-clock window.
  const elapsedSec = results.reduce((a, r) => a + r.elapsedSec, 0) / results.length;
  const sum = merged.reduce((a, b) => a + b, 0);
  const percentile = (p: number) =>
    merged.length === 0
      ? 0
      : merged[Math.min(merged.length - 1, Math.floor((p / 100) * merged.length))]!;

  return {
    rps: total / elapsedSec,
    avgLatency: total > 0 ? sum / total : 0,
    p50: percentile(50),
    p99: percentile(99),
    bytesPerSec: bytesRead / elapsedSec,
  };
}

// --- Main ---

process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

info("Running validation tests...");
await new Promise<void>((resolve, reject) => {
  const test = spawn("node", ["bench/test.ts"], { cwd: ROOT, stdio: "inherit" });
  test.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Validation failed (exit ${code})`)),
  );
});
ok("All implementations valid");

if (PIN) {
  // Pin the load generator (this process) to cores disjoint from target + proxies.
  try {
    execFileSync("taskset", ["-pc", GENERATOR_CORES.join(","), String(process.pid)], {
      stdio: "ignore",
    });
    info(
      `CPU isolation: target→cpu${TARGET_CORE}, proxies→cpu[${PROXY_CORE_POOL.join(",")}], driver→cpu[${GENERATOR_CORES.join(",")}]`,
    );
  } catch {
    // Non-fatal: proxies are still pinned even if the driver pin fails.
  }
} else {
  info(
    `CPU isolation: disabled (${process.platform === "linux" ? "taskset unavailable or <4 cores" : "non-Linux"}) — expect noisier numbers`,
  );
}

info("Starting target server...");
spawnServer("bench/src/target.ts", TARGET_PORT, TARGET_CORE);
await waitForReady(TARGET_PORT);
ok("target ready");

info("Starting proxy servers...");
PROXIES.forEach(({ script, port }, i) => spawnServer(script, port, proxyCore(i)));
for (const { name, port } of PROXIES) {
  await waitForReady(port);
  ok(`${name} ready`);
}
console.log();

async function runBench(
  label: string,
  method: string,
  body?: Buffer,
): Promise<[string, BenchResult][]> {
  info(
    `Benchmarking ${label} (duration=${args.duration}, connections=${CONNECTIONS}, threads=${THREADS}${SEQUENTIAL ? ", sequential" : ""})`,
  );
  const headers: http.OutgoingHttpHeaders = body
    ? { "content-type": "application/json", "content-length": body.length }
    : {};

  const benchOne = async ({
    name,
    port,
  }: (typeof PROXIES)[number]): Promise<[string, BenchResult]> => {
    // Warm up the connection pool / JIT before measuring.
    if (WARMUP_MS > 0) {
      await loadTest({
        port,
        method,
        headers,
        body,
        connections: CONNECTIONS,
        durationMs: WARMUP_MS,
      });
    }
    const result = await loadTest({
      port,
      method,
      headers,
      body,
      connections: CONNECTIONS,
      durationMs: DURATION_MS,
    });
    ok(`${name} — ${formatResult(result)}`);
    return [name, result];
  };

  let results: [string, BenchResult][];
  if (SEQUENTIAL) {
    results = [];
    for (const proxy of PROXIES) {
      results.push(await benchOne(proxy));
    }
  } else {
    results = await Promise.all(PROXIES.map(benchOne));
  }
  console.log();
  return results;
}

const getResults = await runBench("GET", "GET");
const postResults = await runBench("POST ~1KB JSON", "POST", Buffer.from(POST_BODY));

// --- Summary ---

console.log();
info("Summary");
console.log();
console.log(
  `> Duration: **${args.duration}** | Connections: **${CONNECTIONS}** | Driver threads: **${THREADS}** | Mode: **${SEQUENTIAL ? "sequential" : "parallel"}** | Runner: **standalone** | CPU isolation: **${PIN ? "taskset (1 core/proxy)" : "off"}**`,
);

printTable("GET (no body)", getResults);
console.log();
printTable("POST (~1KB JSON)", postResults);
console.log();
info("Done!");

process.exit(0);
