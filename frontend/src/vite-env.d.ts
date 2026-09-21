/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base origin of the Bloodline API, e.g. https://api.example.org */
  readonly VITE_API_BASE_URL?: string;
  /** Optional explicit WebSocket origin; defaults to VITE_API_BASE_URL with ws(s):// */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
