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

test("SOS escalation records the real delivery outcome", async () => {
  const { notifyContact } = await import("../src/notify.js");
  const mailer = await import("../src/mailer.js");
  const sos = await import("../src/repos/sosContacts.js");
  const user = makeUser("sos-owner@test.local");
  const plan = checkins.createPlan(user.id, {
    label: null,
    intervalMinutes: 60,
    graceMinutes: 10,
    question: "q?",
    answer: "a",
    endsAt: null,
  });
  const now = Date.now();
  const occ = (id: string) => {
    db.prepare(
      `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'missed', ?, ?)`
    ).run(id, plan.id, user.id, now, now, now, now);
    return { occurrenceId: id, personName: "<b>Ana</b>", planLabel: "Club & bar" };
  };
  const recorded = (id: string) =>
    db.prepare(`SELECT channel, status FROM checkin_escalations WHERE occurrence_id = ?`).get(id);

  // No contact at all.
  let r = await notifyContact(occ("esc-none"), null);
  assert.deepEqual([r.channel, r.status], ["none", "failed"]);
  assert.deepEqual(recorded("esc-none"), { channel: "none", status: "failed" });

  // Phone-only contact: no SMS provider, must NOT be reported as sent.
  const phoneOnly = sos.createContact(user.id, { name: "Pat", email: null, phone: "+40700000000", isPrimary: false });
  r = await notifyContact(occ("esc-sms"), { ...phoneOnly });
  assert.deepEqual([r.channel, r.status], ["sms", "failed"]);

  const withEmail = sos.createContact(user.id, { name: "Mo", email: "mo@test.local", phone: null, isPrimary: true });

  // Email contact but SMTP not configured: failed, not silently "sent".
  mailer.setMailTransport(null);
  r = await notifyContact(occ("esc-nosmtp"), { ...withEmail });
  assert.deepEqual([r.channel, r.status], ["email", "failed"]);

  // Email contact with a working transport: actually sent, names the person.
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  mailer.setMailTransport({
    sendMail: async (m: (typeof sent)[number]) => {
      sent.push(m);
      return {};
    },
  } as never);
  r = await notifyContact(occ("esc-ok"), { ...withEmail });
  mailer.setMailTransport(null);
  assert.deepEqual([r.channel, r.status], ["email", "sent"]);
  assert.deepEqual(recorded("esc-ok"), { channel: "email", status: "sent" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "mo@test.local");
  assert.match(sent[0].subject, /<b>Ana<\/b> missed a safety check-in/);
  assert.match(sent[0].text, /call 112/);
  assert.ok(sent[0].html.includes("&lt;b&gt;Ana&lt;/b&gt;"), "name is HTML-escaped");
  assert.ok(sent[0].html.includes("Club &amp; bar"), "label is HTML-escaped");
  assert.ok(!sent[0].html.includes("<b>Ana</b>"), "raw HTML from the name is not injected");
});

test("IPs and emails are stored as keyed hashes, not plain sha256", async () => {
  const { hashIdentifier } = await import("../src/privacyHash.js");
  const { loginKey, ipKey } = await import("../src/auth/throttle.js");
  const { sha256 } = await import("../src/util.js");
  assert.notEqual(hashIdentifier("203.0.113.7"), sha256("203.0.113.7"), "not plain sha256");
  assert.equal(hashIdentifier("203.0.113.7"), hashIdentifier("203.0.113.7"), "deterministic");
  assert.ok(!loginKey("ana@test.local").includes("ana@test.local"), "no raw email in throttle key");
  assert.ok(!ipKey("203.0.113.7").includes("203.0.113.7"));
});

test("GDPR: export covers the account and omits secrets", async () => {
  const account = await import("../src/repos/account.js");
  const sos = await import("../src/repos/sosContacts.js");
  const user = makeUser("export-me@test.local");
  sos.createContact(user.id, { name: "Kim", email: "kim@test.local", phone: null, isPrimary: true });
  checkins.createPlan(user.id, {
    label: "Night out",
    intervalMinutes: 60,
    graceMinutes: 10,
    question: "q?",
    answer: "secret",
    endsAt: null,
  });
  const data = account.exportAccountData(user.id)!;
  assert.equal(data.profile.id, user.id);
  assert.ok(!("password_hash" in data.profile), "password hash omitted");
  assert.equal(data.sosContacts.length, 1);
  assert.equal(data.checkinPlans.length, 1);
  assert.ok(!("answer_hash" in data.checkinPlans[0]), "security-answer hash omitted");
  assert.equal(account.exportAccountData("no-such-user"), null);
});

test("GDPR: account deletion erases the user's data and nobody else's", async () => {
  const account = await import("../src/repos/account.js");
  const sos = await import("../src/repos/sosContacts.js");
  const gone = makeUser("delete-me@test.local");
  const other = makeUser("keep-me@test.local");
  const now = Date.now();
  for (const u of [gone, other]) {
    sos.createContact(u.id, { name: "C", email: "c@test.local", phone: null, isPrimary: true });
    reports.createReport(u.id, {
      lat: 44.4,
      lng: 26.1,
      safety: "safe",
      category: null,
      note: null,
      placeLabel: null,
    });
  }
  db.prepare(
    `INSERT INTO waitlist (id, name, email, email_norm, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run("wl-gone", "G", "delete-me@test.local", "delete-me@test.local", now);

  assert.deepEqual(account.deleteAccountData(gone.id), { clerkId: null });

  const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { c: number }).c;
  assert.equal(count(`SELECT COUNT(*) AS c FROM users WHERE id = ?`, gone.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM sos_contacts WHERE user_id = ?`, gone.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM reports WHERE author_id = ?`, gone.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM waitlist WHERE id = ?`, "wl-gone"), 0);
  // The other user is untouched.
  assert.equal(count(`SELECT COUNT(*) AS c FROM users WHERE id = ?`, other.id), 1);
  assert.equal(count(`SELECT COUNT(*) AS c FROM sos_contacts WHERE user_id = ?`, other.id), 1);
  assert.equal(count(`SELECT COUNT(*) AS c FROM reports WHERE author_id = ?`, other.id), 1);
  // Deleting again is a no-op.
  assert.equal(account.deleteAccountData(gone.id), null);
});

