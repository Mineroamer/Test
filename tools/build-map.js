/*
 * Generates data/map.js from a Natural Earth TopoJSON world atlas.
 *
 *   npm install world-atlas@2 topojson-client@3
 *   node tools/build-map.js node_modules/world-atlas/countries-50m.json
 *
 * Natural Earth is public domain. The output is a plain object of SVG path
 * strings keyed by ISO 3166-1 alpha-2, projected with Equal Earth, so the page
 * needs no map library and no network at run time.
 */
const fs = require("fs");
const path = require("path");
const topojson = require("topojson-client");
const E = require("../src/engine.js");

const source = process.argv[2] || "node_modules/world-atlas/countries-50m.json";
const topology = JSON.parse(fs.readFileSync(source, "utf8"));
const world = topojson.feature(topology, topology.objects.countries);

/* Natural Earth names that our own lookup cannot resolve on its own. */
const NAME_FIXES = {
  "Dem. Rep. Congo": "CD",
  "Congo": "CG",
  "Central African Rep.": "CF",
  "S. Sudan": "SS",
  "Eq. Guinea": "GQ",
  "Bosnia and Herz.": "BA",
  "Dominican Rep.": "DO",
  "Solomon Is.": "SB",
  "Timor-Leste": "TL",
  "Macedonia": "MK",
  "North Macedonia": "MK",
  "Swaziland": "SZ",
  "eSwatini": "SZ",
  "Côte d'Ivoire": "CI",
  "Cabo Verde": "CV",
  "Marshall Is.": "MH",
  "Antigua and Barb.": "AG",
  "St. Kitts and Nevis": "KN",
  "St. Vin. and Gren.": "VC",
  "St. Lucia": "LC",
  "Trinidad and Tobago": "TT",
  "São Tomé and Principe": "ST",
  "Sao Tome and Principe": "ST",
  "Fed. States of Micronesia": "FM",
  "Micronesia": "FM",
  "Br. Indian Ocean Ter.": null,
  "Vatican": "VA",
};

/* Land that is not a country on our board: still drawn, just not playable. */
const NOT_PLAYABLE = new Set([
  "Antarctica", "Greenland", "W. Sahara", "Fr. S. Antarctic Lands", "Falkland Is.",
  "N. Cyprus", "Somaliland", "Puerto Rico", "New Caledonia", "Fr. Polynesia",
  "Siachen Glacier", "Antarctica ", "Heard I. and McDonald Is.", "S. Geo. and the Is.",
]);

/* -------------------------------------------------------------- projection */

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;

function equalEarth(lon, lat) {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p));
  const t2 = t * t, t6 = t2 * t2 * t2, t8 = t6 * t2;
  const dy = A1 + 3 * A2 * t2 + 7 * A3 * t6 + 9 * A4 * t8;
  const x = (2 * Math.sqrt(3) * l * Math.cos(t)) / (3 * dy);
  const y = t * (A1 + A2 * t2 + A3 * t6 + A4 * t8);
  return [x, y];
}

/* Frame the populated world: everything from 84N down to 57S.
   Equal Earth is pseudocylindrical - meridians bow inwards towards the poles -
   so the widest point of the map is the equator, and that is what sets the
   horizontal scale. Measuring it at any other latitude overflows the frame. */
const LAT_TOP = 84, LAT_BOTTOM = -57;
const X_MIN = equalEarth(-180, 0)[0];
const X_MAX = equalEarth(180, 0)[0];
const Y_TOP = equalEarth(0, LAT_TOP)[1];
const Y_BOTTOM = equalEarth(0, LAT_BOTTOM)[1];
const WIDTH = 1000;
const scale = WIDTH / (X_MAX - X_MIN);
const HEIGHT = Math.round((Y_TOP - Y_BOTTOM) * scale);

/** Fold a longitude back into -180..180. */
function wrapLon(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}

function project(lon, lat) {
  const [x, y] = equalEarth(wrapLon(lon), Math.max(LAT_BOTTOM - 10, Math.min(90, lat)));
  return [(x - X_MIN) * scale, (Y_TOP - y) * scale];
}

/* ------------------------------------------------------------ path writing */

const PRECISION = 1;
const TOLERANCE = 0.7; // screen units; coastline detail finer than this goes
const round = (n) => Math.round(n * 10 ** PRECISION) / 10 ** PRECISION;

/** Perpendicular distance from p to the line ab, squared. */
function segmentDistance(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Ramer-Douglas-Peucker, iterative so long coastlines cannot blow the stack. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const sqTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let worst = sqTolerance;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) { worst = d; index = i; }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Break a ring wherever it crosses the antimeridian, so a country that wraps
 * (Russia, the Aleutians, Fiji) draws as pieces at each edge instead of one
 * streak straight across the map.
 */
