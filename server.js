"use strict";
/*
 * Puzzle Club.
 *
 * Start it with `node server.js`. There is nothing to install, no database to
 * run alongside it, and no build step - the browser is served the same files
 * that are in the repository.
 *
 *   PORT       port to listen on          (default 3000)
 *   HOST       address to bind            (default 127.0.0.1)
 *   DATA_FILE  where the store is kept    (default ./data/store.json)
 */

const http = require("node:http");
const path = require("node:path");

const { Store } = require("./src/server/store.js");
const auth = require("./src/server/auth.js");
const { buildApi } = require("./src/server/api.js");
const { HttpError, readBody, parseCookies, sendJson, serveStatic } = require("./src/server/http.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "store.json");

/*
 * Behind a proxy that terminates TLS - which is how this is meant to be run on
 * the internet - the connection the server sees is plain HTTP even though the
 * visitor is on HTTPS. TRUST_PROXY says the X-Forwarded-* headers come from
 * something trustworthy, so they can be believed for the visitor's address and
 * for whether the cookie may be marked Secure.
 *
 * It is off by default: believing those headers when anyone can set them would
 * let a client claim any address it liked, and defeat the rate limiter.
 */
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");

const PUBLIC = path.resolve(__dirname, "public");

const store = new Store(DATA_FILE);
store.load();

const api = buildApi(store);

const COOKIE = "pc_session";

/** True when the visitor reached us over HTTPS, as far as we can tell. */
function isSecure(req) {
  if (req.socket && req.socket.encrypted) return true;
  if (!TRUST_PROXY) return false;
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function sessionCookie(token, req) {
  /* Lax rather than Strict: a shared puzzle link should open with you already
   * signed in. httpOnly keeps the token away from page scripts either way,
   * and Secure keeps it off any plain-HTTP request once we are behind TLS. */
  const flags = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${auth.SESSION_DAYS * 86400}`,
  ];
  if (isSecure(req)) flags.push("Secure");
  return flags.join("; ");
}

/**
 * The visitor's address, for rate limiting. Only the proxy's own view of it is
 * worth anything, and only when the proxy is trusted; otherwise the socket is
 * the one thing a client cannot lie about.
 */
function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  } catch {
    return sendJson(req, res, 400, { error: "Malformed request." });
  }
  const pathname = url.pathname;

  /* The host's health check. Answered before sessions are touched, so a check
   * never creates one and the store is not written to on every ping. */
  if (pathname === "/health") {
    return sendJson(req, res, 200, { ok: true, day: require("./src/server/rng.js").dayNumber() });
  }

  /* Every visitor gets a session, signed in or not. It is what carries a
   * guest's half-finished round, and what a signup attaches an account to. */
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[COOKIE];
  let session = auth.readSession(store, token);
  let issued = false;

  if (!session) {
    token = auth.startSession(store, null);
    session = store.data.sessions[token];
    issued = true;
  } else {
    session.lastSeen = Date.now();
  }

  if (pathname.startsWith("/api/")) {
    const route = api.match(req.method, pathname);
    if (!route) return sendJson(req, res, 404, { error: "No such endpoint." });

    const ctx = {
      req, res, token, session,
      ip: clientIp(req),
      user: session.userId ? store.data.users[session.userId] || null : null,
      params: route.params,
      query: url.searchParams,
      body: {},
      clearSession: false,
    };

    try {
      if (req.method !== "GET") ctx.body = await readBody(req);
      const payload = await route.handler(ctx);

      const headers = {};
      if (ctx.clearSession) headers["set-cookie"] = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      else if (issued) headers["set-cookie"] = sessionCookie(token, req);

      const body = JSON.stringify(payload === undefined ? { ok: true } : payload);
      res.writeHead(200, Object.assign({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
      }, headers));
      return res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(req, res, err.status, Object.assign({ error: err.message }, err.extra || {}));
      }
      console.error(`${req.method} ${pathname} failed:`, err);
      return sendJson(req, res, 500, { error: "Something went wrong at our end." });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(req, res, 405, { error: "Method not allowed." });
  }

  if (issued) res.setHeader("set-cookie", sessionCookie(token, req));

  /*
   * public/ is the only directory ever served. data/ is not, and must not be:
   * it holds the store, and the store holds password hashes and live session
   * tokens. The word lists in there are read from disk by the game engines,
   * never fetched by the browser, so nothing is lost by keeping the whole
   * directory off the web.
   */
  if (pathname !== "/" && serveStatic(req, res, [PUBLIC], pathname)) return;

  /* Anything else is a route inside the app, so hand back the shell and let
   * the browser work out which screen it means. */
  if (serveStatic(req, res, [PUBLIC], "index.html")) return;
  return sendJson(req, res, 404, { error: "Not found." });
});

/* Only take the port when started directly; the tests import this file and
 * bind a port of their own. */
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Puzzle Club listening on http://${HOST}:${PORT}`);
    console.log(`store: ${DATA_FILE}`);
    if (TRUST_PROXY) console.log("trusting X-Forwarded-* headers from the proxy in front");
  });
}

/* Persist whatever is in memory before going away. */
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (closing) return process.exit(0);
    closing = true;
    console.log("\nsaving...");
    store.flushSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

module.exports = { server, store };
