/*
 * The block of squares you paste to a friend.
 *
 * Every game reduces to the same idea: one emoji per outcome, laid out the way
 * the board was, saying how it went without saying what the answer was. The
 * one rule these all obey is that nothing here can be read backwards into the
 * solution.
 */

const SQUARE = {
  hit: "\u{1F7E9}", near: "\u{1F7E8}", miss: "\u{2B1C}",
  closer: "\u{1F7E9}", sideways: "\u{1F7E8}", away: "\u{1F7E7}", back: "\u{1F502}", travleMiss: "\u{2B1C}",
  level: ["\u{1F7E8}", "\u{1F7E9}", "\u{1F7E6}", "\u{1F7EA}"],
};

export function shareText(run, origin = location.origin) {
  const { summary, puzzle } = run;
  if (!summary) return "";

  const title = run.mode === "daily"
    ? `Puzzle Club ${run.gameName} · ${run.dayLabel}`
    : run.mode === "custom"
      ? `Puzzle Club ${run.gameName} · "${run.custom ? run.custom.title : "shared"}"`
      : `Puzzle Club ${run.gameName} · unlimited`;

  const lines = [title, scoreLine(run), "", ...grid(run), ""];

  if (run.mode === "custom" && run.custom) lines.push(`${origin}/#/puzzle/${run.custom.code}`);
  else lines.push(origin);

  return lines.filter((line) => line !== undefined).join("\n").trim();
}

function scoreLine(run) {
  const s = run.summary;
  const hints = s.hints ? ` · ${s.hints} hint${s.hints === 1 ? "" : "s"}` : "";

  switch (run.game) {
    case "wordle":
      return `${s.won ? s.guesses : "X"}/${run.puzzle.tries}${hints}`;
    case "connections":
      return `${s.won ? "Solved" : "Beaten"} with ${s.mistakes}/4 mistakes${hints}`;
    case "bee":
      return `${s.score}/${s.maxScore} · ${s.rank} · ${s.guesses} words${hints}`;
    case "boxed":
      return `${s.won ? `Solved in ${s.guesses}` : "Not solved"}${hints}`;
    case "travle":
      return `${s.won ? `${s.guesses} moves, par ${s.par}` : "Did not arrive"}${hints}`;
    default:
      return s.won ? "Solved" : "Not solved";
  }
}

function grid(run) {
  const s = run.summary;

  switch (run.game) {
    case "wordle":
      return s.grid.map((row) => row.map((mark) => SQUARE[mark]).join(""));

    case "connections":
      return s.grid.map((row) => row.map((level) => SQUARE.level[level]).join(""));

    case "travle":
      /* One square per move, wrapped so a long walk stays a tidy block. */
      return chunk(s.grid.map((move) => SQUARE[move] || SQUARE.travleMiss).join(""), 10);

    case "boxed":
      /* Word lengths, not the words. */
      return [s.words.map((w) => "\u{1F7E9}".repeat(Math.min(w.length, 12))).join("\n")];

    case "bee": {
      const filled = Math.round((s.score / Math.max(1, s.maxScore)) * 10);
      return ["\u{1F7E8}".repeat(filled) + "\u{2B1C}".repeat(Math.max(0, 10 - filled))];
    }
    default:
      return [];
  }
}

function chunk(text, size) {
  const out = [];
  const glyphs = [...text];
  for (let i = 0; i < glyphs.length; i += size) out.push(glyphs.slice(i, i + size).join(""));
  return out;
}
