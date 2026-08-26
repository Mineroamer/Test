/*
 * The shell: what is signed in, which screen is showing, and the theme.
 *
 * Routing is on the hash, so the whole app is one static page and a shared
 * puzzle link survives being pasted anywhere. Screens are loaded on demand -
 * the Travle map is a large thing to parse and nobody should pay for it while
 * they are playing Wordle.
 */

import { api, ApiError } from "./api.js";
import { h, swap, clear, icon, toast } from "./ui.js";

export const state = {
  user: null,
  day: 0,
  dayLabel: "",
  resetsIn: 0,
  catalogue: [],
  difficulties: {},
  progress: {},
  /* Level, XP and what is unlocked. Null for a guest, who has none of it. */
  pass: null,
};

const screen = document.getElementById("screen");
const accountButton = document.getElementById("account-button");
const themeButton = document.getElementById("theme-toggle");
const nav = document.getElementById("nav");

/* ---------------------------------------------------------------- theme */

const THEME_KEY = "pc:theme";

function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;

  const dark = choice === "dark" || (choice !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  swap(themeButton, icon(dark ? "sun" : "moon", 18));
  themeButton.title = dark ? "Switch to light" : "Switch to dark";
}

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; }
}

themeButton.addEventListener("click", () => {
  const now = readTheme();
  const next = now === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark")
    : now === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private browsing */ }
  applyTheme(next);
});

applyTheme(readTheme());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readTheme() === "system") applyTheme("system");
});

/* ------------------------------------------------------------- session */

export async function refreshSession() {
  const me = await api.me();
  Object.assign(state, me);
  paintAccount();
  return me;
}

function paintAccount() {
  if (state.user) {
    accountButton.textContent = state.user.display;
    accountButton.onclick = () => go("#/stats");
  } else {
    accountButton.textContent = "Sign in";
    accountButton.onclick = () => go("#/signin");
  }

  /* The sections only exist for someone signed in, so the bar stays empty
   * rather than offering links that would bounce them to the sign-in form. */
  /* Friends need accounts on a shared server. The single-page build has
   * neither, so the section is not offered there rather than offered and
   * then found empty. */
  const sections = state.local
    ? [["#/pass", "Pass"], ["#/achievements", "Awards"], ["#/board", "Board"], ["#/create", "Build"], ["#/stats", "Stats"]]
    : [["#/friends", "Friends"], ["#/pass", "Pass"], ["#/achievements", "Awards"],
       ["#/board", "Board"], ["#/create", "Build"], ["#/stats", "Stats"]];

  swap(nav, state.user
    ? sections.map(([href, label]) => h("a.btn.ghost.small", { href }, label))
    /* The board is the one section worth offering before signing up: it is
     * the thing an account gets you onto. */
    : [h("a.btn.ghost.small", { href: "#/board" }, "Board")]);

  paintLevel();
}

/*
 * The level pip in the header. It is the only place progress shows up while
 * you are playing, which is on purpose - a bar that fills in your peripheral
 * vision during a puzzle is a distraction from the puzzle.
 */
function paintLevel() {
  const slot = document.getElementById("level-pip");
  if (!slot) return;
  if (!state.user || !state.pass) { clear(slot); return; }

  const pass = state.pass;
  swap(slot, h("a.level-pip", {
    href: "#/pass",
    title: pass.maxed
      ? `Level ${pass.level} · the whole track is yours`
      : `Level ${pass.level} · ${pass.needs.toLocaleString()} XP to the next`,
  },
    h("b", {}, String(pass.level)),
    h("span.pip-bar", h("span.pip-fill", { style: { width: `${Math.round(pass.share * 100)}%` } }))));
}

/* Mark the section that is showing, so the bar says where you are. */
function paintNav() {
  const here = location.hash || "#/";
  for (const link of nav.querySelectorAll("a")) {
    const on = here.startsWith(link.getAttribute("href"));
    link.setAttribute("aria-current", on ? "page" : "false");
    link.style.color = on ? "var(--ink)" : "";
    link.style.background = on ? "var(--surface-sunk)" : "";
  }
}

/* ------------------------------------------------------------- routing */

export const go = (hash) => { window.location.hash = hash; };

/* Screens are ES modules, imported the first time they are needed. */
const SCREENS = {
  home: () => import("./screens/home.js"),
  signin: () => import("./screens/auth.js"),
  friends: () => import("./screens/friends.js"),
  stats: () => import("./screens/stats.js"),
  create: () => import("./screens/create.js"),
  play: () => import("./screens/play.js"),
  pass: () => import("./screens/pass.js"),
  board: () => import("./screens/board.js"),
  achievements: () => import("./screens/achievements.js"),
};

