import type { ClientRequest } from "node:http";
import type { Duplex } from "node:stream";

export function setUpgradeTimeout(
  proxyReq: ClientRequest,
  socket: Duplex,
  timeout: number | undefined,
  onError: (error: Error) => void,
): void {
  if (!timeout || timeout <= 0 || !Number.isFinite(timeout)) {
    return;
  }

  const timer = setTimeout(
    () => {
      const error = Object.assign(new Error("Upstream WebSocket upgrade timed out"), {
        code: "ERR_UPSTREAM_UPGRADE_TIMEOUT",
        statusCode: 504,
      });
      fail(error);
    },
    Math.min(timeout, 2_147_483_647),
  );
  timer.unref();

  proxyReq.once("response", clear);
  proxyReq.once("upgrade", clear);
  proxyReq.once("error", clear);
  proxyReq.once("close", clear);
  socket.prependOnceListener("error", fail);
  socket.prependOnceListener("close", onSocketClose);

  if (socket.destroyed) {
    onSocketClose();
  }

  function clear() {
    clearTimeout(timer);
    proxyReq.removeListener("response", clear);
    proxyReq.removeListener("upgrade", clear);
    proxyReq.removeListener("error", clear);
    proxyReq.removeListener("close", clear);
    socket.removeListener("error", fail);
    socket.removeListener("close", onSocketClose);
  }

  function onSocketClose() {
    fail(socket.errored || Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
  }

  function fail(error: Error) {
    clear();
    try {
      onError(error);
    } finally {
      proxyReq.destroy(error);
      socket.destroy();
    }
  }
}
