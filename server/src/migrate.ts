import type Database from "better-sqlite3";
import { foldName } from "./util.js";

const SCHEMA_VERSION = 10;

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

-- Which emergency contacts a plan alerts. No rows = all accepted contacts.
CREATE TABLE IF NOT EXISTS checkin_plan_contacts (
  plan_id          TEXT NOT NULL REFERENCES checkin_plans(id) ON DELETE CASCADE,
  contact_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, contact_user_id)
);
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

-- ───────────────────── In-app emergency contacts ─────────────────────
-- owner = the person who checks in; contact = the SafeSips user alerted when
-- they miss one. A contact must accept first. Email invites to people without
-- an account yet keep contact_user_id NULL until they sign up with that email.
CREATE TABLE IF NOT EXISTS emergency_links (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  invite_email_norm TEXT,
  invite_label      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        INTEGER NOT NULL,
  responded_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_owner_contact
  ON emergency_links(owner_id, contact_user_id) WHERE contact_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_owner_email
  ON emergency_links(owner_id, invite_email_norm) WHERE contact_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_links_contact ON emergency_links(contact_user_id);
CREATE INDEX IF NOT EXISTS idx_links_email ON emergency_links(invite_email_norm);

-- Web Push subscriptions (one per browser/device).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Alerts a contact received because someone they protect missed a check-in.
CREATE TABLE IF NOT EXISTS checkin_alerts (
  id               TEXT PRIMARY KEY,
  occurrence_id    TEXT NOT NULL REFERENCES checkin_occurrences(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_label       TEXT,
  area_lat         REAL,
  area_lng         REAL,
  created_at       INTEGER NOT NULL,
  acknowledged_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_contact ON checkin_alerts(contact_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_occ ON checkin_alerts(occurrence_id);

-- Friends: a request from one user to another; accepted = friends both ways.
-- One row per pair of users, whichever of them asked first. A request by
-- email is stored whether or not the address has an account (so the sender
-- can't tell): addressee_id stays NULL until someone with that email accepts.
CREATE TABLE IF NOT EXISTS friendships (
  id                TEXT PRIMARY KEY,
  requester_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  invite_email_norm TEXT,
  invite_label      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        INTEGER NOT NULL,
  responded_at      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
  ON friendships(min(requester_id, addressee_id), max(requester_id, addressee_id))
  WHERE addressee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_email
  ON friendships(requester_id, invite_email_norm) WHERE addressee_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_invite_email ON friendships(invite_email_norm);

-- "Keep this person's friend requests quiet": written when someone declines
-- a request or removes a friend, cleared when they add that person.
CREATE TABLE IF NOT EXISTS friend_declines (
  decliner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (decliner_id, requester_id)
);

-- Moderation: someone reported a forum post or a map report. Enough reports
-- from different people hide it for everyone (see repos/moderation.ts).
CREATE TABLE IF NOT EXISTS content_flags (
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  reporter_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS idx_flags_reporter ON content_flags(reporter_id);

-- Blocks: the blocker no longer sees the blocked person's content.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- The masked circle of a location share in progress (never the exact
-- position; it's the same point everyone already sees), so a server restart
-- doesn't end people's shares. Deleted when the share stops or ends.
CREATE TABLE IF NOT EXISTS presence_shares (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_id   TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  hold_until  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- For per-user posting limits.
CREATE INDEX IF NOT EXISTS idx_reports_author_created ON reports(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_threads_author_created ON forum_threads(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON forum_posts(author_id, created_at);

-- Small key/value store (e.g. auto-generated Web Push VAPID keys).
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
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
      if (row.version < 3) {
        // v3: IPs/emails are now stored as keyed hashes (privacyHash.ts).
        // Drop the legacy unsalted SHA-256 IP hashes (write-only, never
        // read) and the throttle rows keyed by raw email / unsalted IP.
        db.exec(`
          UPDATE sessions SET ip_hash = NULL;
          UPDATE waitlist SET ip_hash = NULL;
          DELETE FROM auth_attempts;
        `);
      }
      if (row.version < 5) {
        // v5: SOS alerts are in-app now; the SMS send log is no longer used.
        db.exec(`DROP TABLE IF EXISTS sms_sends;`);
      }
      db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    }
    const userCols = db
      .prepare(`PRAGMA table_info(users)`)
      .all() as Array<{ name: string }>;
    if (!userCols.some((c) => c.name === "clerk_id")) {
      db.exec(`ALTER TABLE users ADD COLUMN clerk_id TEXT`);
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id)`
    );
    if (!userCols.some((c) => c.name === "contact_code")) {
      // Short code people share so others can add them as an emergency contact.
      db.exec(`ALTER TABLE users ADD COLUMN contact_code TEXT`);
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact_code ON users(contact_code)`
    );
    if (!userCols.some((c) => c.name === "image_url")) {
      // Profile picture URL (Clerk-hosted only; see routes/users.ts).
      db.exec(`ALTER TABLE users ADD COLUMN image_url TEXT`);
    }
    if (!userCols.some((c) => c.name === "discoverable")) {
      // Shown in friend search by name (1) or not (0). On by default; users
      // can turn it off on the Friends page.
      db.exec(`ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 1`);
    }
    if (!userCols.some((c) => c.name === "search_notice_seen")) {
      // Everyone gets a one-time in-app notice that name search exists.
      db.exec(`ALTER TABLE users ADD COLUMN search_notice_seen INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userCols.some((c) => c.name === "friends_restored")) {
      // 1 once the friends and contacts saved in Clerk were restored (connectionBackup.ts).
      db.exec(`ALTER TABLE users ADD COLUMN friends_restored INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userCols.some((c) => c.name === "name_search")) {
      // Folded display name (lower-case, no accents) for friend search.
      db.exec(`ALTER TABLE users ADD COLUMN name_search TEXT`);
    }
    const occCols = db
      .prepare(`PRAGMA table_info(checkin_occurrences)`)
      .all() as Array<{ name: string }>;
    if (!occCols.some((c) => c.name === "wrong_attempts")) {
      // Wrong answers so far (capped: too many counts as a missed check-in).
      db.exec(`ALTER TABLE checkin_occurrences ADD COLUMN wrong_attempts INTEGER NOT NULL DEFAULT 0`);
    }
    const unfolded = db
      .prepare(`SELECT id, display_name FROM users WHERE name_search IS NULL`)
      .all() as Array<{ id: string; display_name: string }>;
    const setFolded = db.prepare(`UPDATE users SET name_search = ? WHERE id = ?`);
    for (const u of unfolded) setFolded.run(foldName(u.display_name), u.id);
  });
  apply();
}
