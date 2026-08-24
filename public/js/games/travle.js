/*
 * Travle Overland.
 *
 * The map and the country data are the originals, loaded as plain scripts and
 * reached through their globals. What changed is where the judging happens: in
 * the standalone game the browser held the route and marked its own answers,
 * and here the server does, so the same round can be resumed on another device
 * and can count towards a streak.
 *
 * The map renderer wants an object shaped like the engine's Game, so the
 * server's view is adapted into one rather than the renderer being rewritten.
 */

import { h, swap, clear } from "../ui.js";

const Engine = window.Engine;
const WorldMap = window.WorldMap;

export function create(ctx) {
  let run = ctx.run;
  let map = null;
  let highlight = -1;
  let suggestions = [];

  const mapSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mapSvg.setAttribute("class", "travle-map");
  mapSvg.setAttribute("tabindex", "0");
  mapSvg.setAttribute("role", "img");

  const input = h("input", {
    placeholder: "Name the next country",
    autocomplete: "off",
    autocapitalize: "words",
    spellcheck: false,
    "aria-label": "Name the next country",
  });

  const list = h("div.suggestions.hide", { role: "listbox" });
  const field = h("div", { style: { position: "relative", flex: "1", minWidth: "0" } }, input, list);
  const counters = h("div.spread");
  const trail = h("div.trail-list");
  const objective = h("div.spread");

  const el = h("div.stack", {},
    objective,
    h("div.map-frame", mapSvg),
    counters,
    h("div.row", field, h("button.primary", { onClick: submit }, "Go")),
    trail);

  /* The map builds itself once the SVG is in the document and has a size. */
  requestAnimationFrame(() => {
    if (!mapSvg.isConnected) return;
    map = new WorldMap(mapSvg);
    repaintMap(true);
  });

  paint();
  wire();

  return {
    el,
    controls: () => run.mode === "custom" ? null : h("button.small", { onClick: chooseDifficulty }, "Difficulty"),
    update(next, result) {
      run = next;
      input.value = "";
      closeList();
      if (result && result.move) say(result);
      paint();
      repaintMap(false, result && result.code);
    },
    reject() {
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 420);
      input.select();
    },
    outcome: (r) => r.puzzle.solution
      ? h("div.small", {},
          h("span.label", {}, "The short way "),
          r.puzzle.solution.map((code) => Engine.nameOf(code)).join(" → "))
      : null,
  };

  /* ---------------------------------------------------------- feedback */

  const WORDS = {
    closer: ["Closer.", ""],
    sideways: ["No nearer, no further.", ""],
    away: ["That is the wrong way.", "bad"],
    back: ["Back where you were.", ""],
    miss: ["", "bad"],
  };

  function say(result) {
    const [line, tone] = WORDS[result.move] || ["", ""];
    ctx.say(result.message || `${result.name}. ${line}`.trim(), tone);
  }

  /* ------------------------------------------------------------- paint */

  function paint() {
    const p = run.puzzle;

    swap(objective,
      h("div", {},
        h("span.label", {}, "From"),
        h("div", { style: { fontWeight: "700", fontStretch: "112%" } }, flag(p.start) + " " + p.startName)),
      h("div", { style: { textAlign: "right" } },
        h("span.label", {}, "To"),
        h("div", { style: { fontWeight: "700", fontStretch: "112%" } }, p.endName + " " + flag(p.end))));

    swap(counters,
      h("div.row",
        h("span.label", {}, "Moves left"),
        h("b.mono", { style: { color: p.left <= 1 ? "var(--off)" : "inherit" } }, p.left)),
      h("span.small.muted", {}, `par ${p.par}`),
      h("div.row",
        h("span.label", {}, "Still to cross"),
        h("b.mono", {}, p.toGo)));

    /* Every country stood on, plus the misses, in the order they happened. */
    const rows = [];
    rows.push(row(p.start, "start", "start"));
    for (const move of p.moves) {
      rows.push(row(move.code, move.move, move.name));
    }
    swap(trail, rows);

    if (p.outOfReach && p.status === "playing") {
      trail.prepend(h("p.small", { style: { color: "var(--off)", margin: 0 } },
        "You cannot reach the finish from here with the moves you have left."));
    }

    input.disabled = p.status !== "playing";
    if (p.status === "playing") input.focus({ preventScroll: true });
  }

  function row(code, move, name) {
    return h("div.trail-row", { class: move },
      h("span.flag", {}, flag(code)),
      h("span", {}, name === "start" ? Engine.nameOf(code) : name),
      h("span.move", {}, move === "start" ? "start" : move));
  }

  /* ISO 3166-1 alpha-2 maps onto the regional indicator block. */
  function flag(code) {
    return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }

  /*
   * The renderer expects the engine's Game. The server sends the same facts in
   * a plainer shape, so this is the adapter between them.
   */
  function asGame() {
    const p = run.puzzle;
    return {
      trail: p.trail,
      moves: p.moves,
      start: p.start,
      end: p.end,
      current: p.trail[p.trail.length - 1],
      status: p.status,
    };
  }

  function repaintMap(first, justEntered) {
    if (!map) return;
    map.paint(asGame(), justEntered || null, run.puzzle.solution || null);
    const codes = run.puzzle.solution
      ? run.puzzle.solution
      : [...run.puzzle.trail, run.puzzle.end];
    if (first) map.fit(codes, false);
    else map.follow(codes);
  }

  /* ------------------------------------------------------------- input */

  function wire() {
    input.addEventListener("input", () => {
      const text = input.value.trim();
      suggestions = text.length >= 1 ? Engine.suggest(text, 6) : [];
      highlight = suggestions.length ? 0 : -1;
      paintList();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!suggestions.length) return;
        event.preventDefault();
        highlight = (highlight + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
        paintList();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key === "Escape") closeList();
    });

    input.addEventListener("blur", () => setTimeout(closeList, 140));

    /* Undo the last step, which is Travle's alternative to a wasted guess. */
    el.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && run.puzzle.trail.length > 1) {
        event.preventDefault();
        ctx.actions.back();
      }
    });
  }

  function paintList() {
    if (!suggestions.length) return closeList();
    list.classList.remove("hide");
    swap(list, suggestions.map((code, index) =>
      h("button", {
        type: "button",
        role: "option",
        "aria-selected": index === highlight ? "true" : "false",
        onMouseDown: (event) => { event.preventDefault(); choose(code); },
      }, `${flag(code)}  ${Engine.nameOf(code)}`)));
  }

  function closeList() {
    list.classList.add("hide");
    clear(list);
    suggestions = [];
    highlight = -1;
  }

  function choose(code) {
    closeList();
    ctx.actions.guess(code);
  }

  function submit() {
    if (highlight >= 0 && suggestions[highlight]) return choose(suggestions[highlight]);
    const text = input.value.trim();
    if (!text) return;
    ctx.actions.guess(text);
  }

  /* -------------------------------------------------------- difficulty */

  function chooseDifficulty() {
    import("../ui.js").then(({ sheet }) => {
      sheet("Difficulty", (body, close) => {
        const current = run.difficulty;
        body.append(
          h("p.small.muted", { style: { margin: 0 } },
            "How much slack you get beyond the shortest route, and how long the routes are."),
          /* The daily levels each carry their own route for the day; the
           * unlimited pool is the widest and only applies to unlimited. */
          ...Object.entries(Engine.DIFFICULTIES)
            .filter(([, mode]) => (run.mode === "daily" ? mode.daily : true))
            .map(([key, mode]) =>
            h("button", {
              class: key === current ? "primary" : "",
              style: { justifyContent: "space-between", width: "100%" },
              onClick: () => {
                try { localStorage.setItem("pc:travle-difficulty", key); } catch { /* private browsing */ }
                close();
                location.reload();
              },
            },
              h("span", {}, mode.label || key),
              h("span.mono.tiny", {}, `+${mode.slack} moves`))));
      });
    });
  }
}
