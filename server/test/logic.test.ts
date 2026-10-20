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

test("SOS phone numbers are normalised to international format", () => {
  assert.equal(shared.normalizePhone("0722 123 456"), "+40722123456", "Romanian national number");
  assert.equal(shared.normalizePhone("+40 (722) 123-456"), "+40722123456");
  assert.equal(shared.normalizePhone("0040722123456"), "+40722123456");
  assert.equal(shared.normalizePhone("+44 7700 900123"), "+447700900123", "foreign numbers keep their code");
  for (const bad of ["722123456", "abc", "+0123", "07", ""]) {
    assert.equal(shared.normalizePhone(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
});

test("SOS alert text names the person, says call 112, and links the area", async () => {
  const { buildEscalationSms, buildEscalationEmail } = await import("../src/notify.js");
  const base = { occurrenceId: "o", userId: "u", personName: "Ana", planLabel: "Club", area: null };
  const plain = buildEscalationSms(base);
  assert.match(plain, /Ana missed a safety check-in \("Club"\)/);
  assert.match(plain, /call 112/);
  assert.ok(!plain.includes("openstreetmap"), "no map link when not sharing");
  const withArea = buildEscalationSms({ ...base, area: { lat: 44.426812, lng: 26.102538 } });
  assert.match(withArea, /openstreetmap\.org\/\?mlat=44\.4268&mlon=26\.1025/);
  const longName = buildEscalationSms({ ...base, personName: "x".repeat(200) });
  assert.ok(longName.length < 320, "stays within two SMS segments");
  const mail = buildEscalationEmail({ ...base, personName: "<b>Ana</b>", planLabel: "Club & bar" });
  assert.ok(mail.html.includes("&lt;b&gt;Ana&lt;/b&gt;") && !mail.html.includes("<b>Ana</b>"), "HTML-escaped");
  assert.ok(mail.html.includes("Club &amp; bar"));
});

test("SOS: a missed check-in alerts every contact on every channel", async () => {
  const { notifyContacts } = await import("../src/notify.js");
  const mailer = await import("../src/mailer.js");
  const sms = await import("../src/sms.js");
  const sos = await import("../src/repos/sosContacts.js");
  const user = makeUser("sos-multi@test.local");
  const plan = checkins.createPlan(user.id, {
    label: null, intervalMinutes: 60, graceMinutes: 10, question: "q?", answer: "a", endsAt: null,
  });
  const now = Date.now();
  const occ = (id: string) => {
    db.prepare(
      `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'missed', ?, ?)`
    ).run(id, plan.id, user.id, now, now, now, now);
    return { occurrenceId: id, userId: user.id, personName: "Ana", planLabel: null, area: null };
  };
  const rows = (id: string) =>
    db.prepare(`SELECT channel, status FROM checkin_escalations WHERE occurrence_id = ? ORDER BY channel`).all(id);

  // No contacts at all: recorded as a failure, not silently "sent".
  let r = await notifyContacts(occ("esc-none"), []);
  assert.deepEqual(r.map((x) => [x.channel, x.status]), [["none", "failed"]]);

  const both = sos.createContact(user.id, { name: "Mo", email: "mo@test.local", phone: "+40722000001", isPrimary: true });
  const phoneOnly = sos.createContact(user.id, { name: "Pat", email: null, phone: "+40722000002", isPrimary: false });

  // Nothing configured: every attempt is an honest failure.
  mailer.setMailTransport(null);
  sms.setSmsTransport(null);
  r = await notifyContacts(occ("esc-off"), sos.listAlertContacts(user.id));
  assert.equal(r.length, 3, "Mo: sms+email, Pat: sms");
  assert.ok(r.every((x) => x.status === "failed"));

  // Both channels working: everyone gets everything they can.
  const texts: Array<{ to: string; body: string }> = [];
  const emails: Array<{ to: string }> = [];
  sms.setSmsTransport({ send: async (to, body) => void texts.push({ to, body }) });
  mailer.setMailTransport({ sendMail: async (m: { to: string }) => (emails.push(m), {}) } as never);
  r = await notifyContacts(occ("esc-on"), sos.listAlertContacts(user.id));
  assert.ok(r.every((x) => x.status === "sent"), JSON.stringify(r));
  assert.deepEqual(texts.map((t) => t.to).sort(), ["+40722000001", "+40722000002"]);
  assert.deepEqual(emails.map((e) => e.to), ["mo@test.local"]);
  assert.deepEqual(rows("esc-on"), [
    { channel: "email", status: "sent" },
    { channel: "sms", status: "sent" },
    { channel: "sms", status: "sent" },
  ]);
  assert.ok(both && phoneOnly);

  // The send log never stores the phone number itself.
  const logged = db.prepare(`SELECT to_hash FROM sms_sends`).all() as Array<{ to_hash: string }>;
  assert.ok(logged.length > 0 && logged.every((l) => !l.to_hash.includes("722")), "only keyed hashes");

  sms.setSmsTransport(null);
  mailer.setMailTransport(null);
});

test("SOS texts retry temporary failures but not permanent ones", async () => {
  const sms = await import("../src/sms.js");
  sms.setSmsRetryDelays([0, 0, 0]);
  const u = makeUser("sms-retry@test.local");
  let calls = 0;
  sms.setSmsTransport({
    send: async () => {
      calls++;
      if (calls < 3) throw new sms.SmsError("provider down", true);
    },
  });
  let r = await sms.sendSms({ to: "+40722000101", body: "x", userId: u.id, kind: "alert" });
  assert.equal(r.ok, true, "succeeds on the third attempt");
  assert.equal(calls, 3);

  calls = 0;
  sms.setSmsTransport({
    send: async () => {
      calls++;
      throw new sms.SmsError("invalid number", false);
    },
  });
  r = await sms.sendSms({ to: "+40722000102", body: "x", userId: u.id, kind: "alert" });
  assert.equal(r.ok, false);
  assert.equal(calls, 1, "a permanent error isn't retried");
  sms.setSmsTransport(null);
});

test("SOS texts: one number can't be spammed past the daily cap", async () => {
  const sms = await import("../src/sms.js");
  const { config } = await import("../src/config.js");
  sms.setSmsTransport({ send: async () => {} });
  const to = "+40722000200";
  for (let i = 0; i < config.smsMaxPerNumberPerDay; i++) {
    const u = makeUser(`spammer-${i}@test.local`);
    assert.equal((await sms.sendSms({ to, body: "x", userId: u.id, kind: "alert" })).ok, true);
  }
  const fresh = makeUser("spammer-new@test.local");
  const blocked = await sms.sendSms({ to, body: "x", userId: fresh.id, kind: "alert" });
  assert.equal(blocked.ok, false, "even from a different account");
  assert.match(blocked.detail, /most texts allowed today/);
  sms.setSmsTransport(null);
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

test("presence: a dropped owner hands the circle to the user's newest session", async () => {
  const { pickHandoverSocket } = await import("../src/presenceLogic.js");
  // Refresh: the old page's socket (the owner) drops; the new page takes over.
  assert.equal(pickHandoverSocket({ droppedIsOwner: true, remainingSocketIds: ["new-page"] }), "new-page");
  // Several sessions open: the most recently connected one wins.
  assert.equal(
    pickHandoverSocket({ droppedIsOwner: true, remainingSocketIds: ["tab-1", "tab-2"] }),
    "tab-2"
  );
  // The dropped socket wasn't sending the circle: nothing to hand over.
  assert.equal(pickHandoverSocket({ droppedIsOwner: false, remainingSocketIds: ["tab-1"] }), null);
  // No other session open: the circle just stays until it expires.
  assert.equal(pickHandoverSocket({ droppedIsOwner: true, remainingSocketIds: [] }), null);
});
