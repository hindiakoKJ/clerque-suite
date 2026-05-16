/**
 * Clerque Counter — API client
 * Lightweight fetch wrapper over the Cloud API. Reads baseUrl from
 * `Constants.expoConfig.extra.apiBaseUrl`, attaches the JWT (from SecureStore
 * via `setAuthToken`) on every request, and throws typed errors so callers
 * can branch on `status` / `code` rather than parsing strings.
 */

import Constants from 'expo-constants';

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

export class ApiHttpError extends Error implements ApiError {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
  }
}

let authToken: string | null = null;

export function setAuthToken(jwt: string | null): void {
  authToken = jwt;
}

function getBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const url = extra.apiBaseUrl;
  if (!url) throw new ApiHttpError(0, 'CONFIG', 'apiBaseUrl missing from expo config');
  return url.replace(/\/+$/, '');
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // Network failure — no HTTP response was received.
    throw new ApiHttpError(0, 'NETWORK', err instanceof Error ? err.message : 'Network error');
  }

  // Some endpoints return 204 No Content.
  const text = await response.text();
  // Why `any`: we don't know the shape until we parse. Narrowed immediately below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = text.length > 0 ? safeJson(text) : undefined;

  if (!response.ok) {
    const code: string = parsed?.code ?? parsed?.error ?? `HTTP_${response.status}`;
    const message: string = parsed?.message ?? response.statusText ?? 'Request failed';
    throw new ApiHttpError(response.status, code, message);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  setAuthToken,
};
