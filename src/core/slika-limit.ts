// Jednodnevni override dnevnog limita generisanja slika.
//
// Zasto postoji: klijent dobija dnevni plafon generisanja slika (OLX_SLIKA_MAX_DNEVNO u .env, ili
// fallback 10 kad varijabla nije postavljena). Kad admin u Telegram grupi zeli danas privremeno
// povecati plafon, admin bot sesija namjerno NEMA Bash/Write/Edit/Read na .env* fajlove ("Telegram
// nalog ne smije biti kljuc od cijele masine"), pa se .env ne moze dirati iz razgovora. Ovaj modul
// daje mehanizam pored: override koji vazi SAMO za danasnji datum i sutra automatski otpada, bez
// da iko mora pamtiti da ga vrati.
//
// Isti obrazac kao izuzeca.ts i ritam-obnova.ts: cista funkcija racuna, tanak I/O cita/pise
// `.olx-pik/*.json`, atomic write tmp+rename, OLX_*_FILE env override za putanju.
//
// Zavisnost ide JEDNOSMJERNO: `slika.ts` uvozi `envLimit` odavde, ovaj fajl ne uvozi nista iz
// `slika.ts` (bez toga bi bio cirkularan import). Fallback broj 10 zivi ovdje, na jednom mjestu.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface OverrideLimita {
  /** Dan na koji override vazi, YYYY-MM-DD. Drugi datum = override je istekao. */
  datum: string;
  limit: number;
  /** Kada je zapisan, ISO. */
  kada: string;
  razlog: string | null;
}

export function putanjaOverrida(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_SLIKA_LIMIT_FILE || ".olx-pik/slika-limit-danas.json";
}

export function procitajOverride(putanja = putanjaOverrida()): OverrideLimita | null {
  try {
    const sadrzaj = JSON.parse(readFileSync(putanja, "utf8")) as OverrideLimita;
    return sadrzaj && typeof sadrzaj === "object" ? sadrzaj : null;
  } catch {
    return null; // nema fajla ili je pokvaren: nema override-a, radi se po env/fallback
  }
}

export function upisiOverride(override: OverrideLimita, putanja = putanjaOverrida()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(override, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts i ritam-obnova.ts
}

// ---- ciste funkcije, testirane bez diska ----

/** Fallback broj kad OLX_SLIKA_MAX_DNEVNO nije postavljen ili je besmislen. */
const FALLBACK_LIMIT = 10;

/**
 * Limit iz env varijable, ili fallback. Ovo je jedini izvor istine za fallback broj: `maxDnevno()`
 * u slika.ts je tanak wrapper koji poziva ovu funkciju.
 */
export function envLimit(env: NodeJS.ProcessEnv = process.env): number {
  const sirovo = Number(env.OLX_SLIKA_MAX_DNEVNO);
  return Number.isFinite(sirovo) && sirovo > 0 ? Math.floor(sirovo) : FALLBACK_LIMIT;
}

/**
 * Limit koji danas stvarno vazi. Override vazi SAMO za dan na koji je zapisan (namjerno
 * jednodnevni, ne trajan): override za jucer ili raniji dan se ignorise i pada se nazad na
 * env/fallback, isto kao da override ne postoji.
 */
export function efektivniLimit(
  env: NodeJS.ProcessEnv,
  danasIso: string,
  override: OverrideLimita | null,
): { limit: number; izvor: "override" | "env" | "fallback" } {
  if (override !== null && override.datum === danasIso) {
    return { limit: override.limit, izvor: "override" };
  }
  const sirovo = Number(env.OLX_SLIKA_MAX_DNEVNO);
  if (Number.isFinite(sirovo) && sirovo > 0) return { limit: Math.floor(sirovo), izvor: "env" };
  return { limit: FALLBACK_LIMIT, izvor: "fallback" };
}
