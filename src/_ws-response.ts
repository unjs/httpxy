import type { IncomingMessage } from "node:http";
import { Transform, type Duplex } from "node:stream";
import { createHttpHeader } from "./_utils.ts";

const hopByHopHeaders = [
  "connection",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
];

export function pipeNonUpgradeResponse(
  response: IncomingMessage,
  socket: Duplex,
  onError: (error: Error) => void,
): void {
  const headers = { ...response.headers };
  const hopHeaders = new Set(hopByHopHeaders);
  for (const name of ["connection", "proxy-connection"]) {
    for (const token of String(headers[name] || "").split(",")) {
      hopHeaders.add(token.trim().toLowerCase());
    }
  }
  for (const name of hopHeaders) delete headers[name];
  headers.connection = "close";

  // 1xx never reaches here: Node emits 100/102/103 as `information` and 101 as `upgrade`.
  const status = response.statusCode || 502;
  const bodyless = status === 204 || status === 205 || status === 304;
  const transferEncoding = response.headers["transfer-encoding"];
  if (status === 205) {
    headers["content-length"] = "0";
  } else if (status === 204) {
    delete headers["content-length"];
  } else if (transferEncoding && !bodyless) {
    // IncomingMessage decodes chunk framing, but leaves other transfer codings intact.
    headers["transfer-encoding"] = transferEncoding;
    delete headers["content-length"];
  } else if (response.headers["content-length"] !== undefined) {
    headers["content-length"] = response.headers["content-length"];
  }

  const chunked = !bodyless && /(?:^|,)\s*chunked\s*$/i.test(transferEncoding || "");
  const encoder = chunked
    ? new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          callback(
            null,
            chunk.length === 0
              ? undefined
              : Buffer.concat([
                  Buffer.from(`${chunk.length.toString(16)}\r\n`),
                  chunk,
                  Buffer.from("\r\n"),
                ]),
          );
        },
        flush(callback) {
          callback(null, Buffer.from("0\r\n\r\n"));
        },
      })
    : undefined;

  let closed = false;
  const onClose = () => {
    closed = true;
    response.destroy();
    encoder?.destroy();
  };
  const onResponseError = (error: Error) => {
    if (closed) return;
    onClose();
    socket.destroy();
    onError(error);
  };
  socket.once("close", onClose);
  response.once("error", onResponseError);
  encoder?.once("error", onResponseError);

  socket.write(
    createHttpHeader(`HTTP/${response.httpVersion} ${status} ${response.statusMessage}`, headers),
    "latin1",
  );
  if (status === 205) {
    onClose();
    socket.end();
  } else if (encoder) {
    response.pipe(encoder).pipe(socket);
  } else {
    response.pipe(socket);
  }
}
