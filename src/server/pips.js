"use strict";
/*
 * Building a Pips puzzle.
 *
 * You are given a handful of dominoes and a board marked into regions. Every
 * domino has to go somewhere, covering the board exactly, and every region has
 * a rule its squares must end up obeying - all the same, all different, adding
 * to a number, above or below one.
 *
 * The generator works backwards from an answer, which is the only sane way to
 * guarantee there is one: lay the dominoes out, then describe what happened as
 * rules. The hard part is not making a puzzle - it is making a puzzle with
 * exactly one answer, so a solver runs over every candidate and any that can
 * be finished a second way is tightened until it cannot.
 */

const { rngFor, shuffle, pick } = require("./rng.js");

/* A double-six set: every unordered pair from 0 to 6, each exactly once. */
const DOMINOES = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) DOMINOES.push([a, b]);

const RULES = {
  EQUAL: "equal",      // every square in the region shows the same number
  DIFFER: "differ",    // no two the same
  SUM: "sum",          // they add up to exactly n
  LESS: "less",        // they add up to less than n
  MORE: "more",        // they add up to more than n
  FREE: "free",        // no rule at all
};

/* ------------------------------------------------------------------ board */

const keyOf = ([row, col]) => `${row},${col}`;

/*
 * Grow the board out of dominoes rather than growing a shape and hoping it can
 * be tiled by them.
 *
 * A random blob usually cannot: a domino always covers one square of each
 * colour on a checkerboard, so any shape whose two colours are unevenly
 * matched has no tiling at all, and better than half the shapes drawn this way
 * were being thrown out. Laying dominoes down instead makes an untileable
 * board impossible - the tiling is the thing that built it.
 *
 * Returns the squares and the tiling that produced them.
 */
function growFromDominoes(count, random) {
  const taken = new Set();
  const laid = [];

  const add = (a, b) => {
    taken.add(keyOf(a));
    taken.add(keyOf(b));
    laid.push([a, b]);
  };

  add([0, 0], [0, 1]);

  while (laid.length < count) {
    /* Every free pair of adjacent squares touching what is already there. */
    const options = [];
    for (const key of taken) {
      const [row, col] = key.split(",").map(Number);
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const first = [row + dr, col + dc];
        if (taken.has(keyOf(first))) continue;

        for (const [er, ec] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const second = [first[0] + er, first[1] + ec];
          if (taken.has(keyOf(second)) || keyOf(second) === keyOf(first)) continue;
          options.push([first, second]);
        }
      }
    }
    if (!options.length) break;

    const [a, b] = options[Math.floor(random() * options.length)];
    add(a, b);
  }

  /* Sit the shape at the origin, whatever direction it grew in. */
  const cells = [...taken].map((key) => key.split(",").map(Number));
  const minRow = Math.min(...cells.map((c) => c[0]));
  const minCol = Math.min(...cells.map((c) => c[1]));
  const shift = ([r, c]) => [r - minRow, c - minCol];

  return {
    cells: cells.map(shift),
    tiling: laid.map(([a, b]) => [shift(a), shift(b)]),
  };
}

/** Every way two adjacent squares could be covered by one domino. */
function placements(cells) {
  const set = new Set(cells.map(keyOf));
  const found = [];
  for (const [row, col] of cells) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const other = [row + dr, col + dc];
      if (set.has(keyOf(other))) found.push([[row, col], other]);
    }
  }
  return found;
}

/** Cover the board with dominoes, leaving nothing uncovered. */
function tile(cells, random) {
  const set = new Set(cells.map(keyOf));
  const order = cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const used = new Set();
  const laid = [];

  function place() {
    const next = order.find((cell) => !used.has(keyOf(cell)));
    if (!next) return true;

    const [row, col] = next;
    const options = shuffle([[0, 1], [1, 0], [0, -1], [-1, 0]], random);
    for (const [dr, dc] of options) {
      const other = [row + dr, col + dc];
      const otherKey = keyOf(other);
      if (!set.has(otherKey) || used.has(otherKey)) continue;

      used.add(keyOf(next));
      used.add(otherKey);
      laid.push([next, other]);
      if (place()) return true;
      laid.pop();
      used.delete(keyOf(next));
      used.delete(otherKey);
    }
    return false;
  }

  return place() ? laid : null;
}

/* ---------------------------------------------------------------- regions */

