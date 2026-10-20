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
  const ec = await import("../src/repos/emergencyContacts.js");
  const user = makeUser("export-me@test.local");
  ec.requestContact(user.id, "kim-export@test.local");
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
  assert.equal(data.emergencyContacts.length, 1);
  assert.equal(data.checkinPlans.length, 1);
  assert.ok(!("answer_hash" in data.checkinPlans[0]), "security-answer hash omitted");
  assert.equal(account.exportAccountData("no-such-user"), null);
});

test("GDPR: account deletion erases the user's data and nobody else's", async () => {
  const account = await import("../src/repos/account.js");
  const ec = await import("../src/repos/emergencyContacts.js");
  const gone = makeUser("delete-me@test.local");
  const other = makeUser("keep-me@test.local");
  const now = Date.now();
  // Someone invited the soon-deleted user by email before linking.
  const inviter = makeUser("inviter@test.local");
  db.prepare(
    `INSERT INTO emergency_links (id, owner_id, contact_user_id, invite_email_norm, invite_label, status, created_at)
     VALUES ('pending-by-email', ?, NULL, 'delete-me@test.local', 'delete-me@test.local', 'pending', ?)`
  ).run(inviter.id, now);
  for (const u of [gone, other]) {
    ec.requestContact(u.id, `friend-of-${u.id}@test.local`);
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
  assert.equal(count(`SELECT COUNT(*) AS c FROM emergency_links WHERE owner_id = ?`, gone.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM emergency_links WHERE id = ?`, "pending-by-email"), 0, "invite to their email erased");
  assert.equal(count(`SELECT COUNT(*) AS c FROM reports WHERE author_id = ?`, gone.id), 0);
  assert.equal(count(`SELECT COUNT(*) AS c FROM waitlist WHERE id = ?`, "wl-gone"), 0);
  // The other user is untouched.
  assert.equal(count(`SELECT COUNT(*) AS c FROM users WHERE id = ?`, other.id), 1);
  assert.equal(count(`SELECT COUNT(*) AS c FROM emergency_links WHERE owner_id = ?`, other.id), 1);
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

test("emergency contacts: SafeSips codes are typed forgivingly and formatted", async () => {
  const ec = await import("../src/repos/emergencyContacts.js");
  const u = makeUser("code-owner@test.local");
  const code = ec.ensureContactCode(u.id);
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/, "no ambiguous 0/O/1/I/L");
  assert.equal(ec.ensureContactCode(u.id), code, "stable once created");
  assert.equal(ec.normalizeCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `), code);
  assert.equal(ec.normalizeCode("ABC"), null);
  assert.equal(ec.formatCode("ABCD2345"), "ABCD-2345");
});

test("emergency contacts: request rules (self, duplicates, no account probing)", async () => {
  const ec = await import("../src/repos/emergencyContacts.js");
  const owner = makeUser("req-owner@test.local");
  const friend = makeUser("req-friend@test.local");

  assert.equal(ec.requestContact(owner.id, "req-owner@test.local").ok, false, "can't add own email");
  assert.equal(ec.requestContact(owner.id, ec.ensureContactCode(owner.id)).ok, false, "can't add own code");
  assert.equal(ec.requestContact(owner.id, "ZZZZ-ZZZZ").ok, false, "unknown code is an error");

  // Same reply for a real and an unknown email: no way to probe who has an account.
  const real = ec.requestContact(owner.id, "req-friend@test.local");
  const unknown = ec.requestContact(owner.id, "nobody-here@test.local");
  assert.ok(real.ok && unknown.ok);
  if (real.ok && unknown.ok) {
    assert.equal(
      real.message.replace("req-friend@test.local", "X"),
      unknown.message.replace("nobody-here@test.local", "X")
    );
    assert.equal(real.notifyUserId, friend.id, "an existing user is notified");
  }

  // Adding the same person again (email, then code) doesn't duplicate them.
  ec.requestContact(owner.id, "req-friend@test.local");
  ec.requestContact(owner.id, ec.ensureContactCode(friend.id));
  const mine = ec.getOverview(owner.id).contacts;
  assert.equal(mine.filter((c) => c.inviteLabel !== "nobody-here@test.local").length, 1);
  assert.ok(mine.every((c) => c.displayName === null), "names hidden until they accept");
});

test("emergency contacts: invites wait for sign-up; alerts only after accepting", async () => {
  const ec = await import("../src/repos/emergencyContacts.js");
  const owner = makeUser("inv-owner@test.local");
  ec.requestContact(owner.id, "joins-later@test.local");
  assert.equal(ec.hasAcceptedContact(owner.id), false, "pending isn't enough to start check-ins");

  const later = makeUser("joins-later@test.local");
  const incoming = ec.getOverview(later.id).incoming;
  assert.equal(incoming.length, 1, "the invite shows up once they have an account");
  assert.equal(incoming[0].fromDisplayName, "inv-owner@test.local");

  assert.equal(ec.acceptRequest(makeUser("stranger@test.local").id, incoming[0].id), null, "only the invitee can accept");
  assert.equal(ec.acceptRequest(later.id, incoming[0].id), owner.id);
  assert.equal(ec.hasAcceptedContact(owner.id), true);
  assert.equal(ec.getOverview(owner.id).contacts[0].displayName, "joins-later@test.local", "name shown once accepted");
  assert.equal(ec.getOverview(later.id).protecting[0].displayName, "inv-owner@test.local");

  // The contact can step down at any time.
  assert.ok(ec.removeLink(later.id, incoming[0].id));
  assert.equal(ec.hasAcceptedContact(owner.id), false);
});

test("emergency contacts: request rate limit", async () => {
  const ec = await import("../src/repos/emergencyContacts.js");
  const spammer = makeUser("req-spammer@test.local");
  for (let i = 0; i < ec.MAX_REQUESTS_PER_DAY; i++) {
    assert.equal(ec.requestContact(spammer.id, `victim-${i}@test.local`).ok, true);
  }
  assert.equal(ec.requestContact(spammer.id, "one-more@test.local").ok, false);
});

test("missed check-in alerts accepted contacts in-app and by push", async () => {
  const ec = await import("../src/repos/emergencyContacts.js");
  const push = await import("../src/push.js");
  const notify = await import("../src/notify.js");
  const alerts = await import("../src/repos/alerts.js");
  const owner = makeUser("alert-owner@test.local");
  const mo = makeUser("alert-mo@test.local");
  const pat = makeUser("alert-pat@test.local");
  const pending = makeUser("alert-pending@test.local");
  for (const c of [mo, pat]) {
    ec.requestContact(owner.id, ec.ensureContactCode(c.id));
    ec.acceptRequest(c.id, ec.getOverview(c.id).incoming[0].id);
  }
  ec.requestContact(owner.id, ec.ensureContactCode(pending.id)); // never accepts

  const plan = checkins.createPlan(owner.id, {
    label: "Club", intervalMinutes: 60, graceMinutes: 10, question: "q?", answer: "a", endsAt: null,
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
     VALUES ('occ-inapp', ?, ?, ?, ?, 'missed', ?, ?)`
  ).run(plan.id, owner.id, now, now, now, now);

  // Mo has two devices (one is dead), Pat hasn't turned notifications on.
  push.saveSubscription(mo.id, { endpoint: "https://push.example/mo-phone", keys: { p256dh: "k", auth: "a" } });
  push.saveSubscription(mo.id, { endpoint: "https://push.example/mo-old", keys: { p256dh: "k", auth: "a" } });
  const delivered: Array<{ endpoint: string; payload: Record<string, unknown>; urgent: boolean }> = [];
  push.setPushSender(async (sub, payload, urgent) => {
    if (sub.endpoint.endsWith("mo-old")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    delivered.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), urgent });
  });

  const summary = await notify.alertEmergencyContacts({
    occurrenceId: "occ-inapp",
    userId: owner.id,
    personName: "Ana",
    planLabel: "Club",
    area: { lat: 44.43, lng: 26.1 },
  });
  assert.deepEqual(summary, { contacts: 2, pushed: 1, emailed: 0 }, "Mo + Pat alerted; the pending user isn't");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].urgent, true);
  assert.equal(delivered[0].payload.title, "Ana missed a safety check-in");
  assert.equal(delivered[0].payload.url, "/alerts");
  assert.equal(push.hasPushSubscription(mo.id), true);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE endpoint = ?`).get("https://push.example/mo-old") as { c: number }).c,
    0,
    "a subscription the push service reports gone is removed"
  );

  // Both have it in their inbox, with the masked area; the pending user doesn't.
  const moAlerts = alerts.listAlerts(mo.id);
  assert.equal(moAlerts.length, 1);
  assert.deepEqual(moAlerts[0].area, { lat: 44.43, lng: 26.1 });
  assert.equal(alerts.listAlerts(pat.id).length, 1);
  assert.equal(alerts.listAlerts(pending.id).length, 0);

  // Mo says "I'm checking on them": Pat sees it; acking twice is a no-op.
  assert.deepEqual(alerts.acknowledgeAlert(mo.id, moAlerts[0].id), { ownerId: owner.id });
  assert.equal(alerts.acknowledgeAlert(mo.id, moAlerts[0].id), null);
  assert.deepEqual(alerts.listAlerts(pat.id)[0].othersOnIt, ["alert-mo@test.local"]);
  assert.equal(alerts.unreadAlertCount(mo.id), 0);
  assert.equal(alerts.unreadAlertCount(pat.id), 1);

  // Nobody accepted: recorded as an honest failure.
  const lonely = makeUser("alert-lonely@test.local");
  const none = await notify.alertEmergencyContacts({
    occurrenceId: "occ-inapp", userId: lonely.id, personName: "L", planLabel: null, area: null,
  });
  assert.equal(none.contacts, 0);
  push.setPushSender(async () => {});
});


