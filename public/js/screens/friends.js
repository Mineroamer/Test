/*
 * Friends.
 *
 * Adding someone is one field: their username. Requests go both ways and
 * asking someone who already asked you simply accepts, so two people who add
 * each other at the same time end up friends rather than stuck.
 */

import { api } from "../api.js";
import { state } from "../app.js";
import { h, swap, avatar, sheet, plural, ago } from "../ui.js";

export async function render() {
  const wrap = h("div.stack-lg");
  await paint(wrap);
  return wrap;
}

async function paint(wrap) {
  const [data, board] = await Promise.all([
    api.friends(),
    api.friendsBoard().catch(() => ({ rows: [], you: null })),
  ]);
  const reload = () => paint(wrap);

  swap(wrap,
    h("div.spread",
      h("h1", {}, "Friends"),
      h("button.primary.small", { onClick: () => add(reload) }, "Add a friend")),

    data.incoming.length ? requestsCard(data.incoming, reload) : null,
    board.rows.length > 1 ? boardCard(board) : null,
    listCard(data.friends, reload),
    data.outgoing.length ? outgoingCard(data.outgoing) : null,
    data.feed.length ? feedCard(data.feed) : null);
}

/* ----------------------------------------------------------- requests */

const requestsCard = (incoming, reload) => h("section.card.stack",
  h("h2", {}, plural(incoming.length, "friend request")),
  h("div.stack",
    incoming.map((request) => h("div.person",
      avatar(request.from),
      h("div", {},
        h("div", { style: { fontWeight: "600" } }, request.from.display),
        h("div.tiny.muted", {}, `@${request.from.handle} · ${ago(request.at)}`)),
      h("div.row",
        h("button.primary.small", {
          onClick: async () => { await api.respond(request.id, true); reload(); },
        }, "Accept"),
        h("button.ghost.small", {
          onClick: async () => { await api.respond(request.id, false); reload(); },
        }, "No"))))));

const outgoingCard = (outgoing) => h("section.card.stack",
  h("span.label", {}, "Waiting on"),
  h("div.stack", { style: { gap: "6px" } },
    outgoing.map((request) => h("div.small.muted", {},
      `${request.to.display} (@${request.to.handle}) — asked ${ago(request.at)}`))));

/* --------------------------------------------------------- the people */

function listCard(friends, reload) {
  if (!friends.length) {
    return h("section.card.empty",
      h("p", {}, "No friends yet."),
      h("p.small", {}, "Add someone by their username, and you will see how they are doing on today's puzzles."));
  }

  return h("section.card.stack",
    h("h2", {}, plural(friends.length, "friend")),
    h("div.stack",
      friends.map((friend) => h("div.person",
        avatar(friend),
        h("div", {},
          h("div", { style: { fontWeight: "600" } }, friend.display),
          h("div.tiny.muted", {},
            `@${friend.handle} · ${plural(friend.totals.played, "round")} · ${friend.totals.currentStreak} streak`),
          h("div.row.row-wrap", { style: { gap: "4px", marginTop: "4px" } },
            state.catalogue.map((game) => {
              const done = friend.today[game.key];
              return h("span.pill.tiny", {
                class: done ? (done.won ? "win" : "loss") : "",
                title: done
                  ? `${game.name}: ${done.won ? "solved" : "not solved"} in ${plural(done.guesses, "guess", "guesses")}`
                  : `${game.name}: not played today`,
                style: done ? null : { opacity: "0.4" },
              }, game.name.split(" ")[0]);
            }))),
        h("button.ghost.small", {
          onClick: () => confirmRemove(friend, reload),
          "aria-label": `Remove ${friend.display}`,
        }, "×")))));
}

function confirmRemove(friend, reload) {
  sheet(`Remove ${friend.display}?`, (body, close) => {
    body.append(
      h("p.muted", {}, "You will stop seeing each other's puzzles and standings. You can add them again later."),
      h("div.row",
        h("button.grow", { onClick: close }, "Keep"),
        h("button.primary.grow", {
          onClick: async () => { await api.unfriend(friend.id); close(); reload(); },
        }, "Remove")));
  });
}

function add(reload) {
  sheet("Add a friend", (body, close) => {
    const input = h("input", {
      placeholder: "their username",
      autocapitalize: "none",
      spellcheck: false,
      maxLength: 20,
    });
    const note = h("p.small.muted", { style: { margin: 0, minHeight: "1.2em" }, role: "status" },
      "They will get a request to accept.");
    const button = h("button.primary", {}, "Send request");

    const send = async () => {
      const handle = input.value.trim();
      if (!handle) return;
      button.disabled = true;

      try {
        const answer = await api.addFriend(handle);
        close();
        reload();
        if (answer.friended) { /* they had already asked, so this was a yes */ }
      } catch (err) {
        note.textContent = err.message;
        note.style.color = "var(--off)";
        button.disabled = false;
      }
    };

    button.onclick = send;
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") send(); });
    body.append(
      h("label.field", h("span", {}, "Username"), input),
      note,
      button,
      h("p.tiny.muted", { style: { margin: 0 } },
        `Yours is @${state.user.handle} — that is what they will need.`));
  });
}

/* ------------------------------------------------------- the standings */

function boardCard(board) {
  return h("section.card.stack",
    h("div.spread",
      h("h2", {}, "Standings"),
      h("span.label", {}, "daily puzzles")),
    h("div.stack", { style: { gap: "8px" } },
      board.rows.map((row, index) => h("div.person", {
        style: row.user.id === board.you ? { fontWeight: "700" } : null,
      },
        h("span.mono.muted", { style: { textAlign: "center" } }, index + 1),
        h("div", {},
          h("div", {}, row.user.display, row.user.id === board.you ? h("span.muted", {}, " (you)") : null),
          h("div.tiny.muted", {},
            `${plural(row.wins, "win")} of ${row.played} · ${plural(row.hints, "hint")} · ${row.todayWon}/${row.todayDone} today`)),
        h("span.pill", { class: row.streak > 0 ? "on" : "" }, `${row.streak}`)))),
    h("p.tiny.muted", { style: { margin: 0 } },
      "Ranked on daily wins, then streak, then fewest hints. Unlimited rounds are not counted — they would only measure spare time."));
}

/* -------------------------------------------------------------- feed */

const feedCard = (feed) => h("section.card.stack",
  h("h2", {}, "Lately"),
  h("div.stack", { style: { gap: "6px" } },
    feed.slice(0, 14).map((entry) => h("div.spread",
      h("span.small", {},
        h("b", {}, entry.who ? entry.who.display : "Someone"),
        entry.won ? " solved " : " played ",
        entry.gameName,
        entry.mode === "daily" ? "" : h("span.muted", {}, ` (${entry.mode})`)),
      h("span.tiny.muted", {},
        `${plural(entry.guesses, "guess", "guesses")} · ${ago(entry.at)}`)))));
