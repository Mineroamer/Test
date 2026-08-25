"use strict";
/*
 * Pips.
 *
 * A board cut into regions, each with a rule, and a handful of dominoes that
 * have to cover it exactly while every rule comes true.
 *
 * Every puzzle dealt has been solved by the generator and confirmed to have
 * exactly one answer, so "I think there are two ways to do this" is never a
 * fair complaint - and the win check can simply ask whether the rules hold,
 * rather than comparing against a stored solution.
 */

const { buildStubbornly, holds, keyOf, RULES } = require("../pips.js");

/* The daily is a little larger, since people have all day. */
const DAILY = { squares: 14 };
const FREE = { squares: 12 };

const dailyPuzzle = (day) => buildStubbornly(`pips:daily:${day}`, DAILY);
const randomPuzzle = (seed) => buildStubbornly(`pips:free:${seed}`, FREE);

const create = () => ({ placed: [], hints: [], status: "playing" });

const onBoard = (puzzle, key) => puzzle.cells.some((cell) => keyOf(cell) === key);

const occupied = (state) => new Set(state.placed.flatMap((one) => one.cells));

/** Where every domino sits, as square -> number. */
function valuesOf(state) {
  const value = new Map();
  for (const one of state.placed) {
    value.set(one.cells[0], one.values[0]);
    value.set(one.cells[1], one.values[1]);
  }
  return value;
}

/** Which regions are broken as things stand, and which are settled. */
function regionState(puzzle, state) {
  const value = valuesOf(state);

  return puzzle.regions.map((region, index) => {
    const numbers = [];
    let empty = 0;
    for (const key of region.cells) {
      if (value.has(key)) numbers.push(value.get(key));
      else empty += 1;
    }
    return {
      index,
      full: empty === 0,
      /* A part-filled region is only "wrong" once it cannot come good. */
      ok: holds(region.rule, numbers, empty),
    };
  });
}

const isSolved = (puzzle, state) =>
  state.placed.length === puzzle.dominoes.length
  && regionState(puzzle, state).every((one) => one.full && one.ok);

const adjacent = (a, b) =>
  (Math.abs(a[0] - b[0]) === 1 && a[1] === b[1])
  || (Math.abs(a[1] - b[1]) === 1 && a[0] === b[0]);

/*
 * A move is either putting a domino down or picking it back up. Putting one
 * down says which domino, which two squares, and which way round.
 */
function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This one is already done." };

  const move = input && typeof input === "object" ? input : {};
  const index = Number(move.domino);

  if (!Number.isInteger(index) || index < 0 || index >= puzzle.dominoes.length) {
    return { ok: false, message: "That is not one of the dominoes." };
  }

  const already = state.placed.findIndex((one) => one.domino === index);

  if (move.lift) {
    if (already === -1) return { ok: false, message: "That domino is not on the board." };
    state.placed.splice(already, 1);
    return { ok: true, lifted: index, status: state.status };
  }

  const at = Array.isArray(move.cells) ? move.cells : [];
  if (at.length !== 2) return { ok: false, message: "A domino covers two squares." };

  const pair = at.map((cell) => (Array.isArray(cell) ? cell.map(Number) : [NaN, NaN]));
  if (pair.some((cell) => cell.some((n) => !Number.isInteger(n)))) {
    return { ok: false, message: "Those are not squares." };
  }
  if (!adjacent(pair[0], pair[1])) return { ok: false, message: "The two squares must touch." };

  const keys = pair.map(keyOf);
  if (keys[0] === keys[1]) return { ok: false, message: "That is the same square twice." };
  for (const key of keys) {
    if (!onBoard(puzzle, key)) return { ok: false, message: "That is off the board." };
  }

  /* Picking a domino up and putting it down elsewhere is one move, not two. */
  const taken = occupied({ placed: state.placed.filter((one) => one.domino !== index) });
  if (keys.some((key) => taken.has(key))) {
    return { ok: false, message: "There is already a domino there." };
  }

  const [a, b] = puzzle.dominoes[index];
  const values = move.flip ? [b, a] : [a, b];

  if (already !== -1) state.placed.splice(already, 1);
  state.placed.push({ domino: index, cells: keys, values });

  if (isSolved(puzzle, state)) state.status = "won";
  return { ok: true, domino: index, cells: keys, values, status: state.status };
}

