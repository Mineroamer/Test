"use strict";
/*
 * Letter Boxed.
 *
 * Twelve letters, three to a side of a square. A word walks from letter to
 * letter but may never take two in a row from the same side. The next word
 * starts on the letter the last one ended on. Use all twelve to win.
 *
 * Generating a box is the interesting part. Rather than scatter letters and
 * hope, we build the box around a solution: find two words that chain and
 * between them use exactly twelve distinct letters, then place those letters
 * on sides such that neither word ever steps twice on the same side. So every
 * box that ships is solvable in two words, and the pair is the answer to show
 * at the end.
 */

const path = require("node:path");
const { rngFor, shuffle } = require("../rng.js");

const ALL = require(path.join(__dirname, "..", "..", "..", "data", "boxed-words.json"));

/* A letter sits on exactly one side, so a word with the same letter twice in a
 * row can never be legal. Drop those now rather than rejecting them later. */
const WORDS = ALL.filter((w) => !/(.)\1/.test(w));
const DICT = new Set(WORDS);

const SIDES = 4;
const PER_SIDE = 3;
const LETTERS = SIDES * PER_SIDE;
const WORD_LIMIT = 5;

const distinct = (word) => new Set(word);

/* Words that could be half of a twelve-letter pair, indexed by first letter. */
const SEEDS = WORDS.filter((w) => w.length >= 4 && distinct(w).size >= 5 && distinct(w).size <= 9);
const BY_FIRST = new Map();
for (const word of SEEDS) {
  let bucket = BY_FIRST.get(word[0]);
  if (!bucket) BY_FIRST.set(word[0], (bucket = []));
  bucket.push(word);
}

/*
 * Place letters on sides so that no word ever uses the same side twice in a
 * row. Adjacent letters in the solution words must therefore land on different
 * sides - a graph colouring with exactly three letters per colour.
 *
 * The constraint graph is sparse, so a randomised greedy pass succeeds almost
 * always; a handful of restarts covers the rest.
 */
function placeLetters(letters, conflicts, random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const order = shuffle(letters, random);
    const sides = Array.from({ length: SIDES }, () => []);
    const placed = new Map();
    let stuck = false;

    for (const letter of order) {
      const options = shuffle([0, 1, 2, 3], random).filter((side) => {
        if (sides[side].length >= PER_SIDE) return false;
        const clash = conflicts.get(letter);
        return !clash || !sides[side].some((other) => clash.has(other));
      });
      if (!options.length) { stuck = true; break; }
      sides[options[0]].push(letter);
      placed.set(letter, options[0]);
    }
    if (!stuck && sides.every((s) => s.length === PER_SIDE)) return sides;
  }
  return null;
}

/** Every adjacent pair in a word must end up on different sides. */
function conflictsFor(words) {
  const map = new Map();
  const link = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const word of words) {
    for (let i = 1; i < word.length; i++) {
      link(word[i - 1], word[i]);
      link(word[i], word[i - 1]);
    }
  }
  return map;
}

function build(seed) {
  const random = rngFor(seed);

  for (let attempt = 0; attempt < 400; attempt++) {
    const first = SEEDS[Math.floor(random() * SEEDS.length)];
    const firstLetters = distinct(first);
    const partners = BY_FIRST.get(first[first.length - 1]);
    if (!partners) continue;

    /* Look at a slice of the candidates rather than all of them, so a bad
     * first word costs little and we move on to another. */
    const start = Math.floor(random() * partners.length);
    for (let i = 0; i < 220; i++) {
      const second = partners[(start + i) % partners.length];
      if (second === first) continue;

      const union = new Set([...firstLetters, ...distinct(second)]);
      if (union.size !== LETTERS) continue;

      const letters = [...union];
      const sides = placeLetters(letters, conflictsFor([first, second]), random);
      if (!sides) continue;

      return {
        sides: sides.map((side) => side.sort()),
        letters: letters.sort(),
        solution: [first, second],
        limit: WORD_LIMIT,
      };
    }
  }
  throw new Error("letterboxed: could not build a box for seed " + seed);
}

