"use strict";
/*
 * Achievements: the things worth noticing that a level cannot say.
 *
 * XP measures how well a round went and adds up over months. It cannot say
 * "you got it in one", or "you found every word in the hive", or "you did all
 * nine of today's puzzles" - those are moments, not gradients, and a number
 * going up quietly is a poor way to mark one.
 *
 * Every achievement is checked against one finished round plus what the player
 * has done before it, and every one pays XP. Twelve of them also hand over a
 * cosmetic that is on no tier of the pass: the only way to get the horseshoe is
 * to guess a Wordle in one, and no amount of playing will hand it to you.
 *
 * Two rules the list follows:
 *
 *   - Nothing here rewards volume alone for its own sake. The "played a lot"
 *     ones exist, but they are worth less than the ones that ask you to play
 *     well, for the same reason unlimited rounds are worth a third of a daily.
 *   - Nothing is hidden. A locked achievement shows what it wants, because a
 *     secret you cannot aim at is not a goal, it is a surprise - and surprises
 *     do not survive being listed on a screen anyway.
 */

const cosmetics = require("./cosmetics.js");

/*
 * Every achievement.
 *
 * `check` is given one round and the record it lands in, and says whether the
 * achievement just happened. It is only ever called for a round that has
 * finished, and only for somebody with an account.
 */
