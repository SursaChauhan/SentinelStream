// frontend/src/auth/AuthContext.tsx
//
// React Context for authentication state.
//
// WHAT IS CONTEXT?
//   React Context is a way to share data across your component tree
//   without passing it as props to every child.
//   Think of it as "global state" for the auth session.
//
// HOW IT WORKS HERE:
//   1. <AuthProvider> wraps the whole app in App.tsx
//   2. Any component calls useAuth() to get { user, token, login, logout }
//   3. login() stores the JWT in localStorage (persists across browser refresh)
//   4. logout() clears it
//   5. ProtectedRoute checks auth — if not logged in, redirects to /login

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User } from "../api/types";

interface AuthState {
  user:    User | null;
  token:   string | null;
  login:   (token: string, user: User) => void;
  logout:  () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

// Read persisted session from localStorage on startup
function loadSession(): { token: string; user: User } | null {
  try {
    const token = localStorage.getItem("sentinel_token");
    const user  = localStorage.getItem("sentinel_user");
    if (token && user) return { token, user: JSON.parse(user) };
  } catch { /* ignore parse errors */ }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = loadSession();

  const [token, setToken] = useState<string | null>(session?.token ?? null);
  const [user, setUser]   = useState<User | null>(session?.user ?? null);

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem("sentinel_token", newToken);
    localStorage.setItem("sentinel_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("sentinel_token");
    localStorage.removeItem("sentinel_user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook — components call this to access auth state
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
