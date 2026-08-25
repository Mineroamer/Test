/*
 * Pips.
 *
 * A board of squares grouped into regions, each with a rule, and a tray of
 * dominoes to cover it with.
 *
 * How a domino is placed: tap one in the tray to pick it up, tap it again to
 * turn it a quarter turn clockwise, then drag it onto the board. The square
 * under your finger is where the first half lands and the second follows in
 * whichever direction the domino is pointing, so what you see under your hand
 * is exactly what you get.
 *
 * A domino has four positions, not two. Right, down, left, up - because which
 * end lands where is usually the whole puzzle, and a "flip" that only swapped
 * horizontal for vertical could not express half of the placements. Turning it
 * four times brings it back to where it started.
 *
 * Dragging is the way it is meant to be played, but every drag has a tap-only
 * equivalent - pick up, turn, tap a square - because a drag is not available
 * to somebody using a keyboard, and a game that can only be played with a
 * mouse is a game some people cannot play.
 */

import { h, swap } from "../ui.js";

const RULE_LABEL = {
  sum: (rule) => String(rule.n),
  equal: () => "=",
  differ: () => "≠",
  less: (rule) => `<${rule.n}`,
  more: (rule) => `>${rule.n}`,
  free: () => "",
};

const RULE_WORDS = {
  sum: (rule) => `adds up to ${rule.n}`,
  equal: () => "all the same",
  differ: () => "all different",
  less: (rule) => `adds up to less than ${rule.n}`,
  more: (rule) => `adds up to more than ${rule.n}`,
  free: () => "no rule",
};

/*
 * The four positions, as the step from the first half to the second. Clockwise
 * from pointing right, so turning once always looks like a quarter turn.
 */
const TURNS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const TURN_WORDS = ["pointing right", "pointing down", "pointing left", "pointing up"];

/* How far a finger may wander before it counts as a drag rather than a tap. */
const DRAG_SLOP = 7;

