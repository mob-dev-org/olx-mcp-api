// Dnevnik AI poziva koji ne idu kroz sesiju (vision proxy, generisanje slika).
//
// Format reda je isti kao u scripts/ai-cijene.mjs (zapisiPotrosnju), da npm run ai:usage vidi
// sve pozive na jednom mjestu. Ovdje je namjerno duplikat tog formata a ne import: .mjs se ne
// uvozi u TS build. Jedan zapis po pozivu, samo brojevi, NIKAD sadrzaj poruka ni slike.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AiPoziv {
  /** odakle poziv dolazi: "vid", "slika" */
  izvor: string;
  /** kratka oznaka posla, npr. "opis_slike" */
  zadatak: string;
  model: string;
  ulazTokena?: number;
  izlazTokena?: number;
  trajanjeMs: number;
  ok: boolean;
  greska?: string;
}

export function putanjaDnevnika(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_AI_USAGE_FILE || ".olx-pik/ai-usage.jsonl";
}

export function zapisiAiPoziv(poziv: AiPoziv): void {
  const dnevnik = putanjaDnevnika();
  const red = {
    ts: new Date().toISOString(),
    izvor: poziv.izvor,
    zadatak: poziv.zadatak,
    model_trazen: poziv.model,
    model_dobijen: poziv.model,
    ulaz_miss: poziv.ulazTokena ?? 0,
    ulaz_hit: 0,
    ulaz_write: 0,
    izlaz: poziv.izlazTokena ?? 0,
    ulaz_ukupno: poziv.ulazTokena ?? 0,
    // Cijenu racuna scripts/ai-cijene.mjs po modelu; za modele van te tabele ostaje null.
    cijena_usd: null,
    stop_reason: null,
    alata_poslano: null,
    trajanje_ms: poziv.trajanjeMs,
    ok: poziv.ok,
    greska: poziv.greska ?? null,
  };
  try {
    mkdirSync(dirname(dnevnik), { recursive: true });
    appendFileSync(dnevnik, `${JSON.stringify(red)}\n`, "utf8");
  } catch {
    // dnevnik je best-effort: posao ne smije pasti zato sto se zapis nije upisao
  }
}

/**
 * Broj USPJESNIH poziva jednog izvora u zadanom danu. Sluzi dnevnom plafonu na radnjama koje
 * kostaju pravi novac. Neuspjeli pozivi se ne racunaju, jer nista nije naplaceno.
 */
export function brojPozivaDanas(izvor: string, dan?: string): number {
  const danas = dan ?? new Date().toISOString().slice(0, 10);
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanjaDnevnika(), "utf8");
  } catch {
    return 0; // nema dnevnika, nema poziva
  }
  let broj = 0;
  for (const red of sadrzaj.split("\n")) {
    if (!red.trim()) continue;
    try {
      const r = JSON.parse(red) as { ts?: string; izvor?: string; ok?: boolean };
      if (r.izvor === izvor && r.ok !== false && typeof r.ts === "string" && r.ts.startsWith(danas)) {
        broj += 1;
      }
    } catch {
      // pokvaren red se preskace, ne obara brojanje
    }
  }
  return broj;
}
