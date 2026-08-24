"use strict";
/*
 * Connections.
 *
 * Sixteen words, four secret groups of four, four mistakes allowed.
 *
 * The dealer's one real job is making sure a puzzle has exactly one right
 * answer. Groups are drawn one per difficulty level, and any candidate that
 * shares a word with a group already chosen is passed over - so SNOW can be
 * weather in one puzzle and "SNOW ___" in another, but never both at once.
 */

const path = require("node:path");
const { rngFor, shuffle, pick } = require("../rng.js");

const GROUPS = require(path.join(__dirname, "..", "..", "..", "data", "connections-groups.js"));

const LEVELS = [0, 1, 2, 3];
const MISTAKES_ALLOWED = 4;

/* Group indices bucketed by level, so a deal is four cheap picks. */
const BY_LEVEL = LEVELS.map((level) => GROUPS.filter((g) => g.level === level));

function deal(seed) {
  const random = rngFor(seed);
  const chosen = [];
  const taken = new Set();

  for (const level of LEVELS) {
    const options = shuffle(BY_LEVEL[level], random);
    const group = options.find((g) => g.words.every((w) => !taken.has(w)));
    /* Every level has far more groups than there are ways to collide, so this
     * only trips if the pool is edited down to almost nothing. */
    if (!group) throw new Error(`connections: no group free at level ${level}`);
    for (const w of group.words) taken.add(w);
    chosen.push(group);
  }

  return {
    groups: chosen.map((g) => ({ clue: g.clue, words: g.words.slice(), level: g.level })),
    /* The grid order is fixed for the puzzle, so everyone sees the same board
     * and a shuffle in the browser is only ever cosmetic. */
    order: shuffle(chosen.flatMap((g) => g.words), random),
  };
}

const dailyPuzzle = (day) => deal("connections:daily:" + day);
const randomPuzzle = (seed) => deal("connections:free:" + seed);

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
  MISTAKES_ALLOWED, GROUPS,
  dailyPuzzle, randomPuzzle, validateCustom, fromCustom,
  create, guess, hint, view, summary, finished,
};
