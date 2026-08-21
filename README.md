# Travle Overland

A daily geography game: you are dropped in one country and have to reach
another **on foot**, naming a bordering country at a time. Every country you
walk into lights up on an unlabelled world map.

One house rule: **Russia and the United States count as neighbours.** The
Bering Strait is the only way the Americas join the rest of the board.

Play by opening `index.html`, or open `dist/travle-overland.html` — one
self-contained file, no build step, no server.

## How it plays

You start somewhere and are told where to finish. Type the name of a country
that borders the one you are standing in and you move into it. Name one that
does not and you stay put, one guess the poorer.

- **Back** returns you to the country you came from. It is free, always
  available, and you can keep going back as far as the start.
- Naming a country already on your trail also walks you back to it — that one
  costs a guess.
- The map carries no labels. Recognising the shapes is half the game.
- Drag the map to move it, and scroll, pinch, or use the buttons to zoom in on
  a crowded border. Everything drawn on top of the map holds its size on
  screen, so zooming shows more coastline rather than bigger markers. **Fit**
  puts the whole route back in view and hands the framing back to the game,
  which otherwise follows your trail only until you move the view yourself.
- The round ends when your guesses run out, and only then. If you walk
  somewhere the finish can no longer be reached from, the game says so and
  flags the counter — but the guesses are yours to spend however you like.

### The four levels

The three daily levels each deal **their own route for the day** and keep their
own streak — solving one does not spoil the others, because they are three
different walks rather than one walk at three settings. All three reset at
midnight, local time.

| Level | Route length | Guess allowance | Distance readout |
| --- | --- | --- | --- |
| Scenic | 4–5 borders | par + 8 | yes |
| Standard | 5–6 borders | par + 5 | yes |
| Expert | 6–7 borders | par + 2 | no |
| Unlimited | 4–7 borders | par + 5 | yes |

Unlimited is off the clock: a fresh route as often as you like.

Routes are dealt from a fixed shuffle of each level's pool rather than drawn at
random, so no route comes round again until every other one has been used —
over 800 days per level at one a day.

## What counts as a border

Two countries border each other when **their main landmasses touch**. Exclaves,
enclaves and overseas territory are out, which is one rule with no special
cases: no Spain–Morocco (Ceuta and Melilla), no France–Brazil (French Guiana),
no Spain/UK–Gibraltar.

All 197 countries can be named. The 40 with no land borders — Japan, Iceland,
Australia and the rest — are in the data so the game can tell you *why* they
cannot be walked through. Britain and Ireland, and Haiti and the Dominican
Republic, are their own two-country islands, so they are never used as
endpoints.

## Layout

```
index.html            the page
data/countries.js     197 countries, their land borders, and name aliases
data/map.js           generated country outlines (do not edit by hand)
src/engine.js         game rules and the border graph - no DOM, runs in node
src/map.js            builds the SVG map, paints state, re-frames the view
src/app.js            DOM wiring: input, storage, sharing
src/styles.css        one stylesheet, light and dark
tools/test.js         test suite for the data and the engine
tools/build-map.js    regenerates data/map.js from Natural Earth
tools/bundle.js       inlines everything into dist/travle-overland.html
```

## Working on it

```sh
node tools/test.js      # 3231 checks: border data, name parsing, game rules, dailies
node tools/bundle.js    # rebuild the single-file version
```

The test suite checks every border is mutual, spot-checks well-known border
counts (China 14, Brazil 9, Portugal 1…), and plays whole rounds through the
engine — including winning across the Bering Strait, stepping back, and
running the counter down to nothing.

It finishes by fuzzing 2000 random rounds — real countries, neighbours, junk
input and undo — asserting the invariants that must hold at every moment: the
trail is always an unbroken chain of borders starting at the start, guesses
never exceed the budget, rejected input never costs anything or moves anyone,
and a lost round always has an empty counter behind it.

### Regenerating the map

`data/map.js` is generated, not written. The outlines come from Natural Earth
1:50m by way of the `world-atlas` package, projected with Equal Earth and
simplified to about 320 KB:

```sh
npm install world-atlas@2 topojson-client@3
node tools/build-map.js node_modules/world-atlas/countries-50m.json
```

Natural Earth is public domain. Countries too small to see at this scale get a
ring marker instead of a shape; Tuvalu has no outline at 1:50m, and no land
borders either, so it never appears on a route.

The simplification tolerance in `tools/build-map.js` and the zoom limit in
`src/map.js` are a pair: the outlines are kept fine enough to hold their shape
at the closest zoom the map allows. Loosening one means tightening the other.

## Design notes

Cool survey-paper greys with a deep teal ink. Teal marks everything you have
walked; a single rose is reserved for the Bering Strait, so the house rule
reads as the one wild card on the board. Type is Archivo used across its width
axis — expanded and heavy for the two place names — with IBM Plex Mono for
codes and counters. The map re-frames itself around your route, so a walk
across Europe is not shown at the same scale as one across Eurasia, and hands
control to you the moment you drag or zoom it.
