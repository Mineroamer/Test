/*
 * Inlines the game into one self-contained file: dist/travle-overland.html.
 *
 *   node tools/bundle.js
 *
 * Only the Google Fonts stylesheet stays remote; everything else - the border
 * data, the map outlines, the engine and the styles - is written into the
 * page, so the file plays offline from a double click.
 *
 * The output deliberately has no <!doctype>, <html> or <body> wrapper: it is
 * the page body, which is what an Artifact publish expects, and browsers add
 * the wrapper themselves when the file is opened directly.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("index.html");

/** Pull one attribute out of a tag. */
function attr(tag, name) {
  const match = tag.match(new RegExp(name + '="([^"]*)"'));
  return match ? match[1] : null;
}

let out = html;

// <link rel="stylesheet" href="src/..."> -> <style>
out = out.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
  const href = attr(tag, "href");
  if (!href || /^https?:/.test(href)) return tag;
  return "<style>\n" + read(href).trim() + "\n</style>";
});

// <script src="..."> -> <script>...</script>
out = out.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (tag, src) => {
  if (/^https?:/.test(src)) return tag;
  return "<script>\n" + read(src).trim() + "\n</script>";
});

// Strip the document wrapper; keep the head contents and the body contents.
const head = (out.match(/<head[^>]*>([\s\S]*?)<\/head>/) || [, ""])[1];
const body = (out.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [, out])[1];

const keep = head
  .split("\n")
  .filter((line) => !/<meta charset|<meta name="viewport"/.test(line))
  .join("\n")
  .trim();

const bundle = keep + "\n" + body.trim() + "\n";

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const target = path.join(root, "dist", "travle-overland.html");
fs.writeFileSync(target, bundle);

const remote = [...bundle.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
console.log("wrote dist/travle-overland.html  " + (bundle.length / 1024).toFixed(0) + " KB");
console.log("remote references: " + (remote.length ? remote.join(", ") : "none"));
// `<header` must not trip the `<head` check, hence the boundary.
for (const tag of ["<!doctype", "<html", "<body", "<head"]) {
  if (new RegExp(tag + "[\\s>/]", "i").test(bundle)) console.log("WARNING: bundle still contains " + tag);
}
