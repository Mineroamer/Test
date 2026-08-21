/*
 * The world map: builds the SVG once, then repaints country states and
 * re-frames the view as the trail grows. No labels are ever drawn on it - the
 * countries are yours to recognise.
 */
(function (root) {
  "use strict";

  const MAP = root.MAP;
  const SVG_NS = "http://www.w3.org/2000/svg";

  function make(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function WorldMap(svg) {
    this.svg = svg;
    this.shapes = new Map();
    this.view = [0, 0, MAP.width, MAP.height];
    this.target = this.view.slice();
    this.animation = null;
    this.build();
  }

  WorldMap.prototype.build = function () {
    const svg = this.svg;
    svg.setAttribute("viewBox", this.view.join(" "));
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "World map showing the countries on your trail");

    svg.appendChild(make("rect", { class: "sea", x: -400, y: -400, width: MAP.width + 800, height: MAP.height + 800 }));
    svg.appendChild(make("path", { class: "other-land", d: MAP.other }));

    const land = make("g", { class: "lands" });
    for (const code of Object.keys(MAP.shapes)) {
      const path = make("path", { class: "country", d: MAP.shapes[code], "data-c": code, "data-state": "idle" });
      land.appendChild(path);
      this.shapes.set(code, path);
    }
    svg.appendChild(land);

    // Microstates are a speck at this scale, so they also get a ring.
    const specks = make("g", { class: "specks" });
    this.specks = new Map();
    for (const code of MAP.tiny) {
      const centre = MAP.centres[code];
      if (!centre) continue;
      const ring = make("circle", { class: "speck", cx: centre[0], cy: centre[1], r: 3, "data-c": code, "data-state": "idle" });
      specks.appendChild(ring);
      this.specks.set(code, ring);
    }
    svg.appendChild(specks);

    const marks = make("g", { class: "marks" });
    this.bering = make("g", { class: "bering", "data-used": "false" });
    this.bering.appendChild(make("line", {
      class: "bering-line",
      x1: MAP.bering.ru[0], y1: MAP.bering.ru[1], x2: MAP.bering.us[0], y2: MAP.bering.us[1],
    }));
    this.bering.appendChild(make("circle", { class: "bering-ring", cx: (MAP.bering.ru[0] + MAP.bering.us[0]) / 2, cy: (MAP.bering.ru[1] + MAP.bering.us[1]) / 2, r: 9 }));
    marks.appendChild(this.bering);

    this.startMark = make("g", { class: "mark mark-start" });
    this.startMark.appendChild(make("circle", { class: "mark-ring", r: 9 }));
    this.startMark.appendChild(make("circle", { class: "mark-core", r: 3.4 }));

    this.endMark = make("g", { class: "mark mark-end" });
    this.endMark.appendChild(make("circle", { class: "mark-ring", r: 11 }));
    this.endMark.appendChild(make("circle", { class: "mark-ring-inner", r: 6 }));
    this.endMark.appendChild(make("circle", { class: "mark-core", r: 2 }));

    this.hereMark = make("g", { class: "mark mark-here" });
    this.hereMark.appendChild(make("circle", { class: "mark-pulse", r: 7 }));
    this.hereMark.appendChild(make("circle", { class: "mark-core", r: 3.6 }));

    marks.append(this.startMark, this.endMark, this.hereMark);
    svg.appendChild(marks);
  };

  function place(mark, code) {
    const centre = MAP.centres[code];
    if (!centre) {
      mark.setAttribute("hidden", "hidden");
      return;
    }
    mark.removeAttribute("hidden");
    mark.setAttribute("transform", "translate(" + centre[0] + " " + centre[1] + ")");
  }

  /**
   * Repaint every country from the current game state. `reveal` is the route
   * the player never found, shown only once the round is lost.
   */
  WorldMap.prototype.paint = function (game, justEntered, reveal) {
    const trail = new Set(game.trail);
    const missed = new Set(game.moves.filter((m) => m.move === "miss").map((m) => m.code));
    const answer = new Set(reveal || []);
    const over = game.status !== "playing";

    for (const [code, node] of this.shapes) {
      let state = "idle";
      if (code === game.current) state = "here";
      else if (trail.has(code)) state = "trail";
      else if (code === game.end) state = over ? "finish-open" : "finish";
      else if (answer.has(code)) state = "answer";
      else if (missed.has(code)) state = "missed";
      node.setAttribute("data-state", state);
      const speck = this.specks.get(code);
      if (speck) speck.setAttribute("data-state", state);
      node.classList.toggle("is-new", code === justEntered);
    }

    place(this.startMark, game.start);
    place(this.endMark, game.end);
    place(this.hereMark, game.current);
    this.hereMark.classList.toggle("at-finish", game.current === game.end);

    const usedJump = game.trail.some((code, i) =>
      i > 0 && root.Engine.linkBetween(game.trail[i - 1], code));
    this.bering.setAttribute("data-used", String(usedJump));
  };

  /* ------------------------------------------------------------------ frame */

  const MIN_SPAN = 260; // never zoom closer than this slice of the world
  const PAD = 0.22;

  /** Fit the view around the countries that matter right now. */
  WorldMap.prototype.frame = function (codes, animate) {
    const boxes = codes.map((c) => MAP.bounds[c]).filter(Boolean);
    if (!boxes.length) return;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const box of boxes) {
      x0 = Math.min(x0, box[0]);
      y0 = Math.min(y0, box[1]);
      x1 = Math.max(x1, box[2]);
      y1 = Math.max(y1, box[3]);
    }

    const padX = (x1 - x0) * PAD + 24;
    const padY = (y1 - y0) * PAD + 24;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;

    const rect = this.svg.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : MAP.width / MAP.height;

    let width = Math.max(x1 - x0, MIN_SPAN);
    let height = Math.max(y1 - y0, MIN_SPAN / aspect);
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;

    // Keep the view inside the map, but allow it to be the whole map.
    width = Math.min(width, MAP.width);
    height = Math.min(height, MAP.height);
    if (width / height > aspect) width = height * aspect;
    else height = width / aspect;

    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    cx = Math.min(Math.max(cx, width / 2), MAP.width - width / 2);
    cy = Math.min(Math.max(cy, height / 2), MAP.height - height / 2);

    this.moveTo([cx - width / 2, cy - height / 2, width, height], animate);
  };

  WorldMap.prototype.moveTo = function (box, animate) {
    const from = this.view.slice();
    this.target = box;
    if (this.animation) cancelAnimationFrame(this.animation);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || still) {
      this.view = box;
      this.svg.setAttribute("viewBox", box.map((n) => Math.round(n * 10) / 10).join(" "));
      return;
    }

    const started = performance.now();
    const duration = 620;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const k = ease(t);
      this.view = from.map((v, i) => v + (box[i] - v) * k);
      this.svg.setAttribute("viewBox", this.view.map((n) => Math.round(n * 10) / 10).join(" "));
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.animation = null;
    };
    this.animation = requestAnimationFrame(step);
  };

  root.WorldMap = WorldMap;
})(typeof self !== "undefined" ? self : this);
