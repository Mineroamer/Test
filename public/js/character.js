/*
 * Drawing a character.
 *
 * Everything is one SVG, built from the slots on a character record. There are
 * no images to load: the whole wardrobe is a few hundred lines of paths, which
 * means an avatar costs nothing on the leaderboard where sixty of them appear
 * at once, and the packed single-file build does not grow a sprite sheet.
 *
 * The canvas is 100x100 and every piece is drawn to the same anatomy:
 *
 *      head   circle at (50, 45), radius 21
 *      eyes   (42, 43) and (58, 43)
 *      mouth  around (50, 55)
 *      body   shoulders from y=74 down
 *      hand   an item sits around (78, 80)
 *
 * A piece that ignores those numbers will look wrong next to the others, so
 * they are written down here rather than rediscovered in each path.
 */

/* Ids inside an SVG are global to the document, so two avatars on one page
 * would share a gradient and the second would win. Each render gets its own
 * suffix instead. */
let serial = 0;

const accent = (hue, l = 46, s = 58) => `hsl(${hue} ${s}% ${l}%)`;
const soft = (hue, l = 88, s = 60) => `hsl(${hue} ${s}% ${l}%)`;

/* Darker version of the skin, for the ear and the shading under the chin. */
function shade(hex, amount = 0.86) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(c * amount))));
  return "#" + parts.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------- backdrops */

const BACKDROPS = {
  plain: (hue) => `<rect width="100" height="100" rx="16" fill="${soft(hue, 90)}"/>`,

  graph: (hue, id) => `
    <rect width="100" height="100" rx="16" fill="#fbfaf6"/>
    <g stroke="${soft(hue, 76)}" stroke-width="1" opacity="0.85">
      ${[12, 24, 36, 48, 60, 72, 84].map((n) =>
        `<path d="M${n} 0V100M0 ${n}H100"/>`).join("")}
    </g>
    <rect width="100" height="100" rx="16" fill="none" stroke="${soft(hue, 70)}" stroke-width="2"/>`,

  dawn: (hue, id) => `
    <defs><linearGradient id="bd${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${(hue + 200) % 360} 70% 62%)"/>
      <stop offset="0.55" stop-color="hsl(${(hue + 30) % 360} 82% 74%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 10) % 360} 88% 86%)"/>
    </linearGradient></defs>
    <rect width="100" height="100" rx="16" fill="url(#bd${id})"/>
    <circle cx="50" cy="64" r="17" fill="hsl(${(hue + 20) % 360} 95% 82%)" opacity="0.9"/>`,

  honeycomb: (hue) => `
    <rect width="100" height="100" rx="16" fill="hsl(46 92% 88%)"/>
    <g fill="none" stroke="hsl(40 70% 62%)" stroke-width="1.6" opacity="0.75">
      ${hexes()}
    </g>`,

  grid: (hue, id) => `
    <rect width="100" height="100" rx="16" fill="hsl(${hue} 32% 17%)"/>
    <g stroke="${accent(hue, 62, 78)}" stroke-width="1" opacity="0.5">
      ${[16, 32, 48, 64, 82].map((n) => `<path d="M${n} 0V100M0 ${n}H100"/>`).join("")}
    </g>
    <circle cx="50" cy="46" r="34" fill="${accent(hue, 58, 80)}" opacity="0.22"/>`,

  atlas: (hue) => `
    <rect width="100" height="100" rx="16" fill="hsl(196 42% 84%)"/>
    <g fill="hsl(150 26% 68%)" opacity="0.95">
      <path d="M6 34c10-9 22-4 30 2s18 3 24-4 14-6 18 2-2 16-12 18-16-4-26 0-16 10-24 6-16-16-10-24z"/>
      <path d="M22 72c8-6 18-2 26 2s16 0 20 6-6 12-16 12-22-2-28-8-8-8-2-12z"/>
    </g>
    <g fill="none" stroke="hsl(200 30% 62%)" stroke-width="0.9" opacity="0.7">
      <path d="M0 20h100M0 50h100M0 80h100"/>
    </g>`,

  falling: (hue) => `
    <rect width="100" height="100" rx="16" fill="hsl(${hue} 30% 22%)"/>
    <g fill="hsl(${hue} 70% 78%)" opacity="0.85">
      ${[[14, 18], [72, 12], [30, 46], [86, 40], [8, 70], [56, 26], [44, 84], [78, 72], [24, 92]]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${3 + (i % 3)}"/>`).join("")}
    </g>`,

  aurora: (hue, id) => `
    <defs><linearGradient id="au${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${(hue + 260) % 360} 60% 22%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 200) % 360} 55% 32%)"/>
    </linearGradient></defs>
    <rect width="100" height="100" rx="16" fill="url(#au${id})"/>
    <g opacity="0.75" fill="none" stroke-linecap="round">
      <path d="M-4 44c18-22 34 6 52-12s28 4 56-16" stroke="hsl(150 80% 62%)" stroke-width="9" opacity="0.55"/>
      <path d="M-4 60c20-18 32 8 54-10s26 6 54-14" stroke="hsl(190 85% 66%)" stroke-width="6" opacity="0.5"/>
      <path d="M-4 30c16-14 30 4 50-8s30 2 56-10" stroke="hsl(280 75% 70%)" stroke-width="5" opacity="0.45"/>
    </g>
    ${[[16, 14], [64, 10], [86, 26], [34, 22], [76, 54]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#fff" opacity="0.85"/>`).join("")}`,

  /* Earned by finishing every one of a day's puzzles. */
  confetti: (hue) => `
    <rect width="100" height="100" rx="16" fill="${soft(hue, 93)}"/>
    <g>
      ${[[10, 14, -25, 0], [26, 6, 40, 1], [44, 18, -10, 2], [62, 8, 25, 3], [80, 16, -35, 4],
         [6, 40, 15, 5], [30, 34, -45, 0], [70, 38, 30, 1], [92, 44, -20, 2],
         [14, 66, 35, 3], [38, 58, -15, 4], [58, 70, 20, 5], [84, 64, -40, 0],
         [22, 88, 10, 1], [50, 92, -30, 2], [74, 86, 45, 3]]
        .map(([x, y, turn, tint]) =>
          `<rect x="${x}" y="${y}" width="6" height="3.4" rx="1"
                 transform="rotate(${turn} ${x + 3} ${y + 1.7})"
                 fill="hsl(${(hue + tint * 61) % 360} 82% 58%)"/>`).join("")}
    </g>`,
};

/* A field of hexagons, offset row by row, for the honeycomb backdrop. */
function hexes() {
  const out = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cx = col * 24 + (row % 2 ? 12 : 0);
      const cy = row * 21 + 4;
      out.push(`<path d="M${cx} ${cy - 8}l9 5v10l-9 5-9-5v-10z"/>`);
    }
  }
  return out.join("");
}

