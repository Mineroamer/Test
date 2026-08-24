"use strict";
/*
 * Wordle.
 *
 * The answer never leaves the server until the round is over. The browser
 * posts a guess and gets back only the colours, which is what makes an
 * unlimited game worth playing - there is nothing in the page to read ahead.
 *
 * Daily and unlimited use five letters and six guesses. A puzzle somebody
 * builds themselves may use four to eight, and always gets length + 1 guesses
 * so a longer word is not unfairly tight.
 */

const path = require("node:path");
const { rngFor, pick } = require("../rng.js");

const DATA = path.join(__dirname, "..", "..", "..", "data");
const ANSWERS = require(path.join(DATA, "wordle-answers.json"));
const ALLOWED = new Set(require(path.join(DATA, "wordle-allowed.json")));

const MARK = { HIT: "hit", NEAR: "near", MISS: "miss" };
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

/*
 * Mark a guess against an answer.
 *
 * The two passes matter for repeated letters: exact positions are claimed
 * first, and only the letters left over can be marked "near". Without that,
 * guessing SPEED against ERASE would light up both E's when the answer only
 * has one to give.
 */
function score(guess, answer) {
  const marks = new Array(guess.length).fill(MARK.MISS);
  const spare = {};

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) marks[i] = MARK.HIT;
    else spare[answer[i]] = (spare[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === MARK.HIT) continue;
    if (spare[guess[i]] > 0) {
      marks[i] = MARK.NEAR;
      spare[guess[i]] -= 1;
    }
  }
  return marks;
}

/** The best-known state of each letter, for colouring the keyboard. */
function keyboardFrom(guesses) {
  const rank = { [MARK.MISS]: 0, [MARK.NEAR]: 1, [MARK.HIT]: 2 };
  const keys = {};
  for (const row of guesses) {
    row.word.split("").forEach((letter, i) => {
      const mark = row.marks[i];
      if (keys[letter] === undefined || rank[mark] > rank[keys[letter]]) keys[letter] = mark;
    });
  }
  return keys;
}

const dailyPuzzle = (day) => ({
  answer: pick(ANSWERS, rngFor("wordle:daily:" + day)),
  length: 5,
  tries: 6,
});

const randomPuzzle = (seed) => ({
  answer: pick(ANSWERS, rngFor("wordle:free:" + seed)),
  length: 5,
  tries: 6,
});

/** Turn what an author typed into a puzzle, or explain why it will not do. */
function validateCustom(payload) {
  const answer = String(payload && payload.answer || "").trim().toLowerCase();
  const errors = [];

  if (!/^[a-z]+$/.test(answer)) errors.push("The answer must be letters only, with no spaces.");
  else if (answer.length < MIN_LENGTH || answer.length > MAX_LENGTH) {
    errors.push(`The answer must be ${MIN_LENGTH} to ${MAX_LENGTH} letters long.`);
  }

  const note = String(payload && payload.note || "").trim().slice(0, 140);
  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { answer, note } };
}

const fromCustom = (payload) => ({
  answer: payload.answer,
  length: payload.answer.length,
  /* One more guess than the word is long: tight at five, still fair at eight. */
  tries: payload.answer.length + 1,
  note: payload.note || "",
  custom: true,
});

const create = () => ({ guesses: [], hints: [], status: "playing" });

function guess(puzzle, state, input) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const word = String(input || "").trim().toLowerCase();
  if (word.length !== puzzle.length) {
    return { ok: false, message: `Needs to be ${puzzle.length} letters.` };
  }
  if (!/^[a-z]+$/.test(word)) return { ok: false, message: "Letters only." };

  /* A custom answer may be a word no dictionary has, so it is always its own
   * valid guess; everything else has to be a word the game knows. */
  if (!ALLOWED.has(word) && word !== puzzle.answer) {
    return { ok: false, message: `"${word.toUpperCase()}" is not in the word list.` };
  }
  if (state.guesses.some((row) => row.word === word)) {
    return { ok: false, message: "You have already tried that one." };
  }

  const marks = score(word, puzzle.answer);
  state.guesses.push({ word, marks });

  if (word === puzzle.answer) state.status = "won";
  else if (state.guesses.length >= puzzle.tries) state.status = "lost";

  return { ok: true, marks, status: state.status };
}

/*
 * A hint reveals one letter in a position the player has not already pinned
 * down. It costs nothing but the record of having used it, which is what the
 * stats page reports.
 */
function hint(puzzle, state) {
  if (state.status !== "playing") return { ok: false, message: "This round is already over." };

  const known = new Set(state.hints.map((h) => h.index));
  for (const row of state.guesses) {
    row.marks.forEach((mark, i) => { if (mark === MARK.HIT) known.add(i); });
  }
  const open = [];
  for (let i = 0; i < puzzle.length; i++) if (!known.has(i)) open.push(i);

  if (!open.length) return { ok: false, message: "Every letter is already showing." };
  /* Deterministic in the guesses so far, so asking twice cannot be farmed for
   * a different, easier letter. */
  const index = pick(open, rngFor(puzzle.answer + ":" + state.hints.length));
  const revealed = { index, letter: puzzle.answer[index] };
  state.hints.push(revealed);
  return { ok: true, hint: revealed };
}

const finished = (state) => state.status !== "playing";

const view = (puzzle, state) => ({
  length: puzzle.length,
  tries: puzzle.tries,
  note: puzzle.note || "",
  guesses: state.guesses,
  hints: state.hints,
  keyboard: keyboardFrom(state.guesses),
  status: state.status,
  /* Only ever sent once there is nothing left to spoil. */
  answer: finished(state) ? puzzle.answer : null,
});

const summary = (puzzle, state) => ({
  won: state.status === "won",
  guesses: state.guesses.length,
  hints: state.hints.length,
  /* The grid of colours, for sharing without giving the word away. */
  grid: state.guesses.map((row) => row.marks),
});

module.exports = {
  key: "wordle",
  name: "Wordle",
  custom: true,
  MARK, MIN_LENGTH, MAX_LENGTH,
  score, keyboardFrom,
  dailyPuzzle, randomPuzzle, validateCustom, fromCustom,
  create, guess, hint, view, summary, finished,
};
