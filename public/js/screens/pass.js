/*
 * The club pass: your character, your level, and the fifty tiers ahead.
 *
 * Two halves. The top is the wardrobe - the character as it looks now, and
 * every slot you can change. The bottom is the track, drawn as a strip you
 * scroll along, with the tiers you have passed filled in and the ones ahead
 * greyed but never hidden. Seeing what is coming is most of the point.
 */

import { api } from "../api.js";
import { state, refreshSession } from "../app.js";
import { h, swap, sheet, toast } from "../ui.js";
import { characterSvg } from "../character.js";

export async function render() {
  const { pass, rules } = await api.pass();

  const el = h("div.stack-lg");
  const portrait = h("div.pass-portrait");
  const wardrobe = h("div.stack", { style: { gap: "10px" } });
  const bar = h("div.stack", { style: { gap: "8px" } });
  const strip = h("div.tier-strip");
  const notice = h("div");

  /* The character being edited. Changes paint straight away and are sent up
   * afterwards, so trying hats feels instant rather than like a form. */
  let worn = { ...pass.character };
  let level = pass.level;
  /* Declared up here, not beside commit(): everything below the `return` is
   * only reached later, and a `let` down there is never initialised at all. */
  let sending = null;

  el.append(
    h("div.spread",
      h("h1", {}, "Your pass"),
      h("button.small", { onClick: () => explain(rules) }, "How XP works")),
    notice,
    h("section.card.stack",
      h("div.pass-head", portrait, bar),
      wardrobe),
    h("section.card.stack",
      h("div.spread", h("h2", {}, "The track"), h("span.muted.small", {}, `${pass.level} of ${rules.levels}`)),
      strip));

  paintAll();
  showLevelUp();
  return el;

  /* ------------------------------------------------------------ painting */

  function paintAll() {
    swap(portrait, characterSvg(worn, 132));
    paintBar();
    paintWardrobe();
    paintTrack();
  }

  function paintBar() {
    const title = rules.slots && worn.title
      ? (pass.unlocked.find((i) => i.slot === "title" && i.id === worn.title) || {}).name
      : null;

    swap(bar,
      h("div.level-line",
        h("b.level-badge", {}, String(level)),
        h("div.stack", { style: { gap: "2px" } },
          h("strong", {}, title || "Newcomer"),
          h("span.muted.small", {},
            pass.maxed
              ? `${pass.xp.toLocaleString()} XP · the whole track is yours`
              : `${pass.into.toLocaleString()} / ${pass.span.toLocaleString()} XP to level ${level + 1}`))),
      h("div.xp-bar", { role: "progressbar", "aria-valuenow": Math.round(pass.share * 100), "aria-valuemin": 0, "aria-valuemax": 100 },
        h("div.xp-fill", { style: { width: `${Math.round(pass.share * 100)}%` } })),
      h("span.muted.small", {}, `${pass.xp.toLocaleString()} XP in total`));
  }

  function paintWardrobe() {
    swap(wardrobe,
      ...rules.slots.map((slot) => slotRow(slot)),
      h("div.stack", { style: { gap: "6px" } },
        h("span.label", {}, "Skin"),
        h("div.swatch-row", ...rules.skins.map((tone) =>
          h("button.swatch", {
            style: { background: tone },
            "aria-label": "Skin tone",
            "aria-pressed": String(worn.skin === tone),
            class: worn.skin === tone ? "on" : "",
            onClick: () => { worn.skin = tone; commit(); },
          })))),
      h("div.stack", { style: { gap: "6px" } },
        h("span.label", {}, "Colour"),
        h("input.hue", {
          type: "range", min: "0", max: "359", value: String(worn.hue),
          "aria-label": "Accent colour",
          onInput: (e) => { worn.hue = Number(e.target.value); swap(portrait, characterSvg(worn, 132)); },
          onChange: commit,
        })));
  }

  function slotRow(slot) {
    const mine = pass.unlocked.filter((item) => item.slot === slot.key);
    const locked = pass.track
      .filter((tier) => !tier.reached)
      .flatMap((tier) => tier.rewards)
      .filter((item) => item.slot === slot.key);

    return h("div.stack", { style: { gap: "6px" } },
      h("div.spread",
        h("span.label", {}, slot.name),
        locked.length ? h("span.muted.small", {}, `${locked.length} still locked`) : null),
      h("div.chip-row",
        ...mine.map((item) =>
          h("button.wear", {
            class: [worn[slot.key] === item.id ? "on" : "", item.earn ? "won" : ""].filter(Boolean).join(" "),
            "data-rarity": item.rarity,
            "aria-pressed": String(worn[slot.key] === item.id),
            /* Earned rather than reached. Worth saying which is which - the
             * whole point of the earned ones is that no amount of playing
             * hands them over. */
            title: item.earn ? "Earned by an achievement" : `From tier ${item.level}`,
            onClick: () => { worn[slot.key] = item.id; commit(); },
          }, item.earn ? [h("span.won-star", {}, "★"), item.name] : item.name)),
        /* The next one along, shown but not wearable. A track you cannot see
         * ahead of you is just a number going up. */
        ...locked.slice(0, 1).map((item) =>
          h("span.wear.locked", { "data-rarity": item.rarity }, `${item.name} · level ${item.level}`))));
  }

  function paintTrack() {
    swap(strip, ...pass.track.map(tierCard));
    /* Open on the tier you are working towards rather than at tier 1, which
     * you passed long ago. */
    requestAnimationFrame(() => {
      const next = strip.children[Math.max(0, pass.level - 2)];
      if (next) strip.scrollLeft = next.offsetLeft - strip.offsetLeft;
    });
  }

  function tierCard(tier) {
    /*
     * Tier 1 is the starter set, not seven separate prizes. It gets one
     * character wearing all of it, which is what it actually is; every other
     * tier hands over one thing, and the last hands over two.
     */
    const starter = tier.level === 1;

    return h("div.tier", {
      class: tier.reached ? "reached" : "",
      "data-milestone": String(tier.rewards.some((r) => r.rarity === "legendary")),
    },
      h("span.tier-no", {}, String(tier.level)),
      h("div.tier-art", starter
        ? [characterSvg(startLook(), 56, { flat: true })]
        : tier.rewards.map((item) => previewOf(item, tier.reached))),
      h("span.tier-name", {}, starter ? "Starter set" : tier.rewards.map((r) => r.name).join(" · ")),
      h("span.tier-xp", {}, tier.at ? `${tier.at.toLocaleString()} XP` : "from the start"));
  }

  /* The level 1 pieces on one character. */
  function startLook() {
    const look = { skin: worn.skin, hue: worn.hue };
    for (const slot of rules.slots) {
      const first = pass.unlocked.find((item) => item.slot === slot.key && item.level === 1);
      if (first) look[slot.key] = first.id;
    }
    return look;
  }

  /* A tier's reward, shown on a character so it reads as a thing to wear
   * rather than a word. Titles have nothing to draw, so they get their name. */
  function previewOf(item, reached) {
    if (item.slot === "title") {
      return h("div.tier-title", { "data-rarity": item.rarity }, reached ? item.name : "Title");
    }
    const dressed = { ...worn, [item.slot]: item.id };
    /* Only the piece being shown, over the plain starter, so a busy backdrop
     * you happen to be wearing does not drown out the hat on offer. */
    if (item.slot !== "backdrop") dressed.backdrop = "plain";
    if (item.slot !== "frame") dressed.frame = "none";
    return characterSvg(dressed, 56, { flat: item.slot !== "backdrop" && item.slot !== "frame" });
  }

  /* ------------------------------------------------------------ changing */

  function commit() {
    paintAll();
    /* One request at a time: clicking through five hats should not queue five
     * writes that might land out of order. */
    if (sending) { sending = "again"; return; }
    sending = "now";
    (async function send() {
      try {
        const res = await api.equip(worn);
        worn = { ...res.character };
        Object.assign(pass, res.pass);
        level = res.pass.level;
      } catch (err) {
        toast(notice, err.message || "That did not save.");
      }
      const more = sending === "again";
      sending = null;
      if (more) commit();
    })();
  }

  /* --------------------------------------------------------- levelling up */

  /* A level earned while the tab was shut still gets its moment. */
  function showLevelUp() {
    if (!pass.pending || pass.pending >= pass.level) return;
    const gained = [];
    for (let l = pass.pending + 1; l <= pass.level; l += 1) {
      const tier = pass.track.find((t) => t.level === l);
      if (tier) gained.push(...tier.rewards);
    }
    api.passSeen().catch(() => { /* the card showing is what mattered */ });
    if (gained.length) levelUpSheet(pass.level, gained);
  }
}

