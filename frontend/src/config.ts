/**
 * Deployment configuration.
 *
 * The API origin used to be hardcoded as `http://127.0.0.1:8000` in 28 places across
 * the dashboards, so the built bundle could only ever talk to a local backend. Set
 * `VITE_API_BASE_URL` (see `.env.example`) to point at any environment.
 */

const DEFAULT_API_ORIGIN = 'http://127.0.0.1:8000';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_ORIGIN
);

export const API_V1 = `${API_BASE_URL}/api/v1`;

/** WebSocket origin: explicit override, else the API origin with its scheme swapped. */
export const WS_URL = `${
  trimTrailingSlash(import.meta.env.VITE_WS_URL?.trim() || API_BASE_URL.replace(/^http/, 'ws'))
}/api/v1/realtime/ws`;

/**
 * The role switcher is a demo affordance. It signs in as preset accounts with a
 * known password, so it must never be reachable in a production build.
 */
export const DEV_ROLE_SWITCHER = import.meta.env.DEV;
