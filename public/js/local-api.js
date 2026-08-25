/*
 * The same API surface as api.js, without a server behind it.
 *
 * This is what lets the whole app run as a single page on a static host. The
 * screens and the game views are not aware of the difference: they call
 * `api.play`, `api.guess`, `api.stats` exactly as before, and the game engines
 * doing the judging are the same files the server runs.
 *
 * Three things necessarily change when there is nobody to be the referee:
 *
 *   - The answer is in the page. It has to be. Unlimited play still works,
 *     but a determined person can read it out of memory rather than guess it.
 *   - A record is per-device, kept in localStorage, not per-account.
 *   - A shared puzzle carries itself. Rather than a code that a server looks
 *     up, the puzzle is packed into the link, so a link is the whole puzzle
 *     and works for anyone, forever, with nothing to host.
 */

import { ApiError } from "./api.js";

const games = window.PC.games;
const { dayNumber, msUntilReset, dayLabel } = window.PC.rng;

const CATALOGUE = window.PC.catalogue;
const STORE_KEY = "pc:local";

/* --------------------------------------------------------------- storage */

/*
 * One record in localStorage holds everything: who you are on this device,
 * the rounds in progress, and the tallies. Private browsing makes writes
 * throw, so every touch is guarded and the app simply forgets between visits
 * rather than breaking.
 */
const blank = () => ({ player: null, runs: {}, stats: {}, results: [], progress: {} });

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? Object.assign(blank(), JSON.parse(raw)) : blank();
  } catch {
    return blank();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* Out of quota, or storage refused. The round in front of them still
     * plays; it just will not be there tomorrow. */
  }
}

/* --------------------------------------------------------- shared links */

/*
 * A puzzle packed into text. `btoa` only speaks Latin-1, so the JSON goes
 * through UTF-8 first; the result is made URL-safe so it can live in a hash.
 */
