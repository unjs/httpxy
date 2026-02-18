import type { IncomingMessage, RequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import type { ProxyAddr } from "./types.ts";
import { parseAddr } from "./_utils.ts";

/**
 * Proxy a request to a specific server address (TCP host/port or Unix socket)
 * using web standard {@link Request}/{@link Response} interfaces.
 *
 * Note: Only plain HTTP is supported. HTTPS targets are not supported.
 *
 * @param addr - The target server address. Can be a URL string (`http://host:port`, `unix:/path`), or an object with `host`/`port` for TCP or `socketPath` for Unix sockets.
 * @param input - The request URL (string or URL) or a {@link Request} object.
 * @param inputInit - Optional {@link RequestInit} or {@link Request} to override method, headers, and body.
 */
export async function proxyFetch(
  addr: string | ProxyAddr,
  input: string | URL | Request,
  inputInit?: RequestInit | Request,
) {
  const resolvedAddr = parseAddr(addr);

  let url: URL;
  let init: RequestInit | undefined;

  if (input instanceof Request) {
    url = new URL(input.url);
    init = {
      ...toInit(input),
      ...toInit(inputInit),
    };
  } else {
    url = new URL(input);
    init = toInit(inputInit);
  }
  init = {
    redirect: "manual",
    ...init,
  };
  if (init.body) {
    (init as RequestInit & { duplex: string }).duplex = "half";
  }

  const path = url.pathname + url.search;
  const reqHeaders: Record<string, string> = {};
  if (init.headers) {
    const h =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers as HeadersInit);
    for (const [key, value] of h) {
      reqHeaders[key] = value;
    }
  }

  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const reqOpts: RequestOptions = {
      method: init!.method || "GET",
      path,
      headers: reqHeaders,
    };

    if (resolvedAddr.socketPath) {
      reqOpts.socketPath = resolvedAddr.socketPath;
    } else {
      reqOpts.hostname = resolvedAddr.host || "localhost";
      reqOpts.port = resolvedAddr.port;
    }

    const req = httpRequest(reqOpts, resolve);
    req.on("error", reject);

    if (init!.body instanceof ReadableStream) {
      const readable = Readable.fromWeb(init!.body as import("node:stream/web").ReadableStream);
      readable.on("error", reject);
      readable.pipe(req);
    } else if (init!.body) {
      req.end(init!.body);
    } else {
      req.end();
    }
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (key === "transfer-encoding" || key === "keep-alive" || key === "connection") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else if (value) {
      headers.set(key, value);
    }
  }

  const hasBody = res.statusCode !== 204 && res.statusCode !== 304;
  return new Response(hasBody ? (Readable.toWeb(res) as ReadableStream) : null, {
    status: res.statusCode,
    statusText: res.statusMessage,
    headers,
  });
}

function toInit(init?: RequestInit | Request): RequestInit | undefined {
  if (!init) {
    return undefined;
  }
  if (init instanceof Request) {
    return {
      method: init.method,
      headers: init.headers,
      body: init.body,
      duplex: init.body ? "half" : undefined,
    } as RequestInit;
  }
  return init;
}
