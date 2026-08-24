/*
 * Wordle.
 *
 * The typed-but-not-submitted word is the only thing this view keeps to
 * itself; everything else is redrawn from what the server sent back. The
 * on-screen keyboard and the real one go through the same handler, so they
 * cannot drift apart.
 */

import { h, swap } from "../ui.js";

const ROWS = [
  "qwertyuiop".split(""),
  "asdfghjkl".split(""),
  ["Enter", ..."zxcvbnm".split(""), "Back"],
];

export function create(ctx) {
  let run = ctx.run;
  let typed = "";

  const grid = h("div.wordle-grid");
  const keyboard = h("div.keyboard");
  const el = h("div", {}, grid, keyboard);

  paintGrid();
  paintKeyboard();
  listen();

  return {
    el,
    update(next) {
      run = next;
      typed = "";
      paintGrid();
      paintKeyboard();
    },
    reject() {
      const row = grid.querySelector(".wordle-row.live");
      if (!row) return;
      row.classList.add("shake");
      setTimeout(() => row.classList.remove("shake"), 420);
    },
    outcome: (r) => r.puzzle.answer
      ? h("div", {},
          h("span.label", {}, "The word was "),
          h("b", { style: { fontSize: "1.1rem", letterSpacing: "0.06em" } }, r.puzzle.answer.toUpperCase()))
      : null,
  };

  /* ------------------------------------------------------------- board */

  function paintGrid() {
    const { length, tries, guesses, hints, status } = run.puzzle;
    const rows = [];
    const hintFor = new Map(hints.map((hint) => [hint.index, hint.letter]));

    for (let r = 0; r < tries; r++) {
      const done = guesses[r];
      const live = !done && r === guesses.length && status === "playing";
      const cells = [];

      for (let c = 0; c < length; c++) {
        if (done) {
          cells.push(h("div.wordle-cell", {
            class: `${done.marks[c]} pop`,
            style: { animationDelay: `${c * 40}ms` },
          }, done.word[c].toUpperCase()));
        } else if (live) {
          const letter = typed[c];
          const hinted = !letter && hintFor.has(c);
          cells.push(h("div.wordle-cell", {
            class: [letter ? "filled" : "", hinted ? "hint" : ""].filter(Boolean).join(" "),
          }, letter ? letter.toUpperCase() : hinted ? hintFor.get(c).toUpperCase() : ""));
        } else {
          cells.push(h("div.wordle-cell", {}, ""));
        }
      }

      rows.push(h("div.wordle-row", {
        class: live ? "live" : "",
        role: "group",
        "aria-label": done
          ? `Guess ${r + 1}: ${describe(done)}`
          : `Row ${r + 1}, empty`,
      }, cells));
    }
    swap(grid, rows);
  }

  /* Spoken feedback, so the colours are not the only channel. */
  function describe(row) {
    return row.word.split("").map((letter, i) => {
      const mark = row.marks[i];
      return `${letter.toUpperCase()} ${mark === "hit" ? "correct" : mark === "near" ? "elsewhere" : "not in the word"}`;
    }).join(", ");
  }

  function paintKeyboard() {
    const keys = run.puzzle.keyboard || {};
    swap(keyboard, ROWS.map((row) =>
      h("div.krow", row.map((key) => {
        const special = key === "Enter" || key === "Back";
        return h("button", {
          class: [special ? "wide" : "", keys[key] || ""].filter(Boolean).join(" "),
          onClick: () => press(key),
          "aria-label": key === "Back" ? "Backspace" : key,
          tabIndex: -1,
        }, key === "Back" ? "⌫" : key);
      }))));
  }

  /* ------------------------------------------------------------- input */

  function listen() {
    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener("keydown", onKey);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /* Let anything with a text field of its own have the keystroke. */
      if (event.target.closest("input, textarea")) return;

      if (event.key === "Enter") { event.preventDefault(); press("Enter"); }
      else if (event.key === "Backspace") { event.preventDefault(); press("Back"); }
      else if (/^[a-zA-Z]$/.test(event.key)) press(event.key.toLowerCase());
    };
    document.addEventListener("keydown", onKey);
  }

  function press(key) {
    if (run.puzzle.status !== "playing") return;

    if (key === "Enter") {
      if (typed.length !== run.puzzle.length) {
        ctx.say(`Needs to be ${run.puzzle.length} letters.`, "bad");
        return;
      }
      ctx.actions.guess(typed);
      return;
    }
    if (key === "Back") {
      typed = typed.slice(0, -1);
      paintGrid();
      return;
    }
    if (typed.length < run.puzzle.length) {
      typed += key;
      paintGrid();
    }
  }
}
