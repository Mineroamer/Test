"use strict";
/*
 * Where a player is on the pass, and how everyone compares.
 *
 * This is the part that touches the store: xp.js works out what a round is
 * worth and cosmetics.js says what is unlocked, and neither of them knows
 * there is a database. This module is the seam between them.
 *
 * Only accounts have progress. A guest can play everything, and nothing is
 * written down - which is the same rule the stats module already follows, and
 * the reason the sign-up prompt after a good round is worth showing.
 */

const xp = require("./xp.js");
const cosmetics = require("./cosmetics.js");

const DAY_MS = 86400000;

/** A player's row, created the first time they finish anything. */
const blank = (hue) => ({
  xp: 0,
  level: 1,
  character: cosmetics.starter(hue),
  /* The level they have actually been shown. The gap between this and `level`
   * is what the level-up card reads, so a level earned while the tab was shut
   * still gets its moment. */
  seenLevel: 1,
  awards: [],   // { at, day, game, mode, xp } - recent, for the weekly board
});

/* A week of awards is all the weekly board needs, and it keeps one player's
 * row from growing without bound however much they play. */
const AWARDS_KEPT = 400;

function rowFor(store, userId) {
  const all = store.data.progress || (store.data.progress = {});
  if (!all[userId]) {
    const user = store.data.users[userId];
    all[userId] = blank(user ? user.colour : 200);
  }
  /* A row written before a slot existed is filled in rather than replaced, so
   * an older store loads with everyone's XP intact. */
  const row = all[userId];
  if (typeof row.xp !== "number") row.xp = 0;
  if (!row.character) row.character = cosmetics.starter(200);
  if (!Array.isArray(row.awards)) row.awards = [];
  return row;
}

/**
 * How many rounds of this game the player has already finished today. This is
 * what makes the unlimited taper work, and it is counted from the results log
 * rather than kept as a running total so that it resets by itself at midnight.
 */
function playedToday(store, userId, game, day, since) {
  let n = 0;
  for (const result of store.data.results) {
    if (result.userId !== userId || result.game !== game) continue;
    if (result.at >= since) n += 1;
  }
  return n;
}

/**
 * Award a finished round.
 *
 * Returns what was earned and whether it crossed a level, so the browser can
 * show the bar moving and, if it happened, what was unlocked. Returns null for
 * a guest, because there is nowhere to put it.
 */
function award(store, userId, { game, mode, difficulty, summary, took, day, startOfDay }) {
  if (!userId) return null;

  const row = rowFor(store, userId);
  const before = xp.progressFor(row.xp);

  const already = playedToday(store, userId, game, day, startOfDay || Date.now() - DAY_MS);
  const earned = xp.award({ game, mode, difficulty, summary, took, already });

  row.xp += earned.xp;
  row.level = xp.levelFor(row.xp);
  const after = xp.progressFor(row.xp);

  row.awards.push({ at: Date.now(), game, mode, xp: earned.xp });
  if (row.awards.length > AWARDS_KEPT) row.awards = row.awards.slice(-AWARDS_KEPT);

  store.touch();

  return {
    xp: earned.xp,
    won: earned.won,
    quality: earned.quality,
    /* Below one, this round was worth less than its face value - repeat
     * unlimited rounds. The screen says so rather than leaving it a mystery. */
    weight: earned.weight,
    repeat: mode !== "daily" && already >= xp.FREE_ROUNDS,
    before: before.level,
    after: after.level,
    levelled: after.level > before.level,
    unlocked: after.level > before.level
      ? levelsBetween(before.level, after.level).flatMap((l) => cosmetics.rewardsAt(l))
      : [],
    progress: after,
  };
}

const levelsBetween = (from, to) => {
  const out = [];
  for (let level = from + 1; level <= to; level += 1) out.push(level);
  return out;
};

/** Everything the browser needs to draw the pass for one player. */
function forUser(store, userId) {
  const row = rowFor(store, userId);
  const progress = xp.progressFor(row.xp);
  return {
    ...progress,
    character: row.character,
    /* What has not been shown yet. The screen clears it once it has. */
    pending: progress.level > (row.seenLevel || 1) ? (row.seenLevel || 1) : null,
    unlocked: cosmetics.unlockedAt(progress.level).map((item) => ({ ...item })),
    track: cosmetics.track(xp, progress.level),
  };
}

/** Mark the level-up card as shown, so it does not come back on every load. */
function markSeen(store, userId) {
  const row = rowFor(store, userId);
  row.seenLevel = xp.levelFor(row.xp);
  store.touch();
  return row.seenLevel;
}

/** Put on a different set of clothes, within what has been unlocked. */
function equip(store, userId, wanted) {
  const row = rowFor(store, userId);
  const user = store.data.users[userId];
  row.character = cosmetics.sanitise(wanted, xp.levelFor(row.xp), user ? user.colour : 200);
  store.touch();
  return row.character;
}

/** What everyone else is allowed to see of a player: a name and a look. */
function publicFor(store, userId) {
  const user = store.data.users[userId];
  if (!user) return null;
  const row = rowFor(store, userId);
  const item = cosmetics.find("title", row.character.title);
  return {
    id: user.id,
    handle: user.handle,
    display: user.display,
    colour: user.colour,
    character: row.character,
    title: item ? item.name : null,
    level: xp.levelFor(row.xp),
    xp: row.xp,
  };
}

/**
 * The board.
 *
 * `window` is "all" or "week". All-time ranks on total XP, which is the honest
 * measure of a long player. Weekly ranks on what was earned in the last seven
 * days, which is the one a person who joined on Tuesday can actually win - a
 * board with only an all-time view is a board that tells newcomers not to
 * bother.
 *
 * Everyone with an account is on it, whether or not they are your friend. That
 * is what "universal" means, and it means a handle and a display name are
 * visible to anyone who can reach the server. Nothing else is: not an email
 * (none is ever asked for), not what you played, not when.
 */
function leaderboard(store, { window: span = "all", limit = 100, viewer = null } = {}) {
  const since = Date.now() - 7 * DAY_MS;

  const rows = Object.keys(store.data.users).map((userId) => {
    const row = rowFor(store, userId);
    const week = row.awards.reduce((n, a) => (a.at >= since ? n + a.xp : n), 0);
    const person = publicFor(store, userId);
    return person && { ...person, week, rounds: row.awards.length };
  }).filter(Boolean);

  const score = (r) => (span === "week" ? r.week : r.xp);

  /* Ties break on the other measure, then on who got there first - so the
   * order is stable rather than whatever Object.keys felt like today. */
  rows.sort((a, b) =>
    score(b) - score(a) ||
    (span === "week" ? b.xp - a.xp : b.week - a.week) ||
    a.handle.localeCompare(b.handle));

  rows.forEach((row, i) => { row.rank = i + 1; });

  const you = viewer ? rows.find((r) => r.id === viewer) || null : null;
  return {
    window: span,
    total: rows.length,
    rows: rows.slice(0, limit),
    /* Sent separately so someone in 340th place still sees their own line
     * under the top hundred rather than having to hunt for it. */
    you: you && you.rank > limit ? you : null,
  };
}

module.exports = { blank, rowFor, award, forUser, markSeen, equip, publicFor, leaderboard, playedToday, AWARDS_KEPT };
