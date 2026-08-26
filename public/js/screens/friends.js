/*
 * Friends, and the duels between them.
 *
 * Three tabs, because three different questions bring people here: who is in
 * my club, what am I supposed to be playing, and who is winning. Each is a
 * hash of its own - #/friends/duels is a link somebody can be sent to, and it
 * is where the play screen sends you back to when a duel ends.
 *
 * Adding somebody is one field: their username. Requests go both ways, and
 * asking someone who already asked you simply accepts, so two people who add
 * each other at the same time end up friends rather than stuck.
 */

import { api } from "../api.js";
import { state, go, refreshSession } from "../app.js";
import { h, swap, avatar, sheet, plural, ago, duration, countdown } from "../ui.js";

const TABS = [
  ["", "Friends"],
  ["duels", "Duels"],
  ["standings", "Standings"],
];

export async function render(tab = "") {
  const wrap = h("div.stack-lg");
  await paint(wrap, TABS.some(([key]) => key === tab) ? tab : "");
  return wrap;
}

async function paint(wrap, tab) {
  const [data, board, duels] = await Promise.all([
    api.friends(),
    api.friendsBoard().catch(() => ({ rows: [], you: null })),
    api.challenges().catch(() => ({ challenges: [] })),
  ]);

  /*
   * Opening the duels tab is reading the results on it, so they are marked
   * read here. Otherwise the badge would keep counting a duel the player is
   * looking at, and the only way to clear it would be to replay the round.
   */
  const unread = tab === "duels"
    ? duels.challenges.filter((one) => one.settled && !one.seen)
    : [];
  const marked = Promise.all(unread.map((one) => api.challengeSeen(one.id).catch(() => {})));

  /* The header badge counts the same things this screen is about to show, so
   * it is refreshed from the same visit rather than left a step behind - and
   * after anything just marked read, or it would count those too. */
  marked.then(() => refreshSession()).catch(() => { /* the screen is drawn either way */ });

  /* Repaint in place, or hand it to the router if the tab is changing - the
   * router will build the screen again from scratch. */
  const reload = (next = tab) => {
    if (next !== tab) { go(next ? `#/friends/${next}` : "#/friends"); return Promise.resolve(); }
    return paint(wrap, tab);
  };
  const sorted = sortDuels(duels.challenges);

  swap(wrap,
    h("div.spread",
      h("div", {},
        h("h1", {}, "Friends"),
        h("p.small.muted", { style: { margin: "2px 0 0" } },
          `You are @${state.user.handle} — that is what people need to add you.`)),
      h("button.primary.small", { onClick: () => add(reload) }, "Add a friend")),

    /* A request is somebody standing at the door, so it goes above the tabs
     * rather than inside one of them. */
    data.incoming.length ? requestsCard(data.incoming, reload) : null,

    tabs(tab, { duels: sorted.yours.length, standings: 0 }),

    tab === "duels" ? duelsTab(sorted, data.friends, reload)
      : tab === "standings" ? standingsTab(board, data.friends)
      : friendsTab(data, sorted, reload),

    data.outgoing.length && tab === "" ? outgoingCard(data.outgoing) : null);
}

/* ------------------------------------------------------------- the tabs */

/*
 * Links, not buttons. The tab is part of the address, so the router is what
 * changes it - which means the back button works, and a tab cannot be painted
 * into a screen the router has already replaced.
 */
const tabs = (here, counts) => h("div.tabs.seg", { role: "tablist" },
  TABS.map(([key, label]) => h("a.seg-btn", {
    role: "tab",
    href: key ? `#/friends/${key}` : "#/friends",
    "aria-selected": String(key === here),
    class: key === here ? "on" : "",
  },
    label,
    counts[key] ? h("span.badge", {}, String(counts[key])) : null)));

/* --------------------------------------------------------- the requests */