/*
 * A hint puts one domino where it belongs. It picks a domino that is not yet
 * in its right place, lifting whatever is sitting there.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This one is already done." };

  const answer = new Map(puzzle.solution);
  const placedRight = (one) =>
    one.cells.every((key, i) => answer.get(key) === one.values[i]);

  /* Work out where each domino belongs in the answer. */
  const spots = [];
  for (let index = 0; index < puzzle.dominoes.length; index++) {
    const [a, b] = puzzle.dominoes[index];
    spots.push({ index, a, b });
  }

  const home = new Map();
  for (const [key] of puzzle.solution) home.set(key, answer.get(key));

  /* Find a domino whose correct squares are known and which is not there yet. */
  for (const { index, a, b } of spots) {
    const already = state.placed.find((one) => one.domino === index);
    if (already && placedRight(already)) continue;

    /* Its home is the pair of adjacent squares holding its two numbers, not
     * already correctly occupied by another domino. */
    const settled = new Set(state.placed
      .filter((one) => one.domino !== index && placedRight(one))
      .flatMap((one) => one.cells));

    for (const cell of puzzle.cells) {
      const key = keyOf(cell);
      if (settled.has(key)) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const other = [cell[0] + dr, cell[1] + dc];
        const otherKey = keyOf(other);
        if (!onBoard(puzzle, otherKey) || settled.has(otherKey)) continue;

        const wants = [home.get(key), home.get(otherKey)];
        const matches = (wants[0] === a && wants[1] === b) || (wants[0] === b && wants[1] === a);
        if (!matches) continue;

        /* Clear anything in the way, then put it down. */
        state.placed = state.placed.filter(
          (one) => one.domino !== index && !one.cells.some((k) => k === key || k === otherKey));
        state.placed.push({ domino: index, cells: [key, otherKey], values: wants });
        state.hints.push({ domino: index, cells: [key, otherKey] });

        if (isSolved(puzzle, state)) state.status = "won";
        return { ok: true, hint: { domino: index, cells: [key, otherKey], values: wants }, status: state.status };
      }
    }
  }
  return { ok: false, message: "Everything is already where it belongs." };
}

/** Give up: lay the answer out. */
function reveal(puzzle, state) {
  if (state.status !== "playing") return { ok: true, status: state.status };

  const answer = new Map(puzzle.solution);
  const placed = [];
  const done = new Set();

  for (let index = 0; index < puzzle.dominoes.length; index++) {
    const [a, b] = puzzle.dominoes[index];
    for (const cell of puzzle.cells) {
      const key = keyOf(cell);
      if (done.has(key)) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const otherKey = keyOf([cell[0] + dr, cell[1] + dc]);
        if (!onBoard(puzzle, otherKey) || done.has(otherKey)) continue;

        const wants = [answer.get(key), answer.get(otherKey)];
        const matches = (wants[0] === a && wants[1] === b) || (wants[0] === b && wants[1] === a);
        if (!matches) continue;

        placed.push({ domino: index, cells: [key, otherKey], values: wants });
        done.add(key);
        done.add(otherKey);
        break;
      }
      if (done.has(key)) break;
    }
  }

  state.placed = placed;
  state.status = "done";
  return { ok: true, status: state.status };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  rows: puzzle.rows,
  cols: puzzle.cols,
  cells: puzzle.cells.map(keyOf),
  regions: puzzle.regions.map((region) => ({ cells: region.cells, rule: region.rule })),
  dominoes: puzzle.dominoes,
  placed: state.placed,
  hints: state.hints,
  /* Which regions are already broken, so the board can say so as you go. */
  regionState: regionState(puzzle, state),
  status: state.status,
  solution: finished(state) ? puzzle.solution : null,
});

const summary = (puzzle, state) => ({
  won: state.status === "won" && state.hints.length < puzzle.dominoes.length,
  guesses: state.placed.length,
  hints: state.hints.length,
  dominoes: puzzle.dominoes.length,
});

module.exports = {
  key: "pips",
  name: "Pips",
  custom: false,
  RULES,
  dailyPuzzle, randomPuzzle,
  create, guess, hint, reveal, view, summary, finished,
  regionState, isSolved,
};
