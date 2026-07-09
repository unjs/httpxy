// Shared reporting helpers for the benchmark runners (bench.ts + standalone.ts).

export interface BenchResult {
  rps: number;
  avgLatency: number; // ns
  p50: number; // ns
  p99: number; // ns
  bytesPerSec: number;
}

// --- ANSI helpers ---

export const blue = (s: string) => `\x1B[1;34m${s}\x1B[0m`;
export const green = (s: string) => `\x1B[1;32m${s}\x1B[0m`;

export const info = (msg: string) => console.log(blue(`=> ${msg}`));
export const ok = (msg: string) => console.log(green(`   ${msg}`));

// --- Formatting ---

export function formatNs(ns: number): string {
  return ns < 1e6 ? `${(ns / 1e3).toFixed(0)}µs` : `${(ns / 1e6).toFixed(2)}ms`;
}

export function formatThroughput(bytesPerSec: number): string {
  return bytesPerSec > 1e6
    ? `${(bytesPerSec / 1e6).toFixed(1)}MB/s`
    : `${(bytesPerSec / 1e3).toFixed(0)}KB/s`;
}

export function formatResult(r: BenchResult): string {
  return `${r.rps.toFixed(0)} req/s | ${formatNs(r.avgLatency)} avg | ${formatThroughput(r.bytesPerSec)}`;
}

const HEADERS = ["Proxy", "Req/s", "Scale", "Avg", "P50", "P99", "Throughput"];

export function printTable(title: string, results: [name: string, result: BenchResult][]) {
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
