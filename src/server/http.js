"use strict";
/*
 * A small router and the request/response plumbing around it.
 *
 * Routes are matched by method and a path pattern with :params, in the order
 * they were added. There is no framework here because there is nothing a
 * framework would be doing: five verbs, JSON in, JSON out, and a static
 * directory.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;
const MAX_BODY = 256 * 1024; // a custom puzzle is the biggest thing anyone posts

class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const names = [];
    const regex = new RegExp(
      "^" + pattern.replace(/:([A-Za-z_]+)/g, (_, name) => {
        names.push(name);
        return "([^/]+)";
      }) + "$"
    );
    this.routes.push({ method, regex, names, handler });
    return this;
  }

  get(p, h) { return this.add("GET", p, h); }
  post(p, h) { return this.add("POST", p, h); }
  patch(p, h) { return this.add("PATCH", p, h); }
  delete(p, h) { return this.add("DELETE", p, h); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(pathname);
      if (!found) continue;
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(found[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

/** Thrown by handlers to answer with a status and message instead of a 500. */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "That request body was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sendJson(req, res, status, value) {
  send(req, res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function send(req, res, status, body, type, extraHeaders) {
  const headers = Object.assign(
    { "content-type": type, "cache-control": "no-store" },
    extraHeaders || {}
  );
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");

  const accepts = String(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.test(type) && payload.length > 1024 && /\bgzip\b/.test(accepts)) {
    payload = zlib.gzipSync(payload);
    headers["content-encoding"] = "gzip";
    headers.vary = "accept-encoding";
  }
  headers["content-length"] = payload.length;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  res.end(payload);
}

/*
 * Serve a file from a directory, refusing anything that resolves outside it.
 * Data files and hashed assets are safe to cache; HTML never is, so a deploy
 * is picked up on the next load.
 */
function serveStatic(req, res, roots, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (rel.includes("\0")) return false;

  for (const root of roots) {
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;

    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const tag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

    if (req.headers["if-none-match"] === tag) {
      res.writeHead(304, { etag: tag });
      return res.end(), true;
    }

    const cache = ext === ".html"
      ? "no-cache"
      : ext === ".json" ? "public, max-age=86400" : "public, max-age=3600";

    send(req, res, 200, fs.readFileSync(full), type, { etag: tag, "cache-control": cache });
    return true;
  }
  return false;
}

module.exports = { Router, HttpError, fail, readBody, parseCookies, sendJson, send, serveStatic, MIME };
