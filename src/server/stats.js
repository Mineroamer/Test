"use strict";
/*
 * What the app remembers about how you have played.
 *
 * Two things are kept: a running tally per game and mode, which is what the
 * stats page reads, and a capped log of finished rounds, which is what the
 * friends feed reads. The tally is updated as rounds finish rather than
 * recomputed, so opening the stats page never depends on how long you have
 * been playing.
 *
 * Streaks only mean anything for the daily puzzles - an unlimited streak would
 * just be a measure of how long you sat there - so they are tracked for daily
 * and left alone otherwise.
 */

const LOG_PER_USER = 250;

/*
 * A record is kept per game and mode, and optionally per variant.
 *
 * The variant exists for Travle, whose three daily levels are three different
 * walks rather than one walk at three settings - the game says so itself. Kept
 * under one key they would share a streak, and finishing Scenic would quietly
 * stamp the day for Standard too.
 */
const keyFor = (game, mode, variant) =>
  (variant ? `${game}:${mode}:${variant}` : `${game}:${mode}`);

const blank = () => ({
  played: 0,
  won: 0,
  streak: 0,
  maxStreak: 0,
  lastDay: null,
  guesses: 0,      // total guesses across all rounds, for an average
  hints: 0,
  timeMs: 0,
  distribution: {}, // guesses taken -> how many wins took that many
  best: null,      // fewest guesses in a win
});

function bucketFor(store, userId, game, mode, variant) {
  const all = store.data.stats[userId] || (store.data.stats[userId] = {});
  const key = keyFor(game, mode, variant);
  return all[key] || (all[key] = blank());
}

/**
 * Fold a finished round into the tallies.
 *
 * `day` is only passed for daily rounds; it is what lets a streak tell the
 * difference between playing two days running and playing twice today.
 */
function record(store, userId, { game, mode, day, summary, startedAt, finishedAt, custom, variant }) {
  if (!userId) return null; // guests play, but nothing is written down

  const bucket = bucketFor(store, userId, game, mode, variant);
  const took = Math.max(0, (finishedAt || Date.now()) - (startedAt || Date.now()));

  bucket.played += 1;
  bucket.guesses += summary.guesses || 0;
  bucket.hints += summary.hints || 0;
  bucket.timeMs += took;

  if (summary.won) {
    bucket.won += 1;
    const n = summary.guesses || 0;
    bucket.distribution[n] = (bucket.distribution[n] || 0) + 1;
    if (bucket.best === null || n < bucket.best) bucket.best = n;
  }

  if (mode === "daily" && typeof day === "number") {
    if (summary.won) {
      /* A win the day after the last one extends the streak; a win after a gap
       * starts a new one. Replaying the same day cannot pad it. */
      bucket.streak = bucket.lastDay === day - 1 ? bucket.streak + 1 : bucket.lastDay === day ? bucket.streak : 1;
      if (bucket.streak > bucket.maxStreak) bucket.maxStreak = bucket.streak;
    } else if (bucket.lastDay !== day) {
      bucket.streak = 0;
    }
    bucket.lastDay = day;
  }

  const entry = {
    userId,
    game,
    mode,
    variant: variant || null,
    day: typeof day === "number" ? day : null,
    won: !!summary.won,
    guesses: summary.guesses || 0,
    hints: summary.hints || 0,
    took,
    custom: custom || null,
    at: finishedAt || Date.now(),
  };
  store.data.results.push(entry);
  trim(store, userId);
  store.touch();
  return entry;
}

/** Keep the log from growing without bound, oldest of this user's first. */
function trim(store, userId) {
  const mine = store.data.results.filter((r) => r.userId === userId);
  if (mine.length <= LOG_PER_USER) return;
  const drop = new Set(mine.slice(0, mine.length - LOG_PER_USER));
  store.data.results = store.data.results.filter((r) => !drop.has(r));
}

/** A streak that was not kept up is over, even before the next round is played. */
function currentStreak(bucket, today) {
  if (!bucket || bucket.lastDay === null) return 0;
  return bucket.lastDay >= today - 1 ? bucket.streak : 0;
}

function forUser(store, userId, today) {
  const all = store.data.stats[userId] || {};
  const out = {};
  for (const [key, bucket] of Object.entries(all)) {
    const [game, mode, variant] = key.split(":");
    out[key] = {
      game,
      mode,
      variant: variant || null,
      played: bucket.played,
      won: bucket.won,
      winRate: bucket.played ? bucket.won / bucket.played : 0,
      streak: mode === "daily" ? currentStreak(bucket, today) : 0,
      maxStreak: bucket.maxStreak,
      averageGuesses: bucket.played ? bucket.guesses / bucket.played : 0,
      hints: bucket.hints,
      best: bucket.best,
      averageTimeMs: bucket.played ? Math.round(bucket.timeMs / bucket.played) : 0,
      distribution: bucket.distribution,
    };
  }
  return out;
}

/** Totals across every game, for the one line at the top of the stats page. */
function totals(store, userId, today) {
  const per = forUser(store, userId, today);
  const list = Object.values(per);
  return {
    played: list.reduce((n, b) => n + b.played, 0),
    won: list.reduce((n, b) => n + b.won, 0),
    hints: list.reduce((n, b) => n + b.hints, 0),
    bestStreak: list.reduce((n, b) => Math.max(n, b.maxStreak), 0),
    currentStreak: list.reduce((n, b) => Math.max(n, b.streak), 0),
  };
}

const recent = (store, userIds, limit = 30) => {
  const wanted = new Set(userIds);
  return store.data.results.filter((r) => wanted.has(r.userId)).slice(-limit).reverse();
};

/** Which of today's dailies a user has already finished. */
function todayProgress(store, userId, today) {
  const done = {};
  for (const r of store.data.results) {
    if (r.userId !== userId || r.mode !== "daily" || r.day !== today) continue;
    done[r.game] = { won: r.won, guesses: r.guesses, hints: r.hints };
  }
  return done;
}

module.exports = { record, forUser, totals, recent, todayProgress, keyFor, blank, currentStreak, LOG_PER_USER };
