/*
 * The Crossword and the Mini.
 *
 * One view for both, because the only difference is how big the grid is.
 *
 * A crossword is really two things at once - a grid and a list of clues - and
 * the thing that makes it feel like a crossword rather than a form is that the
 * two stay in step. Wherever the cursor is, the clue for the word it sits in
 * is showing; whichever clue you tap, the cursor goes there. Everything below
 * is in service of that.
 */

import { h, swap } from "../ui.js";

const BLACK = "#";
const EMPTY = " ";

export function create(ctx) {
  let run = ctx.run;
  const size = run.puzzle.size;

  /* Where the cursor is and which way it is pointing. Purely the view's
   * business - the server is told about letters, never about attention. */
  let cursor = firstOpen();
  let across = true;
  let wrong = new Set();

  /*
   * Letters typed but not yet confirmed by the server.
   *
   * The cursor used to advance only when a reply came back, so anyone typing
   * at a normal speed put every letter of a word into the same square: five
   * keystrokes went out against one cursor position and the last one won.
   * A crossword you cannot type into is not a crossword.
   *
   * So a keystroke now moves the cursor and shows the letter immediately, and
   * the server is told afterwards. What is drawn is this overlay on top of the
   * server's grid; each entry is dropped as its reply lands.
   */
  const pending = new Map();

  /*
   * Replies are chained rather than fired off in parallel. Every reply carries
   * the whole grid, so two of them landing out of order would leave the older
   * one painted - a letter vanishing a moment after you typed it.
   */
  let queue = Promise.resolve();

  const grid = h("div.xw-grid", { style: { "--size": size } });
  const clueBar = h("button.xw-cluebar", { onClick: nextEntry });
  const acrossList = h("div.xw-clues");
  const downList = h("div.xw-clues");

  const el = h("div.stack", {},
    clueBar,
    grid,
    h("div.xw-keys"),
    h("div.xw-lists",
      h("div", h("span.label", {}, "Across"), acrossList),
      h("div", h("span.label", {}, "Down"), downList)));

  paint();
  listen();

  return {
    el,
    /* The harness asks where the cursor is, so a hint fills the square the
     * player is actually looking at. */
    focusCell: () => cursor,
    controls: () => h("button.small", { onClick: () => ctx.actions.check(wordCells()) }, "Check word"),
    update(next, result) {
      run = next;

      if (result && result.wrong) {
        /* A check came back. Nothing is wrong: say so rather than silently
         * doing nothing, which reads as a broken button. */
        wrong = new Set(result.wrong);
        ctx.say(result.wrong.length
          ? `${result.wrong.length} wrong so far.`
          : "All correct so far.", result.wrong.length ? "bad" : "good");
      }
      if (result && result.hint) {
        wrong.delete(result.hint.cell);
        moveTo(result.hint.cell);
      }
      if (result && result.letter !== undefined) {
        wrong.delete(result.cell);
        /* The cursor moved when the key was pressed, so nothing to do here but
         * let go of the letter now that the server has it. */
        pending.delete(result.cell);
      }
      paint();
    },
    /*
     * A letter the server would not take - typed into a square that was given
     * away by a hint, or after the round ended. Without this the overlay would
     * keep showing it and the grid would quietly disagree with the server, so
     * everything unconfirmed is dropped and the server's grid is drawn.
     */
    reject() {
      pending.clear();
      paint();
    },
    outcome: (r) => r.puzzle.answers
      ? h("p.small.muted", { style: { margin: 0 } },
          `${r.puzzle.answers.length} answers. The grid is shown filled in above.`)
      : null,
  };

  /* -------------------------------------------------------- the grid */

  function firstOpen() {
    for (let i = 0; i < size * size; i++) if (run.puzzle.grid[i] !== BLACK) return i;
    return 0;
  }

  function isBlack(cell) {
    return run.puzzle.grid[cell] === BLACK;
  }

  /** What a square shows: what you just typed, or what the server has. */
  function letterAt(cell) {
    return pending.has(cell) ? pending.get(cell) : run.puzzle.letters[cell];
  }

  function numberAt() {
    return new Map(run.puzzle.numbers);
  }

  /** The entry the cursor sits in, in the direction it is pointing. */
  function currentEntry() {
    return run.puzzle.entries.find(
      (entry) => entry.across === across && entry.cells.includes(cursor)
    ) || run.puzzle.entries.find((entry) => entry.cells.includes(cursor));
  }

  function wordCells() {
    const entry = currentEntry();
    return entry ? entry.cells : [cursor];
  }

  function paint() {
    const puzzle = run.puzzle;
    const numbers = numberAt();
    const entry = currentEntry();
    const inWord = new Set(entry ? entry.cells : []);
    const given = new Set(puzzle.revealed);
    const over = puzzle.status !== "playing";

    swap(grid, [...puzzle.grid].map((square, cell) => {
      if (square === BLACK) return h("div.xw-cell.black");

      const letter = letterAt(cell);
      return h("button.xw-cell", {
        class: [
          cell === cursor ? "cursor" : "",
          inWord.has(cell) ? "in-word" : "",
          given.has(cell) ? "given" : "",
          wrong.has(cell) ? "wrong" : "",
        ].filter(Boolean).join(" "),
        disabled: over,
        onClick: () => tap(cell),
        "aria-label": `Square ${cell % size + 1} across, row ${Math.floor(cell / size) + 1}${letter !== EMPTY ? ", " + letter : ", empty"}`,
      },
        numbers.has(cell) ? h("span.xw-number", {}, numbers.get(cell)) : null,
        h("span.xw-letter", {}, letter === EMPTY ? "" : letter));
    }));

    swap(clueBar,
      entry
        ? [
            h("span.xw-cluenum", {}, `${entry.number}${entry.across ? "A" : "D"}`),
            h("span.grow", {}, entry.clue),
            h("span.mono.tiny.muted", {}, `${entry.length}`),
          ]
        : h("span.muted", {}, "Tap a square to begin"));

    const solved = new Set(puzzle.solvedEntries);
    const listFor = (isAcross) => puzzle.entries
      .filter((one) => one.across === isAcross)
      .map((one) => h("button.xw-clue", {
        class: [
          entry && one.number === entry.number && one.across === entry.across ? "on" : "",
          solved.has(one.number + (one.across ? "A" : "D")) ? "done" : "",
        ].filter(Boolean).join(" "),
        onClick: () => { across = one.across; moveTo(one.cells.find((c) => puzzle.letters[c] === EMPTY) ?? one.cells[0]); },
      },
        h("b", {}, one.number),
        h("span", {}, one.clue)));

    swap(acrossList, listFor(true));
    swap(downList, listFor(false));

    /* Keep the clue you are on in view in its list. */
    const on = el.querySelector(".xw-clue.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }

  /* ---------------------------------------------------------- moving */

  function tap(cell) {
    /* Tapping the square you are already on turns the corner. */
    if (cell === cursor) across = !across;
    else cursor = cell;
    paint();
  }

  function moveTo(cell) {
    if (cell === undefined || cell < 0 || cell >= size * size || isBlack(cell)) return;
    cursor = cell;
    paint();
  }

  /*
   * Put a letter in, or take one out.
   *
   * Both do the same three things in the same order: change what is on screen,
   * move the cursor, then queue the server. The player never waits.
   */
  function typeInto(cell, letter) {
    pending.set(cell, letter);
    step(1);
    paint();
    send(() => ctx.actions.guess({ cell, letter }));
  }

  function clearAt(cell) {
    pending.set(cell, EMPTY);
    paint();
    send(() => ctx.actions.guess({ cell, clear: true }));
  }

  function send(go) {
    queue = queue.then(go).catch(() => { /* play.js has already said so */ });
  }

  /** Move along the current word, hopping to the next word at the end. */
  function step(delta) {
    const entry = currentEntry();
    if (!entry) return;
    const at = entry.cells.indexOf(cursor);
    const next = entry.cells[at + delta];

    if (next !== undefined) { cursor = next; return; }
    if (delta > 0) nextEntry();
  }

  function nextEntry() {
    const entries = run.puzzle.entries;
    const entry = currentEntry();
    const at = entries.indexOf(entry);
    const following = entries[(at + 1) % entries.length];

    across = following.across;
    cursor = following.cells.find((cell) => letterAt(cell) === EMPTY) ?? following.cells[0];
    paint();
  }

  /** Arrow keys move a square at a time, turning the cursor if need be. */
  function arrow(dRow, dCol) {
    const wanted = dCol !== 0;
    if (across !== wanted) { across = wanted; paint(); return; }

    let row = Math.floor(cursor / size) + dRow;
    let col = (cursor % size) + dCol;
    while (row >= 0 && row < size && col >= 0 && col < size) {
      const cell = row * size + col;
      if (!isBlack(cell)) { moveTo(cell); return; }
      row += dRow;
      col += dCol;
    }
  }

  /* ----------------------------------------------------------- input */

  function listen() {
    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener("keydown", onKey);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest("input, textarea")) return;
      if (run.puzzle.status !== "playing") return;

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        typeInto(cursor, event.key.toUpperCase());
        return;
      }
      switch (event.key) {
        case "Backspace":
          event.preventDefault();
          /* Clear where you are; if it is already empty, back up and clear. */
          if (letterAt(cursor) === EMPTY) step(-1);
          clearAt(cursor);
          break;
        case "ArrowUp": event.preventDefault(); arrow(-1, 0); break;
        case "ArrowDown": event.preventDefault(); arrow(1, 0); break;
        case "ArrowLeft": event.preventDefault(); arrow(0, -1); break;
        case "ArrowRight": event.preventDefault(); arrow(0, 1); break;
        case "Tab":
          event.preventDefault();
          nextEntry();
          break;
        case " ":
          event.preventDefault();
          across = !across;
          paint();
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKey);

    /*
     * A phone has no physical keyboard, and a grid of buttons will not raise
     * the on-screen one. An input parked off-screen does, and its keystrokes
     * arrive through the same handler above.
     */
    const catcher = h("input", {
      class: "xw-catcher",
      "aria-hidden": "true",
      tabIndex: -1,
      autocapitalize: "characters",
      autocomplete: "off",
      spellcheck: false,
    });
    catcher.addEventListener("input", () => {
      const typed = catcher.value.replace(/[^a-zA-Z]/g, "").toUpperCase();
      catcher.value = "";
      /* A phone keyboard can deliver several characters in one event - an
       * autocorrect, or a fast thumb - so every one of them is laid down
       * rather than only the last. */
      if (run.puzzle.status !== "playing") return;
      for (const letter of typed) typeInto(cursor, letter);
    });
    /* On a phone Backspace on an empty field does not fire `input`. */
    catcher.addEventListener("keydown", (event) => {
      if (event.key !== "Backspace") return;
      event.preventDefault();
      if (letterAt(cursor) === EMPTY) step(-1);
      clearAt(cursor);
    });

    el.append(catcher);
    grid.addEventListener("click", () => {
      if (matchMedia("(hover: none)").matches) catcher.focus({ preventScroll: true });
    });
  }
}
