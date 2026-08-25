"use strict";
/*
 * Building a crossword: the black squares, then the words that fit them.
 *
 * Nothing here is stored. A grid is produced from a seed, the same way every
 * other puzzle in the club is, so a daily crossword is reproducible forever
 * and unlimited play costs nothing but the time to fill one.
 *
 * Two stages:
 *
 *   1. A pattern - where the black squares go. Generated rather than drawn by
 *      hand, under the rules a solver expects: 180-degree symmetry, no word
 *      shorter than three letters, every white square part of both an across
 *      and a down word, and the whole white area joined up.
 *
 *   2. A fill - the letters. This is the expensive half: a backtracking search
 *      that always works on the most constrained slot first, so a dead end is
 *      found in a handful of moves rather than after committing to half a
 *      grid.
 *
 * Only words that have a clue are ever offered to the filler, so a finished
 * grid can always be clued end to end.
 */

const path = require("node:path");
const { rngFor, shuffle } = require("./rng.js");

const CLUES = require(path.join(__dirname, "..", "..", "data", "crossword-clues.json"));

const MIN_WORD = 3;

/* ------------------------------------------------------------- the index */

/*
 * Words bucketed by length, and within each bucket indexed by the letter at
 * each position. Finding what fits "c?a?e" is then an intersection of three
 * lists rather than a scan of every five-letter word, which is what makes the
 * search fast enough to run on a request.
 */
const BY_LENGTH = new Map();
const BY_LETTER = new Map(); // length -> position -> letter -> array of word ids

for (const word of Object.keys(CLUES)) {
  const length = word.length;
  if (length < MIN_WORD) continue;

  let bucket = BY_LENGTH.get(length);
  if (!bucket) BY_LENGTH.set(length, (bucket = []));
  const id = bucket.length;
  bucket.push(word);

  let positions = BY_LETTER.get(length);
  if (!positions) BY_LETTER.set(length, (positions = []));

  for (let i = 0; i < length; i++) {
    if (!positions[i]) positions[i] = new Map();
    const letter = word[i];
    let ids = positions[i].get(letter);
    if (!ids) positions[i].set(letter, (ids = []));
    ids.push(id);
  }
}

/* --------------------------------------------------------------- pattern */

const BLACK = "#";
const OPEN = ".";

const at = (grid, size, row, col) => grid[row * size + col];

/** Every across and down run of white squares, with where each one sits. */
function slotsOf(grid, size) {
  const slots = [];

  const collect = (isAcross) => {
    for (let a = 0; a < size; a++) {
      let run = [];
      for (let b = 0; b < size; b++) {
        const row = isAcross ? a : b;
        const col = isAcross ? b : a;
        if (at(grid, size, row, col) === BLACK) {
          if (run.length >= MIN_WORD) slots.push({ across: isAcross, cells: run });
          run = [];
        } else {
          run.push(row * size + col);
        }
      }
      if (run.length >= MIN_WORD) slots.push({ across: isAcross, cells: run });
    }
  };

  collect(true);
  collect(false);
  return slots;
}

/**
 * Does this pattern make a crossword? Every white square has to sit in an
 * across word and a down word, both at least three long, and the white area
 * has to be one piece - an island would be a separate puzzle.
 */
function patternIsSound(grid, size) {
  const covered = new Map(); // cell -> how many slots use it

  for (const slot of slotsOf(grid, size)) {
    for (const cell of slot.cells) covered.set(cell, (covered.get(cell) || 0) + 1);
  }

  const whites = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === BLACK) continue;
    whites.push(i);
    /* Two: one across word and one down word. */
    if (covered.get(i) !== 2) return false;
  }
  if (!whites.length) return false;

  /* Flood fill from the first white square; everything should be reachable. */
  const seen = new Set([whites[0]]);
  const queue = [whites[0]];
  while (queue.length) {
    const cell = queue.pop();
    const row = Math.floor(cell / size);
    const col = cell % size;
    const neighbours = [
      row > 0 ? cell - size : -1,
      row < size - 1 ? cell + size : -1,
      col > 0 ? cell - 1 : -1,
      col < size - 1 ? cell + 1 : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || seen.has(next) || grid[next] === BLACK) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === whites.length;
}

/**
 * Place black squares in symmetric pairs, keeping only those that leave the
 * pattern sound. Growing a good pattern beats generating and rejecting whole
 * ones: every step is valid, so the loop always has something to return.
 */
