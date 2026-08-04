// Vision proxy: opis slike preko jeftinog vision modela, za sesije ciji glavni model nema vid
// (DeepSeek endpoint slike ignorise, izmjereno u deepseek-nalazi.md).
//
// Tok: klijent posalje sliku -> sesija bez vida pozove olx_opisi_sliku -> ovaj modul posalje
// sliku vision modelu -> tekstualni opis se vrati sesiji koja nastavi razgovor. Vid se placa
// samo po slici, ne cijeli razgovor.
//
// Dva provajdera, jer generisanje slika (slika.ts) svakako trazi Gemini kljuc:
//   anthropic  claude-haiku-4-5, oko $0.003 po slici
//   gemini     gemini-3.1-flash-lite, red velicine deset puta jeftinije, i jedan kljuc za
//              cijeli put slike (opis + generisanje), pa i jedan provajder kojem idu
//              fotografije klijenta
//
// Konfiguracija iz .env klona (vidi .env.example):
//   OLX_VID_PROVAJDER  gemini (default, odluka vlasnika 04.08.2026) ili anthropic
//   OLX_VID_API_KEY    kljuc; kad je provajder gemini pada na OLX_SLIKA_API_KEY
//   OLX_VID_MODEL      default po provajderu
//   OLX_VID_BASE_URL   opciono, za kompatibilan endpoint drugog provajdera (samo anthropic)
//
// Svaki poziv se biljezi u .olx-pik/ai-usage.jsonl kroz zapisiAiPoziv, pa ga npm run ai:usage
// vidi zajedno sa ostalim AI pozivima.

import Anthropic from "@anthropic-ai/sdk";
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

export type VidProvajder = "anthropic" | "gemini";

const PODRAZUMIJEVANI_MODEL: Record<VidProvajder, string> = {
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-3.1-flash-lite",
};

export function vidProvajder(env: NodeJS.ProcessEnv = process.env): VidProvajder {
  // Gemini je default (odluka vlasnika 04.08.2026): postavka klijenta je onda samo jedan
  // Gemini kljuc (OLX_SLIKA_API_KEY) i cijeli put slike radi. Anthropic ostaje izricitim izborom.
  return (env.OLX_VID_PROVAJDER ?? "").trim().toLowerCase() === "anthropic" ? "anthropic" : "gemini";
}

/** Kljuc za vid. Na Geminiju pada na kljuc za generisanje slika, da se isti ne upisuje dvaput. */
export function vidKljuc(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.OLX_VID_API_KEY) return env.OLX_VID_API_KEY;
  return vidProvajder(env) === "gemini" ? env.OLX_SLIKA_API_KEY : undefined;
}

export function vidModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_VID_MODEL || PODRAZUMIJEVANI_MODEL[vidProvajder(env)];
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
    throw new Error("OLX_VID_API_KEY nije postavljen u .env, opis slike preko vision modela nije dostupan.");
  }
  const mediaType = medijskiTip(putanja);
  if (!mediaType) {
    throw new Error(`Nepodrzan format slike: ${putanja}. Podrzano: ${Object.keys(PODRZANI_TIPOVI).join(", ")}.`);
  }
  const podaci = readFileSync(putanja).toString("base64");
  const model = vidModel();
  const upit = pitanje?.trim() || PODRAZUMIJEVANO_PITANJE;

  if (vidProvajder() === "gemini") {
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

  const klijent = new Anthropic({
    apiKey: kljuc,
    ...(process.env.OLX_VID_BASE_URL ? { baseURL: process.env.OLX_VID_BASE_URL } : {}),
  });

  const pocetak = Date.now();
  try {
    const odgovor = await klijent.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: podaci },
            },
            { type: "text", text: upit },
          ],
        },
      ],
    });

    const opis = odgovor.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!opis) throw new Error(`Vision model nije vratio tekst (stop_reason: ${odgovor.stop_reason}).`);

    zabiljezi(model, odgovor.usage, Date.now() - pocetak, true);
    return {
      opis,
      model: odgovor.model,
      ulaz_tokena: odgovor.usage.input_tokens,
      izlaz_tokena: odgovor.usage.output_tokens,
    };
  } catch (e) {
    zabiljezi(model, { input_tokens: 0, output_tokens: 0 }, Date.now() - pocetak, false, String(e instanceof Error ? e.message : e));
    throw e;
  }
}
