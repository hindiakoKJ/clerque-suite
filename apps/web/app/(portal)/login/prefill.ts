/**
 * Hand a new owner's Tenant ID and email from the signup page to the sign-in
 * form, once.
 *
 * Signup used to put both in the address (/login?tenant=…&email=…), and the
 * sign-in page never read them: a new owner saw their Tenant ID for two and a
 * half seconds on the success screen and then had to type it from memory. An
 * email address also does not belong in a URL, where it lands in browser
 * history and server logs. So it travels in this tab's sessionStorage instead
 * and is removed the moment the sign-in page reads it.
 *
 * Every call is wrapped: private windows and blocked storage must never break
 * signup or sign-in. The `store` parameter exists so the spec can pass a fake.
 */
export const LOGIN_PREFILL_KEY = 'clerque.loginPrefill';

export interface LoginPrefill {
  tenantId: string;
  email:    string;
}

type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): StoreLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeLoginPrefill(value: LoginPrefill, store: StoreLike | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(LOGIN_PREFILL_KEY, JSON.stringify({
      tenantId: value.tenantId.trim(),
      email:    value.email.trim(),
    }));
  } catch {
    // storage full or blocked: the owner types the two fields, as before
  }
}

/** Read the prefill and remove it, so it is used once and never lingers. */
export function takeLoginPrefill(store: StoreLike | null = defaultStore()): LoginPrefill | null {
  if (!store) return null;
  try {
    const raw = store.getItem(LOGIN_PREFILL_KEY);
    if (!raw) return null;
    store.removeItem(LOGIN_PREFILL_KEY);
    const parsed = JSON.parse(raw) as Partial<LoginPrefill> | null;
    const tenantId = typeof parsed?.tenantId === 'string' ? parsed.tenantId.trim() : '';
    const email    = typeof parsed?.email === 'string' ? parsed.email.trim() : '';
    if (!tenantId && !email) return null;
    return { tenantId, email };
  } catch {
    return null;
  }
}
