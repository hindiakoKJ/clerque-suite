import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';
import { isDemoMode } from './demo/config';
import { demoApi } from './demo/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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

      processQueue(null, newAccess);
      original.headers.Authorization = `Bearer ${newAccess}`;
      return realApi(original);
    } catch (err) {
      processQueue(err, null);
      localStorage.removeItem('app-auth');
      window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);
