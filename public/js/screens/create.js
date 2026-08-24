/*
 * Building a puzzle for someone else.
 *
 * Three of the five games can be built by hand. The Bee and Letter Boxed
 * cannot: their puzzles are only fair because a solver checked them, and a
 * hand-made one would usually be unsolvable without the author noticing.
 *
 * Everything is checked again on the server. What the forms add is saying so
 * early, while there is still something to fix.
 */

import { api } from "../api.js";
import { state, go } from "../app.js";
import { h, swap, icon, sheet, copy, plural } from "../ui.js";

const BUILDABLE = ["wordle", "connections", "travle"];

export async function render(game) {
  if (game && BUILDABLE.includes(game)) return builder(game);

  const mine = await api.myPuzzles().catch(() => ({ puzzles: [] }));

  return h("div.stack-lg",
    h("div.stack",
      h("h1", {}, "Build a puzzle"),
      h("p.muted", { style: { margin: 0 } },
        "Make something and send the code to a friend. They get one attempt, the same as a daily.")),

    h("div.stack",
      state.catalogue.filter((entry) => BUILDABLE.includes(entry.key)).map((entry) =>
        h("a.tile-link", {
          href: `#/create/${entry.key}`,
          style: { "--game": `var(--game-${entry.key})`, "--game-wash": `color-mix(in srgb, var(--game-${entry.key}) 16%, var(--surface))` },
        },
          h("div.glyph", {}, icon(entry.icon)),
          h("div", {},
            h("div", { style: { fontWeight: "700" } }, entry.name),
            h("div.small.muted", {}, buildBlurb(entry.key))),
          h("span.pill.on", {}, "Build")))),

    minePanel(mine.puzzles),

    h("p.tiny.muted", {},
      "Spelling Bee and Letter Boxed are not on the list: their puzzles have to be checked by a solver to be fair, so they are only ever dealt, never written."));
}

const buildBlurb = (key) => ({
  wordle: "Pick any word from four to eight letters. It does not have to be in the dictionary.",
  connections: "Write four groups of four. The trick is making them overlap.",
  travle: "Choose a start and a finish. Anywhere joined by land.",
}[key]);

/* ------------------------------------------------------------ my list */

function minePanel(puzzles) {
  if (!puzzles.length) return null;

  const wrap = h("section.card.stack",
    h("h2", {}, plural(puzzles.length, "puzzle") + " you have made"));

  const rows = h("div.stack");
  const paint = (list) => swap(rows, list.map((puzzle) => h("div.person",
    h("div.glyph", { style: { width: "32px", height: "32px", "--game": `var(--game-${puzzle.game})`, "--game-wash": `color-mix(in srgb, var(--game-${puzzle.game}) 16%, var(--surface))` } },
      icon(puzzle.game, 16)),
    h("div", {},
      h("div", { style: { fontWeight: "600" } }, puzzle.title),
      h("div.tiny.muted", {},
        `${puzzle.gameName} · ${plural(puzzle.plays, "play")}, ${puzzle.solves} solved`)),
    h("div.row",
      h("button.small.mono", {
        onClick: () => shareSheet(puzzle),
        title: "Share this puzzle",
      }, puzzle.code),
      h("button.ghost.small", {
        "aria-label": `Delete ${puzzle.title}`,
        onClick: async () => {
          await api.deletePuzzle(puzzle.code);
          const left = (await api.myPuzzles()).puzzles;
          if (!left.length) wrap.remove(); else paint(left);
        },
      }, "×")))));

  paint(puzzles);
  wrap.append(rows);
  return wrap;
}

/* ----------------------------------------------------------- builders */

function builder(game) {
  const wrap = h("div.game.stack-lg", { dataset: { game } });
  const problem = h("p.small", { style: { color: "var(--off)", minHeight: "1.2em", margin: 0 }, role: "alert" });
  const title = h("input", { placeholder: "give it a name", maxLength: 60 });

  const form = game === "wordle" ? wordleForm()
    : game === "connections" ? connectionsForm()
    : travleForm();

  const save = h("button.primary", {
    onClick: async () => {
      problem.textContent = "";
      const trouble = form.check();
      if (trouble) { problem.textContent = trouble; return; }

      save.disabled = true;
      save.textContent = "Saving...";
      try {
        const answer = await api.createPuzzle({
          game,
          title: title.value.trim(),
          payload: form.payload(),
        });
        made(answer.puzzle);
      } catch (err) {
        problem.textContent = err.message;
        save.disabled = false;
        save.textContent = "Create and get a code";
      }
    },
  }, "Create and get a code");

  swap(wrap,
    h("div.line.row",
      h("a.btn.ghost.small", { href: "#/create" }, "←"),
      h("h1", { style: { fontSize: "1.35rem" } }, `Build a ${gameName(game)}`)),
    h("section.card.stack",
      form.el,
      h("label.field", h("span", {}, "Title"), title,
        h("span.tiny.muted", {}, "Optional. Shown to whoever plays it.")),
      problem,
      save));

  return wrap;
}