const dailyPuzzle = (day) => build("boxed:daily:" + day);
const randomPuzzle = (seed) => build("boxed:free:" + seed);

const create = () => ({ words: [], hints: [], status: "playing" });

const sideOf = (puzzle, letter) => puzzle.sides.findIndex((side) => side.includes(letter));

const usedLetters = (state) => new Set(state.words.join(""));

function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const word = String(input || "").trim().toLowerCase();
  if (word.length < 3) return { ok: false, message: "Three letters or more." };
  if (!/^[a-z]+$/.test(word)) return { ok: false, message: "Letters only." };

  for (const letter of word) {
    if (sideOf(puzzle, letter) === -1) {
      return { ok: false, message: `There is no ${letter.toUpperCase()} on the box.` };
    }
  }
  for (let i = 1; i < word.length; i++) {
    if (sideOf(puzzle, word[i - 1]) === sideOf(puzzle, word[i])) {
      return { ok: false, message: `${word[i - 1].toUpperCase()} and ${word[i].toUpperCase()} are on the same side.` };
    }
  }

  const last = state.words[state.words.length - 1];
  if (last && word[0] !== last[last.length - 1]) {
    return { ok: false, message: `Start on ${last[last.length - 1].toUpperCase()}, where ${last.toUpperCase()} finished.` };
  }
  if (state.words.includes(word)) return { ok: false, message: "Already used." };
  if (!DICT.has(word)) return { ok: false, message: "Not in the word list." };

  state.words.push(word);

  const used = usedLetters(state);
  if (used.size === LETTERS) state.status = "won";
  else if (state.words.length >= puzzle.limit) state.status = "lost";

  return {
    ok: true,
    word,
    used: [...used].sort(),
    left: LETTERS - used.size,
    status: state.status,
  };
}

/*
 * The hint offers a word that starts where the player is standing and brings in
 * letters they have not used yet - a way on, not the way through.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const last = state.words[state.words.length - 1];
  const from = last ? last[last.length - 1] : null;
  const used = usedLetters(state);
  const boxed = new Set(puzzle.letters);

  const legal = (word) => {
    if (state.words.includes(word)) return false;
    if (![...word].every((c) => boxed.has(c))) return false;
    for (let i = 1; i < word.length; i++) {
      if (sideOf(puzzle, word[i - 1]) === sideOf(puzzle, word[i])) return false;
    }
    return true;
  };

  const pool = (from ? (BY_FIRST.get(from) || []) : SEEDS).filter(legal);
  if (!pool.length) return { ok: false, message: "No word suggests itself from there." };

  /* Whichever legal word brings in the most new letters. */
  let best = pool[0];
  let bestGain = -1;
  for (const word of pool) {
    const gain = [...distinct(word)].filter((c) => !used.has(c)).length;
    if (gain > bestGain) { best = word; bestGain = gain; }
  }

  const revealed = { start: best.slice(0, 2), length: best.length, gain: bestGain };
  state.hints.push(revealed);
  return { ok: true, hint: revealed };
}

function reveal(puzzle, state) {
  if (state.status === "playing") state.status = "done";
  return { ok: true, status: state.status };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  sides: puzzle.sides,
  limit: puzzle.limit,
  words: state.words,
  used: [...usedLetters(state)].sort(),
  left: LETTERS - usedLetters(state).size,
  hints: state.hints,
  status: state.status,
  solution: finished(state) ? puzzle.solution : null,
});

const summary = (puzzle, state) => ({
  won: state.status === "won",
  guesses: state.words.length,
  hints: state.hints.length,
  words: state.words.slice(),
});

module.exports = {
  key: "boxed",
  name: "Letter Boxed",
  custom: false,
  LETTERS, WORD_LIMIT, WORDS,
  dailyPuzzle, randomPuzzle,
  create, guess, hint, reveal, view, summary, finished, sideOf,
};
