/*
 * Play every game to a finish.
 *
 * tests/run.js checks the joins - sessions, resuming, whether an answer leaks.
 * This checks the thing underneath all of it: that each game can actually be
 * won, and lost, from the outside, over HTTP, using only moves a player could
 * make. A game that deals a puzzle nobody can finish would pass every other
 * test in the suite.
 *
 * Run with `npm run play`.
 */
/*
 * Run in-process, the way tests/run.js does, so that the answers can be read
 * straight from the store. A peek endpoint would be the alternative, and a
 * back door into the one thing the server exists to keep is not worth having
 * for the sake of a test.
 */
const os = require("node:os");
const path = require("node:path");
process.env.DATA_FILE = path.join(os.tmpdir(), `puzzle-club-play-${process.pid}.json`);

const { server, store } = require("../server.js");
const { puzzleForRun } = require("../src/server/api.js");
const games = require("../src/server/games/index.js");

const assert = require("node:assert/strict");
const results = { passed: 0, failed: 0 };
let B = "";

const test = async (name, fn) => {
  try { await fn(); results.passed++; console.log("  ok   " + name); }
  catch (e) { results.failed++; console.log("  FAIL " + name + "\n       " + String(e.message).split("\n")[0]); }
};

function client() {
  let cookie = null;
  return async (method, url, body) => {
    const headers = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(B + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text };
  };
}

