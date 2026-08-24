/*
 * Signing in and signing up.
 *
 * One form with two moods rather than two screens, because the only real
 * difference is whether the handle needs to be free. Anything already played
 * as a guest comes along: the session is the same, signing up just attaches a
 * name to it.
 */

import { api } from "../api.js";
import { refreshSession, afterSignin, go } from "../app.js";
import { h, swap } from "../ui.js";

export function render(mode = "signin") {
  const wrap = h("div.stack-lg");
  paint(wrap, mode);
  return wrap;
}

function paint(wrap, mode) {
  const isSignup = mode === "signup";

  const handle = h("input", {
    id: "handle",
    name: "username",
    autocomplete: "username",
    autocapitalize: "none",
    spellcheck: false,
    placeholder: "yourname",
    maxLength: 20,
  });

  const password = h("input", {
    id: "password",
    name: "password",
    type: "password",
    autocomplete: isSignup ? "new-password" : "current-password",
    placeholder: isSignup ? "at least 8 characters" : "your password",
  });

  const display = h("input", {
    id: "display",
    name: "nickname",
    autocomplete: "nickname",
    placeholder: "how friends see you",
    maxLength: 30,
  });

  const problem = h("p.small", { style: { color: "var(--off)", margin: 0, minHeight: "1.2em" }, role: "alert" });
  const submit = h("button.primary", { type: "submit" }, isSignup ? "Create account" : "Sign in");

  const form = h("form.stack", {
    onSubmit: async (event) => {
      event.preventDefault();
      problem.textContent = "";
      submit.disabled = true;
      submit.textContent = isSignup ? "Creating..." : "Signing in...";

      try {
        const body = { handle: handle.value.trim(), password: password.value };
        if (isSignup && display.value.trim()) body.display = display.value.trim();

        await (isSignup ? api.signup(body) : api.login(body));
        await refreshSession();
        afterSignin();
      } catch (err) {
        problem.textContent = err.message;
        submit.disabled = false;
        submit.textContent = isSignup ? "Create account" : "Sign in";
        password.focus();
        password.select();
      }
    },
  },
    h("label.field", { for: "handle" },
      h("span", {}, "Username"),
      handle,
      isSignup ? h("span.tiny.muted", {}, "Letters, numbers and underscores. This is what friends search for.") : null),

    h("label.field", { for: "password" },
      h("span", {}, "Password"),
      password),

    isSignup
      ? h("label.field", { for: "display" },
          h("span", {}, "Display name"),
          display,
          h("span.tiny.muted", {}, "Optional. Your username is used if you leave this blank."))
      : null,

    problem,
    submit);

  swap(wrap,
    h("div.card.stack",
      h("h1", {}, isSignup ? "Join the club" : "Welcome back"),
      h("p.muted.small", { style: { marginBottom: "4px" } },
        isSignup
          ? "An account keeps your streaks, lets you add friends and lets you build puzzles for them. Anything you have played already comes with you."
          : "Sign in to pick up your streaks and your friends."),
      form),

    h("div.centre.small.muted",
      isSignup ? "Already have an account? " : "New here? ",
      h("a", {
        href: isSignup ? "#/signin" : "#/signin/up",
        onClick: (event) => {
          /* Swap in place: the hash change would rebuild the same screen. */
          event.preventDefault();
          history.replaceState(null, "", isSignup ? "#/signin" : "#/signin/up");
          paint(wrap, isSignup ? "signin" : "signup");
        },
      }, isSignup ? "Sign in" : "Create one")),

    h("div.centre",
      h("button.ghost.small", { onClick: () => go("#/") }, "Keep playing as a guest")));

  handle.focus();
}
