/*
 * Achievements.
 *
 * Everything is listed, earned or not. A goal you cannot see is not a goal,
 * and a page that only shows what you already have is a trophy cabinet rather
 * than something to aim at - so a locked one says exactly what it wants and
 * exactly what it pays, and the twelve that carry a cosmetic show the piece
 * they are holding.
 *
 * Grouped by game, because that is how people think about them: "what is left
 * in Strands" is a question somebody actually asks.
 */

import { api } from "../api.js";
import { h, icon } from "../ui.js";
import { characterSvg } from "../character.js";

export async function render() {
  const { achievements, games } = await api.achievements();

  const earned = achievements.filter((one) => one.earned);
  const worth = achievements.reduce((n, one) => n + one.xp, 0);
  const banked = earned.reduce((n, one) => n + one.xp, 0);

  const el = h("div.stack-lg",
    h("div.stack", { style: { gap: "4px" } },
      h("h1", {}, "Achievements"),
      h("p.muted", {}, "Every game has its own. Each one pays XP, and thirteen of them carry a piece of kit the pass will never hand you.")),

    h("section.card",
      h("div.stat-grid",
        stat(`${earned.length}/${achievements.length}`, "earned"),
        stat(banked.toLocaleString(), "XP from these"),
        stat((worth - banked).toLocaleString(), "XP still out there"))),

    ...games.map((game) => group(game.key, game.name, game.icon)),
    group(null, "The club", "trophy"));

  return el;

  function group(key, name, glyph) {
    const mine = achievements.filter((one) => one.game === key);
    if (!mine.length) return null;

    const got = mine.filter((one) => one.earned).length;

    return h("section.card.stack", {
      style: key
        ? { "--game": `var(--game-${key})`, "--game-wash": `color-mix(in srgb, var(--game-${key}) 16%, var(--surface))` }
        : {},
    },
      h("div.spread",
        h("div.row",
          h("div.glyph", { style: { width: "32px", height: "32px" } }, icon(glyph, 18)),
          h("h2", {}, name)),
        h("span.muted.small", {}, `${got} of ${mine.length}`)),
      h("div.stack", { style: { gap: "8px" } }, ...mine.map(row)));
  }

  function row(one) {
    return h("div.badge-row", {
      class: one.earned ? "earned" : "",
      "data-rarity": one.rarity,
    },
      h("div.badge-mark", one.cosmetic
        ? characterSvg(look(one), 46, { flat: one.cosmetic.slot !== "backdrop" })
        : h("span.badge-tick", {}, one.earned ? "✓" : "")),
      h("div.stack", { style: { gap: "2px", minWidth: 0 } },
        h("strong", {}, one.name),
        h("span.muted.small", {}, one.blurb),
        one.cosmetic
          ? h("span.tiny", { class: "badge-prize" },
              one.earned ? "Unlocked: " : "Unlocks: ", one.cosmetic.name)
          : null),
      h("div.badge-xp",
        h("b", {}, `+${one.xp}`),
        h("span.label", {}, one.earned ? "banked" : "XP")));
  }

  /* The piece an achievement carries, worn by an otherwise plain character. */
  function look(one) {
    const base = {
      outfit: "tee", head: "bare", face: "focused", held: "empty",
      backdrop: "plain", frame: "none", title: "newcomer",
      skin: "#e8b895", hue: 205,
    };
    if (one.cosmetic.slot !== "title") base[one.cosmetic.slot] = one.cosmetic.id;
    return base;
  }
}

const stat = (value, label) => h("div.stat", h("b", {}, String(value)), h("span.label", {}, label));
