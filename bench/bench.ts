#!/usr/bin/env node

import { execSync, execFileSync } from "node:child_process";

// --- Config ---

const IMAGE = "httpxy-bench";
const DURATION = process.env.DURATION || "1s";
const CONNECTIONS = process.env.CONNECTIONS || "128";
const POST_BODY = '{"message":"hello world","ts":1234567890}';
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

const bold = (s: string) => `\x1B[1m${s}\x1B[0m`;
const blue = (s: string) => `\x1B[1;34m${s}\x1B[0m`;
const green = (s: string) => `\x1B[1;32m${s}\x1B[0m`;
const red = (s: string) => `\x1B[1;31m${s}\x1B[0m`;
const yellow = (s: string) => `\x1B[1;33m${s}\x1B[0m`;

const info = (msg: string) => console.log(blue(`=> ${msg}`));
const ok = (msg: string) => console.log(green(`   ${msg}`));
const err = (msg: string) => console.log(red(`   ${msg}`));

const containers: string[] = [];

function cleanup() {
  info("Cleaning up...");
  try {
    const ids = execSync('docker ps -q --filter "name=bench-"', { encoding: "utf8" }).trim();
    if (ids) {
      execSync(`docker rm -f ${ids.split("\n").join(" ")}`, { stdio: "ignore" });
    }
  } catch {}
}

function startContainer(name: string, script: string, port: number) {
  const cid = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      "host",
      "--cpus=1",
      "--memory=256m",
      "-e",
      `PORT=${port}`,
      "-e",
      `TARGET=http://127.0.0.1:${TARGET_PORT}`,
      IMAGE,
      "node",
      script,
    ],
    { encoding: "utf8" },
  ).trim();
  containers.push(cid);
}

function bomb(args: string[]) {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      `bench-bombardier-${process.pid}`,
      "--network",
      "host",
      IMAGE,
      "bombardier",
      ...args,
    ],
    { stdio: "inherit" },
  );
}

function bombJson(args: string[]): string {
  return execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      `bench-bombardier-${process.pid}`,
      "--network",
      "host",
      IMAGE,
      "bombardier",
      "--format=json",
      "--print=result",
      ...args,
    ],
    { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
  );
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

// --- Result parsing ---

function formatNs(ns: number): string {
  return ns < 1e6 ? `${(ns / 1e3).toFixed(0)}µs` : `${(ns / 1e6).toFixed(2)}ms`;
}

function parseResult(json: string): string {
  const j = JSON.parse(json);
  const r = j.result;
  const rps = r.rps.mean.toFixed(0);
  const avgLatency = formatNs(r.latency.mean);
  const p50 = formatNs(r.latency?.percentiles?.["0.5"] ?? r.latency?.["50"] ?? 0);
  const p99 = formatNs(r.latency?.percentiles?.["0.99"] ?? r.latency?.["99"] ?? 0);
  const bytesPerSec = r.bytesRead / r.timeTakenSeconds;
  const throughput =
    bytesPerSec > 1e6
      ? `${(bytesPerSec / 1e6).toFixed(1)}MB/s`
      : `${(bytesPerSec / 1e3).toFixed(0)}KB/s`;
  return `${rps}|${avgLatency}|${p50}|${p99}|${throughput}|${bytesPerSec}`;
}

function printTable(title: string, results: [name: string, result: string][]) {
  console.log();
  console.log(bold(title));
  console.log(
    `${"Proxy".padEnd(22)} ${"Req/s".padStart(10)} ${"Scale".padStart(7)} ${"Avg".padStart(10)} ${"P50".padStart(10)} ${"P99".padStart(10)} ${"Throughput".padStart(12)}`,
  );
  console.log(
    `${"─".repeat(22)} ${"─".repeat(10)} ${"─".repeat(7)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(12)}`,
  );

  // Sort by throughput (bytes/sec) descending
  results.sort((a, b) => {
    const aTP = Number.parseFloat(a[1].split("|")[5]!);
    const bTP = Number.parseFloat(b[1].split("|")[5]!);
    return bTP - aTP;
  });

  let bestRps = 0;
  for (const [, result] of results) {
    const rps = Number.parseInt(result.split("|")[0]);
    if (rps > bestRps) bestRps = rps;
  }

  for (const [name, result] of results) {
    const parts = result.split("|");
    const [rps, avg, p50, p99, tp] = [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!];
    const ratio = bestRps > 0 ? Number.parseInt(rps) / bestRps : 0;
    const x = ratio >= 1 ? "1.00x" : `${ratio.toFixed(2)}x`;
    console.log(
      `${name.padEnd(22)} ${rps.padStart(10)} ${x.padStart(7)} ${avg.padStart(10)} ${p50.padStart(10)} ${p99.padStart(10)} ${tp.padStart(12)}`,
    );
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

// --- GET benchmark ---

const getResults: [string, string][] = [];

info(`Benchmarking GET (duration=${DURATION}, connections=${CONNECTIONS})`);
console.log("━".repeat(63));
for (const { name, port } of PROXIES) {
  console.log(`\n${yellow(`▸ ${name}`)}`);
  bomb(["-c", CONNECTIONS, "-d", DURATION, "--latencies", `http://127.0.0.1:${port}/`]);
  const json = bombJson(["-c", CONNECTIONS, "-d", DURATION, `http://127.0.0.1:${port}/`]);
  getResults.push([name, parseResult(json)]);
}

console.log();

// --- POST benchmark ---

const postResults: [string, string][] = [];

info(`Benchmarking POST ~1KB JSON (duration=${DURATION}, connections=${CONNECTIONS})`);
console.log("━".repeat(63));
for (const { name, port } of PROXIES) {
  console.log(`\n${yellow(`▸ ${name}`)}`);
  bomb([
    "-c",
    CONNECTIONS,
    "-d",
    DURATION,
    "-m",
    "POST",
    "-H",
    "Content-Type: application/json",
    "-b",
    POST_BODY,
    "--latencies",
    `http://127.0.0.1:${port}/`,
  ]);
  const json = bombJson([
    "-c",
    CONNECTIONS,
    "-d",
    DURATION,
    "-m",
    "POST",
    "-H",
    "Content-Type: application/json",
    "-b",
    POST_BODY,
    `http://127.0.0.1:${port}/`,
  ]);
  postResults.push([name, parseResult(json)]);
}

// --- Summary ---

console.log();
console.log("━".repeat(63));
info("Summary");
console.log("━".repeat(63));

printTable("GET (no body)", getResults);
console.log();
printTable("POST (~1KB JSON)", postResults);
console.log();
info("Done!");
