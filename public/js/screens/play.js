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

export async function render({ game, mode, code }) {
  let started;

  if (mode === "custom") {
    /* Look the puzzle up first, so the code decides which game to load. */
    const found = await api.puzzle(code);
    started = await api.play(found.puzzle.game, { mode: "custom", code });
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
    /* The home screen reads today's progress from the session, so refresh it
     * once a round is over rather than leaving it stale. */
    if (state.user) refreshSession().catch(() => {});
    paintFooter();
    footer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* --------------------------------------------------------- furniture */

  function header() {
    const meta = run.mode === "daily"
      ? run.dayLabel
      : run.mode === "custom"
        ? `by ${run.custom && run.custom.by ? run.custom.by.display : "a friend"}`
        : "unlimited";

    return h("div.game-head",
      h("div.line",
        h("a.btn.ghost.small", { href: "#/", "aria-label": "Back to the games" }, "←"),
        h("h1", { style: { fontSize: "1.35rem" } },
          run.mode === "custom" && run.custom ? run.custom.title : run.gameName),
        h("span.grow"),
        h("span.pill", { class: run.mode === "daily" ? "on" : "" }, run.mode)),
      h("div.line.small.muted",
        h("span", {}, meta),
        run.mode === "custom" ? h("span.mono.tiny", {}, run.code) : null,
        run.puzzle.note ? h("span", {}, `“${run.puzzle.note}”`) : null));
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

      h("div.row.row-wrap", { style: { justifyContent: "center" } },
        h("button.primary", { onClick: showShare }, "Share"),
        run.mode === "daily"
          ? h("a.btn", { href: `#/play/${run.game}/unlimited` }, "Play unlimited")
          : h("button", { onClick: again }, "Another"),
        h("a.btn.ghost", { href: "#/" }, "Home")),

      !state.user
        ? h("p.tiny.muted", { style: { margin: 0 } },
            h("a", { href: "#/signin/up" }, "Create an account"), " to keep your streaks and stats.")
        : null);
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

    const answer = await api.play(run.game, {
      mode: options.mode || run.mode,
      difficulty: options.difficulty || run.difficulty,
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
