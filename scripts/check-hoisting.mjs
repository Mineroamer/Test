/*
 * Catches the one mistake this codebase keeps making.
 *
 * The view modules are written as a factory that sets everything up, calls
 * paint() once, returns its interface, and then declares its helpers below.
 * Function declarations hoist, so `function paint()` can be called before its
 * line. An arrow assigned to a const cannot: it sits in the temporal dead zone
 * until its line runs, and calling it earlier throws "Cannot access 'paint'
 * before initialization", taking down the whole screen - at runtime, in a
 * browser, where nothing else would have caught it.
 *
 * It has slipped through twice, so it is checked here.
 *
 * The check follows what setup actually reaches: the calls the factory makes
 * before it returns, then everything those functions call, and so on. If any
 * name in that reachable set is an arrow-const declared below the setup call,
 * it is reported. That transitive step is the point - the two real bugs were
 * both a helper called by paint(), not by the factory directly.
 *
 * It is deliberately conservative. It cannot tell a call that happens during
 * setup from one inside an event handler that setup merely registers, and it
 * reports both. That is the right trade: the fix either way is to write the
 * helper as a function declaration, which costs nothing and removes the
 * question - and a checker that only fired on certainties would need to be a
 * real parser to be worth having.
 *
 * Run with `npm run check`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const strip = (line) => line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
const calls = (text) => [...text.matchAll(/(^|[^\w.$'"`])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[2]);

const problems = [];

for (const file of walk(path.join(ROOT, "public", "js"))) {
  /* The Travle engine and map came from elsewhere and are not written in this
   * style, so they are not held to it. */
  if (file.includes(path.join("games", "travle", ""))) continue;

  const lines = fs.readFileSync(file, "utf8").split("\n");

  /* Helpers declared inside a factory, at one level of indentation. */
  const arrowAt = new Map();   // name -> line it becomes usable
  const bodyOf = new Map();    // name -> [firstLine, lastLine] for a function declaration

  lines.forEach((line, i) => {
    const code = strip(line);

    const arrow = code.match(/^ {2}const\s+([A-Za-z0-9_$]+)\s*=\s*(\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/)
      || code.match(/^ {2}const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s+)?function\b/);
    if (arrow) arrowAt.set(arrow[1], i);

    const declared = code.match(/^ {2}(async\s+)?function\s+([A-Za-z0-9_$]+)/);
    if (declared) {
      /* The body runs to the matching close at the same indentation. */
      let end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^ {2}\}/.test(lines[j])) { end = j; break; }
      }
      bodyOf.set(declared[2], [i, end]);
    }
  });

  if (!arrowAt.size) continue;

  /* What the factory calls before it returns - those run during setup. */
  const setup = [];
  lines.forEach((line, i) => {
    const code = strip(line);
    if (!/^ {2}[A-Za-z_$][\w$]*\s*\(/.test(code)) return;
    for (const name of calls(code)) setup.push({ name, line: i });
  });

  /* Follow those through the functions they reach. */
  for (const entry of setup) {
    const seen = new Set();
    const queue = [entry.name];

    while (queue.length) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);

      if (arrowAt.has(name) && arrowAt.get(name) > entry.line) {
        problems.push(
          `${path.relative(ROOT, file)}:${entry.line + 1}  ${entry.name}() reaches ${name}(), `
          + `which is a const on line ${arrowAt.get(name) + 1} and does not exist yet`
        );
        continue;
      }
      const body = bodyOf.get(name);
      if (!body) continue;
      for (let j = body[0]; j <= body[1]; j++) queue.push(...calls(strip(lines[j])));
    }
  }
}

if (problems.length) {
  console.error("Helpers used before they exist (this throws at runtime):\n");
  for (const problem of [...new Set(problems)]) console.error("  " + problem);
  console.error("\nMake them function declarations, which hoist.");
  process.exit(1);
}
console.log("hoisting: nothing is used before it exists");
