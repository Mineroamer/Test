/*
 * Strands.
 *
 * The board is letters you drag through. A trace is built by pointer, and the
 * same trace can be built by tapping one letter at a time - which is not only
 * for accessibility: on a small screen, dragging accurately through a diagonal
 * is fiddly, and tapping is what people fall back to.
 *
 * Lines are drawn under the letters in their own SVG layer, so a trace can
 * cross the gaps between circles without the letters sitting on top of it.
 */

import { h, swap } from "../ui.js";

export function create(ctx) {
  let run = ctx.run;
  let trace = [];        // squares in the trace being built
  let dragging = false;
  /*
   * Whether this gesture has slid onto a new square. It is what tells a drag
   * from a tap: without it, lifting the finger after tapping a second letter
   * submits a two-letter word, and building a trace by tapping is impossible.
   */
  let slid = false;
  /*
   * Which words have already had their moment.
   *
   * Every repaint redraws the whole board, so without remembering this, every
   * word found so far would replay its animation each time anything happened -
   * a board that fireworks at itself on every keystroke. Only the ones that
   * arrived since the last paint are animated.
   */
  const seen = new Set();

  const board = h("div.st-board");
  const lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.setAttribute("class", "st-lines");
  lines.setAttribute("aria-hidden", "true");

  const wrap = h("div.st-wrap", lines, board);
  const heading = h("div.stack", { style: { gap: "2px" } });
  const tally = h("div.spread");
  const words = h("div.found-list");

  const el = h("div.stack", {}, heading, tally, wrap, words);

  paint();
  listen();

  return {
    el,
    controls: () => h("button.small", { onClick: clear }, "Clear"),
    update(next, result) {
      run = next;
      trace = [];
      if (result && result.ok) {
        if (result.theme) {
          ctx.say(result.spangram ? `${result.word} — that is the theme!` : result.word, "good");
        } else if (result.earnedHint) {
          ctx.say(`${result.word}. That is a hint earned.`, "good");
        } else {
          ctx.say(`${result.word} — ${result.toNextHint} more for a hint.`, "");
        }
      }
      paint();
    },
    reject() {
      /* Flash the letters that were traced, then let go of them: a refused
       * word should not sit there selected, waiting to be refused again. */
      const refused = trace.slice();
      refuse(refused);
      setTimeout(() => {
        if (trace.length === refused.length && trace.every((c, i) => c === refused[i])) {
          trace = [];
          paint();
        }
      }, 420);
      trace = [];
      paint();
    },
    outcome: (r) => r.puzzle.answers
      ? h("div.stack", { style: { gap: "6px" } },
          h("span.label", {}, "The words were"),
          h("div.found-list", r.puzzle.answers.map((one) =>
            h("span", { class: one.spangram ? "pangram" : "" }, one.word))))
      : null,
  };

  /* ------------------------------------------------------------- paint */

  function paint() {
    const p = run.puzzle;

    swap(heading,
      h("div.spread",
        h("span.label", {}, "Today's theme"),
        h("span.mono.tiny.muted", {}, `${p.found.length} of ${p.total}`)),
      h("h2", { style: { fontStretch: "108%" } }, p.theme));

    swap(tally,
      h("span.small.muted", {},
        p.extras.length
          ? `${p.extras.length} word${p.extras.length === 1 ? "" : "s"} of your own`
          : "Words that are not the theme earn hints"),
      h("span.pill", { class: p.hintsAvailable ? "on" : "" },
        p.hintsAvailable
          ? `${p.hintsAvailable} hint${p.hintsAvailable === 1 ? "" : "s"} ready`
          : `${p.toNextHint} to a hint`));

    /* Which squares belong to what, so each gets the right colour. */
    const role = new Map();
    for (const one of p.foundCells) {
      for (const cell of one.cells) role.set(cell, one.spangram ? "spangram" : "found");
    }
    for (const path of p.litCells) {
      for (const cell of path) if (!role.has(cell)) role.set(cell, "lit");
    }

    const traced = new Set(trace);
    board.style.setProperty("--cols", p.cols);

    /*
     * Which words are new since the last paint, and where each of their
     * letters sits along the path - the stagger reads as the word being
     * traced out rather than switched on.
     */
    const step = new Map();
    const fresh = new Set();
    for (const one of p.foundCells) {
      if (seen.has(one.word)) continue;
      seen.add(one.word);
      fresh.add(one.word);
      one.cells.forEach((cell, i) => step.set(cell, i));
    }

    swap(board, [...p.letters].map((letter, cell) =>
      h("button.st-cell", {
        class: [
          role.get(cell) || "",
          traced.has(cell) ? "tracing" : "",
          step.has(cell) ? "arriving" : "",
        ].filter(Boolean).join(" "),
        /* How far along its word this letter is, for the stagger. */
        style: step.has(cell) ? { "--step": String(step.get(cell)) } : null,
        dataset: { cell },
        disabled: p.status !== "playing",
        "aria-label": `${letter}, row ${Math.floor(cell / p.cols) + 1}, column ${cell % p.cols + 1}`,
      }, letter)));

    drawLines(role, fresh);

    const chips = p.foundCells.map((one) =>
      h("span", {
        class: [one.spangram ? "pangram" : "", fresh.has(one.word) ? "arriving" : ""]
          .filter(Boolean).join(" "),
      }, one.word));
    const extras = p.extras.map((word) => h("span", { style: { opacity: "0.6" } }, word));
    /* A paragraph, not a span: the found-word chips title-case their contents,
     * and the instruction is a sentence rather than a word. */
    swap(words,
      chips.length || extras.length
        ? [...chips, ...extras]
        : h("p.small.muted", { style: { margin: 0 } },
            "Drag through letters, or tap them one by one."));
  }

  /*
   * The joining lines. Positions come from the laid-out board rather than
   * from arithmetic on the grid, so this stays right at any size the board
   * happens to be drawn at.
   */
  function drawLines(role, fresh = new Set()) {
    while (lines.firstChild) lines.removeChild(lines.firstChild);

    const box = board.getBoundingClientRect();
    if (!box.width) return;
    lines.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    lines.style.width = `${box.width}px`;
    lines.style.height = `${box.height}px`;

    const centre = (cell) => {
      const node = board.querySelector(`[data-cell="${cell}"]`);
      if (!node) return null;
      const spot = node.getBoundingClientRect();
      return [spot.left - box.left + spot.width / 2, spot.top - box.top + spot.height / 2];
    };

    const stroke = (path, kind, draw) => {
      const points = path.map(centre).filter(Boolean);
      if (points.length < 2) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
      line.setAttribute("class", "st-line " + kind);
      lines.append(line);

      /*
       * A new line draws itself along the path rather than appearing whole.
       * The length has to be measured from the element once it is in the
       * document, which is why this happens here and not in the stylesheet.
       */
      if (draw) {
        const length = typeof line.getTotalLength === "function" ? line.getTotalLength() : 0;
        if (length) {
          line.style.setProperty("--length", String(length));
          line.classList.add("drawing");
        }
      }
    };

    for (const one of run.puzzle.foundCells) {
      stroke(one.cells, one.spangram ? "spangram" : "found", fresh.has(one.word));
    }
    if (trace.length > 1) stroke(trace, "tracing");
  }

  /* ------------------------------------------------------------- input */

  function cellFrom(target) {
    const node = target && target.closest ? target.closest(".st-cell") : null;
    return node ? Number(node.dataset.cell) : null;
  }

  function extend(cell) {
    if (cell === null || run.puzzle.status !== "playing") return;

    /* Stepping back onto the previous square undoes the last step, which is
     * what a finger sliding back is asking for. */
    if (trace.length > 1 && cell === trace[trace.length - 2]) {
      trace.pop();
      paint();
      return;
    }
    if (trace.includes(cell)) return;

    const last = trace[trace.length - 1];
    if (last !== undefined && !touching(last, cell)) return;

    trace.push(cell);
    paint();
  }

  function touching(a, b) {
    const cols = run.puzzle.cols;
    const dr = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
    const dc = Math.abs((a % cols) - (b % cols));
    return dr <= 1 && dc <= 1 && (dr || dc);
  }

  function submit() {
    if (trace.length < 4) {
      /* Too short is a refusal like any other, and looks like one. The server
       * never sees it, so the view has to say so itself. */
      if (trace.length) {
        ctx.say("Four letters or more.", "bad");
        refuse(trace);
      }
      trace = [];
      paint();
      return;
    }
    ctx.actions.guess(trace.slice());
  }

  /*
   * A word the board will not take.
   *
   * The letters that were traced flash back, not just the board: it says
   * "that one", rather than "something went wrong somewhere".
   */
  function refuse(path) {
    for (const cell of path) {
      const node = board.querySelector(`[data-cell="${cell}"]`);
      if (node) node.classList.add("refused");
    }
    board.classList.add("shake");
    setTimeout(() => {
      board.classList.remove("shake");
      for (const node of board.querySelectorAll(".refused")) node.classList.remove("refused");
    }, 420);
  }

  function clear() {
    trace = [];
    paint();
  }

  function listen() {
    board.addEventListener("pointerdown", (event) => {
      const cell = cellFrom(event.target);
      if (cell === null) return;
      event.preventDefault();

      /* Tapping the square you finished on submits, so a trace can be built
       * entirely by tapping. */
      if (!dragging && trace.length && cell === trace[trace.length - 1]) {
        submit();
        return;
      }
      dragging = true;
      slid = false;
      if (!trace.length || !touching(trace[trace.length - 1], cell)) trace = [];
      extend(cell);
    });

    board.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      /* The pointer is captured by the square it started on, so the square
       * under the finger has to be looked up rather than read off the event. */
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const cell = cellFrom(under);
      if (cell === null || cell === trace[trace.length - 1]) return;

      const before = trace.length;
      extend(cell);
      if (trace.length !== before) slid = true;
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      /* Only a real drag submits on release. A tap leaves the trace standing,
       * so the next letter can be tapped, and tapping the last one again is
       * what says "that is my word". */
      if (slid && trace.length > 1) submit();
      slid = false;
    };
    board.addEventListener("pointerup", finish);
    board.addEventListener("pointercancel", finish);

    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener("keydown", onKey);
      if (event.target.closest("input, textarea")) return;
      if (event.key === "Enter" && trace.length) { event.preventDefault(); submit(); }
      if (event.key === "Escape") clear();
    };
    document.addEventListener("keydown", onKey);

    /* The lines are drawn from measured positions, so they are redrawn when
     * those positions change. */
    const onResize = () => { if (el.isConnected) paint(); else window.removeEventListener("resize", onResize); };
    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => { if (el.isConnected) paint(); });
  }
}
