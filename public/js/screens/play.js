/*
 * The harness every game sits in.
 *
 * It owns the round - starting it, sending guesses, holding the latest state -
 * and the furniture around the board: the header, the hint button, the result
 * panel, the share block. A game view only has to draw a board and say what
 * the player did.
 *
 * Each view exports `create(ctx)` and returns `{ el, update(run), reject(msg) }`.
 * `update` is called after every answer from the server, `reject` when a guess
 * was refused, so a view can shake the right row.
 */

import { api } from "../api.js";
import { state, go, refreshSession } from "../app.js";
import { h, swap, clear, icon, toast, sheet, copy, plural, duration } from "../ui.js";
import { shareText } from "../share.js";

const VIEWS = {
  wordle: () => import("../games/wordle.js"),
  connections: () => import("../games/connections.js"),
  bee: () => import("../games/bee.js"),
  boxed: () => import("../games/boxed.js"),
  travle: () => import("../games/travle.js"),
  /* One view serves both crosswords; only the grid size differs. */
  crossword: () => import("../games/crossword.js"),
  mini: () => import("../games/crossword.js"),
  strands: () => import("../games/strands.js"),
  pips: () => import("../games/pips.js"),
};

export async function render({ game, mode, code, challenge }) {
  let started;

  if (mode === "custom") {
    /* Look the puzzle up first, so the code decides which game to load. */
    const found = await api.puzzle(code);
    started = await api.play(found.puzzle.game, { mode: "custom", code });
  } else if (mode === "challenge") {
    if (!VIEWS[game]) throw new Error("No such game.");
    started = await api.play(game, { mode: "challenge", challenge });
  } else {
    if (!VIEWS[game]) throw new Error("No such game.");
    started = await api.play(game, { mode, difficulty: difficultyFor(game) });
  }

  let run = started.run;
  const view = await VIEWS[run.game]();

  const root = h("div.game", { dataset: { game: run.game } });
  const toastSlot = h("div.toast-slot");
  const board = h("div");
  const footer = h("div");
  /* The duel clock. One timer for the screen, cleared when the round ends or
   * the screen goes away - a stray interval on a removed element is a leak
   * that only shows up after somebody has played twenty rounds. */
  let ticker = null;

  const ctx = {
    get run() { return run; },
    say: (message, tone) => toast(toastSlot, message, tone),
    /*
     * Deal a fresh round of the same game, possibly with different options.
     * Travle's difficulty tabs use it, and so does "another" - both want a new
     * puzzle without leaving the screen.
     */
    restart: (options) => again(options),
    actions: {
      guess: (value) => send(() => api.guess(run.id, value)),
      hint: (at) => send(() => api.hint(run.id, at), { hint: true }),
      check: (cells) => send(() => api.check(run.id, cells)),
      back: () => send(() => api.back(run.id)),
      reveal: () => send(() => api.reveal(run.id)),
    },
  };

  const instance = view.create(ctx);
  swap(board, instance.el);
  swap(root, header(), toastSlot, board, footer);
  paintFooter();
  startClock();

  return root;

  /* ------------------------------------------------------------ moves */

  /*
   * One path for every move: call the server, hand the answer to the view,
   * then redraw the furniture. A refused guess never reaches `update` as a new
   * state, it goes to `reject` so the view can react in place.
   */
  async function send(request, opts = {}) {
    try {
      const answer = await request();
      const before = run;
      run = answer.run;

      if (answer.result && answer.result.ok === false) {
        ctx.say(answer.result.message, "bad");
        if (instance.reject) instance.reject(answer.result.message, answer.result);
        return answer;
      }

      instance.update(run, answer.result || null, before);
      paintFooter();

      if (opts.hint && answer.result && answer.result.ok) ctx.say("Hint taken.", "");
      if (finished(run) && !finished(before)) await finish();
      return answer;
    } catch (err) {
      ctx.say(err.message, "bad");
      return null;
    }
  }

  function finished(r) {
    return r && r.puzzle && r.puzzle.status !== "playing";
  }

  async function finish() {
    stopClock();

    /*
     * A duel is settled by whoever finishes second, so the answer to "did I
     * win" is on the server, not in the reply to the last guess. Fetch the
     * round again once - it comes back with the duel attached - and redraw.
     */
    if (run.mode === "challenge") {
      try {
        const fresh = await api.run(run.id);
        run = fresh.run;
        /* Marked read before the session is refreshed below, or the badge on
         * the Friends tab would keep counting the result being read. */
        if (run.challenge && run.challenge.settled) await api.challengeSeen(run.challenge.id).catch(() => {});
      } catch { /* the result below still says how the round itself went */ }

      /*
       * And redraw the head with it. The duel bar lives up there, and left
       * alone it would still be saying "they have not played it yet" above a
       * result panel announcing who won. The board and the toast slot are the
       * same nodes going back in, so nothing in the view is rebuilt.
       */
      swap(root, header(), toastSlot, board, footer);
    }

    /* The home screen reads today's progress from the session, so refresh it
     * once a round is over rather than leaving it stale. This also moves the
     * level pip in the header, which is the point of refreshing it here. */
    if (state.user) refreshSession().catch(() => {});

    paintFooter();
    footer.scrollIntoView({ behavior: "smooth", block: "nearest" });

    /*
     * Nothing pops over the result.
     *
     * A level-up used to open a card here. Once achievements started paying
     * hundreds of XP at a time, levelling stopped being rare - and a modal
     * over the board after a good round is a celebration that turns into an
     * obstacle: its backdrop sits directly on Share and Another, which are the
     * two things somebody wants next. Everything earned is listed under the
     * result instead, where it can be read and tapped, and the pass screen
     * still gives a new level its proper moment the next time it is opened.
     */
  }

  /* --------------------------------------------------------- furniture */

  function header() {
    const duel = run.challenge;
    const meta = run.mode === "daily"
      ? run.dayLabel
      : run.mode === "custom"
        ? `by ${run.custom && run.custom.by ? run.custom.by.display : "a friend"}`
        : run.mode === "challenge"
          ? `against ${duel && duel.opponent ? duel.opponent.display : "a friend"}`
          : "unlimited";

    return h("div.game-head",
      h("div.line",
        h("a.btn.ghost.small", {
          href: run.mode === "challenge" ? "#/friends/duels" : "#/",
          "aria-label": run.mode === "challenge" ? "Back to your duels" : "Back to the games",
        }, "←"),
        h("h1", { style: { fontSize: "1.35rem" } },
          run.mode === "custom" && run.custom ? run.custom.title : run.gameName),
        h("span.grow"),
        h("span.pill", { class: run.mode === "daily" ? "on" : run.mode === "challenge" ? "duel" : "" },
          run.mode === "challenge" ? "duel" : run.mode)),
      h("div.line.small.muted",
        h("span", {}, meta),
        run.mode === "custom" ? h("span.mono.tiny", {}, run.code) : null,
        run.puzzle.note ? h("span", {}, `“${run.puzzle.note}”`) : null),
      duel ? duelBar(duel) : null);
  }

  /* ------------------------------------------------------------- duels */

  /*
   * The bar above a duel board: who you are racing, your clock, and - if they
   * have already played - the time to beat.
   *
   * The clock is the point of the mode, so it is on screen the whole way
   * through rather than only in the result. It is drawn from `startedAt`,
   * which the server set, so it cannot be gamed by reloading.
   */
  function duelBar(duel) {
    const who = duel.opponent ? duel.opponent.display : "a friend";
    const target = duel.theirs && duel.theirs.won ? duel.theirs.took : null;

    /* Once the round is over the bar stops racing and reports. Leaving a
     * ticking clock above a result panel would be the screen arguing with
     * itself about whether the round has ended. */
    if (finished(run)) {
      const mine = duel.mine;
      return h("div.duel-bar", { class: duel.outcome || "" },
        h("span.small", {}, "Against ", h("b", {}, who)),
        h("span.grow"),
        h("span.small.muted", {},
          target ? `they took ${duration(target)}` : duel.theirs ? "they did not solve it" : "still to play"),
        h("b.duel-clock", {}, mine && mine.won ? duration(mine.took) : "—"));
    }

    return h("div.duel-bar", { class: target ? "chasing" : "" },
      h("span.small", {}, "Racing ", h("b", {}, who)),
      h("span.grow"),
      target
        ? h("span.small.muted", {}, `beat ${duration(target)}`)
        : h("span.small.muted", {}, "they have not played it yet"),
      h("b.duel-clock", { role: "timer" }, "0s"));
  }

  /* Tick the duel clock once a second while the round is still going. */
  function startClock() {
    stopClock();
    if (run.mode !== "challenge" || finished(run)) return;

    const tick = () => {
      const clock = root.querySelector(".duel-clock");
      if (!clock) return stopClock();
      const ms = Date.now() - run.startedAt;
      clock.textContent = duration(ms);

      /* Past their time, the bar says so. Nothing stops - you can still
       * finish it, and finishing beats not finishing. */
      const duel = run.challenge;
      const target = duel && duel.theirs && duel.theirs.won ? duel.theirs.took : null;
      const bar = root.querySelector(".duel-bar");
      if (bar && target) bar.classList.toggle("behind", ms > target);
    };

    tick();
    ticker = setInterval(tick, 1000);
  }

  function stopClock() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function paintFooter() {
    /* Travle brought its own controls and its own result panel across from the
     * standalone game, so the harness stays out of its way. */
    if (instance.ownFooter) return swap(footer);

    const over = finished(run);
    swap(footer,
      over ? result() : h("div.row.row-wrap", { style: { marginTop: "14px", justifyContent: "center" } },
        instance.controls ? instance.controls() : null,
        h("button.small", { onClick: () => ctx.actions.hint(instance.focusCell ? instance.focusCell() : undefined) }, "Hint",
          run.puzzle.hints && run.puzzle.hints.length
            ? h("span.mono.tiny", {}, `(${run.puzzle.hints.length})`) : null),
        canGiveUp() ? h("button.ghost.small", { onClick: confirmGiveUp }, "Give up") : null));
  }

  function canGiveUp() {
    return ["bee", "boxed", "travle", "crossword", "mini", "strands", "pips"].includes(run.game);
  }

  function confirmGiveUp() {
    sheet("Give up?", (body, close) => {
      body.append(
        h("p.muted", {}, "The round ends and you will see what was there. It still counts as played."),
        h("div.row",
          h("button.grow", { onClick: close }, "Keep going"),
          h("button.primary.grow", { onClick: () => { close(); ctx.actions.reveal(); } }, "Give up")));
    });
  }

  /* ------------------------------------------------------------ result */

  function result() {
    const summary = run.summary || {};
    const won = summary.won;
    const took = run.finishedAt && run.startedAt ? duration(run.finishedAt - run.startedAt) : null;

    return h("div.result.stack", { class: won ? "won" : "lost", style: { marginTop: "18px" } },
      h("div.verdict", {}, verdict(run, won)),
      h("div.small.muted", {},
        [
          summary.guesses !== undefined ? plural(summary.guesses, guessNoun(run.game), guessPlural(run.game)) : null,
          summary.hints ? plural(summary.hints, "hint") : null,
          took,
        ].filter(Boolean).join(" · ")),

      instance.outcome ? instance.outcome(run) : null,

      run.challenge ? duelResult(run.challenge) : null,

      earnedLine(),

      h("div.row.row-wrap", { style: { justifyContent: "center" } },
        h("button.primary", { onClick: showShare }, "Share"),
        run.mode === "challenge"
          ? h("a.btn", { href: "#/friends/duels" }, "Your duels")
          : run.mode === "daily"
            ? h("a.btn", { href: `#/play/${run.game}/unlimited` }, "Play unlimited")
            : h("button", { onClick: again }, "Another"),
        h("a.btn.ghost", { href: "#/" }, "Home")),

      !state.user
        ? h("p.tiny.muted", { style: { margin: 0 } },
            h("a", { href: "#/signin/up" }, "Create an account"), " to keep your streaks and stats.")
        : null);
  }

  /*
   * How the duel stands, under the result of your own round.
   *
   * Three states, and the middle one is the common one: you have finished and
   * they have not, so there is nothing to announce yet. Saying "waiting on
   * them" is the honest version of that, and better than a scoreboard that
   * would have to be wrong for a while.
   */
  function duelResult(duel) {
    const who = duel.opponent ? duel.opponent.display : "your friend";
    const mine = duel.mine;
    const theirs = duel.theirs;

    if (!duel.settled) {
      return h("div.duel-result.stack", { style: { gap: "4px" } },
        h("strong", {}, `Waiting on ${who}`),
        h("span.small.muted", {}, mine && mine.won
          ? `You solved it in ${duration(mine.took)}. They have until ${when(duel.expiresAt)} to beat that.`
          : `You did not solve this one, so ${who} only has to finish it.`));
    }

    const line = duel.outcome === "won" ? `You beat ${who}`
      : duel.outcome === "lost" ? `${who} beat you`
      : duel.outcome === "drew" ? `Dead heat with ${who}`
      : `${who} took it`;

    return h("div.duel-result.stack", { class: duel.outcome, style: { gap: "4px" } },
      h("strong", {}, line),
      h("span.small.muted", {},
        `${mine ? (mine.won ? duration(mine.took) : "no solve") : "no show"}`
        + ` against ${theirs ? (theirs.won ? duration(theirs.took) : "no solve") : "no show"}`
        + (duel.expired ? " · it ran out of time" : "")),
      duel.standing && duel.standing.played > 1
        ? h("span.tiny.muted", {},
            `Head to head: ${duel.standing.wins}–${duel.standing.losses}`
            + (duel.standing.draws ? `–${duel.standing.draws}` : ""))
        : null,
      duel.earned && duel.earned.xp
        ? h("span.tiny.muted", {}, `+${duel.earned.xp} XP for the duel`
            + (duel.earned.badgeXp ? `, and ${duel.earned.badgeXp} more for what it earned` : ""))
        : null);
  }

  /* A time of day, for "they have until ...". A declaration rather than a
   * const, because everything below the early return above is hoisted and a
   * const here would not exist yet when the first paint reaches it. */
  function when(at) {
    return new Date(at).toLocaleString(undefined,
      { weekday: "short", hour: "numeric", minute: "2-digit" });
  }

  /*
   * What the round was worth. Only for someone signed in - a guest earns
   * nothing, and a row saying "0 XP" would be a worse answer than the line
   * below it offering them an account.
   */
  function earnedLine() {
    const got = run.earned;
    if (!got) return null;

    return h("div.stack", { style: { gap: "8px" } },
      h("div.earned", { "data-won": String(!!got.won) },
        h("b", {}, `+${got.xp} XP`),
        h("span.small.muted.grow", {}, why(got)),
        h("a.btn.ghost.small", { href: "#/pass" }, `Level ${got.after}`)),
      got.levelled
        ? h("a.earned.levelled", { href: "#/pass" },
            h("b.level-badge", {}, String(got.after)),
            h("span.stack.grow", { style: { gap: "1px" } },
              h("strong", {}, `Level ${got.after}`),
              h("span.tiny.muted", {}, got.unlocked.length
                ? `Unlocked ${got.unlocked.map((item) => item.name).join(" and ")}`
                : "Open the pass to see the track")),
            h("span.small.muted", {}, "→"))
        : null,
      ...(got.badges || []).map((one) =>
        h("a.earned.badge-won", { href: "#/achievements", "data-rarity": one.rarity },
          h("span.badge-tick", {}, "★"),
          h("span.stack.grow", { style: { gap: "1px" } },
            h("strong", {}, one.name),
            h("span.tiny.muted", {}, one.blurb)),
          h("b", {}, `+${one.xp}`))));
  }

  function why(got) {
    if (!got.won) return "for playing it out";
    if (got.repeat) return "unlimited, and you have played this one a few times today";
    if (run.mode === "unlimited") return "unlimited rounds are worth less than the daily";
    if (run.mode === "custom") return "a shared puzzle";
    if (run.mode === "challenge") return "a duel — the result pays separately";
    if (got.quality >= 0.98) return "as well as it can be done";
    if (got.quality >= 0.8) return "cleanly done";
    if (got.quality >= 0.55) return "solved";
    return "got there in the end";
  }

  function verdict(r, won) {
    if (r.game === "bee") return `${r.puzzle.rank.name} · ${r.puzzle.score} points`;
    if (r.game === "strands") return won ? "Every word found" : `${r.summary.guesses} of ${r.summary.total}`;
    if (r.game === "pips") return won ? "Board covered" : "Not covered";
    if (won) {
      if (r.game === "travle") {
        const over = r.summary.over;
        return over === 0 ? "Perfect route" : `Arrived, ${plural(over, "move")} over par`;
      }
      return "Solved";
    }
    return r.game === "travle" ? "Out of moves" : "Not this time";
  }

  function guessNoun(key) {
    return { connections: "attempt", bee: "word", boxed: "word", travle: "move",
      crossword: "letter", mini: "letter", strands: "word", pips: "domino" }[key] || "guess";
  }
  function guessPlural(key) {
    return { connections: "attempts", bee: "words", boxed: "words", travle: "moves",
      crossword: "letters", mini: "letters", strands: "words", pips: "dominoes" }[key] || "guesses";
  }

  async function again(options = {}) {
    if (run.mode === "custom" && !options.mode) return go("#/");
    /* There is no "another" duel: a challenge is one puzzle sent to two
     * people, and dealing a second one here would be a round nobody is
     * racing. Back to the list, where a new one can be sent properly. */
    if (run.mode === "challenge" && !options.mode) return go("#/friends/duels");

    const answer = await api.play(run.game, {
      mode: options.mode || run.mode,
      difficulty: options.difficulty || run.difficulty,
      /* Asking outright for another one. A reload does not, which is what
       * lets an unfinished unlimited round survive being refreshed. */
      fresh: true,
    });
    run = answer.run;

    const fresh = view.create(ctx);
    /* Replace every key, so a view that stopped offering `controls` on the
     * last round does not keep the old one. */
    for (const key of Object.keys(instance)) delete instance[key];
    Object.assign(instance, fresh);

    swap(board, fresh.el);
    swap(root, header(), toastSlot, board, footer);
    paintFooter();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showShare() {
    /* A game that arrived with its own way of writing this keeps it. */
    const text = instance.shareText ? instance.shareText() : shareText(run);
    sheet("Share", (body, close) => {
      const status = h("p.small.muted", { style: { margin: 0 } }, "Nothing gives the answer away.");
      body.append(
        h("div.share-box", {}, text),
        status,
        h("div.row",
          h("button.primary.grow", {
            onClick: async () => {
              const ok = await copy(text);
              status.textContent = ok ? "Copied." : "Could not copy - select the text above instead.";
              status.style.color = ok ? "var(--ok)" : "var(--off)";
            },
          }, "Copy"),
          h("button.grow", { onClick: close }, "Done")));
    });
  }
}

/*
 * Travle is the one game with a difficulty setting; it is remembered between
 * rounds so the choice does not have to be made every time. The server sorts
 * out whether the chosen level makes sense for the mode.
 */
function difficultyFor(game) {
  if (game !== "travle") return undefined;
  try { return localStorage.getItem("pc:travle-difficulty") || undefined; } catch { return undefined; }
}
