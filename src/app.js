/* Travle Overland - browser wiring. The engine and the map stay independent;
   this file owns the DOM and the round in progress. */
(function () {
  "use strict";

  const E = window.Engine;
  const $ = (sel) => document.querySelector(sel);

  const el = {
    puzzleNo: $("#puzzle-no"),
    theme: $("#theme"),
    difficulty: $("#difficulty"),
    fromName: $("#from-name"),
    toName: $("#to-name"),
    par: $("#par"),
    svg: $("#map"),
    zoomIn: $("#zoom-in"),
    zoomOut: $("#zoom-out"),
    zoomFit: $("#zoom-fit"),
    form: $("#console"),
    field: $("#field"),
    submit: $("#submit"),
    back: $("#back"),
    suggest: $("#suggest"),
    say: $("#say"),
    left: $("#count-left"),
    leftBox: $("#box-left"),
    toGo: $("#count-togo"),
    toGoBox: $("#box-togo"),
    here: $("#count-here"),
    trail: $("#trail"),
    refusedWrap: $("#refused-wrap"),
    refused: $("#refused"),
    outcome: $("#outcome"),
    reset: $("#reset"),
    verdict: $("#verdict"),
    blurb: $("#blurb"),
    tally: $("#tally"),
    share: $("#share"),
    again: $("#again"),
    shareBox: $("#share-box"),
  };

  const STORE = {
    theme: "travle.theme",
    difficulty: "travle.difficulty",
    stats: (mode) => "travle.stats." + mode,
    day: (id, mode) => "travle.day." + id + "." + mode,
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* private browsing: the round still plays, it just will not be remembered */
    }
  }

  let game = null;
  let world = null;
  let log = []; // replayable history: country codes, and "<" for a step back
  let justEntered = null;
  let options = [];
  let highlighted = -1;
  let highlightPicked = false; // true once the player arrows to a choice themselves

  /* ------------------------------------------------------------------ theme */

  function initTheme() {
    const saved = read(STORE.theme, null);
    // Only apply our own preference when the host has not already stamped one.
    if (saved && !document.documentElement.getAttribute("data-theme")) {
      document.documentElement.setAttribute("data-theme", saved);
    }
    paintThemeButton();
    el.theme.addEventListener("click", () => {
      const now = document.documentElement.getAttribute("data-theme");
      const wantsDark = now ? now === "light" : !prefersDark();
      document.documentElement.setAttribute("data-theme", wantsDark ? "dark" : "light");
      write(STORE.theme, wantsDark ? "dark" : "light");
      paintThemeButton();
    });
  }

  function prefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function paintThemeButton() {
    const stamped = document.documentElement.getAttribute("data-theme");
    const dark = stamped ? stamped === "dark" : prefersDark();
    el.theme.textContent = dark ? "Day" : "Night";
    el.theme.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
  }

  /* ------------------------------------------------------------- new rounds */

  function currentDifficulty() {
    const saved = read(STORE.difficulty, E.DEFAULT_MODE);
    return E.DIFFICULTIES[saved] ? saved : E.DEFAULT_MODE;
  }

  /**
   * Open a level. The three daily levels each carry their own route for the
   * day and their own saved progress, so finishing one leaves the others
   * untouched; Unlimited deals a fresh route every time.
   */
  function startMode(modeKey) {
    const key = E.DIFFICULTIES[modeKey] ? modeKey : E.DEFAULT_MODE;
    write(STORE.difficulty, key);

    if (!E.DIFFICULTIES[key].daily) {
      begin(E.randomPuzzle(key), key);
      render(true);
      return;
    }

    const puzzle = E.puzzleForDay(E.dayNumber(), key);
    begin(puzzle, key);
    const saved = read(STORE.day(puzzle.id, key), null);
    if (saved && Array.isArray(saved.log)) {
      for (const entry of saved.log) {
        if (entry === "<") { if (game.back()) log.push("<"); }
        else if (game.play(entry).ok) log.push(entry);
      }
      justEntered = null;
    }
    render(true);
  }

  function begin(puzzle, difficultyKey) {
    game = new E.Game(puzzle, difficultyKey);
    window.__game = game;
    log = [];
    justEntered = null;
  }

  function saveProgress() {
    if (!game.puzzle.daily) return;
    write(STORE.day(game.puzzle.id, game.difficultyKey), { log, status: game.status });
  }

  /* ------------------------------------------------------------------ stats */

  function blankStats() {
    return { played: 0, won: 0, streak: 0, best: 0, lastDay: null };
  }

  /** Each level keeps its own record, so a streak means that level's streak. */
  function recordResult() {
    if (!game.puzzle.daily) return;
    const key = STORE.stats(game.difficultyKey);
    const stats = read(key, blankStats());
    if (stats.lastDay === game.puzzle.id) return; // already counted today
    stats.played++;
    if (game.status === "won") {
      stats.won++;
      stats.streak = stats.lastDay === game.puzzle.id - 1 ? stats.streak + 1 : 1;
      stats.best = Math.max(stats.best, stats.streak);
    } else {
      stats.streak = 0;
    }
    stats.lastDay = game.puzzle.id;
    write(key, stats);
  }

  /* ----------------------------------------------------------------- render */

  /**
   * One country on a list. A hop marker, where there is one, lives inside the
   * same item as the country it leads to, so it can never be split from it by
   * a line wrap.
   */
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
      // Only the Bering hop gets a marker. A plain border needs none: the
      // order of the chips already says you walked from one to the next.
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

  function renderBrief() {
    el.puzzleNo.textContent = game.puzzle.daily
      ? game.difficulty.label + " · No. " + game.puzzle.id
      : "Unlimited";
    el.fromName.textContent = E.nameOf(game.start);
    el.toName.textContent = E.nameOf(game.end);
    el.par.textContent = game.par + " border" + (game.par === 1 ? "" : "s") + " at best · "
      + game.budget + " guesses";
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
    if (game.puzzle.daily) {
      const stats = read(STORE.stats(game.difficultyKey), blankStats());
      rows.push(
        [game.difficulty.label + " played", stats.played],
        ["Crossed", stats.won],
        ["Streak", stats.streak],
        ["Best streak", stats.best]
      );
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

  /** How long until the daily levels deal new routes. */
  function resetLine() {
    const ms = E.msUntilReset();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const when = hours ? hours + "h " + minutes + "m" : minutes + "m";
    return "A new " + game.difficulty.label + " route in " + when + ". The other levels are waiting now.";
  }

  function routeCodes() {
    return [game.start, game.end, ...game.trail];
  }

  function render(reframe) {
    renderBrief();
    renderCounters();
    renderTrail();
    renderOutcome();
    paintDifficulty();
    world.paint(game, justEntered, game.status === "lost" ? game.solution() : null);
    // A new round always reframes; during a round the map follows the trail
    // only while the player has not taken the view over themselves.
    if (reframe) world.fit(routeCodes(), false);
    else world.follow(routeCodes());
    if (game.status === "playing") el.field.focus();
  }

  /* ------------------------------------------------------------------ input */

  function speak(message, tone) {
    el.say.textContent = message || "";
    if (tone) el.say.dataset.tone = tone;
    else el.say.removeAttribute("data-tone");
  }

  function closeSuggestions() {
    options = [];
    highlighted = -1;
    highlightPicked = false;
    el.field.removeAttribute("aria-activedescendant");
    el.suggest.textContent = "";
    el.suggest.hidden = true;
    el.field.setAttribute("aria-expanded", "false");
  }

  function renderSuggestions() {
    const text = el.field.value.trim();
    options = text ? E.suggest(text, 6) : [];
    el.suggest.textContent = "";
    if (!options.length) {
      closeSuggestions();
      return;
    }
    highlighted = 0;
    highlightPicked = false;
    options.forEach((code, i) => {
      const li = document.createElement("li");
      li.id = "opt-" + code;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === highlighted));
      const name = document.createElement("span");
      name.textContent = E.nameOf(code);
      const plate = document.createElement("span");
      plate.className = "plate";
      plate.textContent = code;
      li.append(name, plate);
      // pointerdown, not mousedown: on touch the field blurs and closes the
      // list before a mouse event would ever land.
      li.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        submit(code);
      });
      el.suggest.appendChild(li);
    });
    el.suggest.hidden = false;
    el.field.setAttribute("aria-expanded", "true");
    el.field.setAttribute("aria-activedescendant", "opt-" + options[highlighted]);
  }

  function moveHighlight(step) {
    if (!options.length) return;
    highlightPicked = true;
    highlighted = (highlighted + step + options.length) % options.length;
    [...el.suggest.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === highlighted)));
    el.field.setAttribute("aria-activedescendant", "opt-" + options[highlighted]);
  }

  function shake() {
    el.field.classList.remove("shake");
    void el.field.offsetWidth; // restart the animation
    el.field.classList.add("shake");
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

  function submit(forced) {
    const raw = forced || el.field.value;
    if (!raw.trim()) return;
    const result = game.play(raw);

    if (!result.ok) {
      speak(result.message, "miss");
      shake();
      return;
    }

    log.push(result.code);
    justEntered = result.move === E.MOVE.MISS ? null : result.code;
    el.field.value = "";
    closeSuggestions();
    report(result);
    if (result.move === E.MOVE.MISS) shake();

    if (game.status !== "playing") recordResult();
    saveProgress();
    render();

    if (game.status === "won") speak("");
    else if (game.outOfReach) {
      speak(E.nameOf(game.current) + " is further from the finish than your "
        + game.left + (game.left === 1 ? " remaining guess" : " remaining guesses")
        + " can carry you. Keep walking if you like — you have them to spend.", "miss");
    }
  }

  function stepBack() {
    if (!game.back()) return;
    log.push("<");
    justEntered = null;
    saveProgress();
    render();
    speak("Back in " + E.nameOf(game.current) + ". That one was free.", "back");
  }

  /* ------------------------------------------------------------- difficulty */

  function paintDifficulty() {
    for (const button of el.difficulty.children) {
      button.setAttribute("aria-pressed", String(button.dataset.key === game.difficultyKey));
    }
  }

  function buildDifficulty() {
    for (const [key, mode] of Object.entries(E.DIFFICULTIES)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip-button";
      button.dataset.key = key;
      button.textContent = mode.label;
      button.title = mode.daily
        ? mode.label + ": a daily route of " + mode.legs[0] + " to " + mode.legs[1]
          + " borders, par plus " + mode.slack + " guesses"
          + (mode.showDistance ? "" : ", and no distance readout")
        : "Unlimited: a fresh route whenever you want one";
      button.addEventListener("click", () => {
        if (key === game.difficultyKey && mode.daily) return;
        startMode(key);
        speak(mode.daily
          ? mode.label + " — today's route, fresh at midnight."
          : "Unlimited. Play as many as you like.");
      });
      el.difficulty.appendChild(button);
    }
  }

  /* ------------------------------------------------------------------ share */

  const SQUARES = { closer: "\u{1F7E9}", sideways: "\u{1F7E8}", away: "\u{1F7E7}", back: "⬜", miss: "\u{1F7E5}" };

  function shareText() {
    const title = game.puzzle.daily ? "Travle Overland No. " + game.puzzle.id : "Travle Overland";
    const trip = E.nameOf(game.start) + " → " + E.nameOf(game.end);
    const score = game.status === "won"
      ? "Crossed in " + game.used + "/" + game.budget + " guesses"
        + (game.overshoot() === 0 ? " · shortest way" : " · +" + game.overshoot() + " over par")
      : "Stranded · " + game.used + "/" + game.budget + " guesses";
    return [title, trip, score, game.moves.map((m) => SQUARES[m.move]).join("")].join("\n");
  }

  async function copyShare() {
    const text = shareText();
    try {
      await navigator.clipboard.writeText(text);
      el.share.textContent = "Copied";
      setTimeout(() => (el.share.textContent = "Copy result"), 1600);
    } catch (err) {
      el.shareBox.hidden = false;
      el.shareBox.value = text;
      el.shareBox.select();
      el.share.textContent = "Copy it from here";
    }
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    initTheme();
    pruneSaves();
    world = new window.WorldMap(el.svg);
    startMode(currentDifficulty());
    buildDifficulty();
    paintDifficulty();

    el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    el.back.addEventListener("click", stepBack);
    el.field.addEventListener("input", renderSuggestions);
    el.field.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
    el.field.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); moveHighlight(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); }
      else if (event.key === "Escape") closeSuggestions();
      else if (event.key === "Enter") {
        // What you typed wins over the top of the list, unless you picked a
        // row yourself: typing "US" must play the United States, not whatever
        // happens to head the suggestions.
        const typed = E.resolve(el.field.value);
        if (!highlightPicked && typed) {
          event.preventDefault();
          submit(typed);
        } else if (options.length && highlighted >= 0) {
          event.preventDefault();
          submit(options[highlighted]);
        }
      }
    });

    el.share.addEventListener("click", copyShare);
    el.again.addEventListener("click", () => {
      el.shareBox.hidden = true;
      el.share.textContent = "Copy result";
      startMode("unlimited");
      speak("Unlimited. Play as many as you like.");
    });

    el.zoomIn.addEventListener("click", () => world.zoomBy(1.5));
    el.zoomOut.addEventListener("click", () => world.zoomBy(1 / 1.5));
    el.zoomFit.addEventListener("click", () => world.fit(routeCodes(), true));

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => world.onResize(routeCodes()), 180);
    });

    // A page left open past midnight is showing yesterday's round. Swap it for
    // the new one, but never in the middle of a walk.
    let today = E.dayNumber();
    setInterval(() => {
      const now = E.dayNumber();
      if (now === today) return;
      today = now;
      if (!game.puzzle.daily || game.status === "playing") return;
      startMode(game.difficultyKey);
      speak("A new day: today's " + game.difficulty.label + " route is ready.");
    }, 30000);
  }

  /** Yesterday's saved rounds are dead weight; keep the last few days only. */
  function pruneSaves() {
    const today = E.dayNumber();
    try {
      for (const key of Object.keys(localStorage)) {
        const match = key.match(/^travle\.day\.(-?\d+)\./);
        if (match && today - Number(match[1]) > 3) localStorage.removeItem(key);
      }
    } catch (err) {
      /* nothing readable to prune */
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
