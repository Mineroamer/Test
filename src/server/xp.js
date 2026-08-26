"use strict";
/*
 * Experience: what a finished round is worth.
 *
 * The point of this file is that XP is earned for playing *well*, not for
 * playing *often*. A leaderboard built on volume is a leaderboard of whoever
 * had the most free time, which is the same objection the stats module already
 * raises against unlimited streaks. So two things shape every award:
 *
 *   1. Quality. Each game says, in its own terms, how well the round went -
 *      guesses for Wordle, mistakes for Connections, hints for Strands, how
 *      far over par for Travle - and that becomes a number from FLOOR to 1.
 *   2. Scarcity. A daily is worth full marks and can only be played once.
 *      Unlimited is worth a third, and tapers after a few rounds of the same
 *      game in a day, so grinding one game all evening stops paying.
 *
 * Nothing here touches the store. It takes a finished round and returns a
 * number, which makes it easy to test and lets the offline build - which has
 * no server and no store at all - use exactly the same formula.
 */

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/*
 * The worst possible win still earns this share of a perfect one. A win on the
 * last guess is a win, and should always beat a loss; it just should not beat
 * a win on the second guess.
 */
const FLOOR = 0.35;

/**
 * A value read against the range it can fall in: `best` scores 1, `worst`
 * scores FLOOR, anything past either end is pinned to that end.
 */
function between(value, best, worst) {
  if (worst === best) return 1;
  const share = (worst - value) / (worst - best);
  return FLOOR + (1 - FLOOR) * clamp(share, 0, 1);
}

/* What a flawless win is worth, before quality and mode are applied. Bigger
 * puzzles pay more because they take longer, not because they are harder. */
const BASE = {
  wordle: 100,
  connections: 130,
  bee: 150,
  boxed: 110,
  mini: 90,
  crossword: 240,
  strands: 140,
  pips: 130,
  travle: 130,
};

/* A loss is not nothing - you played the round - but it is not much. */
const LOSS_SHARE = 0.2;

/*
 * Quality, per game, from that game's own summary.
 *
 * Each function returns 0 to 1 and folds in whatever help was taken, because
 * "help" means something different in each game: a Wordle hint hands over a
 * letter, a Strands hint lights up a word, a crossword check only tells you
 * that a square is wrong. They are not worth the same penalty and are not
 * counted as though they were.
 */
const QUALITY = {
  /* Six guesses, and a hint gives away a letter of the answer. */
  wordle: ({ guesses, hints }) => between(guesses, 1, 6) * (1 - 0.18 * (hints || 0)),

  /* Four mistakes ends it, so three is as bad as a win gets. Hints name a
   * group outright, which is most of the puzzle. */
  connections: ({ mistakes, hints }) => between(mistakes || 0, 0, 4) * (1 - 0.22 * (hints || 0)),

  /* The Bee is scored out of its own maximum, so quality is simply how much
   * of the hive you found. Queen Bee is everything; Genius is the 80% bar the
   * game itself calls a good night. */
  bee: ({ score, maxScore, hints }) =>
    between(maxScore ? score / maxScore : 0, 1, 0.55) * (1 - 0.12 * (hints || 0)),

  /* Every box ships solvable in two words, which is what a perfect round is. */
  boxed: ({ guesses, hints }) => between(guesses, 2, 5) * (1 - 0.15 * (hints || 0)),

  mini: crosswordQuality,
  crossword: crosswordQuality,

  /* Hints are earned by finding words that are not in the theme, and each one
   * lights up a whole answer. Half the board's worth of hints is a bad round. */
  strands: ({ hints, total }) => between(hints || 0, 0, Math.max(2, (total || 8) / 2)),

  /* Same shape: a hint places a domino you would otherwise have had to work
   * out. Solving entirely by hint is not a win at all - the game says so. */
  pips: ({ hints, dominoes }) => between(hints || 0, 0, Math.max(2, (dominoes || 8) / 2)),

  /*
   * Travle counts what it costs you to get there. `over` is guesses spent
   * beyond the shortest route, and each level allows a different amount of
   * slack, so the same two wasted guesses mean more on Expert than on Scenic.
   */
  travle: ({ over, slack, hints }) =>
    between(over || 0, 0, Math.max(2, slack || 5)) * (1 - 0.2 * (hints || 0)),
};

/*
 * A crossword is judged on help taken and then on the clock, in that order.
 * Time matters here and nowhere else because a crossword is the one puzzle
 * where everyone eventually fills every square and the only question is how
 * long it took - which is exactly what the newspaper prints beside it.
 */
function crosswordQuality({ hints, squares, right }, took) {
  const help = between(hints || 0, 0, Math.max(3, (squares || 25) / 4));

  /* Seconds a square ought to take. Generous: this is meant to reward a brisk
   * solve, not to punish anyone who reads the clues. */
  const par = (squares || 25) * 4000;
  const clock = between(took || par, par / 2, par * 2.5);

  /* Filling most of it and stopping still counts for something. */
  const done = squares ? clamp(right / squares, 0, 1) : 1;
  return (help * 0.65 + clock * 0.35) * done;
}

/*
 * What each mode is worth.
 *
 * Daily is the real thing: one round per game per day, and it pays in full.
 * Unlimited is practice - it pays, because a system that pays nothing for the
 * mode people play most is a system nobody believes in, but it pays a third
 * and it tapers. Custom puzzles pay least: their difficulty is whatever their
 * author felt like, so they cannot be worth the same as a dealt one.
 *
 * A challenge sits between the two. It is a dealt puzzle, played once, and
 * somebody is watching - but you can send as many as you have friends, so it
 * cannot be worth a daily either. Half, and the win bonus below carries the
 * rest of it.
 */
