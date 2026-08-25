/*
 * DOM helpers.
 *
 * `h` builds elements, and screens return elements rather than HTML strings -
 * so nothing anyone types (a display name, a puzzle title, a group clue) is
 * ever parsed as markup. Text goes in as text, always.
 */

import { portrait } from "./character.js";

/*
 * A plain object in the second position is properties; anything else - an
 * array, a node, a string - is the first child. Without that, `h("div", list)`
 * would quietly try to set the array's indices as attributes, which is a trap
 * worth closing once here rather than remembering at every call site.
 */
const isProps = (value) =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && !(value instanceof Node);

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");

  if (!isProps(props)) {
    if (props !== undefined) children.unshift(props);
    props = null;
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") el.className = [el.className, value].filter(Boolean).join(" ");
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;      // only ever given literals from this codebase
    else if (key === "style" && typeof value === "object") style(el, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== "list" && typeof value !== "object") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }

  add(el, children);
  return el;
}

/*
 * Custom properties have to go through setProperty - assigning them as plain
 * style keys silently does nothing, which is how every per-game accent came
 * out the same colour the first time.
 */
function style(el, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith("--")) el.style.setProperty(key, value);
    else el.style[key] = value;
  }
}

function add(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) add(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  add(f, children);
  return f;
};

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function swap(el, ...children) {
  clear(el);
  add(el, children);
  return el;
}

/* --------------------------------------------------------------- icons */

/* Drawn rather than fetched: five small line marks, one per game. */
const ICONS = {
  wordle: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity=".35"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  connections: '<circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="7" r="3.2"/><circle cx="7" cy="17" r="3.2"/><circle cx="17" cy="17" r="3.2"/><path d="M10.2 7h3.6M7 10.2v3.6"/>',
  bee: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 8.5v7M8.5 10.2l7 3.6M15.5 10.2l-7 3.6"/>',
  boxed: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="4" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="20" r="1.4" fill="currentColor" stroke="none"/><path d="M9 4l6 16"/>',
  travle: '<path d="M4 18l5-9 5 5 6-8"/><circle cx="4" cy="18" r="2.2" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="2.2" fill="currentColor" stroke="none"/>',
  crossword: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" opacity=".35"/>',
  mini: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" opacity=".35"/>',
  strands: '<circle cx="6" cy="6" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="1.8" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="1.8" fill="currentColor" stroke="none"/><circle cx="7" cy="15" r="1.8" fill="currentColor" stroke="none"/><circle cx="14" cy="18" r="1.8" fill="currentColor" stroke="none"/><path d="M6 6l6 3 6-3M7 15l7 3"/>',
  pips: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M12 7v10"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="13.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  friends: '<circle cx="9" cy="8" r="3.4"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3.4 3.4 0 0 1 0 6.6M17.5 19a5.5 5.5 0 0 0-2-4.2"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  build: '<path d="M4 20l4-1 9.5-9.5a2.1 2.1 0 0 0-3-3L5 16z"/><path d="M14.5 5.5l4 4"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
};

export function icon(name, size = 24) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || ICONS.wordle;
  return svg;
}

/* -------------------------------------------------------------- people */

/*
 * Somebody beside their name. Everyone with an account has a character now, so
 * this hands off to the wardrobe; the initials underneath are still what a
 * guest gets, and what the author of a puzzle shared before any of this
 * existed gets.
 */
export function avatar(person, size = 36, options) {
  return portrait(person, size, options);
}

/* ------------------------------------------------------------ messages */

let toastTimer = null;

/** A short line above the board. Games use it for every rejection. */
export function toast(slot, message, tone = "") {
  if (!slot) return;
  clearTimeout(toastTimer);
  swap(slot, h("div.toast", { class: tone, role: "status" }, message));
  toastTimer = setTimeout(() => clear(slot), tone === "good" ? 2600 : 2000);
}

/* A slide-up panel for anything that would otherwise need a second screen. */
export function sheet(title, build) {
  const body = h("div.stack");
  const panel = h("div.sheet", { role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div.spread", { style: { marginBottom: "12px" } },
      h("h2", {}, title),
      h("button.ghost.icon", { onClick: close, "aria-label": "Close" }, "×")),
    body);

  const back = h("div.sheet-back", {
    onClick: (event) => { if (event.target === back) close(); },
  }, panel);

  function close() {
    back.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", close);
  }
  function onKey(event) {
    if (event.key === "Escape") close();
  }

  document.addEventListener("keydown", onKey);
  /* Going somewhere else closes the panel. Without this a sheet left open -
   * by the back button, or by a link inside it - would leave its backdrop
   * over the whole page, swallowing every click on the screen underneath. */
  window.addEventListener("hashchange", close);
  document.body.append(back);
  build(body, close);

  const focusable = panel.querySelector("input, button.primary, select, textarea");
  if (focusable) focusable.focus();
  return close;
}

/** Copy, and say whether it worked - clipboard access is not a given. */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Fall back to a selection, which works where the clipboard API is blocked. */
    const area = h("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/* ---------------------------------------------------------- formatting */

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

export function duration(ms) {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${total % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function countdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h2 = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h2}:${m}:${s}`;
}

export function ago(at) {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export const percent = (share) => `${Math.round((share || 0) * 100)}%`;
