/*
 * The front door.
 *
 * Today's five puzzles, each showing whether it has been played; a way into
 * unlimited play; and the two things that make this a club rather than a
 * single-player app - friends, and puzzles people have made.
 */

import { api } from "../api.js";
import { state, go } from "../app.js";
import { h, icon, countdown, sheet, plural } from "../ui.js";

export async function render() {
  /* Signed-in extras are a bonus, not a blocker: if either call fails the
   * games still list. */
  const [puzzles, board] = state.user
    ? await Promise.all([
        api.friendPuzzles().catch(() => ({ puzzles: [] })),
        api.leaderboard().catch(() => ({ rows: [] })),
      ])
    : [{ puzzles: [] }, { rows: [] }];

  const done = state.progress || {};
  const playedToday = Object.keys(done).length;

  return h("div.stack-lg",
    hero(playedToday),
    h("section.stack",
      h("div.spread",
        h("h2", {}, "Today's puzzles"),
        h("span.label", {}, state.dayLabel)),
      h("div.stack", state.catalogue.map((game) => gameTile(game, done[game.key])))),
    unlimitedCard(),
    state.user ? friendPuzzlesCard(puzzles.puzzles) : joinCard(),
    state.user && board.rows.length > 1 ? boardCard(board) : null,
    footer());
}

/* ----------------------------------------------------------------- hero */

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
};

function hero(playedToday) {
  const total = state.catalogue.length;
  const clock = h("b.mono", {}, countdown(state.resetsIn));

  /* Tick the countdown while this screen is on show, and stop when it goes. */
  const timer = setInterval(() => {
    if (!clock.isConnected) return clearInterval(timer);
    state.resetsIn = Math.max(0, state.resetsIn - 1000);
    clock.textContent = countdown(state.resetsIn);
    if (state.resetsIn === 0) location.reload();
  }, 1000);

  return h("section.card.stack",
    h("h1", {}, state.user ? `${greeting()}, ${state.user.display}.` : "Every puzzle. Unlimited. Free."),
    h("p.muted", { style: { margin: 0 } },
      state.user
        ? playedToday === total
          ? "You have finished every puzzle today. There is always unlimited."
          : `${playedToday} of ${total} done today.`
        : "Five puzzles a day, and as many more as you like. No subscription, no counter."),
    h("div.spread", { style: { marginTop: "4px" } },
      h("span.label", {}, "New puzzles in"),
      clock));
}

/* ------------------------------------------------------------ the games */

function gameTile(game, played) {
  return h("a.tile-link", {
    href: `#/play/${game.key}/daily`,
    style: { "--game": `var(--game-${game.key})`, "--game-wash": `color-mix(in srgb, var(--game-${game.key}) 16%, var(--surface))` },
  },
    h("div.glyph", {}, icon(game.icon)),
    h("div", {},
      h("div", { style: { fontWeight: "700" } }, game.name),
      h("div.small.muted", {}, played ? resultLine(played) : game.tagline)),
    played
      ? h("span.pill", { class: played.won ? "win" : "loss" }, played.won ? "Done" : "Missed")
      : h("span.pill.on", {}, "Play"));
}

const resultLine = (played) => {
  const bits = [played.won ? "Solved" : "Not solved"];
  if (played.guesses) bits.push(plural(played.guesses, "guess", "guesses"));
  if (played.hints) bits.push(plural(played.hints, "hint"));
  return bits.join(" · ");
};

/* --------------------------------------------------------- unlimited */

function unlimitedCard() {
  return h("section.card.stack",
    h("div.spread",
      h("h2", {}, "Unlimited"),
      h("span.pill", {}, "No limit")),
    h("p.muted.small", { style: { margin: 0 } },
      "A fresh puzzle every time you ask, in any game. Nothing to unlock and no daily allowance."),
    h("div.row.row-wrap",
      state.catalogue.map((game) =>
        h("a.btn.small", {
          href: `#/play/${game.key}/unlimited`,
          style: { "--game": `var(--game-${game.key})` },
        }, game.name))));
}

/* ---------------------------------------------------- friends' puzzles */

function friendPuzzlesCard(puzzles) {
  return h("section.card.stack",
    h("div.spread",
      h("h2", {}, "Made by friends"),
      h("a.btn.small", { href: "#/create" }, "Build one")),

    puzzles.length
      ? h("div.stack", puzzles.slice(0, 5).map((puzzle) =>
          h("a.tile-link", {
            href: `#/puzzle/${puzzle.code}`,
            style: { "--game": `var(--game-${puzzle.game})`, "--game-wash": `color-mix(in srgb, var(--game-${puzzle.game}) 16%, var(--surface))` },
          },
            h("div.glyph", {}, icon(puzzle.game)),
            h("div", {},
              h("div", { style: { fontWeight: "700" } }, puzzle.title),
              h("div.small.muted", {},
                `${puzzle.gameName} · by ${puzzle.by ? puzzle.by.display : "someone"}`)),
            h("span.pill", {}, plural(puzzle.plays, "play")))))
      : h("div.empty.small", {},
          "Nothing yet. Build a puzzle and send someone the code, or add a friend who makes them."),

    h("div.row",
      h("button.small", { onClick: openCode }, "Enter a code"),
      h("a.btn.small", { href: "#/friends" }, "Friends")));
}

function openCode() {
  sheet("Open a shared puzzle", (body, close) => {
    const input = h("input", {
      placeholder: "ABC123",
      maxLength: 6,
      autocapitalize: "characters",
      spellcheck: false,
      style: { fontFamily: "var(--mono)", letterSpacing: "0.2em", textTransform: "uppercase", textAlign: "center", fontSize: "1.2rem" },
    });
    const note = h("p.small.muted", { style: { margin: 0 } },
      "Six characters, from whoever built the puzzle.");

    const open = () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 6) {
        note.textContent = "A code is six characters long.";
        note.className = "small";
        note.style.color = "var(--off)";
        return;
      }
      close();
      go(`#/puzzle/${code}`);
    };

    input.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    body.append(input, note, h("button.primary", { onClick: open }, "Open"));
  });
}

/* -------------------------------------------------------------- signed out */

const joinCard = () => h("section.card.stack",
  h("h2", {}, "Play together"),
  h("p.muted.small", { style: { margin: 0 } },
    "An account keeps your streaks and stats, lets you add friends, and lets you build puzzles to send them. Everything stays free."),
  h("div.row",
    h("a.btn.primary", { href: "#/signin/up" }, "Create an account"),
    h("a.btn", { href: "#/signin" }, "Sign in")));

/* ------------------------------------------------------- leaderboard */

function boardCard(board) {
  const top = board.rows.slice(0, 5);
  return h("section.card.stack",
    h("div.spread",
      h("h2", {}, "Standings"),
      h("a.btn.small", { href: "#/friends" }, "All")),
    h("div.stack", { style: { gap: "6px" } },
      top.map((row, index) => h("div.person", {
        style: row.user.id === board.you ? { fontWeight: "700" } : null,
      },
        h("span.mono.muted", { style: { textAlign: "center" } }, index + 1),
        h("div", {},
          h("div", {}, row.user.display, row.user.id === board.you ? h("span.muted", {}, " (you)") : null),
          h("div.tiny.muted", {}, `${plural(row.wins, "daily win")} · ${plural(row.todayDone, "played")} today`)),
        h("span.pill", { class: row.streak > 0 ? "on" : "" }, `${row.streak} streak`)))));
}

const footer = () => h("p.tiny.muted.centre", { style: { marginTop: "8px" } },
  "Puzzle Club is a self-hosted set of word games. Not affiliated with The New York Times.");