const gameName = (key) => (state.catalogue.find((entry) => entry.key === key) || {}).name || key;

/* ------------------------------------------------------------- wordle */

function wordleForm() {
  const answer = h("input", {
    placeholder: "PLUTO",
    maxLength: 8,
    autocapitalize: "characters",
    spellcheck: false,
    style: { textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: "700" },
  });
  const note = h("input", { placeholder: "a nudge, if you want to give one", maxLength: 140 });
  const count = h("span.tiny.muted", {}, "4 to 8 letters");

  answer.addEventListener("input", () => {
    const clean = answer.value.replace(/[^a-zA-Z]/g, "");
    if (clean !== answer.value) answer.value = clean;
    const n = clean.length;
    count.textContent = n === 0 ? "4 to 8 letters"
      : n < 4 ? `${n} letters — too short`
      : n > 8 ? `${n} letters — too long`
      : `${n} letters, so ${n + 1} guesses`;
    count.style.color = n === 0 || (n >= 4 && n <= 8) ? "" : "var(--off)";
  });

  return {
    el: h("div.stack",
      h("label.field", h("span", {}, "The word"), answer, count),
      h("label.field", h("span", {}, "Note"), note,
        h("span.tiny.muted", {}, "Shown before they start. Leave it out for no help at all.")),
      h("p.tiny.muted", { style: { margin: 0 } },
        "Any letters will do — a name, a nickname, a word you made up. It counts as a valid guess even if no dictionary has it.")),
    check: () => {
      const value = answer.value.trim();
      if (value.length < 4 || value.length > 8) return "The word needs to be four to eight letters.";
      return null;
    },
    payload: () => ({ answer: answer.value.trim(), note: note.value.trim() }),
  };
}

/* -------------------------------------------------------- connections */

function connectionsForm() {
  const LEVELS = ["the easy one", "a bit harder", "harder still", "the tricky one"];

  const groups = LEVELS.map((hint, index) => {
    const clue = h("input", { placeholder: "what links them", maxLength: 60 });
    const words = Array.from({ length: 4 }, () => h("input", {
      placeholder: "word",
      maxLength: 20,
      autocapitalize: "characters",
      spellcheck: false,
      style: { textTransform: "uppercase" },
    }));

    return {
      clue,
      words,
      el: h("div.group-editor", { dataset: { level: index } },
        h("div.spread",
          h("span.label", {}, `Group ${index + 1}`),
          h("span.tiny.muted", {}, hint)),
        clue,
        h("div.words", words)),
    };
  });

  const tally = h("p.tiny.muted", { style: { margin: 0 } }, "16 words, each one used once.");

  /* Say straight away when a word has been typed into two groups: it is the
   * mistake that makes a puzzle unsolvable and the easiest one to make. */
  const check = () => {
    const seen = new Map();
    let filled = 0;
    for (const [index, group] of groups.entries()) {
      for (const field of group.words) {
        const word = field.value.trim().toUpperCase();
        field.style.borderColor = "";
        if (!word) continue;
        filled += 1;
        if (seen.has(word)) {
          field.style.borderColor = "var(--off)";
          seen.get(word).style.borderColor = "var(--off)";
          return `"${word}" is in two groups. Every word has to belong to exactly one.`;
        }
        seen.set(word, field);
      }
      if (!group.clue.value.trim()) return `Group ${index + 1} needs a name.`;
    }
    if (filled !== 16) return `${filled} of 16 words filled in.`;
    return null;
  };

  for (const group of groups) {
    for (const field of group.words) {
      field.addEventListener("input", () => {
        const trouble = check();
        tally.textContent = trouble || "Ready.";
        tally.style.color = trouble ? "var(--muted)" : "var(--ok)";
      });
    }
  }

  return {
    el: h("div.stack",
      h("p.small.muted", { style: { margin: 0 } },
        "Four groups of four. The best puzzles have a word that looks like it belongs somewhere it does not."),
      ...groups.map((group) => group.el),
      tally),
    check,
    payload: () => ({
      groups: groups.map((group) => ({
        clue: group.clue.value.trim(),
        words: group.words.map((field) => field.value.trim().toUpperCase()),
      })),
    }),
  };
}