/* ---------------------------------------------------------------- bodies */

/* Every outfit is this silhouette with different clothes painted on it. */
const TORSO = "M14 100c0-16 14-26 36-26s36 10 36 26z";

const OUTFITS = {
  tee: (hue) => `
    <path d="${TORSO}" fill="${accent(hue)}"/>
    <path d="M40 75c3 6 17 6 20 0" fill="none" stroke="${accent(hue, 34)}" stroke-width="2.4"/>`,

  stripes: (hue) => `
    <path d="${TORSO}" fill="${accent(hue, 78, 40)}"/>
    <g clip-path="inset(0 round 0)">
      ${[80, 87, 94].map((y) =>
        `<path d="M14 ${y}h72" stroke="${accent(hue, 40)}" stroke-width="4.5"/>`).join("")}
    </g>
    <path d="M40 75c3 6 17 6 20 0" fill="none" stroke="${accent(hue, 34)}" stroke-width="2.4"/>`,

  cardigan: (hue) => `
    <path d="${TORSO}" fill="hsl(28 26% 46%)"/>
    <path d="M50 74v26" stroke="hsl(28 26% 34%)" stroke-width="2"/>
    <path d="M36 76l14 10 14-10" fill="hsl(34 30% 88%)" stroke="hsl(28 26% 34%)" stroke-width="1.6"/>
    ${[86, 94].map((y) => `<circle cx="50" cy="${y}" r="2" fill="hsl(44 60% 82%)"/>`).join("")}`,

  apiarist: () => `
    <path d="${TORSO}" fill="#f7f5ee"/>
    <path d="M14 92h72" stroke="hsl(44 92% 56%)" stroke-width="5"/>
    <path d="M40 75c3 6 17 6 20 0" fill="none" stroke="#d9d4c4" stroke-width="2.4"/>
    <circle cx="66" cy="82" r="3.4" fill="hsl(44 92% 56%)"/>
    <path d="M63 82h6M66 79v6" stroke="hsl(30 60% 30%)" stroke-width="1"/>`,

  coat: (hue) => `
    <path d="${TORSO}" fill="hsl(32 34% 40%)"/>
    <path d="M50 74 34 100h32z" fill="hsl(34 30% 52%)"/>
    <path d="M50 74 40 88M50 74l10 14" stroke="hsl(30 30% 28%)" stroke-width="2" fill="none"/>
    <rect x="60" y="84" width="14" height="10" rx="2" fill="hsl(30 28% 32%)"/>
    <path d="M60 88h14" stroke="hsl(44 50% 70%)" stroke-width="1.4"/>`,

  dominos: (hue) => `
    <path d="${TORSO}" fill="#25282e"/>
    <path d="M50 74v26" stroke="#f4f3ef" stroke-width="2"/>
    <g fill="#f4f3ef">
      ${[[36, 82], [36, 92], [64, 82], [64, 88], [64, 94]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`).join("")}
    </g>`,

  spangram: (hue) => `
    <path d="${TORSO}" fill="hsl(${hue} 34% 24%)"/>
    <path d="M14 96 86 78" stroke="hsl(46 96% 60%)" stroke-width="6" stroke-linecap="round"/>
    <g fill="hsl(190 84% 62%)">
      ${[[28, 82], [44, 79], [60, 88], [74, 92]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join("")}
    </g>`,

  /* Earned by walking an Expert route without a wasted guess. */
  sash: (hue) => `
    <path d="${TORSO}" fill="hsl(${hue} 28% 30%)"/>
    <path d="M26 78 74 100" stroke="hsl(46 88% 58%)" stroke-width="9" stroke-linecap="round"/>
    <path d="M26 78 74 100" stroke="hsl(40 72% 44%)" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
    <circle cx="62" cy="92" r="5" fill="hsl(46 92% 66%)"/>
    <path d="M62 88.5 63 91h2.6l-2.1 1.6.8 2.5-2.3-1.5-2.3 1.5.8-2.5-2.1-1.6H61z" fill="hsl(30 55% 26%)"/>`,

  robes: (hue, id) => `
    <defs><linearGradient id="rb${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 46% 34%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 320) % 360} 50% 22%)"/>
    </linearGradient></defs>
    <path d="${TORSO}" fill="url(#rb${id})"/>
    <path d="M50 74 36 100M50 74l14 26" stroke="hsl(46 88% 62%)" stroke-width="3" fill="none"/>
    <path d="M14 100c0-16 14-26 36-26" fill="none" stroke="hsl(46 88% 62%)" stroke-width="2"/>
    <circle cx="50" cy="82" r="4" fill="hsl(46 92% 66%)"/>
    <circle cx="50" cy="82" r="1.6" fill="hsl(${hue} 46% 24%)"/>`,
};

/* ----------------------------------------------------------------- faces */

const FACES = {
  focused: () => `
    <g fill="#2a2622">
      <circle cx="42" cy="43" r="2.6"/><circle cx="58" cy="43" r="2.6"/>
    </g>
    <path d="M44 55h12" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,

  grin: () => `
    <g fill="#2a2622">
      <circle cx="42" cy="42" r="2.6"/><circle cx="58" cy="42" r="2.6"/>
    </g>
    <path d="M41 52c4 6 14 6 18 0" fill="none" stroke="#2a2622" stroke-width="2.4" stroke-linecap="round"/>`,

  squint: () => `
    <g stroke="#2a2622" stroke-width="2.4" stroke-linecap="round">
      <path d="M38 43h8M54 43h8"/>
    </g>
    <path d="M44 54c3 3 9 3 12 0" fill="none" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,

  wink: () => `
    <circle cx="42" cy="42" r="2.6" fill="#2a2622"/>
    <path d="M54 43c2-3 6-3 8 0" fill="none" stroke="#2a2622" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M42 53c4 5 13 5 16 0" fill="none" stroke="#2a2622" stroke-width="2.4" stroke-linecap="round"/>`,

  starry: (hue) => `
    <g fill="${accent(hue, 52, 80)}">
      <path d="M42 38l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z"/>
      <path d="M58 38l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z"/>
    </g>
    <path d="M43 54c4 5 13 5 15 0" fill="none" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,

  monocle: () => `
    <circle cx="42" cy="43" r="2.4" fill="#2a2622"/>
    <circle cx="58" cy="43" r="7" fill="hsl(200 40% 90%)" opacity="0.55"/>
    <circle cx="58" cy="43" r="7" fill="none" stroke="hsl(44 62% 46%)" stroke-width="2"/>
    <path d="M58 50v7" stroke="hsl(44 62% 46%)" stroke-width="1.4"/>
    <circle cx="58" cy="43" r="2.4" fill="#2a2622"/>
    <path d="M44 56h11" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,

  shades: (hue) => `
    <path d="M30 40h40v3H30z" fill="#22252b"/>
    <rect x="31" y="39" width="16" height="11" rx="4" fill="#22252b"/>
    <rect x="53" y="39" width="16" height="11" rx="4" fill="#22252b"/>
    <path d="M47 43h6" stroke="#22252b" stroke-width="2.4"/>
    <path d="M34 42l4 5" stroke="${accent(hue, 70, 70)}" stroke-width="1.6" opacity="0.8"/>
    <path d="M43 53c4 4 11 4 14 0" fill="none" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,

  /* Earned by opening Connections with the hardest group. */
  smug: () => `
    <g stroke="#2a2622" stroke-width="2.4" stroke-linecap="round" fill="none">
      <path d="M37 42q5 -4 10 0"/>
      <path d="M53 42q5 -4 10 0"/>
    </g>
    <path d="M41 53q9 6 18 -2" fill="none" stroke="#2a2622" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M60 34q5 1 7 4" fill="none" stroke="#2a2622" stroke-width="1.8" stroke-linecap="round"/>`,

  visor: (hue) => `
    <path d="M28 40q22 -9 44 0v8q-22 7 -44 0z" fill="hsl(${hue} 60% 34%)" opacity="0.92"/>
    <path d="M28 40q22 -9 44 0" fill="none" stroke="hsl(46 92% 62%)" stroke-width="2"/>
    <path d="M34 44q16 -4 32 0" fill="none" stroke="hsl(180 90% 70%)" stroke-width="1.6" opacity="0.9"/>
    <path d="M44 56h12" stroke="#2a2622" stroke-width="2.2" stroke-linecap="round"/>`,
};

