import {
  useAuth as useClerkAuth,
  useClerk,
  useUser,
} from "@clerk/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserDTO } from "@safesips/shared";
import { ACCOUNT_SUSPENDED, api, ApiError, setTokenGetter, setUnauthorizedHandler } from "../api";

interface AuthContextValue {
  user: UserDTO | null;
  loading: boolean;
  syncError: string | null;
  /** A moderator suspended this account (syncError says why). */
  suspended: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Update fields of the signed-in user after a settings change. */
  patchUser: (patch: Partial<UserDTO>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The last account we loaded, kept on this device per Clerk user. With it the
 * app opens straight away instead of waiting for /api/me — which can take
 * many seconds when the API has to wake up — and refreshes in the background.
 */
const CACHE_PREFIX = "safesips.me.";

function readCachedUser(clerkId: string | undefined): UserDTO | null {
  if (!clerkId) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + clerkId);
    return raw ? (JSON.parse(raw) as UserDTO) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(clerkId: string | undefined, user: UserDTO | null): void {
  if (!clerkId) return;
  try {
    if (user) localStorage.setItem(CACHE_PREFIX + clerkId, JSON.stringify(user));
    else localStorage.removeItem(CACHE_PREFIX + clerkId);
  } catch {
    /* storage unavailable (private mode): just no fast start */
  }
}

/** Forget every remembered account on this device (no one is signed in). */
function clearCachedUsers(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * When my Clerk picture changes, ask the server to refresh its copy (it reads
 * the picture from Clerk itself), so friends see it. Best effort: a failure
 * just leaves the old picture.
 */
async function syncAvatar(user: UserDTO, clerkImage: string | null): Promise<UserDTO> {
  if ((user.imageUrl ?? null) === clerkImage) return user;
  try {
    const { imageUrl } = await api.setAvatar(clerkImage);
    return { ...user, imageUrl };
  } catch {
    return user;
  }
}

/** The server rejected this account/session, as opposed to being unreachable. */
function isAuthRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

async function waitForClerkToken(
  getToken: () => Promise<string | null>,
  attempts = 8
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const token = await getToken();
    if (token) return token;
    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // Signed out (here, on another device, or the session expired): don't
      // leave the account's name and email behind on this device.
      clearCachedUsers();
      setTokenGetter(null);
      setUser(null);
      setSyncError(null);
      setSuspended(false);
      setSyncing(false);
      return;
    }
    setTokenGetter(() => getToken());
    const clerkId = clerkUser?.id;
    const cached = readCachedUser(clerkId);
    if (cached) {
      // Open the app now; the sync below only refreshes it.
      setUser(cached);
      setSyncing(false);
    } else {
      setSyncing(true);
    }
    setSyncError(null);
    let active = true;
    void (async () => {
      try {
        const token = await waitForClerkToken(() => getToken());
        if (!token) {
          if (active) {
            writeCachedUser(clerkId, null);
            setUser(null);
            setSyncError(
              "Sign-in didn't return a session. Refresh the page and try again."
            );
          }
          return;
        }
        const { user: appUser } = await api.me();
        if (active) {
          const synced = await syncAvatar(appUser, clerkUser?.hasImage ? clerkUser.imageUrl : null);
          writeCachedUser(clerkId, synced);
          setUser(synced);
          setSyncError(null);
          setSuspended(false);
        }
      } catch (err) {
        if (!active) return;
        // API unreachable/waking up: keep using the remembered account (the
        // map shows its own connection state). Only a rejection signs us out.
        if (cached && !isAuthRejection(err)) return;
        writeCachedUser(clerkId, null);
        setUser(null);
        if (err instanceof ApiError) {
          setSyncError(err.message);
          setSuspended(err.code === ACCOUNT_SUSPENDED);
        } else {
          setSyncError("Could not reach the SafeSips API.");
        }
      } finally {
        if (active) setSyncing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, getToken, clerkUser?.id, clerkUser?.imageUrl]);

  useEffect(() => {
    setUnauthorizedHandler((err) => {
      // Don't wipe state during the initial sync; the catch path sets syncError.
      if (syncing) return;
      setUser(null);
      if (err.code === ACCOUNT_SUSPENDED) {
        // Suspended mid-session: forget the remembered account and say why.
        writeCachedUser(clerkUser?.id, null);
        setSyncError(err.message);
        setSuspended(true);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [syncing, clerkUser?.id]);

  const logout = useCallback(async () => {
    writeCachedUser(clerkUser?.id, null);
    setUser(null);
    setSyncError(null);
    setSuspended(false);
    setTokenGetter(null);
    await signOut({ redirectUrl: "/login" });
  }, [signOut, clerkUser?.id]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const token = await waitForClerkToken(() => getToken());
      if (!token) {
        setUser(null);
        setSyncError(
          "Sign-in didn't return a session. Refresh the page and try again."
        );
        return;
      }
      const { user: appUser } = await api.me();
      writeCachedUser(clerkUser?.id, appUser);
      setUser(appUser);
      setSyncError(null);
      setSuspended(false);
    } catch (err) {
      // Unreachable: keep the account we have. Rejected: sign out of the app.
      if (!isAuthRejection(err) && readCachedUser(clerkUser?.id)) return;
      writeCachedUser(clerkUser?.id, null);
      setUser(null);
      if (err instanceof ApiError) {
        setSyncError(err.message);
        setSuspended(err.code === ACCOUNT_SUSPENDED);
      } else setSyncError("Could not reach the SafeSips API.");
    } finally {
      setSyncing(false);
    }
  }, [getToken, clerkUser?.id]);

  const loading = !isLoaded || (isSignedIn && syncing);

  const patchUser = useCallback(
    (patch: Partial<UserDTO>) => {
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, ...patch };
        writeCachedUser(clerkUser?.id, next);
        return next;
      });
    },
    [clerkUser?.id]
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, syncError, suspended, logout, refresh, patchUser }),
    [user, loading, syncError, suspended, logout, refresh, patchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
