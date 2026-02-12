# httpxy — Agent Guide

Full-featured HTTP/WebSocket proxy for Node.js. Zero production dependencies. Originally forked from [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy).

## Dual API

- **`createProxyServer(opts)`** / **`ProxyServer`** — Traditional event-driven proxy server with middleware pipeline
- **`proxyFetch(addr, input, init?)`** — Web-standard `Request`/`Response` interface for proxying individual requests

## Source Architecture (`src/`)

```
src/
├── index.ts              — Re-exports (entry point)
├── types.ts              — ProxyTarget, ProxyServerOptions, ProxyTargetDetailed
├── server.ts             — ProxyServer class (EventEmitter), createProxyServer()
├── fetch.ts              — proxyFetch() using Node.js http module → Web Response
├── _utils.ts             — setupOutgoing(), setupSocket(), joinURL(), cookie/header helpers
└── middleware/
    ├── _utils.ts          — Middleware type definitions (ProxyMiddleware, ProxyOutgoingMiddleware)
    ├── web-incoming.ts    — HTTP request passes: deleteLength → timeout → XHeaders → stream
    ├── web-outgoing.ts    — HTTP response passes: removeChunked → setConnection → setRedirectHostRewrite → writeHeaders → writeStatusCode
    └── ws-incoming.ts     — WebSocket passes: checkMethodAndHeader → XHeaders → stream
```

### Request flow (HTTP)

```
Client → ProxyServer.web() → web-incoming passes → http.request(target) → target server
Target response → web-outgoing passes → client response
```

### Request flow (WebSocket)

```
Client upgrade → ProxyServer.ws() → ws-incoming passes → http.request(target)
Target upgrade → bidirectional socket pipe
```

### Request flow (proxyFetch)

```
proxyFetch(addr, request) → http.request to addr → Web Response
```

### Key design patterns

- **Middleware pipeline**: Passes are functions that run in order; returning `true` halts the chain
- **Event-driven**: `ProxyServer` emits lifecycle events (`start`, `proxyReq`, `proxyRes`, `end`, `error`, `open`, `close`)
- **Extensible middleware**: `server.before(type, passName, fn)` / `server.after(type, passName, fn)` to insert custom passes
- **Flexible targets**: TCP (`host:port`), Unix socket (`socketPath`), or URL string

## Behavioral Notes (Source + Tests)

- `proxy.web()` / `proxy.ws()` return a Promise and can either reject (no `error` listener, request/response error) or resolve after `res.close`.
- Per-call options are merged as `{ ...opts, ...server.options }`, so constructor options override per-call options on key conflicts.
- String `target`/`forward` values are normalized to `URL` objects before middleware execution.
- Missing both `target` and `forward` emits `error` with message `"Must provide a proper URL as target"`.
- Middleware names are often empty strings (passes are wrapped arrow functions). Tests use `before("web", "", ...)` / `after("web", "", ...)`.
- `ProxyServer.close()` is a no-op before `listen()`, and sets internal `_server` to `undefined` after close callback.

### HTTP middleware semantics

- Incoming pass order is fixed: `deleteLength -> timeout -> XHeaders -> stream`.
- `deleteLength` applies to both `DELETE` and `OPTIONS` without content length; it sets `content-length: 0` and removes `transfer-encoding`.
- `proxyReq` event is intentionally skipped when request has `expect` header (`100-continue` advisory coverage).
- `selfHandleResponse: true` skips outgoing passes and auto-pipe; callers must finish the response in `proxyRes`.
- `proxyTimeout` aborts upstream request and surfaces timeout errors (tested as `ECONNRESET`).
- `followRedirects: true | number` enables native redirect following (301/302/303/307/308). `true` = max 5 hops, number = custom max.
- On 301/302/303 redirects, method changes to GET and request body is dropped.
- On 307/308 redirects, original method and body are preserved (body is buffered on first request for replay).
- `proxyRes` event fires only for the final (non-redirect) response; `proxyReq` fires for each request including redirects.
- Sensitive headers (`authorization`, `cookie`) are stripped on cross-origin redirects.
- When `followRedirects` is enabled, the request body is tee'd (written to proxy request and buffered simultaneously) rather than piped.

### WebSocket middleware semantics

- Incoming pass order is fixed: `checkMethodAndHeader -> XHeaders -> stream`.
- WS requests must be `GET` with `upgrade: websocket`; otherwise socket is destroyed and the chain stops.
- `proxyReqWs`, `open`, `close`, and deprecated `proxySocket` events are part of tested flow.
- Upgrade response headers preserve repeated headers like multiple `Set-Cookie` values.

### Outgoing response semantics

