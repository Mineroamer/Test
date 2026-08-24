"use strict";
/*
 * Every route the browser talks to.
 *
 * Two rules shape most of what follows.
 *
 * First, the server is the referee. A round lives here, guesses are judged
 * here, and the answer is not sent until the round is over. That is what makes
 * an unlimited game worth playing rather than something you can read out of
 * the page source.
 *
 * Second, a puzzle is never stored, only its seed. A daily puzzle is a day
 * number, an unlimited one is a random seed, a shared one is its code. The
 * puzzle is recomputed from that whenever it is needed, so a saved round is a
 * few hundred bytes and can never fall out of step with the generator.
 */

const crypto = require("node:crypto");

const auth = require("./auth.js");
const limiter = require("./ratelimit.js");
const stats = require("./stats.js");
const games = require("./games/index.js");
const { Router, fail } = require("./http.js");
const { dayNumber, msUntilReset, dayLabel } = require("./rng.js");

/* Recomputing a puzzle is cheap but not free - the Spelling Bee has to solve
 * itself - so the last few stay in memory. Runs hold seeds, not puzzles, so
 * this cache is pure speed and can be dropped at any moment. */
const CACHE = new Map();
const CACHE_MAX = 200;

function cached(key, make) {
  if (CACHE.has(key)) {
    const value = CACHE.get(key);
    CACHE.delete(key);       // reinsert, so the map stays in use order
    CACHE.set(key, value);
    return value;
  }
  const value = make();
  CACHE.set(key, value);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return value;
}

/* Share codes people read aloud and type in, so no O/0 or I/1/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode(store) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = crypto.randomBytes(6);
    let code = "";
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!store.data.puzzles[code]) return code;
  }
  throw new Error("could not find a free share code");
}

/* ------------------------------------------------------------------ runs */

const owns = (run, ctx) => run.owner === (ctx.user ? ctx.user.id : "guest:" + ctx.token);

/** Rebuild the puzzle a run refers to. */
function puzzleForRun(store, run) {
  const game = games.get(run.game);
  if (!game) fail(404, "No such game.");

  if (run.mode === "custom") {
    const record = store.data.puzzles[run.code];
    if (!record) fail(404, "That puzzle no longer exists.");
    return cached(`custom:${run.code}`, () => game.fromCustom(record.payload));
  }
  if (run.mode === "daily") {
    return cached(`daily:${run.game}:${run.day}:${run.difficulty || ""}`, () =>
      games.puzzleFor(game, "daily", { day: run.day, difficulty: run.difficulty }));
  }
  return cached(`free:${run.game}:${run.seed}:${run.difficulty || ""}`, () =>
    games.puzzleFor(game, "unlimited", { seed: run.seed, difficulty: run.difficulty }));
}

/** The run as the browser sees it: state, never the puzzle's secrets. */
function runView(store, run) {
  const game = games.get(run.game);
  const puzzle = puzzleForRun(store, run);
  const custom = run.mode === "custom" ? store.data.puzzles[run.code] : null;

  return {
    id: run.id,
    game: run.game,
    gameName: game.name,
    mode: run.mode,
    day: run.day ?? null,
    dayLabel: run.day !== undefined && run.day !== null ? dayLabel(run.day) : null,
    code: run.code || null,
    difficulty: run.difficulty || null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    puzzle: game.view(puzzle, run.state),
    custom: custom
      ? { title: custom.title, code: custom.code, by: displayFor(store, custom.authorId), note: custom.payload.note || "" }
      : null,
    summary: game.finished(run.state) ? game.summary(puzzle, run.state) : null,
  };
}

const displayFor = (store, userId) => {
  const user = store.data.users[userId];
  return user ? { handle: user.handle, display: user.display, colour: user.colour } : null;
};

/**
 * Finish a round: stamp it, write it into the tallies, and count a play
 * against the shared puzzle if it was somebody else's.
 */
function settle(store, run, ctx) {
  const game = games.get(run.game);
  if (!game.finished(run.state) || run.recorded) return;

  run.finishedAt = Date.now();
  run.recorded = true;

  const puzzle = puzzleForRun(store, run);
  const summary = game.summary(puzzle, run.state);

  if (ctx.user) {
    stats.record(store, ctx.user.id, {
      game: run.game,
      mode: run.mode,
      day: run.day,
      summary,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      custom: run.code || null,
    });
  }

  if (run.mode === "custom" && store.data.puzzles[run.code]) {
    const record = store.data.puzzles[run.code];
    record.plays = (record.plays || 0) + 1;
    if (summary.won) record.solves = (record.solves || 0) + 1;
  }
  store.touch();
}

