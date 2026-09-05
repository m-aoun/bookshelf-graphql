// NOTE ON SQLITE DRIVER: this project originally targeted `better-sqlite3`,
// but its native binding requires a local C++ toolchain (Visual Studio Build
// Tools on Windows) to compile when no prebuilt binary matches the installed
// Node version. That build failed on this machine. Rather than depend on a
// toolchain a reviewer may not have either, this project uses Node's
// built-in `node:sqlite` (`DatabaseSync`), which ships with Node itself and
// needs zero native compilation. It requires Node >= 22.5.0 (unflagged on
// Node >= 23.4; older 22.x builds need `--experimental-sqlite`, which is
// wired into the npm scripts via NODE_OPTIONS so it works either way).
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const DB_FILE = process.env.DB_FILE || path.join(process.cwd(), "bookshelf.sqlite");

// Tests run against a private in-memory database so they never touch the
// developer's real bookshelf.sqlite file and can run in full isolation.
const dbPath = process.env.NODE_ENV === "test" ? ":memory:" : DB_FILE;

if (dbPath !== ":memory:") {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      bio TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      genre TEXT,
      published_year INTEGER,
      FOREIGN KEY (author_id) REFERENCES authors(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id),
      UNIQUE (book_id, reviewer_id)
    );

    CREATE TABLE IF NOT EXISTS shelf_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('WANT_TO_READ', 'READING', 'FINISHED')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      UNIQUE (user_id, book_id)
    );
  `);
}

export function resetDb(): void {
  db.exec(`
    DROP TABLE IF EXISTS shelf_entries;
    DROP TABLE IF EXISTS reviews;
    DROP TABLE IF EXISTS books;
    DROP TABLE IF EXISTS authors;
    DROP TABLE IF EXISTS users;
  `);
  initSchema();
}
