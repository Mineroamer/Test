"use strict";
/*
 * The club pass: fifty tiers of things to put on your character.
 *
 * This is shaped like an old battle pass on purpose. One reward per level, no
 * branches and no currency, the big ones at round numbers, and the whole track
 * visible from the start so you can see what you are walking towards. What it
 * deliberately does not have is the part that made those passes a business:
 * nothing here is bought, nothing expires, and no tier is locked behind
 * anything but playing.
 *
 * Everything is cosmetic. None of it makes a puzzle easier, gives a hint, or
 * moves you up the leaderboard. It is a hat.
 *
 * Two things stay free and unlocked for everyone, and it is worth saying why:
 * skin tone and accent colour. Those are how a person looks, not a reward for
 * grinding, and putting them behind level 30 would be a nasty thing to do.
 */

const RARITY = {
  common: { name: "Common", order: 0 },
  rare: { name: "Rare", order: 1 },
  epic: { name: "Epic", order: 2 },
  legendary: { name: "Legendary", order: 3 },
};

/* The slots a character has, in the order the wardrobe lists them. */
const SLOTS = [
  { key: "outfit", name: "Outfit" },
  { key: "head", name: "Head" },
  { key: "face", name: "Face" },
  { key: "held", name: "In hand" },
  { key: "backdrop", name: "Backdrop" },
  { key: "frame", name: "Frame" },
  { key: "title", name: "Title" },
];

/*
 * Every item. `level` is the tier it unlocks at; level 1 is the starter set,
 * which everyone has from their first round.
 *
 * Levels 2 to 50 each unlock exactly one thing, except the last, which gives
 * the robes and the title together - a pass should finish with a flourish.
 * A test holds that rule, so adding an item means moving one rather than
 * quietly doubling up a tier.
 */
const ITEMS = [
  /* ------------------------------------------------------------- outfits */
  { id: "tee", slot: "outfit", name: "Club Tee", rarity: "common", level: 1 },
  { id: "stripes", slot: "outfit", name: "Striped Jumper", rarity: "common", level: 4 },
  { id: "cardigan", slot: "outfit", name: "Crossword Cardigan", rarity: "rare", level: 9 },
  { id: "apiarist", slot: "outfit", name: "Beekeeper's Whites", rarity: "epic", level: 14 },
  { id: "coat", slot: "outfit", name: "Cartographer's Coat", rarity: "epic", level: 23 },
  { id: "dominos", slot: "outfit", name: "Domino Suit", rarity: "epic", level: 31 },
  { id: "spangram", slot: "outfit", name: "Spangram Jacket", rarity: "legendary", level: 40 },
  { id: "robes", slot: "outfit", name: "Grandmaster Robes", rarity: "legendary", level: 50 },

  /* ---------------------------------------------------------------- head */
  { id: "bare", slot: "head", name: "Bare Head", rarity: "common", level: 1 },
  { id: "pencil", slot: "head", name: "Pencil Behind the Ear", rarity: "common", level: 2 },
  { id: "beanie", slot: "head", name: "Beanie", rarity: "common", level: 6 },
  { id: "cap", slot: "head", name: "Backwards Cap", rarity: "rare", level: 11 },
  { id: "veil", slot: "head", name: "Bee Veil", rarity: "rare", level: 17 },
  { id: "explorer", slot: "head", name: "Explorer's Hat", rarity: "epic", level: 25 },
  { id: "headlamp", slot: "head", name: "Headlamp", rarity: "epic", level: 33 },
  { id: "laurel", slot: "head", name: "Laurel", rarity: "epic", level: 42 },
  { id: "crown", slot: "head", name: "Crown of Vowels", rarity: "legendary", level: 48 },

  /* ---------------------------------------------------------------- face */
  { id: "focused", slot: "face", name: "Focused", rarity: "common", level: 1 },
  { id: "grin", slot: "face", name: "Grinning", rarity: "common", level: 3 },
  { id: "squint", slot: "face", name: "Squinting", rarity: "common", level: 7 },
  { id: "wink", slot: "face", name: "Winking", rarity: "rare", level: 13 },
  { id: "starry", slot: "face", name: "Starry Eyed", rarity: "rare", level: 20 },
  { id: "monocle", slot: "face", name: "Monocle", rarity: "epic", level: 28 },
  { id: "shades", slot: "face", name: "Shades", rarity: "epic", level: 37 },
  { id: "visor", slot: "face", name: "Solver's Visor", rarity: "legendary", level: 46 },

  /* ------------------------------------------------------------- in hand */
  { id: "empty", slot: "held", name: "Empty Handed", rarity: "common", level: 1 },
  { id: "pencil", slot: "held", name: "No. 2 Pencil", rarity: "common", level: 5 },
  { id: "mug", slot: "held", name: "Cold Coffee", rarity: "common", level: 8 },
  { id: "magnifier", slot: "held", name: "Magnifier", rarity: "rare", level: 15 },
  { id: "compass", slot: "held", name: "Brass Compass", rarity: "rare", level: 21 },
  { id: "domino", slot: "held", name: "Lucky Domino", rarity: "epic", level: 30 },
  { id: "honeypot", slot: "held", name: "Honey Pot", rarity: "epic", level: 38 },
  { id: "quill", slot: "held", name: "Golden Pen", rarity: "legendary", level: 47 },

  /* ----------------------------------------------------------- backdrops */
  { id: "plain", slot: "backdrop", name: "Plain", rarity: "common", level: 1 },
  { id: "graph", slot: "backdrop", name: "Graph Paper", rarity: "common", level: 10 },
  { id: "dawn", slot: "backdrop", name: "Dawn", rarity: "rare", level: 16 },
  { id: "honeycomb", slot: "backdrop", name: "Honeycomb", rarity: "rare", level: 22 },
  { id: "grid", slot: "backdrop", name: "Grid Glow", rarity: "epic", level: 27 },
  { id: "atlas", slot: "backdrop", name: "Atlas", rarity: "epic", level: 35 },
  { id: "falling", slot: "backdrop", name: "Falling Pips", rarity: "epic", level: 43 },
  { id: "aurora", slot: "backdrop", name: "Aurora", rarity: "legendary", level: 49 },

  /* -------------------------------------------------------------- frames */
  { id: "none", slot: "frame", name: "No Frame", rarity: "common", level: 1 },
  { id: "thin", slot: "frame", name: "Thin Ring", rarity: "common", level: 12 },
  { id: "rope", slot: "frame", name: "Rope", rarity: "rare", level: 19 },
  { id: "bronze", slot: "frame", name: "Bronze", rarity: "rare", level: 26 },
  { id: "gold", slot: "frame", name: "Gold", rarity: "epic", level: 34 },
  { id: "neon", slot: "frame", name: "Neon", rarity: "epic", level: 41 },
  { id: "wreath", slot: "frame", name: "Laurel Wreath", rarity: "legendary", level: 45 },

  /* -------------------------------------------------------------- titles */
  { id: "newcomer", slot: "title", name: "Newcomer", rarity: "common", level: 1 },
  { id: "regular", slot: "title", name: "Regular", rarity: "common", level: 18 },
  { id: "wordsmith", slot: "title", name: "Wordsmith", rarity: "common", level: 24 },
  { id: "beekeeper", slot: "title", name: "Bee Keeper", rarity: "rare", level: 29 },
  { id: "navigator", slot: "title", name: "Navigator", rarity: "rare", level: 32 },
  { id: "cruciverbalist", slot: "title", name: "Cruciverbalist", rarity: "epic", level: 36 },
  { id: "tilesetter", slot: "title", name: "Tile Setter", rarity: "epic", level: 39 },
  { id: "pathfinder", slot: "title", name: "Pathfinder", rarity: "epic", level: 44 },
  { id: "legend", slot: "title", name: "Club Legend", rarity: "legendary", level: 50 },
];