function pack(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unpack(code) {
  const padded = code.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const readShared = (code) => {
  try {
    const found = unpack(code);
    if (!found || !games[found.g]) return null;
    return found;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------ the rounds */

const newId = () => "r" + Math.random().toString(36).slice(2, 11);

/** Rebuild the puzzle a round refers to, exactly as the server does. */
function puzzleFor(run) {
  const game = games[run.game];
  if (run.mode === "custom") {
    const shared = readShared(run.code);
    if (!shared) throw new ApiError(404, "That puzzle link is not one I can read.");
    return game.fromCustom(shared.p);
  }
  if (run.mode === "daily") {
    return run.game === "travle"
      ? game.dailyPuzzle(run.day, run.difficulty)
      : game.dailyPuzzle(run.day);
  }
  return run.game === "travle"
    ? game.randomPuzzle(run.seed, run.difficulty)
    : game.randomPuzzle(run.seed);
}

function view(run) {
  const game = games[run.game];
  const puzzle = puzzleFor(run);
  const shared = run.mode === "custom" ? readShared(run.code) : null;

  return {
    id: run.id,
    game: run.game,
    gameName: game.name,
    mode: run.mode,
    day: run.day ?? null,
    dayLabel: typeof run.day === "number" ? dayLabel(run.day) : null,
    code: run.code || null,
    difficulty: run.difficulty || null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    puzzle: game.view(puzzle, run.state),
    custom: shared
      ? { title: shared.t, code: run.code, by: { display: shared.b || "a friend" }, note: (shared.p && shared.p.note) || "" }
      : null,
    summary: game.finished(run.state) ? game.summary(puzzle, run.state) : null,
  };
}

/* Fold a finished round into the tallies. Same rules as the server's. */
function settle(run) {
  const game = games[run.game];
  if (!game.finished(run.state) || run.recorded) return;

  run.finishedAt = Date.now();
  run.recorded = true;

  const summary = game.summary(puzzleFor(run), run.state);
  /* Travle's three daily levels keep separate records, as they do on the
   * server - they are three different walks, and a shared streak would be
   * meaningless. */
  const variant = run.game === "travle" && run.mode === "daily" ? run.difficulty : null;
  const key = variant ? `${run.game}:${run.mode}:${variant}` : `${run.game}:${run.mode}`;
  const bucket = state.stats[key] || (state.stats[key] = {
    played: 0, won: 0, streak: 0, maxStreak: 0, lastDay: null,
    guesses: 0, hints: 0, timeMs: 0, distribution: {}, best: null,
  });

  bucket.played += 1;
  bucket.guesses += summary.guesses || 0;
  bucket.hints += summary.hints || 0;
  bucket.timeMs += Math.max(0, run.finishedAt - run.startedAt);

  if (summary.won) {
    bucket.won += 1;
    const n = summary.guesses || 0;
    bucket.distribution[n] = (bucket.distribution[n] || 0) + 1;
    if (bucket.best === null || n < bucket.best) bucket.best = n;
  }

  if (run.mode === "daily") {
    if (summary.won) {
      bucket.streak = bucket.lastDay === run.day - 1 ? bucket.streak + 1
        : bucket.lastDay === run.day ? bucket.streak : 1;
      if (bucket.streak > bucket.maxStreak) bucket.maxStreak = bucket.streak;
    } else if (bucket.lastDay !== run.day) {
      bucket.streak = 0;
    }
    bucket.lastDay = run.day;

    state.progress[`${run.day}:${run.game}`] = {
      won: !!summary.won, guesses: summary.guesses || 0, hints: summary.hints || 0,
    };
  }

  state.results.push({
    game: run.game, mode: run.mode, day: run.day ?? null,
    won: !!summary.won, guesses: summary.guesses || 0, hints: summary.hints || 0,
    took: run.finishedAt - run.startedAt, at: run.finishedAt,
  });
  if (state.results.length > 250) state.results = state.results.slice(-250);
  save();
}

/** Today's finished dailies, for the home screen. */
function todayProgress() {
  const today = dayNumber();
  const out = {};
  for (const [key, value] of Object.entries(state.progress)) {
    const [day, game] = key.split(":");
    if (Number(day) === today) out[game] = value;
  }
  return out;
}

const currentStreak = (bucket, today) =>
  !bucket || bucket.lastDay === null ? 0 : bucket.lastDay >= today - 1 ? bucket.streak : 0;

function statsFor() {
  const today = dayNumber();
  const out = {};
  for (const [key, bucket] of Object.entries(state.stats)) {
    const [game, mode, variant] = key.split(":");
    out[key] = {
      game, mode, variant: variant || null,
      played: bucket.played,
      won: bucket.won,
      winRate: bucket.played ? bucket.won / bucket.played : 0,
      streak: mode === "daily" ? currentStreak(bucket, today) : 0,
      maxStreak: bucket.maxStreak,
      averageGuesses: bucket.played ? bucket.guesses / bucket.played : 0,
      hints: bucket.hints,
      best: bucket.best,
      averageTimeMs: bucket.played ? Math.round(bucket.timeMs / bucket.played) : 0,
      distribution: bucket.distribution,
    };
  }
  return out;
}

/* Keep only the newest rounds; a browser store is not a filing cabinet. */
function prune() {
  const all = Object.values(state.runs).sort((a, b) => b.startedAt - a.startedAt);
  for (const run of all.slice(40)) delete state.runs[run.id];
}

const getRun = (id) => {
  const run = state.runs[id];
  if (!run) throw new ApiError(404, "That round has gone. Start a new one.");
  return run;
};

/* ------------------------------------------------------------------- api */

export const api = {
  me: async () => ({
    user: state.player ? { id: "local", handle: state.player.toLowerCase().replace(/[^a-z0-9_]/g, ""), display: state.player, colour: 190 } : null,
    day: dayNumber(),
    dayLabel: dayLabel(dayNumber()),
    resetsIn: msUntilReset(),
    catalogue: CATALOGUE,
    difficulties: games.travle.DIFFICULTIES,
    progress: todayProgress(),
    local: true,
  }),

  /* Signing up here is only choosing a name to put on your own record. */
  signup: async ({ display, handle }) => {
    state.player = String(display || handle || "Player").trim().slice(0, 30);
    save();
    return { user: { id: "local", handle: state.player, display: state.player, colour: 190 } };
  },
  login: async (body) => api.signup(body),
  logout: async () => { state.player = null; save(); return { ok: true }; },
  rename: async (display) => api.signup({ display }),

  play: async (game, { mode, code, difficulty } = {}) => {
    const engine = games[game];
    if (!engine) throw new ApiError(404, "No such game.");

    const kind = mode === "daily" ? "daily" : mode === "custom" ? "custom" : "unlimited";
    let run = null;

    if (kind === "daily") {
      const day = dayNumber();
      run = Object.values(state.runs).find((r) =>
        r.game === game && r.mode === "daily" && r.day === day
        && (r.difficulty || null) === (difficulty || null));
      if (!run) run = start({ game, mode: kind, day, difficulty });
    } else if (kind === "custom") {
      if (!readShared(code)) throw new ApiError(404, "That puzzle link is not one I can read.");
      run = Object.values(state.runs).find((r) => r.mode === "custom" && r.code === code);
      if (!run) run = start({ game, mode: kind, code });
    } else {
      run = start({ game, mode: kind, seed: Math.random().toString(36).slice(2), difficulty });
    }

    prune();
    save();
    return { run: view(run) };

    function start(fields) {
      const record = {
        id: newId(), ...fields,
        state: null, startedAt: Date.now(), finishedAt: null, recorded: false,
      };
      record.state = engine.create(puzzleFor(record));
      state.runs[record.id] = record;
      return record;
    }
  },

  run: async (id) => ({ run: view(getRun(id)) }),

  guess: async (id, value) => {
    const run = getRun(id);
    const result = games[run.game].guess(puzzleFor(run), run.state, value);
    if (result.ok) settle(run);
    save();
    return { result, run: view(run) };
  },

  hint: async (id, at) => {
    const run = getRun(id);
    const result = games[run.game].hint(puzzleFor(run), run.state, at);
    if (result.ok) settle(run);
    save();
    return { result, run: view(run) };
  },

  check: async (id, cells) => {
    const run = getRun(id);
    const game = games[run.game];
    if (!game.check) throw new ApiError(400, "There is nothing to check in this game.");
    const result = game.check(puzzleFor(run), run.state, cells);
    save();
    return { result, run: view(run) };
  },

  back: async (id) => {
    const run = getRun(id);
    const game = games[run.game];
    if (!game.back) throw new ApiError(400, "You cannot step back in this game.");
    const result = game.back(puzzleFor(run), run.state);
    save();
    return { result, run: view(run) };
  },

  reveal: async (id) => {
    const run = getRun(id);
    const game = games[run.game];
    if (!game.reveal) throw new ApiError(400, "This game plays to a finish.");
    game.reveal(puzzleFor(run), run.state);
    settle(run);
    save();
    return { run: view(run) };
  },

  stats: async () => {
    const per = statsFor();
    const list = Object.values(per);
    return {
      totals: {
        played: list.reduce((n, b) => n + b.played, 0),
        won: list.reduce((n, b) => n + b.won, 0),
        hints: list.reduce((n, b) => n + b.hints, 0),
        bestStreak: list.reduce((n, b) => Math.max(n, b.maxStreak), 0),
        currentStreak: list.reduce((n, b) => Math.max(n, b.streak), 0),
      },
      games: per,
      recent: state.results.slice(-40).reverse(),
    };
  },

  /*
   * There is no account system here, so there is nobody to be friends with.
   * The screens that would show them are not reachable in this build; these
   * stay so that any stray call answers rather than throws.
   */
  friends: async () => ({ friends: [], incoming: [], outgoing: [], feed: [] }),
  addFriend: async () => { throw new ApiError(400, "Friends need the full version, running on a server."); },
  respond: async () => ({ ok: true }),
  unfriend: async () => ({ ok: true }),
  leaderboard: async () => ({ rows: [], you: null }),

  /* A puzzle is its own link: nothing is stored, so nothing can be lost. */
  createPuzzle: async ({ game, title, payload }) => {
    const engine = games[game];
    if (!engine || !engine.custom) throw new ApiError(400, "That game has no puzzle builder.");

    const checked = engine.validateCustom(payload || {});
    if (!checked.ok) throw new ApiError(400, checked.errors[0], { errors: checked.errors });

    const clean = String(title || "").trim().slice(0, 60) || `${engine.name} by ${state.player || "a friend"}`;
    const code = pack({ g: game, t: clean, b: state.player || "", p: checked.payload });

    const mine = readMine();
    mine.unshift({ code, game, title: clean, createdAt: Date.now() });
    writeMine(mine.slice(0, 60));

    return { puzzle: describe(code) };
  },

  myPuzzles: async () => ({ puzzles: readMine().map((entry) => describe(entry.code, entry.createdAt)).filter(Boolean) }),
  friendPuzzles: async () => ({ puzzles: [] }),

  puzzle: async (code) => {
    const found = describe(code);
    if (!found) throw new ApiError(404, "That puzzle link is not one I can read.");
    return { puzzle: found };
  },

  deletePuzzle: async (code) => {
    writeMine(readMine().filter((entry) => entry.code !== code));
    return { ok: true };
  },
};

/* ------------------------------------------------------- puzzles I made */

const MINE_KEY = "pc:mine";

function readMine() {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || "[]"); } catch { return []; }
}

function writeMine(list) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch { /* storage refused */ }
}

/** What a puzzle looks like in a list, read back out of its own code. */
function describe(code, createdAt) {
  const found = readShared(code);
  if (!found) return null;
  const engine = games[found.g];

  return {
    code,
    game: found.g,
    gameName: engine.name,
    title: found.t,
    by: { display: found.b || "a friend", handle: found.b || "" },
    mine: false,
    createdAt: createdAt || Date.now(),
    plays: 0,
    solves: 0,
    shape: shapeOf(found),
  };
}

function shapeOf(found) {
  if (found.g === "wordle") return { letters: found.p.answer.length, note: found.p.note || "" };
  if (found.g === "connections") return { clues: found.p.groups.map((group) => group.clue) };
  if (found.g === "travle") {
    return { from: window.Engine.nameOf(found.p.start), to: window.Engine.nameOf(found.p.end) };
  }
  return {};
}
