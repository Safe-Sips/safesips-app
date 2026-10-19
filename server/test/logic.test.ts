import assert from "node:assert/strict";
import test from "node:test";

// Configure an in-memory DB + fast hashing BEFORE importing server modules.
process.env.DATABASE_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret-test-secret-1234567890";
process.env.BCRYPT_ROUNDS = "4";

const shared = await import("@safesips/shared");
const { db } = await import("../src/db.js");
const users = await import("../src/repos/users.js");
const reports = await import("../src/repos/reports.js");
const checkins = await import("../src/repos/checkins.js");

function makeUser(email: string) {
  return users.createUser({ email, displayName: email, passwordHash: "x" });
}

test("badge tiers map to score thresholds", () => {
  assert.equal(shared.badgeForScore(0), "none");
  assert.equal(shared.badgeForScore(9), "none");
  assert.equal(shared.badgeForScore(10), "bronze");
  assert.equal(shared.badgeForScore(49), "bronze");
  assert.equal(shared.badgeForScore(50), "silver");
  assert.equal(shared.badgeForScore(199), "silver");
  assert.equal(shared.badgeForScore(200), "gold");
});

test("engagement score is weighted sum", () => {
  const score = shared.engagementScore({
    reports: 1,
    threads: 1,
    posts: 1,
    upvotesGiven: 0,
    upvotesReceived: 0,
    checkinsCompleted: 0,
  });
  // 1*5 + 1*5 + 1*2 = 12
  assert.equal(score, 12);
});

test("report votes are one-per-user (idempotent)", () => {
  const author = makeUser("author@test.local");
  const voter = makeUser("voter@test.local");
  const rep = reports.createReport(author.id, {
    lat: 44.4,
    lng: 26.1,
    safety: "unsafe",
    category: null,
    note: null,
    placeLabel: null,
  });

  assert.equal(reports.addReportVote(rep.id, voter.id), true, "first vote inserts");
  assert.equal(
    reports.addReportVote(rep.id, voter.id),
    false,
    "duplicate vote is ignored"
  );
  assert.equal(reports.reportVoteCount(rep.id), 1);

  reports.removeReportVote(rep.id, voter.id);
  assert.equal(reports.reportVoteCount(rep.id), 0);
});

test("check-in state machine: due → prompted → answered + reschedule", () => {
  const user = makeUser("checkin@test.local");
  const plan = checkins.createPlan(user.id, {
    label: "Test",
    intervalMinutes: 60,
    graceMinutes: 10,
    question: "dog name?",
    answer: "Rex",
    endsAt: null,
  });

  const now = Date.now();
  // Insert a pending occurrence already due in the past.
  db.prepare(
    `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run("occ-due", plan.id, user.id, now - 1000, now + 60_000, now);

  const due = checkins.claimDueOccurrences(now);
  assert.ok(due.some((d) => d.occurrenceId === "occ-due"), "due occurrence claimed");

  // Re-claiming does not double-process.
  assert.equal(
    checkins.claimDueOccurrences(now).some((d) => d.occurrenceId === "occ-due"),
    false,
    "already-prompted occurrence is not re-claimed"
  );

  // Answer correctly (case/space-insensitive) before deadline.
  const before = checkins.listOccurrences(user.id, now + 1_000_000, 50).length;
  const res = checkins.answerOccurrence(user.id, "occ-due", "  rEx ");
  assert.ok(res && res.correct, "correct answer accepted");

  // A next occurrence was scheduled.
  const after = checkins.listOccurrences(user.id, now + 1_000_000_000, 50).length;
  assert.ok(after > before, "a follow-up check-in was scheduled");
});

test("check-in state machine: overdue prompted → missed (escalate)", () => {
  const user = makeUser("overdue@test.local");
  const plan = checkins.createPlan(user.id, {
    label: null,
    intervalMinutes: 60,
    graceMinutes: 10,
    question: "q?",
    answer: "a",
    endsAt: null,
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'prompted', ?, ?)`
  ).run("occ-late", plan.id, user.id, now - 20_000, now - 1_000, now - 20_000, now);

  const overdue = checkins.claimOverdueOccurrences(now);
  assert.ok(
    overdue.some((o) => o.occurrenceId === "occ-late"),
    "overdue prompted occurrence flips to missed"
  );

  // Answering a missed check-in reports expired.
  const res = checkins.answerOccurrence(user.id, "occ-late", "a");
  assert.ok(res && res.expired, "missed check-in can no longer be answered");
});