/** Cut the board into small connected groups, which the rules will describe. */
function makeRegions(cells, random, maxSize = 4) {
  const set = new Set(cells.map(keyOf));
  const left = new Set(cells.map(keyOf));
  const regions = [];

  while (left.size) {
    const seed = [...left][Math.floor(random() * left.size)];
    const size = 1 + Math.floor(random() * maxSize);
    const region = [seed];
    left.delete(seed);

    while (region.length < size) {
      const growable = [];
      for (const key of region) {
        const [row, col] = key.split(",").map(Number);
        for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const other = keyOf([row + dr, col + dc]);
          if (set.has(other) && left.has(other)) growable.push(other);
        }
      }
      if (!growable.length) break;
      const grown = growable[Math.floor(random() * growable.length)];
      region.push(grown);
      left.delete(grown);
    }
    regions.push(region);
  }
  return regions;
}

/* ------------------------------------------------------------------ rules */

/*
 * Describe what a region ended up holding, as a rule it obeys.
 *
 * The mix is weighted rather than uniform. A sum pins a region down almost
 * completely; "less than" and "free" barely narrow it at all. Offering them in
 * equal measure produced boards with dozens of possible answers that then had
 * to be tightened one region at a time, which was slow and often failed - so
 * the tight rules are simply more likely to be picked in the first place, and
 * the loose ones are there for variety rather than as the default.
 */
function ruleFor(values, random) {
  const total = values.reduce((sum, n) => sum + n, 0);
  const allSame = values.every((n) => n === values[0]);
  const allDifferent = new Set(values).size === values.length;

  const options = [];
  const offer = (rule, weight) => { for (let i = 0; i < weight; i++) options.push(rule); };

  offer({ kind: RULES.SUM, n: total }, 6);
  if (allSame && values.length > 1) offer({ kind: RULES.EQUAL }, 4);
  if (allDifferent && values.length > 1) offer({ kind: RULES.DIFFER }, 3);
  if (total > 0) offer({ kind: RULES.LESS, n: total + 1 + Math.floor(random() * 2) }, 1);
  offer({ kind: RULES.MORE, n: Math.max(0, total - 1 - Math.floor(random() * 2)) }, 1);
  /* A region with no rule is a rest for the eye, and only ever a small one. */
  if (values.length === 1) offer({ kind: RULES.FREE }, 1);

  return pick(options, random);
}

const MAX_PIPS = 6;

/**
 * Is a rule satisfied by these numbers?
 *
 * `empty` is how many squares in the region are still blank. On a half-filled
 * region the question is not "does this hold" but "could this still hold", and
 * the difference is most of the solver's speed: knowing that a region needing
 * eleven more pips across one square is already lost prunes a whole subtree
 * that would otherwise be explored to the end.
 */
function holds(rule, values, empty = 0) {
  const total = values.reduce((sum, n) => sum + n, 0);
  const room = empty * MAX_PIPS;

  switch (rule.kind) {
    case RULES.EQUAL:
      return values.every((n) => n === values[0]);
    case RULES.DIFFER:
      return new Set(values).size === values.length;
    case RULES.SUM:
      /* Too much already, or too little even with every square maxed out. */
      return empty ? total <= rule.n && total + room >= rule.n : total === rule.n;
    case RULES.LESS:
      return total < rule.n;
    case RULES.MORE:
      return empty ? total + room > rule.n : total > rule.n;
    case RULES.FREE:
    default:
      return true;
  }
}

/* ----------------------------------------------------------------- solver */

/*
 * Count the ways a puzzle can be finished, stopping at `limit`.
 *
 * Only ever asked for two: one says the puzzle is fair, two says it is not,
 * and the exact number beyond that is of no interest to anybody.
 */
