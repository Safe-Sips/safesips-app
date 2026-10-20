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
import { api, ApiError, setTokenGetter, setUnauthorizedHandler } from "../api";

interface AuthContextValue {
  user: UserDTO | null;
  loading: boolean;
  syncError: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
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

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setTokenGetter(null);
      setUser(null);
      setSyncError(null);
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
              "Clerk did not return a session token. Refresh, or confirm VITE_CLERK_PUBLISHABLE_KEY is set on Netlify."
            );
          }
          return;
        }
        const { user: appUser } = await api.me();
        if (active) {
          writeCachedUser(clerkId, appUser);
          setUser(appUser);
          setSyncError(null);
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
  }, [isLoaded, isSignedIn, getToken, clerkUser?.id]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Don't wipe state during the initial sync; the catch path sets syncError.
      if (syncing) return;
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [syncing]);

  const logout = useCallback(async () => {
    writeCachedUser(clerkUser?.id, null);
    setUser(null);
    setSyncError(null);
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
          "Clerk did not return a session token. Refresh, or confirm VITE_CLERK_PUBLISHABLE_KEY is set on Netlify."
        );
        return;
      }
      const { user: appUser } = await api.me();
      writeCachedUser(clerkUser?.id, appUser);
      setUser(appUser);
      setSyncError(null);
    } catch (err) {
      // Unreachable: keep the account we have. Rejected: sign out of the app.
      if (!isAuthRejection(err) && readCachedUser(clerkUser?.id)) return;
      writeCachedUser(clerkUser?.id, null);
      setUser(null);
      if (err instanceof ApiError) setSyncError(err.message);
      else setSyncError("Could not reach the SafeSips API.");
    } finally {
      setSyncing(false);
    }
  }, [getToken, clerkUser?.id]);

  const loading = !isLoaded || (isSignedIn && syncing);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, syncError, logout, refresh }),
    [user, loading, syncError, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
