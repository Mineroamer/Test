"use strict";
/*
 * Accounts and sessions.
 *
 * Passwords are stored as PBKDF2-SHA512 hashes with a per-user salt, compared
 * in constant time. Sessions are opaque random tokens in an httpOnly cookie,
 * so page scripts cannot read them.
 *
 * A visitor with no account still gets a session - it just has no userId
 * attached. That is what lets someone play a full round before deciding
 * whether to sign up, and lets their guest progress be claimed on signup.
 */

const crypto = require("node:crypto");

const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = "sha512";
const SESSION_DAYS = 90;

const hash = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) =>
      err ? reject(err) : resolve(key.toString("hex")));
  });

const newSalt = () => crypto.randomBytes(16).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const newId = (prefix) => prefix + "_" + crypto.randomBytes(9).toString("base64url");

/** Compare without leaking, through timing, how much of the hash matched. */
function sameHash(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/* Handles are the thing friends type to find each other, so they need to be
 * unambiguous: one case, one spelling, no spaces to get wrong. */
const HANDLE = /^[a-z0-9_]{3,20}$/;
const normaliseHandle = (name) => String(name || "").trim().toLowerCase();

function checkSignup({ handle, password, display }) {
  const errors = [];
  const clean = normaliseHandle(handle);
  if (!HANDLE.test(clean)) {
    errors.push("Username must be 3-20 characters, using letters, numbers or underscores.");
  }
  if (typeof password !== "string" || password.length < 8) {
    errors.push("Password must be at least 8 characters.");
  } else if (password.length > 200) {
    errors.push("Password must be under 200 characters.");
  }
  const name = String(display || clean).trim().slice(0, 30);
  return { errors, handle: clean, display: name };
}

async function createUser(store, { handle, password, display }) {
  const salt = newSalt();
  const passwordHash = await hash(password, salt);
  const user = {
    id: newId("u"),
    handle,
    display: display || handle,
    salt,
    passwordHash,
    createdAt: Date.now(),
    /* Picked from the handle so every account has a look without an upload. */
    colour: colourFor(handle),
  };
  store.data.users[user.id] = user;
  store.touch();
  return user;
}

async function verify(user, password) {
  if (!user) {
    /* Still spend the time, so a missing account and a wrong password take
     * the same amount of it. */
    await hash(password, "absent");
    return false;
  }
  const attempt = await hash(password, user.salt);
  return sameHash(attempt, user.passwordHash);
}

function colourFor(seed) {
  let n = 0;
  for (const ch of String(seed)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % 360;
}

function findByHandle(store, handle) {
  const clean = normaliseHandle(handle);
  return Object.values(store.data.users).find((u) => u.handle === clean) || null;
}

function startSession(store, userId) {
  const token = newToken();
  store.data.sessions[token] = { userId: userId || null, createdAt: Date.now(), lastSeen: Date.now() };
  store.touch();
  return token;
}

function readSession(store, token) {
  if (!token) return null;
  const session = store.data.sessions[token];
  if (!session) return null;
  const age = Date.now() - session.createdAt;
  if (age > SESSION_DAYS * 86400000) {
    delete store.data.sessions[token];
    store.touch();
    return null;
  }
  return session;
}

function endSession(store, token) {
  if (token && store.data.sessions[token]) {
    delete store.data.sessions[token];
    store.touch();
  }
}

/** What the browser is allowed to know about an account. */
function publicUser(user) {
  if (!user) return null;
  return { id: user.id, handle: user.handle, display: user.display, colour: user.colour, createdAt: user.createdAt };
}

module.exports = {
  HANDLE, SESSION_DAYS,
  hash, newId, newToken, sameHash, normaliseHandle, checkSignup,
  createUser, verify, findByHandle, startSession, readSession, endSession, publicUser, colourFor,
};
