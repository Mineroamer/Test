"use strict";
/*
 * The whole database: one JSON file, held in memory, written back atomically.
 *
 * That is a deliberate ceiling, not an oversight. A puzzle club is a few
 * hundred people and a few thousand rounds; keeping it in one file means the
 * app installs with `node server.js` and no database to run alongside it. If
 * this ever outgrows that, `read()` and `save()` are the only two functions
 * that would need to change.
 *
 * Writes are debounced and go to a temp file that is renamed over the real
 * one, so a crash mid-write leaves the previous good file intact rather than
 * a half-written one.
 */

const fs = require("node:fs");
const path = require("node:path");

const EMPTY = () => ({
  version: 1,
  users: {},         // id -> user record (passwordHash never leaves the server)
  sessions: {},      // token -> { userId, createdAt, lastSeen }
  friendships: [],   // { a, b, since } with a < b so a pair is stored once
  requests: [],      // { id, from, to, createdAt }
  runs: {},          // id -> a game in progress, so a refresh resumes it
  results: [],       // finished rounds, newest last; trimmed per user
  stats: {},         // userId -> { "game:mode" -> tallies }
  progress: {},      // userId -> { xp, level, character, awards } - the pass
  puzzles: {},       // share code -> a puzzle somebody built
});

class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.pending = null;
    this.writing = false;
    this.dirtyWhileWriting = false;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      /* Merge onto a fresh shape so a file written by an older version still
       * loads once new collections are added. */
      this.data = Object.assign(EMPTY(), parsed);
    } catch (err) {
      if (err.code !== "ENOENT") {
        /* A corrupt file is worth keeping a copy of rather than overwriting. */
        const backup = this.file + ".corrupt-" + Date.now();
        try {
          fs.renameSync(this.file, backup);
          console.warn(`store: could not parse ${this.file} (${err.message}); moved to ${backup}`);
        } catch { console.warn("store: could not read or move " + this.file); }
      }
      this.data = EMPTY();
    }
    return this.data;
  }

  /** Mark the data changed. Writes coalesce, so a burst of calls costs one. */
  touch() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush();
    }, 120);
    if (this.pending.unref) this.pending.unref();
  }

  flush() {
    if (this.writing) { this.dirtyWhileWriting = true; return; }
    this.writing = true;
    const tmp = this.file + ".tmp";
    const body = JSON.stringify(this.data);
    fs.mkdir(path.dirname(this.file), { recursive: true }, () => {
      fs.writeFile(tmp, body, (err) => {
        const done = () => {
          this.writing = false;
          if (this.dirtyWhileWriting) { this.dirtyWhileWriting = false; this.flush(); }
        };
        if (err) { console.error("store: write failed", err.message); return done(); }
        fs.rename(tmp, this.file, (renameErr) => {
          if (renameErr) console.error("store: rename failed", renameErr.message);
          done();
        });
      });
    });
  }

  /** Write synchronously - only for shutdown, where the process is going away. */
  flushSync() {
    if (this.pending) { clearTimeout(this.pending); this.pending = null; }
    const tmp = this.file + ".tmp";
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("store: final write failed", err.message);
    }
  }
}

module.exports = { Store, EMPTY };
