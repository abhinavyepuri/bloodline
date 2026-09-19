import { API_V1 } from '../config';

let currentToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  currentToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  token?: string | null;
}

function formatApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          const loc = Array.isArray(rec.loc) ? rec.loc.filter((p) => p !== 'body').join('.') : rec.field;
          const msg = rec.msg || rec.message;
          if (msg && loc) return `${loc}: ${msg}`;
          if (typeof msg === 'string') return msg;
        }
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  return '';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const errorJson = await response.json();
    const fromDetail = formatApiDetail(errorJson.detail);
    if (fromDetail) return fromDetail;
    if (typeof errorJson.message === 'string' && errorJson.message) return errorJson.message;
    return JSON.stringify(errorJson);
  } catch {
    return response.statusText || `Request failed with status ${response.status}`;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${API_V1}${path.startsWith('/') ? '' : '/'}${path}`;

  if (options.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (method !== 'GET' && method !== 'HEAD' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const authToken = options.token !== undefined ? options.token : currentToken;
  if (authToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const { params: _params, token: _token, headers: _headers, ...fetchOptions } = options;

  // 15-second hard timeout — abort the request if the backend is unreachable or stuck.
  // We use a named flag so that when the *caller's* AbortController fires (e.g. the
  // dashboard cancelling a stale in-flight fetch), we don't mistakenly show the
  // "Request timed out" error — that abort is intentional and should be silently ignored.
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, 15_000);

  // Merge caller signal with our timeout signal
  const callerSignal = fetchOptions.signal as AbortSignal | undefined;
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (didTimeout) {
        // Real 15-second timeout — show the user a helpful message
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      // Deliberate cancel by the caller (e.g. component unmount / stale fetch cancel)
      // — silently re-throw so callers can handle it
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    if (unauthorizedHandler) {
      unauthorizedHandler();
    }
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  return text as unknown as T;
}

export const api = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'DELETE' });
  },
};

export async function loginRequest<T = any>(
  path: string,
  credentials: { email: string; password: string }
): Promise<T> {
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${API_V1}${path.startsWith('/') ? '' : '/'}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Login request timed out. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as T;
}
