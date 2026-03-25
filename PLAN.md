# httpxy Optimization Plan

## Optimization Opportunities (from fast-proxy analysis)

### 1. Connection Pooling / Agent Reuse (HIGH impact)
- fast-proxy creates a persistent `http.Agent` with keepAlive:true, 2048 maxSockets at factory time
- httpxy creates no agent by default — every request opens a new TCP connection
- **Action**: Add default keep-alive agent option to `ProxyServer` constructor and `proxyFetch`

### 2. URL Parse Caching (HIGH impact)
- fast-proxy caches parsed URLs in LRU (`tiny-lru`, 100 entries)
- httpxy calls `new URL()` on every request in `_createProxyFn` (server.ts:200-202)
- **Action**: Cache URL objects for string targets (same string -> same URL)

### 3. Avoid Double Header Copying (MEDIUM-HIGH impact)
- `setupOutgoing()` spreads `req.headers` then spreads again with `options.headers`
- 2 full header object allocations per request
- **Action**: Single `Object.assign()` or mutate-in-place

### 4. Compile Cookie Rewrite Regex (MEDIUM impact)
- `rewriteCookieProperty()` creates `new RegExp()` for every Set-Cookie header
- Pattern for "domain"/"path" is static
- **Action**: Pre-compile and cache regex per property name

### 5. Replace Regex in `getPort()` (LOW-MEDIUM impact)
- `hostHeader.match(/:(\d+)/)` allocates match array on every `xfwd` request
- **Action**: Use `indexOf(':')` + `substring()` — zero allocation

### 6. Lazy Redirect Body Buffering (MEDIUM impact)
- web-incoming stream pass sets up `chunks: Buffer[]` + tee pattern when `maxRedirects > 0`
- Buffering happens even for non-redirect responses
- **Action**: Defer buffering until redirect actually occurs

### 7. `setImmediate` Yielding (LOW-MEDIUM impact)
- fast-proxy wraps response callbacks in `setImmediate()` for event loop fairness
- httpxy processes responses synchronously
- **Action**: Consider yielding before outgoing passes under high concurrency

## What NOT to adopt from fast-proxy
- Dropping WebSocket support (httpxy's key differentiator)
- Removing the event system (essential for observability)
- Always-on changeOrigin (httpxy's opt-in is more correct)
- External deps (undici, pump, tiny-lru) — zero-dep policy is a strength

## Benchmark Suite

Compare using `mitata`:
- **httpxy** `ProxyServer.web()` (event-driven server)
- **httpxy** `proxyFetch()` (web-standard fetch)
- **fast-proxy** (fastify/fast-proxy)
- **fastify-http-proxy** (@fastify/http-proxy)
- **http-proxy-3** (sagemathinc/http-proxy-3)

### Scenarios
1. Simple GET proxy (no body)
2. POST proxy with JSON body (~1KB)
3. Large body proxy (~100KB)

Benchmark source: `bench/index.ts`

## Key Takeaways (from benchmark results)

- **fast-proxy / @fastify/http-proxy are 3-4x faster** on GET and small POST — almost entirely due to connection pooling (`keepAlive` agent with 2048 sockets created once)
- **httpxy and http-proxy-3 show similar performance** — both lack default connection reuse
- The gap **narrows on large bodies (~100KB)** — network I/O dominates, so the overhead difference becomes proportionally smaller
- **proxyFetch** is competitive with server mode on GET but slightly slower on large POST due to body buffering + `Readable.toWeb()` conversion
- This confirms **agent reuse / connection pooling (optimization #1) is the dominant factor** — it alone would likely close 60-70% of the gap
