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
    setSyncing(true);
    setSyncError(null);
    let active = true;
    void (async () => {
      try {
        const token = await waitForClerkToken(() => getToken());
        if (!token) {
          if (active) {
            setUser(null);
            setSyncError(
              "Clerk did not return a session token. Refresh, or confirm VITE_CLERK_PUBLISHABLE_KEY is set on Netlify."
            );
          }
          return;
        }
        const { user: appUser } = await api.me();
        if (active) {
          setUser(appUser);
          setSyncError(null);
        }
      } catch (err) {
        if (!active) return;
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
    setUser(null);
    setSyncError(null);
    setTokenGetter(null);
    await signOut({ redirectUrl: "/login" });
  }, [signOut]);

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
      setUser(appUser);
      setSyncError(null);
    } catch (err) {
      setUser(null);
      if (err instanceof ApiError) setSyncError(err.message);
      else setSyncError("Could not reach the SafeSips API.");
    } finally {
      setSyncing(false);
    }
  }, [getToken]);

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
