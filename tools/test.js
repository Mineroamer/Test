/* Test suite for the border data and the game engine. Run: node tools/test.js */
const E = require("../src/engine.js");
const { COUNTRIES, SPECIAL_LINKS } = require("../data/countries.js");

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) passed++;
  else failures.push(label + (detail ? "  -> " + detail : ""));
}

function equal(label, actual, expected) {
  check(label, actual === expected, "got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected));
}

/* ------------------------------------------------------------- border data */

check("every country has a name and a region",
  Object.values(COUNTRIES).every((c) => c.name && c.region && Array.isArray(c.borders)));

for (const [code, country] of Object.entries(COUNTRIES)) {
  check("iso code " + code + " is two capitals", /^[A-Z]{2}$/.test(code));
  check(country.name + " has no duplicate borders", new Set(country.borders).size === country.borders.length);
  check(country.name + " does not border itself", !country.borders.includes(code));
  for (const other of country.borders) {
    check(country.name + " -> " + other + " points at a real country", Boolean(COUNTRIES[other]));
    check(country.name + " <-> " + other + " is mutual",
      Boolean(COUNTRIES[other]) && COUNTRIES[other].borders.includes(code));
  }
}

const names = Object.values(COUNTRIES).map((c) => c.name);
equal("country names are unique", new Set(names).size, names.length);

/* Spot-checks against well-known border counts. */
for (const [code, count] of [["CN", 14], ["RU", 14], ["BR", 9], ["DE", 9], ["CD", 9], ["FR", 8],
                             ["AT", 8], ["TR", 8], ["RS", 8], ["ZM", 8], ["TZ", 8], ["SD", 7],
                             ["PL", 7], ["UA", 7], ["HU", 7], ["NE", 7], ["ML", 7], ["SA", 7],
                             ["PT", 1], ["LS", 1], ["VA", 1], ["CA", 1], ["KR", 1], ["DK", 1]]) {
  equal(COUNTRIES[code].name + " border count", COUNTRIES[code].borders.length, count);
}

check("island nations have no land borders",
  ["JP", "AU", "NZ", "IS", "MG", "CU", "PH", "LK", "MT", "CY", "SG", "TW"]
    .every((c) => COUNTRIES[c].borders.length === 0));

check("raw data excludes exclave borders",
  !COUNTRIES.ES.borders.includes("MA") && !COUNTRIES.FR.borders.includes("BR"));

/* ------------------------------------------------------- the Bering caveat */

equal("one house rule is defined", SPECIAL_LINKS.length, 1);
check("Russia can reach the United States", E.neighbours("RU").has("US"));
check("the United States can reach Russia", E.neighbours("US").has("RU"));
equal("Russia -> United States is one hop", E.distance("RU", "US"), 1);
check("the jump is flagged as a house rule", E.linkBetween("US", "RU").label === "Bering Strait");
check("plain land borders are not flagged", E.linkBetween("US", "CA") === null);
equal("the Americas join the rest of the world",
  E.shortestRoute("BR", "CN").join(">"), "BR>CO>PA>CR>NI>HN>GT>MX>US>RU>CN");
equal("Canada to Mongolia crosses the strait", E.shortestRoute("CA", "MN").join(">"), "CA>US>RU>MN");

/* ------------------------------------------------------------- graph shape */

equal("Portugal to Spain is one hop", E.distance("PT", "ES"), 1);
equal("Portugal to Italy is three hops", E.distance("PT", "IT"), 3);
equal("distance is symmetric", E.distance("EG", "ZA"), E.distance("ZA", "EG"));
equal("Japan is unreachable", E.distance("JP", "CN"), Infinity);
check("Britain and Ireland are their own island",
  E.distance("GB", "FR") === Infinity && E.distance("GB", "IE") === 1);
check("every puzzle pair is solvable",
  E.PAIRS.every(([a, b, legs]) => E.distance(a, b) === legs && legs >= 4 && legs <= 7));
check("there are plenty of puzzles", E.PAIRS.length > 1000);

/* ------------------------------------------------------------ name parsing */

for (const [input, expected] of [["usa", "US"], ["U.S.A.", "US"], ["the netherlands", "NL"],
                                 ["Holland", "NL"], ["DRC", "CD"], ["Congo", "CG"], ["burma", "MM"],
                                 ["Côte d'Ivoire", "CI"], ["czech republic", "CZ"], ["swaziland", "SZ"],
                                 ["portgual", "PT"], ["belguim", "BE"], ["  Peru  ", "PE"],
                                 ["türkiye", "TR"], ["st lucia", "LC"]]) {
  equal("resolve " + JSON.stringify(input), E.resolve(input), expected);
}
check("nonsense resolves to nothing", ["", "   ", "zzzz", "Atlantis", "42"].every((s) => E.resolve(s) === null));
equal("a country's own name beats an alias", E.suggest("ni")[0], "NI");
check("suggestions are capped", E.suggest("a", 4).length <= 4);

/* Whatever the box understands, the list must offer first - otherwise pressing
   Enter on "US" plays whatever happens to head the suggestions. */
{
  const disagreements = [];
  for (const [code, country] of Object.entries(COUNTRIES)) {
    for (const form of [country.name, code, ...(E.ALIASES[code] || [])]) {
      const resolved = E.resolve(form);
      const suggested = E.suggest(form)[0];
      if (resolved && suggested && resolved !== suggested) {
        disagreements.push(form + " -> " + resolved + " but suggests " + suggested);
      }
    }
  }
  equal("every name and code tops its own suggestion list", disagreements.length, 0,
    disagreements.slice(0, 5).join("; "));
  for (const [typed, expected] of [["US", "US"], ["PT", "PT"], ["NE", "NE"], ["CH", "CH"],
                                   ["DE", "DE"], ["ZA", "ZA"], ["usa", "US"], ["uk", "GB"]]) {
    equal("typing " + typed + " offers " + expected + " first", E.suggest(typed)[0], expected);
  }
}

/* -------------------------------------------------------------- game rules */

function newGame(start, end, difficulty) {
  return new E.Game({ id: 1, mode: difficulty || "standard", daily: false, start, end, legs: E.distance(start, end) }, difficulty);
}

{
  const game = newGame("PT", "IT");
  equal("par is the borders to cross", game.par, 3);
  equal("budget is par plus slack", game.budget, 8);
  equal("you start at the start", game.current, "PT");
  equal("the trail begins with one country", game.trail.join(">"), "PT");
  equal("the whole way is still ahead", game.toGo, 3);

  check("gibberish is refused", game.play("Narnia").ok === false);
  check("standing still is refused", game.play("Portugal").ok === false);
  equal("neither cost a guess", game.used, 0);

  const far = game.play("Italy");
  equal("naming a country you do not border is a miss", far.move, E.MOVE.MISS);
  equal("a miss leaves you where you were", game.current, "PT");
  equal("a miss costs a guess", game.used, 1);
  check("the same miss twice is free", game.play("Italy").ok === false);
  equal("still one guess spent", game.used, 1);

  const step = game.play("Spain");
  equal("a bordering country moves you", game.current, "ES");
  equal("and that step brought the finish closer", step.move, E.MOVE.CLOSER);
  equal("the trail grows", game.trail.join(">"), "PT>ES");
  equal("Italy is reachable from Spain's neighbour", game.toGo, 2);

  game.play("France");
  equal("two countries in", game.trail.join(">"), "PT>ES>FR");
  equal("guesses spent so far", game.used, 3);

  check("Back steps you off France", game.back());
  equal("you are in Spain again", game.current, "ES");
  equal("the trail shortened", game.trail.join(">"), "PT>ES");
  equal("stepping back is free", game.used, 3);

  game.play("France");
  const win = game.play("Italy");
  equal("Italy borders France, so that finishes it", game.status, "won");
  equal("the walk that got you there", game.trail.join(">"), "PT>ES>FR>IT");
  equal("no borders beyond the minimum", game.overshoot(), 0);
  equal("the winning step is recorded", win.move, E.MOVE.CLOSER);
  check("a finished round takes no more guesses", game.play("Spain").ok === false);
  check("and cannot be stepped back out of", game.back() === false);
}

{
  // Naming a country already on the trail walks you back to it.
  const game = newGame("PT", "IT");
  game.play("Spain");
  game.play("France");
  game.play("Germany");
  equal("three steps in", game.trail.join(">"), "PT>ES>FR>DE");
  const back = game.play("France");
  equal("naming France again walks back to it", back.move, E.MOVE.BACK);
  equal("the trail is truncated, not extended", game.trail.join(">"), "PT>ES>FR");
  equal("that one did cost a guess", game.used, 4);
  const jump = game.play("Spain");
  equal("naming Spain from France walks back two", jump.move, E.MOVE.BACK);
  equal("the trail rewinds to Spain", game.trail.join(">"), "PT>ES");
}

{
  const game = newGame("PT", "IT");
  equal("you cannot step back from the start", game.back(), false);
  game.play("Spain");
  check("once you have moved, Back works", game.back());
  equal("and puts you back at the start", game.current, "PT");
  equal("Back at the start does nothing", game.back(), false);
}

{
  // Back is free, so it must never be the move that strands you: when
  // retreating would put the finish out of reach, the way back closes.
  const game = newGame("PT", "IT", "expert");
  equal("Expert leaves little room", game.budget, 5);
  game.play("Spain");
  game.play("France");
  equal("two guesses spent, three left", game.left, 3);
  check("stepping back to Spain is still safe", game.canBack());
  game.play("Germany");
  game.play("Poland");
  equal("four spent, one left", game.left, 1);
  equal("but Poland is further out than that", game.toGo > game.left, true);
  equal("so the round is already over", game.status, "lost");
}

{
  const game = newGame("PT", "IT", "expert");
  game.play("Spain");
  game.play("France");
  game.play("Germany");
  equal("three guesses spent, two left", game.left, 2);
  equal("Germany is two hops from Italy", game.toGo, 2);
  check("backing up to France is safe - France is one hop out", game.canBack());
  game.play("Austria");
  equal("four spent, one left", game.left, 1);
  equal("Austria borders Italy", game.toGo, 1);
  equal("but Germany, behind you, does not", E.distance("DE", "IT"), 2);
  equal("so the way back is closed rather than fatal", game.canBack(), false);
  equal("and Back does nothing", game.back(), false);
  equal("the round is still live", game.status, "playing");
  equal("you are still in Austria", game.current, "AT");
  game.play("Italy");
  equal("and it can still be won", game.status, "won");
}

{
  const game = newGame("PT", "IT", "expert");
  equal("Expert cuts the slack", game.budget, 5);
  ["Italy", "Germany", "Greece", "Kenya", "Japan"].forEach((c) => game.play(c));
  equal("running out of guesses strands you", game.status, "lost");
  equal("you never left the start", game.current, "PT");
}

{
  // Wandering too far to get back in budget ends the round early.
  const game = newGame("PT", "IT", "expert");
  game.play("Spain");
  game.play("France");
  game.play("Germany");
  game.play("Poland");
  check("Poland is further from Italy than the guesses left", game.toGo > game.left);
  equal("that strands you", game.status, "lost");
  check("with guesses still on the counter", game.left > 0);
}

{
  const game = newGame("MX", "MN");
  equal("Mexico to Mongolia is three borders", game.par, 3);
  const step = game.play("United States");
  equal("first north", step.move, E.MOVE.CLOSER);
  const jump = game.play("Russia");
  check("the Bering rule carries you across", jump.link !== null && jump.link.label === "Bering Strait");
  equal("into Russia", game.current, "RU");
  game.play("Mongolia");
  equal("and on to Mongolia", game.status, "won");
  equal("a perfect crossing", game.overshoot(), 0);
}

{
  const game = newGame("FR", "PL");
  equal("France to Poland is two borders", game.par, 2);
  ["Italy", "Austria", "Czechia", "Poland"].forEach((c) => game.play(c));
  equal("the scenic way still gets there", game.status, "won");
  equal("two borders more than needed", game.overshoot(), 2);
  equal("the trail is the one you walked", game.trail.join(">"), "FR>IT>AT>CZ>PL");
}

{
  const game = newGame("EG", "ZA");
  const before = game.toGo;
  game.play("Sudan");
  equal("a step towards it shortens the way", game.toGo, before - 1);
  game.play("Libya");
  equal("a step away lengthens it", game.toGo, before);
  equal("and is reported as such", game.moves[game.moves.length - 1].move, E.MOVE.AWAY);
}

/* ------------------------------------------------------------ daily levels */

{
  const modes = Object.keys(E.DIFFICULTIES);
  equal("four levels", modes.join(","), "scenic,standard,expert,unlimited");
  check("three of them are daily", modes.filter((m) => E.DIFFICULTIES[m].daily).length === 3);
  check("unlimited is not", E.DIFFICULTIES.unlimited.daily === false);
  check("each level draws from a healthy pool",
    modes.every((m) => E.poolFor(m).length > 500));
  check("harder levels walk further",
    E.DIFFICULTIES.scenic.legs[1] < E.DIFFICULTIES.expert.legs[1]
    && E.DIFFICULTIES.expert.slack < E.DIFFICULTIES.scenic.slack);

  for (const mode of ["scenic", "standard", "expert"]) {
    const a = E.puzzleForDay(500, mode);
    const b = E.puzzleForDay(500, mode);
    equal(mode + ": the same day gives the same route", a.start + a.end, b.start + b.end);
    check(mode + ": the route fits the level",
      a.legs >= E.DIFFICULTIES[mode].legs[0] && a.legs <= E.DIFFICULTIES[mode].legs[1],
      a.legs + " borders");
  }

  let sharedRoutes = 0;
  const seen = { scenic: new Set(), standard: new Set(), expert: new Set() };
  for (let day = 0; day < 400; day++) {
    const routes = ["scenic", "standard", "expert"].map((m) => {
      const puzzle = E.puzzleForDay(day, m);
      seen[m].add(puzzle.start + ">" + puzzle.end);
      check("day " + day + " " + m + " is playable",
        E.distance(puzzle.start, puzzle.end) === puzzle.legs);
      return puzzle.start + ">" + puzzle.end;
    });
    if (new Set(routes).size < 3) sharedRoutes++;
  }
  equal("the three levels never share a route on the same day", sharedRoutes, 0);
  for (const mode of ["scenic", "standard", "expert"]) {
    equal(mode + ": 400 days are 400 different routes", seen[mode].size, 400);
    const pool = E.poolFor(mode).length;
    const cycle = new Set();
    for (let day = 0; day < pool; day++) {
      const puzzle = E.puzzleForDay(day, mode);
      cycle.add(puzzle.start + ">" + puzzle.end);
    }
    equal(mode + ": every route in the pool comes up before any repeats", cycle.size, pool);
    const wrapped = E.puzzleForDay(pool, mode);
    const first = E.puzzleForDay(0, mode);
    // The pair comes round again; which end you start from is decided per day.
    equal(mode + ": the deal then wraps round",
      [wrapped.start, wrapped.end].sort().join(""), [first.start, first.end].sort().join(""));
    check(mode + ": that is years of daily routes", pool > 800, pool + " days");
  }

  check("today's routes all build",
    ["scenic", "standard", "expert"].every((m) => Boolean(E.puzzleForDay(E.dayNumber(), m).start)));

  const first = E.randomPuzzle("unlimited");
  check("unlimited deals a playable route",
    E.distance(first.start, first.end) === first.legs && first.daily === false);
  const spread = new Set();
  for (let i = 0; i < 60; i++) spread.add(JSON.stringify(E.randomPuzzle("unlimited")));
  check("unlimited keeps dealing different routes", spread.size > 40, spread.size + " of 60");

  const ms = E.msUntilReset();
  check("the reset clock is inside a day", ms > 0 && ms <= 86400000, ms);
}

/* ------------------------------------------------------- randomised rounds */

/*
 * Play thousands of rounds with random input - real countries, neighbours,
 * junk, and undo - and assert the things that must hold at every moment. This
 * is what caught Back being able to strand the player.
 */
{
  const modes = Object.keys(E.DIFFICULTIES);
  const junk = ["", "   ", "Narnia", "zzz", "42", "!!!", "the", "a", null, undefined];
  const seen = new Set();
  const complain = (label, detail) => {
    if (seen.has(label)) return;
    seen.add(label);
    check("fuzz: " + label, false, detail);
  };
  let won = 0;
  let lost = 0;

  for (let seed = 1; seed <= 2000; seed++) {
    const rand = E.mulberry32(seed * 7919);
    const mode = modes[Math.floor(rand() * modes.length)];
    const puzzle = rand() < 0.5
      ? E.puzzleForDay(Math.floor(rand() * 900), mode)
      : E.randomPuzzle(mode, rand);
    const game = new E.Game(puzzle, mode);
    let guard = 0;

    while (game.status === "playing" && guard++ < 200) {
      if (game.used > game.budget) complain("budget exceeded", game.used + " > " + game.budget);
      if (game.trail[0] !== game.start) complain("trail lost its start", game.trail.join(">"));
      if (game.current !== game.trail[game.trail.length - 1]) complain("current is not the trail end", game.current);
      if (new Set(game.trail).size !== game.trail.length) complain("a country repeats on the trail", game.trail.join(">"));
      for (let i = 1; i < game.trail.length; i++) {
        if (!E.neighbours(game.trail[i - 1]).has(game.trail[i])) {
          complain("trail has a gap", game.trail[i - 1] + "->" + game.trail[i]);
        }
      }
      if (game.toGo > game.left) complain("still playing with the finish out of reach", game.toGo + " > " + game.left);

      const roll = rand();
      if (roll < 0.06) {
        const before = { used: game.used, trail: game.trail.join(">") };
        const result = game.play(junk[Math.floor(rand() * junk.length)]);
        if (result.ok) complain("junk was accepted", JSON.stringify(result));
        if (game.used !== before.used) complain("junk cost a guess", before.used + " -> " + game.used);
        if (game.trail.join(">") !== before.trail) complain("junk moved the player", game.trail.join(">"));
      } else if (roll < 0.14 && game.trail.length > 1) {
        const wasUsed = game.used;
        const wasTrail = game.trail.join(">");
        const allowed = game.canBack();
        const did = game.back();
        if (did !== allowed) complain("back disagreed with canBack", allowed + " vs " + did);
        if (game.used !== wasUsed) complain("back cost a guess", wasUsed + " -> " + game.used);
        if (!did && game.trail.join(">") !== wasTrail) complain("a refused back still moved the player", game.trail.join(">"));
        if (did && game.toGo > game.left) complain("back stranded the player", game.trail.join(">"));
      } else if (roll < 0.30) {
        const all = Object.keys(COUNTRIES);
        game.play(all[Math.floor(rand() * all.length)]);
      } else {
        const exits = game.exits();
        const closer = exits.filter((c) => E.distance(c, game.end) < E.distance(game.current, game.end));
        const pool = rand() < 0.7 && closer.length ? closer : exits;
        const pick = pool[Math.floor(rand() * pool.length)];
        const standing = game.current;
        const result = game.play(pick);
        if (!result.ok) complain("a neighbour was refused", standing + " -> " + pick);
        else if (result.move === E.MOVE.MISS) complain("a neighbour counted as a miss", standing + " -> " + pick);
      }
    }

    if (guard >= 200) complain("round never ended", mode + " " + game.start + "->" + game.end);
    if (game.status === "won") {
      won++;
      if (game.current !== game.end) complain("won without arriving", game.current);
      if (game.overshoot() < 0) complain("overshoot below zero", String(game.overshoot()));
    } else if (game.status === "lost") {
      lost++;
      if (game.current === game.end) complain("lost while standing at the finish", game.trail.join(">"));
      if (game.left > 0 && game.toGo <= game.left) complain("lost with a route still open", game.toGo + " <= " + game.left);
    } else {
      complain("round left hanging", game.status);
    }
    if (game.play("Spain").ok) complain("a finished round still takes guesses", game.status);
    if (game.back()) complain("a finished round can still step back", game.status);
  }

  check("2000 random rounds all reached an ending", won + lost === 2000, won + " won, " + lost + " lost");
  check("random play wins sometimes and loses sometimes", won > 200 && lost > 200, won + "/" + lost);
}

console.log(passed + " checks passed" + (failures.length ? ", " + failures.length + " FAILED" : ""));
if (failures.length) {
  for (const f of failures.slice(0, 25)) console.log("  x " + f);
  process.exit(1);
}
