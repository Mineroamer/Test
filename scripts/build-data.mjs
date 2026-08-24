/*
 * Regenerates everything in data/ from the word lists in devDependencies.
 *
 * The app itself ships with the output committed and has no runtime
 * dependencies at all; this script only needs to run when the source lists
 * change. Run it with `npm run build:data`.
 *
 * Frequency tiers come from SCOWL by way of `wordlist-english`: tier 10 is
 * the most common English, tier 70 is crossword-setter territory. Which tiers
 * feed which game is the main lever on how fair each game feels.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data");

/* Where the lists live. `npm run build:data` installs them into the repo, but
 * they can also be borrowed from a scratch install via WORDLIST_DIR. */
const MODULES = process.env.WORDLIST_DIR || path.join(ROOT, "node_modules");

const tier = (n) =>
  JSON.parse(fs.readFileSync(path.join(MODULES, "wordlist-english", `english-words-${n}.json`), "utf8"));

const union = (...tiers) => {
  const set = new Set();
  for (const t of tiers) for (const w of tier(t)) set.add(w.toLowerCase());
  return set;
};

const plain = (w) => /^[a-z]+$/.test(w);

/* Words nobody wants to be handed as a daily answer. Kept deliberately short:
 * it covers slurs and the genuinely grim, not mild rudeness. */
const UNWANTED = new Set([
  "bitch", "chink", "coons", "cunts", "dagos", "dyke", "fucks", "gooks", "gypsy",
  "homos", "kikes", "lynch", "mamie", "negro", "nazis", "paki", "pakis", "prick", "queer",
  "rapes", "raped", "rapist", "retard", "semen", "sluts", "spick", "spics", "twats", "wench",
  "whore", "wetback", "wops", "kraut", "hussy", "abort", "bombs", "choke", "corpse", "death",
  "dying", "fetus", "kills", "knife", "morgue", "noose", "opium", "penis", "pussy", "shits",
  "slave", "suicide", "tumor", "vomit", "wound",
].filter((w) => w.length >= 3));

/* ------------------------------------------------------------------ wordle */

/*
 * Answers should be words a person would actually think of. Guesses should be
 * generous, so a reasonable-looking word is never rejected. So: answers come
 * from the three most common tiers, guesses from every list we have.
 */
function buildWordle() {
  const common = union(10, 20, 35);
  const wide = union(10, 20, 35, 40, 50, 55, 60, 70);
  const dictionary = fs
    .readFileSync(path.join(MODULES, "word-list", "words.txt"), "utf8")
    .split("\n")
    .map((w) => w.trim().toLowerCase());

  const five = (set) => [...set].filter((w) => w.length === 5 && plain(w));

  const answerPool = new Set(five(common));

  /* Wordle answers are singular. Drop a word ending in -s when chopping the s
   * leaves another real word, which catches plurals and third-person verbs
   * ("abets", "acres") while keeping words like "gross" and "chess". */
  for (const w of [...answerPool]) {
    if (w.endsWith("s") && (common.has(w.slice(0, 4)) || wide.has(w.slice(0, 4)))) answerPool.delete(w);
  }
  /* Same idea for -ed and -ing forms that read as conjugations rather than words. */
  for (const w of [...answerPool]) {
    if (w.endsWith("ed") && (wide.has(w.slice(0, 3)) || wide.has(w.slice(0, 4)))) answerPool.delete(w);
  }
  for (const w of UNWANTED) answerPool.delete(w);

  const answers = [...answerPool].sort();

  const allowed = new Set(answers);
  for (const w of five(wide)) allowed.add(w);
  for (const w of dictionary) if (w.length === 5 && plain(w)) allowed.add(w);

  write("wordle-answers.json", answers);
  write("wordle-allowed.json", [...allowed].sort());
  console.log(`wordle: ${answers.length} answers, ${allowed.size} accepted guesses`);
}

/* ----------------------------------------------------------- spelling bee */

/*
 * The Bee needs a dictionary that is wide enough to reward exploration but not
 * so wide that the honeycomb fills with words no one has met. Tiers 10-55 land
 * around 55k words, which is close to what the real game accepts.
 */
function buildBee() {
  const words = [...union(10, 20, 35, 40, 50, 55)]
    .filter((w) => w.length >= 4 && plain(w) && new Set(w).size <= 7 && !UNWANTED.has(w))
    .sort();

  /* A pangram uses all seven letters, so its distinct-letter set is exactly the
   * puzzle. Every seven-letter set here is therefore guaranteed solvable. */
  const sets = new Map();
  for (const w of words) {
    const letters = [...new Set(w)].sort().join("");
    if (letters.length !== 7) continue;
    if (!sets.has(letters)) sets.set(letters, 0);
    sets.set(letters, sets.get(letters) + 1);
  }

  /* Score each candidate set by how many words it yields for each choice of
   * centre letter, and keep the sets that make a decent puzzle. */
  const index = new Map();
  for (const w of words) {
    const letters = [...new Set(w)].sort().join("");
    if (!index.has(letters)) index.set(letters, []);
    index.get(letters).push(w);
  }

  /* Stored as seven letters with the centre first, so one 7-character string
   * is the whole puzzle and the file stays small. Word counts are cheap to
   * recompute when a puzzle is actually dealt. */
  const puzzles = [];
  for (const letters of sets.keys()) {
    const pool = [];
    for (const [key, list] of index) {
      if ([...key].every((c) => letters.includes(c))) pool.push(...list);
    }
    for (const centre of letters) {
      const valid = pool.filter((w) => w.includes(centre));
      const pangrams = valid.filter((w) => [...letters].every((c) => w.includes(c)));
      /* Enough to explore, not so many it becomes a slog. */
      if (valid.length < 20 || valid.length > 90 || pangrams.length === 0) continue;
      puzzles.push(centre + [...letters].filter((c) => c !== centre).join(""));
    }
  }

  puzzles.sort();
  write("bee-words.json", words);
  write("bee-puzzles.json", puzzles);
  console.log(`bee: ${words.length} dictionary words, ${puzzles.length} playable letter sets`);
}