function makePattern(size, density, random) {
  const grid = new Array(size * size).fill(OPEN);
  const target = Math.floor(size * size * density);

  const cells = shuffle([...grid.keys()], random);
  let placed = 0;

  for (const cell of cells) {
    if (placed >= target) break;
    const mirror = size * size - 1 - cell;
    if (grid[cell] === BLACK || grid[mirror] === BLACK) continue;

    grid[cell] = BLACK;
    grid[mirror] = BLACK;

    if (patternIsSound(grid, size)) {
      placed += cell === mirror ? 1 : 2;
    } else {
      grid[cell] = OPEN;
      grid[mirror] = OPEN;
    }
  }
  return grid;
}

/* ------------------------------------------------------------------ fill */

/* The "every word of this length" list, built once per length rather than
 * rebuilt for every empty slot in every grid. */
const ALL_IDS = new Map();
function allIds(length) {
  let ids = ALL_IDS.get(length);
  if (!ids) {
    const bucket = BY_LENGTH.get(length);
    if (!bucket) return null;
    ids = bucket.map((_, i) => i);
    ALL_IDS.set(length, ids);
  }
  return ids;
}

/**
 * Take up to n items at random.
 *
 * Not a shuffle: the candidate list for an open slot runs to thousands, and
 * shuffling all of them to look at thirty was costing more than the search it
 * was feeding.
 */
function pickSome(list, n, random) {
  if (list.length <= n) return shuffle(list, random);
  const seen = new Set();
  const out = [];
  for (let guard = 0; out.length < n && guard < n * 4; guard++) {
    const index = Math.floor(random() * list.length);
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(list[index]);
  }
  return out;
}

/** Word ids of the given length whose letters match everything already placed. */
function candidates(length, known) {
  const bucket = BY_LENGTH.get(length);
  if (!bucket) return null;
  if (!known.length) return allIds(length);

  const positions = BY_LETTER.get(length);
  /* Intersect the shortest lists first: the rarest letter does the most work. */
  const lists = known
    .map(([index, letter]) => (positions[index] && positions[index].get(letter)) || [])
    .sort((a, b) => a.length - b.length);

  if (!lists[0].length) return [];

  let found = lists[0];
  for (let i = 1; i < lists.length && found.length; i++) {
    const other = new Set(lists[i]);
    found = found.filter((id) => other.has(id));
  }
  return found;
}

/**
 * Fill every slot with a real word.
 *
 * Two things make this tractable. It always works on whichever slot has fewest
 * options left, so a dead end shows up in a handful of moves rather than after
 * committing to half a grid. And the option lists are cached: placing a word
 * can only change the slots that cross it, so only those are recomputed,
 * which turns the per-step cost from "every slot in the grid" into "the four
 * or five that just changed".
 */
function fillGrid(grid, size, random, budget = 6000) {
  const slots = slotsOf(grid, size);
  const letters = new Array(grid.length).fill(null);

  /* Which slots share a square with which. */
  const touching = slots.map(() => new Set());
  const slotsAtCell = new Map();
  slots.forEach((slot, index) => {
    for (const cell of slot.cells) {
      if (!slotsAtCell.has(cell)) slotsAtCell.set(cell, []);
      slotsAtCell.get(cell).push(index);
    }
  });
  for (const indices of slotsAtCell.values()) {
    for (const a of indices) for (const b of indices) if (a !== b) touching[a].add(b);
  }

  const filled = new Array(slots.length).fill(null);
  const used = new Set();
  const cache = new Array(slots.length).fill(null);

  /*
   * The search stops on a count of steps, never on the clock.
   *
   * A grid is not stored anywhere - a round holds its seed, and the puzzle is
   * rebuilt from that whenever it is needed. So the build has to be a pure
   * function of the seed, and a wall-clock cutoff is the one thing that makes
   * it not: the same seed on a busy machine gave up earlier and came back with
   * a different grid. That meant two people could be handed different "daily"
   * crosswords, and worse, a player's own letters - which are stored by square
   * number - could come back sitting on a grid they were never typed into.
   */
  let steps = 0;

  const knownOf = (slot) => {
    const known = [];
    slot.cells.forEach((cell, i) => {
      if (letters[cell] !== null) known.push([i, letters[cell]]);
    });
    return known;
  };

  const optionsFor = (i) => {
    if (cache[i] === null) cache[i] = candidates(slots[i].cells.length, knownOf(slots[i])) || [];
    return cache[i];
  };

  function search() {
    /* Most patterns cannot be filled at all. Abandoning one after a fixed
     * number of steps is how that is discovered, cheaply and repeatably. */
    if (++steps > budget) return false;

    let target = -1;
    let fewest = Infinity;
    for (let i = 0; i < slots.length; i++) {
      if (filled[i]) continue;
      const count = optionsFor(i).length;
      if (count === 0) return false;               // dead already
      if (count < fewest) {
        target = i;
        fewest = count;
        if (count === 1) break;                    // cannot do better
      }
    }
    if (target === -1) return true;                // everything is filled

    const bucket = BY_LENGTH.get(slots[target].cells.length);
    /* Only look at a slice of a very open slot: the difference between four
     * thousand candidates and forty is not worth the time to explore. */
    const tries = pickSome(optionsFor(target), 30, random);

    for (const id of tries) {
      const word = bucket[id];
      if (used.has(word)) continue;                // no repeated answers

      const changed = [];
      slots[target].cells.forEach((cell, i) => {
        if (letters[cell] === null) {
          letters[cell] = word[i];
          changed.push(cell);
        }
      });
      filled[target] = word;
      used.add(word);

      /* Only the crossing slots can have changed, so only they are dropped. */
      const dropped = new Map();
      for (const other of touching[target]) {
        if (filled[other]) continue;
        dropped.set(other, cache[other]);
        cache[other] = null;
      }

      if (search()) return true;

      for (const [other, previous] of dropped) cache[other] = previous;
      for (const cell of changed) letters[cell] = null;
      filled[target] = null;
      used.delete(word);
    }
    return false;
  }

  if (!search()) return null;
  return { letters, slots, words: filled };
}

