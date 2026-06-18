// Centralizovano citanje konfiguracije iz okruzenja.

export interface OlxConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  deviceName: string;
  clientId?: string;
  clientToken?: string;
  minRequestIntervalMs: number;
  maxRetries: number;
  timeoutMs: number;
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OlxConfig {
  return {
    baseUrl: (env.OLX_BASE_URL ?? "https://api.olx.ba").replace(/\/+$/, ""),
    token: env.OLX_TOKEN || undefined,
    username: env.OLX_USERNAME || undefined,
    password: env.OLX_PASSWORD || undefined,
    deviceName: env.OLX_DEVICE_NAME || "olx_pik_toolkit",
    clientId: env.OLX_CLIENT_ID || undefined,
    clientToken: env.OLX_CLIENT_TOKEN || undefined,
    minRequestIntervalMs: num(env.OLX_MIN_REQUEST_INTERVAL_MS, 350),
    maxRetries: num(env.OLX_MAX_RETRIES, 4),
    timeoutMs: num(env.OLX_TIMEOUT_MS, 20000),
  };
}
