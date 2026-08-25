"use strict";
/*
 * Connections.
 *
 * Sixteen words, four secret groups of four, four mistakes allowed.
 *
 * The boards are written whole, in data/connections-boards.js, and dealt from
 * there. Why they are not generated is explained at `deal` below; the short of
 * it is that the interference between the four categories is the puzzle, and
 * that cannot be assembled from categories written apart from each other.
 */

const path = require("node:path");
const { rngFor, shuffle, pick } = require("../rng.js");

const BOARDS = require(path.join(__dirname, "..", "..", "..", "data", "connections-boards.js"));

const MISTAKES_ALLOWED = 4;

/**
 * Deal a board.
 *
 * Boards are whole puzzles rather than four categories shuffled together,
 * because in a real Connections the four categories are chosen *with* each
 * other: five or six words seem to fit one theme, and that theme is the trap.
 * Dealing unrelated categories cannot produce that however good each one is -
 * every word simply announces where it belongs, and the puzzle becomes sorting
 * rather than solving.
 *
 * The cost is that the library is finite where a generator would not be. That
 * is the right way round: a hand-built board that misleads you is worth more
 * than an endless supply of boards that cannot.
 */
function deal(board, seed) {
  const random = rngFor(seed);
  return {
    groups: board.groups.map((group) => ({
      clue: group.clue,
      words: group.words.slice(),
      level: group.level,
    })),
    /* The grid order is fixed for the puzzle, so everyone sees the same board
     * and a shuffle in the browser is only ever cosmetic. */
    order: shuffle(board.groups.flatMap((group) => group.words), random),
  };
}

/* Each day walks one step through the library, so consecutive days are never
 * the same board and the whole set is seen before any of it comes round. */
const dailyPuzzle = (day) =>
  deal(BOARDS[((day % BOARDS.length) + BOARDS.length) % BOARDS.length], "connections:daily:" + day);

const randomPuzzle = (seed) => {
  const random = rngFor("connections:pick:" + seed);
  return deal(BOARDS[Math.floor(random() * BOARDS.length)], "connections:free:" + seed);
};

function validateCustom(payload) {
  const errors = [];
  const raw = Array.isArray(payload && payload.groups) ? payload.groups : [];

  if (raw.length !== 4) errors.push("A puzzle needs exactly four groups.");

  const seen = new Map();
  const groups = raw.slice(0, 4).map((group, index) => {
    const clue = String(group && group.clue || "").trim().slice(0, 60);
    const words = (Array.isArray(group && group.words) ? group.words : [])
      .map((w) => String(w || "").trim().toUpperCase().slice(0, 20))
      .filter(Boolean);

    if (!clue) errors.push(`Group ${index + 1} needs a name.`);
    if (words.length !== 4) errors.push(`Group ${index + 1} needs exactly four words.`);

    for (const word of words) {
      if (seen.has(word)) errors.push(`"${word}" is in two groups - every word must appear once.`);
      seen.set(word, index);
    }
    return { clue, words, level: index };
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { groups } };
}

function fromCustom(payload) {
  /* Shuffled by the puzzle's own content, so the board is stable across
   * everyone who opens the same share code. */
  const random = rngFor("custom:" + payload.groups.map((g) => g.words.join("")).join("|"));
  return {
    groups: payload.groups,
    order: shuffle(payload.groups.flatMap((g) => g.words), random),
    custom: true,
  };
}

const create = () => ({ solved: [], mistakes: 0, tries: [], hints: [], status: "playing" });

const remaining = (puzzle, state) =>
  puzzle.groups.filter((_, i) => !state.solved.includes(i));

function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const words = (Array.isArray(input) ? input : []).map((w) => String(w || "").toUpperCase());
  if (words.length !== 4) return { ok: false, message: "Pick exactly four." };
  if (new Set(words).size !== 4) return { ok: false, message: "That is the same word twice." };

  const live = new Set(remaining(puzzle, state).flatMap((g) => g.words));
  if (!words.every((w) => live.has(w))) return { ok: false, message: "Those are not all on the board." };

  const already = state.tries.some((t) => t.words.slice().sort().join() === words.slice().sort().join());
  if (already) return { ok: false, message: "You have already tried that group." };

  /* How many of the four fall in the same group tells us both whether this is
   * right and whether it is the near miss worth telling them about. */
  let best = { index: -1, overlap: 0 };
  puzzle.groups.forEach((group, index) => {
    if (state.solved.includes(index)) return;
    const overlap = words.filter((w) => group.words.includes(w)).length;
    if (overlap > best.overlap) best = { index, overlap };
  });

  state.tries.push({ words, overlap: best.overlap });

  if (best.overlap === 4) {
    state.solved.push(best.index);
    if (state.solved.length === puzzle.groups.length) state.status = "won";
    const group = puzzle.groups[best.index];
    return { ok: true, correct: true, group: { index: best.index, clue: group.clue, words: group.words, level: group.level }, status: state.status };
  }

  state.mistakes += 1;
  if (state.mistakes >= MISTAKES_ALLOWED) state.status = "lost";

  return {
    ok: true,
    correct: false,
    /* The "one away" nudge, which is most of what makes the game feel fair. */
    oneAway: best.overlap === 3,
    mistakes: state.mistakes,
    status: state.status,
  };
}

/*
 * A hint names one group and gives away a single word from it. That is enough
 * to break a deadlock without handing over a whole row.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const open = puzzle.groups
    .map((group, index) => ({ group, index }))
    .filter(({ index }) => !state.solved.includes(index));
  if (!open.length) return { ok: false, message: "Nothing left to hint at." };

  /* Easiest unsolved group first, so hints unpick the board in a sensible order. */
  open.sort((a, b) => a.group.level - b.group.level);
  const spent = state.hints.filter((h) => h.index === open[0].index).length;
  const target = open[0];

  if (spent >= 3) return { ok: false, message: "That group has given up all it will." };

  const given = new Set(state.hints.filter((h) => h.index === target.index).map((h) => h.word));
  const word = pick(target.group.words.filter((w) => !given.has(w)), rngFor(target.group.clue + spent));

  const revealed = { index: target.index, clue: target.group.clue, word };
  state.hints.push(revealed);
  return { ok: true, hint: revealed };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  order: puzzle.order,
  mistakesAllowed: MISTAKES_ALLOWED,
  mistakes: state.mistakes,
  hints: state.hints,
  tries: state.tries,
  status: state.status,
  solved: state.solved.map((index) => ({
    index,
    clue: puzzle.groups[index].clue,
    words: puzzle.groups[index].words,
    level: puzzle.groups[index].level,
  })),
  /* When it is over, everything is shown - including the groups they missed. */
  groups: finished(state)
    ? puzzle.groups.map((g, index) => ({ index, clue: g.clue, words: g.words, level: g.level }))
    : null,
});

const summary = (puzzle, state) => ({
  won: state.status === "won",
  guesses: state.tries.length,
  hints: state.hints.length,
  mistakes: state.mistakes,
  /* Each attempt as the levels of the words picked - the shareable grid. */
  grid: state.tries.map((t) =>
    t.words.map((w) => {
      const found = puzzle.groups.findIndex((g) => g.words.includes(w));
      return found === -1 ? 0 : puzzle.groups[found].level;
    })),
});

module.exports = {
  key: "connections",
  name: "Connections",
  custom: true,
  MISTAKES_ALLOWED, BOARDS,
  dailyPuzzle, randomPuzzle, validateCustom, fromCustom,
  create, guess, hint, view, summary, finished,
};
