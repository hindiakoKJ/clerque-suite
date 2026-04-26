import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JwtPayload, AppCode, AccessLevel } from '@repo/shared-types';
import { levelValue } from '@repo/shared-types';
import { useCartStore } from './pos/cart';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: JwtPayload | null;

  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: JwtPayload) => void;
  clear: () => void;

  /** Check if the current user has at least the given level for an app */
  hasAccess: (app: AppCode, minLevel: AccessLevel) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,

      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => {
        set({ user });
        // Push tenant tax classification into the POS cart store so all VAT/discount
        // logic at checkout uses the correct BIR tax engine without extra API calls.
        useCartStore.getState().setTenantFlags(user.taxStatus ?? 'UNREGISTERED');
      },
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),

      hasAccess: (app, minLevel) => {
        const { user } = get();
        if (!user) return false;
        if (user.isSuperAdmin) return true;
        const entry = user.appAccess.find((a) => a.app === app);
        return levelValue(entry?.level) >= levelValue(minLevel);
      },
    }),
    {
      name: 'app-auth',
      // Only persist tokens; user is re-derived from token on load
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);
