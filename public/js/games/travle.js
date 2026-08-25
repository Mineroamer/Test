/*
 * Travle Overland.
 *
 * This is the standalone game, brought across whole: the same layout, the same
 * controls, the same wording, the same result panel and the same share block.
 * The engine and the map are literally the original files. What changed is
 * only what had to, to make it part of a club rather than a page of its own:
 *
 *   - The puzzle comes from the server, so everyone gets the same daily route
 *     and a round can be picked up on another device.
 *   - A move is judged by the server, which is the same engine this file has
 *     loaded, so the answer is identical - it just also gets written down.
 *   - Streaks live in the account rather than in localStorage, and are kept
 *     per level, because Scenic, Standard and Expert are three different walks
 *     rather than one walk at three settings.
 *
 * The rendering below is the original's, close to unchanged. It reads from a
 * real Engine.Game, rebuilt from the server's state after every move, which is
 * what lets it stay unchanged.
 */

import { h, swap, copy } from "../ui.js";
import { api } from "../api.js";

const E = window.Engine;
const WorldMap = window.WorldMap;

export function create(ctx) {
  let run = ctx.run;
  let game = rebuild(run);
  let map = null;
  let justEntered = null;
  let highlight = -1;
  let matches = [];
  /* The four figures the result panel shows, fetched when a round ends. Held
   * here with the rest of the state, above the return, because a `let` after
   * it would never come into existence. */
  let tallies = null;

  /* --------------------------------------------------------------- markup */

  const el = {};
  const root = h("div.travle-game.stack", { style: { gap: "18px" } });

  el.puzzleNo = h("span.plate", {}, "No. —");
  el.fromName = h("strong", {}, "—");
  el.toName = h("strong", {}, "—");
  el.par = h("p.par.plate");

  const objective = h("section.objective",
    h("div.terminus",
      h("span.terminus-label", {}, "From"),
      el.fromName),
    h("div.objective-rule", { "aria-hidden": "true" }),
    h("div.terminus.terminus-end",
      h("span.terminus-label", {}, "To"),
      el.toName),
    el.par);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "travle-map");
  svg.setAttribute("tabindex", "0");

  el.zoomIn = h("button", { type: "button", title: "Zoom in", "aria-label": "Zoom in" }, "+");
  el.zoomOut = h("button", { type: "button", title: "Zoom out", "aria-label": "Zoom out" }, "−");
  el.zoomFit = h("button", { type: "button", title: "Frame the whole route", "aria-label": "Frame the whole route" }, "Fit");

  const mapFrame = h("section.map-frame", { "aria-label": "Map" },
    svg,
    h("div.map-controls", el.zoomIn, el.zoomOut, el.zoomFit),
    h("ul.legend",
      h("li", { dataset: { key: "start" } }, "Start"),
      h("li", { dataset: { key: "here" } }, "You are here"),
      h("li", { dataset: { key: "trail" } }, "Countries crossed"),
      h("li", { dataset: { key: "finish" } }, "Finish"),
      h("li", { dataset: { key: "bering" } }, "Crossing by sea"),
      h("li.legend-hint", {}, "Drag to move · scroll to zoom")));

  el.difficulty = h("div.difficulty", { role: "group", "aria-label": "Difficulty" });

  el.field = h("input.field", {
    id: "travle-field",
    type: "text",
    placeholder: "Name a bordering country…",
    role: "combobox",
    "aria-haspopup": "listbox",
    "aria-controls": "travle-suggest",
    "aria-expanded": "false",
    "aria-autocomplete": "list",
    spellcheck: false,
  });
  el.submit = h("button.go", { type: "submit" }, "Cross");
  el.back = h("button.go.ghost", {
    type: "button",
    title: "Step back to the country you came from. Free.",
  }, "Back");
  el.suggest = h("ul.suggest", { id: "travle-suggest", role: "listbox", "aria-label": "Matching countries", hidden: true });
  el.say = h("p.say", { role: "status", "aria-live": "polite" });

  el.form = h("form.console", { autocomplete: "off" },
    h("div.console-row",
      h("label.sr-only", { for: "travle-field" }, "Name a country that borders the one you are standing in"),
      el.field, el.submit, el.back),
    el.suggest,
    el.say);

  el.left = h("dd", {}, "0");
  el.toGo = h("dd", {}, "0");
  el.here = h("dd.counter-name", {}, "—");
  el.leftBox = h("div.counter", h("dt", {}, "Guesses left"), el.left);
  el.toGoBox = h("div.counter", h("dt", {}, "Borders to go"), el.toGo);

  const counters = h("dl.counters",
    el.leftBox,
    el.toGoBox,
    h("div.counter.counter-wide", h("dt", {}, "Standing in"), el.here));

  el.trail = h("ol.trail");
  el.refused = h("ul.trail.refused");
  el.refusedWrap = h("section.ledger", { hidden: true }, h("h2", {}, "Turned back"), el.refused);

  el.verdict = h("p.verdict");
  el.blurb = h("p");
  el.tally = h("div.tally");
  el.reset = h("p.reset-note.plate", { hidden: true });
  el.share = h("button.go", { type: "button" }, "Copy result");
  el.again = h("button.go.ghost", { type: "button" }, "Play unlimited");
  el.shareBox = h("textarea.field", { rows: 4, readonly: true, hidden: true, "aria-label": "Result text" });

  el.outcome = h("section.outcome", { "aria-live": "polite", hidden: true },
    h("h2", {}, "Result"),
    el.verdict, el.blurb, el.tally, el.reset,
    h("div.actions", el.share, el.again),
    el.shareBox);

  swap(root,
    objective,
    mapFrame,
    el.difficulty,
    el.form,
    counters,
    h("section.ledger", h("h2", {}, "Your trail"), el.trail),
    el.refusedWrap,
    el.outcome,
    rulesPanel(),
    h("p.colophon", {}, "A new route every day · 197 countries · outlines from Natural Earth"));

  buildDifficulty();
  wire();
  render(true);
  if (game.status !== "playing") loadTallies();

  requestAnimationFrame(() => {
    if (!svg.isConnected) return;
    map = new WorldMap(svg);
    map.paint(game, null, null);
    map.fit(routeCodes(), false);
  });

  return {
    el: root,
    /* The game brought its own result panel and its own share block. */
    ownFooter: true,
    shareText,
    update(next, result) {
      run = next;
      game = rebuild(run);
      el.field.value = "";
      closeSuggestions();

      if (result && result.ok) {
        justEntered = result.move === E.MOVE.MISS ? null : result.code;
        report(result);
        if (result.move === E.MOVE.MISS) shake();
      }
      render();
      if (game.status !== "playing") loadTallies();

      if (game.status === "won") speak("");
      else if (game.outOfReach) {
        speak(E.nameOf(game.current) + " is further from the finish than your "
          + game.left + (game.left === 1 ? " remaining guess" : " remaining guesses")
          + " can carry you. Keep walking if you like — you have them to spend.", "miss");
      }
    },
    reject(message) {
      speak(message, "miss");
      shake();
    },
  };

  /* ---------------------------------------------------------------- state */

  /*
   * Rebuild the engine's own Game from what the server sent.
   *
   * This is the hinge of the whole port: with a real Game to read from, every
   * render function below is the original's, unchanged. The Game is never
   * asked to judge a move - the server does that - it just derives the same
   * numbers from the same state.
   */
  function rebuild(current) {
    const p = current.puzzle;
    const puzzle = {
      start: p.start,
      end: p.end,
      id: current.day !== null && current.day !== undefined ? current.day : 0,
      daily: current.mode === "daily",
      mode: p.difficulty,
      legs: p.par,
    };
    const rebuilt = new E.Game(puzzle, p.difficulty);
    rebuilt.trail = p.trail.slice();
    rebuilt.moves = p.moves.map((m) => ({ code: m.code, move: m.move, from: m.from }));
    rebuilt.status = p.status;
    return rebuilt;
  }

  /* A declaration, not a const: everything below here sits after the factory's
   * return, so a const would never be initialised at all. */
  function routeCodes() {
    return game.status === "playing"
      ? [...game.trail, game.end]
      : [...game.trail, game.end, ...game.solution()];
  }

  /* --------------------------------------------------------------- render */

  function render(reframe) {
    renderBrief();
    renderTrail();
    renderCounters();
    renderOutcome();
    paintDifficulty();

    if (map) {
      map.paint(game, justEntered, game.status === "playing" ? null : game.solution());
      if (reframe) map.fit(routeCodes(), false);
      else map.follow(routeCodes());
    }
    justEntered = null;
  }

  function renderBrief() {
    el.puzzleNo.textContent = game.puzzle.daily
      ? game.difficulty.label + " · No. " + game.puzzle.id
      : "Unlimited";
    el.fromName.textContent = E.nameOf(game.start);
    el.toName.textContent = E.nameOf(game.end);
    el.par.textContent = game.par + " border" + (game.par === 1 ? "" : "s") + " at best · "
      + game.budget + " guesses";
  }

  function chip(list, code, role, note, hop) {
    const li = document.createElement("li");
    if (role) li.dataset.role = role;
    if (hop) {
      const mark = document.createElement("i");
      mark.className = "hop";
      mark.textContent = hop;
      li.appendChild(mark);
    }
    const box = document.createElement("span");
    box.className = "chip";
    const name = document.createElement("span");
    name.textContent = E.nameOf(code);
    box.appendChild(name);
    if (note) {
      const tag = document.createElement("b");
      tag.textContent = note;
      box.appendChild(tag);
    }
    li.appendChild(box);
    list.appendChild(li);
    return li;
  }

  function renderTrail() {
    el.trail.textContent = "";
    game.trail.forEach((code, i) => {
      /* Only a crossing by sea gets a marker. A plain border needs none: the
       * order of the chips already says you walked from one to the next. */
      const link = i > 0 ? E.linkBetween(game.trail[i - 1], code) : null;
      const hop = link ? link.label : null;
      const role = code === game.current ? "here" : i === 0 ? "start" : "step";
      const note = i === 0 ? "start" : code === game.end ? "finish" : "";
      chip(el.trail, code, role, note, hop);
    });

    const misses = game.moves.filter((m) => m.move === E.MOVE.MISS);
    el.refusedWrap.hidden = misses.length === 0;
    el.refused.textContent = "";
    for (const miss of misses) chip(el.refused, miss.code, "miss", "");
  }

  function renderCounters() {
    el.left.textContent = game.left;
    el.leftBox.dataset.alarm = String(game.status === "playing" && game.left <= 2);
    el.toGo.textContent = game.difficulty.showDistance ? game.toGo : "?";
    el.here.textContent = E.nameOf(game.current);
    el.back.disabled = !game.canBack();
    el.back.title = game.canBack()
      ? "Step back to " + E.nameOf(game.trail[game.trail.length - 2]) + ". Free."
      : "Step back to the country you came from. Free.";
    el.toGoBox.dataset.alarm = String(game.outOfReach);
  }

  function renderOutcome() {
    const over = game.status !== "playing";
    el.outcome.hidden = !over;
    el.form.hidden = over;
    el.field.disabled = over;
    el.submit.disabled = over;
    if (!over) return;

    el.outcome.dataset.result = game.status;
    if (game.status === "won") {
      const extra = game.overshoot();
      const wrong = game.moves.filter((m) => m.move === E.MOVE.MISS).length;
      const retraced = game.used - wrong - (game.trail.length - 1);
      const aside = [];
      if (wrong) aside.push(wrong + (wrong === 1 ? " wrong turn" : " wrong turns"));
      if (retraced) aside.push(retraced + (retraced === 1 ? " step retraced" : " steps retraced"));
      const walked = game.trail.map(E.nameOf).join(" → ");

      if (extra === 0 && !aside.length) {
        el.verdict.textContent = "Flawless crossing";
        el.blurb.textContent = "The shortest way there, and not a guess wasted. " + walked;
      } else if (extra === 0) {
        el.verdict.textContent = "Shortest way";
        el.blurb.textContent = "You walked the shortest line, at the cost of "
          + aside.join(" and ") + ". " + walked;
      } else {
        el.verdict.textContent = "You made it across";
        el.blurb.textContent = "Your way ran " + extra + (extra === 1 ? " border" : " borders")
          + " longer than it had to. " + walked;
      }
    } else {
      el.verdict.textContent = "Stranded";
      el.blurb.textContent = "Out of guesses in " + E.nameOf(game.current)
        + ". The shortest way was " + game.solution().map(E.nameOf).join(" → ") + ".";
    }

    el.tally.textContent = "";
    const rows = [["Guesses", game.used + " of " + game.budget]];
    /* The same four figures the standalone game showed, now read from the
     * account rather than from this browser - and kept per level, so a
     * Standard streak is a Standard streak. */
    if (game.puzzle.daily) {
      const record = statsFor(game.difficultyKey);
      if (record) {
        rows.push(
          [game.difficulty.label + " played", record.played],
          ["Crossed", record.won],
          ["Streak", record.streak],
          ["Best streak", record.maxStreak]);
      }
    }
    for (const [label, value] of rows) {
      const span = document.createElement("span");
      span.textContent = label + " ";
      const b = document.createElement("b");
      b.textContent = value;
      span.appendChild(b);
      el.tally.appendChild(span);
    }

    el.again.textContent = game.puzzle.daily ? "Play unlimited" : "Next route";
    el.reset.hidden = !game.puzzle.daily;
    if (game.puzzle.daily) el.reset.textContent = resetLine();
  }

  /*
   * The four figures the result panel shows. Fetched when a round ends rather
   * than held in the session, and simply absent for a guest - who has no
   * record to show, and whose panel does without those rows.
   */
  function statsFor(level) {
    return tallies ? tallies[`travle:daily:${level}`] || null : null;
  }

  async function loadTallies() {
    if (!game.puzzle.daily) return;
    try {
      const answer = await api.stats();
      tallies = answer.games;
      if (game.status !== "playing") renderOutcome();
    } catch {
      tallies = null;                 // a guest, or offline: the rows are dropped
    }
  }

  function resetLine() {
    const ms = E.msUntilReset();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return "Next daily routes in " + (hours ? hours + "h " : "") + mins + "m";
  }

  /* ----------------------------------------------------------- difficulty */

  function buildDifficulty() {
    el.difficulty.textContent = "";
    for (const [key, mode] of Object.entries(E.DIFFICULTIES)) {
      const button = h("button", {
        type: "button",
        class: "level",
        dataset: { level: key },
        onClick: () => {
          if (key === game.difficultyKey && run.mode === (mode.daily ? "daily" : "unlimited")) return;
          try { localStorage.setItem("pc:travle-difficulty", key); } catch { /* private browsing */ }
          ctx.restart({ mode: mode.daily ? "daily" : "unlimited", difficulty: key });
        },
      },
        h("span.level-name", {}, mode.label),
        h("span.level-note", {}, mode.daily ? "par +" + mode.slack : "off the clock"));
      el.difficulty.appendChild(button);
    }
  }

  function paintDifficulty() {
    for (const button of el.difficulty.querySelectorAll("button")) {
      button.dataset.on = String(button.dataset.level === game.difficultyKey);
    }
  }

  /* --------------------------------------------------------------- saying */

  function speak(message, tone) {
    el.say.textContent = message || "";
    if (tone) el.say.dataset.tone = tone;
    else delete el.say.dataset.tone;
  }

  function report(result) {
    const name = E.nameOf(result.code);
    const from = E.nameOf(result.from);
    if (result.move === E.MOVE.MISS) return speak(result.message, "miss");
    if (result.move === E.MOVE.BACK) return speak("Back in " + name + ".", "back");
    if (result.link) {
      return speak("Across the " + result.link.label + " into " + name + ".", "jump");
    }
    if (!game.difficulty.showDistance) return speak("Into " + name + ".", "sideways");
    if (result.move === E.MOVE.CLOSER) return speak(name + " brings the finish closer.", "closer");
    if (result.move === E.MOVE.SIDEWAYS) return speak(name + " is no nearer than " + from + " was.", "sideways");
    return speak(name + " takes you further away.", "away");
  }

  function shake() {
    el.field.classList.remove("shake");
    void el.field.offsetWidth;
    el.field.classList.add("shake");
  }

  /* ---------------------------------------------------------- suggestions */

  function closeSuggestions() {
    el.suggest.hidden = true;
    el.suggest.textContent = "";
    el.field.setAttribute("aria-expanded", "false");
    matches = [];
    highlight = -1;
  }

  function renderSuggestions() {
    const text = el.field.value.trim();
    matches = text ? E.suggest(text, 6) : [];

    if (!matches.length) return closeSuggestions();

    el.suggest.textContent = "";
    matches.forEach((code, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === highlight));
      li.textContent = E.nameOf(code);
      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        submit(code);
      });
      el.suggest.appendChild(li);
    });
    el.suggest.hidden = false;
    el.field.setAttribute("aria-expanded", "true");
  }

  function moveHighlight(step) {
    if (!matches.length) return;
    highlight = (highlight + step + matches.length) % matches.length;
    renderSuggestions();
  }

  /* ---------------------------------------------------------------- input */

  function submit(forced) {
    const raw = forced || el.field.value;
    if (!String(raw).trim()) return;
    ctx.actions.guess(raw);
  }

  function wire() {
    el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (highlight >= 0 && matches[highlight]) return submit(matches[highlight]);
      submit();
    });

    el.field.addEventListener("input", () => {
      highlight = -1;
      renderSuggestions();
    });

    el.field.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); moveHighlight(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); }
      else if (event.key === "Escape") closeSuggestions();
    });

    el.field.addEventListener("blur", () => setTimeout(closeSuggestions, 140));

    el.back.addEventListener("click", () => ctx.actions.back());

    el.zoomIn.addEventListener("click", () => map && map.zoomBy(1 / 1.35));
    el.zoomOut.addEventListener("click", () => map && map.zoomBy(1.35));
    el.zoomFit.addEventListener("click", () => {
      if (!map) return;
      map.userMoved = false;
      map.fit(routeCodes(), true);
    });

    el.share.addEventListener("click", async () => {
      const text = shareText();
      const ok = await copy(text);
      el.share.textContent = ok ? "Copied" : "Select and copy";
      if (!ok) {
        el.shareBox.hidden = false;
        el.shareBox.value = text;
        el.shareBox.select();
      }
      setTimeout(() => { el.share.textContent = "Copy result"; }, 2000);
    });

    el.again.addEventListener("click", () => {
      ctx.restart(game.puzzle.daily
        ? { mode: "unlimited", difficulty: "unlimited" }
        : { mode: "unlimited", difficulty: game.difficultyKey });
    });

    window.addEventListener("resize", () => {
      if (!root.isConnected || !map) return;
      map.onResize(routeCodes());
    });
  }

  /* --------------------------------------------------------------- share */

  function shareText() {
    const title = game.puzzle.daily ? "Travle Overland No. " + game.puzzle.id : "Travle Overland";
    const trip = E.nameOf(game.start) + " → " + E.nameOf(game.end);
    const score = game.status === "won"
      ? "Crossed in " + game.used + "/" + game.budget + " guesses"
        + (game.overshoot() === 0 ? " · shortest way" : " · +" + game.overshoot() + " over par")
      : "Stranded · " + game.used + "/" + game.budget + " guesses";
    return [title, trip, score, game.moves.map((m) => SQUARES[m.move]).join("")].join("\n");
  }

  /* ---------------------------------------------------------------- rules */

  function rulesPanel() {
    const body = h("div.rules-body");
    body.innerHTML = RULES_HTML;
    return h("details.rules", h("summary", {}, "How to play"), body);
  }
}

