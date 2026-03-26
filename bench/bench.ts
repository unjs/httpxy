#!/usr/bin/env node

import { execSync, execFileSync, execFile as _execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(_execFile);

// --- Config ---

const { values: args } = parseArgs({
  options: {
    duration: { type: "string", short: "d", default: "1s" },
    connections: { type: "string", short: "c", default: "128" },
    sequential: { type: "boolean", short: "s", default: true },
  },
});

const IMAGE = "httpxy-bench";
const DURATION = args.duration!;
const CONNECTIONS = Number(args.connections);
const SEQUENTIAL = args.sequential!;
const POST_BODY = JSON.stringify({
  message: "hello world".repeat(30),
  ts: 1234567890,
  padding: "x".repeat(1024 - 360),
}); // ~1KB
const TARGET_PORT = 3000;

const PROXIES = [
  { name: "httpxy.server", script: "bench/src/httpxy-server.ts", port: 3001 },
  { name: "httpxy.proxyFetch", script: "bench/src/httpxy-fetch.ts", port: 3002 },
  { name: "fast-proxy", script: "bench/src/fast-proxy.ts", port: 3003 },
  { name: "@fastify/http-proxy", script: "bench/src/fastify.ts", port: 3004 },
  { name: "http-proxy-3", script: "bench/src/http-proxy-3.ts", port: 3005 },
  { name: "http-proxy", script: "bench/src/http-proxy.ts", port: 3006 },
];

// --- Helpers ---

const blue = (s: string) => `\x1B[1;34m${s}\x1B[0m`;
const green = (s: string) => `\x1B[1;32m${s}\x1B[0m`;
// const red = (s: string) => `\x1B[1;31m${s}\x1B[0m`;

const info = (msg: string) => console.log(blue(`=> ${msg}`));
const ok = (msg: string) => console.log(green(`   ${msg}`));
// const err = (msg: string) => console.log(red(`   ${msg}`));

const containers: string[] = [];

function cleanup() {
  info("Cleaning up...");
  if (containers.length === 0) return;
  try {
    execSync(`docker rm -f ${containers.join(" ")}`, { stdio: "ignore" });
  } catch {}
  containers.length = 0;
}

function dockerRun(...args: string[]) {
  return execFileSync("docker", ["run", "--rm", "--network", "host", ...args], {
    encoding: "utf8",
  }).trim();
}

function startContainer(name: string, script: string, port: number) {
  const cid = dockerRun(
    "-d",
    "--name",
    name,
    "--cpus=1",
    "--memory=256m",
    "-e",
    `PORT=${port}`,
    "-e",
    `TARGET=http://127.0.0.1:${TARGET_PORT}`,
    IMAGE,
    "node",
    script,
  );
  containers.push(cid);
}

let bombCounter = 0;

async function bombJson(args: string[]): Promise<string> {
  const name = `bench-bombardier-${process.pid}-${bombCounter++}`;
  const { stdout } = await execFileAsync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "host",
      "--name",
      name,
      IMAGE,
      "bombardier",
      "--format=json",
      "--print=result",
      "--latencies",
      ...args,
    ],
    { encoding: "utf8" },
  );
  return stdout;
}

function waitForReady(port: number, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      execSync(`curl -sf -o /dev/null http://127.0.0.1:${port}/`, { stdio: "ignore" });
      return;
    } catch {
      execSync("sleep 0.3", { stdio: "ignore" });
    }
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

// --- Bombardier types ---

interface BombardierResult {
  bytesRead: number;
  bytesWritten: number;
  timeTakenSeconds: number;
  req1xx: number;
  req2xx: number;
  req3xx: number;
  req4xx: number;
  req5xx: number;
  others: number;
  errors?: { description: string; count: number }[];
  latency: {
    mean: number; // nanoseconds
    stddev: number;
    max: number;
    percentiles: Record<string, number>; // "50", "75", "90", "95", "99"
  };
  rps: {
    mean: number;
    stddev: number;
    max: number;
    percentiles: Record<string, number>;
  };
}

interface BenchResult {
  rps: number;
  avgLatency: number; // ns
  p50: number; // ns
  p99: number; // ns
  bytesPerSec: number;
}

// --- Result parsing ---

function formatNs(ns: number): string {
  return ns < 1e6 ? `${(ns / 1e3).toFixed(0)}µs` : `${(ns / 1e6).toFixed(2)}ms`;
}

function formatThroughput(bytesPerSec: number): string {
  return bytesPerSec > 1e6
    ? `${(bytesPerSec / 1e6).toFixed(1)}MB/s`
    : `${(bytesPerSec / 1e3).toFixed(0)}KB/s`;
}