/** The card that says you went up, and what came with it. */
export function levelUpSheet(level, rewards) {
  sheet("Level up", (body, close) => {
    body.append(h("div.stack.centre.levelup",
      h("div.level-burst", h("b", {}, String(level))),
      h("h2", {}, `Level ${level}`),
      h("p.muted", {}, rewards.length
        ? "Unlocked, and waiting in your wardrobe:"
        : "Nothing new to wear this time - the next tier is close."),
      h("div.reward-row", ...rewards.map((item) =>
        h("div.reward", { "data-rarity": item.rarity },
          h("div.reward-art", characterSvg(rewardLook(item), 64, { flat: item.slot !== "backdrop" })),
          h("strong", {}, item.name),
          h("span.label", {}, item.rarity)))),
      h("a.btn.primary", { href: "#/pass", onClick: close }, "Open the pass")));
  });
}

/* Show a reward on an otherwise plain character. */
function rewardLook(item) {
  const base = {
    outfit: "tee", head: "bare", face: "grin", held: "empty",
    backdrop: "plain", frame: "none", title: "newcomer",
    skin: "#e8b895", hue: 205,
  };
  if (item.slot !== "title") base[item.slot] = item.id;
  return base;
}

/* -------------------------------------------------------------- the rules */

/*
 * The formula, written out. It is not a secret and it is not a mystery box:
 * a person who can see that a Wordle in two is worth 87 and one in five is
 * worth 48 can decide for themselves whether to hurry.
 */
