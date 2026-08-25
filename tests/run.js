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

const STORE = path.join(os.tmpdir(), `puzzle-club-test-${process.pid}.json`);
process.env.DATA_FILE = STORE;

const { server, store } = require("../server.js");
const games = require("../src/server/games/index.js");
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

    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

  await test("unlimited deals a new round every time", async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
      seen.add(body.run.id);
    }
    assert.equal(seen.size, 5);
  });

  await test("the answer is withheld until the round is over", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    assert.equal(body.run.puzzle.answer, null);
    const guess = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "crane" });
    assert.equal(guess.body.run.puzzle.answer, null, "still hidden mid-round");
    assert.equal(guess.body.result.ok, true);
    assert.equal(guess.body.result.marks.length, 5);
  });

  await test("a word outside the list is refused and costs nothing", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    const { body: guess } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "zzzzz" });
    assert.equal(guess.result.ok, false);
    assert.equal(guess.run.puzzle.guesses.length, 0);
  });

  await test("running out of guesses reveals the answer, and only then", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/connections", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/connections", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited" });
    const { body: nonsense } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: "Narnia" });
    assert.equal(nonsense.result.ok, false);
    assert.match(nonsense.result.message, /No country/);
  });

  await test("letter boxed accepts its own solution", async () => {
    const { body } = await alice("POST", "/api/play/boxed", { mode: "unlimited" });
    const puzzle = answerTo(body.run.id);
    for (const word of puzzle.solution) {
      const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: word });
      assert.equal(played.result.ok, true, `${word} should be playable: ${played.result.message || ""}`);
    }
    const final = await alice("GET", `/api/runs/${body.run.id}`);
    assert.equal(final.body.run.puzzle.status, "won");
  });

  await test("letter boxed refuses two letters from one side", async () => {
    const { body } = await alice("POST", "/api/play/boxed", { mode: "unlimited" });
    const puzzle = answerTo(body.run.id);
    const sameSide = puzzle.sides[0][0] + puzzle.sides[0][1] + puzzle.sides[1][0];
    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: sameSide });
    assert.equal(played.result.ok, false);
    assert.match(played.result.message, /same side/);
  });

  await test("the bee scores a pangram at length plus seven", async () => {
    const { body } = await alice("POST", "/api/play/bee", { mode: "unlimited" });
    const pangram = answerTo(body.run.id).pangrams[0];
    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: pangram });
    assert.equal(played.result.pangram, true);
    assert.equal(played.result.points, pangram.length + 7);
  });

  await test("the bee insists on the centre letter", async () => {
    const { body } = await alice("POST", "/api/play/bee", { mode: "unlimited" });
    const puzzle = answerTo(body.run.id);
    const without = puzzle.answers.find((w) => !w.includes(puzzle.centre));
    assert.equal(without, undefined, "no answer should be missing the centre letter");

    const { body: played } = await alice("POST", `/api/runs/${body.run.id}/guess`, { value: puzzle.outer.join("") });
    assert.equal(played.result.ok, false);
  });

  await test("both crosswords deal a filled, clued grid", async () => {
    for (const key of ["mini", "crossword"]) {
      const { body } = await alice("POST", `/api/play/${key}`, { mode: "unlimited" });
      const puzzle = body.run.puzzle;

      assert.equal(puzzle.size, key === "mini" ? 5 : 15);
      assert.ok(puzzle.entries.length > 0, `${key} should have entries`);
      assert.ok(puzzle.entries.every((entry) => entry.clue && entry.clue.length > 5),
        `every ${key} entry needs a clue`);
      assert.equal(puzzle.answers, null, "answers must not ship with the grid");
      assert.equal(puzzle.solution, null, "nor the filled grid");

      /* No entry's answer should be recoverable from what was sent. */
      const real = answerTo(body.run.id);
      const secret = real.entries[0].answer.toUpperCase();
      assert.equal(JSON.stringify(puzzle).toUpperCase().includes(secret), false,
        `${key} leaked an answer`);
    }
  });

  await test("a crossword can be typed into and solved", async () => {
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/mini", { mode: "unlimited" });
    const real = answerTo(body.run.id);
    const { body: given } = await alice("POST", `/api/runs/${body.run.id}/reveal`, {});

    assert.equal(given.run.puzzle.status, "done");
    assert.equal(given.run.puzzle.solution, real.letters.toUpperCase());
    assert.equal(given.run.summary.won, false, "giving up is not a win");
  });

  await test("strands deals a themed board using every square", async () => {
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited" });
    const puzzle = body.run.puzzle;

    assert.equal(puzzle.letters.length, puzzle.rows * puzzle.cols);
    assert.ok(puzzle.theme && puzzle.theme.length > 3);
    assert.equal(puzzle.answers, null, "the words must not ship with the board");

    const real = answerTo(body.run.id);
    const covered = new Array(puzzle.letters.length).fill(0);
    for (const entry of real.entries) for (const cell of entry.cells) covered[cell] += 1;
    assert.ok(covered.every((n) => n === 1), "every square belongs to exactly one word");
    assert.equal(real.entries.filter((e) => e.spangram).length, 1, "exactly one spangram");
    assert.equal(JSON.stringify(puzzle).includes(real.entries[1].word), false, "a word leaked");
  });

  await test("strands accepts a traced word and refuses a broken path", async () => {
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/strands", { mode: "unlimited" });
    const { body: early } = await alice("POST", `/api/runs/${body.run.id}/hint`, {});
    assert.equal(early.result.ok, false);
    assert.match(early.result.message, /earn a hint/);
  });

  await test("pips deals a board with exactly one answer", async () => {
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/pips", { mode: "unlimited" });
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
    const other = await alice("POST", "/api/play/pips", { mode: "unlimited" });
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
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    const stranger = client();
    await stranger("GET", "/api/me");
    assert.equal((await stranger("GET", `/api/runs/${body.run.id}`)).status, 403);
  });

  /* ------------------------------------------------------------- stats */

  console.log("\nstats");

  await test("finishing a round shows up in the tallies", async () => {
    const before = await alice("GET", "/api/stats");
    const played = before.body.games["wordle:unlimited"].played;

    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    await alice("POST", `/api/runs/${body.run.id}/guess`, { value: answerTo(body.run.id).answer });

    const after = await alice("GET", "/api/stats");
    assert.equal(after.body.games["wordle:unlimited"].played, played + 1);
    assert.ok(after.body.games["wordle:unlimited"].won >= 1);
    assert.ok(after.body.totals.played > 0);
  });

  await test("a win in one guess lands in the distribution", async () => {
    const { body } = await alice("POST", "/api/play/wordle", { mode: "unlimited" });
    await alice("POST", `/api/runs/${body.run.id}/guess`, { value: answerTo(body.run.id).answer });
    const { body: stats } = await alice("GET", "/api/stats");
    assert.ok(stats.games["wordle:unlimited"].distribution["1"] >= 1);
    assert.equal(stats.games["wordle:unlimited"].best, 1);
  });

  await test("a finished round is not counted twice", async () => {
    const { body } = await alice("POST", "/api/play/travle", { mode: "unlimited" });
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
    const { body } = await bob("POST", "/api/play/wordle", { mode: "unlimited" });
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

  /* ------------------------------------------------------- persistence */

  console.log("\npersistence");

  await test("a guest's round carries over when they sign up", async () => {
    const guest = client();
    await guest("GET", "/api/me");
    const { body } = await guest("POST", "/api/play/wordle", { mode: "unlimited" });
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
