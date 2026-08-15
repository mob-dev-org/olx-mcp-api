// Vision proxy: opise sliku sa diska da sesija bez vida (DeepSeek ignorise slike) moze
// nastaviti sa tekstom.
//
// Iskljucivo Gemini (odluka vlasnika 04.08.2026): generisanje slika (slika.ts) svakako trazi
// Gemini kljuc, pa isti kljuc pokriva cijeli put slike, jedan adapter (gemini.ts) radi oba
// posla i fotografije klijenta idu samo jednom vanjskom servisu. Anthropic varijanta je
// uklonjena istom odlukom; postojala je do v0.12.1 (git historija ovog fajla).
//
// Konfiguracija iz .env klona (vidi .env.example):
//   OLX_SLIKA_API_KEY  Gemini kljuc, isti kao za generisanje slika; jedino obavezno
//   OLX_VID_API_KEY    opciono, poseban Gemini kljuc samo za vid (pobjedjuje kad postoji)
//   OLX_VID_MODEL      opciono, default gemini-3.1-flash-lite (najjeftiniji, dovoljan za opis)
//   OLX_VID_MAX_DNEVNO opciono, dnevni plafon poziva (fallback ispod)
//
// Svaki poziv se biljezi u .olx-pik/ai-usage.jsonl kroz zapisiAiPoziv, pa ga bun run ai:usage
// vidi zajedno sa ostalim AI pozivima. Isti dnevnik (izvor: "vid") sluzi i dnevnom plafonu ispod,
// preko brojPozivaDanas iz ai-dnevnik.ts.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { brojPozivaDanas, zapisiAiPoziv } from "./ai-dnevnik.js";
import { pozoviGemini } from "./gemini.js";

const IZVOR = "vid";

const PODRZANI_TIPOVI: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const PODRAZUMIJEVANO_PITANJE =
  "Opisi proizvod sa slike za oglas na trzistu polovnih i novih stvari: sta je, marka i model " +
  "ako se vide, boja, stanje, vidljiva ostecenja, natpisi i sve sto pomaze da se artikal tacno " +
  "opise. Ne izmisljaj nista sto se ne vidi; kad nesto nije jasno, reci da se ne vidi.";

const PODRAZUMIJEVANI_MODEL = "gemini-3.1-flash-lite";

/** Kljuc za vid. Po pravilu isti Gemini kljuc kao za generisanje slika. */
export function vidKljuc(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.OLX_VID_API_KEY || env.OLX_SLIKA_API_KEY;
}

export function vidModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_VID_MODEL || PODRAZUMIJEVANI_MODEL;
}

export function vidKonfigurisan(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(vidKljuc(env));
}

/** Media type iz ekstenzije fajla; null kad format nije podrzan za vid. */
export function medijskiTip(putanja: string): string | null {
  return PODRZANI_TIPOVI[extname(putanja).toLowerCase()] ?? null;
}

export interface OpisSlike {
  opis: string;
  model: string;
  ulaz_tokena: number;
  izlaz_tokena: number;
}

function zabiljezi(model: string, usage: { input_tokens: number; output_tokens: number }, trajanjeMs: number, ok: boolean, greska?: string): void {
  zapisiAiPoziv({
    izvor: IZVOR,
    zadatak: "opis_slike",
    model,
    ulazTokena: usage.input_tokens,
    izlazTokena: usage.output_tokens,
    trajanjeMs,
    ok,
    greska,
  });
}

// ---- dnevni plafon (cisto racunanje, testirano bez diska) ----

