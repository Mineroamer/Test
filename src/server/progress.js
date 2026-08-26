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
const achievements = require("./achievements.js");

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
  /* Achievements earned, and when. Some carry a cosmetic that is on no tier
   * of the pass, so this is also part of what the player may wear. */
  badges: {},   // id -> when it was earned
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
  if (!row.badges || typeof row.badges !== "object") row.badges = {};
  return row;
}

/** Which achievements a player has, as a plain list of ids. */
const badgesOf = (row) => Object.keys(row.badges || {});

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
function award(store, userId, { game, mode, difficulty, summary, took, already = 0, record = {} }) {
  if (!userId) return null;

  const row = rowFor(store, userId);
  const before = xp.progressFor(row.xp);
  const earned = xp.award({ game, mode, difficulty, summary, took, already });

  /*
   * Achievements are settled with the round, and their XP goes in with it, so
   * the level is worked out once from the whole lot. A round that both fills
   * the bar and earns a badge should level you up once, not twice.
   */
  const now = Date.now();
  const badges = achievements.earnedBy(
    { game, mode, difficulty, summary, took, won: !!(summary && summary.won), ...record },
    badgesOf(row)
  );
  for (const one of badges) row.badges[one.id] = now;
  const badgeXp = badges.reduce((sum, one) => sum + one.xp, 0);

  row.xp += earned.xp + badgeXp;
  row.level = xp.levelFor(row.xp);
  const after = xp.progressFor(row.xp);

  row.awards.push({ at: now, game, mode, xp: earned.xp + badgeXp });
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
    badges: badges.map((one) => achievements.publicOf(one, now)),
    badgeXp,
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

/**
 * Settle the end of a duel for one of the two people in it.
 *
 * Kept apart from `award` on purpose. A duel pays when it is *decided*, which
 * is usually not when either round finished: the person who played first is
 * paid for winning hours later, while they are not looking. So this returns
 * what happened rather than assuming anyone is there to be told, and the
 * screen reads it off the challenge next time it is opened.
 *
 * `outcome` is "won", "drew", "lost", or "missed" for somebody who never
 * played. Missing pays nothing - it is the one way to get nothing out of a
 * duel, and it should be, or a challenge would be free XP for ignoring it.
 */
function duel(store, userId, { outcome, record = {} }) {
  if (!userId) return null;

  const row = rowFor(store, userId);
  const before = xp.progressFor(row.xp);
  const gained = xp.duelXp(outcome);

  const now = Date.now();
  const badges = achievements.earnedBy({ kind: "duel", ...record }, badgesOf(row));
  for (const one of badges) row.badges[one.id] = now;
  const badgeXp = badges.reduce((sum, one) => sum + one.xp, 0);

  row.xp += gained + badgeXp;
  row.level = xp.levelFor(row.xp);
  const after = xp.progressFor(row.xp);

  if (gained + badgeXp > 0) {
    row.awards.push({ at: now, game: "duel", mode: "challenge", xp: gained + badgeXp });
    if (row.awards.length > AWARDS_KEPT) row.awards = row.awards.slice(-AWARDS_KEPT);
  }
  store.touch();

  return {
    outcome,
    xp: gained,
    badges: badges.map((one) => achievements.publicOf(one, now)),
    badgeXp,
    before: before.level,
    after: after.level,
    levelled: after.level > before.level,
    unlocked: after.level > before.level
      ? levelsBetween(before.level, after.level).flatMap((l) => cosmetics.rewardsAt(l))
      : [],
  };
}

/** Everything the browser needs to draw the pass for one player. */
function forUser(store, userId) {
  const row = rowFor(store, userId);
  const progress = xp.progressFor(row.xp);
  const badges = badgesOf(row);
  return {
    ...progress,
    character: row.character,
    /* What has not been shown yet. The screen clears it once it has. */
    pending: progress.level > (row.seenLevel || 1) ? (row.seenLevel || 1) : null,
    /* Everything wearable: what the track has given, plus what was earned. */
    unlocked: cosmetics.unlockedFor(progress.level, badges).map((item) => ({ ...item })),
    track: cosmetics.track(xp, progress.level),
    badges,
  };
}

/**
 * Every achievement, with the ones this player has marked and dated.
 *
 * The locked ones are listed too. A goal you cannot see is not a goal, and a
 * list that only shows what you already have is a trophy cabinet rather than
 * something to aim at.
 */
function achievementsFor(store, userId) {
  const row = rowFor(store, userId);
  return achievements.ACHIEVEMENTS.map((one) => ({
    ...achievements.publicOf(one, row.badges[one.id] || null),
    earned: !!row.badges[one.id],
  }));
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
  row.character = cosmetics.sanitise(
    wanted, xp.levelFor(row.xp), user ? user.colour : 200, badgesOf(row));
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

module.exports = {
  blank, rowFor, award, duel, forUser, achievementsFor, markSeen, equip, publicFor,
  leaderboard, playedToday, badgesOf, AWARDS_KEPT,
};
