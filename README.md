# httpxy

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![Codecov][codecov-src]][codecov-href]

A full-featured HTTP proxy for Node.js.

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

Import:

```ts
// CommonJS
const { createProxyServer } = require("httpxy");

// ESM
import { createProxyServer } from "httpxy";
```

Create proxy:

```ts
const proxy = createProxyServer();

proxy.web(req, res, opts);
proxy.ws(req, res.opts);
```

Checkout [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy) for more options and examples.

## Development

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

Made with 💛

Based on [http-party/node-http-proxy](https://github.com/http-party/node-http-proxy).

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
