#!/usr/bin/env node
// Ecosystem test runner: builds & packs httpxy, clones an upstream consumer
// in a temp dir, installs deps with the local tarball overriding the published
// httpxy version, and runs the consumer's test suite.
//
// Usage:
//   node scripts/ecosystem-test.mjs [target]
//
// Targets:
//   http-proxy-middleware (default)
//
// Env:
//   KEEP=1      Keep temp dirs after run for debugging.
//   REF=<ref>   Git ref to check out from the upstream repo (branch/tag/sha).

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = {
  "http-proxy-middleware": {
    repo: "https://github.com/chimurai/http-proxy-middleware.git",
    // TODO: revert to default branch once `httpxy-0.5.2` is merged upstream.
    ref: "httpxy-0.5.2",
    install: "yarn install --ignore-scripts",
    steps: ["yarn build", "yarn test"],
  },
};

const targetName = process.argv[2] || "http-proxy-middleware";
const target = TARGETS[targetName];
if (!target) {
  console.error(`Unknown target: ${targetName}`);
  console.error(`Available: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const KEEP = process.env.KEEP === "1";
const REF = process.env.REF;

const packDir = mkdtempSync(join(tmpdir(), "httpxy-pack-"));
const workDir = mkdtempSync(join(tmpdir(), `httpxy-eco-${targetName}-`));
const upstreamDir = join(workDir, targetName);

const cleanup = () => {
  if (KEEP) {
    console.log(`\n(KEEP=1) Leaving artifacts:`);
    console.log(`  pack:     ${packDir}`);
    console.log(`  upstream: ${upstreamDir}`);
    return;
  }
  rmSync(packDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
};

process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

const run = (cmd, cwd = ROOT) => {
  console.log(`\n$ (${cwd === ROOT ? "httpxy" : targetName}) ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
};

// 1. Build httpxy and pack into a tarball
run("pnpm build");
run(`npm pack --pack-destination ${packDir}`);
const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
if (!tarball) {
  throw new Error(`No tarball produced in ${packDir}`);
}
const tarballPath = join(packDir, tarball);
console.log(`\nPacked: ${tarballPath}`);

// 2. Clone upstream consumer at a shallow depth
const ref = REF || target.ref;
const branchArg = ref ? `--branch ${ref} ` : "";
run(`git clone --depth 1 ${branchArg}${target.repo} ${upstreamDir}`);

// 3. Pin httpxy to the local tarball via deps + yarn `resolutions`
const pkgPath = join(upstreamDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const fileSpec = `file:${tarballPath}`;
if (pkg.dependencies?.httpxy) pkg.dependencies.httpxy = fileSpec;
if (pkg.devDependencies?.httpxy) pkg.devDependencies.httpxy = fileSpec;
pkg.resolutions = { ...pkg.resolutions, httpxy: fileSpec };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`\nPatched ${pkgPath} to use ${fileSpec}`);

// 4. Install deps and run upstream tests
run(target.install, upstreamDir);
for (const step of target.steps) {
  run(step, upstreamDir);
}

console.log(`\n✓ ${targetName} tests passed against local httpxy build`);
