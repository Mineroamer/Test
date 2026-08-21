/*
 * Travle Overland - game engine.
 *
 * Pure logic, no DOM. Loadable in the browser (globals) and in Node (exports)
 * so the same code the page runs is the code the tests run.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    const data = require("../data/countries.js");
    module.exports = factory(data.COUNTRIES, data.SPECIAL_LINKS, data.ALIASES);
  } else {
    root.Engine = factory(root.COUNTRIES, root.SPECIAL_LINKS, root.ALIASES);
  }
})(typeof self !== "undefined" ? self : this, function (COUNTRIES, SPECIAL_LINKS, ALIASES) {
  "use strict";

  /* ------------------------------------------------------------------ graph */

  /** code -> Map(neighbourCode -> { special: null | linkObject }) */
  const ADJ = new Map();
  for (const code of Object.keys(COUNTRIES)) ADJ.set(code, new Map());
  for (const [code, country] of Object.entries(COUNTRIES)) {
    for (const other of country.borders) ADJ.get(code).set(other, { special: null });
  }
  for (const link of SPECIAL_LINKS) {
    ADJ.get(link.a).set(link.b, { special: link });
    ADJ.get(link.b).set(link.a, { special: link });
  }

  const ALL_CODES = Object.keys(COUNTRIES);
  /** Countries that can appear on a route at all. */
  const LINKED = ALL_CODES.filter((c) => ADJ.get(c).size > 0);

  function neighbours(code) {
    return ADJ.get(code) || new Map();
  }

  function linkBetween(a, b) {
    const edge = ADJ.get(a) && ADJ.get(a).get(b);
    return edge ? edge.special : null;
  }

  /* ---------------------------------------------------------------- lookups */

  /** Fold input down to a comparable key: lowercase, no accents, no punctuation. */
  function normalise(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const NAME_INDEX = new Map(); // normalised string -> code
  const SEARCH_TERMS = []; // { code, term, alias } for autocomplete
  for (const [code, country] of Object.entries(COUNTRIES)) {
    const forms = [country.name, code, ...(ALIASES[code] || [])];
    for (const form of forms) {
      const key = normalise(form);
      if (key && !NAME_INDEX.has(key)) NAME_INDEX.set(key, code);
    }
    SEARCH_TERMS.push({ code, term: normalise(country.name), alias: false });
    // The ISO code has to be searchable too, or typing "US" offers Russia
    // (from the USSR alias) and "PT" offers Egypt.
    SEARCH_TERMS.push({ code, term: normalise(code), alias: true });
    for (const alias of ALIASES[code] || []) {
      SEARCH_TERMS.push({ code, term: normalise(alias), alias: true });
    }
  }

  /** Resolve typed text to a country code, or null. Tolerates one typo. */
  function resolve(text) {
    const key = normalise(text);
    if (!key) return null;
    if (NAME_INDEX.has(key)) return NAME_INDEX.get(key);

    const stripped = key.replace(/^the /, "");
    if (NAME_INDEX.has(stripped)) return NAME_INDEX.get(stripped);

    // Unique prefix match, e.g. "kyrgyz" -> Kyrgyzstan.
    const prefixed = [...new Set(SEARCH_TERMS.filter((e) => e.term.startsWith(stripped)).map((e) => e.code))];
    if (prefixed.length === 1) return prefixed[0];

    // One typo away, for near-misses like "portgual" or "belguim".
    if (stripped.length >= 4) {
      const close = [...new Set(SEARCH_TERMS.filter((e) => withinOneTypo(e.term, stripped)).map((e) => e.code))];
      if (close.length === 1) return close[0];
    }
    return null;
  }

  /** Damerau-Levenshtein distance of 1: one insert, delete, swap or transposition. */
  function withinOneTypo(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a === b) return true;

    if (a.length === b.length) {
      const diffs = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
      if (diffs.length === 1) return true;
      if (diffs.length === 2 && diffs[1] === diffs[0] + 1) {
        return a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]];
      }
      return false;
    }

    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    let i = 0;
    while (i < short.length && short[i] === long[i]) i++;
    return short.slice(i) === long.slice(i + 1);
  }

  /** Autocomplete suggestions, best match first. */
  function suggest(text, limit = 6) {
    const key = normalise(text).replace(/^the /, "");
    if (!key) return [];
    const scored = new Map();
    for (const entry of SEARCH_TERMS) {
      let tier = null;
      if (entry.term === key) tier = 0;
      else if (entry.term.startsWith(key)) tier = 1;
      else if (entry.term.includes(" " + key)) tier = 2;
      else if (entry.term.includes(key)) tier = 3;
      if (tier === null) continue;
      // A country's own name always outranks one of its nicknames.
      const score = tier * 2 + (entry.alias ? 1 : 0);
      const previous = scored.get(entry.code);
      if (previous === undefined || score < previous) scored.set(entry.code, score);
    }
    return [...scored.entries()]
      .sort((x, y) => x[1] - y[1] || COUNTRIES[x[0]].name.localeCompare(COUNTRIES[y[0]].name))
      .slice(0, limit)
      .map(([code]) => code);
  }

  /* -------------------------------------------------------------- traversal */

  /**
   * Breadth-first search over the border graph.
   * `allowed` optionally restricts which countries may be entered.
   */
  function bfs(source, allowed) {
    const dist = new Map([[source, 0]]);
    const prev = new Map();
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      for (const next of neighbours(current).keys()) {
        if (dist.has(next)) continue;
        if (allowed && !allowed.has(next)) continue;
        dist.set(next, dist.get(current) + 1);
        prev.set(next, current);
        queue.push(next);
      }
    }
    return { dist, prev };
  }

  function pathFrom(prev, source, target) {
    if (source === target) return [source];
    if (!prev.has(target)) return null;
    const path = [target];
    let node = target;
    while (node !== source) {
      node = prev.get(node);
      path.push(node);
    }
    return path.reverse();
  }

  /** Distances from every country, computed once and reused for hints. */
  const DISTANCE_CACHE = new Map();
  function distancesFrom(code) {
    if (!DISTANCE_CACHE.has(code)) DISTANCE_CACHE.set(code, bfs(code).dist);
    return DISTANCE_CACHE.get(code);
  }

  function distance(a, b) {
    const d = distancesFrom(a).get(b);
    return d === undefined ? Infinity : d;
  }

  function shortestRoute(a, b) {
    const { prev } = bfs(a);
    return pathFrom(prev, a, b);
  }

  /* ---------------------------------------------------------------- puzzles */

  /** Deterministic PRNG so a given day yields the same puzzle everywhere. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Endpoints players will recognise. Any country can be *guessed*; these are
     only the countries a puzzle may start or finish at. */
  const HEADLINERS = [
    "AR", "AT", "AU", "BD", "BE", "BO", "BR", "BG", "KH", "CM", "CA", "CL", "CN", "CO", "HR", "CU",
    "CZ", "DK", "CD", "EC", "EG", "ET", "FI", "FR", "DE", "GH", "GR", "GT", "HU", "IN", "ID", "IR",
    "IQ", "IE", "IL", "IT", "JP", "JO", "KZ", "KE", "KP", "KR", "LA", "LB", "LY", "MY", "ML", "MX",
    "MN", "MA", "MZ", "MM", "NA", "NP", "NL", "NZ", "NG", "NO", "OM", "PK", "PA", "PG", "PY", "PE",
    "PH", "PL", "PT", "QA", "RO", "RU", "SA", "SN", "RS", "SG", "ZA", "ES", "LK", "SD", "SE", "CH",
    "SY", "TW", "TZ", "TH", "TR", "UG", "UA", "AE", "GB", "US", "UY", "UZ", "VE", "VN", "YE", "ZM",
    "ZW", "AF", "AL", "DZ", "AM", "AZ", "BY", "BT", "BW", "BF", "GE", "IS", "JM", "KW", "LV", "LT",
    "LU", "MD", "MC", "SK", "SI", "SO", "TN", "TM", "EE",
  ].filter((code) => LINKED.includes(code));

  const MIN_LEGS = 4; // start -> end hops, so at least 3 countries in between
  const MAX_LEGS = 7;

  /** Every headliner pair whose shortest route is an interesting length. */
  const PAIRS = (function () {
    const pairs = [];
    for (let i = 0; i < HEADLINERS.length; i++) {
      const from = HEADLINERS[i];
      const dist = distancesFrom(from);
      for (let j = i + 1; j < HEADLINERS.length; j++) {
        const to = HEADLINERS[j];
        const legs = dist.get(to);
        if (legs >= MIN_LEGS && legs <= MAX_LEGS) pairs.push([from, to, legs]);
      }
    }
    return pairs;
  })();

  /*
   * Four ways to play. The three daily levels each get their OWN route for the
   * day - sharing one route between them would mean solving Scenic hands you
   * the answer to Expert. They get harder by giving you a longer way to walk
   * and less room to be wrong. Unlimited is not tied to the day at all.
   */
  const DIFFICULTIES = {
    scenic:    { label: "Scenic",    slack: 8, showDistance: true,  legs: [4, 5], daily: true,  seed: 0x9e3779b1 },
    standard:  { label: "Standard",  slack: 5, showDistance: true,  legs: [5, 6], daily: true,  seed: 0x85ebca6b },
    expert:    { label: "Expert",    slack: 2, showDistance: false, legs: [6, 7], daily: true,  seed: 0xc2b2ae35 },
    unlimited: { label: "Unlimited", slack: 5, showDistance: true,  legs: [4, 7], daily: false, seed: 0x27d4eb2f },
  };

  const DEFAULT_MODE = "standard";

  /** The puzzles a given level may draw from. */
  function poolFor(modeKey) {
    const mode = DIFFICULTIES[modeKey] || DIFFICULTIES[DEFAULT_MODE];
    return PAIRS.filter(([, , legs]) => legs >= mode.legs[0] && legs <= mode.legs[1]);
  }

  /*
   * Daily routes are dealt from a fixed shuffle of the level's pool rather than
   * drawn at random each day, so a route cannot come round again until every
   * other one has been used - years, at one a day.
   */
  const DEALS = new Map();
  function dealFor(modeKey) {
    if (!DEALS.has(modeKey)) {
      const mode = DIFFICULTIES[modeKey] || DIFFICULTIES[DEFAULT_MODE];
      const pool = poolFor(modeKey);
      const random = mulberry32(mode.seed);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const swap = pool[i];
        pool[i] = pool[j];
        pool[j] = swap;
      }
      DEALS.set(modeKey, pool);
    }
    return DEALS.get(modeKey);
  }

  const EPOCH = Date.UTC(2024, 0, 1);

  function dayNumber(date = new Date()) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((utc - EPOCH) / 86400000);
  }

  /** The daily route for one level. Same day and level, same route, anywhere. */
  function puzzleForDay(day, modeKey = DEFAULT_MODE) {
    const mode = DIFFICULTIES[modeKey] || DIFFICULTIES[DEFAULT_MODE];
    const deal = dealFor(modeKey);
    const index = ((day % deal.length) + deal.length) % deal.length;
    const [from, to, legs] = deal[index];
    // Alternate direction so the same pair does not always read the same way.
    const flip = mulberry32((day * 2654435761) ^ mode.seed)() < 0.5;
    return { id: day, mode: modeKey, daily: true, start: flip ? to : from, end: flip ? from : to, legs };
  }

  function randomPuzzle(modeKey = "unlimited", random = Math.random) {
    const pool = poolFor(modeKey);
    const [from, to, legs] = pool[Math.floor(random() * pool.length)];
    return { id: null, mode: modeKey, daily: false, start: from, end: to, legs };
  }

  /** Milliseconds until the daily levels roll over, in the player's own day. */
  function msUntilReset(now = new Date()) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return midnight - now;
  }

  /* ------------------------------------------------------------------- game */

  /* What a submitted country did. */
  const MOVE = {
    CLOSER: "closer",   // a step that shortens the way to the finish
    SIDEWAYS: "sideways", // a step that leaves the distance unchanged
    AWAY: "away",       // a step that lengthens it
    BACK: "back",       // a step onto a country already on your trail
    MISS: "miss",       // named a country that does not border where you stand
  };

  class Game {
    constructor(puzzle, difficultyKey = DEFAULT_MODE) {
      this.puzzle = puzzle;
      this.difficultyKey = DIFFICULTIES[difficultyKey] ? difficultyKey : DEFAULT_MODE;
      this.difficulty = DIFFICULTIES[this.difficultyKey];
      this.start = puzzle.start;
      this.end = puzzle.end;
      this.legs = distance(this.start, this.end);
      this.par = this.legs; // border crossings on the shortest way
      this.budget = this.par + this.difficulty.slack;
      this.trail = [this.start]; // every country you are standing on, in order
      this.moves = []; // { code, move, from } - one per guess that cost you
      this.dead = new Set(); // "from>to" pairs already tried and refused
      this.status = "playing"; // playing | won | lost
    }

    get current() {
      return this.trail[this.trail.length - 1];
    }

    get used() {
      return this.moves.length;
    }

    get left() {
      return Math.max(0, this.budget - this.used);
    }

    /** Border crossings still needed, at best, from where you stand. */
    get toGo() {
      return distance(this.current, this.end);
    }

    visited(code) {
      return this.trail.includes(code);
    }

    /** Countries you could step to right now. */
    exits() {
      return [...neighbours(this.current).keys()];
    }

    /**
     * Name a country. A country that borders where you stand moves you onto
     * it; anything else costs a guess and leaves you where you are.
     */
    play(input) {
      if (this.status !== "playing") return { ok: false, message: "This round is over." };

      const code = typeof input === "string" && COUNTRIES[input] ? input : resolve(input);
      if (!code) return { ok: false, message: "No country by that name." };

      const from = this.current;
      if (code === from) {
        return { ok: false, code, message: "You are standing in " + COUNTRIES[code].name + "." };
      }
      const pair = from + ">" + code;
      if (this.dead.has(pair)) {
        return { ok: false, code, message: COUNTRIES[code].name + " still does not border " + COUNTRIES[from].name + "." };
      }

      const border = neighbours(from).has(code);
      if (!border) {
        this.dead.add(pair);
        this.moves.push({ code, move: MOVE.MISS, from });
        this.settle();
        return {
          ok: true,
          code,
          from,
          move: MOVE.MISS,
          link: null,
          message: COUNTRIES[code].name + " does not border " + COUNTRIES[from].name + ".",
          status: this.status,
        };
      }

      const was = distance(from, this.end);
      const now = distance(code, this.end);
      const seen = this.trail.indexOf(code);
      let move;
      if (seen !== -1) {
        this.trail.length = seen + 1; // walk back to where you were
        move = MOVE.BACK;
      } else {
        this.trail.push(code);
        move = now < was ? MOVE.CLOSER : now === was ? MOVE.SIDEWAYS : MOVE.AWAY;
      }
      this.moves.push({ code, move, from });

      if (this.current === this.end) this.status = "won";
      else this.settle();

      return { ok: true, code, from, move, link: linkBetween(from, code), status: this.status };
    }

    /**
     * Can you step back right now? Not at the start, and not when retreating
     * would put the finish further away than your remaining guesses can carry
     * you - Back is free, so it must never be the move that strands you.
     */
    canBack() {
      if (this.status !== "playing" || this.trail.length < 2) return false;
      const previous = this.trail[this.trail.length - 2];
      return distance(previous, this.end) <= this.left;
    }

    /** Free undo: return to the country you were on before this one. */
    back() {
      if (!this.canBack()) return false;
      this.trail.pop();
      return true;
    }

    /** Lose when the guesses run out, or when the finish moves out of reach. */
    settle() {
      if (this.status !== "playing") return;
      if (this.left === 0 || this.toGo > this.left) this.status = "lost";
    }

    /** Border crossings taken beyond the shortest possible route. */
    overshoot() {
      if (this.status !== "won") return null;
      return this.trail.length - 1 - this.par;
    }

    solution() {
      return shortestRoute(this.start, this.end);
    }
  }

  /* ------------------------------------------------------------------ misc. */

  function nameOf(code) {
    return COUNTRIES[code] ? COUNTRIES[code].name : code;
  }

  return {
    COUNTRIES, SPECIAL_LINKS, ALIASES, ADJ, LINKED, HEADLINERS, PAIRS, DIFFICULTIES, MOVE,
    DEFAULT_MODE, Game, bfs, distance, distancesFrom, shortestRoute, neighbours, linkBetween,
    resolve, suggest, normalise, nameOf, dayNumber, puzzleForDay, randomPuzzle, mulberry32,
    poolFor, dealFor, msUntilReset,
  };
});
