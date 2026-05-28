import { randomBytes } from "node:crypto";
import { request as httpRequest, type OutgoingHttpHeaders, type RequestOptions } from "node:http";
import type { IncomingHttpHeaders, ServerHttp2Stream } from "node:http2";
import { request as httpsRequest } from "node:https";
import { buildTargetURL, isSSL, parseAddr, setupOutgoing, setupSocket } from "./_utils.ts";
import type { ProxyAddr } from "./types.ts";
import type { ProxyUpgradeOptions } from "./ws.ts";

/**
 * Options for {@link proxyH2Upgrade}. Mirrors {@link ProxyUpgradeOptions} minus
 * h1-only knobs (`xfwd`/`toProxy` need a real h1 req; `agent` is meaningless
 * for a one-shot upgrade), plus a handshake `timeout` and a `path` override.
 */
export interface ProxyH2UpgradeOptions extends Omit<
  ProxyUpgradeOptions,
  "xfwd" | "toProxy" | "agent"
> {
  /** ms to wait for the upstream `101 Switching Protocols`. Default: `15_000`. */
  timeout?: number;
  /** Override the upstream request path. Default: the h2 stream's `:path`. */
  path?: string;
}

const FORWARDED = ["sec-websocket-protocol", "sec-websocket-extensions", "origin", "user-agent"];

/**
 * Bridge a WebSocket-over-HTTP/2 (RFC 8441 extended-CONNECT) stream to an h1.1
 * `Upgrade: websocket` upstream — the h2 counterpart of {@link proxyUpgrade}.
 * Use from `Http2SecureServer`'s `'stream'` event when
 * `headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket"`.
 *
 * Rejects on upstream error / non-101 / timeout, after responding to the h2
 * stream with the appropriate `:status` (502 for infra failure, the upstream
 * status otherwise) so the client never sees a hanging stream.
 */
export function proxyH2Upgrade(
  addr: string | ProxyAddr,
  stream: ServerHttp2Stream,
  headers: IncomingHttpHeaders,
  opts: ProxyH2UpgradeOptions = {},
): Promise<void> {
  const useSSL =
    typeof addr === "string" && !addr.startsWith("unix:") && isSSL.test(new URL(addr).protocol);
  const target = buildTargetURL(parseAddr(addr), useSSL);
  const timeout = opts.timeout ?? 15_000;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(); // oxlint-disable-line no-unused-expressions
    };
    const failStatus = (status: number) => {
      if (!stream.destroyed && !stream.closed) {
        try {
          stream.respond({ ":status": status });
          stream.end();
        } catch {
          /* stream already closed */
        }
      }
    };

    // setupOutgoing strips the four classic h2 pseudo-headers but not RFC 8441's
    // `:protocol`; if left in, it leaks into h1 and Node throws "Header name
    // must be a valid HTTP token". Drop every `:*` pseudo-header defensively.
    const cleanHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k]) => !k.startsWith(":")),
    );
    const path = opts.path ?? (typeof headers[":path"] === "string" ? headers[":path"] : "/");
    const outgoing: RequestOptions = setupOutgoing(
      { ...opts.ssl } as RequestOptions,
      { ...opts, target, method: "GET" } as Parameters<typeof setupOutgoing>[1],
      { url: path, method: "GET", httpVersionMajor: 2, headers: cleanHeaders } as Parameters<
        typeof setupOutgoing
      >[2],
    );

    // (Re)add RFC 6455 handshake headers — h2 has no `Connection`, and browsers
    // don't send `Sec-WebSocket-Key` on extended-CONNECT (RFC 8441 §4), but the
    // h1 upstream requires both (RFC 6455 §4.1).
    const out = Object.assign((outgoing.headers || {}) as OutgoingHttpHeaders, {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": randomBytes(16).toString("base64"),
    });
    for (const h of FORWARDED) {
      const v = headers[h];
      if (typeof v === "string") out[h] = v;
    }
    Object.assign(out, opts.headers);
    outgoing.headers = out;

    const upstreamReq = (useSSL ? httpsRequest : httpRequest)({ ...outgoing, timeout });

    upstreamReq.once("timeout", () => {
      failStatus(502);
      upstreamReq.destroy();
      settle(new Error(`Upstream did not respond with 101 within ${timeout}ms`));
    });

    upstreamReq.once("upgrade", (res, socket, head) => {
      const wsProto = res.headers["sec-websocket-protocol"];
      const wsExt = res.headers["sec-websocket-extensions"];
      try {
        stream.respond({
          ":status": 200,
          ...(typeof wsProto === "string" && { "sec-websocket-protocol": wsProto }),
          ...(typeof wsExt === "string" && { "sec-websocket-extensions": wsExt }),
        });
      } catch (err) {
        socket.destroy();
        settle(err as Error);
        return;
      }
      setupSocket(socket);
      if (head?.length) stream.write(head);
      socket.pipe(stream);
      stream.pipe(socket);
      const teardown = () => {
        socket.destroy();
        if (!stream.destroyed && !stream.closed) stream.close();
      };
      for (const ev of ["close", "error"] as const) {
        stream.once(ev, teardown);
        socket.once(ev, teardown);
      }
      settle();
    });

    upstreamReq.once("response", (res) => {
      failStatus(res.statusCode || 502);
      settle(new Error(`Upstream returned ${res.statusCode} (expected 101)`));
    });

    upstreamReq.once("error", (err) => {
      failStatus(502);
      settle(err);
    });

    upstreamReq.end();
  });
}
