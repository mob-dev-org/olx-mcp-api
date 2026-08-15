// Spisak Telegram grupa u kojima bot radi, iz access.json runtime mape.
//
// Zasto ovaj fajl uopste postoji: Bot API nema poziv koji vraca u kojim je bot grupama, pa se
// spisak mora negdje voditi. Voditi ga u `.env` znaci voditi ga dvaput, jer `access.json` isti
// spisak vec drzi za DOLAZNE poruke (`scripts/telegram-most.mjs` odbija svaku grupu koje tamo
// nema, a Telegram plugin cita isti fajl). Zato je access.json izvor i za odlazna odredista.
//
// Odvojen od `telegram.ts` iz istog razloga iz kojeg je `plan-fajl.ts` odvojen od `plan.ts`:
// tamo je mrezni sloj, ovdje disk i oblik podataka. Odluka o tome KOME se salje je cista
// funkcija `izaberiOdredista` u `telegram.ts`, pa se testira bez diska i bez mreze.

import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Politika jedne grupe. Nepoznata polja se cuvaju, jer ih Telegram plugin smije dopisati. */
export interface GrupaPolitika {
  requireMention?: boolean;
  allowFrom?: string[];
  [ostalo: string]: unknown;
}

/** Oblik access.json. Isti onaj koji pisu `pripremi-runtime.mjs` i Telegram plugin. */
export interface Pristup {
  dmPolicy: string;
  allowFrom: string[];
  groups: Record<string, GrupaPolitika>;
  pending: Record<string, unknown>;
  [ostalo: string]: unknown;
}

export type VrstaRuntimea = "klijent" | "admin";

const RUNTIME_MAPA: Record<VrstaRuntimea, string> = {
  klijent: ".claude-runtime",
  admin: ".claude-runtime-admin",
};