const ACHIEVEMENTS = [
  /* ---------------------------------------------------------------- wordle */
  {
    id: "wordle:one",
    game: "wordle",
    name: "Lucky Strike",
    blurb: "Guess the word first try.",
    xp: 500,
    rarity: "legendary",
    cosmetic: { slot: "held", id: "horseshoe" },
    check: (r) => r.won && r.summary.guesses === 1,
  },
  {
    id: "wordle:two",
    game: "wordle",
    name: "Second Sight",
    blurb: "Get there on the second guess.",
    xp: 180,
    rarity: "epic",
    check: (r) => r.won && r.summary.guesses === 2,
  },
  {
    id: "wordle:clean",
    game: "wordle",
    name: "Unaided",
    blurb: "Win without taking a hint.",
    xp: 60,
    rarity: "common",
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "wordle:streak",
    game: "wordle",
    name: "A Week of Words",
    blurb: "Win the daily seven days running.",
    xp: 350,
    rarity: "epic",
    cosmetic: { slot: "title", id: "devotee" },
    check: (r) => r.mode === "daily" && r.streak >= 7,
  },
  {
    id: "wordle:fifty",
    game: "wordle",
    name: "Fifty Words",
    blurb: "Win fifty rounds of Wordle.",
    xp: 400,
    rarity: "rare",
    check: (r) => r.wins >= 50,
  },

  /* ----------------------------------------------------------- connections */
  {
    id: "connections:perfect",
    game: "connections",
    name: "Straight Through",
    blurb: "All four groups, no mistakes.",
    xp: 200,
    rarity: "rare",
    check: (r) => r.won && !r.summary.mistakes,
  },
  {
    id: "connections:purple",
    game: "connections",
    name: "Hardest First",
    blurb: "Open with the trickiest group.",
    xp: 300,
    rarity: "epic",
    cosmetic: { slot: "face", id: "smug" },
    check: (r) => {
      const first = r.summary.grid && r.summary.grid[0];
      return !!first && first.length === 4 && first.every((level) => level === 3);
    },
  },
  {
    id: "connections:streak",
    game: "connections",
    name: "Five in a Row",
    blurb: "Win the daily five days running.",
    xp: 260,
    rarity: "rare",
    check: (r) => r.mode === "daily" && r.streak >= 5,
  },
  {
    id: "connections:many",
    game: "connections",
    name: "Sorted",
    blurb: "Win twenty-five rounds of Connections.",
    xp: 380,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ------------------------------------------------------------------- bee */
  {
    id: "bee:queen",
    game: "bee",
    name: "Queen Bee",
    blurb: "Find every single word in the hive.",
    xp: 600,
    rarity: "legendary",
    cosmetic: { slot: "head", id: "antennae" },
    check: (r) => r.summary.maxScore > 0 && r.summary.score >= r.summary.maxScore,
  },
  {
    id: "bee:pangram",
    game: "bee",
    name: "Every Letter",
    blurb: "Find a word using all seven letters.",
    xp: 140,
    rarity: "rare",
    check: (r) => !!r.summary.pangrams,
  },
  {
    id: "bee:genius",
    game: "bee",
    name: "Genius",
    blurb: "Reach the Bee's own bar for a good night.",
    xp: 150,
    rarity: "common",
    check: (r) => r.won,
  },
  {
    id: "bee:many",
    game: "bee",
    name: "Hive Mind",
    blurb: "Reach Genius twenty-five times.",
    xp: 380,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ----------------------------------------------------------------- boxed */
  {
    id: "boxed:two",
    game: "boxed",
    name: "In Two",
    blurb: "Empty the box in two words, the way it was built.",
    xp: 300,
    rarity: "epic",
    cosmetic: { slot: "title", id: "economist" },
    check: (r) => r.won && r.summary.guesses <= 2,
  },
  {
    id: "boxed:clean",
    game: "boxed",
    name: "No Peeking",
    blurb: "Solve a box without a hint.",
    xp: 90,
    rarity: "common",
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "boxed:many",
    game: "boxed",
    name: "Boxed In",
    blurb: "Solve twenty-five boxes.",
    xp: 360,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ------------------------------------------------------------------ mini */
  {
    id: "mini:fast",
    game: "mini",
    name: "Under the Minute",
    blurb: "Fill the Mini in less than sixty seconds.",
    xp: 300,
    rarity: "epic",
    cosmetic: { slot: "held", id: "stopwatch" },
    check: (r) => r.won && r.took > 0 && r.took < 60000,
  },
  {
    id: "mini:clean",
    game: "mini",
    name: "Straight In",
    blurb: "Fill the Mini without a check or a reveal.",
    xp: 120,
    rarity: "common",
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "mini:streak",
    game: "mini",
    name: "Morning Ritual",
    blurb: "Solve the daily Mini seven days running.",
    xp: 320,
    rarity: "epic",
    check: (r) => r.mode === "daily" && r.streak >= 7,
  },

  /* ------------------------------------------------------------- crossword */
  {
    id: "crossword:clean",
    game: "crossword",
    name: "Fifteen by Fifteen",
    blurb: "Fill the whole crossword with no help at all.",
    xp: 700,
    rarity: "legendary",
    cosmetic: { slot: "frame", id: "star" },
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "crossword:fast",
    game: "crossword",
    name: "Against the Clock",
    blurb: "Finish the crossword inside twelve minutes.",
    xp: 400,
    rarity: "epic",
    check: (r) => r.won && r.took > 0 && r.took < 12 * 60000,
  },
  {
    id: "crossword:many",
    game: "crossword",
    name: "Cruciverbalist",
    blurb: "Finish ten crosswords.",
    xp: 400,
    rarity: "rare",
    check: (r) => r.wins >= 10,
  },

  /* --------------------------------------------------------------- strands */
  {
    id: "strands:clean",
    game: "strands",
    name: "Unlit",
    blurb: "Find every theme word without a hint.",
    xp: 300,
    rarity: "epic",
    cosmetic: { slot: "held", id: "torch" },
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "strands:spangram",
    game: "strands",
    name: "Named It",
    blurb: "Find the spangram before anything else.",
    xp: 340,
    rarity: "epic",
    check: (r) => (r.summary.grid || [])[0] === "spangram",
  },
  {
    id: "strands:many",
    game: "strands",
    name: "Threadbare",
    blurb: "Finish twenty-five boards.",
    xp: 360,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ------------------------------------------------------------------ pips */
  {
    id: "pips:clean",
    game: "pips",
    name: "By Hand",
    blurb: "Cover a board without a single hint.",
    xp: 280,
    rarity: "epic",
    cosmetic: { slot: "title", id: "tilewright" },
    check: (r) => r.won && !r.summary.hints,
  },
  {
    id: "pips:streak",
    game: "pips",
    name: "Domino Effect",
    blurb: "Cover the daily board seven days running.",
    xp: 320,
    rarity: "epic",
    check: (r) => r.mode === "daily" && r.streak >= 7,
  },
  {
    id: "pips:many",
    game: "pips",
    name: "Full Set",
    blurb: "Cover twenty-five boards.",
    xp: 360,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ---------------------------------------------------------------- travle */
  {
    id: "travle:par",
    game: "travle",
    name: "As the Crow Flies",
    blurb: "Walk a route without a wasted guess.",
    xp: 200,
    rarity: "rare",
    check: (r) => r.won && r.summary.over === 0,
  },
  {
    id: "travle:expert",
    game: "travle",
    name: "No Wrong Turns",
    blurb: "Walk an Expert route at par.",
    xp: 500,
    rarity: "legendary",
    cosmetic: { slot: "outfit", id: "sash" },
    check: (r) => r.won && r.difficulty === "expert" && r.summary.over === 0,
  },
  {
    id: "travle:sea",
    game: "travle",
    name: "Sea Legs",
    blurb: "Cross the water to get where you are going.",
    xp: 130,
    rarity: "common",
    check: (r) => r.won && r.summary.crossings > 0,
  },
  {
    id: "travle:many",
    game: "travle",
    name: "Well Travelled",
    blurb: "Finish twenty-five walks.",
    xp: 360,
    rarity: "rare",
    check: (r) => r.wins >= 25,
  },

  /* ------------------------------------------------------------- the club */
  {
    id: "club:sweep",
    game: null,
    name: "Clean Sweep",
    blurb: "Finish every one of today's daily puzzles.",
    xp: 900,
    rarity: "legendary",
    cosmetic: { slot: "backdrop", id: "confetti" },
    check: (r) => r.dailiesToday >= r.gamesOffered,
  },
  {
    id: "club:everything",
    game: null,
    name: "All-Rounder",
    blurb: "Win at least one round of every game.",
    xp: 500,
    rarity: "legendary",
    cosmetic: { slot: "title", id: "allrounder" },
    check: (r) => r.gamesWon >= r.gamesOffered,
  },
  {
    id: "club:hundred",
    game: null,
    name: "Regular",
    blurb: "Play a hundred rounds.",
    xp: 300,
    rarity: "rare",
    check: (r) => r.totalPlayed >= 100,
  },
  {
    id: "club:shared",
    game: null,
    name: "Puzzle Setter",
    blurb: "Build a puzzle that somebody else solves.",
    xp: 250,
    rarity: "epic",
    cosmetic: { slot: "title", id: "setter" },
    check: (r) => r.solvesOfMine > 0,
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((one) => [one.id, one]));

const find = (id) => BY_ID.get(id) || null;

/** Everything a given game can earn, in the order it is listed. */
const forGame = (game) => ACHIEVEMENTS.filter((one) => one.game === game);

/** The cosmetics only an achievement can hand over. */
const COSMETIC_FOR = new Map(
  ACHIEVEMENTS.filter((one) => one.cosmetic)
    .map((one) => [`${one.cosmetic.slot}:${one.cosmetic.id}`, one.id])
);

/**
 * Which achievements this round just earned.
 *
 * `already` is what the player has; nothing is ever earned twice. A check that
 * throws is treated as not earned rather than allowed to take the round down
 * with it - an achievement is a garnish, and a bad one must not cost somebody
 * the puzzle they just finished.
 */
function earnedBy(round, already = []) {
  const has = new Set(already);
  const won = [];

  for (const one of ACHIEVEMENTS) {
    if (has.has(one.id)) continue;
    if (one.game && one.game !== round.game) continue;
    try {
      if (one.check(round)) won.push(one);
    } catch {
      /* A broken check is a broken garnish, not a broken round. */
    }
  }
  return won;
}

/*
 * What the browser is told about one achievement.
 *
 * The cosmetic is named here rather than looked up on the other side: the
 * achievements screen can be the first thing somebody opens, and a prize that
 * reads "Unlocks: horseshoe" because the wardrobe had not loaded yet is worse
 * than no prize line at all.
 */
function publicOf(one, earnedAt) {
  const prize = one.cosmetic
    ? cosmetics.find(one.cosmetic.slot, one.cosmetic.id)
    : null;

  return {
    id: one.id,
    game: one.game,
    name: one.name,
    blurb: one.blurb,
    xp: one.xp,
    rarity: one.rarity,
    cosmetic: one.cosmetic
      ? {
          slot: one.cosmetic.slot,
          id: one.cosmetic.id,
          name: prize ? prize.name : one.cosmetic.id,
          rarity: prize ? prize.rarity : one.rarity,
        }
      : null,
    at: earnedAt || null,
  };
}

module.exports = { ACHIEVEMENTS, COSMETIC_FOR, find, forGame, earnedBy, publicOf };
