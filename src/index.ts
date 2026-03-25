export type { ProxyAddr, ProxyServerOptions, ProxyTarget, ProxyTargetDetailed } from "./types.ts";
export { ProxyServer, createProxyServer, type ProxyServerEventMap } from "./server.ts";
export { proxyFetch, type ProxyFetchOptions } from "./fetch.ts";
export { proxyUpgrade, type ProxyUpgradeOptions } from "./ws.ts";
