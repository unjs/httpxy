# 🔀 httpxy

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![Codecov][codecov-src]][codecov-href]

A Full-Featured HTTP and WebSocket Proxy for Node.js forked from [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy) with modern Typescript rewrite.

## Usage

Install package:

```sh
# npm
npm install httpxy

# yarn
yarn add httpxy

# pnpm
pnpm install httpxy
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

Checkout [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy) for more options and examples (note: `followRedirects` is not supported).

### `proxyFetch`

`proxyFetch` is a proxy utility with web standard (`Request`/`Response`) interfaces. It forwards requests to a specific server address (TCP host/port or Unix socket), bypassing the URL's hostname.

```ts
import { proxyFetch } from "httpxy";

// TCP — using a URL string
const res = await proxyFetch("http://127.0.0.1:3000", "http://example.com/api/data");
console.log(await res.json());

// Unix socket — using a URL string
const res2 = await proxyFetch("unix:/tmp/app.sock", "http://localhost/health");
console.log(await res2.text());

// Or use an object for more control
const res3 = await proxyFetch({ host: "127.0.0.1", port: 3000 }, "http://example.com/api/data");
```

It accepts the same `input` and `init` arguments as the global `fetch`, including `Request` objects and streaming bodies, and returns a standard `Response`. Redirects are handled manually by default.

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
