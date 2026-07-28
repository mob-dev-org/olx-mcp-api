// Centralizovano citanje konfiguracije iz okruzenja.
//
// Jedan klon repozitorija radi za JEDAN nalog: jedan `OLX_TOKEN` (ili jedan par
// `OLX_USERNAME`/`OLX_PASSWORD`). Za drugog klijenta se klonira repo i u njemu postavi njegov
// token. Zato ovdje nema profila ni prebacivanja naloga: radnja ne moze zavrsiti na pogresnom
// klijentu jer u procesu postoji samo jedan nalog.

// Koliko alata MCP server izlaze. `admin` je puna lista za rad na repou; `klijent` je suzena
// lista za bota kojim se sluzi musterija preko Telegrama. Default je `admin`, da postojeci
// klonovi ne promijene ponasanje bez izmjene .env fajla.
export type McpProfil = "admin" | "klijent";

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
  // Koje alate MCP server registruje.
  mcpProfil: McpProfil;
  // Tvrdi dnevni plafon potrosnje u kreditima. 0 znaci bez plafona.
  maxSpendPerDay: number;
  // Podrazumijevana lokacija za objavu, da model ne mora pretrazivati gradove.
  defaultCountryId?: number;
  defaultCityId?: number;
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

function opcioniBroj(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Nepoznata vrijednost pada na `admin`, ne na `klijent`: pogresno napisan profil ne smije tiho
// sakriti alate i ostaviti dojam da toolkit nesto ne moze.
function profil(value: string | undefined): McpProfil {
  return value?.trim().toLowerCase() === "klijent" ? "klijent" : "admin";
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
    mcpProfil: profil(env.OLX_MCP_PROFILE),
    maxSpendPerDay: num(env.OLX_MAX_SPEND_PER_DAY, 0),
    defaultCountryId: opcioniBroj(env.OLX_DEFAULT_COUNTRY_ID),
    defaultCityId: opcioniBroj(env.OLX_DEFAULT_CITY_ID),
  };
}
