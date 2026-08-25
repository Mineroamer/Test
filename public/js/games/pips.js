/*
 * Pips.
 *
 * A board of squares grouped into regions, each with a rule, and a tray of
 * dominoes to cover it with.
 *
 * Placing is two taps rather than a drag: pick a domino, tap a square, tap the
 * square next to it. Dragging a two-square tile onto an irregular board with a
 * thumb is far harder than it looks, and two taps are unambiguous about which
 * way round the domino went - which matters, because which end lands where is
 * usually the whole puzzle.
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

export function create(ctx) {
  let run = ctx.run;
  let held = null;      // index of the domino in hand
  let anchor = null;    // first square tapped
  let flipped = false;

  const board = h("div.pip-board");
  const tray = h("div.pip-tray");
  const note = h("p.small.muted", { style: { margin: 0, minHeight: "1.3em" } });

  const el = h("div.stack", {}, board, note, h("span.label", {}, "Dominoes"), tray);

  paint();

  return {
    el,
    controls: () => h("button.small", {
      onClick: () => { flipped = !flipped; paint(); },
      disabled: held === null,
    }, "Turn it round"),
    update(next, result) {
      run = next;
      if (result && result.ok) {
        anchor = null;
        held = null;
        flipped = false;
      }
      paint();
    },
    reject() {
      anchor = null;
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
            anchor === key ? "anchor" : "",
            hinted.has(key) ? "given" : "",
          ].filter(Boolean).join(" "),
          dataset: { region: index === undefined ? "" : tint[index] },
          disabled: p.status !== "playing",
          onClick: () => tap(key),
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
      const values = held === index && flipped ? [domino[1], domino[0]] : domino;

      return h("button.pip-domino", {
        class: [down ? "down" : "", held === index ? "held" : ""].filter(Boolean).join(" "),
        disabled: p.status !== "playing",
        onClick: () => takeOrLift(index, !!down),
        "aria-label": `Domino ${domino[0]} and ${domino[1]}${down ? ", on the board" : ""}`,
      },
        h("span.pip-half", {}, pipFace(values[0])),
        h("span.pip-half", {}, pipFace(values[1])));
    }));

    note.textContent = message(p);
  }

  function message(p) {
    if (p.status !== "playing") return "";
    if (held === null) return "Pick a domino, then tap two squares next to each other.";
    if (anchor === null) return "Tap where its first half should go.";
    return "Now tap a square beside it.";
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

  /* -------------------------------------------------------------- moves */

  function takeOrLift(index, isDown) {
    if (isDown) {
      ctx.actions.guess({ domino: index, lift: true });
      return;
    }
    held = held === index ? null : index;
    anchor = null;
    flipped = false;
    paint();
  }

  function tap(key) {
    const p = run.puzzle;
    const sitting = p.placed.find((one) => one.cells.includes(key));

    /* Tapping a domino already down picks it back up. */
    if (sitting && held === null) {
      ctx.actions.guess({ domino: sitting.domino, lift: true });
      return;
    }
    if (held === null) {
      note.textContent = "Pick a domino from below first.";
      return;
    }
    if (anchor === null) {
      anchor = key;
      paint();
      return;
    }
    if (anchor === key) {
      anchor = null;
      paint();
      return;
    }

    ctx.actions.guess({
      domino: held,
      cells: [anchor.split(",").map(Number), key.split(",").map(Number)],
      flip: flipped,
    });
  }
}
