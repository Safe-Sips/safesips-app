import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";
import { genId, nowMs, sha256 } from "../util.js";

interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  user_agent: string | null;
  ip_hash: string | null;
}

const insertSession = db.prepare(
  `INSERT INTO sessions (id, user_id, created_at, expires_at, revoked_at, user_agent, ip_hash)
   VALUES (@id, @user_id, @created_at, @expires_at, NULL, @user_agent, @ip_hash)`
);
const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const updateRevoked = db.prepare(
  `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`
);

/**
 * Sign a JWT and persist a revocable session row keyed by the token's `jti`.
 * The token carries only the user id (`sub`), session id (`jti`), and an
 * email-verified hint (`ev`). Identity never leaks onto the presence wire.
 */
export function issueToken(
  userId: string,
  emailVerified: boolean,
  opts: { userAgent?: string | null; ip?: string | null } = {}
): string {
  const now = nowMs();
  const sessionId = genId();
  insertSession.run({
    id: sessionId,
    user_id: userId,
    created_at: now,
    expires_at: now + config.jwtTtlDays * 86_400_000,
    user_agent: opts.userAgent ?? null,
    ip_hash: opts.ip ? sha256(opts.ip) : null,
  });
  return jwt.sign({ ev: emailVerified }, config.jwtSecret, {
    subject: userId,
    jwtid: sessionId,
    expiresIn: `${config.jwtTtlDays}d`,
  });
}

export interface VerifiedToken {
  userId: string;
  sessionId: string;
  emailVerifiedHint: boolean;
}

/** Verify a JWT and confirm its session is still valid (not revoked/expired). */
export function verifyToken(token: string): VerifiedToken | null {
  let decoded: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, config.jwtSecret);
    if (typeof result === "string") return null;
    decoded = result;
  } catch {
    return null;
  }

  const sub = decoded.sub;
  const jti = decoded.jti;
  if (typeof sub !== "string" || typeof jti !== "string") return null;

  const session = selectSession.get(jti) as SessionRow | undefined;
  if (!session) return null;
  if (session.revoked_at != null) return null;
  if (session.expires_at <= nowMs()) return null;
  if (session.user_id !== sub) return null;

  return { userId: sub, sessionId: jti, emailVerifiedHint: decoded.ev === true };
}

/** Revoke a session so its token can no longer be used (logout). */
export function revokeSession(sessionId: string): void {
  updateRevoked.run(nowMs(), sessionId);
}
