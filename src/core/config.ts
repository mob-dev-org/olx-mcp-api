import { readFileSync } from "node:fs";
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
  /**
   * Dan u mjesecu kad se obnavlja kvota besplatnih obnova, 1 do 31. Rezerva za nalog bez shopa:
   * inace se dan cita iz `shop.ends_at` i ovo ostaje prazno. Postavljena vrijednost ima prednost
   * nad izmjerenim danom iz kvota dnevnika, isto kao ciklus (olx://pravila-brojeva).
   */
  danCiklusaKvote?: number;
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

// Dan u mjesecu: van opsega 1 do 31 se odbacuje umjesto da se steze, jer bi stezanje pogresno
// upisan dan (0, 45) tiho pretvorilo u rok koji se onda TVRDI korisniku.
function danUMjesecu(value: string | undefined): number | undefined {
  const parsed = opcioniBroj(value);
  if (parsed === undefined) return undefined;
  const cio = Math.floor(parsed);
  return cio >= 1 && cio <= 31 ? cio : undefined;
}

// Nepoznata vrijednost pada na `admin`, ne na `klijent`: pogresno napisan profil ne smije tiho
// sakriti alate i ostaviti dojam da toolkit nesto ne moze.
function profil(value: string | undefined): McpProfil {
  return value?.trim().toLowerCase() === "klijent" ? "klijent" : "admin";
}

// Svaki proces se OLX-u predstavlja svojim imenom uredjaja. Kad bi MCP sesija i nocni cron
// dijelili device_name, login jednog bi na strani OLX-a mogao ponistiti token drugog, pa bi
// ziva sesija osvanula sa 401 usred noci. Sufiks se izvodi iz pokrenute skripte.
function deviceIme(env: NodeJS.ProcessEnv): string {
  const osnova = env.OLX_DEVICE_NAME || "olx_pik_toolkit";
  if (env.OLX_DEVICE_NAME) return osnova; // izricito zadan naziv se ne dira
  const skripta = process.argv[1] ?? "";
  const vrsta = skripta.includes("mcp") ? "mcp" : skripta.includes("cli") ? "cli" : "proc";
  return `${osnova}_${vrsta}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OlxConfig {
  return {
    baseUrl: (env.OLX_BASE_URL ?? "https://api.olx.ba").replace(/\/+$/, ""),
    token: env.OLX_TOKEN || undefined,
    username: env.OLX_USERNAME || undefined,
    password: env.OLX_PASSWORD || undefined,
    deviceName: deviceIme(env),
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
    danCiklusaKvote: danUMjesecu(env.OLX_DAN_CIKLUSA_KVOTE),
  };
}

/**
 * Procita JEDNU vrijednost iz `.env` fajla, bez diranja `process.env`.
 *
 * Zasto ovako a ne `process.loadEnvFile`: on NE gazi vec postavljen env (na to se oslanja cuvar
 * sesija, vidi .claude/rules/core-kod.md), pa se ponovnim pozivom nov token nikad ne bi vidio.
 * Ovdje treba upravo obrnuto: procitati sto je NA DISKU sada.
 *
 * Zasto uopste treba: token upisan u `.env` dok sesija radi (onboarding, rotacija) procesu koji
 * je vec startovao ostaje nevidljiv, jer se `.env` cita jednom pri startu. Poziv na 401 ovim
 * saznaje da je token u medjuvremenu zamijenjen i izbjegne restart cijele sesije.
 *
 * Parsiranje je namjerno minimalno: `KLJUC=vrijednost`, komentari i prazni redovi se preskacu,
 * obicni i dvostruki navodnici se skidaju. Nema interpolacije i nema visereda.
 */
export function procitajIzEnvFajla(kljuc: string, putanja = ".env"): string | undefined {
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch {
    return undefined; // nema fajla: nema sta da se procita, pozivalac ostaje na starom
  }
  for (const red of sadrzaj.split("\n")) {
    const t = red.trim();
    if (!t || t.startsWith("#")) continue;
    const znak = t.indexOf("=");
    if (znak < 1) continue;
    if (t.slice(0, znak).trim() !== kljuc) continue;
    const sirovo = t.slice(znak + 1).trim();
    const bezNavodnika = /^(".*"|'.*')$/.test(sirovo) ? sirovo.slice(1, -1) : sirovo;
    return bezNavodnika || undefined;
  }
  return undefined;
}
