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
//
// Svaki poziv se biljezi u .olx-pik/ai-usage.jsonl kroz zapisiAiPoziv, pa ga npm run ai:usage
// vidi zajedno sa ostalim AI pozivima.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { zapisiAiPoziv } from "./ai-dnevnik.js";
import { pozoviGemini } from "./gemini.js";

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
    izvor: "vid",
    zadatak: "opis_slike",
    model,
    ulazTokena: usage.input_tokens,
    izlazTokena: usage.output_tokens,
    trajanjeMs,
    ok,
    greska,
  });
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