/* The answers, read from the store rather than asked for over the wire. */
function peek(id) {
  const puzzle = puzzleForRun(store, store.data.runs[id]);
  if (store.data.runs[id].game === "travle") {
    const E = games.get("travle").Engine;
    return { ...puzzle, route: E.shortestRoute(puzzle.start, puzzle.end) };
  }
  return puzzle;
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  B = `http://127.0.0.1:${server.address().port}`;

  /* The tests and the server share one process, so building a 15x15 blocks the
   * server's event loop too. When it frees up the keep-alive timer reaps the
   * sockets it was holding, and the next request on a pooled one dies with
   * ECONNRESET - a failure about running the server in here, not about it. */
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  console.log(`playing through ${B}\n`);

  const me = client();
  await me("GET", "/api/me");
  await me("POST", "/api/auth/signup", { handle: "player", password: "playing every game" });

  const start = async (game, mode = "unlimited", extra = {}) => {
    const { status, body } = await me("POST", `/api/play/${game}`, { mode, ...extra });
    assert.equal(status, 200, `${game} would not deal: ${body && body.error}`);
    return body.run;
  };
  const move = (id, value) => me("POST", `/api/runs/${id}/guess`, { value });

  /* ---------------------------------------------------------- wordle */
  await test("Wordle: win, and the answer only arrives at the end", async () => {
    const run = await start("wordle");
    const secret = peek(run.id).answer;
    const mid = await move(run.id, "crane");
    assert.equal(mid.body.run.puzzle.answer, null);
    const done = await move(run.id, secret);
    assert.equal(done.body.run.puzzle.status, "won");
    assert.equal(done.body.run.puzzle.answer, secret);
    assert.equal(done.body.run.summary.won, true);
  });

  await test("Wordle: lose after six, and see the word", async () => {
    const run = await start("wordle");
    const secret = peek(run.id).answer;
    const spend = ["zonal","crumb","digit","wharf","spilt","mucky","bevel","joker","fudge"].filter(w => w !== secret);
    let last;
    for (const w of spend) { last = await move(run.id, w); if (last.body.run.puzzle.status !== "playing") break; }
    assert.equal(last.body.run.puzzle.status, "lost");
    assert.equal(last.body.run.puzzle.answer, secret);
  });

  /* ----------------------------------------------------- connections */
  await test("Connections: solve all four groups", async () => {
    const run = await start("connections");
    const real = peek(run.id);
    let last;
    for (const g of real.groups) {
      last = await move(run.id, g.words);
      assert.equal(last.body.result.correct, true, `${g.clue} should be a group`);
    }
    assert.equal(last.body.run.puzzle.status, "won");
  });

  await test("Connections: four mistakes ends it and shows the groups", async () => {
    const run = await start("connections");
    const real = peek(run.id);
    let last;
    for (let i = 0; i < 4; i++) last = await move(run.id, real.groups.map(g => g.words[i]));
    assert.equal(last.body.run.puzzle.status, "lost");
    assert.equal(last.body.run.puzzle.groups.length, 4);
  });

  /* ------------------------------------------------------------- bee */
  await test("Spelling Bee: find every word and reach Queen Bee", async () => {
    const run = await start("bee");
    const real = peek(run.id);
    let last;
    for (const w of real.answers) last = await move(run.id, w);
    assert.equal(last.body.run.puzzle.status, "won");
    assert.equal(last.body.run.puzzle.rank.name, "Queen Bee");
    assert.equal(last.body.run.puzzle.score, real.maxScore);
  });

  /* ----------------------------------------------------------- boxed */
  await test("Letter Boxed: solve it in the two words it was built from", async () => {
    const run = await start("boxed");
    const real = peek(run.id);
    let last;
    for (const w of real.solution) {
      last = await move(run.id, w);
      assert.equal(last.body.result.ok, true, `${w}: ${last.body.result.message || ""}`);
    }
    assert.equal(last.body.run.puzzle.status, "won");
  });

  /* ------------------------------------------------------- crosswords */
  for (const game of ["mini", "crossword"]) {
    await test(`${game}: fill every square correctly`, async () => {
      const run = await start(game);
      const real = peek(run.id);
      let last;
      for (let cell = 0; cell < real.grid.length; cell++) {
        if (real.grid[cell] === "#") continue;
        last = await move(run.id, { cell, letter: real.letters[cell] });
      }
      assert.equal(last.body.run.puzzle.status, "won");
      assert.equal(last.body.run.summary.won, true);
      assert.ok(last.body.run.puzzle.answers.length > 0);
    });
  }

  /* --------------------------------------------------------- strands */
  await test("Strands: trace every theme word, spangram included", async () => {
    const run = await start("strands");
    const real = peek(run.id);
    let last;
    for (const entry of real.entries) {
      last = await move(run.id, entry.cells);
      assert.equal(last.body.result.ok, true, `${entry.word}: ${last.body.result.message || ""}`);
    }
    assert.equal(last.body.run.puzzle.status, "won");
    assert.equal(last.body.run.puzzle.found.length, real.entries.length);
  });

  /* ------------------------------------------------------------ pips */
  await test("Pips: cover the board and satisfy every rule", async () => {
    const run = await start("pips");
    const real = peek(run.id);
    let last;
    for (const home of real.layout) {
      const [a] = real.dominoes[home.domino];
      last = await move(run.id, {
        domino: home.domino,
        cells: home.cells.map(k => k.split(",").map(Number)),
        flip: home.values[0] !== a,
      });
      assert.equal(last.body.result.ok, true, `domino ${home.domino}: ${last.body.result.message || ""}`);
    }
    assert.equal(last.body.run.puzzle.status, "won");
  });

  /* ---------------------------------------------------------- travle */
  await test("Travle: walk the shortest route to the finish", async () => {
    const run = await start("travle");
    const real = peek(run.id);
    let last;
    for (const code of real.route.slice(1)) {
      last = await move(run.id, code);
      assert.equal(last.body.result.ok, true, `${code}: ${last.body.result.message || ""}`);
    }
    assert.equal(last.body.run.puzzle.status, "won");
    assert.equal(last.body.run.summary.over, 0, "the shortest route should be par");
  });

  await test("Travle: reach an island by sea", async () => {
    const made = await me("POST", "/api/puzzles", { game: "travle", payload: { start: "Australia", end: "Japan" } });
    assert.equal(made.status, 200, made.body && made.body.error);
    const play = await me("POST", "/api/play/travle", { mode: "custom", code: made.body.puzzle.code });
    const real = peek(play.body.run.id);
    let last;
    for (const code of real.route.slice(1)) last = await move(play.body.run.id, code);
    assert.equal(last.body.run.puzzle.status, "won");
  });

  /* ------------------------------------------------- every daily deals */
  await test("all nine dailies deal and resume", async () => {
    for (const game of ["wordle","connections","bee","boxed","crossword","mini","strands","pips","travle"]) {
      const first = await start(game, "daily");
      const again = await start(game, "daily");
      assert.equal(again.id, first.id, `${game}: the daily should be the same round`);
    }
  });

  /* ------------------------------------------ every game, every mode */

  /*
   * Play any round to a finish, whatever game it is.
   *
   * The per-game tests above each check one game closely. This is the other
   * question: does every game work in every mode it offers? A game can be
   * perfectly playable on its unlimited board and broken on its daily, or fine
   * dealt and broken when it arrives as somebody's shared puzzle - those are
   * different code paths, and only playing all of them says so.
   */
  async function playOut(who, run) {
    const real = peek(run.id);
    const send = (value) => who("POST", `/api/runs/${run.id}/guess`, { value });
    let last = null;

    switch (run.game) {
      case "wordle":
        last = await send(real.answer);
        break;
      case "connections":
        for (const group of real.groups) last = await send(group.words);
        break;
      case "bee":
        for (const word of real.answers) last = await send(word);
        break;
      case "boxed":
        for (const word of real.solution) last = await send(word);
        break;
      case "mini":
      case "crossword":
        for (let cell = 0; cell < real.grid.length; cell += 1) {
          if (real.grid[cell] === "#") continue;
          last = await send({ cell, letter: real.letters[cell] });
        }
        break;
      case "strands":
        for (const entry of real.entries) last = await send(entry.cells);
        break;
      case "pips":
        for (const home of real.layout) {
          const [first] = real.dominoes[home.domino];
          last = await send({
            domino: home.domino,
            cells: home.cells.map((key) => key.split(",").map(Number)),
            flip: home.values[0] !== first,
          });
        }
        break;
      case "travle":
        for (const code of real.route.slice(1)) last = await send(code);
        break;
      default:
        throw new Error("no idea how to play " + run.game);
    }

    assert.ok(last, `${run.game}: nothing was played`);
    return last.body.run;
  }

  const GAMES = ["wordle", "connections", "bee", "boxed", "mini", "crossword", "strands", "pips", "travle"];

  await test("every game can be won on its daily board", async () => {
    /* A fresh account, because a daily is one attempt and the rounds above
     * have already opened some of them. */
    const today = client();
    await today("GET", "/api/me");
    await today("POST", "/api/auth/signup", { handle: "dailyplayer", password: "one of each please" });

    for (const game of GAMES) {
      const opened = await today("POST", `/api/play/${game}`, { mode: "daily" });
      assert.equal(opened.status, 200, `${game} daily would not deal`);
      const run = await playOut(today, opened.body.run);
      assert.equal(run.puzzle.status, "won", `${game} daily could not be won`);
      assert.equal(run.summary.won, true, `${game} daily was won but not counted`);
      assert.ok(run.earned && run.earned.xp > 0, `${game} daily paid no XP`);
    }
  });

  await test("every game can be won on an unlimited board", async () => {
    const free = client();
    await free("GET", "/api/me");
    await free("POST", "/api/auth/signup", { handle: "freeplayer", password: "one of each please" });

    for (const game of GAMES) {
      const opened = await free("POST", `/api/play/${game}`, { mode: "unlimited", fresh: true });
      assert.equal(opened.status, 200, `${game} unlimited would not deal`);
      const run = await playOut(free, opened.body.run);
      assert.equal(run.puzzle.status, "won", `${game} unlimited could not be won`);
      assert.equal(run.summary.won, true, `${game} unlimited was won but not counted`);
    }
  });

  await test("Travle plays on all four of its levels", async () => {
    const walker = client();
    await walker("GET", "/api/me");
    await walker("POST", "/api/auth/signup", { handle: "walker", password: "one of each please" });

    for (const [mode, difficulty] of [
      ["daily", "scenic"], ["daily", "standard"], ["daily", "expert"], ["unlimited", "unlimited"],
    ]) {
      const opened = await walker("POST", "/api/play/travle", { mode, difficulty, fresh: true });
      assert.equal(opened.status, 200, `travle ${difficulty} would not deal`);
      assert.equal(opened.body.run.difficulty, difficulty, `travle dealt ${opened.body.run.difficulty}`);

      const run = await playOut(walker, opened.body.run);
      assert.equal(run.puzzle.status, "won", `travle ${difficulty} could not be walked`);
      assert.equal(run.summary.over, 0, `travle ${difficulty}: the shortest route should be par`);
    }

    /* And the three daily levels keep their streaks apart. */
    const record = await walker("GET", "/api/stats");
    const levels = Object.values(record.body.games).filter((b) => b.game === "travle" && b.variant);
    assert.equal(levels.length, 3, "the three daily levels should each have their own record");
  });

  await test("a shared puzzle can be built, sent and won, in every game that offers one", async () => {
    const author = client();
    const friend = client();
    await author("GET", "/api/me");
    await friend("GET", "/api/me");
    await author("POST", "/api/auth/signup", { handle: "author", password: "one of each please" });
    await friend("POST", "/api/auth/signup", { handle: "recipient", password: "one of each please" });

    const built = [
      ["wordle", { answer: "zorbo", note: "made up on purpose" }],
      ["connections", { groups: [
        { clue: "Flat fish", words: ["SOLE", "PLAICE", "TURBOT", "DAB"] },
        { clue: "Unpleasant people", words: ["HEEL", "CAD", "ROTTER", "SWINE"] },
        { clue: "Parts of a shoe", words: ["LACE", "EYELET", "INSTEP", "WELT"] },
        { clue: "Letters, spelt out", words: ["QUEUE", "ARE", "WHY", "SEA"] },
      ] }],
      ["travle", { start: "Portugal", end: "Poland", difficulty: "standard" }],
    ];

    for (const [game, payload] of built) {
      const made = await author("POST", "/api/puzzles", { game, payload, title: `A ${game}` });
      assert.equal(made.status, 200, `${game}: ${made.body && made.body.error}`);
      const code = made.body.puzzle.code;

      /* Somebody else opens the code and plays it. */
      const opened = await friend("POST", `/api/play/${game}`, { mode: "custom", code });
      assert.equal(opened.status, 200, `${game} custom would not open`);
      assert.equal(opened.body.run.custom.code, code);

      const run = await playOut(friend, opened.body.run);
      assert.equal(run.puzzle.status, "won", `${game} custom could not be won`);

      /* And the author's copy counts the play. */
      const mine = await author("GET", "/api/puzzles/mine");
      const record = mine.body.puzzles.find((one) => one.code === code);
      assert.equal(record.plays, 1, `${game}: the play was not counted`);
      assert.equal(record.solves, 1, `${game}: the solve was not counted`);
    }
  });

  await test("a daily is one attempt, and cannot be replayed by asking again", async () => {
    const once = client();
    await once("GET", "/api/me");
    await once("POST", "/api/auth/signup", { handle: "oneshot", password: "one of each please" });

    const opened = await once("POST", "/api/play/wordle", { mode: "daily" });
    const done = await playOut(once, opened.body.run);
    assert.equal(done.puzzle.status, "won");

    /* Asking again - by reload, or outright - brings back the finished round,
     * never a second go at today's word. */
    for (const body of [{ mode: "daily" }, { mode: "daily", fresh: true }]) {
      const again = await once("POST", "/api/play/wordle", body);
      assert.equal(again.body.run.id, opened.body.run.id, "the daily was dealt twice");
      assert.equal(again.body.run.puzzle.status, "won");
    }
  });

  await test("the record shows every game played", async () => {
    const { body } = await me("GET", "/api/stats");
    const played = new Set(Object.values(body.games).map(b => b.game));
    for (const game of ["wordle","connections","bee","boxed","crossword","mini","strands","pips","travle"]) {
      assert.ok(played.has(game), `${game} is missing from the record`);
    }
    assert.ok(body.totals.won >= 8, `expected wins, got ${body.totals.won}`);
  });

  await test("a full sweep of the games moves you up the pass", async () => {
    const { body } = await me("GET", "/api/pass");
    const pass = body.pass;
    const xp = require("../src/server/xp.js");

    /*
     * No magic total to assert against: most of these rounds are unlimited,
     * which is deliberately worth a third of a daily, so any number written
     * here would only be a note of what the suite happened to play. What is
     * worth holding is that the books balance - the pass, the log of awards
     * and the board must all agree, or one of them is lying.
     */
    const row = store.data.progress[Object.values(store.data.users)
      .find((u) => u.handle === "player").id];
    const logged = row.awards.reduce((n, a) => n + a.xp, 0);

    assert.ok(pass.xp > 0, "a sweep of nine games earned nothing");
    assert.equal(pass.xp, logged, "the pass and the log of awards disagree");
    assert.equal(pass.level, xp.levelFor(pass.xp), "the level does not match the XP");
    assert.ok(row.awards.length >= 9, `only ${row.awards.length} rounds were paid out`);
    assert.equal(pass.track.length, 50);
    assert.ok(pass.level >= 2, `still level ${pass.level} after playing everything`);
    assert.ok(pass.unlocked.length > 7, "levelling up should have unlocked something new");

    /* And it should be visible to everyone, which is the point of a board. */
    const board = await me("GET", "/api/leaderboard");
    const mine = board.body.rows.find((r) => r.handle === "player");
    assert.ok(mine, "the player who just swept the board is not on it");
    assert.equal(mine.xp, pass.xp);
    assert.equal(mine.level, pass.level);
  });

  console.log(`\n${results.passed} passed, ${results.failed} failed`);
  server.close();
  try { require("node:fs").unlinkSync(process.env.DATA_FILE); } catch { /* gone */ }
  process.exit(results.failed ? 1 : 0);
})().catch(e => { console.log("ERROR:", e.message); process.exit(1); });