function jeObjekat(v: unknown): v is Record<string, unknown> {
  // Niz namjerno ispada: `Object.keys([])` bi vratio indekse i pretvorio ih u "grupe".
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Id-evi grupa iz sirovog JSON-a. Nevaljan oblik daje prazan spisak umjesto greske: bez fajla,
 * sa pokvarenim fajlom i sa praznim `groups` ishod za posiljaoca mora biti isti.
 */
export function grupeIzPristupa(sirovo: unknown): string[] {
  if (!jeObjekat(sirovo) || !jeObjekat(sirovo.groups)) return [];
  return Object.keys(sirovo.groups).filter((k) => k.trim().length > 0);
}

/**
 * Sirovi JSON u `Pristup` sa svim obaveznim poljima.
 *
 * Nepoznata polja na korijenu i u pojedinacnoj grupi PREZIVLJAVAJU: fajl dijelimo sa Telegram
 * pluginom, koji u njega smije upisati polja o kojima ovaj kod ne zna nista. Normalizacija koja
 * ih odbaci bi ih tiho obrisala pri prvom `telegram dodaj-grupu`.
 */
export function normalizujPristup(sirovo: unknown): Pristup {
  const izvor = jeObjekat(sirovo) ? sirovo : {};
  const grupe: Record<string, GrupaPolitika> = {};
  if (jeObjekat(izvor.groups)) {
    for (const [id, politika] of Object.entries(izvor.groups)) {
      if (id.trim().length === 0) continue;
      grupe[id] = jeObjekat(politika) ? (politika as GrupaPolitika) : {};
    }
  }
  return {
    ...izvor,
    dmPolicy: typeof izvor.dmPolicy === "string" ? izvor.dmPolicy : "allowlist",
    allowFrom: Array.isArray(izvor.allowFrom) ? izvor.allowFrom.map(String) : [],
    groups: grupe,
    pending: jeObjekat(izvor.pending) ? izvor.pending : {},
  };
}

/**
 * Idempotentno dodavanje grupe. Postojeca grupa se NE prepisuje: mijenjaju se samo polja koja su
 * izricito data. Bez toga bi ponovljena komanda tiho vratila `allowFrom` na podrazumijevani i
 * izbacila ljude kojima je pristup ranije dat rucno.
 *
 * Kad `izmjena.allowFrom` nije dat za NOVU grupu, nasljedjuje se korijenski `allowFrom`, jer je
 * to tacno ono sto `scripts/pripremi-runtime.mjs` radi za prvu grupu.
 */
export function dodajGrupu(p: Pristup, chatId: string, izmjena: Partial<GrupaPolitika> = {}): Pristup {
  const id = String(chatId).trim();
  if (!id) throw new Error("Id grupe je prazan.");
  const postojeca = p.groups[id];
  const politika: GrupaPolitika = postojeca
    ? { ...postojeca, ...izmjena }
    : {
        requireMention: izmjena.requireMention ?? false,
        allowFrom: izmjena.allowFrom ?? [...p.allowFrom],
        ...izmjena,
      };
  return { ...p, groups: { ...p.groups, [id]: politika } };
}

/** Idempotentno uklanjanje. Nepostojeca grupa nije greska. `allowFrom` i `pending` se ne diraju. */
export function ukloniGrupu(p: Pristup, chatId: string): Pristup {
  const id = String(chatId).trim();
  if (!(id in p.groups)) return p;
  const grupe = { ...p.groups };
  delete grupe[id];
  return { ...p, groups: grupe };
}

/** true kad je grupa u spisku. */
export function imaGrupu(p: Pristup, chatId: string): boolean {
  return String(chatId).trim() in p.groups;
}

// ===== disk =====

/** Korijen klona kojem pripada ovaj build (dist/core/ pa dva nivoa gore). */
function korijenBuilda(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Putanja do access.json.
 *
 * Redoslijed: env override, pa runtime mapa relativna na radnu mapu, pa ista mapa u korijenu
 * klona kojem pripada ovaj build. Zadnji korak nije visak: CLI vec radi isto za `.env`
 * (`src/cli/index.ts`), pa bez njega pokretanje iz drugog direktorija nadje token a ne nadje
 * grupe, i izvjestaj tiho ode u manje grupa nego sto treba. Tiha djelimicna isporuka je gora od
 * greske.
 */
export function putanjaPristupa(vrsta: VrstaRuntimea = "klijent", env: NodeJS.ProcessEnv = process.env): string {
  const override = vrsta === "klijent" ? env.OLX_TELEGRAM_ACCESS_FILE : env.OLX_TELEGRAM_ACCESS_FILE_ADMIN;
  if (override) return override;
  const rep = join(RUNTIME_MAPA[vrsta], "channels", "telegram", "access.json");
  if (existsSync(rep)) return rep;
  const uKorijenu = join(korijenBuilda(), rep);
  return existsSync(uKorijenu) ? uKorijenu : rep;
}

/** Parsiran access.json, ili null kad ga nema ili je pokvaren. Nikad ne baca. */
export function citajPristup(putanja?: string): Pristup | null {
  const p = putanja ?? putanjaPristupa();
  try {
    return normalizujPristup(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Upisuje access.json atomicno.
 *
 * `chmod 0600` ide na PRIVREMENI fajl prije preimenovanja, ne na gotov fajl poslije: tmp nastaje
 * po umask-u, pa bi obrnut redoslijed ostavio prozor u kojem access.json ima sire dozvole nego
 * sto ih je `pripremi-runtime.mjs` postavio.
 *
 * `mtimeOcekivan` je brana od izgubljenog upisa: isti fajl pise i Telegram plugin kad odobri
 * uparivanje, pa bi citaj-izmijeni-upisi bez provjere moglo pojesti tudju izmjenu.
 */
export function upisiPristup(p: Pristup, opcije: { putanja?: string; mtimeOcekivan?: number } = {}): void {
  const putanja = opcije.putanja ?? putanjaPristupa();
  if (!existsSync(putanja)) {
    throw new Error(
      `Nema ${putanja}. Runtime se ne pravi ovom komandom, jer bi nastao polovican: ` +
        "pokreni prvo bun scripts/pripremi-runtime.mjs.",
    );
  }
  if (opcije.mtimeOcekivan !== undefined) {
    const sada = statSync(putanja).mtimeMs;
    if (sada !== opcije.mtimeOcekivan) {
      throw new Error(`${putanja} je promijenjen u medjuvremenu (vjerovatno Telegram plugin). Ponovi komandu.`);
    }
  }
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`, "utf8");
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows: chmod ne znaci nista i tiho prolazi, isto kao u pripremi skriptama.
  }
  renameSync(tmp, putanja);
}

/** Vrijeme zadnje izmjene, za branu iz `upisiPristup`. null kad fajla nema. */
export function mtimePristupa(putanja?: string): number | null {
  try {
    return statSync(putanja ?? putanjaPristupa()).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Grupe KLIJENTSKOG bota, jedini izvor odredista za izvjestaj.
 *
 * Admin runtime se ovdje namjerno ne cita. Admin bot je vlasnikov kanal i njegove grupe ne smiju
 * postati odrediste klijentskog izvjestaja; uz to je `TELEGRAM_BOT_TOKEN` u `.env` klijentov bot,
 * pa bi slanje u admin grupu ionako palo na 403.
 */
export function grupeKlijenta(env: NodeJS.ProcessEnv = process.env): string[] {
  return grupeIzPristupa(citajPristup(putanjaPristupa("klijent", env)));
}