const requestsCard = (incoming, reload) => h("section.card.stack.knocking",
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

/* ------------------------------------------------------------- friends */

function friendsTab(data, duels, reload) {
  if (!data.friends.length) {
    return h("section.card.empty",
      h("p", {}, "No friends yet."),
      h("p.small", {}, "Add someone by their username. You will see how they are"
        + " doing on today's puzzles, and you can challenge them to a race."));
  }

  return h("div.stack",
    duels.yours.length ? h("p.small.muted", { style: { margin: 0 } },
      `${plural(duels.yours.length, "challenge")} waiting for you — `,
      h("a", { href: "#/friends/duels" }, "go and play")) : null,

    h("section.card.stack",
      h("h2", {}, plural(data.friends.length, "friend")),
      h("div.stack",
        data.friends.map((friend) => friendRow(friend, reload)))));
}

function friendRow(friend, reload) {
  const record = friend.standing || { wins: 0, losses: 0, draws: 0, played: 0 };
  const open = (friend.duels || []).filter((one) => !one.settled);
  const yours = open.filter((one) => one.open);

  return h("div.person.friend-row",
    avatar(friend, 40),
    h("div", {},
      h("div.row", { style: { gap: "6px", alignItems: "baseline" } },
        h("span", { style: { fontWeight: "600" } }, friend.display),
        h("span.tiny.muted", {}, `@${friend.handle}`),
        friend.level ? h("span.pill.tiny", {}, `Lv ${friend.level}`) : null),

      h("div.tiny.muted", {},
        `${plural(friend.totals.played, "round")} · ${friend.totals.currentStreak} streak`,
        record.played
          ? ` · duels ${record.wins}–${record.losses}${record.draws ? `–${record.draws}` : ""}`
          : " · never duelled"),

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
        })),

      yours.length ? h("div.tiny.warn", { style: { marginTop: "4px" } },
        `${plural(yours.length, "duel")} waiting on you`) : null),

    h("div.row", { style: { gap: "6px" } },
      h("button.primary.small", {
        onClick: () => challenge(friend, reload),
      }, "Challenge"),
      h("button.ghost.small.icon", {
        onClick: () => confirmRemove(friend, reload),
        "aria-label": `Remove ${friend.display}`,
        title: `Remove ${friend.display}`,
      }, "×")));
}

