"use strict";
/*
 * A sliding-window limiter, held in memory.
 *
 * It exists for one job: making a password guessable only at human speed.
 * Sign-in is limited twice over - by where the attempt came from, so one
 * machine cannot work through a list, and by which account it was aimed at,
 * so a botnet cannot work through one password either.
 *
 * In memory means it resets when the process does, and that two machines
 * behind a load balancer each keep their own count. For a club this is the
 * right trade: no dependency, no shared store, and an attacker still cannot
 * get more than a trickle through any single instance.
 */

const buckets = new Map();

/* Sweep occasionally rather than on a timer, so an idle process stays idle. */
let lastSweep = Date.now();
const SWEEP_EVERY = 60000;

function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY) return;
  lastSweep = now;
  for (const [key, hits] of buckets) {
    if (!hits.length || now - hits[hits.length - 1] > 3600000) buckets.delete(key);
  }
}

/**
 * Record an attempt and say whether it is allowed.
 * Returns { ok, retryAfter } - seconds until the next attempt would be let in.
 */
function take(key, { limit, windowMs }) {
  const now = Date.now();
  sweep(now);

  const hits = (buckets.get(key) || []).filter((at) => now - at < windowMs);
  buckets.set(key, hits);

  if (hits.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  hits.push(now);
  return { ok: true, retryAfter: 0 };
}

/** Forget a key's history - called when a sign-in succeeds. */
const clear = (key) => buckets.delete(key);

/*
 * Deliberately generous: a person who has forgotten which password they used
 * should not be locked out, while a script should get nowhere.
 *
 * Sign-up is looser than instinct suggests, because a whole class or family
 * signing up together shares one address as far as the server can tell -
 * being throttled for joining at the same time as your friends would be a
 * worse failure than the abuse this prevents. It is also counted only on
 * success, so mistyping a password never spends anyone's budget.
 */
/*
 * The two login limits do different jobs and so are set very differently.
 *
 * Per account is the one that actually protects a password, and it is tight:
 * ten tries a quarter of an hour makes guessing hopeless.
 *
 * Per address is only there to stop one machine spraying many accounts, so it
 * is loose. It has to be: a school or a household is a single address as far
 * as the server can tell, and locking out a whole building because one person
 * mistyped their password would be a worse bug than the attack it prevents.
 */
const SIGN_IN = { limit: 10, windowMs: 15 * 60 * 1000 };
const SIGN_IN_SOURCE = { limit: 60, windowMs: 15 * 60 * 1000 };
const SIGN_UP = { limit: 40, windowMs: 60 * 60 * 1000 };

module.exports = { take, clear, SIGN_IN, SIGN_IN_SOURCE, SIGN_UP, buckets };
