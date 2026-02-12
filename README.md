# 🔀 httpxy

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![Codecov][codecov-src]][codecov-href]

A Full-Featured HTTP and WebSocket Proxy for Node.js forked from [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy) with modern Typescript rewrite.

## Usage

Install package:

```sh
npx nypm i -D httpxy
```

Create proxy:

```ts
import { createServer } from "node:http";
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({});

const server = createServer(async (req, res) => {
  try {
    await proxy.web(req, res, {
      target: address /* address of your proxy server here */,
    });
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Proxy error: " + error.toString());
  }
});

server.listen(3000, () => {
  console.log("Proxy is listening on http://localhost:3000");
});
```

## Options

| Option                  | Type                                   | Default  | Description                                                         |
| ----------------------- | -------------------------------------- | -------- | ------------------------------------------------------------------- |
| `target`                | `string \| URL \| ProxyTargetDetailed` | —        | Target server URL                                                   |
| `forward`               | `string \| URL`                        | —        | Forward server URL (pipes request without the target's response)    |
| `agent`                 | `http.Agent`                           | —        | Object passed to `http(s).request` for connection pooling           |
| `ssl`                   | `https.ServerOptions`                  | —        | Object passed to `https.createServer()`                             |
| `ws`                    | `boolean`                              | `false`  | Enable WebSocket proxying                                           |
| `xfwd`                  | `boolean`                              | `false`  | Add `x-forwarded-*` headers                                         |
| `secure`                | `boolean`                              | —        | Verify SSL certificates                                             |
| `toProxy`               | `boolean`                              | `false`  | Pass absolute URL as path (proxy-to-proxy)                          |
| `prependPath`           | `boolean`                              | `true`   | Prepend the target's path to the proxy path                         |
| `ignorePath`            | `boolean`                              | `false`  | Ignore the incoming request path                                    |
| `localAddress`          | `string`                               | —        | Local interface to bind for outgoing connections                    |
| `changeOrigin`          | `boolean`                              | `false`  | Change the `Host` header to match the target URL                    |
| `preserveHeaderKeyCase` | `boolean`                              | `false`  | Keep original letter case of response header keys                   |
| `auth`                  | `string`                               | —        | Basic authentication (`'user:password'`) for `Authorization` header |
| `hostRewrite`           | `string`                               | —        | Rewrite the `Location` hostname on redirects (301/302/307/308)      |
| `autoRewrite`           | `boolean`                              | `false`  | Rewrite `Location` host/port on redirects based on the request      |
| `protocolRewrite`       | `string`                               | —        | Rewrite `Location` protocol on redirects (`'http'` or `'https'`)    |
| `cookieDomainRewrite`   | `false \| string \| object`            | `false`  | Rewrite domain of `Set-Cookie` headers                              |
| `cookiePathRewrite`     | `false \| string \| object`            | `false`  | Rewrite path of `Set-Cookie` headers                                |
| `headers`               | `object`                               | —        | Extra headers to add to target requests                             |
| `proxyTimeout`          | `number`                               | `120000` | Timeout (ms) for the proxy request to the target                    |
| `timeout`               | `number`                               | —        | Timeout (ms) for the incoming request                               |
| `selfHandleResponse`    | `boolean`                              | `false`  | Disable automatic response piping (handle `proxyRes` yourself)      |
| `buffer`                | `stream.Stream`                        | —        | Stream to use as request body instead of the incoming request       |

> [!NOTE]
> `followRedirects` from [node-http-proxy](https://github.com/http-party/node-http-proxy) is **not** supported.

## Events

| Event        | Arguments                                | Description                                            |
| ------------ | ---------------------------------------- | ------------------------------------------------------ |
| `error`      | `(err, req, res, target)`                | An error occurred during proxying                      |
| `proxyReq`   | `(proxyReq, req, res, options)`          | Before request is sent to target (modify headers here) |
| `proxyRes`   | `(proxyRes, req, res)`                   | Response received from target                          |
| `proxyReqWs` | `(proxyReq, req, socket, options, head)` | Before WebSocket upgrade request is sent               |
| `open`       | `(proxySocket)`                          | WebSocket connection opened                            |
| `close`      | `(proxyRes, proxySocket, proxyHead)`     | WebSocket connection closed                            |
| `start`      | `(req, res, target)`                     | Proxy processing started                               |
| `end`        | `(req, res, proxyRes)`                   | Proxy request completed                                |

## Examples

### HTTP Proxy

```ts
import { createServer } from "node:http";
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({});

const server = createServer(async (req, res) => {
  await proxy.web(req, res, { target: "http://localhost:8080" });
});

server.listen(3000);
```

### WebSocket Proxy

```ts
import { createServer } from "node:http";
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({ target: "http://localhost:8080", ws: true });

const server = createServer(async (req, res) => {
  await proxy.web(req, res);
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, { target: "http://localhost:8080" }, head);
});

server.listen(3000);
```

### Modify Request Headers

```ts
import { createServer } from "node:http";
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({ target: "http://localhost:8080" });

proxy.on("proxyReq", (proxyReq) => {
  proxyReq.setHeader("X-Forwarded-By", "httpxy");
});

const server = createServer(async (req, res) => {
  await proxy.web(req, res);
});

server.listen(3000);
```

### HTTPS Proxy

```ts
import { readFileSync } from "node:fs";
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({
  ssl: {
    key: readFileSync("server-key.pem", "utf8"),
    cert: readFileSync("server-cert.pem", "utf8"),
  },
  target: "https://localhost:8443",
  secure: false, // allow self-signed certificates
});

proxy.listen(3000);
```

### Standalone Proxy Server

```ts
import { createProxyServer } from "httpxy";

const proxy = createProxyServer({
  target: "http://localhost:8080",
  changeOrigin: true,
});

proxy.listen(3000);
```

## Development

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

Made with 💛

Published under [MIT License](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/httpxy?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/httpxy
[npm-downloads-src]: https://img.shields.io/npm/dm/httpxy?style=flat&colorA=18181B&colorB=F0DB4F
[npm-downloads-href]: https://npmjs.com/package/httpxy
[codecov-src]: https://img.shields.io/codecov/c/gh/unjs/httpxy/main?style=flat&colorA=18181B&colorB=F0DB4F
[codecov-href]: https://codecov.io/gh/unjs/httpxy
[bundle-src]: https://img.shields.io/bundlephobia/minzip/httpxy?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=httpxy