/* ----------------------------------------------------------- letter boxed */

/*
 * Letter Boxed wants words of three letters or more, and it wants them common:
 * the puzzle is hard enough without the solver's vocabulary being the obstacle.
 */
function buildBoxed() {
  const words = [...union(10, 20, 35, 40)]
    .filter((w) => w.length >= 3 && plain(w) && new Set(w).size <= 12 && !UNWANTED.has(w))
    .sort();
  write("boxed-words.json", words);
  console.log(`letter boxed: ${words.length} words`);
}

/* ------------------------------------------------------------ crossword */

/*
 * Clues, from WordNet's definitions.
 *
 * A crossword is only as good as its clues, and the honest constraint here is
 * that these are dictionary definitions rather than a setter's wordplay. What
 * that buys is coverage: tens of thousands of clueable answers, so the grid
 * filler has room to work and never has to fall back on "see 14 across".
 *
 * The filler is only ever offered words that have a clue, so a finished grid
 * can always be clued end to end.
 */
function buildCrossword() {
  const dict = path.join(MODULES, "wordnet-db", "dict");

  /* Every synset's definition, keyed by the offset the index files cite. */
  const glossAt = new Map();
  for (const part of ["noun", "verb", "adj", "adv"]) {
    for (const line of fs.readFileSync(path.join(dict, `data.${part}`), "utf8").split("\n")) {
      if (!line || line.startsWith("  ")) continue;
      const split = line.indexOf(" | ");
      if (split === -1) continue;
      glossAt.set(part + line.slice(0, 8), tidyGloss(line.slice(split + 3)));
    }
  }

  /*
   * Which senses a word has, in WordNet's own order. That order is meant to
   * put the most-used sense first, and mostly does - but not always: it offers
   * "a fierce or audacious person" for TIGER ahead of the animal. So rather
   * than trust it outright, we look at the first few senses and take the most
   * identifying of them, which is reliably the one a solver can work back from.
   */
  const SENSES_CONSIDERED = 4;
  const clues = {};

  /*
   * Wider than the other games' vocabulary, deliberately. A crossword is the
   * one place an uncommon word is fair: you are never asked to produce it cold,
   * only to recognise it once the crossings have given you half its letters.
   * The filler also needs the room - short entries especially, which is where
   * a narrow list starves it and grids stop being fillable at all.
   */
  const common = union(10, 20, 35, 40, 50, 55, 60, 70);

  for (const part of ["noun", "verb", "adj", "adv"]) {
    for (const line of fs.readFileSync(path.join(dict, `index.${part}`), "utf8").split("\n")) {
      if (!line || line.startsWith("  ")) continue;

      const fields = line.trim().split(/\s+/);
      const word = fields[0];
      if (!/^[a-z]{3,15}$/.test(word) || UNWANTED.has(word) || !common.has(word)) continue;

      const offsets = fields.filter((f) => /^[0-9]{8}$/.test(f)).slice(0, SENSES_CONSIDERED);
      let pick = clues[word] || null;

      for (const offset of offsets) {
        const gloss = glossAt.get(part + offset);
        if (!gloss || givesItAway(word, gloss)) continue;
        /* Longer says more, and the cap in tidyGloss keeps it readable. */
        if (!pick || gloss.length > pick.length) pick = gloss;
      }
      if (pick) clues[word] = pick;
    }
  }

  write("crossword-clues.json", clues);

  const lengths = {};
  for (const word of Object.keys(clues)) lengths[word.length] = (lengths[word.length] || 0) + 1;
  console.log(`crossword: ${Object.keys(clues).length} clued answers`);
  console.log(`  by length: ${Object.entries(lengths).sort((a, b) => a[0] - b[0]).map(([n, c]) => n + ":" + c).join("  ")}`);
}

/*
 * A clue must not contain its own answer, and "abstraction" is given away by
 * "an abstract painting" just as surely as by the word itself. Comparing on a
 * stem rather than the whole word catches the inflections and derivations that
 * definitions reach for constantly.
 */
function givesItAway(word, gloss) {
  const stem = word.slice(0, Math.max(4, word.length - 3));
  return gloss.toLowerCase().includes(stem);
}

/*
 * WordNet glosses carry usage examples after a semicolon, and those examples
 * often contain the answer. Cutting at the first semicolon leaves the
 * definition proper, which is what a clue wants anyway.
 */
function tidyGloss(raw) {
  let gloss = raw.split(";")[0].trim();
  gloss = gloss.replace(/\s+/g, " ").replace(/^\(.*?\)\s*/, "").trim();
  /* Long enough to identify, short enough to sit in a clue list. Definitions
   * of concrete things - instruments, animals, tools - run long, and cutting
   * at 90 was quietly dropping exactly those in favour of vaguer senses. */
  if (gloss.length < 12 || gloss.length > 120) return null;
  /* A clue that is itself a cross-reference is no use without the reference. */
  if (/^(see|cf|compare|used|of or|relating to the)\b/i.test(gloss)) return null;
  return gloss.charAt(0).toUpperCase() + gloss.slice(1);
}

/* -------------------------------------------------------------------- io */

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value));
}

buildWordle();
buildBee();
buildBoxed();
buildCrossword();
console.log("data written to " + path.relative(ROOT, OUT) + "/");
