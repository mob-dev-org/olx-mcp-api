// Centralizovano citanje konfiguracije iz okruzenja.
//
// Jedan klon repozitorija radi za JEDAN nalog: jedan `OLX_TOKEN` (ili jedan par
// `OLX_USERNAME`/`OLX_PASSWORD`). Za drugog klijenta se klonira repo i u njemu postavi njegov
// token. Zato ovdje nema profila ni prebacivanja naloga: radnja ne moze zavrsiti na pogresnom
// klijentu jer u procesu postoji samo jedan nalog.

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
  // Putanja audit loga (upisi i troskovi). Van gita, po klonu.
  auditFile: string;
  // Da li se u audit log pisu i citanja (GET). Default ne, da log ostane pregledan.
  auditReads: boolean;
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
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
    auditFile: env.OLX_AUDIT_FILE || ".olx-pik/audit.jsonl",
    auditReads: bool(env.OLX_AUDIT_READS, false),
  };
}
