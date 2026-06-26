import type Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

/**
 * Full schema, created idempotently with CREATE TABLE/INDEX IF NOT EXISTS.
 * Every table uses TEXT uuid primary keys and INTEGER epoch-ms timestamps.
 *
 * IMPORTANT: `PRAGMA foreign_keys` must be ON (set in db.ts) for the
 * ON DELETE CASCADE clauses below to take effect — it is OFF by default.
 */
const DDL = `
-- ───────────────────────────── Accounts ─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  email_norm      TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'verify',
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emailver_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_emailver_tokenhash ON email_verifications(token_hash);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  user_agent  TEXT,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_key_time ON auth_attempts(key, created_at);

-- ─────────────────────── Location safety reports ────────────────────────
-- A report is an INTENTIONAL public publish of an EXACT point (different
-- privacy contract from the masked, anonymous presence circle).
CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  safety        TEXT NOT NULL,
  category      TEXT,
  note          TEXT,
  place_label   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(lat, lng);
CREATE INDEX IF NOT EXISTS idx_reports_author ON reports(author_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

CREATE TABLE IF NOT EXISTS report_votes (
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (report_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_report_votes_user ON report_votes(user_id);

-- ───────────────────────────── Forum ─────────────────────────────
CREATE TABLE IF NOT EXISTS forum_threads (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',
  created_at    INTEGER NOT NULL,
  last_post_at  INTEGER NOT NULL,
  post_count    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_threads_lastpost ON forum_threads(last_post_at);

CREATE TABLE IF NOT EXISTS forum_posts (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON forum_posts(thread_id, created_at);

CREATE TABLE IF NOT EXISTS forum_post_votes (
  post_id     TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- ───────────────────── Activity log (history feed) ─────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  ref_id      TEXT,
  context     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_kind ON activity_log(user_id, kind);

-- ───────────────────── SOS contacts + check-ins ─────────────────────
CREATE TABLE IF NOT EXISTS sos_contacts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_contacts(user_id);

CREATE TABLE IF NOT EXISTS checkin_plans (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label            TEXT,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  grace_minutes    INTEGER NOT NULL DEFAULT 10,
  question         TEXT NOT NULL,
  answer_hash      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  started_at       INTEGER NOT NULL,
  ends_at          INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON checkin_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_active ON checkin_plans(status);

CREATE TABLE IF NOT EXISTS checkin_occurrences (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES checkin_plans(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at      INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  prompted_at INTEGER,
  answered_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_occ_due ON checkin_occurrences(status, due_at);
CREATE INDEX IF NOT EXISTS idx_occ_deadline ON checkin_occurrences(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_occ_user ON checkin_occurrences(user_id, due_at);

CREATE TABLE IF NOT EXISTS checkin_escalations (
  id            TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES checkin_occurrences(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES sos_contacts(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL,
  detail        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalations_occ ON checkin_escalations(occurrence_id);

-- ───────────────────────────── Waitlist ─────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_norm  TEXT NOT NULL UNIQUE,
  country     TEXT,
  interest    TEXT,
  created_at  INTEGER NOT NULL,
  ip_hash     TEXT
);
`;

/** Create all tables/indexes idempotently inside a single transaction. */
export function runMigrations(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);");
  const apply = db.transaction(() => {
    db.exec(DDL);
    const row = db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    if (!row) {
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
        SCHEMA_VERSION
      );
    } else if (row.version !== SCHEMA_VERSION) {
      db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    }
  });
  apply();
}
