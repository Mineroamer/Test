"use strict";
/*
 * Travle Overland.
 *
 * The engine here is the same file the browser loads - pure logic, no DOM -
 * so the server can deal, judge and score a round without a second
 * implementation to keep in step. This module only adapts it to the shape the
 * rest of the app expects from a game, and adds save/restore so a round
 * survives a refresh.
 *
 * The map, and only the map, stays a browser concern.
 */

const path = require("node:path");
const { rngFor } = require("../rng.js");

const Engine = require(path.join(__dirname, "..", "..", "..", "public", "js", "games", "travle", "engine.js"));

const DEFAULT_DIFFICULTY = Engine.DEFAULT_MODE;

const dailyPuzzle = (day, difficulty = DEFAULT_DIFFICULTY) => ({
  ...Engine.puzzleForDay(day, difficulty),
  difficulty,
});

const randomPuzzle = (seed, difficulty = "unlimited") => ({
  ...Engine.randomPuzzle(difficulty, rngFor("travle:free:" + seed)),
  difficulty,
});

function validateCustom(payload) {
  const errors = [];
  const start = Engine.resolve(String(payload && payload.start || ""));
  const end = Engine.resolve(String(payload && payload.end || ""));

  if (!start) errors.push("I do not know that starting country.");
  if (!end) errors.push("I do not know that destination.");
  if (start && end && start === end) errors.push("Start somewhere other than the finish.");

  if (start && end && start !== end) {
    const legs = Engine.distance(start, end);
    if (!Number.isFinite(legs)) {
      errors.push(`You cannot walk from ${Engine.nameOf(start)} to ${Engine.nameOf(end)} - no land route joins them.`);
    } else if (legs < 2) {
      errors.push(`${Engine.nameOf(start)} and ${Engine.nameOf(end)} are neighbours, so there is nothing to work out.`);
    }
  }

  const difficulty = Engine.DIFFICULTIES[payload && payload.difficulty] ? payload.difficulty : DEFAULT_DIFFICULTY;
  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { start, end, difficulty } };
}

const fromCustom = (payload) => ({
  start: payload.start,
  end: payload.end,
  legs: Engine.distance(payload.start, payload.end),
  difficulty: payload.difficulty || DEFAULT_DIFFICULTY,
  custom: true,
});

/*
 * The engine's Game holds a Set and derives a lot from its own fields, so it is
 * rebuilt from a plain snapshot on each request rather than kept in memory.
 * Nothing in a round is expensive enough for that to matter.
 */
function load(puzzle, state) {
  const game = new Engine.Game(puzzle, puzzle.difficulty || DEFAULT_DIFFICULTY);
  if (state.trail && state.trail.length) game.trail = state.trail.slice();
  game.moves = (state.moves || []).map((m) => ({ ...m }));
  game.dead = new Set(state.dead || []);
  game.status = state.status || "playing";
  return game;
}

const save = (game, state) => {
  state.trail = game.trail.slice();
  state.moves = game.moves.map((m) => ({ ...m }));
  state.dead = [...game.dead];
  state.status = game.status;
  return state;
};

const create = (puzzle) => ({
  trail: [puzzle.start],
  moves: [],
  dead: [],
  hints: [],
  status: "playing",
});

function guess(puzzle, state, input) {
  const game = load(puzzle, state);
  const result = game.play(input);
  if (!result.ok) return { ok: false, message: result.message, code: result.code || null };

  save(game, state);
  return {
    ok: true,
    code: result.code,
    from: result.from,
    move: result.move,
    link: result.link,
    name: Engine.nameOf(result.code),
    message: result.message || null,
    status: game.status,
  };
}

/** Step back to the country before this one, undoing a wrong turn. */
function back(puzzle, state) {
  const game = load(puzzle, state);
  if (!game.canBack()) return { ok: false, message: "There is nowhere to step back to." };
  game.back();
  save(game, state);
  return { ok: true, status: game.status };
}

/*
 * The hint names one country on a shortest route from where the player is
 * standing - the next real step, not the whole way.
 */
function hint(puzzle, state) {
  const game = load(puzzle, state);
  if (game.status !== "playing") return { ok: false, message: "This round is already over." };

  const route = Engine.shortestRoute(game.current, puzzle.end);
  if (!route || route.length < 2) return { ok: false, message: "You are already there." };

  const next = route[1];
  const revealed = { from: game.current, code: next, name: Engine.nameOf(next) };
  state.hints = state.hints || [];
  state.hints.push(revealed);
  return { ok: true, hint: revealed };
}

function reveal(puzzle, state) {
  if (state.status === "playing") state.status = "done";
  return { ok: true, status: state.status };
}

const finished = (state) => state.status !== "playing";

function view(puzzle, state) {
  const game = load(puzzle, state);
  const done = finished(state);
  return {
    start: puzzle.start,
    end: puzzle.end,
    startName: Engine.nameOf(puzzle.start),
    endName: Engine.nameOf(puzzle.end),
    difficulty: puzzle.difficulty || DEFAULT_DIFFICULTY,
    par: game.par,
    budget: game.budget,
    used: game.used,
    left: game.left,
    toGo: game.toGo,
    trail: game.trail.slice(),
    moves: game.moves.map((m) => ({ ...m, name: Engine.nameOf(m.code) })),
    outOfReach: game.outOfReach,
    hints: state.hints || [],
    status: game.status,
    /* The shortest way, once the round can no longer be spoiled by it. */
    solution: done ? Engine.shortestRoute(puzzle.start, puzzle.end) : null,
  };
}

function summary(puzzle, state) {
  const game = load(puzzle, state);
  return {
    won: game.status === "won",
    guesses: game.moves.length,
    hints: (state.hints || []).length,
    par: game.par,
    over: Math.max(0, game.used - game.par),
    grid: game.moves.map((m) => m.move),
  };
}

module.exports = {
  key: "travle",
  name: "Travle Overland",
  custom: true,
  Engine,
  DIFFICULTIES: Engine.DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  dailyPuzzle, randomPuzzle, validateCustom, fromCustom,
  create, guess, back, hint, reveal, view, summary, finished,
};
