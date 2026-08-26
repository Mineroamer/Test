"use strict";
/*
 * Duels: the same puzzle, two people, and a clock.
 *
 * Everything else in the club is played against yourself. A duel is the one
 * place where somebody else's result changes what yours is worth, so it needs
 * rules that hold up when the two of you are not sitting in the same room:
 *
 *   - Both players get the *same* puzzle. It is a seed, like every other
 *     puzzle here, so nothing has to be stored and neither side can be handed
 *     an easier board.
 *   - The clock starts when you open it, not when it was sent. Otherwise the
 *     person who was asleep when the challenge arrived has already lost.
 *   - Solving beats not solving, whatever the clock says, and two people who
 *     both failed to solve it draw. A duel is a race to finish, and the way
 *     to win one must never be to throw it away faster than the other person.
 *   - It is settled once both have played, or when it runs out of time. A
 *     challenge nobody answers should not sit open forever.
 *
 * Nothing here talks to the network or judges a puzzle. It takes a store and
 * the result of a finished round, and says what that means for the duel.
 */

const crypto = require("node:crypto");

const auth = require("./auth.js");

/* Two days to answer. Long enough to cover a night and a working day, short
 * enough that the list is a thing you act on rather than an archive. */
const LIFETIME_MS = 48 * 3600 * 1000;

/* A duel is head to head. Kept as an array anyway: `players` reads better than
 * `from`/`to` everywhere the winner is worked out, and it leaves room for a
 * three-way without a migration. */
const create = (store, { from, to, game, difficulty = null }) => {
  const record = {
    id: auth.newId("ch"),
    game,
    difficulty: difficulty || null,
    /* The puzzle itself, as a seed both sides build from. */
    seed: crypto.randomBytes(8).toString("hex"),
    from,
    players: [from, to],
    createdAt: Date.now(),
    expiresAt: Date.now() + LIFETIME_MS,
    /* userId -> { won, took, guesses, hints, at }. A player who has opened it
     * but not finished has no entry: an unfinished round is not a result. */
    results: {},
    /* Set once, when the duel is settled. null while it is still open. */
    settledAt: null,
    winner: null,       // a user id, or null for a draw / nobody
    /* Whether each side has been shown how it ended, so the result can be
     * announced once rather than every time the screen loads. */
    seen: {},
  };
  store.data.challenges.push(record);
  store.touch();
  return record;
};

const find = (store, id) => store.data.challenges.find((one) => one.id === id) || null;

const isPlayer = (challenge, userId) => challenge.players.includes(userId);

const opponentOf = (challenge, userId) =>
  challenge.players.find((id) => id !== userId) || null;

/** Open, and this player has not played it yet. */
const isWaitingOn = (challenge, userId) =>
  !challenge.settledAt && !challenge.results[userId] && !challenge.declined;

/**
 * Write down how one player did.
 *
 * `took` is how long their round ran, not how long the challenge has been
 * open. Two people in different timezones are racing each other's stopwatch,
 * not the calendar.
 */
function recordResult(store, challenge, userId, { won, took, guesses = 0, hints = 0 }) {
  if (!isPlayer(challenge, userId)) return challenge;
  if (challenge.results[userId]) return challenge;    // first attempt stands

  challenge.results[userId] = {
    won: !!won,
    took: Math.max(0, Math.round(took)),
    guesses,
    hints,
    at: Date.now(),
  };
  store.touch();
  return settleIfDone(store, challenge);
}

/**
 * Rank two results. Lower is better, so this reads like a comparator.
 *
 * Four rules, in order:
 *
 *   - Turning up beats not turning up.
 *   - A solve beats a non-solve, however quick the non-solve was.
 *   - Between two solves it is the clock, and a tie to the millisecond is
 *     broken on fewer guesses and then fewer hints - both things a player
 *     actually controls.
 *   - Between two non-solves, nobody wins. This one matters: ranking two
 *     failures on the clock would mean the way to win a duel you cannot solve
 *     is to throw it away as fast as possible, which is the opposite of the
 *     game. They draw, and both are paid for a draw.
 */
function better(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (!a.won) return 0;
  return a.took - b.took || a.guesses - b.guesses || a.hints - b.hints;
}

