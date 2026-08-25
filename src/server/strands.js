"use strict";
/*
 * Building a Strands board.
 *
 * Six squares across, eight down: forty-eight letters, and the theme words
 * have to use every one of them exactly once. Each word is a path that steps
 * to any touching square, diagonals included, and never crosses itself.
 *
 * The spangram - the word that names the theme - must also reach from one side
 * of the board to the opposite one, so it is laid first, when the board is
 * empty and there is room to make that happen.
 *
 * The rest is exact cover by paths. The trick that makes it tractable is
 * always working on the square with the fewest free neighbours: a corner about
 * to be stranded gets dealt with while something can still reach it, rather
 * than being discovered as an unfillable hole at the very end.
 */

const { rngFor, shuffle } = require("./rng.js");

const COLS = 6;
const ROWS = 8;
const SIZE = COLS * ROWS;

const at = (row, col) => row * COLS + col;
const rowOf = (cell) => Math.floor(cell / COLS);
const colOf = (cell) => cell % COLS;

/* Every square a step can reach, diagonals included. */
const NEIGHBOURS = [];
for (let cell = 0; cell < SIZE; cell++) {
  const row = rowOf(cell);
  const col = colOf(cell);
  const found = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) found.push(at(r, c));
    }
  }
  NEIGHBOURS.push(found);
}

/* ---------------------------------------------------------------- words */

/**
 * Choose words adding to exactly 48, the spangram always among them.
 *
 * Shuffling before the search is what gives a theme more than one puzzle: the
 * first subset found depends on the order the words are considered in.
 */
function chooseWords(theme, random) {
  const target = SIZE - theme.spangram.length;
  const pool = shuffle(theme.words, random);
  let answer = null;

  const walk = (index, chosen, total) => {
    if (answer) return;
    if (total === target) { answer = chosen.slice(); return; }
    if (total > target || index >= pool.length) return;
    /* Prefer taking a word: it reaches a full board sooner. */
    walk(index + 1, [...chosen, pool[index]], total + pool[index].length);
    walk(index + 1, chosen, total);
  };
  walk(0, [], 0);

  return answer ? { spangram: theme.spangram, words: answer } : null;
}

/* --------------------------------------------------------------- paths */

const touchesOpposite = (path) => {
  const rows = path.map(rowOf);
  const cols = path.map(colOf);
  return (Math.min(...rows) === 0 && Math.max(...rows) === ROWS - 1)
    || (Math.min(...cols) === 0 && Math.max(...cols) === COLS - 1);
};

/**
 * Every self-avoiding path of the given length starting at `from`, stopping
 * once `wanted` of them have been found. Random order, so two calls on the
 * same board do not keep producing the same shape.
 */
function pathsFrom(from, length, taken, random, wanted, accept) {
  const found = [];
  const path = [from];
  const used = new Set([from]);

  const walk = () => {
    if (found.length >= wanted) return;
    if (path.length === length) {
      if (!accept || accept(path)) found.push(path.slice());
      return;
    }
    for (const next of shuffle(NEIGHBOURS[path[path.length - 1]], random)) {
      if (taken[next] !== null || used.has(next)) continue;
      used.add(next);
      path.push(next);
      walk();
      path.pop();
      used.delete(next);
      if (found.length >= wanted) return;
    }
  };

  walk();
  return found;
}

