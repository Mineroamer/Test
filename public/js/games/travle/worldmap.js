/*
 * The world map: builds the SVG once, then repaints country states and moves
 * the view as the trail grows. No labels are ever drawn on it - the countries
 * are yours to recognise.
 *
 * The view can be panned and zoomed by hand. Everything drawn on top of the
 * map - the markers, the microstate rings, the Bering crossing, every stroke -
 * is held at a constant size on screen, so zooming in shows more coastline
 * rather than bigger furniture.
 */
(function (root) {
  "use strict";

  const MAP = root.MAP;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const MIN_SPAN = 45;          // furthest you may zoom in: where the outlines
                                // still hold their shape, given how far the
                                // source geometry was simplified
  const AUTO_MIN_SPAN = 260;    // the automatic framing never goes closer
  const FRAME_PAD = 0.22;
  const WHEEL_STEP = 0.0016;    // zoom per unit of wheel delta

  function make(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  const clampTo = (value, low, high) => Math.min(Math.max(value, low), high);

  function WorldMap(svg) {
    this.svg = svg;
    this.shapes = new Map();
    this.specks = new Map();
    this.marks = {};
    this.at = {};                 // where each marker sits, in map units
    this.view = [0, 0, MAP.width, MAP.height];
    this.animation = null;
    this.userMoved = false;       // true once the player takes the view over
    this.pointers = new Map();
    this.pinch = null;
    this.build();
    this.listen();
    this.apply();
  }

  /* ------------------------------------------------------------------ build */

  WorldMap.prototype.build = function () {
    const svg = this.svg;
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      "World map of your trail. Drag to move it, scroll or use the plus and minus keys to zoom.");

    svg.appendChild(make("rect", {
      class: "sea", x: -2000, y: -2000, width: MAP.width + 4000, height: MAP.height + 4000,
    }));
    svg.appendChild(make("path", { class: "other-land", d: MAP.other }));

    const land = make("g", { class: "lands" });
    for (const code of Object.keys(MAP.shapes)) {
      const path = make("path", { class: "country", d: MAP.shapes[code], "data-c": code, "data-state": "idle" });
      land.appendChild(path);
      this.shapes.set(code, path);
    }
    svg.appendChild(land);

    // Microstates are a speck at this scale, so they also get a ring. Radii
    // here are in screen pixels: the group scale converts them.
    const specks = make("g", { class: "specks" });
    for (const code of MAP.tiny) {
      if (!MAP.centres[code]) continue;
      const ring = make("circle", { class: "speck", r: 3.6, "data-c": code, "data-state": "idle" });
      specks.appendChild(ring);
      this.specks.set(code, ring);
    }
    svg.appendChild(specks);

    const overlay = make("g", { class: "marks" });

    this.bering = make("g", { class: "bering", "data-used": "false" });
    this.bering.appendChild(make("line", {
      class: "bering-line",
      x1: MAP.bering.ru[0], y1: MAP.bering.ru[1], x2: MAP.bering.us[0], y2: MAP.bering.us[1],
    }));
    const beringRing = make("g", { class: "bering-ring-at" });
    beringRing.appendChild(make("circle", { class: "bering-ring", r: 10 }));
    this.bering.appendChild(beringRing);
    this.at.bering = [(MAP.bering.ru[0] + MAP.bering.us[0]) / 2, (MAP.bering.ru[1] + MAP.bering.us[1]) / 2];
    this.marks.bering = beringRing;
    overlay.appendChild(this.bering);

    /* Every other sea crossing is drawn on demand, once the player takes it:
     * a dashed line between the two countries' centres, the same mark the
     * Bering strait gets. The Bering line stays hand-placed above because
     * Russia's centre is deep in Siberia and America's is in Kansas - a line
     * between those two says nothing about the strait. */
    this.crossings = make("g", { class: "crossings" });
    overlay.appendChild(this.crossings);

    this.marks.start = make("g", { class: "mark mark-start" });
    this.marks.start.appendChild(make("circle", { class: "mark-ring", r: 9 }));
    this.marks.start.appendChild(make("circle", { class: "mark-core", r: 3.4 }));

    this.marks.end = make("g", { class: "mark mark-end" });
    this.marks.end.appendChild(make("circle", { class: "mark-ring", r: 11 }));
    this.marks.end.appendChild(make("circle", { class: "mark-ring-inner", r: 6 }));
    this.marks.end.appendChild(make("circle", { class: "mark-core", r: 2 }));

    this.marks.here = make("g", { class: "mark mark-here" });
    this.marks.here.appendChild(make("circle", { class: "mark-pulse", r: 7 }));
    this.marks.here.appendChild(make("circle", { class: "mark-core", r: 3.6 }));

    overlay.append(this.marks.start, this.marks.end, this.marks.here);
    svg.appendChild(overlay);
  };

  /* ------------------------------------------------------------------ paint */

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

    this.at.start = MAP.centres[game.start] || null;
    this.at.end = MAP.centres[game.end] || null;
    this.at.here = MAP.centres[game.current] || null;
    this.marks.here.classList.toggle("at-finish", game.current === game.end);

    /* Which crossings this trail actually used. The Bering strait has its own
     * marker; the rest get a line drawn between their centres. */
    let usedBering = false;
    this.crossings.textContent = "";
    for (let i = 1; i < game.trail.length; i += 1) {
      const from = game.trail[i - 1];
      const to = game.trail[i];
      if (!root.Engine.linkBetween(from, to)) continue;
      if ((from === "RU" && to === "US") || (from === "US" && to === "RU")) {
        usedBering = true;
        continue;
      }
      const a = MAP.centres[from];
      const b = MAP.centres[to];
      if (!a || !b) continue;
      this.crossings.appendChild(make("line", {
        class: "crossing-line",
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
      }));
    }
    this.bering.setAttribute("data-used", String(usedBering));

    this.place();
  };

  /* ------------------------------------------------- view, scale and placing */

  /** Map units per screen pixel at the current zoom. */
  WorldMap.prototype.unit = function () {
    const width = this.svg.clientWidth || this.svg.getBoundingClientRect().width;
    return width ? this.view[2] / width : 1;
  };

  /**
   * Put every marker where it belongs and shrink it by the current zoom, so
   * each one keeps the size it was drawn at no matter how far in you go.
   */
  WorldMap.prototype.place = function () {
    const scale = this.unit();
    for (const key of ["start", "end", "here", "bering"]) {
      const mark = this.marks[key];
      const at = this.at[key];
      if (!mark) continue;
      if (!at) {
        mark.setAttribute("hidden", "hidden");
        continue;
      }
      mark.removeAttribute("hidden");
      mark.setAttribute("transform", "translate(" + at[0] + " " + at[1] + ") scale(" + scale + ")");
    }
    for (const [code, speck] of this.specks) {
      const at = MAP.centres[code];
      speck.setAttribute("transform", "translate(" + at[0] + " " + at[1] + ") scale(" + scale + ")");
    }
  };

  WorldMap.prototype.aspect = function () {
    const rect = this.svg.getBoundingClientRect();
    return rect.width && rect.height ? rect.width / rect.height : MAP.width / MAP.height;
  };

  /**
   * Force a box to the shape of the element and to a sensible size, then keep
   * it over the map. The viewBox aspect must match the element exactly or the
   * pointer-to-map arithmetic below stops being true.
   */
  WorldMap.prototype.clamp = function (box, minSpan) {
    const aspect = this.aspect();
    let [x, y, width, height] = box;

    width = clampTo(width, minSpan || MIN_SPAN, MAP.width);
    height = width / aspect;
    if (height > MAP.height * 1.6) {
      height = MAP.height * 1.6;
      width = height * aspect;
    }

    let cx = x + box[2] / 2;
    let cy = y + box[3] / 2;
    cx = width >= MAP.width ? MAP.width / 2 : clampTo(cx, width / 2, MAP.width - width / 2);
    cy = height >= MAP.height ? MAP.height / 2 : clampTo(cy, height / 2, MAP.height - height / 2);

    return [cx - width / 2, cy - height / 2, width, height];
  };

  WorldMap.prototype.apply = function () {
    this.svg.setAttribute("viewBox", this.view.map((n) => Math.round(n * 100) / 100).join(" "));
    this.place();
  };

  WorldMap.prototype.moveTo = function (box, animate, minSpan) {
    const target = this.clamp(box, minSpan);
    if (this.animation) cancelAnimationFrame(this.animation);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || still) {
      this.view = target;
      this.apply();
      return;
    }

    const from = this.view.slice();
    const started = performance.now();
    const duration = 520;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const k = ease(t);
      this.view = from.map((v, i) => v + (target[i] - v) * k);
      this.apply();
      this.animation = t < 1 ? requestAnimationFrame(step) : null;
    };
    this.animation = requestAnimationFrame(step);
  };

  /* ---------------------------------------------------------------- framing */

  /** The box that holds the countries that matter right now. */
  WorldMap.prototype.boxFor = function (codes) {
    const boxes = codes.map((c) => MAP.bounds[c]).filter(Boolean);
    if (!boxes.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const box of boxes) {
      x0 = Math.min(x0, box[0]);
      y0 = Math.min(y0, box[1]);
      x1 = Math.max(x1, box[2]);
      y1 = Math.max(y1, box[3]);
    }
    const padX = (x1 - x0) * FRAME_PAD + 24;
    const padY = (y1 - y0) * FRAME_PAD + 24;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;

    const aspect = this.aspect();
    let width = Math.max(x1 - x0, AUTO_MIN_SPAN);
    let height = Math.max(y1 - y0, AUTO_MIN_SPAN / aspect);
    if (width / height < aspect) width = height * aspect;
    return [(x0 + x1) / 2 - width / 2, (y0 + y1) / 2 - width / aspect / 2, width, width / aspect];
  };

  /** Frame the route and hand the view back to the game. */
  WorldMap.prototype.fit = function (codes, animate) {
    const box = this.boxFor(codes);
    if (!box) return;
    this.userMoved = false;
    this.moveTo(box, animate !== false, AUTO_MIN_SPAN);
  };

  /** Follow the route, unless the player has taken the view over. */
  WorldMap.prototype.follow = function (codes) {
    if (this.userMoved) return;
    this.fit(codes, true);
  };

  /* ------------------------------------------------------- pan, zoom, input */

  /** Where a screen point sits on the map. */
  WorldMap.prototype.pointAt = function (clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return [
      this.view[0] + ((clientX - rect.left) / rect.width) * this.view[2],
      this.view[1] + ((clientY - rect.top) / rect.height) * this.view[3],
    ];
  };

  WorldMap.prototype.take = function () {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = null;
    this.userMoved = true;
  };

  /** Zoom by a factor, holding one screen point still under the pointer. */
  WorldMap.prototype.zoomAt = function (factor, clientX, clientY) {
    this.take();
    const rect = this.svg.getBoundingClientRect();
    const anchor = clientX === undefined
      ? [this.view[0] + this.view[2] / 2, this.view[1] + this.view[3] / 2]
      : this.pointAt(clientX, clientY);
    const fx = clientX === undefined ? 0.5 : (clientX - rect.left) / rect.width;
    const fy = clientY === undefined ? 0.5 : (clientY - rect.top) / rect.height;

    const width = clampTo(this.view[2] / factor, MIN_SPAN, MAP.width);
    const height = width / this.aspect();
    this.view = this.clamp([anchor[0] - width * fx, anchor[1] - height * fy, width, height]);
    this.apply();
  };

  WorldMap.prototype.zoomBy = function (factor) {
    this.zoomAt(factor);
  };

  WorldMap.prototype.panByPixels = function (dx, dy) {
    this.take();
    const scale = this.unit();
    this.view = this.clamp([this.view[0] - dx * scale, this.view[1] - dy * scale, this.view[2], this.view[3]]);
    this.apply();
  };

  WorldMap.prototype.listen = function () {
    const svg = this.svg;

    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      this.zoomAt(Math.exp(-delta * WHEEL_STEP), event.clientX, event.clientY);
    }, { passive: false });

    svg.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.zoomAt(1.9, event.clientX, event.clientY);
    });

    svg.addEventListener("pointerdown", (event) => {
      svg.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) this.pinch = this.spread();
      svg.classList.add("is-dragging");
    });

    svg.addEventListener("pointermove", (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.pointers.size >= 2) {
        const now = this.spread();
        if (this.pinch && now.distance > 0 && this.pinch.distance > 0) {
          this.zoomAt(now.distance / this.pinch.distance, now.x, now.y);
        }
        this.pinch = now;
        return;
      }
      this.panByPixels(event.clientX - previous.x, event.clientY - previous.y);
    });

    const release = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = this.pointers.size === 2 ? this.spread() : null;
      if (!this.pointers.size) svg.classList.remove("is-dragging");
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);
    svg.addEventListener("lostpointercapture", release);

    svg.addEventListener("keydown", (event) => {
      const nudge = this.svg.getBoundingClientRect().width / 8;
      const keys = {
        ArrowLeft: () => this.panByPixels(nudge, 0),
        ArrowRight: () => this.panByPixels(-nudge, 0),
        ArrowUp: () => this.panByPixels(0, nudge),
        ArrowDown: () => this.panByPixels(0, -nudge),
        "+": () => this.zoomBy(1.4),
        "=": () => this.zoomBy(1.4),
        "-": () => this.zoomBy(1 / 1.4),
        _: () => this.zoomBy(1 / 1.4),
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
  };

  /** Centre and separation of the first two pointers, for pinch zoom. */
  WorldMap.prototype.spread = function () {
    const [a, b] = [...this.pointers.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  /** The element changed size: keep the view legal and the markers true. */
  WorldMap.prototype.onResize = function (codes) {
    if (!this.userMoved && codes) {
      this.fit(codes, false);
      return;
    }
    this.view = this.clamp(this.view);
    this.apply();
  };

  root.WorldMap = WorldMap;
})(typeof self !== "undefined" ? self : this);