/* --------------------------------------------------------------- numbers */

/**
 * Number the grid the way a crossword is numbered: a square gets a number if
 * it starts an across word or a down word, counting left to right, top to
 * bottom.
 */
function numberGrid(grid, size) {
  const numberAt = new Map();
  let next = 1;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const cell = row * size + col;
      if (grid[cell] === BLACK) continue;

      const startsAcross =
        (col === 0 || grid[cell - 1] === BLACK)
        && col + MIN_WORD - 1 < size
        && grid[cell + 1] !== BLACK;
      const startsDown =
        (row === 0 || grid[cell - size] === BLACK)
        && row + MIN_WORD - 1 < size
        && grid[cell + size] !== BLACK;

      if (startsAcross || startsDown) numberAt.set(cell, next++);
    }
  }
  return numberAt;
}

/* ----------------------------------------------------------------- build */

/**
 * A whole puzzle: pattern, letters, numbering and clues.
 *
 * Patterns are cheap and fills are not, so a pattern that will not fill is
 * abandoned for a new one rather than laboured over.
 */
function build(seed, { size, densities, attempts = 12, budget = 6000 }) {
  const random = rngFor(seed);

  /*
   * A ladder rather than one density. An open grid - fewer black squares,
   * longer answers - makes the better puzzle, so it is tried first; each rung
   * up adds black squares, which shortens the answers and makes the fill
   * easier. Walking up only when the rung below is exhausted means a build
   * gets the best grid it can rather than a fixed one.
   *
   * Every rung gets the same fixed number of attempts, each with the same
   * fixed step budget. Nothing here consults the clock, so this seed always
   * produces this grid, on any machine, however busy.
   */
  for (const density of densities) {
    const found = tryDensity(density);
    if (found) return found;
  }
  return null;

  function tryDensity(density) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const grid = makePattern(size, density, random);
    const filled = fillGrid(grid, size, random, budget);
    if (!filled) continue;

    const numberAt = numberGrid(grid, size);
    const entries = [];

    for (let i = 0; i < filled.slots.length; i++) {
      const slot = filled.slots[i];
      const word = filled.words[i];
      entries.push({
        number: numberAt.get(slot.cells[0]),
        across: slot.across,
        cells: slot.cells,
        answer: word,
        clue: CLUES[word],
      });
    }

    entries.sort((a, b) => a.number - b.number || (a.across === b.across ? 0 : a.across ? -1 : 1));

    return {
      size,
      density,
      grid: grid.join(""),
      letters: filled.letters.map((c) => c || " ").join(""),
      numbers: [...numberAt].map(([cell, number]) => [cell, number]),
      entries,
    };
  }
  return null;
  }
}

/**
 * Build, and keep trying until something comes back.
 *
 * A single build can still come up empty: a grid it cannot fill in the time
 * allowed, on every rung of the ladder. Rather than hand a caller null - which
 * for a daily puzzle would mean no puzzle that day - the seed is nudged and
 * the whole thing runs again. The nudge is deterministic, so the same seed
 * still yields the same puzzle every time; it just may be the second grid the
 * builder thought of rather than the first.
 */
function buildStubbornly(seed, options, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const found = build(i ? `${seed}/retry${i}` : seed, options);
    if (found) return found;
  }
  /* Every rung, every retry, no grid. The word list would have to have been
   * cut to almost nothing for this to happen. */
  throw new Error(`crossword: could not build a ${options.size}x${options.size} grid for "${seed}"`);
}

module.exports = {
  BLACK, OPEN, MIN_WORD, CLUES,
  slotsOf, patternIsSound, makePattern, fillGrid, numberGrid, build, buildStubbornly, candidates, pickSome,
  BY_LENGTH, BY_LETTER,
};
