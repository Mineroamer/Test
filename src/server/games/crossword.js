"use strict";
/*
 * The Crossword and the Mini.
 *
 * Both are the same game at two sizes, so both come out of one factory. The
 * Mini is five squares across and meant for a few minutes; the Crossword is a
 * full fifteen.
 *
 * A crossword is not judged a guess at a time - it is filled in, and either it
 * is right at the end or it is not. So the moves here are typing a letter,
 * clearing one, asking to have the mistakes pointed out, and giving up. What
 * the server keeps to itself is the same as everywhere else: the answers,
 * until there is nothing left to spoil.
 */

const { buildStubbornly } = require("../crossword.js");

const BLACK = "#";
const EMPTY = " ";

/* Two rungs rather than three for the Mini: the all-white five-by-five is a
 * double word square, which is a lovely thing when it lands but expensive to
 * go looking for on every deal. */
const SHAPES = {
  crossword: {
    key: "crossword",
    name: "The Crossword",
    size: 15,
    densities: [0.28, 0.32, 0.36, 0.42],
  },
  mini: {
    key: "mini",
    name: "The Mini",
    size: 5,
    densities: [0.08, 0.16],
  },
};

function makeGame(shape) {
  /*
   * Attempts and step budget, both fixed counts. Nothing here is a duration:
   * the puzzle has to come out the same for everyone playing on the same day,
   * and a build that gives up on the clock gives up sooner on a busy machine
   * and comes back with a different grid.
   *
   * Six thousand steps is where the returns flatten out. Most patterns cannot
   * be filled at all, and the ones that can are filled well inside it; raising
   * it twentyfold buys about three more fills in forty and costs twenty times
   * the work, all of it spent on patterns that were never going to fill.
   */
  const options = {
    size: shape.size,
    densities: shape.densities,
    attempts: 16,
    budget: 6000,
  };

  const dailyPuzzle = (day) => buildStubbornly(`${shape.key}:daily:${day}`, options);
  const randomPuzzle = (seed) => buildStubbornly(`${shape.key}:free:${seed}`, options);

  const create = (puzzle) => ({
    /* One character per square: a letter, a space for blank, or the black
     * square itself so the two strings always line up. */
    letters: puzzle.grid.split("").map((c) => (c === BLACK ? BLACK : EMPTY)).join(""),
    revealed: [],
    checks: 0,
    typed: 0,
    status: "playing",
  });

  const isBlack = (puzzle, cell) => puzzle.grid[cell] === BLACK;

  const put = (state, cell, letter) => {
    state.letters = state.letters.slice(0, cell) + letter + state.letters.slice(cell + 1);
  };

  /** Every square filled, and every one of them right. */
  const isSolved = (puzzle, state) => state.letters === puzzle.letters.toUpperCase()
    .split("").map((c, i) => (puzzle.grid[i] === BLACK ? BLACK : c)).join("");

  function answerAt(puzzle, cell) {
    return puzzle.letters[cell].toUpperCase();
  }

  function guess(puzzle, state, input) {
    if (state.status !== "playing") return { ok: false, message: "This one is already done." };

    const move = input && typeof input === "object" ? input : {};
    const cell = Number(move.cell);

    if (!Number.isInteger(cell) || cell < 0 || cell >= puzzle.grid.length) {
      return { ok: false, message: "That square is not on the grid." };
    }
    if (isBlack(puzzle, cell)) return { ok: false, message: "That square is blacked out." };
    if (state.revealed.includes(cell)) {
      return { ok: false, message: "That letter was given to you." };
    }

    if (move.clear) {
      put(state, cell, EMPTY);
      return { ok: true, cell, letter: EMPTY, status: state.status };
    }

    const letter = String(move.letter || "").toUpperCase();
    if (!/^[A-Z]$/.test(letter)) return { ok: false, message: "Letters only." };

    if (state.letters[cell] === EMPTY) state.typed += 1;
    put(state, cell, letter);

    if (isSolved(puzzle, state)) state.status = "won";
    return { ok: true, cell, letter, status: state.status };
  }

  /*
   * Checking says which of the letters already written are wrong. It does not
   * say what the right ones are, so it costs less than a reveal - but it is
   * still help, and it is counted as such.
   */
  function check(puzzle, state, scope) {
    if (state.status !== "playing") return { ok: false, message: "This one is already done." };

    const cells = Array.isArray(scope) && scope.length
      ? scope.map(Number).filter((cell) => Number.isInteger(cell) && !isBlack(puzzle, cell))
      : [...puzzle.grid].map((_, i) => i).filter((i) => !isBlack(puzzle, i));

    const wrong = cells.filter((cell) =>
      state.letters[cell] !== EMPTY && state.letters[cell] !== answerAt(puzzle, cell));

    state.checks += 1;
    return { ok: true, wrong, checked: cells.length, status: state.status };
  }

  /*
   * A hint fills in one square. Given a cell it fills that one; otherwise it
   * takes the first square still empty, reading the way the grid reads.
   */
  function hint(puzzle, state, where) {
    if (state.status !== "playing") return { ok: false, message: "This one is already done." };

    let cell = Number.isInteger(where) ? where : -1;
    if (cell < 0 || isBlack(puzzle, cell) || state.letters[cell] === answerAt(puzzle, cell)) {
      cell = -1;
      for (let i = 0; i < puzzle.grid.length; i++) {
        if (isBlack(puzzle, i)) continue;
        if (state.letters[i] !== answerAt(puzzle, i)) { cell = i; break; }
      }
    }
    if (cell === -1) return { ok: false, message: "It is already all there." };

    const letter = answerAt(puzzle, cell);
    put(state, cell, letter);
    if (!state.revealed.includes(cell)) state.revealed.push(cell);

    if (isSolved(puzzle, state)) state.status = "won";
    return { ok: true, hint: { cell, letter }, status: state.status };
  }

  /** Give up: fill it in and show what it was. */
  function reveal(puzzle, state) {
    if (state.status === "playing") {
      state.letters = puzzle.letters.toUpperCase()
        .split("").map((c, i) => (puzzle.grid[i] === BLACK ? BLACK : c)).join("");
      state.status = "done";
    }
    return { ok: true, status: state.status };
  }

  const finished = (state) => state.status !== "playing";

  /** Which entries the player has filled correctly, for the clue list. */
  function solvedEntries(puzzle, state) {
    return puzzle.entries
      .filter((entry) => entry.cells.every((cell) => state.letters[cell] === answerAt(puzzle, cell)))
      .map((entry) => entry.number + (entry.across ? "A" : "D"));
  }

  const view = (puzzle, state) => ({
    size: puzzle.size,
    grid: puzzle.grid,
    numbers: puzzle.numbers,
    /* The clue list, deliberately without the answers attached. */
    entries: puzzle.entries.map((entry) => ({
      number: entry.number,
      across: entry.across,
      cells: entry.cells,
      clue: entry.clue,
      length: entry.cells.length,
    })),
    letters: state.letters,
    revealed: state.revealed,
    checks: state.checks,
    solvedEntries: solvedEntries(puzzle, state),
    status: state.status,
    /* Only once the round is over. */
    answers: finished(state)
      ? puzzle.entries.map((entry) => ({
          number: entry.number, across: entry.across, answer: entry.answer.toUpperCase(),
        }))
      : null,
    solution: finished(state) ? puzzle.letters.toUpperCase() : null,
  });

  const summary = (puzzle, state) => {
    const squares = [...puzzle.grid].filter((c) => c !== BLACK).length;
    const right = [...puzzle.grid].filter((_, i) =>
      puzzle.grid[i] !== BLACK && state.letters[i] === answerAt(puzzle, i)).length;

    return {
      /*
       * Filling the last square by asking for it is not solving the puzzle.
       * Without this, revealing every letter in turn ends with status "won"
       * and counts towards a streak, which would make a streak meaningless.
       * At least one correct square has to be the player's own.
       */
      won: state.status === "won" && right - state.revealed.length > 0,
      /* Letters the player put in themselves - the reveals are counted as
       * help, not as work. */
      guesses: state.typed,
      hints: state.revealed.length + state.checks,
      squares,
      right,
      /* For the share block: how much of the grid was filled without help. */
      unaided: squares ? (right - state.revealed.length) / squares : 0,
    };
  };

  return {
    key: shape.key,
    name: shape.name,
    custom: false,
    size: shape.size,
    dailyPuzzle, randomPuzzle,
    create, guess, hint, check, reveal, view, summary, finished,
  };
}

module.exports = {
  crossword: makeGame(SHAPES.crossword),
  mini: makeGame(SHAPES.mini),
  SHAPES,
};