function splitAtAntimeridian(ring) {
  const pieces = [];
  let piece = [];
  let previous = null;
  for (const [lon, lat] of ring) {
    const l = wrapLon(lon);
    if (previous !== null && Math.abs(l - previous) > 180) {
      if (piece.length) pieces.push(piece);
      piece = [];
    }
    piece.push([l, lat]);
    previous = l;
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

function subRingToPath(points) {
  const projected = points.map(([lon, lat]) => project(lon, lat));
  let simplified = simplify(projected, TOLERANCE);
  // Microstates are smaller than the tolerance; keep them whole rather than
  // simplifying them out of existence.
  if (simplified.length < 4) simplified = projected;
  let out = "";
  let last = null;
  let kept = 0;
  for (const point of simplified) {
    const x = round(point[0]), y = round(point[1]);
    if (last && x === last[0] && y === last[1]) continue; // dropped by rounding
    out += (kept === 0 ? "M" : "L") + x + " " + y;
    last = [x, y];
    kept++;
  }
  return kept >= 3 ? out + "Z" : "";
}

function ringToPath(ring) {
  return splitAtAntimeridian(ring).map(subRingToPath).filter(Boolean).join("");
}

function ringArea(ring) {
  // Measure the largest un-wrapped piece, so a country that straddles the
  // antimeridian is not credited with a box the width of the world.
  let best = { box: -1, cx: 0, cy: 0 };
  for (const piece of splitAtAntimeridian(ring)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lon, lat] of piece) {
      const [x, y] = project(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const box = (maxX - minX) * (maxY - minY);
    if (box > best.box) {
      best = { box, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, minY, maxX, maxY };
    }
  }
  return best;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** Outer rings only, largest first; slivers below the visible threshold go. */
function shapeOf(feature, minBox) {
  const rings = polygonsOf(feature.geometry)
    .map((poly) => poly[0])
    .map((ring) => ({ ring, ...ringArea(ring) }))
    .sort((a, b) => b.box - a.box);
  if (!rings.length) return null;
  const keep = rings.filter((r, i) => i === 0 || r.box >= minBox);
  const d = keep.map((r) => ringToPath(r.ring)).filter(Boolean).join("");
  const main = rings[0];
  return d
    ? { d, big: main.box, cx: main.cx, cy: main.cy, box: [main.minX, main.minY, main.maxX, main.maxY] }
    : null;
}

/* ------------------------------------------------------------------- build */

const paths = {};
const dots = {};
const centres = {};
const otherLand = [];
const unmatched = [];

for (const feature of world.features) {
  const name = feature.properties && feature.properties.name;
  if (!name) continue;

  let code = Object.prototype.hasOwnProperty.call(NAME_FIXES, name)
    ? NAME_FIXES[name]
    : E.resolve(name);

  if (NOT_PLAYABLE.has(name)) code = null;
  if (code && !E.COUNTRIES[code]) code = null;

  const shape = shapeOf(feature, 0.9);
  if (!shape) continue;

  if (!code) {
    if (name !== "Antarctica") otherLand.push(shape.d);
    if (!NOT_PLAYABLE.has(name)) unmatched.push(name);
    continue;
  }

  // A couple of names appear twice in the source; keep the bigger shape.
  if (paths[code] && shape.big < (centres[code] || {}).big) continue;
  paths[code] = shape.d;
  centres[code] = { x: round(shape.cx), y: round(shape.cy), big: shape.big, box: shape.box.map(round) };
  if (shape.big < 6) dots[code] = true; // too small to see, gets a marker
}

const missing = Object.keys(E.COUNTRIES).filter((c) => !paths[c]);

const out = `/*
 * World outlines for the map, generated by tools/build-map.js.
 * Source: Natural Earth via world-atlas (public domain), 1:50m.
 * Projection: Equal Earth, framed from ${LAT_TOP}N to ${LAT_BOTTOM}S.
 * Do not edit by hand - regenerate instead.
 */

const MAP = {
  width: ${WIDTH},
  height: ${HEIGHT},
  // Land that is not a country on the board: drawn, but never playable.
  other: ${JSON.stringify(otherLand.join(""))},
  // ISO 3166-1 alpha-2 -> SVG path data.
  shapes: {
${Object.keys(paths).sort().map((c) => `    ${c}: ${JSON.stringify(paths[c])},`).join("\n")}
  },
  // Visual centre of each country, for markers.
  centres: {
${Object.keys(centres).sort().map((c) => `    ${c}: [${centres[c].x}, ${centres[c].y}],`).join("\n")}
  },
  // Bounding box of each country's main landmass, for framing the view.
  bounds: {
${Object.keys(centres).sort().map((c) => `    ${c}: [${centres[c].box.join(", ")}],`).join("\n")}
  },
  // Countries too small to see at this scale; drawn as a marker instead.
  tiny: ${JSON.stringify(Object.keys(dots).sort())},
  // Where the Bering house rule crosses: Chukotka on one side, Alaska on the
  // other. Roughly 80km apart in reality, a few units apart here.
  bering: {
    ru: [${project(-171, 65.9).map(round).join(", ")}],
    us: [${project(-166, 65.3).map(round).join(", ")}],
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MAP };
} else {
  globalThis.MAP = MAP;
}
`;

fs.writeFileSync(path.join(__dirname, "..", "data", "map.js"), out);

console.log("viewBox 0 0 " + WIDTH + " " + HEIGHT);
console.log("shapes: " + Object.keys(paths).length + " of " + Object.keys(E.COUNTRIES).length + " countries");
console.log("tiny (marker only): " + Object.keys(dots).length);
console.log("no shape: " + (missing.length ? missing.join(", ") : "none"));
console.log("unmatched source names: " + (unmatched.length ? unmatched.join(", ") : "none"));
console.log("written: data/map.js (" + (out.length / 1024).toFixed(0) + " KB)");