/**
 * Fallback broj kad OLX_VID_MAX_DNEVNO nije postavljen ili je besmislen.
 *
 * Zasto poseban plafon, NE dijeljen sa generisanjem slike (slika-limit.ts, FALLBACK_LIMIT=10):
 * vision poziv (gemini-3.1-flash-lite, kratak tekstualni izlaz) je red velicine jeftiniji od
 * generisanja slike (izlazna SLIKA, $30/milion tokena), a olx_opisi_sliku sjedi na putu objave
 * artikla iz fotografije za sesiju bez vida (DeepSeek): svaka takva objava prvo prolazi kroz vid,
 * pa bi dijeljeni plafon od 10 blokirao normalan rad vec posle par artikala dnevno. 150 je
 * osjetno vece: pokriva i najprometniji dan kataloga, uz zanemarljiv trosak po pozivu.
 *
 * Namjerno NEMA jednodnevnog admin override-a kao slika-limit.ts (nije trazen ovim zadatkom):
 * dijeljenje jedne generičke funkcije parametrizovane imenom env varijable bi ustedu koda
 * platilo zamagljivanjem dva razlicita plafona, pa ova funkcija ostaje odvojena i jednostavnija.
 */
const FALLBACK_LIMIT_VID = 150;

/** Limit iz env varijable OLX_VID_MAX_DNEVNO, ili fallback iznad. */
export function vidEnvLimit(env: NodeJS.ProcessEnv = process.env): number {
  const sirovo = Number(env.OLX_VID_MAX_DNEVNO);
  return Number.isFinite(sirovo) && sirovo > 0 ? Math.floor(sirovo) : FALLBACK_LIMIT_VID;
}

/** Cista provjera dnevnog plafona vida: da li je danasnji broj poziva vec dostigao limit. */
export function provjeriPlafonVida(danas: number, limit: number): { ok: true } | { ok: false; poruka: string } {
  if (danas < limit) return { ok: true };
  return {
    ok: false,
    poruka:
      `Dnevni plafon opisa slike (vid) je dostignut (${danas}/${limit}). ` +
      "Promijeni OLX_VID_MAX_DNEVNO u .env na masini ako treba trajno veci limit.",
  };
}

/**
 * Posalje sliku vision modelu i vrati tekstualni opis. Baca jasnu gresku kad kljuc nije
 * postavljen, fajl ne postoji ili format nije podrzan.
 */
export async function opisiSliku(putanja: string, pitanje?: string): Promise<OpisSlike> {
  const kljuc = vidKljuc();
  if (!kljuc) {
    throw new Error("OLX_SLIKA_API_KEY (Gemini) nije postavljen u .env, opis slike preko vision modela nije dostupan.");
  }
  const mediaType = medijskiTip(putanja);
  if (!mediaType) {
    throw new Error(`Nepodrzan format slike: ${putanja}. Podrzano: ${Object.keys(PODRZANI_TIPOVI).join(", ")}.`);
  }

  // Plafon PRIJE poziva vanjskog servisa: neuspjeli/odbijeni zahtjev ne smije trositi mrezu.
  const limit = vidEnvLimit();
  const danasPoziva = brojPozivaDanas(IZVOR);
  const nalazPlafona = provjeriPlafonVida(danasPoziva, limit);
  if (!nalazPlafona.ok) throw new Error(nalazPlafona.poruka);

  const podaci = readFileSync(putanja).toString("base64");
  const model = vidModel();
  const upit = pitanje?.trim() || PODRAZUMIJEVANO_PITANJE;

  const pocetak = Date.now();
  try {
    const r = await pozoviGemini({
      kljuc,
      model,
      dijelovi: [{ inline_data: { mime_type: mediaType, data: podaci } }, { text: upit }],
    });
    if (!r.tekst) throw new Error("Vision model nije vratio tekst.");
    zabiljezi(model, { input_tokens: r.ulazTokena, output_tokens: r.izlazTokena }, Date.now() - pocetak, true);
    return { opis: r.tekst, model, ulaz_tokena: r.ulazTokena, izlaz_tokena: r.izlazTokena };
  } catch (e) {
    zabiljezi(model, { input_tokens: 0, output_tokens: 0 }, Date.now() - pocetak, false, String(e instanceof Error ? e.message : e));
    throw e;
  }
}
