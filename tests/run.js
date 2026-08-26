"use strict";
/*
 * End-to-end tests.
 *
 * These drive the real HTTP server against a throwaway store, because the
 * things most likely to break are not the puzzle generators - those are
 * deterministic and easy - but the joins between them: sessions, resuming a
 * round, whether an answer leaks before the round is over, whether a finished
 * round can be counted twice.
 *
 * Run with `npm test`.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const STORE = path.join(os.tmpdir(), `puzzle-club-test-${process.pid}.json`);
process.env.DATA_FILE = STORE;

const { server, store } = require("../server.js");
const games = require("../src/server/games/index.js");
const xpRules = require("../src/server/xp.js");
const cosmeticTrack = require("../src/server/cosmetics.js");
const achievementList = require("../src/server/achievements.js");
const { puzzleForRun } = require("../src/server/api.js");

let base = "";
const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split("\n").slice(0, 6).join("\n       ")}`);
  }
}

/** A browser-shaped client: keeps its own cookie, so tests can have several. */
function client() {
  let cookie = null;
  return async function call(method, url, body) {
    const headers = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;

    let res;
    try {
      res = await fetch(base + url, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      console.log("       [client] " + (err.cause ? err.cause.code || err.cause.message : err.message));
      throw err;
    }
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* left null, so a bad body fails loudly */ }
    return { status: res.status, body: json, text };
  };
}

/* Peeking at the answer from inside the process is how a test can play a
 * winning move; nothing the browser is given would let it do this. */
