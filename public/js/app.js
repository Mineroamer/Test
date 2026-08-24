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
  swap(nav, state.user
    ? [["#/friends", "Friends"], ["#/create", "Build"], ["#/stats", "Stats"]]
        .map(([href, label]) => h("a.btn.ghost.small", { href }, label))
    : []);
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
      requireUser();
      const mod = await SCREENS.friends();
      return mod.render();
    }
    case "stats": {
      requireUser();
      const mod = await SCREENS.stats();
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
      const mod = await SCREENS.play();
      return mod.render({ mode: "custom", code: String(rest[0] || "").toUpperCase() });
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
  go(wanted && wanted !== "#/signin" ? wanted : "#/");
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
export { screen, paintAccount, toast, clear };
