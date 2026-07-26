// Cjenovnik modela i zapis potrosnje. Jedno mjesto za sve brojeve, da se ne
// prepisuju po skriptama. Cijene su po milion tokena, u dolarima.
//
// Izvor: https://api-docs.deepseek.com/quick_start/pricing, stanje 26.07.2026.
// Kad se cijene promijene, mijenja se samo ovaj fajl.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const CIJENE = {
  "deepseek-v4-flash": { ulazMiss: 0.14, ulazHit: 0.0028, izlaz: 0.28 },
  "deepseek-v4-pro": { ulazMiss: 0.435, ulazHit: 0.003625, izlaz: 0.87 },
  // Anthropic, za poredjenje kad se mjeri isti zadatak na oba
  "claude-opus-5": { ulazMiss: 5.0, ulazHit: 0.5, izlaz: 25.0 },
  "claude-sonnet-5": { ulazMiss: 3.0, ulazHit: 0.3, izlaz: 15.0 },
  "claude-haiku-4-5": { ulazMiss: 1.0, ulazHit: 0.1, izlaz: 5.0 },
};

/**
 * Racuna cijenu jednog poziva iz `usage` bloka Anthropic odgovora.
 * Vraca dolare. Nepoznat model daje null, da se ne izmislja broj.
 */
export function cijenaPoziva(model, usage) {
  const c = CIJENE[model];
  if (!c || !usage) return null;
  const hit = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const miss = usage.input_tokens ?? 0;
  const izlaz = usage.output_tokens ?? 0;
  return (
    (miss / 1e6) * c.ulazMiss +
    (write / 1e6) * c.ulazMiss +
    (hit / 1e6) * c.ulazHit +
    (izlaz / 1e6) * c.izlaz
  );
}

/** Ukupno tokena u ulazu, bez obzira odakle su dosli. */
export function ukupnoUlaz(usage) {
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

const DNEVNIK = process.env.OLX_AI_USAGE_FILE || ".olx-pik/ai-usage.jsonl";

/**
 * Dopisuje jedan red u dnevnik potrosnje. Jedan red je jedan poziv modela.
 * Ne zapisuje sadrzaj poruka, samo brojeve, da dnevnik ne postane kopija podataka.
 */
export function zapisiPotrosnju(red) {
  const linija = {
    ts: new Date().toISOString(),
    izvor: red.izvor ?? "skripta",
    zadatak: red.zadatak ?? null,
    model_trazen: red.modelTrazen ?? null,
    model_dobijen: red.modelDobijen ?? null,
    ulaz_miss: red.usage?.input_tokens ?? 0,
    ulaz_hit: red.usage?.cache_read_input_tokens ?? 0,
    ulaz_write: red.usage?.cache_creation_input_tokens ?? 0,
    izlaz: red.usage?.output_tokens ?? 0,
    ulaz_ukupno: ukupnoUlaz(red.usage),
    cijena_usd: cijenaPoziva(red.modelDobijen ?? red.modelTrazen, red.usage),
    stop_reason: red.stopReason ?? null,
    alata_poslano: red.alataPoslano ?? null,
    trajanje_ms: red.trajanjeMs ?? null,
    ok: red.ok !== false,
    greska: red.greska ?? null,
  };
  mkdirSync(dirname(DNEVNIK), { recursive: true });
  appendFileSync(DNEVNIK, JSON.stringify(linija) + "\n", "utf8");
  return linija;
}

export { DNEVNIK };
