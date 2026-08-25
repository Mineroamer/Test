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
