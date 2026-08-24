/*
 * Packs the whole club into one HTML file that needs no server.
 *
 * Run with `npm run build:page`. The output is a static page: the same game
 * engines, the same screens, the same stylesheet — with the network layer
 * swapped for public/js/local-api.js, which runs the engines in the browser
 * and keeps a record in localStorage.
 *
 * There is no framework to bundle around, so the packing is done here rather
 * than by a build tool. Two transforms do all the work:
 *
 *   1. The server's game engines are CommonJS and read their word lists off
 *      disk. Their requires are rewritten to read from an inlined `PC.data`.
 *   2. The browser's ES modules are wrapped into a small registry, since a
 *      single file cannot have modules importing each other by path.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), "utf8");

/* Trimmed so the page stays quick to open; still thousands of nights of Bee. */
const BEE_SETS_KEPT = 6000;

/* ------------------------------------------------------------------ data */

function buildData() {
  const beeAll = JSON.parse(read("data", "bee-puzzles.json"));
  /* Take an even spread rather than the first N, so the letter sets keep
   * their variety instead of all starting with A. */
  const stride = Math.max(1, Math.floor(beeAll.length / BEE_SETS_KEPT));
  const bee = beeAll.filter((_, i) => i % stride === 0).slice(0, BEE_SETS_KEPT);

  const groups = read("data", "connections-groups.js")
    .replace(/^[\s\S]*?module\.exports\s*=\s*/, "")
    .replace(/;\s*$/, "");

  return `window.PC = window.PC || {};
PC.data = {
  wordleAnswers: ${read("data", "wordle-answers.json")},
  wordleAllowed: ${read("data", "wordle-allowed.json")},
  beeWords: ${read("data", "bee-words.json")},
  beePuzzles: ${JSON.stringify(bee)},
  boxedWords: ${read("data", "boxed-words.json")},
  connectionsGroups: ${groups}
};`;
}

/* --------------------------------------------------------------- engines */

/*
 * Turn one of the server's CommonJS game modules into an expression that
 * evaluates to its exports. The requires it uses are known and few, so they
 * are rewritten by name rather than resolved properly.
 */
function commonjsToExpression(source, dataNames) {
  let out = source
    .replace(/^"use strict";\n/, "")
    .replace(/^const path = require\("node:path"\);\n/m, "")
    .replace(/^const \{([^}]*)\} = require\("\.\.\/rng\.js"\);\n/m, "const {$1} = PC.rng;\n")
    .replace(/^const DATA = path\.join\([^)]*\);\n/m, "");

  for (const [requireBit, replacement] of dataNames) {
    out = out.split(requireBit).join(replacement);
  }

  /* The travle adapter pulls in the engine, which is already a global here. */
  out = out.replace(
    /const Engine = require\(path\.join\([^;]*\);/,
    "const Engine = window.Engine;"
  );

  out = out.replace(/module\.exports = /, "return ");
  return `(function () {\n${out}\n})()`;
}

function buildEngines() {
  const dataFor = (file, key) => [
    `require(path.join(DATA, "${file}"))`,
    `PC.data.${key}`,
  ];

  const modules = {
    wordle: commonjsToExpression(read("src", "server", "games", "wordle.js"), [
      dataFor("wordle-answers.json", "wordleAnswers"),
      dataFor("wordle-allowed.json", "wordleAllowed"),
    ]),
    connections: commonjsToExpression(read("src", "server", "games", "connections.js"), [
      ['require(path.join(__dirname, "..", "..", "..", "data", "connections-groups.js"))', "PC.data.connectionsGroups"],
    ]),
    bee: commonjsToExpression(read("src", "server", "games", "spellingbee.js"), [
      dataFor("bee-words.json", "beeWords"),
      dataFor("bee-puzzles.json", "beePuzzles"),
    ]),
    boxed: commonjsToExpression(read("src", "server", "games", "letterboxed.js"), [
      ['require(path.join(__dirname, "..", "..", "..", "data", "boxed-words.json"))', "PC.data.boxedWords"],
    ]),
    travle: commonjsToExpression(read("src", "server", "games", "travle.js"), []),
  };

  const rng = read("src", "server", "rng.js")
    .replace(/^"use strict";\n/, "")
    .replace(/module\.exports = /, "return ");

  /* The catalogue is the one thing the registry holds that is pure content,
   * so it is lifted out of the server's index rather than duplicated. */
  const registry = read("src", "server", "games", "index.js");
  const catalogue = registry.slice(
    registry.indexOf("const CATALOGUE = ["),
    registry.indexOf("];", registry.indexOf("const CATALOGUE = [")) + 2
  ).replace("const CATALOGUE = ", "");

  return `PC.rng = (function () {\n${rng}\n})();
PC.catalogue = ${catalogue};
PC.games = {
${Object.entries(modules).map(([key, body]) => `  ${key}: ${body}`).join(",\n")}
};`;
}

/* --------------------------------------------------------------- modules */

/*
 * Wrap each ES module into `M["key"] = (function () { ... })()`, rewriting its
 * imports to read from the registry and its exports into a returned object.
 * The modules here use plain named imports and exports, which is what makes
 * this a rewrite rather than a parser.
 */