test("forum downvotes do not raise engagement score", async () => {
  const forum = await import("../src/repos/forum.js");
  const stats = await import("../src/repos/stats.js");
  const author = makeUser("post-author@test.local");
  const voter = makeUser("post-voter@test.local");
  const now = Date.now();
  db.prepare(
    `INSERT INTO forum_threads (id, author_id, title, created_at, last_post_at) VALUES (?, ?, ?, ?, ?)`
  ).run("thr-dv", author.id, "t", now, now);
  db.prepare(
    `INSERT INTO forum_posts (id, thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run("post-dv", "thr-dv", author.id, "b", now);

  const before = stats.computeCounts(author.id);
  forum.setPostVote("post-dv", voter.id, -1);
  const afterDown = stats.computeCounts(author.id);
  assert.equal(afterDown.upvotesReceived, before.upvotesReceived, "downvote not counted as received upvote");
  assert.equal(stats.computeCounts(voter.id).upvotesGiven, 0, "downvote not counted as given upvote");

  forum.setPostVote("post-dv", voter.id, 1);
  assert.equal(stats.computeCounts(author.id).upvotesReceived, before.upvotesReceived + 1);
  assert.equal(stats.computeCounts(voter.id).upvotesGiven, 1);
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

test("reports fade from 100% to 60% over 48 h, then expire", () => {
  const H = 60 * 60 * 1000;
  const t0 = 1_000_000;
  assert.equal(shared.reportOpacity(t0, t0), 1);
  assert.ok(Math.abs(shared.reportOpacity(t0, t0 + 24 * H) - 0.8) < 1e-9, "linear: halfway = 80%");
  assert.ok(Math.abs(shared.reportOpacity(t0, t0 + 48 * H) - 0.6) < 1e-9);
  assert.equal(shared.reportOpacity(t0, t0 + 99 * H), 0.6, "never below the floor");
  assert.equal(shared.reportOpacity(t0 + 5_000, t0), 1, "clock skew can't brighten past 1");
  assert.equal(shared.isReportExpired(t0, t0 + 48 * H - 1), false);
  assert.equal(shared.isReportExpired(t0, t0 + 48 * H), true);
});

test("server stops returning reports older than 48 h", () => {
  const author = makeUser("aging-author@test.local");
  const fresh = reports.createReport(author.id, {
    lat: 45.1, lng: 25.1, safety: "unsafe", category: null, note: null, placeLabel: null,
  });
  const old = reports.createReport(author.id, {
    lat: 45.1, lng: 25.1, safety: "safe", category: null, note: null, placeLabel: null,
  });
  db.prepare(`UPDATE reports SET created_at = ? WHERE id = ?`).run(
    Date.now() - 49 * 60 * 60 * 1000,
    old.id
  );
  const bbox = { minLat: 45, maxLat: 45.2, minLng: 25, maxLng: 25.2 };
  const ids = reports.listReportsInBbox(author.id, bbox, 100).map((r) => r.id);
  assert.ok(ids.includes(fresh.id), "fresh report listed");
  assert.ok(!ids.includes(old.id), "expired report hidden");
  assert.equal(reports.getReportDTO(old.id, author.id), undefined);
  // Kept for the author's history: they can still delete it.
  assert.equal(reports.getReportAuthor(old.id), author.id);
});

test("distanceMeters is roughly right", () => {
  const d = shared.distanceMeters({ lat: 44.4268, lng: 26.1025 }, { lat: 44.4278, lng: 26.1025 });
  assert.ok(d > 105 && d < 117, `0.001° latitude ≈ 111 m, got ${d}`);
  assert.equal(shared.distanceMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }), 0);
});

test("live circle moves only on real, accurate, spaced-out movement", () => {
  const base = { lat: 44.4268, lng: 26.1025 };
  const north = (m: number) => ({ lat: base.lat + m / 111_320, lng: base.lng });
  const ok = { lastPublished: base, accuracyMeters: 30, msSinceLastPublish: 60_000 };
  assert.equal(shared.shouldMoveCircle({ ...ok, here: north(40) }), false, "small move: stay");
  assert.equal(shared.shouldMoveCircle({ ...ok, here: north(150) }), true, "real move: go");
  assert.equal(
    shared.shouldMoveCircle({ ...ok, here: north(150), msSinceLastPublish: 5_000 }),
    false,
    "too soon after the last publish"
  );
  assert.equal(
    shared.shouldMoveCircle({ ...ok, here: north(150), accuracyMeters: 900 }),
    false,
    "fix too inaccurate"
  );
  assert.equal(
    shared.shouldMoveCircle({ ...ok, here: north(150), accuracyMeters: 300 }),
    false,
    "moved less than the fix's own uncertainty (jitter)"
  );
  assert.equal(
    shared.shouldMoveCircle({ ...ok, lastPublished: null, here: north(5) }),
    true,
    "resumed share: first good fix places the circle"
  );
});