/* Free squares reachable from one square - used to spot a stranded pocket. */
function pocketSize(start, taken) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.pop();
    for (const next of NEIGHBOURS[cell]) {
      if (taken[next] !== null || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size;
}

/* --------------------------------------------------------------- packing */

/**
 * Lay every word on the board so that no square is left over.
 *
 * `taken[cell]` holds the index of the word covering it, or null.
 */
function pack(chosen, random, deadline) {
  const taken = new Array(SIZE).fill(null);
  const all = [chosen.spangram, ...chosen.words];
  const placed = new Array(all.length).fill(null);
  let expired = false;

  /* The spangram first, while the board is empty enough to cross it. */
  const starts = shuffle([...Array(SIZE).keys()], random);
  for (const start of starts) {
    const options = pathsFrom(start, chosen.spangram.length, taken, random, 1, touchesOpposite);
    if (!options.length) continue;

    placed[0] = options[0];
    for (const cell of options[0]) taken[cell] = 0;
    if (fillRest()) return { taken, placed, words: all };

    for (const cell of options[0]) taken[cell] = null;
    placed[0] = null;
    if (expired) break;
  }
  return null;

  function fillRest() {
    if (expired) return false;
    if (Date.now() > deadline) { expired = true; return false; }

    /* The free square with the fewest free neighbours, so the board is filled
     * from its tightest corner outwards rather than its roomiest middle. */
    let target = -1;
    let fewest = Infinity;
    for (let cell = 0; cell < SIZE; cell++) {
      if (taken[cell] !== null) continue;
      const free = NEIGHBOURS[cell].filter((next) => taken[next] === null).length;
      if (free < fewest) { fewest = free; target = cell; }
    }
    if (target === -1) return true;               // the board is full

    for (let index = 1; index < all.length; index++) {
      if (placed[index]) continue;
      const length = all[index].length;

      for (const path of pathsFrom(target, length, taken, random, 6)) {
        for (const cell of path) taken[cell] = index;
        placed[index] = path;

        /* A word that seals off fewer squares than any remaining word could
         * fill has made the board unsolvable; skip it now rather than find
         * out at the bottom of the search. */
        if (!stranded()) {
          if (fillRest()) return true;
        }

        for (const cell of path) taken[cell] = null;
        placed[index] = null;
        if (expired) return false;
      }
    }
    return false;
  }

  /* Is any pocket of free squares too small for the shortest word left? */
  function stranded() {
    const shortest = Math.min(
      ...all.map((word, index) => (placed[index] ? Infinity : word.length)));
    if (!Number.isFinite(shortest)) return false;

    const seen = new Set();
    for (let cell = 0; cell < SIZE; cell++) {
      if (taken[cell] !== null || seen.has(cell)) continue;
      const size = pocketSize(cell, taken);
      if (size < shortest) return true;
      /* Mark the pocket so it is measured once, not once per square. */
      const queue = [cell];
      seen.add(cell);
      while (queue.length) {
        const one = queue.pop();
        for (const next of NEIGHBOURS[one]) {
          if (taken[next] !== null || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  }
}

/* ----------------------------------------------------------------- build */

function build(seed, themes, { msBudget = 3000, tries = 6 } = {}) {
  const random = rngFor(seed);
  const theme = themes[Math.floor(random() * themes.length)];
  const deadline = Date.now() + msBudget;

  for (let attempt = 0; attempt < tries; attempt++) {
    if (Date.now() > deadline) break;

    const chosen = chooseWords(theme, random);
    if (!chosen) continue;

    const slice = Math.min(deadline, Date.now() + msBudget / tries);
    const packed = pack(chosen, random, slice);
    if (!packed) continue;

    const letters = new Array(SIZE).fill("");
    packed.placed.forEach((path, index) => {
      const word = packed.words[index];
      path.forEach((cell, i) => { letters[cell] = word[i]; });
    });

    return {
      cols: COLS,
      rows: ROWS,
      theme: theme.theme,
      letters: letters.join(""),
      /* The spangram is always the first entry. */
      entries: packed.words.map((word, index) => ({
        word,
        spangram: index === 0,
        cells: packed.placed[index],
      })),
    };
  }
  return null;
}

function buildStubbornly(seed, themes, options, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const found = build(i ? `${seed}/retry${i}` : seed, themes, options);
    if (found) return found;
  }
  throw new Error(`strands: could not build a board for "${seed}"`);
}

module.exports = {
  COLS, ROWS, SIZE, NEIGHBOURS,
  chooseWords, pathsFrom, touchesOpposite, pack, build, buildStubbornly, at, rowOf, colOf,
};