function confirmRemove(friend, reload) {
  sheet(`Remove ${friend.display}?`, (body, close) => {
    body.append(
      h("p.muted", {}, "You will stop seeing each other's puzzles and standings,"
        + " and any duel still going between you is called off. You can add them again later."),
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
        await api.addFriend(handle);
        close();
        reload();
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

/* --------------------------------------------------------------- duels */

/*
 * Three piles, in the order they need attention: yours to play, theirs to
 * play, and over. A duel you have not opened is the only one that can go
 * stale, so it sorts by how long it has left rather than how old it is.
 */
function sortDuels(all) {
  const live = all.filter((one) => !one.declined);
  return {
    yours: live.filter((one) => one.open && !one.settled)
      .sort((a, b) => a.expiresAt - b.expiresAt),
    theirs: live.filter((one) => !one.open && !one.settled)
      .sort((a, b) => b.createdAt - a.createdAt),
    done: live.filter((one) => one.settled)
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

function duelsTab(duels, friends, reload) {
  if (!duels.yours.length && !duels.theirs.length && !duels.done.length) {
    return h("section.card.empty",
      h("p", {}, "No duels yet."),
      h("p.small", {}, "A duel deals the same puzzle to both of you. Whoever"
        + " finishes it faster wins — and not finishing loses, however quick you were about it."),
      friends.length
        ? h("button.primary", { style: { justifySelf: "center" }, onClick: () => challenge(friends[0], reload) },
            `Challenge ${friends[0].display}`)
        : h("p.small.muted", {}, "Add a friend first."));
  }

  return h("div.stack-lg",
    duels.yours.length ? h("section.card.stack.knocking",
      h("h2", {}, "Your turn"),
      h("div.stack", duels.yours.map((one) => duelRow(one, reload, "play")))) : null,

    duels.theirs.length ? h("section.card.stack",
      h("h2", {}, "Waiting on them"),
      h("div.stack", duels.theirs.map((one) => duelRow(one, reload, "wait")))) : null,

    duels.done.length ? h("section.card.stack",
      h("h2", {}, "Finished"),
      h("div.stack", duels.done.slice(0, 25).map((one) => duelRow(one, reload, "done")))) : null,

    h("p.tiny.muted", { style: { margin: 0 } },
      "A challenge runs out after two days. The clock on it starts when you open"
      + " the puzzle, not when it was sent — so being asleep costs you nothing."));
}

const OUTCOME = {
  won: { label: "Won", tone: "win" },
  lost: { label: "Lost", tone: "loss" },
  drew: { label: "Drew", tone: "" },
  missed: { label: "Missed", tone: "loss" },
};

function duelRow(one, reload, kind) {
  const who = one.opponent || { display: "Someone", handle: "gone" };
  const result = one.outcome ? OUTCOME[one.outcome] : null;

  return h("div.person.duel-row", { class: result ? result.tone : "" },
    avatar(who, 36),
    h("div", {},
      h("div.row", { style: { gap: "6px", alignItems: "baseline" } },
        h("span", { style: { fontWeight: "600" } }, one.gameName),
        h("span.tiny.muted", {},
          one.yours ? `you challenged ${who.display}` : `${who.display} challenged you`)),

      h("div.tiny.muted", {}, duelLine(one, kind)),

      /* The one number that matters while you can still do something about it. */
      kind === "play" && one.theirs
        ? h("div.small.beat", {}, `Beat ${duration(one.theirs.took)}`)
        : null),

    kind === "play"
      ? h("div.row", { style: { gap: "6px" } },
          h("a.btn.primary.small", {
            href: `#/play/${one.game}/challenge/${one.id}`,
          }, "Play"),
          h("button.ghost.small.icon", {
            onClick: async () => {
              await api.declineChallenge(one.id);
              reload("duels");
            },
            "aria-label": "Turn it down",
            title: "Turn it down",
          }, "×"))
      : result
        ? h("span.pill", { class: result.tone }, result.label)
        : h("span.pill", {}, "Sent"));
}

/** The line under a duel: what happened, or what is still to happen. */
function duelLine(one, kind) {
  if (kind === "play") {
    const left = one.expiresAt - Date.now();
    return left > 0
      ? `${countdown(left)} left${one.theirs ? "" : " · they have not played it yet"}`
      : "out of time";
  }
  if (kind === "wait") {
    return one.mine
      ? `You took ${duration(one.mine.took)}${one.mine.won ? "" : " and did not solve it"}`
      : "not started";
  }

  /* Finished. Both times, in the order they finished in - which is the whole
   * story of the duel in one line. */
  const mine = one.mine ? `${one.mine.won ? duration(one.mine.took) : "no solve"}` : "no show";
  const theirs = one.theirs ? `${one.theirs.won ? duration(one.theirs.took) : "no solve"}` : "no show";
  const xp = one.earned && one.earned.xp ? ` · +${one.earned.xp} XP` : "";
  return `You ${mine} · them ${theirs}${one.expired ? " · ran out of time" : ""}${xp}`;
}

/* ------------------------------------------------------- the challenge */

function challenge(friend, reload) {
  sheet(`Challenge ${friend.display}`, (body, close) => {
    const note = h("p.small.muted", { style: { margin: 0, minHeight: "1.2em" }, role: "status" },
      "You both get the same puzzle. Fastest solve wins.");
    let chosen = state.catalogue[0].key;
    let difficulty = "standard";

    const level = h("div.row.row-wrap.difficulty", { hidden: true },
      Object.keys(state.difficulties || {}).map((key) => h("button.small", {
        class: key === difficulty ? "on" : "",
        onClick: (event) => {
          difficulty = key;
          for (const b of level.children) b.classList.toggle("on", b === event.currentTarget);
        },
      }, state.difficulties[key].label || key)));

    const grid = h("div.pick-grid",
      state.catalogue.map((game) => h("button.pick", {
        class: game.key === chosen ? "on" : "",
        onClick: (event) => {
          chosen = game.key;
          for (const b of grid.children) b.classList.toggle("on", b === event.currentTarget);
          level.hidden = chosen !== "travle";
        },
      },
        h("b", {}, game.name),
        h("span.tiny.muted", {}, game.blurb || ""))));

    const send = h("button.primary", {}, "Send the challenge");
    send.onclick = async () => {
      send.disabled = true;
      try {
        await api.challenge({
          handle: friend.handle,
          game: chosen,
          difficulty: chosen === "travle" ? difficulty : undefined,
        });
        close();
        reload("duels");
      } catch (err) {
        note.textContent = err.message;
        note.style.color = "var(--off)";
        send.disabled = false;
      }
    };

    body.append(
      h("p.small.muted", { style: { margin: 0 } },
        "Pick a puzzle. It is dealt to both of you, and the clock starts when"
        + " each of you opens it — so there is no advantage in getting there first."),
      grid, level, note, send);
  });
}

/* ------------------------------------------------------- the standings */

function standingsTab(board, friends) {
  const duelled = friends.filter((one) => one.standing && one.standing.played)
    .sort((a, b) => b.standing.wins - a.standing.wins || a.standing.losses - b.standing.losses);

  return h("div.stack-lg",
    board.rows.length ? boardCard(board) : null,

    duelled.length ? h("section.card.stack",
      h("div.spread",
        h("h2", {}, "Head to head"),
        h("span.label", {}, "duels")),
      h("div.stack", { style: { gap: "8px" } },
        duelled.map((friend) => h("div.person",
          avatar(friend, 32),
          h("div", {},
            h("div", {}, friend.display),
            h("div.tiny.muted", {}, plural(friend.standing.played, "duel"))),
          h("span.mono", { class: friend.standing.wins > friend.standing.losses ? "win" : friend.standing.wins < friend.standing.losses ? "loss" : "" },
            `${friend.standing.wins}–${friend.standing.losses}${friend.standing.draws ? `–${friend.standing.draws}` : ""}`))))) : null,

    !board.rows.length && !duelled.length
      ? h("section.card.empty", h("p", {}, "Nothing to compare yet."))
      : null);
}

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
