/*
 * Talking to the server.
 *
 * Every call goes through here so that one place knows what a failure looks
 * like: the server answers errors as { error: "a sentence a person can read" },
 * and that sentence is what gets thrown, ready to show as-is.
 */

export class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }

  if (!res.ok) {
    const message = payload && payload.error ? payload.error : `Something went wrong (${res.status}).`;
    throw new ApiError(res.status, message, payload || {});
  }
  if (payload === null) throw new ApiError(res.status, "The server sent something unreadable.");
  return payload;
}

export const api = {
  me: () => call("GET", "/api/me"),
  signup: (body) => call("POST", "/api/auth/signup", body),
  login: (body) => call("POST", "/api/auth/login", body),
  logout: () => call("POST", "/api/auth/logout", {}),
  rename: (display) => call("PATCH", "/api/me", { display }),

  play: (game, body) => call("POST", `/api/play/${game}`, body),
  run: (id) => call("GET", `/api/runs/${id}`),
  guess: (id, value) => call("POST", `/api/runs/${id}/guess`, { value }),
  /* `at` is the square a crossword hint should fill; other games ignore it. */
  hint: (id, at) => call("POST", `/api/runs/${id}/hint`, at === undefined ? {} : { at }),
  check: (id, cells) => call("POST", `/api/runs/${id}/check`, cells ? { cells } : {}),
  back: (id) => call("POST", `/api/runs/${id}/back`, {}),
  reveal: (id) => call("POST", `/api/runs/${id}/reveal`, {}),

  stats: () => call("GET", "/api/stats"),
  friends: () => call("GET", "/api/friends"),
  addFriend: (handle) => call("POST", "/api/friends/request", { handle }),
  respond: (id, accept) => call("POST", "/api/friends/respond", { id, accept }),
  unfriend: (id) => call("DELETE", `/api/friends/${id}`),
  leaderboard: () => call("GET", "/api/friends/leaderboard"),

  createPuzzle: (body) => call("POST", "/api/puzzles", body),
  myPuzzles: () => call("GET", "/api/puzzles/mine"),
  friendPuzzles: () => call("GET", "/api/puzzles/friends"),
  puzzle: (code) => call("GET", `/api/puzzles/${code}`),
  deletePuzzle: (code) => call("DELETE", `/api/puzzles/${code}`),
};
