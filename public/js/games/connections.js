/*
 * Connections.
 *
 * Solved groups stack above the board and the board shrinks under them, which
 * is the whole shape of the game: sixteen words becoming four rows. Selection
 * is the view's own business; everything else comes from the server.
 */

import { h, swap, clear } from "../ui.js";

export function create(ctx) {
  let run = ctx.run;
  let picked = [];
  let order = run.puzzle.order.slice();

  const solvedWrap = h("div.stack", { style: { gap: "8px" } });
  const grid = h("div.conn-grid");
  const lives = h("div.lives");
  const el = h("div.stack", {},
    solvedWrap,
    grid,
    h("div.spread", { style: { marginTop: "4px" } },
      h("div.row", h("span.label", {}, "Mistakes"), lives),
      h("div.row",
        h("button.small", { onClick: shuffle }, "Shuffle"),
        h("button.small", { onClick: () => { picked = []; paint(); } }, "Deselect"),
        h("button.primary.small", { id: "conn-submit", onClick: submit, disabled: true }, "Submit"))));

  paint();

  return {
    el,
    update(next, result) {
      run = next;
      if (result && result.correct) picked = [];
      if (result && result.correct === false) {
        flashWrong();
        if (result.oneAway) ctx.say("One away.", "");
      }
      /* Keep only words still on the board. */
      const live = new Set(remaining());
      order = order.filter((word) => live.has(word));
      picked = picked.filter((word) => live.has(word));
      paint();
    },
    outcome: (r) => r.puzzle.groups
      ? h("div.stack", { style: { gap: "6px" } },
          r.puzzle.groups
            .filter((group) => !r.puzzle.solved.some((s) => s.index === group.index))
            .map((group) => h("div.conn-solved.missed", { dataset: { level: group.level } },
              h("div.name", {}, group.clue),
              h("div.members", {}, group.words.join(", ")))))
      : null,
  };

  /* ------------------------------------------------------------ board */

  function solvedWords() {
    return new Set(run.puzzle.solved.flatMap((group) => group.words));
  }

  function remaining() {
    return order.filter((word) => !solvedWords().has(word));
  }

  function paint() {
    swap(solvedWrap, run.puzzle.solved.map((group) =>
      h("div.conn-solved", { dataset: { level: group.level } },
        h("div.name", {}, group.clue),
        h("div.members", {}, group.words.join(", ")))));

    const hinted = new Set((run.puzzle.hints || []).map((hint) => hint.word));
    const playing = run.puzzle.status === "playing";

    swap(grid, remaining().map((word) =>
      h("button.conn-cell", {
        class: hinted.has(word) ? "hinted" : "",
        "aria-pressed": picked.includes(word) ? "true" : "false",
        disabled: !playing,
        onClick: () => toggle(word),
      }, word)));

    swap(lives, Array.from({ length: run.puzzle.mistakesAllowed }, (_, i) =>
      h("i", { class: i < run.puzzle.mistakes ? "gone" : "" })));

    const submitButton = el.querySelector("#conn-submit");
    if (submitButton) submitButton.disabled = picked.length !== 4 || !playing;

    /* Say what a hint pointed at, since the ring alone is easy to miss. */
    const last = (run.puzzle.hints || [])[run.puzzle.hints.length - 1];
    if (last && !el.dataset.toldHint) el.dataset.toldHint = "";
    if (last && el.dataset.toldHint !== last.word) {
      el.dataset.toldHint = last.word;
      ctx.say(`${last.word} belongs to "${last.clue}".`, "");
    }
  }

  function toggle(word) {
    if (picked.includes(word)) picked = picked.filter((w) => w !== word);
    else if (picked.length < 4) picked.push(word);
    paint();
  }

  function shuffle() {
    const live = remaining();
    for (let i = live.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [live[i], live[j]] = [live[j], live[i]];
    }
    const solved = order.filter((word) => solvedWords().has(word));
    order = [...live, ...solved];
    paint();
  }

  function submit() {
    if (picked.length === 4) ctx.actions.guess(picked.slice());
  }

  function flashWrong() {
    for (const cell of grid.querySelectorAll(".conn-cell[aria-pressed='true']")) {
      cell.classList.add("wrong");
      setTimeout(() => cell.classList.remove("wrong"), 420);
    }
  }
}
