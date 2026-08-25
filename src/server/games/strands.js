"use strict";
/*
 * Strands.
 *
 * Every letter on the board belongs to exactly one theme word, so finding them
 * all fills the board. Words are traced square to square, diagonals allowed.
 *
 * The one that names the theme - the spangram - reaches from one side of the
 * board to the other, and is marked differently when found.
 *
 * Words that are not part of the theme are not wrong, they are how you buy
 * help: three of them earn a hint, and a hint lights up the squares of a word
 * you have not found without telling you what it is.
 */

const path = require("node:path");
const { buildStubbornly, NEIGHBOURS } = require("../strands.js");

const THEMES = require(path.join(__dirname, "..", "..", "..", "data", "strands-themes.js"));
const DICTIONARY = new Set(require(path.join(__dirname, "..", "..", "..", "data", "boxed-words.json")));

const WORDS_PER_HINT = 3;
const MIN_LENGTH = 4;

const dailyPuzzle = (day) => buildStubbornly(`strands:daily:${day}`, THEMES, { msBudget: 2500 });
const randomPuzzle = (seed) => buildStubbornly(`strands:free:${seed}`, THEMES, { msBudget: 2500 });

const create = () => ({
  found: [],        // theme words, in the order they were found
  extras: [],       // real words that are not part of the theme
  hintsUsed: 0,
  revealed: [],     // indexes of entries whose squares are lit
  status: "playing",
});

const hintsEarned = (state) => Math.floor(state.extras.length / WORDS_PER_HINT) - state.hintsUsed;

/** Is this a legal trace: touching squares, and no square twice? */
function isPath(cells) {
  if (new Set(cells).size !== cells.length) return false;
  for (let i = 1; i < cells.length; i++) {
    if (!NEIGHBOURS[cells[i - 1]] || !NEIGHBOURS[cells[i - 1]].includes(cells[i])) return false;
  }
  return true;
}

const sameCells = (a, b) => a.length === b.length && a.every((cell, i) => cell === b[i]);

function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This one is already done." };

  const cells = (Array.isArray(input) ? input : []).map(Number);
  if (cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= puzzle.letters.length)) {
    return { ok: false, message: "That is not on the board." };
  }
  if (cells.length < MIN_LENGTH) return { ok: false, message: "Four letters or more." };
  if (!isPath(cells)) return { ok: false, message: "Letters have to join up." };

  const word = cells.map((cell) => puzzle.letters[cell]).join("");

  /* A theme word counts when it is traced along its own squares - which, since
   * every square belongs to exactly one word, is the only way to spell it. */
  const themeIndex = puzzle.entries.findIndex(
    (entry) => sameCells(entry.cells, cells) || sameCells([...entry.cells].reverse(), cells));

  if (themeIndex !== -1) {
    const entry = puzzle.entries[themeIndex];
    if (state.found.includes(entry.word)) {
      return { ok: false, message: `${entry.word} is already found.` };
    }
    state.found.push(entry.word);
    if (!state.revealed.includes(themeIndex)) state.revealed.push(themeIndex);

    if (state.found.length === puzzle.entries.length) state.status = "won";
    return {
      ok: true,
      theme: true,
      spangram: entry.spangram,
      word: entry.word,
      cells: entry.cells,
      status: state.status,
    };
  }

  if (!DICTIONARY.has(word.toLowerCase())) {
    return { ok: false, message: "Not a word." };
  }
  if (state.extras.includes(word)) {
    return { ok: false, message: `${word} again.` };
  }

  state.extras.push(word);
  const earned = state.extras.length % WORDS_PER_HINT === 0;
  return {
    ok: true,
    theme: false,
    word,
    extras: state.extras.length,
    earnedHint: earned,
    toNextHint: WORDS_PER_HINT - (state.extras.length % WORDS_PER_HINT),
    status: state.status,
  };
}

/*
 * A hint lights the squares of a word still to find. It does not say which
 * word - you still have to see it - which is what keeps a hint a nudge.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This one is already done." };
  if (hintsEarned(state) < 1) {
    const need = WORDS_PER_HINT - (state.extras.length % WORDS_PER_HINT);
    return {
      ok: false,
      message: `Find ${need} more word${need === 1 ? "" : "s"} of your own to earn a hint.`,
    };
  }

  const next = puzzle.entries.findIndex(
    (entry, index) => !state.found.includes(entry.word) && !state.revealed.includes(index));
  if (next === -1) return { ok: false, message: "Nothing left to point at." };

  state.hintsUsed += 1;
  state.revealed.push(next);
  return { ok: true, hint: { cells: puzzle.entries[next].cells }, status: state.status };
}

function reveal(puzzle, state) {
  if (state.status === "playing") state.status = "done";
  return { ok: true, status: state.status };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  rows: puzzle.rows,
  cols: puzzle.cols,
  theme: puzzle.theme,
  letters: puzzle.letters,
  total: puzzle.entries.length,
  found: state.found,
  /* The squares of every word found, so the board can keep them coloured. */
  foundCells: puzzle.entries
    .filter((entry) => state.found.includes(entry.word))
    .map((entry) => ({ word: entry.word, spangram: entry.spangram, cells: entry.cells })),
  /* Lit by a hint but not yet found: shown without saying what they spell. */
  litCells: state.revealed
    .filter((index) => !state.found.includes(puzzle.entries[index].word))
    .map((index) => puzzle.entries[index].cells),
  extras: state.extras,
  hintsAvailable: Math.max(0, hintsEarned(state)),
  toNextHint: WORDS_PER_HINT - (state.extras.length % WORDS_PER_HINT),
  status: state.status,
  answers: finished(state)
    ? puzzle.entries.map((entry) => ({ word: entry.word, spangram: entry.spangram, cells: entry.cells }))
    : null,
});

const summary = (puzzle, state) => ({
  won: state.status === "won",
  guesses: state.found.length,
  hints: state.hintsUsed,
  extras: state.extras.length,
  total: puzzle.entries.length,
  /* The order words were found in, spangram marked - the shareable pattern. */
  grid: puzzle.entries
    .filter((entry) => state.found.includes(entry.word))
    .sort((a, b) => state.found.indexOf(a.word) - state.found.indexOf(b.word))
    .map((entry) => (entry.spangram ? "spangram" : "theme")),
});

module.exports = {
  key: "strands",
  name: "Strands",
  custom: false,
  WORDS_PER_HINT, MIN_LENGTH, THEMES,
  dailyPuzzle, randomPuzzle,
  create, guess, hint, reveal, view, summary, finished,
};
