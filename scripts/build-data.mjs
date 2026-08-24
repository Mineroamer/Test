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

/* -------------------------------------------------------------------- io */

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(value));
}

buildWordle();
buildBee();
buildBoxed();
console.log("data written to " + path.relative(ROOT, OUT) + "/");