/*
 * Find the run this player already has open for a puzzle, so that reloading
 * the page continues where they were rather than starting again. It also means
 * a daily cannot be replayed by refreshing: the finished run comes back.
 */
function existingRun(store, ctx, match) {
  const owner = ctx.user ? ctx.user.id : "guest:" + ctx.token;
  const found = Object.values(store.data.runs).filter(
    (run) => run.owner === owner && Object.entries(match).every(([k, v]) => run[k] === v)
  );
  return found.sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

/* Runs are transient; keep the newest few hundred per owner and let the rest go. */
const RUNS_KEPT = 60;
function pruneRuns(store, owner) {
  const mine = Object.values(store.data.runs)
    .filter((r) => r.owner === owner)
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const run of mine.slice(RUNS_KEPT)) delete store.data.runs[run.id];
}

/* --------------------------------------------------------------- friends */

const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

const areFriends = (store, a, b) => {
  const [x, y] = pairKey(a, b);
  return store.data.friendships.some((f) => f.a === x && f.b === y);
};

const friendIdsOf = (store, userId) =>
  store.data.friendships
    .filter((f) => f.a === userId || f.b === userId)
    .map((f) => (f.a === userId ? f.b : f.a));

/* ------------------------------------------------------------------ build */

function buildApi(store) {
  const router = new Router();
  const today = () => dayNumber();

  const requireUser = (ctx) => {
    if (!ctx.user) fail(401, "Sign in to do that.");
    return ctx.user;
  };

  const getRun = (ctx, id) => {
    const run = store.data.runs[id];
    if (!run) fail(404, "That round has expired. Start a new one.");
    if (!owns(run, ctx)) fail(403, "That is not your round.");
    return run;
  };

  /* ----------------------------------------------------------- session */

  router.get("/api/me", (ctx) => ({
    user: auth.publicUser(ctx.user),
    day: today(),
    dayLabel: dayLabel(today()),
    resetsIn: msUntilReset(),
    catalogue: games.CATALOGUE,
    difficulties: games.get("travle").DIFFICULTIES,
    progress: ctx.user ? stats.todayProgress(store, ctx.user.id, today()) : {},
  }));

  router.post("/api/auth/signup", async (ctx) => {
    const { errors, handle, display } = auth.checkSignup(ctx.body);
    if (errors.length) fail(400, errors[0], { errors });
    if (auth.findByHandle(store, handle)) fail(409, "That username is taken.");

    /* Counted here rather than on the way in, so that a rejected username or
     * a too-short password costs nothing. Only accounts that get made count. */
    const slow = limiter.take("signup:" + ctx.ip, limiter.SIGN_UP);
    if (!slow.ok) fail(429, `That is a lot of new accounts from one place. Try again in ${Math.ceil(slow.retryAfter / 60)} minutes.`);

    /* Claim the name before hashing, which is the slow part and an await: two
     * people racing for the same name would otherwise both get past the check
     * above and both be written down. */
    if (!auth.claim(handle)) fail(409, "That username is taken.");

    let user;
    try {
      user = await auth.createUser(store, { handle, password: ctx.body.password, display });
    } finally {
      auth.release(handle);
    }

    /* Attach the session they already had, so a round played as a guest is
     * still open in front of them and their runs carry over. */
    const session = store.data.sessions[ctx.token];
    if (session) {
      session.userId = user.id;
      for (const run of Object.values(store.data.runs)) {
        if (run.owner === "guest:" + ctx.token) run.owner = user.id;
      }
    }
    store.touch();
    return { user: auth.publicUser(user) };
  });

  router.post("/api/auth/login", async (ctx) => {
    /*
     * Limited by source and by target. The first stops one machine working
     * through a password list; the second stops many machines working
     * through one account.
     */
    const wanted = auth.normaliseHandle(ctx.body.handle);
    const bySource = limiter.take("login:ip:" + ctx.ip, limiter.SIGN_IN_SOURCE);
    const byTarget = limiter.take("login:who:" + wanted, limiter.SIGN_IN);
    const slowest = !bySource.ok ? bySource : !byTarget.ok ? byTarget : null;

    if (slowest) {
      fail(429, `Too many attempts. Try again in ${Math.ceil(slowest.retryAfter / 60)} minutes.`);
    }

    const user = auth.findByHandle(store, ctx.body.handle);
    const ok = await auth.verify(user, String(ctx.body.password || ""));
    if (!ok) fail(401, "That username and password do not match.");

    /* Getting in clears the count, so one wrong guess before the right one
     * never counts against the next visit. */
    limiter.clear("login:ip:" + ctx.ip);
    limiter.clear("login:who:" + wanted);

    const session = store.data.sessions[ctx.token];
    if (session) session.userId = user.id;
    store.touch();
    return { user: auth.publicUser(user) };
  });

  router.post("/api/auth/logout", (ctx) => {
    auth.endSession(store, ctx.token);
    ctx.clearSession = true;
    return { ok: true };
  });

  router.patch("/api/me", (ctx) => {
    const user = requireUser(ctx);
    if (typeof ctx.body.display === "string") {
      const display = ctx.body.display.trim().slice(0, 30);
      if (!display) fail(400, "A display name cannot be empty.");
      user.display = display;
    }
    store.touch();
    return { user: auth.publicUser(user) };
  });

  /* -------------------------------------------------------------- play */

  router.post("/api/play/:game", (ctx) => {
    const game = games.get(ctx.params.game);
    if (!game) fail(404, "No such game.");

    const mode = ctx.body.mode === "daily" ? "daily" : ctx.body.mode === "custom" ? "custom" : "unlimited";
    const owner = ctx.user ? ctx.user.id : "guest:" + ctx.token;
    const difficulty = game.key === "travle" && ctx.body.difficulty
      ? String(ctx.body.difficulty) : undefined;

    let run;
    if (mode === "daily") {
      const day = today();
      run = existingRun(store, ctx, { game: game.key, mode: "daily", day, difficulty: difficulty ?? undefined });
      if (!run) {
        run = newRun({ game: game.key, mode, owner, day, difficulty });
      }
    } else if (mode === "custom") {
      const code = String(ctx.body.code || "").trim().toUpperCase();
      const record = store.data.puzzles[code];
      if (!record) fail(404, "No puzzle has that code.");
      if (record.game !== game.key) fail(400, "That code is for a different game.");

      /* A shared puzzle is a one-off, like a daily: your attempt at it stands. */
      run = existingRun(store, ctx, { game: game.key, mode: "custom", code });
      if (!run) run = newRun({ game: game.key, mode, owner, code, difficulty: record.payload.difficulty });
    } else {
      /* A fresh seed each time is exactly what "unlimited" means. */
      run = newRun({
        game: game.key,
        mode,
        owner,
        seed: crypto.randomBytes(8).toString("hex"),
        difficulty,
      });
    }

    pruneRuns(store, owner);
    store.touch();
    return { run: runView(store, run) };

    function newRun(fields) {
      const id = auth.newId("r");
      const puzzle = puzzleForRun(store, { ...fields, state: null });
      const record = {
        id,
        ...fields,
        state: game.create(puzzle),
        startedAt: Date.now(),
        finishedAt: null,
        recorded: false,
      };
      store.data.runs[id] = record;
      return record;
    }
  });

  router.get("/api/runs/:id", (ctx) => ({ run: runView(store, getRun(ctx, ctx.params.id)) }));

  router.post("/api/runs/:id/guess", (ctx) => {
    const run = getRun(ctx, ctx.params.id);
    const game = games.get(run.game);
    const puzzle = puzzleForRun(store, run);

    const result = game.guess(puzzle, run.state, ctx.body.value);
    if (result.ok) settle(store, run, ctx);
    store.touch();

    return { result, run: runView(store, run) };
  });

  router.post("/api/runs/:id/hint", (ctx) => {
    const run = getRun(ctx, ctx.params.id);
    const game = games.get(run.game);
    const puzzle = puzzleForRun(store, run);

    /* A crossword hint fills in a square, so the browser says which one it is
     * looking at; every other game ignores the extra argument. */
    const result = game.hint(puzzle, run.state, ctx.body.at);
    if (result.ok) settle(store, run, ctx);
    store.touch();
    return { result, run: runView(store, run) };
  });

  /*
   * Crossword only: mark the letters already written that are wrong, without
   * saying what the right ones are.
   */
  router.post("/api/runs/:id/check", (ctx) => {
    const run = getRun(ctx, ctx.params.id);
    const game = games.get(run.game);
    if (!game.check) fail(400, "There is nothing to check in this game.");

    const result = game.check(puzzleForRun(store, run), run.state, ctx.body.cells);
    store.touch();
    return { result, run: runView(store, run) };
  });

  /* Travle only: undo the step you are standing on. */
  router.post("/api/runs/:id/back", (ctx) => {
    const run = getRun(ctx, ctx.params.id);
    const game = games.get(run.game);
    if (!game.back) fail(400, "You cannot step back in this game.");

    const result = game.back(puzzleForRun(store, run), run.state);
    store.touch();
    return { result, run: runView(store, run) };
  });

  /* Give up on an open-ended round and see what was there. */
  router.post("/api/runs/:id/reveal", (ctx) => {
    const run = getRun(ctx, ctx.params.id);
    const game = games.get(run.game);
    if (!game.reveal) fail(400, "This game plays to a finish.");

    game.reveal(puzzleForRun(store, run), run.state);
    settle(store, run, ctx);
    store.touch();
    return { run: runView(store, run) };
  });

  /* ------------------------------------------------------------- stats */

  router.get("/api/stats", (ctx) => {
    const user = requireUser(ctx);
    return {
      totals: stats.totals(store, user.id, today()),
      games: stats.forUser(store, user.id, today()),
      recent: stats.recent(store, [user.id], 40),
    };
  });

  /* ----------------------------------------------------------- friends */

  router.get("/api/friends", (ctx) => {
    const user = requireUser(ctx);
    const ids = friendIdsOf(store, user.id);

    const friends = ids.map((id) => {
      const totals = stats.totals(store, id, today());
      return {
        ...auth.publicUser(store.data.users[id]),
        totals,
        today: stats.todayProgress(store, id, today()),
      };
    }).sort((a, b) => b.totals.played - a.totals.played);

    return {
      friends,
      incoming: store.data.requests
        .filter((r) => r.to === user.id)
        .map((r) => ({ id: r.id, from: auth.publicUser(store.data.users[r.from]), at: r.createdAt })),
      outgoing: store.data.requests
        .filter((r) => r.from === user.id)
        .map((r) => ({ id: r.id, to: auth.publicUser(store.data.users[r.to]), at: r.createdAt })),
      feed: stats.recent(store, ids, 30).map((entry) => ({
        ...entry,
        who: displayFor(store, entry.userId),
        gameName: games.get(entry.game) ? games.get(entry.game).name : entry.game,
      })),
    };
  });

  router.post("/api/friends/request", (ctx) => {
    const user = requireUser(ctx);
    const target = auth.findByHandle(store, ctx.body.handle);

    if (!target) fail(404, "Nobody here goes by that name.");
    if (target.id === user.id) fail(400, "You are already your own best audience.");
    if (areFriends(store, user.id, target.id)) fail(409, "You are already friends.");

    const already = store.data.requests.find((r) => r.from === user.id && r.to === target.id);
    if (already) fail(409, "You have already asked.");

    /* If they asked first, taking the same step just means yes. */
    const mutual = store.data.requests.find((r) => r.from === target.id && r.to === user.id);
    if (mutual) {
      accept(mutual);
      return { friended: auth.publicUser(target) };
    }

    store.data.requests.push({
      id: auth.newId("fr"),
      from: user.id,
      to: target.id,
      createdAt: Date.now(),
    });
    store.touch();
    return { requested: auth.publicUser(target) };
  });

  router.post("/api/friends/respond", (ctx) => {
    const user = requireUser(ctx);
    const request = store.data.requests.find((r) => r.id === ctx.body.id);

    if (!request) fail(404, "That request is no longer there.");
    if (request.to !== user.id) fail(403, "That request was not sent to you.");

    if (ctx.body.accept) {
      accept(request);
      return { accepted: auth.publicUser(store.data.users[request.from]) };
    }
    store.data.requests = store.data.requests.filter((r) => r.id !== request.id);
    store.touch();
    return { declined: true };
  });

  router.delete("/api/friends/:id", (ctx) => {
    const user = requireUser(ctx);
    const [a, b] = pairKey(user.id, ctx.params.id);
    store.data.friendships = store.data.friendships.filter((f) => !(f.a === a && f.b === b));
    store.touch();
    return { ok: true };
  });

  function accept(request) {
    const [a, b] = pairKey(request.from, request.to);
    if (!areFriends(store, a, b)) store.data.friendships.push({ a, b, since: Date.now() });
    store.data.requests = store.data.requests.filter((r) => r.id !== request.id);
    store.touch();
  }

  /*
   * The board everyone actually argues about. Ranked on daily wins, because
   * unlimited play would just reward whoever had the most spare time.
   */
  router.get("/api/friends/leaderboard", (ctx) => {
    const user = requireUser(ctx);
    const ids = [user.id, ...friendIdsOf(store, user.id)];

    const rows = ids.map((id) => {
      const per = stats.forUser(store, id, today());
      const daily = Object.values(per).filter((b) => b.mode === "daily");
      const done = stats.todayProgress(store, id, today());
      return {
        user: auth.publicUser(store.data.users[id]),
        wins: daily.reduce((n, b) => n + b.won, 0),
        played: daily.reduce((n, b) => n + b.played, 0),
        streak: daily.reduce((n, b) => Math.max(n, b.streak), 0),
        hints: daily.reduce((n, b) => n + b.hints, 0),
        todayDone: Object.keys(done).length,
        todayWon: Object.values(done).filter((d) => d.won).length,
      };
    });

    rows.sort((a, b) => b.wins - a.wins || b.streak - a.streak || a.hints - b.hints);
    return { rows, you: user.id };
  });

  /* ----------------------------------------------------- custom puzzles */

  router.post("/api/puzzles", (ctx) => {
    const user = requireUser(ctx);
    const game = games.get(ctx.body.game);

    if (!game) fail(404, "No such game.");
    if (!game.custom) fail(400, `${game.name} puzzles cannot be built by hand.`);

    const checked = game.validateCustom(ctx.body.payload || {});
    if (!checked.ok) fail(400, checked.errors[0], { errors: checked.errors });

    const mine = Object.values(store.data.puzzles).filter((p) => p.authorId === user.id);
    if (mine.length >= 100) fail(409, "That is a hundred puzzles. Delete one before making another.");

    const code = makeCode(store);
    store.data.puzzles[code] = {
      code,
      game: game.key,
      authorId: user.id,
      title: String(ctx.body.title || "").trim().slice(0, 60) || `${game.name} by ${user.display}`,
      payload: checked.payload,
      createdAt: Date.now(),
      plays: 0,
      solves: 0,
    };
    store.touch();
    return { puzzle: publicPuzzle(store.data.puzzles[code]) };
  });

  router.get("/api/puzzles/mine", (ctx) => {
    const user = requireUser(ctx);
    const mine = Object.values(store.data.puzzles)
      .filter((p) => p.authorId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { puzzles: mine.map((p) => publicPuzzle(p)) };
  });

  /*
   * Friends' puzzles, so a shared code is a convenience rather than the only
   * way in. Nothing here reveals an answer - just what the puzzle is and who
   * made it.
   */
  router.get("/api/puzzles/friends", (ctx) => {
    const user = requireUser(ctx);
    const ids = new Set(friendIdsOf(store, user.id));
    const list = Object.values(store.data.puzzles)
      .filter((p) => ids.has(p.authorId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60);
    return { puzzles: list.map((p) => publicPuzzle(p)) };
  });

  router.get("/api/puzzles/:code", (ctx) => {
    const record = store.data.puzzles[String(ctx.params.code).toUpperCase()];
    if (!record) fail(404, "No puzzle has that code.");
    return { puzzle: publicPuzzle(record) };
  });

  router.delete("/api/puzzles/:code", (ctx) => {
    const user = requireUser(ctx);
    const record = store.data.puzzles[String(ctx.params.code).toUpperCase()];

    if (!record) fail(404, "No puzzle has that code.");
    if (record.authorId !== user.id) fail(403, "That is not your puzzle.");

    delete store.data.puzzles[record.code];
    store.touch();
    return { ok: true };
  });

  function publicPuzzle(record) {
    const game = games.get(record.game);
    return {
      code: record.code,
      game: record.game,
      gameName: game ? game.name : record.game,
      title: record.title,
      by: displayFor(store, record.authorId),
      mine: false,
      createdAt: record.createdAt,
      plays: record.plays || 0,
      solves: record.solves || 0,
      /* Enough to preview it in a list without giving anything away. */
      shape: shapeOf(record),
    };
  }

  function shapeOf(record) {
    if (record.game === "wordle") return { letters: record.payload.answer.length, note: record.payload.note || "" };
    if (record.game === "connections") return { clues: record.payload.groups.map((g) => g.clue) };
    if (record.game === "travle") {
      const E = games.get("travle").Engine;
      return { from: E.nameOf(record.payload.start), to: E.nameOf(record.payload.end) };
    }
    return {};
  }

  return router;
}

module.exports = { buildApi, puzzleForRun, runView, areFriends, friendIdsOf };