/** Settle it if everybody has played, or if it has run out of time. */
function settleIfDone(store, challenge, now = Date.now()) {
  if (challenge.settledAt) return challenge;

  const played = challenge.players.filter((id) => challenge.results[id]);
  const everyone = played.length === challenge.players.length;
  const overdue = now >= challenge.expiresAt;
  if (!everyone && !overdue) return challenge;

  /*
   * An expired duel is decided on whoever turned up. If neither did, nobody
   * wins it - which is different from a draw, and the screen says so.
   */
  const ranked = played.slice().sort((a, b) => better(challenge.results[a], challenge.results[b]));
  const top = ranked[0] || null;
  const drawn = ranked.length > 1
    && better(challenge.results[ranked[0]], challenge.results[ranked[1]]) === 0;

  challenge.settledAt = now;
  challenge.expired = !everyone;
  challenge.winner = drawn || !top ? null : top;
  store.touch();
  return challenge;
}

/**
 * Settle everything that has run out of time.
 *
 * Called when a player looks at their list, which is the only moment it
 * matters: there is no scheduler here, and a duel that expired at 3am does not
 * need to have been settled at 3am, only by the time somebody asks.
 */
function sweep(store, now = Date.now()) {
  const settled = [];
  for (const challenge of store.data.challenges) {
    if (challenge.settledAt || challenge.declined) continue;
    if (now < challenge.expiresAt) continue;
    settleIfDone(store, challenge, now);
    if (challenge.settledAt) settled.push(challenge);
  }
  return settled;
}

/** Turn one down. It is not a loss - nobody played it. */
function decline(store, challenge, userId) {
  challenge.declined = { by: userId, at: Date.now() };
  challenge.settledAt = Date.now();
  challenge.winner = null;
  store.touch();
  return challenge;
}

/* Old duels are worth keeping - the head-to-head record is built from them -
 * but not forever. A few hundred per person is several months of duelling. */
const KEPT = 300;

function prune(store, userId) {
  const mine = store.data.challenges.filter((one) => isPlayer(one, userId));
  if (mine.length <= KEPT) return;
  const drop = new Set(
    mine.sort((a, b) => b.createdAt - a.createdAt).slice(KEPT).map((one) => one.id));
  store.data.challenges = store.data.challenges.filter((one) => !drop.has(one.id));
}

/** Every duel this player is in, newest first. */
const forUser = (store, userId) =>
  store.data.challenges
    .filter((one) => isPlayer(one, userId))
    .sort((a, b) => b.createdAt - a.createdAt);

/**
 * The head-to-head record between two people: what everybody actually wants
 * to know, and the reason settled duels are kept at all.
 */
function standing(store, a, b) {
  let wins = 0, losses = 0, draws = 0;
  for (const one of store.data.challenges) {
    if (!one.settledAt || one.declined) continue;
    if (!isPlayer(one, a) || !isPlayer(one, b)) continue;
    if (!one.winner) draws += 1;
    else if (one.winner === a) wins += 1;
    else losses += 1;
  }
  return { wins, losses, draws, played: wins + losses + draws };
}

/**
 * How many duels this player has won, and their best margin - what the duel
 * achievements ask about.
 */
function recordOf(store, userId) {
  let won = 0, played = 0, bestMargin = 0, perfect = 0;
  for (const one of store.data.challenges) {
    if (!one.settledAt || one.declined || !isPlayer(one, userId)) continue;
    const mine = one.results[userId];
    if (!mine) continue;
    played += 1;
    if (one.winner !== userId) continue;
    won += 1;
    const theirs = one.results[opponentOf(one, userId)];
    if (theirs && theirs.won) bestMargin = Math.max(bestMargin, theirs.took - mine.took);
    /* A shutout is *you solved it and they did not*. Both of you failing is
     * not a shutout - it is a draw, and does not reach here anyway. */
    else if (theirs && mine.won) perfect += 1;
  }
  return { duelsPlayed: played, duelsWon: won, duelMargin: bestMargin, duelShutouts: perfect };
}

module.exports = {
  LIFETIME_MS, KEPT,
  create, find, isPlayer, isWaitingOn, opponentOf, better,
  recordResult, settleIfDone, sweep, decline, prune, forUser, standing, recordOf,
};