export function create(ctx) {
  let run = ctx.run;
  let held = null;      // which domino is in hand
  let turn = 0;         // which way it points
  let drag = null;      // a drag in progress, or null

  const board = h("div.pip-board");
  const tray = h("div.pip-tray");
  const note = h("p.small.muted", { style: { margin: 0, minHeight: "1.3em" } });
  /* The domino that follows your finger. One element, reused, parked out of
   * the way when nothing is being dragged. */
  const ghost = h("div.pip-ghost", { hidden: true, "aria-hidden": "true" });

  const el = h("div.stack", {},
    board,
    note,
    h("div.spread",
      h("span.label", {}, "Dominoes"),
      h("span.tiny.muted", {}, "tap to pick up · tap again to turn · drag onto the board")),
    tray,
    ghost);

  paint();

  return {
    el,
    /*
     * Never disabled. The footer is only redrawn when the server answers
     * something, and picking a domino up is a local move - so a button that
     * greys itself out when nothing is held would still be grey after you
     * picked one up. That is exactly what it used to do, which made turning a
     * domino impossible and most boards unplayable.
     */
    controls: () => h("button.small", { onClick: rotate }, "Turn ↻"),
    update(next, result) {
      run = next;
      if (result && result.ok) {
        /* Placed or lifted: put the domino down and start again. */
        if (result.lifted === undefined) { held = null; turn = 0; }
      }
      paint();
    },
    reject() {
      paint();
    },
    outcome: () => h("p.small.muted", { style: { margin: 0 } },
      "Every puzzle here has exactly one answer - the generator solves it before dealing it."),
  };

  /* -------------------------------------------------------------- paint */

  function regionOf(puzzle) {
    const map = new Map();
    puzzle.regions.forEach((region, index) => {
      for (const key of region.cells) map.set(key, index);
    });
    return map;
  }

  /*
   * Give each region a tint no neighbouring region shares.
   *
   * Cycling the tints by region number is not enough: two regions that happen
   * to be six apart in the list end up the same colour, and if they touch they
   * read as one region - which, in a game about which squares group together,
   * is the one thing the board must never say wrongly.
   *
   * Greedy colouring over the regions' adjacency. Four would provably do for a
   * flat map; six gives the greedy pass room and keeps the palette varied.
   */
  function tintRegions(puzzle, regions) {
    const TINTS = 6;
    const neighbours = puzzle.regions.map(() => new Set());

    for (const key of puzzle.cells) {
      const [row, col] = key.split(",").map(Number);
      const mine = regions.get(key);
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const theirs = regions.get(`${row + dr},${col + dc}`);
        if (theirs !== undefined && theirs !== mine) {
          neighbours[mine].add(theirs);
          neighbours[theirs].add(mine);
        }
      }
    }

    const tint = new Array(puzzle.regions.length).fill(-1);
    /* Most-connected regions first: they are the hardest to place, and doing
     * them while every tint is still free is what keeps the greedy pass honest. */
    const order = puzzle.regions
      .map((_, index) => index)
      .sort((a, b) => neighbours[b].size - neighbours[a].size);

    for (const index of order) {
      const taken = new Set([...neighbours[index]].map((other) => tint[other]));
      let choice = 0;
      while (choice < TINTS && taken.has(choice)) choice += 1;
      tint[index] = choice % TINTS;
    }
    return tint;
  }

  function paint() {
    const p = run.puzzle;
    const regions = regionOf(p);
    const tint = tintRegions(p, regions);
    const onBoard = new Set(p.cells);
    const covered = new Map();     // square -> { value, domino }

    for (const one of p.placed) {
      one.cells.forEach((key, i) => covered.set(key, { value: one.values[i], domino: one.domino }));
    }

    const hinted = new Set(p.hints.flatMap((one) => one.cells));
    const broken = new Set();
    for (const state of p.regionState) {
      if (!state.ok) for (const key of p.regions[state.index].cells) broken.add(key);
    }

    board.style.setProperty("--cols", p.cols);
    board.style.setProperty("--rows", p.rows);

    const squares = [];
    for (let row = 0; row < p.rows; row++) {
      for (let col = 0; col < p.cols; col++) {
        const key = `${row},${col}`;

        if (!onBoard.has(key)) {
          squares.push(h("div.pip-gap"));
          continue;
        }

        const index = regions.get(key);
        const region = index === undefined ? null : p.regions[index];
        const here = covered.get(key);
        /* The rule is written once per region, on its first square. */
        const first = region && region.cells[0] === key;

        squares.push(h("button.pip-cell", {
          class: [
            here ? "filled" : "",
            broken.has(key) ? "broken" : "",
            hinted.has(key) ? "given" : "",
          ].filter(Boolean).join(" "),
          /* Drop targets are found by hit-testing under the finger, so every
           * square carries the name the engine knows it by. */
          dataset: { region: index === undefined ? "" : tint[index], key },
          disabled: p.status !== "playing",
          onClick: () => tapSquare(key),
          onPointerdown: here ? (event) => liftFromBoard(event, here.domino) : null,
          "aria-label": region
            ? `Square ${key}, region ${RULE_WORDS[region.rule.kind](region.rule)}${here ? `, showing ${here.value}` : ", empty"}`
            : `Square ${key}`,
        },
          first && region.rule.kind !== "free"
            ? h("span.pip-rule", {}, RULE_LABEL[region.rule.kind](region.rule))
            : null,
          here ? pipFace(here.value) : null));
      }
    }
    swap(board, squares);

    swap(tray, p.dominoes.map((domino, index) => {
      const down = p.placed.find((one) => one.domino === index);
      const mine = held === index;
      const upright = mine && (turn === 1 || turn === 3);
      const values = mine && (turn === 2 || turn === 3) ? [domino[1], domino[0]] : domino;

      return h("button.pip-domino", {
        class: [down ? "down" : "", mine ? "held" : "", upright ? "upright" : ""].filter(Boolean).join(" "),
        disabled: p.status !== "playing",
        onPointerdown: (event) => startPointer(event, index, !!down),
        "aria-label": `Domino ${domino[0]} and ${domino[1]}`
          + (down ? ", on the board" : mine ? `, in hand, ${TURN_WORDS[turn]}` : ""),
        "aria-pressed": String(mine),
      },
        h("span.pip-half", {}, pipFace(values[0])),
        h("span.pip-half", {}, pipFace(values[1])));
    }));

    note.textContent = message(p);
  }

  function message(p) {
    if (p.status !== "playing") return "";
    if (held === null) return "Tap a domino to pick it up.";
    return `Tap it again to turn it, or drag it onto the board. ${capitalise(TURN_WORDS[turn])}.`;
  }

  /* A declaration, not a const: paint() runs during setup and reaches this
   * through message(), long before a const down here would exist. */
  function capitalise(words) {
    return words[0].toUpperCase() + words.slice(1);
  }

  /* The dots on a domino face, in the arrangement everyone recognises. */
  function pipFace(value) {
    const spots = {
      0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    }[value] || [];
    const lit = new Set(spots);

    return h("span.pip-face", { "aria-hidden": "true" },
      Array.from({ length: 9 }, (_, i) => h("i", { class: lit.has(i) ? "on" : "" })));
  }

  /* ------------------------------------------------------------- placing */

  function partnerOf(key, which) {
    const [row, col] = key.split(",").map(Number);
    const [dr, dc] = TURNS[which];
    return `${row + dr},${col + dc}`;
  }

  /** The pair a domino would cover from here, or null if it will not fit. */
  function pairAt(key, which, index) {
    const p = run.puzzle;
    const partner = partnerOf(key, which);
    const on = new Set(p.cells);
    if (!on.has(key) || !on.has(partner)) return null;

    /* Its own squares do not count as in the way: moving a domino along by one
     * is a normal thing to want to do. */
    const taken = new Set(p.placed
      .filter((one) => one.domino !== index)
      .flatMap((one) => one.cells));
    if (taken.has(key) || taken.has(partner)) return null;

    return [key, partner];
  }

  function place(key) {
    const pair = pairAt(key, turn, held);
    if (!pair) {
      ctx.say("It will not fit that way. Turn it, or try somewhere else.", "bad");
      return;
    }
    ctx.actions.guess({
      domino: held,
      cells: pair.map((one) => one.split(",").map(Number)),
      /* The first half always lands on the square you pointed at, so the four
       * turns already say which way round it goes. Nothing left to flip. */
      flip: false,
    });
  }

  function rotate() {
    if (held === null) {
      ctx.say("Pick a domino up first.", "");
      return;
    }
    turn = (turn + 1) % 4;
    paint();
  }

  function tapSquare(key) {
    const sitting = run.puzzle.placed.find((one) => one.cells.includes(key));

    /* Tapping a domino already down picks it back up. */
    if (sitting && held === null) {
      ctx.actions.guess({ domino: sitting.domino, lift: true });
      return;
    }
    if (held === null) {
      ctx.say("Pick a domino from below first.", "");
      return;
    }
    place(key);
  }

  /* ------------------------------------------------------------ dragging */

  /*
   * One pointer gesture covers both jobs. Press and let go without moving and
   * it is a tap - pick up, or turn what is already in hand. Press and move and
   * it becomes a drag, with the domino following your finger until you let go
   * over a square.
   */
  function startPointer(event, index, isDown) {
    if (run.puzzle.status !== "playing") return;
    if (event.button !== undefined && event.button > 0) return;   // right-click
    event.preventDefault();

    /* Something already on the board comes off first, and the drag continues
     * with it in hand. */
    if (isDown) {
      ctx.actions.guess({ domino: index, lift: true });
    }

    const wasHeld = held === index;
    if (!wasHeld) { held = index; turn = 0; paint(); }

    begin(event, index, wasHeld);
  }

  /** Dragging a domino straight off the board, without tapping it first. */
  function liftFromBoard(event, index) {
    if (run.puzzle.status !== "playing") return;
    if (event.button !== undefined && event.button > 0) return;
    /* Only once it actually moves - a plain tap on a placed domino still means
     * "pick this up", which the click handler deals with. */
    begin(event, index, false, { fromBoard: true });
  }

  /*
   * The gesture is followed on the window, not on the domino that started it.
   *
   * Picking a domino up repaints the tray, and a repaint replaces every button
   * in it - including the one the pointer came down on. Listeners hung on that
   * button go with it, so the first version could only drag a domino that had
   * already been tapped once: reaching straight for one and dragging it, which
   * is what anybody would actually do, did nothing at all. The window is still
   * there whatever the tray does.
   */
  function begin(event, index, wasHeld, options = {}) {
    const pointer = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    function move(moveEvent) {
      if (moveEvent.pointerId !== pointer) return;   // a second finger
      if (!moved) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_SLOP) return;
        moved = true;
        if (options.fromBoard) {
          /* Now it is a real drag, take it off the board and into the hand. */
          held = index;
          turn = 0;
          ctx.actions.guess({ domino: index, lift: true });
          paint();
        }
        openGhost(index);
      }
      moveEvent.preventDefault();
      moveGhost(moveEvent.clientX, moveEvent.clientY);
    }

    function done(upEvent) {
      if (upEvent.pointerId !== pointer) return;
      stop();

      if (!moved) {
        /* A tap. On the domino already in hand, that means turn it. */
        if (wasHeld) rotate();
        return;
      }

      const key = squareUnder(upEvent.clientX, upEvent.clientY);
      closeGhost();
      if (key) place(key);
      else paint();
    }

    function cancel(cancelEvent) {
      if (cancelEvent.pointerId !== pointer) return;
      stop();
      closeGhost();
      paint();
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", cancel);
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", cancel);
  }

  /** Which square is under a point on the screen, if any. */
  function squareUnder(x, y) {
    /* The ghost is under the finger, so it would win every hit test. */
    ghost.hidden = true;
    const found = document.elementFromPoint(x, y);
    ghost.hidden = false;
    const cell = found && found.closest ? found.closest(".pip-cell") : null;
    return cell && cell.dataset ? cell.dataset.key || null : null;
  }

  function openGhost(index) {
    const domino = run.puzzle.dominoes[index];
    const cell = board.querySelector(".pip-cell");
    const size = cell ? cell.getBoundingClientRect().width : 44;

    drag = { index, size };
    ghost.style.setProperty("--pip", `${size}px`);
    ghost.dataset.turn = String(turn);
    swap(ghost,
      h("span.pip-half", {}, pipFace(domino[0])),
      h("span.pip-half", {}, pipFace(domino[1])));
    ghost.hidden = false;
    board.classList.add("dragging");
  }

  function moveGhost(x, y) {
    if (!drag) return;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    ghost.dataset.turn = String(turn);

    /* Show where it would land, and whether it would be allowed to. */
    const key = squareUnder(x, y);
    const pair = key ? pairAt(key, turn, held) : null;
    for (const cell of board.querySelectorAll(".pip-cell")) {
      cell.classList.remove("target", "no");
    }
    if (!key) return;
    if (pair) {
      for (const one of pair) {
        const cell = board.querySelector(`.pip-cell[data-key="${one}"]`);
        if (cell) cell.classList.add("target");
      }
    } else {
      const cell = board.querySelector(`.pip-cell[data-key="${key}"]`);
      if (cell) cell.classList.add("no");
    }
  }

  function closeGhost() {
    drag = null;
    ghost.hidden = true;
    board.classList.remove("dragging");
    for (const cell of board.querySelectorAll(".pip-cell")) {
      cell.classList.remove("target", "no");
    }
  }
}