function countSolutions(puzzle, limit = 2) {
  const order = puzzle.cells.map(keyOf).sort();

  /* Placements indexed by the square they cover, so the search never scans
   * the whole board looking for the ones that matter. */
  const coveringCell = new Map();
  for (const spot of placements(puzzle.cells)) {
    const pair = spot.map(keyOf);
    for (const key of pair) {
      if (!coveringCell.has(key)) coveringCell.set(key, []);
      coveringCell.get(key).push(pair);
    }
  }

  const regionOf = new Map();
  puzzle.regions.forEach((region, index) => {
    for (const key of region.cells) regionOf.set(key, index);
  });

  const value = new Map();
  const usedDomino = new Array(puzzle.dominoes.length).fill(false);
  let solutions = 0;

  /* Does every region the two squares belong to still look possible? */
  function stillFine(keys) {
    const touched = new Set(keys.map((key) => regionOf.get(key)));
    for (const index of touched) {
      if (index === undefined) continue;
      const region = puzzle.regions[index];
      const numbers = [];
      let empty = 0;
      for (const key of region.cells) {
        if (value.has(key)) numbers.push(value.get(key));
        else empty += 1;
      }
      if (!holds(region.rule, numbers, empty)) return false;
    }
    return true;
  }

  function search() {
    if (solutions >= limit) return;

    const next = order.find((key) => !value.has(key));
    if (next === undefined) { solutions += 1; return; }

    for (const pair of coveringCell.get(next) || []) {
      const [a, b] = pair;
      if (value.has(a) || value.has(b)) continue;

      for (let i = 0; i < puzzle.dominoes.length; i++) {
        if (usedDomino[i]) continue;
        const [x, y] = puzzle.dominoes[i];

        /* A domino can go down either way round; [3,3] only one way that matters. */
        const ways = x === y ? [[x, y]] : [[x, y], [y, x]];
        for (const [first, second] of ways) {
          value.set(a, first);
          value.set(b, second);
          usedDomino[i] = true;

          if (stillFine([a, b])) search();

          usedDomino[i] = false;
          value.delete(a);
          value.delete(b);
          if (solutions >= limit) return;
        }
      }
    }
  }

  search();
  return solutions;
}

/* ------------------------------------------------------------------ build */

/**
 * Make a puzzle with exactly one answer.
 *
 * Lay dominoes out, describe the result as rules, then check. A puzzle with
 * more than one answer is not thrown away - its loosest rule is tightened to a
 * sum, which is the most restrictive thing a region can say, and it is checked
 * again. That converges far more often than starting over.
 */
function build(seed, { squares = 12, maxRegion = 3, tries = 60 } = {}) {
  const random = rngFor(seed);

  for (let attempt = 0; attempt < tries; attempt++) {
    const grown = growFromDominoes(Math.max(2, Math.round(squares / 2)), random);
    const cells = grown.cells;
    const laid = grown.tiling;
    if (cells.length % 2 || laid.length < 2) continue;

    /* Give each placement a real domino, no two the same. */
    const chosen = shuffle(DOMINOES, random).slice(0, laid.length);
    if (chosen.length < laid.length) continue;

    const value = new Map();
    laid.forEach(([a, b], i) => {
      const [x, y] = random() < 0.5 ? chosen[i] : [chosen[i][1], chosen[i][0]];
      value.set(keyOf(a), x);
      value.set(keyOf(b), y);
    });

    const grouped = makeRegions(cells, random, maxRegion);
    const regions = grouped.map((keys) => ({
      cells: keys,
      rule: ruleFor(keys.map((key) => value.get(key)), random),
    }));

    const puzzle = {
      cells,
      regions,
      dominoes: chosen.map(([a, b]) => [a, b]),
      solution: [...value].map(([key, n]) => [key, n]),
      rows: Math.max(...cells.map((c) => c[0])) + 1,
      cols: Math.max(...cells.map((c) => c[1])) + 1,
    };

    /* Tighten until it is the only answer, or give up on this board. */
    /* A few passes, then move on. Trying another board is cheaper than
     * grinding on one that will not come good. */
    for (let pass = 0; pass < 6; pass++) {
      const count = countSolutions(puzzle, 2);
      if (count === 1) return puzzle;
      if (count === 0) break;                    // over-constrained; start again

      const loose = puzzle.regions
        .map((region, index) => ({ region, index }))
        .filter(({ region }) => region.rule.kind !== RULES.SUM)
        .sort((a, b) => b.region.cells.length - a.region.cells.length)[0];

      if (!loose) break;                         // everything is already a sum
      loose.region.rule = {
        kind: RULES.SUM,
        n: loose.region.cells.reduce((sum, key) => sum + value.get(key), 0),
      };
    }
  }
  return null;
}

/** Build, retrying with a nudged seed, so a caller always gets a puzzle. */
function buildStubbornly(seed, options, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const found = build(i ? `${seed}/retry${i}` : seed, options);
    if (found) return found;
  }
  throw new Error(`pips: could not build a puzzle for "${seed}"`);
}

module.exports = {
  DOMINOES, RULES,
  growFromDominoes, placements, tile, makeRegions, ruleFor, holds, countSolutions,
  build, buildStubbornly, keyOf,
};