let token = 0;

async function route() {
  const mine = ++token;
  const path = (location.hash || "#/").replace(/^#\/?/, "");
  const parts = path.split("/").filter(Boolean);

  swap(screen, h("div.spinner", { role: "status", "aria-label": "Loading" }));
  screen.className = "";
  window.scrollTo(0, 0);
  paintNav();

  try {
    const view = await pick(parts);
    if (mine !== token) return;             // another route won the race
    swap(screen, view);
  } catch (err) {
    if (mine !== token) return;
    swap(screen, problem(err));
  }
}

async function pick(parts) {
  const [head, ...rest] = parts;

  switch (head) {
    case undefined:
    case "": {
      const mod = await SCREENS.home();
      return mod.render();
    }
    case "signin": {
      const mod = await SCREENS.signin();
      return mod.render(rest[0] === "up" ? "signup" : "signin");
    }
    case "friends": {
      if (state.local) return notFound();
      requireUser();
      const mod = await SCREENS.friends();
      return mod.render();
    }
    case "stats": {
      requireUser();
      const mod = await SCREENS.stats();
      return mod.render();
    }
    case "pass": {
      requireUser();
      const mod = await SCREENS.pass();
      return mod.render();
    }
    case "achievements": {
      requireUser();
      const mod = await SCREENS.achievements();
      return mod.render();
    }
    case "board": {
      /* Deliberately not behind requireUser: anyone may look at the standings,
       * they just cannot be on them without an account. */
      const mod = await SCREENS.board();
      return mod.render();
    }
    case "create": {
      requireUser();
      const mod = await SCREENS.create();
      return mod.render(rest[0] || null);
    }
    case "play": {
      const [game, mode] = rest;
      const mod = await SCREENS.play();
      return mod.render({ game, mode: mode || "daily" });
    }
    case "puzzle": {
      /* Left exactly as written: a shared code may be a short one the server
       * looks up, or a whole puzzle packed into base64, where case matters. */
      const mod = await SCREENS.play();
      return mod.render({ mode: "custom", code: String(rest[0] || "") });
    }
    default:
      return notFound();
  }
}

function requireUser() {
  if (!state.user) {
    /* Come back here once they are in. */
    const wanted = location.hash;
    sessionStorage.setItem("pc:after-signin", wanted);
    go("#/signin");
    throw new Redirect();
  }
}

class Redirect extends Error {}

export function afterSignin() {
  const wanted = sessionStorage.getItem("pc:after-signin");
  sessionStorage.removeItem("pc:after-signin");

  /*
   * Only redirect if they are still looking at the form.
   *
   * Signing in is a request over the network, and people do not wait politely
   * for it: they tap a game, or hit back. This used to fire regardless, so
   * anyone who moved during that second was hauled back to the home screen -
   * and, worse, whatever they had opened was left half-built with its keyboard
   * listener still on the document, so the next screen would not take input.
   * If they have already gone somewhere, that is where they want to be.
   */
  const here = location.hash || "#/";
  if (!here.startsWith("#/signin")) return;

  go(wanted && !wanted.startsWith("#/signin") ? wanted : "#/");
}

function problem(err) {
  if (err instanceof Redirect) return h("div");
  const message = err instanceof ApiError ? err.message : "Something went wrong.";
  return h("div.card.stack.centre",
    h("h2", {}, "That did not work"),
    h("p.muted", {}, message),
    h("div.row", { style: { justifyContent: "center" } },
      h("button", { onClick: () => route() }, "Try again"),
      h("a.btn.primary", { href: "#/" }, "Home")));
}

const notFound = () => h("div.card.stack.centre",
  h("h2", {}, "Nothing here"),
  h("p.muted", {}, "That link does not lead anywhere in the club."),
  h("a.btn.primary", { href: "#/", style: { justifySelf: "center" } }, "Back to the games"));

/* ---------------------------------------------------------------- boot */

window.addEventListener("hashchange", route);

(async function boot() {
  try {
    await refreshSession();
  } catch {
    swap(screen, h("div.card.stack.centre",
      h("h2", {}, "Cannot reach the server"),
      h("p.muted", {}, "Puzzle Club is not answering. If you are running it yourself, check that `node server.js` is still going."),
      h("button.primary", { onClick: () => location.reload(), style: { justifySelf: "center" } }, "Reload")));
    return;
  }
  route();
})();

/* Screens use these to talk back to the shell. */
export { screen, paintAccount, paintLevel, toast, clear };