const SQUARES = { closer: "\u{1F7E9}", sideways: "\u{1F7E8}", away: "\u{1F7E7}", back: "⬜", miss: "\u{1F7E5}" };

/* The original's own words, kept as written. */
const RULES_HTML = `
<p>You start in one country and have to reach another on foot. Name a country that borders the one you are standing in and you move into it, and it lights up on the map. Name one that does not and you stay put, a guess the poorer.</p>
<ul>
  <li><strong>Back</strong> returns you to the country you came from. It is free, and you can keep going back as far as the start.</li>
  <li>Naming a country already on your trail also walks you back to it — that one costs a guess.</li>
  <li>The map is unlabelled on purpose. Every country you have crossed is filled in; the ringed country is the finish.</li>
  <li>Drag the map to move it and scroll, pinch or use the buttons to zoom in on a crowded border. <strong>Fit</strong> puts the whole route back in view and hands the framing back to the game.</li>
  <li>The round ends when your guesses run out, and only then. Walk somewhere the finish can no longer be reached from and the game says so, but the guesses are yours to spend however you like.</li>
</ul>
<p><strong>Four levels.</strong> Scenic, Standard and Expert are daily: each deals its own route for the day, keeps its own streak, and resets at midnight. Finishing one leaves the other two untouched — they are three different walks, not the same walk at three settings. Unlimited is off the clock: a fresh route as often as you like.</p>
<div class="house">
  <p><strong>The Bering rule.</strong> Russia and the United States count as neighbours. It is the only way the Americas join the rest of the board, and the map marks the crossing with a dashed line at the strait.</p>
  <p><strong>Crossings by sea.</strong> Land borders alone leave every island with nowhere to walk, so a set of real sea crossings joins them up — Gibraltar, the Channel, Torres Strait, the Palk Strait, the Windward Passage and the rest. Every country on the board can now be reached. A crossing is named on your trail as you make it, so you always know when you have taken one.</p>
</div>
<p><strong>What counts as a border:</strong> two countries border each other when their main landmasses touch. Exclaves and overseas territory are out — so Spain does not <em>border</em> Morocco, though you may cross the strait between them.</p>
<p><strong>How the levels differ:</strong> Scenic walks 4 to 5 borders and gives you par plus eight guesses. Standard walks 5 to 6 with par plus five. Expert walks 6 to 7 with par plus two, and never tells you how far you still have to go.</p>
`;
