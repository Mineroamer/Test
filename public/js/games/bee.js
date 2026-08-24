/*
 * Spelling Bee.
 *
 * The hive is six hexagons around a compulsory seventh. Tapping a letter types
 * it; so does the keyboard. The outer six can be shuffled, which is the oldest
 * trick in the game for shaking a word loose.
 */

import { h, swap } from "../ui.js";

export function create(ctx) {
  let run = ctx.run;
  let typed = "";
  let outer = run.puzzle.outer.slice();

  const entry = h("div.bee-entry", { "aria-live": "polite" });
  const hive = h("div.hive");
  const progress = h("div.stack", { style: { gap: "6px" } });
  const found = h("div.stack", { style: { gap: "8px" } });

  const el = h("div.stack", {}, progress, entry, hive, found);

  paint();
  listen();

  return {
    el,
    controls: () => h("button.small", { onClick: shuffle }, "Shuffle"),
    update(next, result) {
      run = next;
      if (result && result.ok) {
        typed = "";
        ctx.say(
          result.pangram ? `Pangram! +${result.points}` : `+${result.points}`,
          result.pangram ? "good" : "");
      }
      paint();
    },
    reject() {
      entry.classList.add("shake");
      setTimeout(() => { entry.classList.remove("shake"); typed = ""; paint(); }, 420);
    },
    outcome: (r) => r.puzzle.answers
      ? h("div.stack", { style: { gap: "6px" } },
          h("span.label", {}, `All ${r.puzzle.answers.length} words`),
          h("div.found-list", r.puzzle.answers.map((word) =>
            h("span", {
              class: isPangram(word) ? "pangram" : "",
              style: r.puzzle.found.includes(word) ? null : { opacity: "0.55" },
            }, word))))
      : null,
  };

  function isPangram(word) {
    const letters = [run.puzzle.centre, ...run.puzzle.outer];
    return letters.every((c) => word.includes(c));
  }

  /* ------------------------------------------------------------ paint */

  function paint() {
    const p = run.puzzle;

    swap(progress,
      h("div.spread",
        h("b", {}, p.rank.name),
        h("span.mono.small.muted", {}, `${p.score} / ${p.maxScore}`)),
      h("div.rank-track",
        h("div.rank-fill", { style: { width: `${Math.min(100, p.rank.share * 100)}%` } })),
      h("div.spread.tiny.muted",
        h("span", {}, `${p.found.length} of ${p.total} words`),
        p.rank.next ? h("span", {}, `${p.rank.next.at - p.score} to ${p.rank.next.name}`) : h("span", {}, "Everything found")));

    /* Letters not in the hive are shown in red rather than silently dropped,
     * so a typo is visible before Enter. */
    const allowed = new Set([p.centre, ...p.outer]);
    swap(entry,
      typed
        ? [...typed].map((c) => h("span", { class: allowed.has(c) ? "" : "off" }, c))
        : h("span.muted", { style: { fontWeight: "400", fontSize: "1rem", letterSpacing: "0" } }, "Type a word"),
      h("span.caret", {}, "|"));

    const key = (letter, centre) => h("button", {
      class: centre ? "centre" : "",
      onClick: () => push(letter),
      "aria-label": centre ? `${letter}, the compulsory letter` : letter,
      tabIndex: -1,
    }, letter);

    swap(hive,
      h("div.hive-row", key(outer[0]), key(outer[1])),
      h("div.hive-row", key(outer[2]), key(p.centre, true), key(outer[3])),
      h("div.hive-row", key(outer[4]), key(outer[5])));

    const words = p.found.slice().sort();
    swap(found,
      h("span.label", {}, p.found.length ? `Found ${p.found.length}` : "Nothing found yet"),
      words.length
        ? h("div.found-list", words.map((word) =>
            h("span", { class: isPangram(word) ? "pangram" : "" }, word)))
        : h("p.small.muted", { style: { margin: 0 } },
            `Four letters or more, and every word needs ${p.centre.toUpperCase()}.`),
      (p.hints || []).length
        ? h("div.stack", { style: { gap: "4px" } },
            h("span.label", {}, "Hints"),
            (p.hints || []).map((hint) =>
              h("span.small.muted", {},
                `${hint.start.toUpperCase()}…  ${hint.length} letters${hint.pangram ? " · pangram" : ""}`)))
        : null);
  }

  /* ------------------------------------------------------------ input */

  function push(letter) {
    if (run.puzzle.status !== "playing") return;
    typed += letter;
    paint();
  }

  function shuffle() {
    for (let i = outer.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outer[i], outer[j]] = [outer[j], outer[i]];
    }
    paint();
  }

  function listen() {
    const onKey = (event) => {
      if (!el.isConnected) return document.removeEventListener("keydown", onKey);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest("input, textarea")) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (typed.length) ctx.actions.guess(typed);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        typed = typed.slice(0, -1);
        paint();
      } else if (event.key === " ") {
        event.preventDefault();
        shuffle();
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        push(event.key.toLowerCase());
      }
    };
    document.addEventListener("keydown", onKey);
  }
}