test("wrong check-in answer is rejected but stays answerable", () => {
  const user = makeUser("wrong@test.local");
  const plan = checkins.createPlan(user.id, {
    label: null,
    intervalMinutes: 60,
    graceMinutes: 10,
    question: "q?",
    answer: "secret",
    endsAt: null,
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'prompted', ?, ?)`
  ).run("occ-wrong", plan.id, user.id, now - 1000, now + 60_000, now - 1000, now);

  const bad = checkins.answerOccurrence(user.id, "occ-wrong", "nope");
  assert.ok(bad && !bad.correct && !bad.expired, "wrong answer rejected, not expired");

  const good = checkins.answerOccurrence(user.id, "occ-wrong", "secret");
  assert.ok(good && good.correct, "correct answer still accepted afterwards");
});

test("presence: live mode expires after the TTL", async () => {
  const { PresenceStore } = await import("../src/presenceStore.js");
  const store = new PresenceStore(300_000);
  const rec = store.upsert("a", { lat: 1, lng: 2 }, 1_000);
  assert.equal(rec.expiresAt, 301_000);
  assert.equal(store.active(300_999).length, 1);
  assert.deepEqual(store.sweepExpired(301_000), ["a"]);
});

test("presence: 'share for' hold keeps the circle until the chosen time", async () => {
  const { PresenceStore } = await import("../src/presenceStore.js");
  const store = new PresenceStore(300_000);
  const hour = 60 * 60 * 1000;
  store.upsert("b", { lat: 1, lng: 2 }, 0, hour);
  // No heartbeats for 59 minutes (phone locked): still visible.
  assert.equal(store.active(hour - 60_000).length, 1);
  assert.ok(store.get("b", hour - 1));
  // Ends exactly on time, not TTL later.
  assert.deepEqual(store.sweepExpired(hour), ["b"]);
});

test("location validation accepts, clamps and drops holdMs", () => {
  const max = shared.SHARE_MAX_DURATION_MS;
  assert.deepEqual(shared.validateLocationUpdate({ lat: 1, lng: 2 }).value, {
    lat: 1,
    lng: 2,
  });
  assert.deepEqual(
    shared.validateLocationUpdate({ lat: 1, lng: 2, holdMs: 3_600_000 }).value,
    { lat: 1, lng: 2, holdMs: 3_600_000 }
  );
  assert.equal(
    shared.validateLocationUpdate({ lat: 1, lng: 2, holdMs: max * 10 }).value
      ?.holdMs,
    max
  );
  for (const bad of [-5, 0, "1h", Number.NaN, null]) {
    assert.equal(
      shared.validateLocationUpdate({ lat: 1, lng: 2, holdMs: bad }).value
        ?.holdMs,
      undefined
    );
  }
  // Unknown fields are still discarded.
  assert.deepEqual(
    shared.validateLocationUpdate({ lat: 1, lng: 2, exactLat: 9 }).value,
    { lat: 1, lng: 2 }
  );
});

test("presence: only a deliberate client disconnect removes the circle", async () => {
  const { isDeliberateDisconnect } = await import("../src/presenceLogic.js");
  assert.equal(isDeliberateDisconnect("client namespace disconnect"), true);
  // Involuntary drops (phone locked, tab closed, network blip) must NOT remove.
  for (const reason of [
    "transport close",
    "ping timeout",
    "transport error",
    "server namespace disconnect",
  ]) {
    assert.equal(isDeliberateDisconnect(reason), false);
  }
});

test("presence: a second live session does not hijack the share", async () => {
  const { resumeDecision } = await import("../src/presenceLogic.js");
  // Genuine reload: the previous owner is gone -> restore + take over.
  assert.equal(
    resumeDecision({ hasExisting: true, recordExists: true, ownerConnected: false }),
    "resume"
  );
  // Another tab of the same user still owns it -> leave it there (no ping-pong).
  assert.equal(
    resumeDecision({ hasExisting: true, recordExists: true, ownerConnected: true }),
    "skip"
  );
  // Tracked share already expired in the store -> drop the stale entry.
  assert.equal(
    resumeDecision({ hasExisting: true, recordExists: false, ownerConnected: false }),
    "clear"
  );
  // Nothing to resume.
  assert.equal(
    resumeDecision({ hasExisting: false, recordExists: false, ownerConnected: false }),
    "skip"
  );
});

test("presence: max-duration cap is measured from an absolute start", async () => {
  const { hasReachedMaxDuration } = await import("../src/presenceLogic.js");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(hasReachedMaxDuration(1_000, 1_000 + day - 1, day), false);
  assert.equal(hasReachedMaxDuration(1_000, 1_000 + day, day), true);
  // Reconnecting (now far past start) still trips the cap: it isn't reset.
  assert.equal(hasReachedMaxDuration(1_000, 1_000 + day * 3, day), true);
});
