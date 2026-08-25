"use strict";
/*
 * The game registry.
 *
 * Every game exposes the same handful of functions, so the routes never need
 * to know which one they are talking to: deal a puzzle, take a guess, give a
 * hint, describe the state, summarise the result. Anything a game does not do
 * - Wordle has no `back`, the Bee has no custom puzzles - is simply absent,
 * and the routes check before calling.
 */

const wordle = require("./wordle.js");
const connections = require("./connections.js");
const bee = require("./spellingbee.js");
const boxed = require("./letterboxed.js");
const travle = require("./travle.js");
const { crossword, mini } = require("./crossword.js");
const strands = require("./strands.js");
const pips = require("./pips.js");

const LIST = [wordle, connections, bee, boxed, crossword, mini, strands, pips, travle];
const GAMES = Object.fromEntries(LIST.map((g) => [g.key, g]));

/* What the home screen shows about each game, kept here so the browser does
 * not carry a second copy of the list that can drift. */
const CATALOGUE = [
  {
    key: "wordle",
    name: "Wordle",
    tagline: "Six tries, five letters.",
    blurb: "Guess the word. Green is right, yellow is in there somewhere.",
    icon: "wordle",
    custom: true,
  },
  {
    key: "connections",
    name: "Connections",
    tagline: "Sixteen words, four groups.",
    blurb: "Find what belongs together. Four mistakes and it is over.",
    icon: "connections",
    custom: true,
  },
  {
    key: "bee",
    name: "Spelling Bee",
    tagline: "Seven letters, one compulsory.",
    blurb: "Make as many words as you can. Use all seven for a pangram.",
    icon: "bee",
    custom: false,
  },
  {
    key: "boxed",
    name: "Letter Boxed",
    tagline: "Twelve letters, four sides.",
    blurb: "Never take two letters from the same side. Use all twelve.",
    icon: "boxed",
    custom: false,
  },
  {
    key: "crossword",
    name: "The Crossword",
    tagline: "Fifteen by fifteen.",
    blurb: "A full grid. Every answer crosses another, so the ones you know give you the ones you do not.",
    icon: "crossword",
    custom: false,
  },
  {
    key: "mini",
    name: "The Mini",
    tagline: "Five by five.",
    blurb: "The same idea, small enough for a bus stop.",
    icon: "mini",
    custom: false,
  },
  {
    key: "strands",
    name: "Strands",
    tagline: "Every letter belongs to something.",
    blurb: "Find the themed words hidden in the grid. One of them names the theme and crosses the whole board.",
    icon: "strands",
    custom: false,
  },
  {
    key: "pips",
    name: "Pips",
    tagline: "Dominoes, with rules.",
    blurb: "Cover the board so every marked region adds up, matches or differs the way it says it must.",
    icon: "pips",
    custom: false,
  },
  {
    key: "travle",
    name: "Travle Overland",
    tagline: "Walk between two countries.",
    blurb: "One land border at a time, naming every country on the way.",
    icon: "travle",
    custom: true,
  },
];

const get = (key) => GAMES[key] || null;

/**
 * Deal a puzzle. Daily puzzles come from the day number, so they are the same
 * for everyone and can be recomputed forever; unlimited ones come from a seed
 * the caller invents.
 */
function puzzleFor(game, mode, { day, seed, difficulty } = {}) {
  if (mode === "daily") {
    return game.key === "travle"
      ? game.dailyPuzzle(day, difficulty)
      : game.dailyPuzzle(day);
  }
  return game.key === "travle"
    ? game.randomPuzzle(seed, difficulty)
    : game.randomPuzzle(seed);
}

module.exports = { GAMES, LIST, CATALOGUE, get, puzzleFor };
