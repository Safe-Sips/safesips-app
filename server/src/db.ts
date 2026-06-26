import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";

/**
 * Single SQLite connection for the whole server. Opened synchronously at boot;
 * the rest of the app shares this instance.
 *
 * Only the masked presence centers are still kept in-memory (PresenceStore);
 * everything durable (accounts, reports, forum, check-ins, waitlist) lives
 * here. Exact presence coordinates never touch this database.
 */
function openDatabase(): Database.Database {
  const path = config.databasePath;
  if (path !== ":memory:") {
    const dir = dirname(path);
    if (dir && dir !== "." && dir !== "") {
      mkdirSync(dir, { recursive: true });
    }
  }

  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  runMigrations(database);
  return database;
}

export const db = openDatabase();
