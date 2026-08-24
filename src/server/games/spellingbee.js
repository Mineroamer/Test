"use strict";
/*
 * Spelling Bee.
 *
 * Seven letters, one of them compulsory. Make words of four letters or more.
 * A word may reuse a letter as often as it likes, which is why the letter sets
 * were built from words with at most seven distinct letters.
 *
 * Every letter set in the data file is guaranteed to have at least one pangram
 * and between 20 and 90 words, so there is always something to find and never
 * an evening's work.
 */

const path = require("node:path");
const { rngFor, pick, shuffle } = require("../rng.js");

const DATA = path.join(__dirname, "..", "..", "..", "data");
const WORDS = require(path.join(DATA, "bee-words.json"));
const SETS = require(path.join(DATA, "bee-puzzles.json"));

/* Bucket the dictionary by its distinct letters once, so scoring a puzzle is a
 * scan of a few hundred buckets rather than 42,000 words. */
const BY_LETTERS = new Map();
for (const word of WORDS) {
  const key = [...new Set(word)].sort().join("");
  let bucket = BY_LETTERS.get(key);
  if (!bucket) BY_LETTERS.set(key, (bucket = []));
  bucket.push(word);
}

/* Ranks as a share of the maximum score, lowest first. */
const RANKS = [
  { name: "Beginner", at: 0 },
  { name: "Good Start", at: 0.05 },
  { name: "Moving Up", at: 0.1 },
  { name: "Good", at: 0.2 },
  { name: "Solid", at: 0.3 },
  { name: "Nice", at: 0.4 },
  { name: "Great", at: 0.5 },
  { name: "Amazing", at: 0.65 },
  { name: "Genius", at: 0.8 },
  { name: "Queen Bee", at: 1 },
];

const scoreWord = (word, letters) => {
  if (word.length === 4) return 1;
  const pangram = [...letters].every((c) => word.includes(c));
  return word.length + (pangram ? 7 : 0);
};

const isPangram = (word, letters) => [...letters].every((c) => word.includes(c));

/** Every word this puzzle accepts. */
function solve(centre, letters) {
  const set = new Set(letters);
  const found = [];
  for (const [key, bucket] of BY_LETTERS) {
    /* The bucket key is the word's distinct letters, so a bucket whose key
     * lacks the centre letter holds no word that uses it. */
    if (!key.includes(centre)) continue;
    if (![...key].every((c) => set.has(c))) continue;
    for (const word of bucket) found.push(word);
  }
  return found.sort();
}

function build(code) {
  const centre = code[0];
  const outer = code.slice(1).split("");
  const letters = code.split("").sort().join("");
  const answers = solve(centre, letters);
  const maxScore = answers.reduce((sum, w) => sum + scoreWord(w, letters), 0);
  return {
    centre,
    outer,
    letters,
    answers,
    pangrams: answers.filter((w) => isPangram(w, letters)),
    maxScore,
  };
}

const dailyPuzzle = (day) => build(pick(SETS, rngFor("bee:daily:" + day)));
const randomPuzzle = (seed) => build(pick(SETS, rngFor("bee:free:" + seed)));

const create = () => ({ found: [], score: 0, hints: [], status: "playing" });

function rankFor(score, maxScore) {
  const share = maxScore ? score / maxScore : 0;
  let current = RANKS[0];
  for (const rank of RANKS) if (share >= rank.at) current = rank;
  const next = RANKS.find((r) => r.at > share) || null;
  return {
    name: current.name,
    share,
    next: next ? { name: next.name, at: Math.ceil(next.at * maxScore) } : null,
  };
}

function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const word = String(input || "").trim().toLowerCase();
  if (word.length < 4) return { ok: false, message: "Four letters or more." };
  if (!/^[a-z]+$/.test(word)) return { ok: false, message: "Letters only." };
  if (!word.includes(puzzle.centre)) {
    return { ok: false, message: `Every word needs ${puzzle.centre.toUpperCase()}.` };
  }
  if (![...word].every((c) => puzzle.letters.includes(c))) {
    return { ok: false, message: "That uses a letter the hive does not have." };
  }
  if (state.found.includes(word)) return { ok: false, message: "Already found." };
  if (!puzzle.answers.includes(word)) return { ok: false, message: "Not in the word list." };

  const points = scoreWord(word, puzzle.letters);
  const pangram = isPangram(word, puzzle.letters);
  state.found.push(word);
  state.score += points;

  /* Finding everything ends the round; otherwise the Bee is open-ended and the
   * player stops when they choose to. */
  if (state.found.length === puzzle.answers.length) state.status = "won";

  return { ok: true, word, points, pangram, score: state.score, status: state.status, rank: rankFor(state.score, puzzle.maxScore) };
}

/*
 * The hint gives away the opening two letters and the length of a word still
 * out there - the same shape of nudge the real game's letter grid provides.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const left = puzzle.answers.filter((w) => !state.found.includes(w));
  if (!left.length) return { ok: false, message: "You have found them all." };

  /* Prefer a pangram if one is still hiding - it is worth the most. */
  const pool = left.filter((w) => isPangram(w, puzzle.letters));
  const word = pick(pool.length ? pool : left, rngFor(puzzle.letters + ":" + state.hints.length));
  const revealed = { start: word.slice(0, 2), length: word.length, pangram: isPangram(word, puzzle.letters) };
  state.hints.push(revealed);
  return { ok: true, hint: revealed };
}

/** Give up: end the round and show what was there. */
function reveal(puzzle, state) {
  if (state.status === "playing") state.status = "done";
  return { ok: true, status: state.status };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  centre: puzzle.centre,
  outer: puzzle.outer,
  total: puzzle.answers.length,
  pangramCount: puzzle.pangrams.length,
  maxScore: puzzle.maxScore,
  found: state.found,
  score: state.score,
  hints: state.hints,
  rank: rankFor(state.score, puzzle.maxScore),
  status: state.status,
  answers: finished(state) ? puzzle.answers : null,
});

const summary = (puzzle, state) => ({
  /* "Won" here means Genius or better - the Bee's own bar for a good night. */
  won: state.score >= puzzle.maxScore * 0.8,
  guesses: state.found.length,
  hints: state.hints.length,
  score: state.score,
  maxScore: puzzle.maxScore,
  rank: rankFor(state.score, puzzle.maxScore).name,
});

module.exports = {
  key: "bee",
  name: "Spelling Bee",
  custom: false,
  RANKS, scoreWord, isPangram, build, rankFor,
  dailyPuzzle, randomPuzzle,
  create, guess, hint, reveal, view, summary, finished,
};