function explain(rules) {
  const games = Object.entries(rules.base).sort((a, b) => b[1] - a[1]);

  sheet("How XP works", (body) => {
    body.append(h("div.stack",
    h("p", {}, "XP is for solving well, not for solving often. Every finished round is worth its game's value, scaled by how the round actually went."),

    h("h3", {}, "What each game is worth"),
    h("p.muted.small", {}, "A flawless daily. Anything less scales down from here, never below about a third."),
    h("div.rule-grid", ...games.map(([game, value]) =>
      h("div.rule", h("b", {}, String(value)), h("span.label", {}, game)))),

    h("h3", {}, "What counts as well played"),
    h("ul.plain",
      h("li", {}, "Wordle · guesses used. Six still counts, one is worth nearly three times as much."),
      h("li", {}, "Connections · mistakes made. Four ends the round, so three is as rough as a win gets."),
      h("li", {}, "Spelling Bee · how much of the hive you found."),
      h("li", {}, "Letter Boxed · words used. Every box ships solvable in two."),
      h("li", {}, "The Crossword and the Mini · help taken first, then the clock."),
      h("li", {}, "Strands and Pips · hints used."),
      h("li", {}, "Travle · guesses spent past the shortest route, against the slack your level allows."),
      h("li", {}, "Hints and reveals cost something in every game. A puzzle you were told the answer to is not a puzzle you solved.")),

    h("h3", {}, "Daily, unlimited and shared"),
    h("p", {},
      `A daily is worth full marks and can only be played once. Unlimited is worth ${Math.round(rules.modeWeight.unlimited * 100)}% `
      + `and the rate falls after ${rules.freeRounds} rounds of the same game in a day. A shared puzzle is worth `
      + `${Math.round(rules.modeWeight.custom * 100)}%, because its difficulty is whatever its author felt like.`),
    h("p.muted.small", {}, "That is deliberate. A board that paid by the hour would rank whoever had the most free time, which is not the same thing as playing well."),

    h("h3", {}, "Losing"),
    h("p", {}, `A round you did not solve is worth ${Math.round(rules.lossShare * 100)}% of its game's value. Turning up counts for something.`),

    h("h3", {}, "The track"),
    h("p", {}, `Fifty levels, one reward each, ${rules.thresholds[rules.levels].toLocaleString()} XP from end to end. `
      + "Everything on it is cosmetic - a hat has never solved a puzzle. Nothing here is bought and nothing expires."),
      h("p.muted.small", {}, "Skin tone and colour are free from the start, and always will be.")));
  });
}
