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
import { api, setTokenGetter, setUnauthorizedHandler } from "../api";

interface AuthContextValue {
  user: UserDTO | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setTokenGetter(null);
      setUser(null);
      setSyncing(false);
      return;
    }
    setTokenGetter(() => getToken());
    setSyncing(true);
    let active = true;
    void (async () => {
      try {
        const { user: appUser } = await api.me();
        if (active) setUser(appUser);
      } catch {
        if (active) setUser(null);
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
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setTokenGetter(null);
    await signOut({ redirectUrl: "/login" });
  }, [signOut]);

  const refresh = useCallback(async () => {
    try {
      const { user: appUser } = await api.me();
      setUser(appUser);
    } catch {
      // leave current state
    }
  }, []);

  const loading = !isLoaded || (isSignedIn && syncing);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, logout, refresh }),
    [user, loading, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