- Outgoing pass order is fixed: `removeChunked -> setConnection -> setRedirectHostRewrite -> writeHeaders -> writeStatusCode`.
- Redirect rewrite applies on `201`, `301`, `302`, `307`, `308` only, and only when `Location` host matches `target.host`.
- `hostRewrite` takes precedence over `autoRewrite`; `protocolRewrite` composes with either.
- Cookie rewriting supports string or mapping config (including wildcard `"*"` and empty string for removal).
- `preserveHeaderKeyCase` uses `rawHeaders` when available.

### URL/path handling invariants

- Path joining does not normalize repeated slashes (`/a/b//c` stays as-is).
- `joinURL()` always returns a usable path and avoids duplicate slash insertion.
- `toProxy: true` preserves absolute URL in outgoing path as `"/" + req.url`.
- `ignorePath` drops request path; with `prependPath: false` the outgoing path becomes `/`.

### `proxyFetch` semantics

- `proxyFetch` is HTTP-only upstream (`node:http` request); HTTPS upstream targets are not supported.
- `addr` accepts `http://host:port`, `unix:/path.sock`, or object form `{ host, port }` / `{ socketPath }`.
- Redirect mode defaults to `manual`.
- Streaming request bodies are supported (`ReadableStream`) and set `duplex: "half"`.
- Hop-by-hop response headers `transfer-encoding`, `keep-alive`, `connection` are stripped.
- Response body is `null` for `204` and `304`.
- Network and request-body-stream errors reject the Promise.

## Tests (`test/`)

```
test/
├── index.test.ts                  — Main proxy: paths, headers, changeOrigin, xfwd, WebSocket, errors
├── fetch.test.ts                  — proxyFetch: TCP/Unix, GET/POST, redirects, cookies, 204/304
├── http-proxy.test.ts             — Forward, target, WebSocket, socket.io, SSE, timeouts, error events
├── https-proxy.test.ts            — HTTPS targets, SSL certs, certificate validation
├── _utils.test.ts                 — setupOutgoing, setupSocket, path joining, auth, changeOrigin
├── types.test-d.ts                — TypeScript type assertions (vitest typecheck)
└── middleware/
    ├── web-incoming.test.ts       — deleteLength, timeout, XHeaders
    ├── web-outgoing.test.ts       — Redirect rewrite, writeHeaders, cookies, status codes
    └── ws-incoming.test.ts        — Method/header validation, error handling
```

### Running tests

```bash
pnpm vitest run test/<file>       # Single test file
pnpm vitest run                   # All tests
pnpm test                         # Lint + typecheck + tests with coverage
```

### Test expectations and parity

- The suite includes legacy parity tests ported from `http-party/node-http-proxy` plus project-specific tests (`test/server.test.ts`, `test/fetch.test.ts`, `test/types.test-d.ts`).
- `followRedirects` is natively implemented (no external dependency). See behavioral notes below.
- HTTPS tests rely on local fixtures in `test/fixtures/agent2-*.pem`.

## Tooling

| Tool      | Command          | Notes                                         |
| --------- | ---------------- | --------------------------------------------- |
| Build     | `pnpm build`     | Uses `unbuild` → CJS + ESM + types in `dist/` |
| Dev       | `pnpm dev`       | Vitest watch mode                             |
| Lint      | `pnpm lint`      | `oxlint` + `oxfmt --check`                    |
| Format    | `pnpm fmt`       | `oxlint --fix` + `oxfmt`                      |
| Typecheck | `pnpm typecheck` | `tsgo --noEmit` (native TS preview)           |
| Test      | `pnpm test`      | Full: lint + typecheck + vitest with coverage |

## Key Types

```ts
type ProxyTarget = string | URL | ProxyTargetDetailed;

interface ProxyTargetDetailed {
  host?: string;
  port?: number | string;
  protocol?: string;
  hostname?: string;
  socketPath?: string;
  // TLS: key, passphrase, pfx, cert, ca, ciphers, secureProtocol
}

interface ProxyServerOptions {
  target?: ProxyTarget; // Proxy destination
  forward?: ProxyTarget; // Forward destination
  ws?: boolean; // Enable WebSocket proxying
  xfwd?: boolean; // Add x-forwarded-* headers
  changeOrigin?: boolean; // Rewrite Host header to target
  // ... 30+ more options for paths, headers, cookies, TLS, timeouts
}
```

## Conventions

- ESM only (`"type": "module"`)
- Strict TypeScript with `nodenext` module resolution
- Internal files prefixed with `_` (e.g., `_utils.ts`)
- Tests use `vitest` + `expect.js` assertions
- No production dependencies — Node.js built-ins only
- Semantic commits: `feat(scope):`, `fix(scope):`, `test:`, `chore:`

## Maintenance

- Keep `AGENTS.md` and `README.md` in sync with the current codebase.
- When you discover new behavior, constraints, architecture details, or workflows, document them in `AGENTS.md` for future agents.
- When implementation or design changes affect user-facing usage or project expectations, update `README.md` in the same change.
- Always add or update automated tests for behavior changes and bug fixes, including regression coverage that would fail without the change.
