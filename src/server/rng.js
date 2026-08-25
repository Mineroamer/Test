"use strict";
/*
 * Seeded randomness.
 *
 * The daily puzzles are not stored anywhere - they are recomputed from the
 * day number every time they are asked for. That means the server can restart,
 * or a second server can come up, and everyone still gets the same puzzle;
 * and a puzzle from any past or future day can be replayed exactly.
 *
 * The generator is mulberry32: small, fast, and good enough for dealing
 * puzzles. It is not, and must not be used as, a source of secrets.
 */

/** FNV-1a. Turns a seed string into the 32 bits mulberry32 wants. */
function hashString(text) {
  let h = 2166136261 >>> 0;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded by any string, so seeds can be readable. */
const rngFor = (seed) => mulberry32(hashString(seed));

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Fisher-Yates on a copy, so the caller's array is left alone. */
function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take n distinct items. */
function sample(list, n, random) {
  return shuffle(list, random).slice(0, n);
}

/*
 * Day numbering. Every game counts days from the same epoch and uses the
 * server's local midnight, so "today's puzzles" is one consistent idea across
 * the whole app and the countdown on the home screen is true for all of them.
 */
const EPOCH = Date.UTC(2024, 0, 1);

function dayNumber(date = new Date()) {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH) / 86400000);
}

function msUntilReset(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight - now;
}

/** The wall-clock moment the current puzzle day began, as a timestamp. */
function startOfDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** The day number as YYYY-MM-DD, for anything a person will read. */
function dayLabel(day) {
  const d = new Date(EPOCH + day * 86400000);
  return d.toISOString().slice(0, 10);
}

module.exports = { hashString, mulberry32, rngFor, pick, shuffle, sample, dayNumber, msUntilReset, startOfDay, dayLabel, EPOCH };