function formatResult(r: BenchResult): string {
  return `${r.rps.toFixed(0)} req/s | ${formatNs(r.avgLatency)} avg | ${formatThroughput(r.bytesPerSec)}`;
}

function parseResult(json: string): BenchResult {
  const { result: r } = JSON.parse(json) as { result: BombardierResult };

  const nonOk = r.req1xx + r.req3xx + r.req4xx + r.req5xx + r.others;
  if (nonOk > 0) {
    throw new Error(
      `Non-2xx responses: 1xx=${r.req1xx} 3xx=${r.req3xx} 4xx=${r.req4xx} 5xx=${r.req5xx} other=${r.others}`,
    );
  }
  if (r.errors && r.errors.length > 0) {
    const details = r.errors.map((e) => `${e.description}(${e.count})`).join(", ");
    throw new Error(`Transport errors: ${details}`);
  }

  return {
    rps: r.rps.mean,
    avgLatency: r.latency.mean,
    p50: r.latency.percentiles["50"] ?? 0,
    p99: r.latency.percentiles["99"] ?? 0,
    bytesPerSec: r.bytesRead / r.timeTakenSeconds,
  };
}

const HEADERS = ["Proxy", "Req/s", "Scale", "Avg", "P50", "P99", "Throughput"];

function printTable(title: string, results: [name: string, result: BenchResult][]) {
  // Sort by req/s descending
  results.sort((a, b) => b[1].rps - a[1].rps);
  const bestRps = Math.max(...results.map(([, r]) => r.rps));

  // Build rows
  const rows = results.map(([name, r]) => {
    const ratio = bestRps > 0 ? r.rps / bestRps : 0;
    return [
      name,
      r.rps.toFixed(0),
      ratio >= 1 ? "1.00x" : `${ratio.toFixed(2)}x`,
      formatNs(r.avgLatency),
      formatNs(r.p50),
      formatNs(r.p99),
      formatThroughput(r.bytesPerSec),
    ];
  });

  // Compute column widths from headers + data
  const colWidths = HEADERS.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));

  const mdRow = (cells: string[]) =>
    `| ${cells.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]!) : c.padStart(colWidths[i]!))).join(" | ")} |`;

  console.log();
  console.log(`### ${title}`);
  console.log();
  console.log(mdRow(HEADERS));
  console.log(
    `| ${colWidths.map((w, i) => (i === 0 ? `:${"-".repeat(w - 1)}` : `${"-".repeat(w - 1)}:`)).join(" | ")} |`,
  );
  for (const row of rows) {
    console.log(mdRow(row));
  }
}

// --- Main ---

process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(1));
process.on("SIGTERM", () => process.exit(1));

info("Running validation tests...");
execSync("node bench/test.ts", {
  stdio: "inherit",
  cwd: `${import.meta.dirname}/..`,
});
ok("All implementations valid");

info("Building image...");
execSync(`docker build -t ${IMAGE} -f bench/Dockerfile .`, {
  stdio: "inherit",
  cwd: `${import.meta.dirname}/..`,
});

info("Starting target server...");
startContainer("bench-target", "bench/src/target.ts", TARGET_PORT);
waitForReady(TARGET_PORT);
ok("target ready");

info("Starting proxy servers...");
for (const { name, script, port } of PROXIES) {
  const containerName = `bench-${name.replaceAll(" ", "-").replaceAll(/[@/]/g, "")}`;
  startContainer(containerName, script, port);
}

for (const { name, port } of PROXIES) {
  waitForReady(port);
  ok(`${name} ready`);
}
console.log();

async function runBench(label: string, extraArgs: string[] = []) {
  info(
    `Benchmarking ${label} (duration=${DURATION}, connections=${CONNECTIONS}${SEQUENTIAL ? ", sequential" : ""})`,
  );
  const benchOne = async ({ name, port }: (typeof PROXIES)[number]) => {
    const json = await bombJson([
      "-c",
      String(CONNECTIONS),
      "-d",
      DURATION,
      ...extraArgs,
      `http://127.0.0.1:${port}/`,
    ]);
    const result = parseResult(json);
    ok(`${name} — ${formatResult(result)}`);
    return [name, result] as [string, BenchResult];
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

const getResults = await runBench("GET");
const postResults = await runBench("POST ~1KB JSON", [
  "-m",
  "POST",
  "-H",
  "Content-Type: application/json",
  "-b",
  POST_BODY,
]);

// --- Summary ---

console.log();
info("Summary");
console.log();
console.log(
  `> Duration: **${DURATION}** | Connections: **${CONNECTIONS}** | Mode: **${SEQUENTIAL ? "sequential" : "parallel"}**`,
);

printTable("GET (no body)", getResults);
console.log();
printTable("POST (~1KB JSON)", postResults);
console.log();
info("Done!");
