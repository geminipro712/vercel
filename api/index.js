export const config = {
  runtime: "edge",
};

const ORIGIN = (process.env.UPSTREAM_URL ?? "").replace(/\/+$/, "");

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

const extractClientIp = (headers) => {
  let ip;

  if (headers.has("x-real-ip")) {
    ip = headers.get("x-real-ip");
  }

  if (headers.has("x-forwarded-for")) {
    ip = ip ?? headers.get("x-forwarded-for");
  }

  return ip;
};

const buildForwardHeaders = (incoming) => {
  const headers = new Headers();
  let clientIp;

  for (const [key, value] of incoming.entries()) {
    const k = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(k)) continue;
    if (k.startsWith("x-vercel-")) continue;

    if (k === "x-real-ip") {
      clientIp = value;
      continue;
    }

    if (k === "x-forwarded-for") {
      clientIp ||= value;
      continue;
    }

    headers.set(k, value);
  }

  if (clientIp) headers.set("x-forwarded-for", clientIp);

  return headers;
};

const resolveTarget = (requestUrl) => {
  const idx = requestUrl.indexOf("/", 8);
  return idx === -1
    ? `${ORIGIN}/`
    : `${ORIGIN}${requestUrl.slice(idx)}`;
};

export default async function edgeProxy(req) {
  if (!ORIGIN) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const destination = resolveTarget(req.url);
    const forwardHeaders = buildForwardHeaders(req.headers);

    const method = req.method;
    const isBodyAllowed = method !== "GET" && method !== "HEAD";

    const response = await fetch(destination, {
      method,
      headers: forwardHeaders,
      body: isBodyAllowed ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });

    return response;
  } catch (e) {
    console.error("relay error:", e);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