const answerTo = (runId) => puzzleForRun(store, store.data.runs[runId]);

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  /*
   * The tests and the server share one process, so a test that spends several
   * seconds in a generator blocks the server's event loop as surely as it
   * blocks its own. When the loop frees up, the keep-alive timer reaps the
   * idle sockets it was holding and the next request on a pooled one dies with
   * ECONNRESET - a failure that says nothing about the server and everything
   * about running it in here. Neither timer earns its keep against a client
   * that is this file.
   */
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  console.log(`testing against ${base}\n`);

  /* ------------------------------------------------------------ session */

  console.log("session and accounts");
  const alice = client();

  await test("a visitor with no account can ask what today is", async () => {
    const { status, body } = await alice("GET", "/api/me");
    assert.equal(status, 200);
    assert.equal(body.user, null);
    assert.equal(typeof body.day, "number");
    /* Named rather than counted, so adding a game does not fail this. */
    const offered = body.catalogue.map((entry) => entry.key).sort();
    assert.deepEqual(offered,
      ["bee", "boxed", "connections", "crossword", "mini", "pips", "strands", "travle", "wordle"]);
  });

  await test("signup rejects a short password", async () => {
    const { status, body } = await alice("POST", "/api/auth/signup", { handle: "alice", password: "short" });
    assert.equal(status, 400);
    assert.match(body.error, /at least 8/);
  });

  await test("signup rejects a handle with spaces", async () => {
    const { status } = await alice("POST", "/api/auth/signup", { handle: "not a handle", password: "correct horse" });
    assert.equal(status, 400);
  });

  await test("signup works and signs you in", async () => {
    const { status, body } = await alice("POST", "/api/auth/signup", {
      handle: "alice", password: "correct horse", display: "Alice",
    });
    assert.equal(status, 200);
    assert.equal(body.user.handle, "alice");
    assert.equal(body.user.display, "Alice");
    assert.equal(body.user.passwordHash, undefined, "password hash must never be sent");
    const me = await alice("GET", "/api/me");
    assert.equal(me.body.user.handle, "alice");
  });

  await test("a handle cannot be taken twice, whatever the case", async () => {
    const other = client();
    await other("GET", "/api/me");
    const { status } = await other("POST", "/api/auth/signup", { handle: "ALICE", password: "correct horse" });
    assert.equal(status, 409);
  });

  await test("racing signups cannot both take one username", async () => {
    /* Hashing a password is an await, so without a reservation both requests
     * pass the "is it taken?" check and both get written down - and the second
     * account can then never sign in. */
    const attempt = async (i) => {
      const who = client();
      await who("GET", "/api/me");
      const { status } = await who("POST", "/api/auth/signup", {
        handle: "raced", password: "a long enough password", display: "Racer " + i,
      });
      return status;
    };

    const results = await Promise.all([0, 1, 2, 3, 4].map(attempt));
    assert.equal(results.filter((status) => status === 200).length, 1, "exactly one should win");
    assert.equal(results.filter((status) => status === 409).length, 4, "the rest are told it is taken");

    const holders = Object.values(store.data.users).filter((user) => user.handle === "raced");
    assert.equal(holders.length, 1, "and only one account exists");

    const back = client();
    await back("GET", "/api/me");
    const { status } = await back("POST", "/api/auth/login", { handle: "raced", password: "a long enough password" });
    assert.equal(status, 200, "the account that won can sign in");
  });

  await test("login refuses the wrong password", async () => {
    const other = client();
    await other("GET", "/api/me");
    const { status } = await other("POST", "/api/auth/login", { handle: "alice", password: "wrong password" });
    assert.equal(status, 401);
  });

  await test("logout ends the session", async () => {
    const temp = client();
    await temp("GET", "/api/me");
    await temp("POST", "/api/auth/login", { handle: "alice", password: "correct horse" });
    await temp("POST", "/api/auth/logout");
    const me = await temp("GET", "/api/me");
    assert.equal(me.body.user, null);
  });

  await test("guessing a password gets throttled", async () => {
    const attacker = client();
    await attacker("GET", "/api/me");

    let blocked = null;
    /* The limiter allows ten in a quarter of an hour; the eleventh should be
     * refused, and refused without saying whether the account exists. */
    for (let i = 0; i < 14 && !blocked; i++) {
      const { status, body } = await attacker("POST", "/api/auth/login", {
        handle: "throttle_me", password: "guess number " + i,
      });
      if (status === 429) blocked = body;
    }
    assert.ok(blocked, "should stop letting attempts through");
    assert.match(blocked.error, /Try again in/);

    /* And the wall is around that account, not the whole server. */
    const bystander = client();
    await bystander("GET", "/api/me");
    const { status } = await bystander("POST", "/api/auth/login", {
      handle: "someone_else", password: "no",
    });
    assert.notEqual(status, 429, "a different account should still be reachable");
  });

  await test("stats need an account", async () => {
    const guest = client();
    await guest("GET", "/api/me");
    assert.equal((await guest("GET", "/api/stats")).status, 401);
  });

  /* -------------------------------------------------------------- play */

  /* ------------------------------------------------- one daily for everyone */

  console.log("\ntoday's puzzles");

  await test("the day turns over at midnight UTC, exactly", async () => {
    const { dayNumber, msUntilReset, startOfDay, dayLabel } = require("../src/server/rng.js");

    const justBefore = new Date("2026-08-25T23:59:59.999Z");
    const justAfter = new Date("2026-08-26T00:00:00.000Z");
    assert.equal(dayNumber(justAfter), dayNumber(justBefore) + 1, "one day apart across the line");
    assert.equal(dayLabel(dayNumber(justBefore)), "2026-08-25");
    assert.equal(dayLabel(dayNumber(justAfter)), "2026-08-26");

    /* Noon and one second later are the same day. */
    assert.equal(dayNumber(new Date("2026-08-25T12:00:00Z")), dayNumber(justBefore));

    assert.equal(msUntilReset(justBefore), 1, "a millisecond left on the clock");
    assert.equal(msUntilReset(justAfter), 86400000, "a whole day on the new one");
    assert.equal(startOfDay(justBefore), Date.parse("2026-08-25T00:00:00Z"));
  });

  await test("the same moment is the same day in every timezone", async () => {
    /*
     * The day number is the puzzle. Read off a local clock it differs by
     * timezone, which is invisible while a server does the counting and
     * quietly wrong in the single-page build, where each visitor's own browser
     * counts. Node fixes its zone at startup, so each one is asked in its own
     * process.
     */
    const zones = [
      "UTC", "Australia/Sydney", "America/Los_Angeles", "Asia/Tokyo",
      "Europe/London", "Pacific/Kiritimati", "Pacific/Niue", "Asia/Kathmandu",
    ];
    const script = `
      const { dayNumber } = require(${JSON.stringify(path.join(__dirname, "..", "src", "server", "rng.js"))});
      const games = require(${JSON.stringify(path.join(__dirname, "..", "src", "server", "games", "index.js"))});
      const day = dayNumber(new Date(process.argv[1]));
      const wordle = games.get("wordle").dailyPuzzle(day).answer;
      const bee = games.get("bee").dailyPuzzle(day).letters;
      process.stdout.write(JSON.stringify({ day, wordle, bee }));
    `;

    /* An instant late in the UTC day, when local dates disagree most. */
    const instant = "2026-08-25T22:30:00Z";
    const answers = zones.map((tz) =>
      execFileSync(process.execPath, ["-e", script, instant], {
        env: { ...process.env, TZ: tz }, encoding: "utf8",
      }));

    for (const answer of answers) {
      assert.equal(answer, answers[0], "every timezone must deal the same puzzle");
    }
    assert.ok(JSON.parse(answers[0]).wordle, "and an actual puzzle, not nothing");
  });

  await test("two players get the identical daily, in every game", async () => {
    /* The real question behind all of the above: can two people compare? */
    const one = client();
    const two = client();
    await one("GET", "/api/me");
    await two("GET", "/api/me");
    await one("POST", "/api/auth/signup", { handle: "sameday1", password: "one puzzle a day" });
    await two("POST", "/api/auth/signup", { handle: "sameday2", password: "one puzzle a day" });

    for (const key of ["wordle", "connections", "bee", "boxed", "mini", "crossword", "strands", "pips"]) {
      const a = await one("POST", `/api/play/${key}`, { mode: "daily" });
      const b = await two("POST", `/api/play/${key}`, { mode: "daily" });

      assert.notEqual(a.body.run.id, b.body.run.id, `${key}: two people, two rounds`);
      assert.equal(a.body.run.day, b.body.run.day, `${key}: same day number`);
      assert.equal(a.body.run.dayLabel, b.body.run.dayLabel, `${key}: same date`);

      /* Same puzzle, judged by what the server computes for each of them. */
      const mine = answerTo(a.body.run.id);
      const theirs = answerTo(b.body.run.id);
      assert.deepEqual(
        JSON.parse(JSON.stringify(mine)),
        JSON.parse(JSON.stringify(theirs)),
        `${key}: the two dailies are not the same puzzle`
      );
    }
  });

  await test("Travle's three daily levels are each the same for everyone", async () => {
    const one = client();
    const two = client();
    await one("GET", "/api/me");
    await two("GET", "/api/me");

    const seen = new Set();
    for (const difficulty of ["scenic", "standard", "expert"]) {
      const a = await one("POST", "/api/play/travle", { mode: "daily", difficulty });
      const b = await two("POST", "/api/play/travle", { mode: "daily", difficulty });

      const mine = answerTo(a.body.run.id);
      const theirs = answerTo(b.body.run.id);
      assert.equal(mine.start, theirs.start, `${difficulty}: different starting country`);
      assert.equal(mine.end, theirs.end, `${difficulty}: different destination`);
      seen.add(`${mine.start}>${mine.end}`);
    }
    /* And the three levels are three different walks, not one walk thrice. */
    assert.equal(seen.size, 3, "the daily levels should be different routes");
  });

  await test("a puzzle is built from its seed alone, never from the clock", async () => {
    /*
     * A round stores a seed, not a puzzle - the board is rebuilt from that
     * whenever it is needed. So a generator that gives up on a deadline is
     * not just slow, it is wrong: on a busy machine it stops sooner and comes
     * back with a different grid. That handed two people different "daily"
     * crosswords, and could bring a player's own letters - stored by square
     * number - back on a grid they were never typed into.
     */
    const fs = require("node:fs");
    for (const file of ["crossword.js", "pips.js", "strands.js"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "src", "server", file), "utf8");
      const clock = source.match(/Date\.now\(\)|performance\.now\(\)|new Date\(\)/g);
      assert.equal(clock, null, `${file} consults the clock while building: ${clock}`);
    }

    /* And the proof of it: build the same thing twice. */
    for (const key of ["mini", "crossword", "strands", "pips"]) {
      const game = games.get(key);
      const first = JSON.stringify(game.dailyPuzzle(1234));
      const second = JSON.stringify(game.dailyPuzzle(1234));
      assert.equal(first, second, `${key} built differently the second time`);
    }
  });

  await test("every puzzle's own answer actually answers it", async () => {
    /*
     * The generators all work backwards from an answer and then describe it -
     * as rules, as clues, as a route. Nothing checks that description against
     * the answer unless something like this does.
     *
     * Pips got this wrong: a region holding a single zero could be described
     * as "adds up to more than 0", which its own answer breaks. The board was
     * still solvable another way, so the uniqueness check passed it, and what
     * broke was the answer kept for hints and for giving up - on about one
     * board in twenty-five, following the hints walked you somewhere that
     * could never be finished.
     */
    const pips = require("../src/server/pips.js");
    const pipsGame = games.get("pips");

    for (let seed = 0; seed < 60; seed += 1) {
      const puzzle = pipsGame.randomPuzzle("answers-itself:" + seed);
      const value = new Map();
      for (const home of puzzle.layout) {
        value.set(home.cells[0], home.values[0]);
        value.set(home.cells[1], home.values[1]);
      }
      for (const region of puzzle.regions) {
        const numbers = region.cells.map((key) => value.get(key));
        assert.ok(pips.holds(region.rule, numbers, 0),
          `pips ${seed}: ${JSON.stringify(region.rule)} is broken by ${JSON.stringify(numbers)}`);
      }

      /* And laying that answer out really does win the round. */
      const state = pipsGame.create(puzzle);
      for (const home of puzzle.layout) {
        const [first] = puzzle.dominoes[home.domino];
        pipsGame.guess(puzzle, state, {
          domino: home.domino,
          cells: home.cells.map((key) => key.split(",").map(Number)),
          flip: home.values[0] !== first,
        });
      }
      assert.equal(state.status, "won", `pips ${seed}: its own answer does not win`);
    }

    /* Letter Boxed keeps the two words it was built from; they must solve it. */
    const boxed = games.get("boxed");
    for (let seed = 0; seed < 40; seed += 1) {
      const puzzle = boxed.randomPuzzle("answers-itself:" + seed);
      const state = boxed.create(puzzle);
      for (const word of puzzle.solution) {
        const result = boxed.guess(puzzle, state, word);
        assert.equal(result.ok, true, `boxed ${seed}: ${word} was refused - ${result.message}`);
      }
      assert.equal(state.status, "won", `boxed ${seed}: its own solution does not solve it`);
    }

    /* Strands: every theme word must trace along the path it was laid on. */
    const strands = games.get("strands");
    for (let seed = 0; seed < 30; seed += 1) {
      const puzzle = strands.randomPuzzle("answers-itself:" + seed);
      const state = strands.create(puzzle);
      for (const entry of puzzle.entries) {
        const result = strands.guess(puzzle, state, entry.cells);
        assert.equal(result.ok, true, `strands ${seed}: ${entry.word} was refused`);
      }
      assert.equal(state.status, "won", `strands ${seed}: its own words do not finish it`);
    }
  });

  await test("every game deals a daily, day after day", async () => {
    /*
     * A daily that cannot be built is not a bad puzzle, it is an error page
     * for everybody, all day. Pips used to leave about one day in seven
     * hundred and fifty with nothing at all - day 999 was one of them.
     */
    const quick = ["wordle", "connections", "bee", "boxed", "strands", "pips", "mini"];
    for (let day = 995; day < 1005; day += 1) {
      for (const key of quick) {
        assert.doesNotThrow(() => games.get(key).dailyPuzzle(day), `${key} could not deal day ${day}`);
      }
      for (const level of ["scenic", "standard", "expert"]) {
        assert.doesNotThrow(() => games.get("travle").dailyPuzzle(day, level),
          `travle ${level} could not deal day ${day}`);
      }
    }
  });

  await test("today's puzzle is today's, whatever hour it is asked for", async () => {
    /* A puzzle dealt at one minute past midnight and one at half past eleven
     * are the same puzzle: the generator sees a day, not a clock. */
    const { dayNumber } = require("../src/server/rng.js");
    const early = dayNumber(new Date("2026-08-25T00:00:01Z"));
    const late = dayNumber(new Date("2026-08-25T23:59:00Z"));
    assert.equal(early, late);

    for (const key of ["wordle", "connections", "bee", "boxed", "strands", "pips", "mini", "crossword"]) {
      const game = games.get(key);
      const first = JSON.stringify(game.dailyPuzzle(early));
      const second = JSON.stringify(game.dailyPuzzle(late));
      assert.equal(first, second, `${key} deals differently within one day`);
    }
  });

  console.log("\nplaying");

  await test("every game deals both a daily and an unlimited round", async () => {
    for (const key of Object.keys(games.GAMES)) {
      for (const mode of ["daily", "unlimited"]) {
        const { status, body } = await alice("POST", `/api/play/${key}`, { mode });
        assert.equal(status, 200, `${key} ${mode} returned ${status}`);
        assert.equal(body.run.game, key);
        assert.equal(body.run.mode, mode);
        assert.equal(body.run.puzzle.status, "playing");
      }
    }
  });

  await test("an unknown game is a 404", async () => {
    assert.equal((await alice("POST", "/api/play/sudoku", { mode: "daily" })).status, 404);
  });

  await test("the daily round resumes rather than restarting", async () => {
    const first = await alice("POST", "/api/play/wordle", { mode: "daily" });
    await alice("POST", `/api/runs/${first.body.run.id}/guess`, { value: "crane" });
    const second = await alice("POST", "/api/play/wordle", { mode: "daily" });
    assert.equal(second.body.run.id, first.body.run.id, "same run comes back");
    assert.equal(second.body.run.puzzle.guesses.length, 1, "the guess is still there");
  });

  await test("unlimited deals a new round when asked, and resumes when not", async () => {
    /*
     * "Unlimited" means a new puzzle whenever you ask for one - and opening
     * the page is not asking for one. This used to mint a fresh round on every
     * call, so reloading the tab silently abandoned the round in progress: on
     * a 15x15 crossword, twenty minutes of somebody's work gone because they
     * turned their phone over.
     */
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
      seen.add(body.run.id);
    }
    assert.equal(seen.size, 5, "asking outright should deal a new one each time");

    const opened = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await alice("POST", `/api/runs/${opened.body.run.id}/guess`, { value: "crane" });

    const reloaded = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    assert.equal(reloaded.body.run.id, opened.body.run.id, "a reload should come back to the same round");
    assert.equal(reloaded.body.run.puzzle.guesses.length, 1, "with the guess still in it");
  });

  await test("a finished unlimited round is not resumed", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const answer = answerTo(body.run.id).answer;
    const done = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: answer });
    assert.equal(done.body.run.puzzle.status, "won");

    const next = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    assert.notEqual(next.body.run.id, body.run.id, "a round that is over should not come back");
  });

  await test("the answer is withheld until the round is over", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    assert.equal(body.run.puzzle.answer, null);
    const guess = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "crane" });
    assert.equal(guess.body.run.puzzle.answer, null, "still hidden mid-round");
    assert.equal(guess.body.result.ok, true);
    assert.equal(guess.body.result.marks.length, 5);
  });

  await test("a word outside the list is refused and costs nothing", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const { body: guess } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "zzzzz" });
    assert.equal(guess.result.ok, false);
    assert.equal(guess.run.puzzle.guesses.length, 0);
  });

  await test("running out of guesses reveals the answer, and only then", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const id = body.run.id;
    const answer = answerTo(id).answer;
    const spend = ["zonal", "crumb", "digit", "wharf", "spilt", "mucky", "bevel", "joker"]
      .filter((w) => w !== answer);

    let last = null;
    for (const word of spend) {
      const { body: step } = await alice("POST", `/api/runs/${id}/guess`, { value: word });
      last = step;
      if (step.run.puzzle.status !== "playing") break;
    }
    assert.equal(last.run.puzzle.status, "lost");
    assert.equal(last.run.puzzle.answer, answer, "answer arrives at the end");
  });

  await test("a hint is recorded against the round", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const { body: hinted } = await alice("POST", `/api/runs/${body.run.id}/hint`);
    assert.equal(hinted.result.ok, true);
    assert.equal(hinted.run.puzzle.hints.length, 1);
    assert.equal(typeof hinted.result.hint.letter, "string");
  });

  await test("every connections board is well formed", async () => {
    /* The boards are hand-written, so what a test can protect is their shape:
     * a board whose word appears in two of its own groups has two right
     * answers, and a clue that contains one of its own answers gives it away.
     * Both are easy to do by accident when editing content. */
    const { BOARDS } = games.get("connections");
    assert.ok(BOARDS.length >= 20, "the library should be worth cycling");

    BOARDS.forEach((board, index) => {
      const where = `board ${index}`;
      const words = board.groups.flatMap((group) => group.words);

      assert.equal(board.groups.length, 4, `${where}: needs four groups`);
      assert.equal(words.length, 16, `${where}: needs sixteen words`);
      assert.equal(new Set(words).size, 16, `${where}: a word appears twice`);
      assert.deepEqual(board.groups.map((g) => g.level), [0, 1, 2, 3],
        `${where}: levels should run easiest to hardest`);
      assert.ok(board.trap, `${where}: should say what the misdirection is`);

      for (const group of board.groups) {
        assert.ok(group.clue, `${where}: a group has no clue`);
        for (const word of group.words) {
          assert.equal(group.clue.toUpperCase().includes(word), false,
            `${where}: the clue "${group.clue}" contains its own answer ${word}`);
        }
      }
    });
  });

  await test("connections reports a near miss", async () => {
    const { body } = await alice("POST", "/api/play/connections", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    const near = [...puzzle.groups[0].words.slice(0, 3), puzzle.groups[1].words[0]];

    const { body: tried } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: near });
    assert.equal(tried.result.correct, false);
    assert.equal(tried.result.oneAway, true);

    const { body: right } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: puzzle.groups[0].words });
    assert.equal(right.result.correct, true);
    assert.equal(right.run.puzzle.solved.length, 1);
  });

  await test("connections ends after four mistakes", async () => {
    const { body } = await alice("POST", "/api/play/connections", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    let last = null;
    /* Four different wrong picks, one from each group each time. */
    for (let i = 0; i < 4; i++) {
      const wrong = puzzle.groups.map((g) => g.words[i]);
      last = (await alice("POST", `/api/runs/${body.run.id}/guess`, { value: wrong })).body;
    }
    assert.equal(last.run.puzzle.status, "lost");
    assert.equal(last.run.puzzle.groups.length, 4, "all four groups are shown at the end");
  });

  await test("travle walks a route and can step back", async () => {
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    const route = games.get("travle").Engine.shortestRoute(puzzle.start, puzzle.end);

    const step = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: route[1] });
    assert.equal(step.body.result.ok, true);
    assert.equal(step.body.run.puzzle.trail.length, 2);

    const back = await alice("POST", `/api/runs/${body.run.id}/back`);
    assert.equal(back.body.result.ok, true);
    assert.equal(back.body.run.puzzle.trail.length, 1);
  });

  await test("travle names a country by any of its aliases", async () => {
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited", fresh: true });
    const { body: nonsense } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "Narnia" });
    assert.equal(nonsense.result.ok, false);
    assert.match(nonsense.result.message, /No country/);
  });

  await test("letter boxed accepts its own solution", async () => {
    const { body } = await alice("POST", "/api/play/boxed", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    for (const word of puzzle.solution) {
      const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: word });
      assert.equal(played.result.ok, true, `${word} should be playable: ${played.result.message || ""}`);
    }
    const final = await alice("GET", `/api/runs/${body.run.id}`);
    assert.equal(final.body.run.puzzle.status, "won");
  });

  await test("letter boxed refuses two letters from one side", async () => {
    const { body } = await alice("POST", "/api/play/boxed", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    const sameSide = puzzle.sides[0][0] + puzzle.sides[0][1] + puzzle.sides[1][0];
    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: sameSide });
    assert.equal(played.result.ok, false);
    assert.match(played.result.message, /same side/);
  });

  await test("the bee scores a pangram at length plus seven", async () => {
    const { body } = await alice("POST", "/api/play/bee", { mode: "unlimited", fresh: true });
    const pangram = answerTo(body.run.id).pangrams[0];
    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: pangram });
    assert.equal(played.result.pangram, true);
    assert.equal(played.result.points, pangram.length + 7);
  });

  await test("the bee insists on the centre letter", async () => {
    const { body } = await alice("POST", "/api/play/bee", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    const without = puzzle.answers.find((w) => !w.includes(puzzle.centre));
    assert.equal(without, undefined, "no answer should be missing the centre letter");

    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: puzzle.outer.join("") });
    assert.equal(played.result.ok, false);
  });

  await test("both crosswords deal a filled, clued grid", async () => {
    for (const key of ["mini", "crossword"]) {
      const { body } = await alice("POST", `/api/play/${key}`, { mode: "unlimited", fresh: true });
      const puzzle = body.run.puzzle;

      assert.equal(puzzle.size, key === "mini" ? 5 : 15);
      assert.ok(puzzle.entries.length > 0, `${key} should have entries`);
      assert.ok(puzzle.entries.every((entry) => entry.clue && entry.clue.length > 5),
        `every ${key} entry needs a clue`);
      assert.equal(puzzle.answers, null, "answers must not ship with the grid");
      assert.equal(puzzle.solution, null, "nor the filled grid");

      const real = answerTo(body.run.id);

      /*
       * Nothing sent may carry an answer.
       *
       * This used to scan the whole JSON for the first answer as a substring,
       * which is not a test of anything: a three-letter answer turns up inside
       * ordinary clue prose about a third of the time - NIM in "animal", FIN
       * in "fine" - so it failed at random on correct code. What actually
       * matters is structural, and it is checked structurally.
       */
      for (const entry of puzzle.entries) {
        assert.equal("answer" in entry, false, `${key} sent an answer with a clue`);
      }
      /* `letters` is a string, one character per square: a space where nothing
       * has been typed and # for a black square. Nothing else on a fresh grid. */
      assert.equal(/[^ #]/.test(puzzle.letters), false,
        `${key} started with letters already in it`);

      /* And separately: a clue must not give away its own answer. That is a
       * puzzle-quality question rather than a leak, and it needs word
       * boundaries to mean anything. */
      for (const answered of real.entries) {
        const shown = puzzle.entries.find((e) =>
          e.number === answered.number && e.direction === answered.direction);
        if (!shown || !shown.clue) continue;
        assert.equal(new RegExp(`\\b${answered.answer}\\b`, "i").test(shown.clue), false,
          `${key}: the clue for ${answered.answer} contains it`);
      }
    }
  });

  await test("a crossword can be typed into and solved", async () => {
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited", fresh: true });
    const id = body.run.id;
    const real = answerTo(id);

    /* A letter in the wrong place does not finish it. */
    const first = real.grid.indexOf(".") === -1 ? 0 : [...real.grid].findIndex((c) => c !== "#");
    const wrong = real.letters[first].toUpperCase() === "A" ? "B" : "A";
    const typed = await alice("POST", `/api/runs/${id}/guess`, { value: { cell: first, letter: wrong } });
    assert.equal(typed.body.result.ok, true);
    assert.equal(typed.body.run.puzzle.status, "playing");

    /* Checking points at it without giving the answer. */
    const checked = await alice("POST", `/api/runs/${id}/check`, {});
    assert.ok(checked.body.result.wrong.includes(first), "the wrong letter should be flagged");
    assert.equal(JSON.stringify(checked.body.result).includes(real.letters[first].toUpperCase()), false,
      "checking must not reveal the right letter");

    /* Fill it in properly and it should finish. */
    for (let cell = 0; cell < real.grid.length; cell++) {
      if (real.grid[cell] === "#") continue;
      await alice("POST", `/api/runs/${id}/guess`, { value: { cell, letter: real.letters[cell] } });
    }
    const done = await alice("GET", `/api/runs/${id}`);
    assert.equal(done.body.run.puzzle.status, "won");
    assert.ok(done.body.run.puzzle.answers.length > 0, "answers arrive at the end");
  });

  await test("a crossword hint fills the square you are looking at", async () => {
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited", fresh: true });
    const real = answerTo(body.run.id);
    const target = [...real.grid].findIndex((c) => c !== "#");

    const { body: hinted } = await alice("POST", `/api/runs/${body.run.id}/hint`, { at: target });
    assert.equal(hinted.result.ok, true);
    assert.equal(hinted.result.hint.cell, target);
    assert.equal(hinted.result.hint.letter, real.letters[target].toUpperCase());
    assert.ok(hinted.run.puzzle.revealed.includes(target), "a given letter is marked as given");

    /* And a given letter cannot then be typed over. */
    const over = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: { cell: target, letter: "Z" } });
    assert.equal(over.body.result.ok, false);
  });

  await test("giving up on a crossword shows the whole grid", async () => {
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited", fresh: true });
    const real = answerTo(body.run.id);
    const { body: given } = await alice("POST", `/api/runs/${body.run.id}/reveal`, {});

    assert.equal(given.run.puzzle.status, "done");
    assert.equal(given.run.puzzle.solution, real.letters.toUpperCase());
    assert.equal(given.run.summary.won, false, "giving up is not a win");
  });

  await test("strands deals a themed board using every square", async () => {
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited", fresh: true });
    const puzzle = body.run.puzzle;

    assert.equal(puzzle.letters.length, puzzle.rows * puzzle.cols);
    assert.ok(puzzle.theme && puzzle.theme.length > 3);
    assert.equal(puzzle.answers, null, "the words must not ship with the board");

    const real = answerTo(body.run.id);
    const covered = new Array(puzzle.letters.length).fill(0);
    for (const entry of real.entries) for (const cell of entry.cells) covered[cell] += 1;
    assert.ok(covered.every((n) => n === 1), "every square belongs to exactly one word");
    assert.equal(real.entries.filter((e) => e.spangram).length, 1, "exactly one spangram");
    /*
     * What must not be sent is a word list, and that is a structural question.
     * Scanning the payload for a word as a substring is not: the board is a
     * grid of the letters those words are made of, so a word laid straight
     * along a row is a substring of it by construction. That check failed
     * whenever the seed happened to lay one horizontally.
     */
    assert.equal(puzzle.entries, undefined, "the board must not carry its entries");
    assert.equal(puzzle.words, undefined, "nor a word list");
    for (const found of puzzle.found || []) {
      assert.equal(typeof found, "string", "only words already found are named");
    }
    assert.ok(real.entries.every((entry) => entry.word && entry.cells),
      "the server's own copy still has them");
  });

  await test("strands accepts a traced word and refuses a broken path", async () => {
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited", fresh: true });
    const real = answerTo(body.run.id);
    const entry = real.entries[1];

    const broken = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: [0, 1, 2, 47] });
    assert.equal(broken.body.result.ok, false);

    const traced = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: entry.cells });
    assert.equal(traced.body.result.ok, true);
    assert.equal(traced.body.result.theme, true);
    assert.equal(traced.body.run.puzzle.found.length, 1);

    const again = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: entry.cells });
    assert.equal(again.body.result.ok, false, "the same word twice is refused");
  });

  await test("strands hints have to be earned", async () => {
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited", fresh: true });
    const { body: early } = await alice("POST", `/api/runs/${body.run.id}/hint`, {});
    assert.equal(early.result.ok, false);
    assert.match(early.result.message, /earn a hint/);
  });

  await test("pips deals a board with exactly one answer", async () => {
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited", fresh: true });
    const puzzle = body.run.puzzle;

    assert.ok(puzzle.dominoes.length >= 5);
    assert.equal(puzzle.cells.length, puzzle.dominoes.length * 2, "the dominoes cover the board exactly");
    assert.equal(puzzle.solution, null, "the answer must not ship with the board");

    /* Confirm the claim the generator makes about itself. */
    const real = answerTo(body.run.id);
    const { countSolutions } = require("../src/server/pips.js");
    assert.equal(countSolutions(real, 3), 1, "a dealt puzzle must have one answer");

    /* And the layout, which says exactly where every domino goes, must stay
     * on the server - it is the answer in its most usable form. */
    assert.equal(puzzle.layout, undefined, "the layout must not be sent to the browser");
    assert.equal(JSON.stringify(puzzle).includes("layout"), false);
  });

  await test("giving up on pips lays out the whole answer", async () => {
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited", fresh: true });
    const real = answerTo(body.run.id);
    const { body: given } = await alice("POST", `/api/runs/${body.run.id}/reveal`, {});

    assert.equal(given.run.puzzle.placed.length, real.dominoes.length,
      "every domino should be on the board");
    const answer = new Map(real.solution);
    for (const one of given.run.puzzle.placed) {
      one.cells.forEach((key, i) => {
        assert.equal(one.values[i], answer.get(key), `${key} should show the right number`);
      });
    }
  });

  await test("pips refuses illegal placements", async () => {
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited", fresh: true });
    const id = body.run.id;

    for (const [why, move] of [
      ["a domino that does not exist", { domino: 99, cells: [[0, 0], [0, 1]] }],
      ["squares that do not touch", { domino: 0, cells: [[0, 0], [5, 5]] }],
      ["one square twice", { domino: 0, cells: [[0, 0], [0, 0]] }],
      ["off the board", { domino: 0, cells: [[80, 80], [80, 81]] }],
    ]) {
      const { body: tried } = await alice("POST", `/api/runs/${id}/guess`, { value: move });
      assert.equal(tried.result.ok, false, why + " should be refused");
    }
  });

  await test("pips can be solved, and a lifted domino frees its squares", async () => {
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited", fresh: true });
    const id = body.run.id;
    const real = answerTo(body.run.id);
    const answer = new Map(real.solution);

    /*
     * The puzzle stores where each domino belongs. Working it back out from
     * the cell values instead means guessing at the tiling, which strands a
     * domino on about one board in twenty - that is what this test caught the
     * first time, and it was a real fault in the game, not in the test.
     */
    const moves = real.layout.map((home) => {
      const [a] = real.dominoes[home.domino];
      return {
        domino: home.domino,
        cells: home.cells.map((key) => key.split(",").map(Number)),
        flip: home.values[0] !== a,
      };
    });
    assert.equal(moves.length, real.dominoes.length, "every domino should have a home");

    let last = null;
    for (const move of moves) {
      last = (await alice("POST", `/api/runs/${id}/guess`, { value: move })).body;
      assert.equal(last.result.ok, true, "placing should be allowed: " + (last.result.message || ""));
    }
    assert.equal(last.run.puzzle.status, "won");

    /* And a domino can be taken back off a board still in play. */
    const other = await alice("POST", "/api/play/pips", { mode: "unlimited", fresh: true });
    const first = other.body.run.puzzle.cells[0].split(",").map(Number);
    const beside = other.body.run.puzzle.cells.find((key) => {
      const [r, c] = key.split(",").map(Number);
      return Math.abs(r - first[0]) + Math.abs(c - first[1]) === 1;
    });
    if (beside) {
      const down = await alice("POST", `/api/runs/${other.body.run.id}/guess`,
        { value: { domino: 0, cells: [first, beside.split(",").map(Number)] } });
      assert.equal(down.body.result.ok, true);
      const up = await alice("POST", `/api/runs/${other.body.run.id}/guess`, { value: { domino: 0, lift: true } });
      assert.equal(up.body.result.ok, true);
      assert.equal(up.body.run.puzzle.placed.length, 0);
    }
  });

  await test("one player cannot open another's round", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const stranger = client();
    await stranger("GET", "/api/me");
    assert.equal((await stranger("GET", `/api/runs/${body.run.id}`)).status, 403);
  });

  /* ------------------------------------------------------------- stats */

  console.log("\nstats");

  await test("finishing a round shows up in the tallies", async () => {
    const before = await alice("GET", "/api/stats");
    const played = before.body.games["wordle:unlimited"].played;

    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await alice("POST", `/api/runs/${body.run.id}/guess`, { value: answerTo(body.run.id).answer });

    const after = await alice("GET", "/api/stats");
    assert.equal(after.body.games["wordle:unlimited"].played, played + 1);
    assert.ok(after.body.games["wordle:unlimited"].won >= 1);
    assert.ok(after.body.totals.played > 0);
  });

  await test("a win in one guess lands in the distribution", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await alice("POST", `/api/runs/${body.run.id}/guess`, { value: answerTo(body.run.id).answer });
    const { body: stats } = await alice("GET", "/api/stats");
    assert.ok(stats.games["wordle:unlimited"].distribution["1"] >= 1);
    assert.equal(stats.games["wordle:unlimited"].best, 1);
  });

  await test("a finished round is not counted twice", async () => {
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited", fresh: true });
    const puzzle = answerTo(body.run.id);
    for (const code of games.get("travle").Engine.shortestRoute(puzzle.start, puzzle.end).slice(1)) {
      await alice("POST", `/api/runs/${body.run.id}/guess`, { value: code });
    }
    const after = await alice("GET", "/api/stats");
    const played = after.body.games["travle:unlimited"].played;

    await alice("POST", `/api/runs/${body.run.id}/guess`, { value: puzzle.end });
    const again = await alice("GET", "/api/stats");
    assert.equal(again.body.games["travle:unlimited"].played, played);
  });

  await test("travle's daily levels keep separate streaks", async () => {
    const walker = client();
    await walker("GET", "/api/me");
    await walker("POST", "/api/auth/signup", { handle: "walker", password: "a long walk indeed" });

    /* Finish the Scenic daily, and only that one. */
    const scenic = await walker("POST", "/api/play/travle", { mode: "daily", difficulty: "scenic" });
    const puzzle = answerTo(scenic.body.run.id);
    const route = games.get("travle").Engine.shortestRoute(puzzle.start, puzzle.end);
    for (const code of route.slice(1)) {
      await walker("POST", `/api/runs/${scenic.body.run.id}/guess`, { value: code });
    }

    const { body } = await walker("GET", "/api/stats");
    assert.ok(body.games["travle:daily:scenic"], "scenic keeps its own record");
    assert.equal(body.games["travle:daily:scenic"].won, 1);
    assert.equal(body.games["travle:daily:standard"], undefined,
      "finishing scenic must not touch standard");
    assert.equal(body.games["travle:daily"], undefined,
      "and nothing should land in a shared travle bucket");

    /* The other level is still a fresh, unplayed round. */
    const standard = await walker("POST", "/api/play/travle", { mode: "daily", difficulty: "standard" });
    assert.equal(standard.body.run.puzzle.status, "playing");
    assert.notEqual(standard.body.run.id, scenic.body.run.id);
  });

  await test("today's finished dailies are reported on the home screen", async () => {
    const { body } = await alice("POST", "/api/play/bee", { mode: "daily" });
    await alice("POST", `/api/runs/${body.run.id}/reveal`);
    const me = await alice("GET", "/api/me");
    assert.ok(me.body.progress.bee, "the bee should show as played today");
  });

  /* ----------------------------------------------------------- friends */

  console.log("\nfriends");

  const bob = client();
  await bob("GET", "/api/me");
  await bob("POST", "/api/auth/signup", { handle: "bob", password: "battery staple", display: "Bob" });

  await test("a friend request can be sent and accepted", async () => {
    assert.equal((await alice("POST", "/api/friends/request", { handle: "bob" })).status, 200);

    const inbox = await bob("GET", "/api/friends");
    assert.equal(inbox.body.incoming.length, 1);
    assert.equal(inbox.body.incoming[0].from.handle, "alice");

    const accepted = await bob("POST", "/api/friends/respond", { id: inbox.body.incoming[0].id, accept: true });
    assert.equal(accepted.status, 200);

    const list = await alice("GET", "/api/friends");
    assert.equal(list.body.friends.length, 1);
    assert.equal(list.body.friends[0].handle, "bob");
  });

  await test("befriending someone unknown is a 404", async () => {
    assert.equal((await alice("POST", "/api/friends/request", { handle: "nobody_here" })).status, 404);
  });

  await test("you cannot befriend yourself", async () => {
    assert.equal((await alice("POST", "/api/friends/request", { handle: "alice" })).status, 400);
  });

  await test("asking someone who already asked you just accepts", async () => {
    const carol = client();
    await carol("GET", "/api/me");
    await carol("POST", "/api/auth/signup", { handle: "carol", password: "hunter hunter" });
    await carol("POST", "/api/friends/request", { handle: "alice" });

    const { body } = await alice("POST", "/api/friends/request", { handle: "carol" });
    assert.ok(body.friended, "should short-circuit to friendship");
    const list = await alice("GET", "/api/friends");
    assert.ok(list.body.friends.some((f) => f.handle === "carol"));
  });

  await test("a friend's activity appears in the feed", async () => {
    const { body } = await bob("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await bob("POST", `/api/runs/${body.run.id}/guess`, { value: answerTo(body.run.id).answer });

    const { body: friends } = await alice("GET", "/api/friends");
    assert.ok(friends.feed.some((f) => f.who.handle === "bob"), "bob's round should show");
    assert.equal(friends.feed.some((f) => f.answer), false, "the feed must not carry answers");
  });

  await test("the leaderboard includes you and your friends", async () => {
    const { body } = await alice("GET", "/api/friends/leaderboard");
    assert.deepEqual(body.rows.map((r) => r.user.handle).sort(), ["alice", "bob", "carol"]);
  });

  await test("a friend can be removed", async () => {
    const list = await alice("GET", "/api/friends");
    const carol = list.body.friends.find((f) => f.handle === "carol");
    assert.equal((await alice("DELETE", `/api/friends/${carol.id}`)).status, 200);

    const after = await alice("GET", "/api/friends");
    assert.ok(!after.body.friends.some((f) => f.handle === "carol"));
  });

  /* ------------------------------------------------------------- duels */

  console.log("\nduels");

  await test("a duel deals one puzzle to both sides, and only to them", async () => {
    const made = await alice("POST", "/api/challenges", { handle: "bob", game: "wordle" });
    assert.equal(made.status, 200, `the challenge failed: ${made.body && made.body.error}`);
    const id = made.body.challenge.id;

    const hers = await alice("POST", "/api/play/wordle", { mode: "challenge", challenge: id });
    const his = await bob("POST", "/api/play/wordle", { mode: "challenge", challenge: id });
    assert.equal(answerTo(hers.body.run.id).answer, answerTo(his.body.run.id).answer,
      "the two halves of a duel are different puzzles");

    /* Neither of them has been sent the answer, duel or not. */
    assert.equal(hers.body.run.puzzle.answer, null);

    /* And somebody outside it cannot open it at all. */
    const outsider = client();
    await outsider("GET", "/api/me");
    await outsider("POST", "/api/auth/signup", { handle: "gatecrasher", password: "let me in please" });
    const barged = await outsider("POST", "/api/play/wordle", { mode: "challenge", challenge: id });
    assert.equal(barged.status, 403, "a stranger opened somebody else's duel");
  });

  await test("a duel that runs out of time is decided on whoever turned up", async () => {
    const made = await alice("POST", "/api/challenges", { handle: "bob", game: "connections" });
    const id = made.body.challenge.id;

    /* Alice plays hers; Bob never opens it. */
    const run = (await alice("POST", "/api/play/connections", { mode: "challenge", challenge: id })).body.run;
    for (const group of answerTo(run.id).groups) {
      await alice("POST", `/api/runs/${run.id}/guess`, { value: group.words });
    }

    /* Wind the clock forward rather than waiting two days for it. */
    const record = store.data.challenges.find((one) => one.id === id);
    assert.equal(record.settledAt, null, "it settled before anybody ran out of time");
    record.expiresAt = Date.now() - 1;

    const seen = (await alice("GET", "/api/challenges")).body.challenges.find((c) => c.id === id);
    assert.equal(seen.settled, true, "an expired duel was never settled");
    assert.equal(seen.expired, true);
    assert.equal(seen.outcome, "won", "the player who turned up did not win it");

    const missed = (await bob("GET", "/api/challenges")).body.challenges.find((c) => c.id === id);
    assert.equal(missed.outcome, "missed");
    assert.equal(missed.earned.xp, 0, "not playing a duel paid out anyway");
  });

  await test("two people who both fail to solve it draw", async () => {
    /*
     * The rule this is really pinning: between two losses the clock is not
     * consulted. If it were, the way to win a duel you cannot solve would be
     * to throw it away faster than the other person.
     */
    const duels = require("../src/server/challenges.js");
    const quickLoss = { won: false, took: 900, guesses: 6, hints: 0 };
    const slowLoss = { won: false, took: 400000, guesses: 6, hints: 0 };
    const slowWin = { won: true, took: 900000, guesses: 4, hints: 0 };

    assert.equal(duels.better(quickLoss, slowLoss), 0, "the faster loser won");
    assert.ok(duels.better(slowWin, quickLoss) < 0, "a solve lost to a fast surrender");
    assert.ok(duels.better(quickLoss, null) < 0, "turning up did not beat not turning up");
  });

  await test("a challenge can be turned down, and pays nobody", async () => {
    const made = await alice("POST", "/api/challenges", { handle: "bob", game: "boxed" });
    const id = made.body.challenge.id;

    assert.equal((await bob("POST", `/api/challenges/${id}/decline`, {})).status, 200);

    const gone = (await bob("GET", "/api/challenges")).body.challenges.find((c) => c.id === id);
    assert.ok(gone.declined, "the duel is not marked as turned down");
    assert.equal(gone.earned, null, "a duel nobody played paid out");

    /* And it cannot then be played. */
    const anyway = await bob("POST", "/api/play/boxed", { mode: "challenge", challenge: id });
    assert.equal(anyway.status, 410);
  });

  await test("a duel needs a friend on the other end of it", async () => {
    const nobody = client();
    await nobody("GET", "/api/me");
    await nobody("POST", "/api/auth/signup", { handle: "notafriend", password: "let me in please" });

    assert.equal((await alice("POST", "/api/challenges", { handle: "notafriend", game: "wordle" })).status, 403);
    assert.equal((await alice("POST", "/api/challenges", { handle: "alice", game: "wordle" })).status, 400);
    assert.equal((await alice("POST", "/api/challenges", { handle: "bob", game: "nonsense" })).status, 404);
  });

  await test("what is waiting is counted for the badge", async () => {
    const { body } = await bob("GET", "/api/me");
    assert.ok(body.waiting, "no waiting count for a signed-in player");
    assert.equal(typeof body.waiting.total, "number");
    /* A guest has none of it rather than a row of zeroes. */
    const guest = client();
    const out = await guest("GET", "/api/me");
    assert.equal(out.body.waiting, null);
  });

  /* ---------------------------------------------------- custom puzzles */

  console.log("\ncustom puzzles");
  let sharedCode = null;

  await test("a wordle puzzle can be built and shared", async () => {
    const { status, body } = await alice("POST", "/api/puzzles", {
      game: "wordle", title: "For Bob",
      payload: { answer: "PLUTO", note: "not a planet any more" },
    });
    assert.equal(status, 200);
    assert.equal(body.puzzle.shape.letters, 5);
    assert.match(body.puzzle.code, /^[A-Z2-9]{6}$/);
    sharedCode = body.puzzle.code;
  });

  await test("looking up a shared puzzle does not leak its answer", async () => {
    const { body } = await bob("GET", `/api/puzzles/${sharedCode}`);
    assert.equal(JSON.stringify(body).toLowerCase().includes("pluto"), false);
  });

  await test("a friend can play it by code", async () => {
    const { status, body } = await bob("POST", "/api/play/wordle", { mode: "custom", code: sharedCode });
    assert.equal(status, 200);
    assert.equal(body.run.custom.title, "For Bob");
    assert.equal(body.run.custom.by.handle, "alice");
    assert.equal(body.run.puzzle.note, "not a planet any more");
    assert.equal(body.run.puzzle.answer, null);

    const { body: won } = await bob("POST", `/api/runs/${body.run.id}/guess`, { value: "pluto" });
    assert.equal(won.run.puzzle.status, "won");
    assert.equal(won.run.puzzle.answer, "pluto");
  });

  await test("playing it counts against the puzzle", async () => {
    const { body } = await alice("GET", `/api/puzzles/${sharedCode}`);
    assert.equal(body.puzzle.plays, 1);
    assert.equal(body.puzzle.solves, 1);
  });

  await test("a shared puzzle stands as one attempt, like a daily", async () => {
    const again = await bob("POST", "/api/play/wordle", { mode: "custom", code: sharedCode });
    assert.equal(again.body.run.puzzle.status, "won", "the finished attempt comes back");
  });

  await test("a custom answer may be a word no dictionary has", async () => {
    const { body } = await alice("POST", "/api/puzzles", {
      game: "wordle", title: "in-joke", payload: { answer: "zorbo" },
    });
    const play = await bob("POST", "/api/play/wordle", { mode: "custom", code: body.puzzle.code });
    const { body: won } = await bob("POST", `/api/runs/${play.body.run.id}/guess`, { value: "zorbo" });
    assert.equal(won.run.puzzle.status, "won");
  });

  await test("a bad custom puzzle is explained, not accepted", async () => {
    const tooShort = await alice("POST", "/api/puzzles", { game: "wordle", payload: { answer: "ab" } });
    assert.equal(tooShort.status, 400);
    assert.match(tooShort.body.error, /4 to 8 letters/);
    assert.equal((await alice("POST", "/api/puzzles", { game: "wordle", payload: { answer: "ab de" } })).status, 400);
  });

  await test("a connections puzzle validates its groups", async () => {
    const duplicated = await alice("POST", "/api/puzzles", {
      game: "connections",
      payload: {
        groups: [
          { clue: "One", words: ["A", "B", "C", "D"] },
          { clue: "Two", words: ["A", "F", "G", "H"] },
          { clue: "Three", words: ["I", "J", "K", "L"] },
          { clue: "Four", words: ["M", "N", "O", "P"] },
        ],
      },
    });
    assert.equal(duplicated.status, 400);
    assert.match(duplicated.body.error, /two groups/);

    const good = await alice("POST", "/api/puzzles", {
      game: "connections", title: "Mine",
      payload: {
        groups: [
          { clue: "Cats", words: ["LION", "TIGER", "LYNX", "PUMA"] },
          { clue: "Dogs", words: ["BEAGLE", "PUG", "COLLIE", "BOXER"] },
          { clue: "Birds", words: ["ROBIN", "CROW", "OWL", "WREN"] },
          { clue: "Fish", words: ["COD", "SOLE", "BASS", "PIKE"] },
        ],
      },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.puzzle.shape.clues.length, 4);

    /* And it should be playable end to end. */
    const play = await bob("POST", "/api/play/connections", { mode: "custom", code: good.body.puzzle.code });
    assert.equal(play.body.run.puzzle.order.length, 16);
    const solved = await bob("POST", `/api/runs/${play.body.run.id}/guess`, { value: ["LION", "TIGER", "LYNX", "PUMA"] });
    assert.equal(solved.body.result.correct, true);
  });

  await test("a travle puzzle refuses a walk with nothing to work out", async () => {
    /* Neighbours make no puzzle: there is one move and it is obvious. */
    const tooClose = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Portugal", end: "Spain" },
    });
    assert.equal(tooClose.status, 400);
    assert.match(tooClose.body.error, /neighbours/);

    const same = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Peru", end: "Peru" },
    });
    assert.equal(same.status, 400);

    const good = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Portugal", end: "Poland" },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.puzzle.shape.from, "Portugal");
  });

  await test("every country can be walked to, islands included", async () => {
    /* The sea crossings exist so that no country is a dead end. Australia was
     * the one that prompted them; this checks the whole board, not just it. */
    const { Engine } = games.get("travle");
    const all = Object.keys(Engine.COUNTRIES);

    const unreachable = all.filter((code) => !Number.isFinite(Engine.distance("AU", code)));
    assert.deepEqual(unreachable, [], "everything should be reachable from Australia");

    const stranded = all.filter((code) => Engine.neighbours(code).size === 0);
    assert.deepEqual(stranded, [], "no country should have nowhere to go");

    /* And a walk that used to be impossible is now a real puzzle. */
    const made = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Australia", end: "France" },
    });
    assert.equal(made.status, 200);
  });

  await test("the bee has no puzzle builder", async () => {
    assert.equal((await alice("POST", "/api/puzzles", { game: "bee", payload: {} })).status, 400);
  });

  await test("only the author can delete a puzzle", async () => {
    assert.equal((await bob("DELETE", `/api/puzzles/${sharedCode}`)).status, 403);
    assert.equal((await alice("DELETE", `/api/puzzles/${sharedCode}`)).status, 200);
    assert.equal((await bob("GET", `/api/puzzles/${sharedCode}`)).status, 404);
  });

  await test("friends' puzzles are listed without needing a code", async () => {
    const { body } = await bob("GET", "/api/puzzles/friends");
    assert.ok(body.puzzles.length >= 1, "bob should see alice's puzzles");
    assert.ok(body.puzzles.every((p) => p.by.handle === "alice"));
  });

  await test("building a puzzle needs an account", async () => {
    const guest = client();
    await guest("GET", "/api/me");
    assert.equal((await guest("POST", "/api/puzzles", { game: "wordle", payload: { answer: "ghost" } })).status, 401);
  });

  /* ---------------------------------------------------- xp and the pass */

  console.log("\nxp and the pass");

  await test("the curve pays for how well a round went, not that it happened", async () => {
    const easy = xpRules.award({ game: "wordle", mode: "daily", summary: { won: true, guesses: 2, hints: 0 } });
    const scrape = xpRules.award({ game: "wordle", mode: "daily", summary: { won: true, guesses: 6, hints: 0 } });
    const lost = xpRules.award({ game: "wordle", mode: "daily", summary: { won: false, guesses: 6 } });

    assert.ok(easy.xp > scrape.xp, "two guesses should beat six");
    assert.ok(scrape.xp > lost.xp, "a scrappy win should beat a loss");
    assert.ok(lost.xp > 0, "a loss should still be worth something");
  });

  await test("a hint costs, in every game that has one", async () => {
    for (const [game, summary] of [
      ["wordle", { won: true, guesses: 3 }],
      ["connections", { won: true, mistakes: 1 }],
      ["bee", { won: true, score: 90, maxScore: 100 }],
      ["boxed", { won: true, guesses: 3 }],
      ["travle", { won: true, over: 1, slack: 5 }],
    ]) {
      const clean = xpRules.award({ game, mode: "daily", summary: { ...summary, hints: 0 } });
      const helped = xpRules.award({ game, mode: "daily", summary: { ...summary, hints: 2 } });
      assert.ok(helped.xp < clean.xp, `${game}: hints should cost something`);
    }
  });

  await test("a crossword solved by revealing is worth less than one solved", async () => {
    const solved = xpRules.award({
      game: "crossword", mode: "daily", took: 600000,
      summary: { won: true, hints: 0, squares: 225, right: 225 },
    });
    const helped = xpRules.award({
      game: "crossword", mode: "daily", took: 600000,
      summary: { won: true, hints: 50, squares: 225, right: 225 },
    });
    assert.ok(helped.xp < solved.xp * 0.8);
  });

  await test("unlimited is worth less than the daily, and tapers", async () => {
    const perfect = { won: true, guesses: 1, hints: 0 };
    const daily = xpRules.award({ game: "wordle", mode: "daily", summary: perfect });
    const first = xpRules.award({ game: "wordle", mode: "unlimited", summary: perfect, already: 0 });
    const tenth = xpRules.award({ game: "wordle", mode: "unlimited", summary: perfect, already: 9 });

    assert.ok(first.xp < daily.xp, "unlimited should not match the daily");
    assert.ok(tenth.xp < first.xp / 2, "the tenth round of the day should have tapered hard");
    assert.ok(tenth.xp >= 1, "it should never taper to nothing");
  });

  await test("Travle's levels are worth what they cost", async () => {
    const at = (difficulty) => xpRules.award({
      game: "travle", mode: "daily", difficulty,
      summary: { won: true, over: 0, hints: 0, slack: 5 },
    }).xp;
    assert.ok(at("expert") > at("standard"), "expert should pay more than standard");
    assert.ok(at("standard") > at("scenic"), "standard should pay more than scenic");
  });

  await test("the fifty levels climb and the last is the last", async () => {
    assert.equal(xpRules.LEVELS, 50);
    assert.equal(xpRules.levelFor(0), 1);
    assert.equal(xpRules.levelFor(xpRules.THRESHOLDS[2]), 2);
    assert.equal(xpRules.levelFor(xpRules.THRESHOLDS[50]), 50);
    assert.equal(xpRules.levelFor(xpRules.THRESHOLDS[50] * 4), 50, "past the top stays at the top");

    for (let level = 3; level <= 50; level += 1) {
      const step = xpRules.THRESHOLDS[level] - xpRules.THRESHOLDS[level - 1];
      const before = xpRules.THRESHOLDS[level - 1] - xpRules.THRESHOLDS[level - 2];
      assert.ok(step > before, `level ${level} should cost more than the one before`);
    }

    const maxed = xpRules.progressFor(xpRules.THRESHOLDS[50] + 5000);
    assert.equal(maxed.maxed, true);
    assert.equal(maxed.share, 1, "a full bar past the end, not an overflowing one");
  });

  await test("every tier gives something and nothing is unreachable", async () => {
    /* Only the pass's own pieces. The ones an achievement hands over are on no
     * tier at all - that is what makes them worth having. */
    const onTrack = cosmeticTrack.ITEMS.filter((item) => item.level);
    const byLevel = new Map();
    for (const item of onTrack) {
      byLevel.set(item.level, (byLevel.get(item.level) || 0) + 1);
    }
    for (let level = 1; level <= xpRules.LEVELS; level += 1) {
      assert.ok(byLevel.get(level), `level ${level} unlocks nothing`);
    }
    /* One per tier, except the last, which finishes with the robes and the
     * title together. A second doubled-up tier means an item was added
     * without moving another, so this is worth holding. */
    const doubled = [...byLevel.entries()].filter(([, n]) => n > 1).map(([l]) => l);
    assert.deepEqual(doubled, [1, 50], "only the starter set and the last tier give more than one");

    /* Every slot needs a level 1 piece, or a new player has an empty one. */
    for (const slot of cosmeticTrack.SLOTS) {
      assert.ok(onTrack.some((i) => i.slot === slot.key && i.level === 1),
        `${slot.key} has nothing to start in`);
    }

    /* And an earned piece is earned, never reached: one on a tier as well
     * would be handed to everybody, which is the opposite of the point. */
    for (const item of cosmeticTrack.earnable()) {
      assert.equal(item.level, undefined,
        `${item.slot}/${item.id} is both earned and on tier ${item.level}`);
      assert.ok(achievementList.find(item.earn),
        `${item.slot}/${item.id} is earned by "${item.earn}", which is not an achievement`);
    }
    for (const one of achievementList.ACHIEVEMENTS) {
      if (!one.cosmetic) continue;
      const piece = cosmeticTrack.find(one.cosmetic.slot, one.cosmetic.id);
      assert.ok(piece, `${one.id} gives a piece that does not exist`);
      assert.equal(piece.earn, one.id, `${one.id} and ${piece.id} disagree about each other`);
    }
  });

  await test("every cosmetic can actually be drawn", async () => {
    /* The wardrobe and the artwork are two files, and a name in one and not
     * the other is an item that either cannot be worn or cannot be seen. */
    const art = fs.readFileSync(path.join(__dirname, "..", "public", "js", "character.js"), "utf8");
    const listed = (name) => {
      const at = art.indexOf(`const ${name} = {`);
      assert.notEqual(at, -1, `character.js has no ${name}`);
      const body = art.slice(at, art.indexOf("\n};", at));
      return [...body.matchAll(/^  ([a-z]+):/gm)].map((m) => m[1]);
    };
    const drawn = {
      backdrop: listed("BACKDROPS"), outfit: listed("OUTFITS"), face: listed("FACES"),
      head: listed("HEADS"), held: listed("HELD"), frame: listed("FRAMES"),
    };

    for (const item of cosmeticTrack.ITEMS) {
      if (item.slot === "title") continue;   // a title is words, not a drawing
      assert.ok(drawn[item.slot] && drawn[item.slot].includes(item.id),
        `${item.slot}/${item.id} is on the track but nothing draws it`);
    }
    for (const [slot, ids] of Object.entries(drawn)) {
      for (const id of ids) {
        assert.ok(cosmeticTrack.find(slot, id), `${slot}/${id} is drawn but on no tier`);
      }
    }
  });

  await test("playing earns XP, and only for someone signed in", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "xper", password: "earn me some xp" });

    const before = await player("GET", "/api/pass");
    assert.equal(before.body.pass.xp, 0);
    assert.equal(before.body.pass.level, 1);

    const run = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const answer = answerTo(run.body.run.id).answer;
    const done = await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answer });

    assert.ok(done.body.run.earned, "a finished round should say what it earned");
    assert.ok(done.body.run.earned.xp > 0);

    const after = await player("GET", "/api/pass");
    /* The round's own XP plus whatever its achievements paid. A first win is
     * very likely to earn one, so the two are added rather than assumed apart. */
    assert.equal(after.body.pass.xp, done.body.run.earned.xp + done.body.run.earned.badgeXp);

    /* A guest plays the same round and is given nothing to record. */
    const guest = client();
    await guest("GET", "/api/me");
    const theirs = await guest("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const guestAnswer = answerTo(theirs.body.run.id).answer;
    const over = await guest("POST", `/api/runs/${theirs.body.run.id}/guess`, { value: guestAnswer });
    assert.equal(over.body.run.earned, null, "a guest has nowhere to put XP");
    assert.equal((await guest("GET", "/api/pass")).status, 401);
  });

  await test("a finished round cannot be settled twice for XP", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "twice", password: "count me once" });

    const run = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const answer = answerTo(run.body.run.id).answer;
    await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answer });

    const once = (await player("GET", "/api/pass")).body.pass.xp;
    /* Re-reading a finished round, and trying to move in it again, must not
     * pay out a second time. */
    await player("GET", `/api/runs/${run.body.run.id}`);
    await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answer });
    assert.equal((await player("GET", "/api/pass")).body.pass.xp, once);
  });

  await test("you cannot wear what you have not unlocked", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "dresser", password: "let me wear it" });

    const asked = await player("PUT", "/api/pass/character", {
      character: { outfit: "robes", head: "crown", frame: "wreath", backdrop: "aurora" },
    });
    assert.equal(asked.status, 200);
    /* Quietly replaced with the starter piece rather than refused - see
     * cosmetics.sanitise. What matters is that it is not worn. */
    assert.equal(asked.body.character.outfit, "tee");
    assert.equal(asked.body.character.head, "bare");
    assert.equal(asked.body.character.frame, "none");
  });

  await test("skin and colour are free, and stick", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "looker", password: "this is my face" });

    const tone = cosmeticTrack.SKINS[4];
    const set = await player("PUT", "/api/pass/character", { character: { skin: tone, hue: 128 } });
    assert.equal(set.body.character.skin, tone);
    assert.equal(set.body.character.hue, 128);

    const me = await player("GET", "/api/me");
    assert.equal(me.body.pass.character.skin, tone, "the session should carry it");
  });

  await test("a hue out of range is brought back into it", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "hues", password: "spin the wheel" });

    for (const [asked, wanted] of [[400, 40], [-30, 330], [720, 0]]) {
      const set = await player("PUT", "/api/pass/character", { character: { hue: asked } });
      assert.equal(set.body.character.hue, wanted, `hue ${asked}`);
    }
    const junk = await player("PUT", "/api/pass/character", { character: { hue: "purple" } });
    assert.equal(typeof junk.body.character.hue, "number");
  });

  await test("an achievement pays its XP and hands over its piece", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "firsttry", password: "one guess only" });

    /* A Wordle in one: the rarest thing on the list, and the only way to the
     * horseshoe. */
    const run = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const answer = answerTo(run.body.run.id).answer;
    const done = await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answer });

    const got = done.body.run.earned;
    const ids = got.badges.map((one) => one.id);
    assert.ok(ids.includes("wordle:one"), `expected Lucky Strike, got ${JSON.stringify(ids)}`);
    assert.equal(got.badgeXp, got.badges.reduce((n, one) => n + one.xp, 0));
    assert.ok(got.badgeXp > got.xp, "the achievement should dwarf the round itself");

    /* The horseshoe is on no tier, and this player is level 1 or 2 - so if it
     * is wearable, it is because the achievement gave it. */
    const pass = (await player("GET", "/api/pass")).body.pass;
    const shoe = pass.unlocked.find((item) => item.slot === "held" && item.id === "horseshoe");
    assert.ok(shoe, "the horseshoe was not unlocked");
    assert.equal(shoe.earn, "wordle:one");
    assert.equal(cosmeticTrack.find("held", "horseshoe").level, undefined);

    const worn = await player("PUT", "/api/pass/character", { character: { held: "horseshoe" } });
    assert.equal(worn.body.character.held, "horseshoe", "it could not be put on");
  });

  await test("a piece you have not earned cannot be worn", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "wishful", password: "let me wear it" });

    /* Every earned piece, asked for at once, by somebody who has earned none. */
    const asked = {};
    for (const item of cosmeticTrack.earnable()) asked[item.slot] = item.id;
    const worn = (await player("PUT", "/api/pass/character", { character: asked })).body.character;

    for (const item of cosmeticTrack.earnable()) {
      assert.notEqual(worn[item.slot], item.id,
        `${item.slot}/${item.id} was worn without earning it`);
    }
  });

  await test("nothing is earned twice", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "twicetry", password: "one guess only" });

    const first = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await player("POST", `/api/runs/${first.body.run.id}/guess`, { value: answerTo(first.body.run.id).answer });

    const second = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const done = await player("POST", `/api/runs/${second.body.run.id}/guess`, { value: answerTo(second.body.run.id).answer });

    assert.deepEqual(done.body.run.earned.badges, [], "the same achievements came round again");
    assert.equal(done.body.run.earned.badgeXp, 0);
  });

  await test("the achievements list shows what is left as well as what is done", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "lister", password: "show me the list" });

    const { status, body } = await player("GET", "/api/achievements");
    assert.equal(status, 200);
    assert.equal(body.achievements.length, achievementList.ACHIEVEMENTS.length);
    assert.ok(body.achievements.every((one) => one.earned === false), "a new player has none");

    /* Every game has some, and so does the club. */
    const games = new Set(body.achievements.map((one) => one.game));
    for (const key of ["wordle", "connections", "bee", "boxed", "mini", "crossword", "strands", "pips", "travle"]) {
      assert.ok(games.has(key), `${key} has no achievements`);
    }
    assert.ok(games.has(null), "the club has none");

    /* The prize is named here rather than looked up on the other side: this
     * page can be the first thing somebody opens. */
    for (const one of body.achievements) {
      assert.ok(one.name && one.blurb && one.xp > 0, `${one.id} is missing something`);
      if (one.cosmetic) {
        assert.ok(one.cosmetic.name && one.cosmetic.name !== one.cosmetic.id,
          `${one.id} names its prize "${one.cosmetic.name}"`);
      }
    }
  });

  await test("achievements are not offered to a guest", async () => {
    const guest = client();
    await guest("GET", "/api/me");
    assert.equal((await guest("GET", "/api/achievements")).status, 401);

    /* And a guest's round pays nothing, achievements included. */
    const run = await guest("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    const done = await guest("POST", `/api/runs/${run.body.run.id}/guess`, { value: answerTo(run.body.run.id).answer });
    assert.equal(done.body.run.earned, null);
  });

  await test("a check that throws costs nobody their round", async () => {
    /* An achievement is a garnish. If one of them is broken, the round it was
     * garnishing must still finish, still count, and still pay. */
    const broken = { id: "test:broken", game: "wordle", name: "Broken", blurb: "", xp: 10,
      rarity: "common", check: () => { throw new Error("this one is broken"); } };
    achievementList.ACHIEVEMENTS.push(broken);
    try {
      const player = client();
      await player("GET", "/api/me");
      await player("POST", "/api/auth/signup", { handle: "unlucky", password: "still counts" });
      const run = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
      const done = await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answerTo(run.body.run.id).answer });

      assert.equal(done.status, 200);
      assert.equal(done.body.run.puzzle.status, "won");
      assert.ok(done.body.run.earned.xp > 0, "the round still pays");
      assert.equal(done.body.run.earned.badges.some((one) => one.id === "test:broken"), false);
    } finally {
      achievementList.ACHIEVEMENTS.pop();
    }
  });

  await test("the board ranks everyone, and a guest may look at it", async () => {
    const stranger = client();
    const { status, body } = await stranger("GET", "/api/leaderboard");
    assert.equal(status, 200, "the board should not need an account to read");
    assert.ok(body.rows.length >= 2);

    for (let i = 1; i < body.rows.length; i += 1) {
      assert.ok(body.rows[i - 1].xp >= body.rows[i].xp, "rows should descend by XP");
      assert.equal(body.rows[i].rank, i + 1);
    }
  });

  await test("the board gives away a name and a level, and nothing else", async () => {
    const stranger = client();
    const { body } = await stranger("GET", "/api/leaderboard");
    const allowed = new Set([
      "id", "handle", "display", "colour", "character", "title", "level", "xp", "week", "rounds", "rank",
    ]);
    for (const row of body.rows) {
      for (const key of Object.keys(row)) {
        assert.ok(allowed.has(key), `the board leaked ${key}`);
      }
    }
    assert.equal(body.rows.some((r) => "passwordHash" in r || "salt" in r), false);
    assert.equal(JSON.stringify(body).includes("passwordHash"), false);
  });

  await test("the weekly board counts only the last seven days", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "lastweek", password: "long time ago" });

    const run = await player("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await player("POST", `/api/runs/${run.body.run.id}/guess`, { value: answerTo(run.body.run.id).answer });

    const me = (await player("GET", "/api/me")).body.user;
    const row = store.data.progress[me.id];
    const earned = row.xp;

    /* Age the award out of the window and it should leave the weekly total
     * while the all-time one keeps it. */
    row.awards[0].at = Date.now() - 8 * 86400000;

    const week = (await player("GET", "/api/leaderboard?window=week")).body;
    const mine = week.rows.find((r) => r.handle === "lastweek");
    assert.equal(mine.week, 0, "an eight-day-old round should not count this week");
    assert.equal(mine.xp, earned, "but it should still count all time");
  });

  await test("a player card is public, a pass is not", async () => {
    const stranger = client();
    const card = await stranger("GET", "/api/players/xper");
    assert.equal(card.status, 200);
    assert.equal(card.body.player.handle, "xper");
    assert.ok(typeof card.body.player.level === "number");
    assert.equal(card.body.player.passwordHash, undefined);

    assert.equal((await stranger("GET", "/api/players/nobody-at-all")).status, 404);
    assert.equal((await stranger("GET", "/api/pass")).status, 401);
    assert.equal((await stranger("PUT", "/api/pass/character", { character: {} })).status, 401);
  });

  await test("the level-up card is shown once", async () => {
    const player = client();
    await player("GET", "/api/me");
    await player("POST", "/api/auth/signup", { handle: "riser", password: "up we go" });
    const me = (await player("GET", "/api/me")).body.user;

    /* Straight to level 5, the way a long evening would. */
    store.data.progress[me.id] = store.data.progress[me.id] || {};
    const row = store.data.progress[me.id];
    row.xp = xpRules.THRESHOLDS[5];
    row.level = 5;

    const first = await player("GET", "/api/pass");
    assert.equal(first.body.pass.pending, 1, "there are four levels it has not shown yet");

    await player("POST", "/api/pass/seen");
    const second = await player("GET", "/api/pass");
    assert.equal(second.body.pass.pending, null, "and it should not come back");
  });

  /* ------------------------------------------------------- persistence */

  console.log("\npersistence");

  await test("a guest's round carries over when they sign up", async () => {
    const guest = client();
    await guest("GET", "/api/me");
    const { body } = await guest("POST", "/api/play/wordle", { mode: "unlimited", fresh: true });
    await guest("POST", `/api/runs/${body.run.id}/guess`, { value: "crane" });
    await guest("POST", "/api/auth/signup", { handle: "dana", password: "keep my round" });

    const resumed = await guest("GET", `/api/runs/${body.run.id}`);
    assert.equal(resumed.status, 200, "the round should still be theirs");
    assert.equal(resumed.body.run.puzzle.guesses.length, 1);
  });

  await test("the store round-trips through JSON", async () => {
    store.flushSync();
    const written = JSON.parse(fs.readFileSync(STORE, "utf8"));
    assert.ok(Object.keys(written.users).length >= 4);
    assert.ok(written.friendships.length >= 1);
    assert.ok(Object.keys(written.runs).length > 0);

    const travleRun = Object.values(written.runs).find((r) => r.game === "travle");
    if (travleRun) assert.ok(Array.isArray(travleRun.state.dead), "sets must be stored as arrays");
  });

  await test("the store is not reachable over HTTP", async () => {
    /* It holds password hashes and live session tokens. Serving data/ once
     * put the whole thing one GET away, so this is pinned down here. */
    for (const url of [
      "/data/store.json",
      "/data/wordle-answers.json",
      "/../data/store.json",
      "/data/../data/store.json",
    ]) {
      const res = await fetch(base + url, { redirect: "manual" });
      const body = await res.text();
      assert.equal(body.includes("passwordHash"), false, `${url} served the store`);
      assert.equal(body.includes("wordle-answers"), false, `${url} served a data file`);
    }
  });

  await test("a password is never written to disk in the clear", async () => {
    const raw = fs.readFileSync(STORE, "utf8");
    assert.equal(raw.includes("correct horse"), false);
    assert.equal(raw.includes("battery staple"), false);
  });

  /* ------------------------------------------------------------ finish */

  console.log(`\n${results.passed} passed, ${results.failed} failed`);
  server.close();
  try { fs.unlinkSync(STORE); } catch { /* already gone */ }
  process.exit(results.failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