/*
 * An item is addressed by slot and id together, because the good names come
 * up twice - there is a pencil you wear and a pencil you hold, and they are
 * not the same pencil.
 */
const keyOf = (slot, id) => `${slot}:${id}`;

const BY_KEY = new Map(ITEMS.map((item) => [keyOf(item.slot, item.id), item]));

const find = (slot, id) => BY_KEY.get(keyOf(slot, id)) || null;

/* Skin tones and accent colours are chosen, never earned. */
const SKINS = ["#f4d3b4", "#e8b895", "#c98d63", "#9c6340", "#6f4429", "#492e1c"];

/** The character everyone starts with: the level 1 item in each slot. */
function starter(hue) {
  const out = { skin: SKINS[0], hue: typeof hue === "number" ? hue : 200 };
  for (const { key } of SLOTS) {
    const first = ITEMS.find((item) => item.slot === key && item.level === 1);
    out[key] = first ? first.id : null;
  }
  return out;
}

/** Everything unlocked at or below a level, newest tier first. */
const unlockedAt = (level) =>
  ITEMS.filter((item) => item.level <= level).sort((a, b) => b.level - a.level);

/** What a given tier hands over. */
const rewardsAt = (level) => ITEMS.filter((item) => item.level === level);

/**
 * The whole track, tier by tier, for the pass screen. Each tier says what it
 * gives, whether it has been reached, and how much XP it sits at, so the
 * screen can draw the whole thing without knowing any of the rules.
 */
function track(xpModule, level) {
  const out = [];
  for (let tier = 1; tier <= xpModule.LEVELS; tier += 1) {
    out.push({
      level: tier,
      at: xpModule.THRESHOLDS[tier],
      reached: tier <= level,
      rewards: rewardsAt(tier).map((item) => ({ ...item })),
    });
  }
  return out;
}

/**
 * Take a wanted character and return one that is actually allowed: every slot
 * filled with something real that this level has unlocked, and anything else
 * quietly replaced with the starter piece rather than rejected.
 *
 * Quiet is the right call here. This runs on a request from a browser, and the
 * worst realistic cause of a bad slot is an old tab with a stale wardrobe -
 * not an attack worth an error message. Nothing is at stake either way: the
 * failure mode is a hat you did not pick.
 */
function sanitise(wanted, level, fallbackHue) {
  const base = starter(fallbackHue);
  const clean = { ...base };
  const from = wanted && typeof wanted === "object" ? wanted : {};

  for (const { key } of SLOTS) {
    const item = find(key, from[key]);
    if (item && item.level <= level) clean[key] = item.id;
  }

  if (SKINS.includes(from.skin)) clean.skin = from.skin;
  const hue = Number(from.hue);
  if (Number.isFinite(hue)) clean.hue = ((Math.round(hue) % 360) + 360) % 360;

  return clean;
}

/** The item records for a character, so a screen can show names and rarities. */
function describe(character) {
  const out = {};
  for (const { key } of SLOTS) out[key] = find(key, character && character[key]);
  return out;
}

module.exports = {
  RARITY, SLOTS, ITEMS, SKINS,
  keyOf, find, starter, unlockedAt, rewardsAt, track, sanitise, describe,
};
