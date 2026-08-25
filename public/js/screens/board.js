/*
 * The universal leaderboard.
 *
 * Everyone with an account is on it, friends or not. You do not need to be
 * signed in to look - a standings board only members can see is a poster in a
 * locked room - but you do need an account to be on it, because a guest's
 * rounds are not written down anywhere.
 *
 * Two views. All time ranks on total XP, which is the honest measure of a long
 * player. This week ranks on the last seven days, which is the one somebody
 * who joined on Tuesday can actually win.
 */

import { api } from "../api.js";
import { state, go } from "../app.js";
import { h, swap, sheet, avatar, plural } from "../ui.js";
import { characterSvg } from "../character.js";

export async function render() {
  let span = "all";
  const list = h("div.stack", { style: { gap: "8px" } });
  const tabs = h("div.difficulty", { role: "group", "aria-label": "Which board" });
  const foot = h("div");

  const el = h("div.stack-lg",
    h("div.stack", { style: { gap: "4px" } },
      h("h1", {}, "The board"),
      h("p.muted", {}, "Everyone who plays, ranked by how well they play.")),
    tabs,
    list,
    foot);

  paintTabs();
  await load();
  return el;

  function paintTabs() {
    swap(tabs, ...[["all", "All time"], ["week", "This week"]].map(([key, label]) =>
      h("button", {
        class: span === key ? "on" : "",
        "aria-pressed": String(span === key),
        onClick: async () => { if (span === key) return; span = key; paintTabs(); await load(); },
      }, label)));
  }

  async function load() {
    swap(list, h("div.spinner", { role: "status", "aria-label": "Loading" }));
    let data;
    try {
      data = await api.board(span);
    } catch (err) {
      swap(list, h("p.muted", {}, err.message || "The board is not answering."));
      return;
    }

    if (!data.rows.length) {
      swap(list, h("div.card.stack.centre",
        h("h2", {}, "Nobody yet"),
        h("p.muted", {}, span === "week"
          ? "No rounds finished in the last seven days. Be the first."
          : "The board fills up as people finish rounds."),
        state.user ? null : h("a.btn.primary", { href: "#/signin/up", style: { justifySelf: "center" } }, "Make an account")));
      swap(foot);
      return;
    }

    swap(list, ...data.rows.map((row) => rowFor(row, span)),
      data.you ? h("div.board-gap", "…") : null,
      data.you ? rowFor(data.you, span) : null);

    swap(foot,
      /* `alone` is the single-page build saying it has no other players to
       * rank against. Better to say so than to show a board of one and let
       * somebody wonder where everybody went. */
      data.alone
        ? h("p.muted.small", {}, "This is the single-page version, so the only record it has is the one on this device. The club's real board lives on the hosted version, where everyone playing is on the same one.")
        : h("p.muted.small", {}, `${plural(data.total, "player")} on the board.`),
      state.user || data.alone ? null : h("div.card.stack.centre",
        h("p", {}, "Signed-in rounds are the ones that count. XP, your level and everything on the pass need an account."),
        h("a.btn.primary", { href: "#/signin/up", style: { justifySelf: "center" } }, "Make an account")));
  }

  function rowFor(row, which) {
    const you = state.user && state.user.id === row.id;
    const score = which === "week" ? row.week : row.xp;

    return h("div.board-row", {
      class: you ? "you" : "",
      "data-medal": row.rank <= 3 ? String(row.rank) : "",
      onClick: () => card(row),
      role: "button",
      tabIndex: 0,
      onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card(row); } },
    },
      h("span.board-rank", {}, String(row.rank)),
      avatar(row, 40),
      h("div.stack", { style: { gap: "1px", minWidth: 0 } },
        h("strong.board-name", {}, row.display),
        h("span.muted.small", {}, row.title ? `${row.title} · level ${row.level}` : `Level ${row.level}`)),
      h("div.board-score",
        h("b", {}, score.toLocaleString()),
        h("span.label", {}, which === "week" ? "XP this week" : "XP")));
  }
}

/** Somebody's card: who they are, what they wear, and how they have done. */
function card(row) {
  sheet(row.display, (body) => {
    const inner = h("div.stack.centre",
      h("div.pass-portrait", characterSvg(row.character, 128)),
      h("h2", {}, row.display),
      h("p.muted", {}, `@${row.handle}`),
      h("div.stat-grid",
        stat(row.level, "level"),
        stat(row.xp.toLocaleString(), "XP"),
        stat("#" + row.rank, "on the board")),
      h("p.muted.small", {}, "Loading their record…"));
    body.append(inner);

    api.player(row.handle).then((data) => {
      swap(inner,
        h("div.pass-portrait", characterSvg(data.player.character, 128)),
        h("h2", {}, data.player.display),
        h("p.muted", {}, data.player.title ? `${data.player.title} · @${data.player.handle}` : `@${data.player.handle}`),
        h("div.stat-grid",
          stat(data.player.level, "level"),
          stat(data.player.xp.toLocaleString(), "XP"),
          stat(data.played, "played"),
          stat(data.won, "solved"),
          stat(data.bestStreak, "best streak")));
    }).catch(() => { /* the row already showed everything essential */ });
  });
}

const stat = (value, label) => h("div.stat", h("b", {}, String(value)), h("span.label", {}, label));
