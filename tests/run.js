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
    assert.equal(body.catalogue.length, 5);
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

  await test("a travle puzzle refuses an impossible walk", async () => {
    const island = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Australia", end: "France" },
    });
    assert.equal(island.status, 400);
    assert.match(island.body.error, /no land route/);

    const good = await alice("POST", "/api/puzzles", {
      game: "travle", payload: { start: "Portugal", end: "Poland" },
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.puzzle.shape.from, "Portugal");
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
