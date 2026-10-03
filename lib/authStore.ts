import { create } from "zustand";

const USER_KEY = "ncd_web_user_v1";

export interface AuthUser {
  id: string;
  name: string;
  picture: string;
}

interface AuthState {
  user: AuthUser | null;
  signIn: (user: AuthUser) => void;
  signInGuest: () => void;
  signOut: () => void;
}

// decode a Google Identity Services JWT payload — client-side only, just to
// pull a stable per-account id/name/picture for save-slot namespacing. Not a
// security boundary (no backend to verify against), so no signature check.
function decodeCredential(jwt: string): AuthUser {
  const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { id: payload.sub, name: payload.name, picture: payload.picture };
}

function loadUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: loadUser(),
  signIn: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },
  signInGuest: () => {
    const guest: AuthUser = { id: "guest", name: "Guest", picture: "" };
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    set({ user: guest });
  },
  signOut: () => {
    localStorage.removeItem(USER_KEY);
    set({ user: null });
  },
}));

export { decodeCredential };