const MODE_WEIGHT = { daily: 1, unlimited: 0.35, custom: 0.22, challenge: 0.5 };

/*
 * Winning a duel, on top of what the round itself paid.
 *
 * It is a flat number rather than a share of the round because the thing being
 * rewarded is not how well you played - the round already paid for that - but
 * that you beat somebody. A narrow win over a good player and a runaway win
 * over a distracted one are the same achievement from where the loser sits.
 *
 * The loser is paid too, and not nothing. A duel where losing costs you
 * something is a duel people stop accepting.
 */
const DUEL_WIN = 150;
const DUEL_DRAW = 90;
const DUEL_LOSS = 40;

/* How many rounds of one game, in one day, pay their full unlimited rate. */
const FREE_ROUNDS = 3;

/**
 * The taper on repeat rounds. The first few of a game each day are worth what
 * they say; after that the rate falls away, so an evening of Wordle is worth
 * roughly two good rounds however many you actually play.
 */
function taper(already) {
  if (already < FREE_ROUNDS) return 1;
  return FREE_ROUNDS / (already + 1);
}

/* Travle's levels are different walks, so they are worth different amounts. */
const TRAVLE_WEIGHT = { scenic: 0.9, standard: 1, expert: 1.25, unlimited: 1 };

/**
 * What one finished round earns.
 *
 * `already` is how many rounds of this game the player has finished today,
 * not counting this one. `took` is how long the round took, in milliseconds.
 * Returns the award and the pieces it was made of, so the screen can show a
 * person why they got what they got rather than just a number.
 */
function award({ game, mode, difficulty, summary, took, already = 0 }) {
  const base = BASE[game] || 100;
  /* The taper is there to stop one game being farmed all evening. A daily can
   * only be played once, and a challenge needs somebody to accept it, so
   * neither can be farmed and neither is tapered. */
  const once = mode === "daily" || mode === "challenge";
  const weight = (MODE_WEIGHT[mode] === undefined ? MODE_WEIGHT.unlimited : MODE_WEIGHT[mode])
    * (once ? 1 : taper(already));

  const level = game === "travle" ? (TRAVLE_WEIGHT[difficulty] || 1) : 1;

  if (!summary || !summary.won) {
    return {
      xp: Math.max(1, Math.round(base * LOSS_SHARE * weight * level)),
      quality: 0,
      base,
      weight,
      won: false,
    };
  }

  const measure = QUALITY[game] || (() => 1);
  const quality = clamp(measure(summary, took), 0, 1);

  return {
    xp: Math.max(1, Math.round(base * quality * weight * level)),
    quality,
    base,
    weight,
    won: true,
  };
}

/* ------------------------------------------------------------- levelling */

const LEVELS = 50;

/**
 * XP to get from the level below to this one.
 *
 * It climbs, so the early levels come quickly and the last ones are worth
 * having. A player who does every daily well earns somewhere around a
 * thousand a day, which puts the top of the track about a season away.
 */
const costOf = (level) => 250 + (level - 2) * 90;

/* Cumulative XP at the start of each level, worked out once. */
const THRESHOLDS = (function () {
  const out = [0, 0]; // index 0 unused, level 1 starts at nothing
  for (let level = 2; level <= LEVELS; level += 1) {
    out[level] = out[level - 1] + costOf(level);
  }
  return out;
})();

const TOTAL_XP = THRESHOLDS[LEVELS];

/** The level a total of XP has reached, capped at the top of the track. */
function levelFor(xp) {
  const total = Math.max(0, xp || 0);
  let level = 1;
  while (level < LEVELS && total >= THRESHOLDS[level + 1]) level += 1;
  return level;
}

/**
 * Everything a progress bar needs: the level, where this level started and
 * ends, and how far along it you are.
 *
 * Past the top of the track XP keeps counting - it is what the leaderboard
 * ranks on - but the bar sits full, because there is nothing left to unlock.
 */
function progressFor(xp) {
  const total = Math.max(0, xp || 0);
  const level = levelFor(total);
  const maxed = level >= LEVELS;
  const from = THRESHOLDS[level];
  const to = maxed ? THRESHOLDS[LEVELS] : THRESHOLDS[level + 1];
  const span = to - from;

  return {
    xp: total,
    level,
    maxed,
    into: total - from,
    needs: maxed ? 0 : to - total,
    span: maxed ? 1 : span,
    share: maxed ? 1 : clamp((total - from) / span, 0, 1),
  };
}

/** What the end of a duel is worth to one of the two people in it. */
function duelXp(outcome) {
  if (outcome === "won") return DUEL_WIN;
  if (outcome === "drew") return DUEL_DRAW;
  if (outcome === "lost") return DUEL_LOSS;
  return 0;                                   // never turned up
}

module.exports = {
  BASE, FLOOR, LEVELS, LOSS_SHARE, MODE_WEIGHT, FREE_ROUNDS, TRAVLE_WEIGHT, THRESHOLDS, TOTAL_XP,
  DUEL_WIN, DUEL_DRAW, DUEL_LOSS,
  between, taper, costOf, award, levelFor, progressFor, duelXp,
};
