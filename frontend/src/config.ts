/**
 * SmartBlood Dynamic Deployment & Environment Configuration.
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

  // Dynamically adapt to current browser origin (localhost, 127.0.0.1, LAN IP, or custom domain)
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname || 'localhost';
    // When developing on port 5173 or 8080, the FastAPI backend listens on port 8000
    return `${protocol}//${hostname}:8000`;
  }

  return 'http://localhost:8000';
}

function resolveWebSocketUrl(apiBase: string): string {
  if (import.meta.env.VITE_WS_URL && import.meta.env.VITE_WS_URL.trim()) {
    return trimTrailingSlash(import.meta.env.VITE_WS_URL.trim());
  }

  const wsScheme = apiBase.startsWith('https:') ? 'wss:' : 'ws:';
  const cleanBase = apiBase.replace(/^https?:/, wsScheme);
  return `${cleanBase}/api/v1/realtime/ws`;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_V1 = `${API_BASE_URL}/api/v1`;
export const WS_URL = resolveWebSocketUrl(API_BASE_URL);