/* ------------------------------------------------------------- travle */

function travleForm() {
  const Engine = window.Engine;

  const make = (label, placeholder) => {
    const input = h("input", { placeholder, autocapitalize: "words", spellcheck: false });
    const list = h("div.suggestions.hide", { role: "listbox" });
    const field = h("div", { style: { position: "relative" } }, input, list);

    input.addEventListener("input", () => {
      const found = input.value.trim().length ? Engine.suggest(input.value.trim(), 6) : [];
      if (!found.length) { list.classList.add("hide"); return; }
      list.classList.remove("hide");
      swap(list, found.map((code) => h("button", {
        type: "button",
        onMouseDown: (event) => {
          event.preventDefault();
          input.value = Engine.nameOf(code);
          list.classList.add("hide");
          input.dispatchEvent(new Event("resolved"));
        },
      }, Engine.nameOf(code))));
    });
    input.addEventListener("blur", () => setTimeout(() => list.classList.add("hide"), 140));

    return { input, el: h("label.field", h("span", {}, label), field) };
  };

  const from = make("Start", "Portugal");
  const to = make("Finish", "Poland");
  const preview = h("p.tiny.muted", { style: { margin: 0 } }, "Any two countries joined by land.");

  const look = () => {
    const a = Engine.resolve(from.input.value.trim());
    const b = Engine.resolve(to.input.value.trim());
    if (!a || !b) { preview.textContent = "Any two countries joined by land."; preview.style.color = ""; return; }

    const legs = Engine.distance(a, b);
    if (!Number.isFinite(legs)) {
      preview.textContent = `No land route joins ${Engine.nameOf(a)} and ${Engine.nameOf(b)}.`;
      preview.style.color = "var(--off)";
    } else if (legs < 2) {
      preview.textContent = `${Engine.nameOf(a)} and ${Engine.nameOf(b)} are neighbours — there would be nothing to work out.`;
      preview.style.color = "var(--off)";
    } else {
      preview.textContent = `${legs} border crossings on the shortest way. A fair walk.`;
      preview.style.color = "var(--ok)";
    }
  };

  for (const field of [from.input, to.input]) {
    field.addEventListener("input", look);
    field.addEventListener("resolved", look);
  }

  return {
    el: h("div.stack", from.el, to.el, preview),
    check: () => {
      const a = Engine.resolve(from.input.value.trim());
      const b = Engine.resolve(to.input.value.trim());
      if (!a) return "I do not know that starting country.";
      if (!b) return "I do not know that destination.";
      if (a === b) return "Start somewhere other than the finish.";
      const legs = Engine.distance(a, b);
      if (!Number.isFinite(legs)) return `No land route joins ${Engine.nameOf(a)} and ${Engine.nameOf(b)}.`;
      if (legs < 2) return "Those two are neighbours — pick a longer walk.";
      return null;
    },
    payload: () => ({ start: from.input.value.trim(), end: to.input.value.trim() }),
  };
}

/* --------------------------------------------------------------- done */

function made(puzzle) {
  const link = `${location.origin}/#/puzzle/${puzzle.code}`;

  sheet("Ready to send", (body) => {
    const status = h("p.small.muted", { style: { margin: 0 } }, "Send them the code or the link — either works.");

    body.append(
      h("div.code-badge", {}, puzzle.code),
      h("p.small.muted", { style: { margin: 0, textAlign: "center" } }, puzzle.title),
      status,
      h("div.row",
        h("button.primary.grow", {
          onClick: async () => {
            const ok = await copy(link);
            status.textContent = ok ? "Link copied." : "Could not copy — the code above still works.";
            status.style.color = ok ? "var(--ok)" : "var(--off)";
          },
        }, "Copy link"),
        h("button.grow", {
          onClick: async () => {
            const ok = await copy(puzzle.code);
            status.textContent = ok ? "Code copied." : "Could not copy.";
            status.style.color = ok ? "var(--ok)" : "var(--off)";
          },
        }, "Copy code")),
      /* Both of these change the hash, which closes the sheet on its own. */
      h("div.row",
        h("a.btn.grow", { href: `#/puzzle/${puzzle.code}` }, "Try it"),
        h("a.btn.ghost.grow", { href: "#/create" }, "Build another")));
  });
}
