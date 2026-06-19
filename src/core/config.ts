// Centralizovano citanje konfiguracije iz okruzenja.

import { existsSync, readFileSync } from "node:fs";

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

// Jedan klijent (kupac) = jedan profil sa svojim tokenom i opciono svojim base URL-om.
export interface OlxProfile {
  token: string;
  baseUrl?: string;
}

export interface OlxProfiles {
  defaultProfile?: string;
  profiles: Record<string, OlxProfile>;
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

// Ucitava profile (vise tokena) iz dva izvora, redom:
// 1. JSON fajl (OLX_PROFILES_FILE, default .olx-profiles.json) sa { default, profiles: { ime: token | {token, base_url} } }
// 2. env varijable oblika OLX_TOKEN_<IME> (npr. OLX_TOKEN_KLIJENTA), gdje ime postaje malim slovima
// Aktivni profil bira OLX_PROFILE (env) ili "default" iz fajla. Tokeni nikad ne idu u git.
export function loadProfiles(env: NodeJS.ProcessEnv = process.env): OlxProfiles {
  const profiles: Record<string, OlxProfile> = {};
  let fileDefault: string | undefined;

  const file = env.OLX_PROFILES_FILE || ".olx-profiles.json";
  if (existsSync(file)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (raw && typeof raw === "object") {
        const obj = raw as { default?: unknown; profiles?: unknown };
        if (typeof obj.default === "string") fileDefault = obj.default;
        if (obj.profiles && typeof obj.profiles === "object") {
          for (const [name, value] of Object.entries(obj.profiles as Record<string, unknown>)) {
            if (typeof value === "string") {
              profiles[name] = { token: value };
            } else if (value && typeof value === "object") {
              const v = value as { token?: unknown; base_url?: unknown; baseUrl?: unknown };
              if (typeof v.token === "string") {
                const baseUrl = typeof v.base_url === "string" ? v.base_url : typeof v.baseUrl === "string" ? v.baseUrl : undefined;
                profiles[name] = baseUrl ? { token: v.token, baseUrl } : { token: v.token };
              }
            }
          }
        }
      }
    } catch {
      // Neispravan profiles fajl se ignorise; ostaju env profili i jedan OLX_TOKEN.
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    const match = key.match(/^OLX_TOKEN_(.+)$/);
    if (!match) continue;
    const name = match[1];
    if (name) profiles[name.toLowerCase()] = { token: value };
  }

  const defaultProfile = env.OLX_PROFILE || fileDefault;
  return { defaultProfile, profiles };
}

export function listProfileNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(loadProfiles(env).profiles).sort();
}

// Sklapa konfiguraciju za zeljeni profil. Bez profila vraca obican loadConfig (jedan OLX_TOKEN).
// Baca jasnu gresku ako je trazen profil koji ne postoji, da se ne radi tiho na pogresnom nalogu.
export function resolveConfig(
  profileName?: string,
  env: NodeJS.ProcessEnv = process.env,
): { config: OlxConfig; profile?: string } {
  const base = loadConfig(env);
  const { defaultProfile, profiles } = loadProfiles(env);
  const chosen = profileName || defaultProfile;
  if (!chosen) return { config: base };

  const profile = profiles[chosen];
  if (!profile) {
    const available = Object.keys(profiles).join(", ") || "(nijedan profil nije konfigurisan)";
    throw new Error(`Nepoznat OLX profil: ${chosen}. Dostupni: ${available}.`);
  }
  return {
    config: { ...base, token: profile.token, baseUrl: profile.baseUrl ?? base.baseUrl },
    profile: chosen,
  };
}
