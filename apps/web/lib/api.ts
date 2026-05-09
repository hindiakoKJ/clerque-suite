import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';
import { isDemoMode } from './demo/config';
import { demoApi } from './demo/api';
import { requestSlugConfirmation } from '@/components/admin/ConfirmSlugModal';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Resolve a server-relative path (e.g. "/uploads/public/products/..jpg") into
 * a full URL the browser can render in <img src>. Strips the /api/v1 prefix
 * if it's baked into NEXT_PUBLIC_API_URL — static assets are served at the
 * origin level, not under the API prefix.
 *
 * Pass-through for absolute URLs so existing rows that store fully-qualified
 * external URLs (or third-party image hosts) keep rendering unchanged.
 */
export function resolveAssetUrl(pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = API_URL.replace(/\/api\/v\d+$/, '');
  return origin + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}

const realApi = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Public api client.  Routes to the demo adapter when demo mode is active
 * (cookie or sessionStorage flag set by /demo entry).  Otherwise routes
 * to the real backend via axios.
 *
 * Each method preserves axios's type signature (Promise<AxiosResponse<T>>)
 * so TanStack Query's `queryFn: () => api.get<T>(...).then(r => r.data)`
 * keeps inferring T correctly.  In demo mode, the response is shaped
 * identically (`{ data, status }`) which structurally satisfies AxiosResponse.
 */
function inDemo(): boolean {
  return typeof window !== 'undefined' && isDemoMode();
}

export const api = {
  defaults: realApi.defaults,
  interceptors: realApi.interceptors,

  get: <T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    if (inDemo()) {
      return demoApi.get<T>(url, config as never) as unknown as Promise<AxiosResponse<T>>;
    }
    return realApi.get<T>(url, config);
  },

  post: <T = any>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    if (inDemo()) {
      return demoApi.post<T>(url, body, config as never) as unknown as Promise<AxiosResponse<T>>;
    }
    return realApi.post<T>(url, body, config);
  },

  patch: <T = any>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    if (inDemo()) {
      return demoApi.patch<T>(url, body, config as never) as unknown as Promise<AxiosResponse<T>>;
    }
    return realApi.patch<T>(url, body, config);
  },

  put: <T = any>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    if (inDemo()) {
      return demoApi.put<T>(url, body, config as never) as unknown as Promise<AxiosResponse<T>>;
    }
    return realApi.put<T>(url, body, config);
  },

  delete: <T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
    if (inDemo()) {
      return demoApi.delete<T>(url, config as never) as unknown as Promise<AxiosResponse<T>>;
    }
    return realApi.delete<T>(url, config);
  },
};

/* ─── Request interceptor — attach Bearer token ──────────────────────────── */
realApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('app-auth');
      if (raw) {
        const { state } = JSON.parse(raw) as { state: { accessToken: string | null } };
        if (state.accessToken) {
          config.headers.Authorization = `Bearer ${state.accessToken}`;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return config;
});

/* ─── Response interceptor — handle 401 with token refresh ──────────────── */
let isRefreshing = false;
let failQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null) {
  failQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failQueue = [];
}

realApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // Sprint 19 — Global handler for destructive-op slug confirmation.
    // Any backend endpoint that throws { code: 'CONFIRMATION_REQUIRED' }
    // surfaces a window.prompt asking for the tenant slug, then retries
    // the original request with `confirmationToken` injected into the body.
    // This replaces the per-component prompt-retry wrappers, so every
    // destructive op (Reset Demo, Clear All Data, Reset PW for high-priv
    // roles, plan downgrade, suspend, etc.) gets consistent UX.
    const errCode = (error.response?.data as { code?: string } | undefined)?.code;
    const errMsg  = (error.response?.data as { message?: string } | undefined)?.message;
    if (
      errCode === 'CONFIRMATION_REQUIRED' &&
      !original._confirmRetried &&
      typeof window !== 'undefined' &&
      original.method && ['post', 'patch', 'put', 'delete'].includes(original.method.toLowerCase())
    ) {
      original._confirmRetried = true;
      // Use the in-page React modal (ConfirmSlugModal) — window.prompt can be
      // suppressed silently by Chrome / Brave / extensions, leaving the user
      // with a 400 toast and no path forward. The modal cannot be blocked.
      const typed = await requestSlugConfirmation(
        errMsg ?? 'Destructive operation — type the tenant slug to confirm.',
      );
      if (typed == null || !typed.trim()) {
        return Promise.reject(error); // user cancelled — bubble original error
      }
      // Inject confirmationToken into the body and retry. Multipart bodies
      // (FormData) don't apply here — they're not destructive endpoints.
      try {
        const body = original.data
          ? (typeof original.data === 'string' ? JSON.parse(original.data) : original.data)
          : {};
        body.confirmationToken = typed.trim();
        original.data = JSON.stringify(body);
        original.headers = { ...original.headers, 'Content-Type': 'application/json' };
      } catch {
        original.data = JSON.stringify({ confirmationToken: typed.trim() });
      }
      return realApi(original);
    }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return realApi(original);
      });
    }

    isRefreshing = true;

    try {
      const raw = localStorage.getItem('app-auth');
      const { state } = JSON.parse(raw ?? '{}') as { state: { refreshToken: string | null } };
      if (!state.refreshToken) throw new Error('No refresh token');

      const { data } = await axios.post(`${API_URL}/auth/refresh`, {
        refreshToken: state.refreshToken,
      });

      const newAccess: string = data.accessToken;
      const newUser = jwtDecode<JwtPayload>(newAccess);

      // Update store directly via localStorage (avoids circular import)
      const stored = JSON.parse(localStorage.getItem('app-auth') ?? '{}');
      stored.state = {
        ...stored.state,
        accessToken: newAccess,
        refreshToken: data.refreshToken,
        user: newUser,
      };
      localStorage.setItem('app-auth', JSON.stringify(stored));

      // CRITICAL: also mirror the refreshed access token into the
      // `app-session` cookie so the Next.js middleware sees the new value.
      // Without this, the middleware decodes the OLD (revoked) token on the
      // next navigation, JWT verify fails, and the user gets bounced to /login
      // — appearing as an inexplicable redirect loop after a successful refresh.
      //
      // Hardening notes:
      //   - `Secure` is added when the page is served over https (production
      //     on Vercel + custom domains). Localhost over http omits it so the
      //     dev cookie still works.
      // Sprint 17/18 — server also sets an HttpOnly `app-session` cookie on
      // its own origin. That's scoped to the API host (e.g. localhost:3001),
      // so the web's Next.js middleware (running on the web host) can't read
      // it. Until we ship a same-origin /api proxy, we ALSO write a
      // non-HttpOnly mirror on the web origin so middleware can authenticate.
      const isProd = window.location.protocol === 'https:';
      document.cookie =
        `app-session=${newAccess}; path=/; SameSite=Lax` +
        (isProd ? '; Secure' : '');

      processQueue(null, newAccess);
      original.headers.Authorization = `Bearer ${newAccess}`;
      return realApi(original);
    } catch (err) {
      processQueue(err, null);
      localStorage.removeItem('app-auth');
      // Expire the web-origin mirror cookie so middleware doesn't see a
      // stale token. The API's own HttpOnly copy gets cleared by the next
      // failed /auth/refresh (401) or an explicit POST /auth/logout.
      document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);
