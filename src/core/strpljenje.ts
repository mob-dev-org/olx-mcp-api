// Prosireno strpljenje na 429, SAMO za dugotrajne CRON tokove (danas: `stats snapshot`).
//
// Zasto scope (AsyncLocalStorage), a ne parametar koji se dodaje u `request()` / `listAllByState`
// / `listActive` / `getListing` i svakog buduceg pozivaoca: probijanje parametra kroz cijeli lanac
// znaci da se SVAKO novo mjesto poziva mora sjetiti da ga proslijedi, a tiho zaboravljanje (novi
// poziv koji ostane bez politike) je najvjerovatniji nacin kvara. Scope u ALS-u se umjesto toga
// postavlja JEDNOM na ulazu u dugotrajan tok (`withStrpljenje429`) i vazi za sve pozive nastale
// unutar njega, bez obzira koliko slojeva ima izmedju.
//
// STROGO: ovo je politika za CRON. MCP alat i Telegram bot NIKAD ne smiju uci u ovaj scope, jer
// klijent u zivom razgovoru ne smije cekati minutama na odgovor. Poziv `withStrpljenje429` postoji
// SAMO u CLI komandi `stats snapshot` i u testovima ovog modula.
//
// Uzor: `withAuditContext` / `currentAuditContext` u `audit.ts` (isti ALS obrazac, drugi cilj).

import { AsyncLocalStorage } from "node:async_hooks";

export interface Politika429 {
  // Koliko PROSIRENIH pokusaja (povrh globalnog `maxRetries`) smije potrositi jedno pokretanje.
  pokusaja: number;
  // Kumulativni plafon (ms) koliko NAJDUZE smije cekati na 429 unutar jednog pokretanja.
  ukupnoMs: number;
}

export interface StrpljenjeScope {
  politika: Politika429;
  // Mutabilno: sabira se kroz vise poziva `planStrpljenja` unutar istog pokretanja, jer plafon
  // vazi za CIJEL scope, ne za jedan HTTP poziv.
  potroseno_ms: number;
}

const storage = new AsyncLocalStorage<StrpljenjeScope>();

// Krov jednog cekanja u prosirenoj grani. Iznad ovoga eksponencijalni rast prestaje da raste i
// cekanje ostaje fiksno, da uporan 429 ne producira sve dulje pauze bez granice.
export const BACKOFF_MAX_MS = 45000;

// Osnova eksponencijalnog rasta prosirenih cekanja: 5s, 10s, 20s, 40s, pa plafon na BACKOFF_MAX_MS.
const BACKOFF_BAZA_MS = 5000;

/**
 * Vezuje politiku 429 za sve pozive nastale unutar `fn`. Scope je mutabilan objekat u ALS-u:
 * `potroseno_ms` pocinje od 0 i sabira se kroz vise HTTP poziva unutar istog pokretanja.
 */
export async function withStrpljenje429<T>(politika: Politika429, fn: () => Promise<T>): Promise<T> {
  const scope: StrpljenjeScope = { politika, potroseno_ms: 0 };
  return storage.run(scope, fn);
}

/** Trenutni scope, ili `null` van svakog `withStrpljenje429` poziva (MCP, Telegram, CLI komande bez omotaca). */
export function trenutnoStrpljenje(): StrpljenjeScope | null {
  return storage.getStore() ?? null;
}

/**
 * Cista funkcija (bez jitter-a, bez sata): koliko ms cekati na 429 u prosirenoj grani, ili `null`
 * kad prosirena grana ne vazi (jos je globalna grana na redu, ili je prosireni budzet, po broju
 * pokusaja ili po kumulativnom vremenu, vec potrosen). `null` znaci "ne radi nista, propadni u
 * postojecu logiku kao danas".
 *
 * `attempt` je isti 1-based brojac HTTP pokusaja kao u `request()`. Prosireni indeks
 * (`attempt - maxRetries`) je koji je PO REDU prosireni pokusaj ovo: 1 znaci prvi pokusaj POSLIJE
 * iscrpljenog globalnog budzeta.
 */
export function planStrpljenja(arg: {
  attempt: number;
  maxRetries: number;
  potroseno_ms: number;
  politika: Politika429;
}): number | null {
  const { attempt, maxRetries, potroseno_ms, politika } = arg;
  const prosireniIndeks = attempt - maxRetries;
  if (prosireniIndeks < 1) return null; // jos u globalnoj grani, nije nas red
  if (prosireniIndeks > politika.pokusaja) return null; // prosireni budzet pokusaja potrosen

  const cekaj = Math.min(BACKOFF_MAX_MS, BACKOFF_BAZA_MS * 2 ** (prosireniIndeks - 1));
  if (potroseno_ms + cekaj > politika.ukupnoMs) return null; // kumulativni plafon cekanja potrosen

  return cekaj;
}