test("check-ins keep going after a miss (next one is scheduled)", () => {
  const user = makeUser("keeps-going@test.local");
  const plan = checkins.createPlan(user.id, {
    label: "Test", intervalMinutes: 1, graceMinutes: 1, question: "q?", answer: "a", endsAt: null,
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO checkin_occurrences (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, created_at)
     VALUES ('occ-miss-1', ?, ?, ?, ?, 'prompted', ?, ?)`
  ).run(plan.id, user.id, now - 70_000, now - 10_000, now - 70_000, now);
  const before = (db.prepare(`SELECT COUNT(*) AS c FROM checkin_occurrences WHERE plan_id = ? AND status = 'pending'`).get(plan.id) as { c: number }).c;

  const missed = checkins.claimOverdueOccurrences(now);
  assert.ok(missed.some((o) => o.occurrenceId === "occ-miss-1"));
  const next = db
    // Earliest pending = the one scheduled after the miss (the plan's own first
    // check-in, made at creation, is due later).
    .prepare(`SELECT due_at, deadline_at FROM checkin_occurrences WHERE plan_id = ? AND status = 'pending' ORDER BY due_at ASC LIMIT 1`)
    .get(plan.id) as { due_at: number; deadline_at: number };
  const after = (db.prepare(`SELECT COUNT(*) AS c FROM checkin_occurrences WHERE plan_id = ? AND status = 'pending'`).get(plan.id) as { c: number }).c;
  assert.equal(after, before + 1, "a new check-in was scheduled after the miss");
  assert.equal(next.due_at, now - 70_000 + 60_000, "one interval after the missed one");
  assert.equal(next.deadline_at - next.due_at, 60_000, "with the plan's answer window");
});

test("friends: request by code, accept, profile only for friends", async () => {
  const friends = await import("../src/repos/friends.js");
  const contacts = await import("../src/repos/emergencyContacts.js");
  const ana = makeUser("fr-ana@example.com");
  const bo = makeUser("fr-bo@example.com");
  const cy = makeUser("fr-cy@example.com");
  const boCode = friends.getFriendsOverview(bo.id).myCode;

  const sent = friends.requestFriend(ana.id, boCode.toLowerCase());
  assert.ok(sent.ok && sent.notify?.userId === bo.id && !sent.notify.accepted);
  // Pending: Bo sees the request; Ana sees only what she typed, not his name.
  assert.equal(friends.getFriendsOverview(bo.id).incoming[0].fromDisplayName, ana.display_name);
  assert.equal(friends.getFriendsOverview(ana.id).outgoing[0].label, boCode);
  assert.equal(friends.getFriendProfile(ana.id, bo.id), null, "no profile before accepting");

  const reqId = friends.getFriendsOverview(bo.id).incoming[0].id;
  assert.equal(friends.acceptFriend(ana.id, reqId), null, "only the addressee can accept");
  assert.equal(friends.acceptFriend(bo.id, reqId), ana.id);
  assert.equal(friends.getFriendsOverview(ana.id).friends[0].userId, bo.id);
  const profile = friends.getFriendProfile(ana.id, bo.id);
  assert.equal(profile?.displayName, bo.display_name);
  assert.equal(profile?.emergencyContact, "none");
  assert.equal(friends.getFriendProfile(cy.id, bo.id), null, "strangers can't see profiles");

  // A friend can be asked to be an emergency contact; it's still a request.
  assert.ok(contacts.requestContactForUser(ana.id, bo.id).ok);
  assert.equal(friends.getFriendProfile(ana.id, bo.id)?.emergencyContact, "pending");

  // Unfriend from either side.
  assert.equal(friends.removeFriendship(cy.id, reqId), null);
  assert.equal(friends.removeFriendship(bo.id, reqId), ana.id);
  assert.equal(friends.getFriendProfile(ana.id, bo.id), null);
});

test("friends: email replies don't reveal accounts; asking back accepts", async () => {
  const friends = await import("../src/repos/friends.js");
  const di = makeUser("fr-di@example.com");
  const ed = makeUser("fr-ed@example.com");
  const unknown = friends.requestFriend(di.id, "nobody-here@example.com");
  const known = friends.requestFriend(di.id, "FR-ED@example.com");
  assert.ok(unknown.ok && known.ok);
  assert.equal(
    unknown.message.replace("nobody-here@example.com", "X"),
    known.message.replace("fr-ed@example.com", "X"),
    "same reply whether or not the email has an account"
  );
  assert.equal(friends.getFriendsOverview(di.id).outgoing.length, 1, "nothing stored for unknown emails");
  // Ed asks Di back by email → they're friends, and Di is told.
  const back = friends.requestFriend(ed.id, "fr-di@example.com");
  assert.ok(back.ok && back.notify?.userId === di.id && back.notify.accepted);
  assert.ok(friends.areFriends(di.id, ed.id));
  assert.equal(friends.requestFriend(di.id, "fr-di@example.com").ok, false, "can't friend yourself");
});
