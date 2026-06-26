import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthResponse, RegisterInput, UserDTO } from "@safesips/shared";
import { api, setAuthToken, setUnauthorizedHandler } from "../api";

const TOKEN_KEY = "safesips.auth";

interface AuthContextValue {
  user: UserDTO | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (input: RegisterInput) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const clearLocal = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  // Apply the token to the API client immediately when it changes.
  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  // A 401 anywhere means the session is gone — drop local auth.
  useEffect(() => {
    setUnauthorizedHandler(() => clearLocal());
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  // On boot, rehydrate the user from a stored token.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      setAuthToken(token);
      try {
        const { user } = await api.me();
        if (active) setUser(user);
      } catch {
        if (active) clearLocal();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyAuth = useCallback((res: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      applyAuth(res);
      return res;
    },
    [applyAuth]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api.register(input);
      applyAuth(res);
      return res;
    },
    [applyAuth]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore network errors on logout
    }
    clearLocal();
  }, [clearLocal]);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      // leave current state
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, logout, refresh }),
    [user, token, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