/* ------------------------------------------------------------- headgear */

const HEADS = {
  bare: () => "",

  pencil: () => `
    <g transform="rotate(-18 70 40)">
      <rect x="64" y="30" width="5" height="20" fill="hsl(46 92% 58%)"/>
      <path d="M64 30h5l-2.5-5z" fill="hsl(28 40% 62%)"/>
      <path d="M65.2 26.8h2.6l-1.3-1.8z" fill="#2a2622"/>
      <rect x="64" y="50" width="5" height="4" fill="hsl(350 55% 62%)"/>
    </g>`,

  beanie: (hue) => `
    <path d="M29 40a21 21 0 0 1 42 0z" fill="${accent(hue, 40)}"/>
    <rect x="28" y="38" width="44" height="7" rx="3.5" fill="${accent(hue, 52)}"/>
    <circle cx="50" cy="22" r="4.5" fill="${accent(hue, 66)}"/>`,

  cap: (hue) => `
    <path d="M29 41a21 21 0 0 1 42 0z" fill="${accent(hue, 38)}"/>
    <rect x="27" y="39" width="46" height="6" rx="3" fill="${accent(hue, 46)}"/>
    <path d="M27 40q-9 1 -9 6h9z" fill="${accent(hue, 32)}"/>
    <circle cx="50" cy="26" r="2.6" fill="${accent(hue, 62)}"/>`,

  veil: () => `
    <path d="M27 42a23 23 0 0 1 46 0v3H27z" fill="#f7f5ee"/>
    <rect x="25" y="43" width="50" height="4" rx="2" fill="hsl(44 88% 58%)"/>
    <path d="M28 47a22 22 0 0 0 44 0z" fill="#e9eef1" opacity="0.55"/>
    <g stroke="#b8c4cc" stroke-width="0.7" opacity="0.9">
      ${[34, 40, 46, 52, 58, 64].map((x) => `<path d="M${x} 47v14"/>`).join("")}
      ${[52, 57, 62].map((y) => `<path d="M29 ${y}h42"/>`).join("")}
    </g>`,

  explorer: () => `
    <ellipse cx="50" cy="42" rx="30" ry="7" fill="hsl(34 34% 44%)"/>
    <path d="M32 42a18 18 0 0 1 36 0z" fill="hsl(34 38% 52%)"/>
    <rect x="32" y="37" width="36" height="6" rx="3" fill="hsl(28 40% 30%)"/>
    <circle cx="66" cy="40" r="2.2" fill="hsl(44 70% 62%)"/>`,

  headlamp: () => `
    <rect x="29" y="28" width="42" height="7" rx="3.5" fill="hsl(215 18% 28%)"/>
    <rect x="42" y="23" width="16" height="12" rx="4" fill="hsl(215 16% 38%)"/>
    <circle cx="50" cy="29" r="4.2" fill="hsl(52 96% 74%)"/>
    <circle cx="50" cy="29" r="1.6" fill="#fff"/>
    <path d="M50 29 30 4h40z" fill="hsl(52 96% 74%)" opacity="0.3"/>`,

  laurel: () => `
    <path d="M31 40a19 19 0 0 1 38 0" fill="none" stroke="hsl(140 34% 34%)" stroke-width="2.2"/>
    <g fill="hsl(140 42% 44%)">
      ${[[33, 38, -55], [37, 32, -40], [43, 28, -22], [50, 26, 0],
         [57, 28, 22], [63, 32, 40], [67, 38, 55]]
        .map(([x, y, turn]) =>
          `<ellipse cx="${x}" cy="${y}" rx="3" ry="5.4" transform="rotate(${turn} ${x} ${y})"/>`).join("")}
    </g>
    <circle cx="50" cy="24" r="2.4" fill="hsl(46 88% 58%)"/>`,

  /* Earned by finding every word in the hive. */
  antennae: () => `
    <g fill="none" stroke="#2a2622" stroke-width="2.4" stroke-linecap="round">
      <path d="M42 26q-5 -10 -11 -13"/>
      <path d="M58 26q5 -10 11 -13"/>
    </g>
    <circle cx="30" cy="12" r="4.6" fill="hsl(44 92% 58%)" stroke="#2a2622" stroke-width="1.6"/>
    <circle cx="70" cy="12" r="4.6" fill="hsl(44 92% 58%)" stroke="#2a2622" stroke-width="1.6"/>`,

  /* Earned by winning ten duels. The mesh is drawn rather than hatched with a
   * pattern, because a pattern would need an id and two of these on one screen
   * would then share it. */
  fencer: () => `
    <path d="M30 30q20 -12 40 0v18q0 16 -20 20T30 48z" fill="hsl(215 14% 78%)"
          stroke="hsl(215 18% 44%)" stroke-width="2"/>
    <path d="M34 32q16 -9 32 0v16q0 12 -16 16T34 48z" fill="hsl(215 16% 88%)" opacity="0.55"/>
    <g stroke="hsl(215 18% 50%)" stroke-width="0.8" opacity="0.75">
      ${[36, 41, 46, 51, 56, 61, 66].map((x) => `<path d="M${x} 29v36"/>`).join("")}
      ${[34, 40, 46, 52, 58].map((y) => `<path d="M31 ${y}h38"/>`).join("")}
    </g>
    <path d="M30 30q20 -12 40 0" fill="none" stroke="hsl(215 20% 38%)" stroke-width="3"/>
    <path d="M38 66h24l-2 5H40z" fill="hsl(352 48% 46%)"/>`,

  crown: () => `
    <path d="M28 34 33 15l8 10 9-13 9 13 8-10 5 19z" fill="hsl(46 90% 58%)"/>
    <rect x="28" y="32" width="44" height="9" rx="2.5" fill="hsl(42 80% 44%)"/>
    <g fill="hsl(28 60% 18%)" font-family="ui-monospace, ui-monospace, monospace"
       font-size="9" font-weight="700" text-anchor="middle">
      <text x="37" y="40">A</text><text x="50" y="40">E</text><text x="63" y="40">I</text>
    </g>
    ${[[33, 15], [50, 12], [67, 15]].map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="2.6" fill="hsl(352 62% 56%)"/>`).join("")}`,
};

/* -------------------------------------------------------------- in hand */

const HELD = {
  empty: () => "",

  pencil: () => `
    <g transform="rotate(24 78 82)">
      <rect x="75" y="66" width="6" height="24" fill="hsl(46 92% 58%)"/>
      <path d="M75 66h6l-3-6z" fill="hsl(28 40% 62%)"/>
      <path d="M76.5 62h3l-1.5-2.4z" fill="#2a2622"/>
      <rect x="75" y="90" width="6" height="5" fill="hsl(350 55% 62%)"/>
    </g>`,

  mug: () => `
    <rect x="70" y="74" width="15" height="15" rx="3" fill="#f4f3ef"/>
    <path d="M85 78h4a4 4 0 0 1 0 8h-4" fill="none" stroke="#f4f3ef" stroke-width="2.6"/>
    <rect x="72" y="76" width="11" height="4" rx="1.5" fill="hsl(28 52% 30%)"/>`,

  magnifier: (hue) => `
    <circle cx="76" cy="76" r="9" fill="hsl(200 46% 88%)" opacity="0.6"/>
    <circle cx="76" cy="76" r="9" fill="none" stroke="hsl(215 18% 34%)" stroke-width="3"/>
    <path d="M83 83l7 8" stroke="hsl(28 40% 44%)" stroke-width="4" stroke-linecap="round"/>`,

  compass: () => `
    <circle cx="77" cy="80" r="10" fill="hsl(44 62% 52%)"/>
    <circle cx="77" cy="80" r="7.5" fill="hsl(36 36% 92%)"/>
    <path d="M77 74l3 6-3 6-3-6z" fill="hsl(352 62% 52%)"/>
    <circle cx="77" cy="80" r="1.4" fill="#2a2622"/>`,

  domino: () => `
    <g transform="rotate(-14 78 80)">
      <rect x="70" y="68" width="16" height="26" rx="3" fill="#f4f3ef" stroke="#c9c6bd" stroke-width="1"/>
      <path d="M70 81h16" stroke="#c9c6bd" stroke-width="1"/>
      <g fill="#2a2622">
        <circle cx="78" cy="74" r="2"/>
        <circle cx="74" cy="86" r="2"/><circle cx="82" cy="86" r="2"/>
      </g>
    </g>`,

  honeypot: () => `
    <path d="M69 76h18l-2 16H71z" fill="hsl(36 70% 40%)"/>
    <rect x="67" y="72" width="22" height="6" rx="2" fill="hsl(36 62% 32%)"/>
    <path d="M72 82q6 4 12 0v6q-6 4-12 0z" fill="hsl(44 92% 60%)"/>`,

  /* Earned by guessing a Wordle first try. */
  horseshoe: () => `
    <g transform="rotate(12 78 80)">
      <path d="M70 92a10 12 0 1 1 16 0" fill="none" stroke="hsl(44 62% 50%)" stroke-width="6" stroke-linecap="round"/>
      <path d="M70 92a10 12 0 1 1 16 0" fill="none" stroke="hsl(48 82% 68%)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="70" cy="92" r="1.6" fill="hsl(30 45% 28%)"/>
      <circle cx="86" cy="92" r="1.6" fill="hsl(30 45% 28%)"/>
    </g>`,

  /* Earned by filling the Mini inside a minute. */
  stopwatch: () => `
    <circle cx="78" cy="82" r="11" fill="#f4f3ef" stroke="hsl(215 18% 32%)" stroke-width="2.6"/>
    <rect x="74" y="67" width="8" height="4" rx="1.4" fill="hsl(215 18% 32%)"/>
    <path d="M78 82V75M78 82l5 3" stroke="hsl(352 62% 50%)" stroke-width="2" stroke-linecap="round"/>
    <circle cx="78" cy="82" r="1.4" fill="hsl(215 18% 32%)"/>`,

  /* Earned by beating a friend to a puzzle. Thrown, so it lies open. */
  gauntlet: () => `
    <g transform="rotate(-20 78 82)">
      <path d="M71 72h14v18a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4z" fill="hsl(215 14% 74%)"
            stroke="hsl(215 20% 44%)" stroke-width="1.6"/>
      <path d="M71 76h14M71 81h14M71 86h14" stroke="hsl(215 20% 50%)" stroke-width="1.2"/>
      <path d="M69 68h18v5H69z" fill="hsl(215 18% 56%)" stroke="hsl(215 22% 38%)" stroke-width="1.4"/>
      <path d="M74 94v4M80 94v4" stroke="hsl(215 20% 44%)" stroke-width="2.4" stroke-linecap="round"/>
    </g>`,

  /* Earned by finding every theme word with the lights off. */
  torch: () => `
    <g transform="rotate(-20 78 82)">
      <rect x="73" y="78" width="10" height="16" rx="2" fill="hsl(215 16% 34%)"/>
      <path d="M71 78h14l-2 -6H73z" fill="hsl(215 18% 44%)"/>
      <path d="M78 72 62 52h32z" fill="hsl(52 96% 74%)" opacity="0.4"/>
      <circle cx="78" cy="73" r="3.4" fill="hsl(52 96% 78%)"/>
    </g>`,

  quill: () => `
    <path d="M88 60q-16 8-20 26 12 2 18-8t2-18z" fill="hsl(46 88% 62%)"/>
    <path d="M86 63q-12 8-16 22" fill="none" stroke="hsl(40 66% 42%)" stroke-width="1.4"/>
    <path d="M68 86l-6 8" stroke="hsl(46 88% 62%)" stroke-width="3" stroke-linecap="round"/>`,
};

/* --------------------------------------------------------------- frames */

const FRAMES = {
  none: () => "",
  thin: (hue) => `<rect x="1.5" y="1.5" width="97" height="97" rx="15" fill="none" stroke="${accent(hue, 55)}" stroke-width="3"/>`,
  rope: (hue) => `
    <rect x="2" y="2" width="96" height="96" rx="15" fill="none" stroke="hsl(34 40% 52%)" stroke-width="5"/>
    <rect x="2" y="2" width="96" height="96" rx="15" fill="none" stroke="hsl(34 46% 68%)" stroke-width="5"
          stroke-dasharray="5 5"/>`,
  bronze: () => `
    <rect x="2" y="2" width="96" height="96" rx="15" fill="none" stroke="hsl(24 44% 42%)" stroke-width="5"/>
    <rect x="5" y="5" width="90" height="90" rx="12" fill="none" stroke="hsl(28 52% 62%)" stroke-width="1.6"/>`,
  gold: (hue, id) => `
    <defs><linearGradient id="gf${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(46 90% 72%)"/>
      <stop offset="0.5" stop-color="hsl(42 78% 46%)"/>
      <stop offset="1" stop-color="hsl(48 92% 76%)"/>
    </linearGradient></defs>
    <rect x="2.5" y="2.5" width="95" height="95" rx="15" fill="none" stroke="url(#gf${id})" stroke-width="5"/>`,
  neon: (hue) => `
    <rect x="3" y="3" width="94" height="94" rx="15" fill="none" stroke="${accent(hue, 60, 90)}" stroke-width="6" opacity="0.35"/>
    <rect x="3" y="3" width="94" height="94" rx="15" fill="none" stroke="${accent(hue, 74, 96)}" stroke-width="2.4"/>`,
  /* Earned by filling the whole crossword with no help at all. */
  star: (hue, id) => `
    <defs><linearGradient id="st${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(46 92% 74%)"/>
      <stop offset="1" stop-color="hsl(40 80% 46%)"/>
    </linearGradient></defs>
    <rect x="2.5" y="2.5" width="95" height="95" rx="15" fill="none" stroke="url(#st${id})" stroke-width="5"/>
    <g fill="url(#st${id})">
      ${[[50, 2.5], [2.5, 50], [97.5, 50], [50, 97.5]].map(([x, y]) =>
        `<path d="M${x} ${y - 6}l1.9 4 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>`).join("")}
    </g>`,

  wreath: () => `
    <rect x="2.5" y="2.5" width="95" height="95" rx="15" fill="none" stroke="hsl(140 34% 40%)" stroke-width="4"/>
    <g fill="hsl(140 40% 46%)">
      ${[10, 25, 40, 60, 75, 90].flatMap((n) => [
        `<ellipse cx="2.5" cy="${n}" rx="3.4" ry="5" transform="rotate(-20 2.5 ${n})"/>`,
        `<ellipse cx="97.5" cy="${n}" rx="3.4" ry="5" transform="rotate(20 97.5 ${n})"/>`,
      ]).join("")}
    </g>
    <path d="M44 96h12l-6-6z" fill="hsl(46 88% 58%)"/>`,
};

/* ----------------------------------------------------------------- draw */

const pieces = { backdrop: BACKDROPS, outfit: OUTFITS, face: FACES, head: HEADS, held: HELD, frame: FRAMES };

const part = (slot, id, hue, uid) => {
  const draw = pieces[slot] && pieces[slot][id];
  return draw ? draw(hue, uid) : "";
};

/**
 * The character as an `<svg>` element, at whatever size you ask for.
 *
 * Pass `flat: true` on a small avatar to leave off the backdrop and frame:
 * inside a leaderboard row a busy backdrop fights the row itself, and the
 * face is the part worth seeing at 32 pixels.
 */
export function characterSvg(character, size = 96, options = {}) {
  const who = character || {};
  const hue = Number.isFinite(who.hue) ? who.hue : 200;
  const skin = typeof who.skin === "string" ? who.skin : "#f4d3b4";
  const uid = String(++serial);
  const flat = !!options.flat;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "pc-character");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  svg.innerHTML = `
    <clipPath id="cl${uid}"><rect width="100" height="100" rx="16"/></clipPath>
    <g clip-path="url(#cl${uid})">
      ${flat ? `<rect width="100" height="100" rx="16" fill="${soft(hue, 90)}"/>` : part("backdrop", who.backdrop, hue, uid)}
      ${part("outfit", who.outfit, hue, uid)}
      <path d="M44 58h12v12H44z" fill="${shade(skin, 0.9)}"/>
      <circle cx="50" cy="45" r="21" fill="${skin}"/>
      <path d="M50 66a21 21 0 0 0 20-14 21 21 0 0 1-40 0 21 21 0 0 0 20 14z" fill="${shade(skin, 0.94)}" opacity="0.5"/>
      ${part("face", who.face, hue, uid)}
      ${part("head", who.head, hue, uid)}
      ${part("held", who.held, hue, uid)}
    </g>
    ${flat ? "" : part("frame", who.frame, hue, uid)}`;

  return svg;
}

/**
 * A person as they appear beside their name: their character if they have
 * one, and their initials if they do not - a guest, or the author of a shared
 * puzzle from before any of this existed.
 */
export function portrait(person, size = 36, options = {}) {
  if (person && person.character) {
    const box = document.createElement("div");
    box.className = "portrait";
    box.style.width = size + "px";
    box.style.height = size + "px";
    box.appendChild(characterSvg(person.character, size, options));
    return box;
  }

  const hue = person && typeof person.colour === "number" ? person.colour : 200;
  const initials = String((person && (person.display || person.handle)) || "?")
    .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  const box = document.createElement("div");
  box.className = "avatar";
  box.style.width = size + "px";
  box.style.height = size + "px";
  box.style.fontSize = Math.round(size * 0.36) + "px";
  box.style.background = `hsl(${hue} 42% 42%)`;
  box.setAttribute("aria-hidden", "true");
  box.textContent = initials;
  return box;
}

/** Every id this file knows how to draw, so a test can hold it to the track. */
export const DRAWN = {
  backdrop: Object.keys(BACKDROPS),
  outfit: Object.keys(OUTFITS),
  face: Object.keys(FACES),
  head: Object.keys(HEADS),
  held: Object.keys(HELD),
  frame: Object.keys(FRAMES),
};
