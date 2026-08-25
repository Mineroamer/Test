/*
 * Your record.
 *
 * Daily and unlimited are kept apart everywhere, because they measure
 * different things: a daily streak means turning up, an unlimited tally just
 * means playing a lot. Mixing them would flatter one and insult the other.
 */

import { api } from "../api.js";
import { state, refreshSession, go } from "../app.js";
import { h, swap, icon, sheet, plural, duration, percent, ago } from "../ui.js";

export async function render() {
  const data = await api.stats();

  return h("div.stack-lg",
    h("div.spread",
      h("h1", {}, "Your record"),
      h("button.small", { onClick: account }, "Account")),

    totalsCard(data.totals),
    ...state.catalogue.map((game) => gameCard(game, data.games)).filter(Boolean),
    emptyIf(data),
    recentCard(data.recent));
}

function totalsCard(totals) {
  return h("section.card",
    h("div.stat-grid",
      stat(totals.played, "played"),
      stat(totals.won, "solved"),
      stat(totals.currentStreak, "streak"),
      stat(totals.bestStreak, "best streak"),
      stat(totals.hints, "hints used")));
}

const stat = (value, label) => h("div.stat", h("b", {}, value), h("span.label", {}, label));

function gameCard(game, all) {
  const daily = all[`${game.key}:daily`];
  const free = all[`${game.key}:unlimited`];
  const custom = all[`${game.key}:custom`];
  /* Travle keeps a separate record per daily level, so it has several. */
  const levels = Object.entries(all)
    .filter(([key, bucket]) => bucket.game === game.key && bucket.variant)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!daily && !free && !custom && !levels.length) return null;

  return h("section.card.stack", {
    style: { "--game": `var(--game-${game.key})`, "--game-wash": `color-mix(in srgb, var(--game-${game.key}) 16%, var(--surface))` },
  },
    h("div.row",
      h("div.glyph", { style: { width: "32px", height: "32px" } }, icon(game.icon, 18)),
      h("h2", {}, game.name)),

    daily ? modeBlock("Daily", daily, true) : null,
    ...levels.map(([, bucket]) =>
      modeBlock(`Daily · ${bucket.variant}`, bucket, true)),
    free ? modeBlock("Unlimited", free, false) : null,
    custom ? modeBlock("Shared puzzles", custom, false) : null);
}

function modeBlock(title, bucket, showStreak) {
  const rows = Object.entries(bucket.distribution)
    .map(([guesses, count]) => ({ guesses: Number(guesses), count }))
    .sort((a, b) => a.guesses - b.guesses);
  const most = rows.reduce((n, row) => Math.max(n, row.count), 0);

  return h("div.stack", { style: { gap: "8px" } },
    h("div.spread",
      h("span.label", {}, title),
      h("span.small.muted", {},
        `${plural(bucket.played, "round")} · ${percent(bucket.winRate)} solved`)),

    h("div.stat-grid",
      showStreak ? stat(bucket.streak, "streak") : null,
      showStreak ? stat(bucket.maxStreak, "best") : null,
      stat(bucket.best === null ? "—" : bucket.best, "fewest"),
      stat(bucket.averageGuesses ? bucket.averageGuesses.toFixed(1) : "—", "average"),
      stat(bucket.averageTimeMs ? duration(bucket.averageTimeMs) : "—", "typical")),

    rows.length
      ? h("div.bars",
          rows.map((row) => h("div.bar-row",
            h("span", {}, row.guesses),
            h("div.bar", {
              class: row.count ? "" : "empty",
              style: { width: `${Math.max(8, (row.count / most) * 100)}%` },
            }, row.count))))
      : null,

    bucket.hints
      ? h("p.tiny.muted", { style: { margin: 0 } }, `${plural(bucket.hints, "hint")} taken across these rounds.`)
      : null);
}

const emptyIf = (data) => Object.keys(data.games).length
  ? null
  : h("div.card.empty",
      h("p", {}, "Nothing here yet."),
      h("a.btn.primary", { href: "#/" }, "Play something"));

function recentCard(recent) {
  if (!recent.length) return null;
  return h("section.card.stack",
    h("h2", {}, "Recent rounds"),
    h("div.stack", { style: { gap: "6px" } },
      recent.slice(0, 12).map((entry) => h("div.spread",
        h("span.small", {},
          entry.won ? "✓ " : "· ",
          gameName(entry.game),
          h("span.muted", {}, ` ${entry.mode}`)),
        h("span.tiny.muted", {},
          `${plural(entry.guesses, "guess", "guesses")}${entry.hints ? `, ${entry.hints} hint` : ""} · ${ago(entry.at)}`)))));
}

const gameName = (key) => {
  const found = state.catalogue.find((game) => game.key === key);
  return found ? found.name : key;
};

/* ------------------------------------------------------------- account */

function account() {
  sheet("Account", (body, close) => {
    const name = h("input", { value: state.user.display, maxLength: 30 });
    const note = h("p.small.muted", { style: { margin: 0 } }, `Signed in as @${state.user.handle}.`);

    body.append(
      h("label.field", h("span", {}, "Display name"), name),
      note,
      h("button.primary", {
        onClick: async () => {
          try {
            await api.rename(name.value.trim());
            await refreshSession();
            note.textContent = "Saved.";
            note.style.color = "var(--ok)";
          } catch (err) {
            note.textContent = err.message;
            note.style.color = "var(--off)";
          }
        },
      }, "Save"),
      h("hr", { style: { border: "none", borderTop: "1px solid var(--rule)", margin: "4px 0" } }),
      h("button", {
        onClick: async () => {
          await api.logout();
          await refreshSession();
          close();
          go("#/");
        },
      }, "Sign out"));
  });
}