function wrapModule(key, source, resolve) {
  const exported = new Set();
  let body = source;

  /* import { a, b } from "./x.js";  ->  const { a, b } = M["x"]; */
  body = body.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g,
    (_, names, from) => `const {${names}} = M[${JSON.stringify(resolve(from))}];`
  );

  /* Dynamic imports become a resolved reference to an already-built module. */
  body = body.replace(
    /import\(\s*["']([^"']+)["']\s*\)/g,
    (_, from) => `Promise.resolve(M[${JSON.stringify(resolve(from))}])`
  );

  body = body.replace(/export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/g, (_, isAsync, name) => {
    exported.add(name);
    return `${isAsync || ""}function ${name}`;
  });
  body = body.replace(/export\s+(const|let|class)\s+([A-Za-z0-9_$]+)/g, (_, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });
  /* export { a, b }; */
  body = body.replace(/export\s*\{([^}]*)\};?/g, (_, names) => {
    for (const bit of names.split(",")) {
      const name = bit.trim().split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
    return "";
  });

  return `M[${JSON.stringify(key)}] = (function () {
"use strict";
${body}
return { ${[...exported].join(", ")} };
})();`;
}

const KEY_FOR = {
  "./api.js": "api", "../api.js": "api",
  "./ui.js": "ui", "../ui.js": "ui",
  "./share.js": "share", "../share.js": "share",
  "./app.js": "app", "../app.js": "app",
  "./local-api.js": "local-api",
  "./screens/home.js": "screens/home",
  "./screens/auth.js": "screens/auth",
  "./screens/friends.js": "screens/friends",
  "./screens/stats.js": "screens/stats",
  "./screens/create.js": "screens/create",
  "./screens/play.js": "screens/play",
  "../games/wordle.js": "games/wordle",
  "../games/connections.js": "games/connections",
  "../games/bee.js": "games/bee",
  "../games/boxed.js": "games/boxed",
  "../games/travle.js": "games/travle",
};

function resolve(from) {
  const key = KEY_FOR[from];
  if (!key) throw new Error("build: nothing maps the import " + from);
  return key;
}

/* Dependencies first. api and local-api come before app, because app takes
 * its `api` from the registry at definition time. */
const ORDER = [
  ["api", ["public", "js", "api.js"]],
  ["ui", ["public", "js", "ui.js"]],
  ["share", ["public", "js", "share.js"]],
  ["local-api", ["public", "js", "local-api.js"]],
  ["__swap__", null],
  ["app", ["public", "js", "app.js"]],
  ["games/wordle", ["public", "js", "games", "wordle.js"]],
  ["games/connections", ["public", "js", "games", "connections.js"]],
  ["games/bee", ["public", "js", "games", "bee.js"]],
  ["games/boxed", ["public", "js", "games", "boxed.js"]],
  ["games/travle", ["public", "js", "games", "travle.js"]],
  ["screens/home", ["public", "js", "screens", "home.js"]],
  ["screens/auth", ["public", "js", "screens", "auth.js"]],
  ["screens/stats", ["public", "js", "screens", "stats.js"]],
  ["screens/create", ["public", "js", "screens", "create.js"]],
  ["screens/play", ["public", "js", "screens", "play.js"]],
];

function buildApp() {
  const parts = ["const M = {};"];

  for (const [key, file] of ORDER) {
    if (key === "__swap__") {
      parts.push(`/* Everything downstream asks the registry for \`api\`; point it at the
 * local one, so the screens never learn there is no server. */
M["api"] = Object.assign({}, M["api"], { api: M["local-api"].api });`);
      continue;
    }
    parts.push(wrapModule(key, read(...file), resolve));
  }

  /* app.js has no friends screen to reach in this build. */
  parts.push('M["screens/friends"] = { render: () => document.createTextNode("") };');
  return parts.join("\n\n");
}

/* ----------------------------------------------------------------- page */

function build() {
  const shell = read("public", "index.html");

  /* The <title> and the description are the artifact's identity, so they are
   * taken from the real page rather than written twice. */
  const head = shell.slice(shell.indexOf("<title>"), shell.indexOf("</head>"))
    .replace(/<link rel="stylesheet" href="\/css\/[^"]*">\n?/g, "")
    .replace(/<link rel="preconnect"[^>]*>\n?/g, "")
    .trim();

  const body = shell.slice(shell.indexOf("<div id=\"app\">"), shell.indexOf("<!--"))
    .trim();

  const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;

  const styles = `<style>
${read("public", "css", "app.css")}
${read("public", "css", "travle.css")}
</style>`;

  const scripts = `<script>${buildData()}</script>
<script>${read("public", "js", "games", "travle", "countries.js")}</script>
<script>${read("public", "js", "games", "travle", "map-data.js")}</script>
<script>${read("public", "js", "games", "travle", "engine.js")}</script>
<script>${read("public", "js", "games", "travle", "worldmap.js")}</script>
<script>${buildEngines()}</script>
<script type="module">
${buildApp()}
</script>`;

  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });

  /* A whole document, for opening off disk or serving from anywhere. */
  const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fonts}
${head}
${styles}
</head>
<body>

${body}

${scripts}

</body>
</html>
`;

  /*
   * The same page as content only. The Artifact host supplies the doctype,
   * <html>, <head> and <body> itself, so repeating them here would nest one
   * document inside another.
   */
  const forArtifact = `${head}
${fonts}
${styles}

${body}

${scripts}
`;

  write("puzzle-club.html", standalone);
  write("artifact.html", forArtifact);

  function write(name, text) {
    fs.writeFileSync(path.join(ROOT, "dist", name), text);
    console.log(`wrote dist/${name}  (${(text.length / 1048576).toFixed(2)} MB)`);
  }
}

build();
