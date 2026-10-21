import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JwtPayload, AppCode, AccessLevel } from '@repo/shared-types';
import { levelValue } from '@repo/shared-types';
import { useCartStore } from './pos/cart';
import { setDisplayCurrency } from '@/lib/utils';
import { adoptShopOnLoad, adoptShopOnSignIn } from '@/lib/session/shop-state';

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
        // Every sign-in comes through here (password, PIN, a cashier switch at
        // the locked till). If the till on this device is another shop's -- a
        // shared tablet, or a handover to someone of a different shop -- it
        // is forgotten before this user sees a single screen of it.
        adoptShopOnSignIn(user.tenantId, get().user?.tenantId);
        set({ user });
        // Push tenant tax classification into the POS cart store so all VAT/discount
        // logic at checkout uses the correct BIR tax engine without extra API calls.
        useCartStore.getState().setTenantFlags(user.taxStatus ?? 'UNREGISTERED');
        // Tenant display currency for formatPeso/formatMoney (single-currency, default PHP).
        setDisplayCurrency(user.currency ?? 'PHP');
      },
      clear: () => {
        set({ accessToken: null, refreshToken: null, user: null });
        setDisplayCurrency('PHP');
      },

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
      // On reload the user is restored from localStorage without going through
      // setUser, so re-apply everything setUser derives. The tax flags are the
      // critical one: without this the cart store kept its safe default
      // 'UNREGISTERED' after ANY page refresh, so a VAT tenant's terminal
      // showed "Unregistered", computed vatAmount 0 on every line, and posted
      // sales with NO output VAT (assertVatConsistency only rejects the
      // opposite direction). Found in live end-to-end testing 2026-08-20.
      onRehydrateStorage: () => (state) => {
        setDisplayCurrency(state?.user?.currency ?? 'PHP');
        useCartStore.getState().setTenantFlags(state?.user?.taxStatus ?? 'UNREGISTERED');
        // Note which shop this device's till belongs to, so a later cashier
        // switch or handover can tell the same shop from another.
        if (state?.accessToken) adoptShopOnLoad(state.user?.tenantId);
      },
    },
  ),
);
