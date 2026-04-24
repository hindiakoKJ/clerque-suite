import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from '@repo/shared-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

/* ─── Request interceptor — attach Bearer token ──────────────────────────── */
api.interceptors.request.use((config) => {
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

api.interceptors.response.use(
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
        return api(original);
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
      return api(original);
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
