/**
 * Bloodline Dynamic Deployment & Environment Configuration.
 *
 * Automatically resolves the backend API and WebSocket endpoints based on the active
 * client environment, eliminating hardcoded hostnames or protocol mismatches.
 */

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiBaseUrl(): string {
  if (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim()) {
    return trimTrailingSlash(import.meta.env.VITE_API_BASE_URL.trim());
  }

  // Same-origin by default. Vite (dev) and the reverse proxy (prod) forward `/api`
  // to FastAPI, which avoids CORS failures and the old `:8000` guess that broke
  // whenever the UI was opened on a hostname the backend was not bound to.
  return '';
}

function resolveWebSocketUrl(apiBase: string): string {
  if (import.meta.env.VITE_WS_URL && import.meta.env.VITE_WS_URL.trim()) {
    return trimTrailingSlash(import.meta.env.VITE_WS_URL.trim());
  }

  if (!apiBase) {
    const protocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173';
    return `${protocol}//${host}/api/v1/realtime/ws`;
  }

  const wsScheme = apiBase.startsWith('https:') ? 'wss:' : 'ws:';
  const cleanBase = apiBase.replace(/^https?:/, wsScheme);
  return `${cleanBase}/api/v1/realtime/ws`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_V1 = `${API_BASE_URL}/api/v1`;
export const WS_URL = resolveWebSocketUrl(API_BASE_URL);
