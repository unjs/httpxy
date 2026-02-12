# Changelog

## v0.3.0

[compare changes](https://github.com/unjs/httpxy/compare/v0.2.2...v0.3.0)

### 🚀 Enhancements

- `proxyFetch` ([#98](https://github.com/unjs/httpxy/pull/98))
- **web-incoming:** Implement native `followRedirects` support ([d3d7f39](https://github.com/unjs/httpxy/commit/d3d7f39))

### 🩹 Fixes

- **proxy:** Ensure leading slash on `toProxy` outgoing path ([7759c94](https://github.com/unjs/httpxy/commit/7759c94))
- **server:** Emit proxy error when listener exists, reject only when unhandled ([c9d2c51](https://github.com/unjs/httpxy/commit/c9d2c51))
- **web-incoming:** Destroy request socket on timeout ([40105be](https://github.com/unjs/httpxy/commit/40105be))
- **utils:** Preserve multiple consecutive slashes in request URL ([18e4d0d](https://github.com/unjs/httpxy/commit/18e4d0d))
- **web-incoming:** Abort proxy request when client disconnects ([a5d4996](https://github.com/unjs/httpxy/commit/a5d4996))
- **ws:** Handle client socket errors before upstream upgrade ([aebb5c6](https://github.com/unjs/httpxy/commit/aebb5c6))

### 💅 Refactors

- ⚠️  Remove legacy node `Url` support ([b2e6c92](https://github.com/unjs/httpxy/commit/b2e6c92))

### 🏡 Chore

- Enable strict typescript with nodenext resolution ([0c147a3](https://github.com/unjs/httpxy/commit/0c147a3))
- Format repo ([d7e707f](https://github.com/unjs/httpxy/commit/d7e707f))
- Update readme ([24f8b1a](https://github.com/unjs/httpxy/commit/24f8b1a))
- Add more examples for proxy fetch ([d0cb298](https://github.com/unjs/httpxy/commit/d0cb298))
- Apply automated updates ([d666b65](https://github.com/unjs/httpxy/commit/d666b65))
- Add agents.md ([f497cb0](https://github.com/unjs/httpxy/commit/f497cb0))
- Apply automated updates ([9a8d8eb](https://github.com/unjs/httpxy/commit/9a8d8eb))
- Apply automated updates ([822a0ea](https://github.com/unjs/httpxy/commit/822a0ea))
- Lint ([2d556f9](https://github.com/unjs/httpxy/commit/2d556f9))
- Update deps ([63b750f](https://github.com/unjs/httpxy/commit/63b750f))

### ✅ Tests

- Fix todo items ([8a3732b](https://github.com/unjs/httpxy/commit/8a3732b))
- Increase coverage ([50c0929](https://github.com/unjs/httpxy/commit/50c0929))
- Use random ports only ([9e2d155](https://github.com/unjs/httpxy/commit/9e2d155))

### 🤖 CI

- Update actions ([1fbac92](https://github.com/unjs/httpxy/commit/1fbac92))

#### ⚠️ Breaking Changes

- ⚠️  Remove legacy node `Url` support ([b2e6c92](https://github.com/unjs/httpxy/commit/b2e6c92))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.2.2

[compare changes](https://github.com/unjs/httpxy/compare/v0.2.1...v0.2.2)

### 🏡 Chore

- Fix build script ([28dc9e6](https://github.com/unjs/httpxy/commit/28dc9e6))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.2.1

[compare changes](https://github.com/unjs/httpxy/compare/v0.2.0...v0.2.1)

### 🌊 Types

- Make httpxy's server event type map generic ([#97](https://github.com/unjs/httpxy/pull/97))

### 🏡 Chore

- Update deps ([aecbed3](https://github.com/unjs/httpxy/commit/aecbed3))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Sukka <isukkaw@gmail.com>

## v0.2.0

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.7...v0.2.0)

### 💅 Refactors

- ⚠️ Code improvements ([#78](https://github.com/unjs/httpxy/pull/78))

### 🌊 Types

- Implement typed proxy server event ([#95](https://github.com/unjs/httpxy/pull/95), [#96](https://github.com/unjs/httpxy/pull/96))

### 🏡 Chore

- Update dev dependencies ([81f5e57](https://github.com/unjs/httpxy/commit/81f5e57))
- Migrate to oxfmt and oxlint ([edd6cff](https://github.com/unjs/httpxy/commit/edd6cff))

### ✅ Tests

- Port tests from node-http-proxy ([#88](https://github.com/unjs/httpxy/pull/88))

#### ⚠️ Breaking Changes

- ⚠️ Code improvements ([#78](https://github.com/unjs/httpxy/pull/78))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Sukka ([@SukkaW](https://github.com/SukkaW))
- 翠 <green@sapphi.red>

## v0.1.7

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.6...v0.1.7)

### 🩹 Fixes

- Preserve double slashes in url ([#70](https://github.com/unjs/httpxy/pull/70))

### 🏡 Chore

- Update deps ([c9c9de8](https://github.com/unjs/httpxy/commit/c9c9de8))

### ❤️ Contributors

- Oskar Lebuda ([@OskarLebuda](http://github.com/OskarLebuda))
- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.1.6

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.5...v0.1.6)

### 🩹 Fixes

- Omit outgoing port when not required ([#65](https://github.com/unjs/httpxy/pull/65))

### 📖 Documentation

- Remove unsupported `followRedirects` option ([#66](https://github.com/unjs/httpxy/pull/66))
- Improve example ([#16](https://github.com/unjs/httpxy/pull/16))

### 🏡 Chore

- Fix typo in readme ([#36](https://github.com/unjs/httpxy/pull/36))
- Update repo ([64f7465](https://github.com/unjs/httpxy/commit/64f7465))
- Update ci ([b0f08de](https://github.com/unjs/httpxy/commit/b0f08de))

### ❤️ Contributors

- Lsh ([@peterroe](http://github.com/peterroe))
- Kricsleo ([@kricsleo](http://github.com/kricsleo))
- Pooya Parsa ([@pi0](http://github.com/pi0))
- Mohammd Siddiqui <masiddiqui91@gmail.com>

## v0.1.5

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- Handle client `close` event ([#8](https://github.com/unjs/httpxy/pull/8))

### 🏡 Chore

- Update deps ([2888089](https://github.com/unjs/httpxy/commit/2888089))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- David Tai ([@didavid61202](http://github.com/didavid61202))

## v0.1.4

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.2...v0.1.4)

### 🩹 Fixes

- Presrve search params from parsed url ([8bbaacc](https://github.com/unjs/httpxy/commit/8bbaacc))
- Add `target` pathname currectly ([#6](https://github.com/unjs/httpxy/pull/6))

### 💅 Refactors

- Fix typo in `defineProxyMiddleware` ([#4](https://github.com/unjs/httpxy/pull/4))

### 🏡 Chore

- **release:** V0.1.2 ([b6bd4a8](https://github.com/unjs/httpxy/commit/b6bd4a8))
- Update dev dependencies ([5704e70](https://github.com/unjs/httpxy/commit/5704e70))
- **release:** V0.1.3 ([4ced1cc](https://github.com/unjs/httpxy/commit/4ced1cc))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Jonasolesen
- Gacek1123

## v0.1.3

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- Presrve search params from parsed url ([8bbaacc](https://github.com/unjs/httpxy/commit/8bbaacc))

### 💅 Refactors

- Fix typo in `defineProxyMiddleware` ([#4](https://github.com/unjs/httpxy/pull/4))

### 🏡 Chore

- **release:** V0.1.2 ([b6bd4a8](https://github.com/unjs/httpxy/commit/b6bd4a8))
- Update dev dependencies ([a41d0c6](https://github.com/unjs/httpxy/commit/a41d0c6))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Gacek1123

## v0.1.2

[compare changes](https://github.com/unjs/httpxy/compare/v0.1.1...v0.1.2)

### 🩹 Fixes

- Presrve search params from parsed url ([8bbaacc](https://github.com/unjs/httpxy/commit/8bbaacc))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.1.1

### 🚀 Enhancements

- Awaitable `.`web`and`.ws` ([e4dad27](https://github.com/unjs/httpxy/commit/e4dad27))

### 🩹 Fixes

- `createProxyServer` options is optional ([75d8e93](https://github.com/unjs/httpxy/commit/75d8e93))

### 💅 Refactors

- Avoid `url.parse` ([4ceca85](https://github.com/unjs/httpxy/commit/4ceca85))
- Hide internal props ([2f30878](https://github.com/unjs/httpxy/commit/2f30878))

### 📖 Documentation

- No need for quote ([9319fab](https://github.com/unjs/httpxy/commit/9319fab))

### 🏡 Chore

- Update readme ([64a7a75](https://github.com/unjs/httpxy/commit/64a7a75))
- Update dependencies ([1e906b9](https://github.com/unjs/httpxy/commit/1e906b9))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Sébastien Chopin <seb@nuxtlabs.com>
