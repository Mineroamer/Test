/*
 * Letter Boxed.
 *
 * The box is drawn rather than laid out in HTML, because the game is about
 * where the letters are: the line tracing your word from side to side is the
 * clearest way to show why a move was illegal.
 */

import { h, swap } from "../ui.js";

const SIZE = 300;
const PAD = 42;
const RADIUS = 17;

export function create(ctx) {
  let run = ctx.run;
  let typed = "";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("class", "box-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "The letter box");

  const entry = h("div.bee-entry", { "aria-live": "polite" });
  const chain = h("div.word-chain");
  const status = h("div.spread");

  const el = h("div.stack", {},
    status,
    h("div.box-wrap", svg),
    entry,
    h("div.row", { style: { justifyContent: "center" } },
      h("button.small", { onClick: rub }, "⌫"),
      h("button.primary.small", { onClick: submit }, "Enter word")),
    chain);

  paint();
  listen();

  return {
    el,
    update(next, result) {
      run = next;
      if (result && result.ok) {
        typed = "";
        if (result.left > 0) ctx.say(`${result.left} letters to go.`, "");
      }
      paint();
    },
    reject() {
      entry.classList.add("shake");
      setTimeout(() => entry.classList.remove("shake"), 420);
    },
    outcome: (r) => r.puzzle.solution
      ? h("div", {},
          h("span.label", {}, "One way through "),
          h("b", {}, r.puzzle.solution.map((w) => w.toUpperCase()).join(" → ")))
      : null,
  };

  /* ---------------------------------------------------------- geometry */

  /* Three letters to a side, evenly spaced along it, clockwise from the top. */
  function positionOf(side, index) {
    const span = SIZE - PAD * 2;
    const at = PAD + (span * (index + 1)) / 4;
    if (side === 0) return { x: at, y: PAD };
    if (side === 1) return { x: SIZE - PAD, y: at };
    if (side === 2) return { x: SIZE - at, y: SIZE - PAD };
    return { x: PAD, y: SIZE - at };
  }

  function findLetter(letter) {
    for (let side = 0; side < 4; side++) {
      const index = run.puzzle.sides[side].indexOf(letter);
      if (index !== -1) return positionOf(side, index);
    }
    return null;
  }

  /* ------------------------------------------------------------ paint */

  function paint() {
    const p = run.puzzle;
    const used = new Set(p.used);
    const playing = p.status === "playing";

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const make = (tag, attrs) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };

    svg.append(make("rect", {
      x: PAD, y: PAD, width: SIZE - PAD * 2, height: SIZE - PAD * 2, class: "side-line", rx: 2,
    }));

    /* The line through the word being typed. */
    if (typed.length > 1) {
      const points = [...typed].map(findLetter).filter(Boolean);
      if (points.length > 1) {
        svg.append(make("polyline", {
          class: "path-line",
          points: points.map((pt) => `${pt.x},${pt.y}`).join(" "),
        }));
      }
    }

    const current = typed[typed.length - 1];
    p.sides.forEach((side, sideIndex) => {
      side.forEach((letter, index) => {
        const at = positionOf(sideIndex, index);
        const node = make("circle", {
          cx: at.x, cy: at.y, r: RADIUS,
          class: ["node", used.has(letter) ? "used" : "", letter === current ? "active" : ""].filter(Boolean).join(" "),
        });
        if (playing) node.addEventListener("click", () => push(letter));

        const text = make("text", { x: at.x, y: at.y + 1 });
        text.textContent = letter.toUpperCase();
        svg.append(node, text);
      });
    });

    const last = p.words[p.words.length - 1];
    swap(entry,
      typed
        ? [...typed].map((c) => h("span", {}, c))
        : h("span.muted", { style: { fontWeight: "400", fontSize: "1rem", letterSpacing: "0" } },
            last ? `Start on ${last[last.length - 1].toUpperCase()}` : "Tap letters to spell a word"),
      h("span.caret", {}, "|"));

    swap(status,
      h("span.label", {}, `${p.words.length} of ${p.limit} words`),
      h("span.mono.small", { style: { color: p.left ? "var(--muted)" : "var(--ok)" } },
        p.left ? `${p.left} letters left` : "all letters used"));

    swap(chain,
      p.words.length
        ? p.words.flatMap((word, i) => [
            i ? h("span.arrow", {}, "→") : null,
            h("span.w", {}, word),
          ]).filter(Boolean)
        : h("span.small.muted", {},
            "Each word starts on the letter the last one ended on. Never two letters from the same side."),
      (p.hints || []).map((hint) =>
        h("span.small.muted", {}, ` Hint: ${hint.start.toUpperCase()}…, ${hint.length} letters`)));
  }

  /* ------------------------------------------------------------ input */

  function push(letter) {
    if (run.puzzle.status !== "playing") return;
    typed += letter;
    paint();
  }

  function rub() {
    typed = typed.slice(0, -1);
    paint();
  }

  function submit() {
    if (typed.length) ctx.actions.guess(typed);
  }

  function listen() {
    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener("keydown", onKey);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest("input, textarea")) return;

      if (event.key === "Enter") { event.preventDefault(); submit(); }
      else if (event.key === "Backspace") { event.preventDefault(); rub(); }
      else if (/^[a-zA-Z]$/.test(event.key)) {
        const letter = event.key.toLowerCase();
        /* Only letters that are actually on the box. */
        if (run.puzzle.sides.some((side) => side.includes(letter))) push(letter);
      }
    };
    document.addEventListener("keydown", onKey);
  }
}
