// Vision proxy: opis slike preko jeftinog vision modela (Claude Haiku), za sesije ciji glavni
// model nema vid (DeepSeek endpoint slike ignorise, izmjereno u deepseek-nalazi.md).
//
// Tok: klijent posalje sliku -> sesija bez vida pozove olx_opisi_sliku -> ovaj modul posalje
// sliku Haiku modelu -> tekstualni opis se vrati sesiji koja nastavi razgovor. Vid se placa
// samo po slici (red velicine desetinke centa), ne cijeli razgovor.
//
// Konfiguracija iz .env klona (vidi .env.example):
//   OLX_VID_API_KEY    Anthropic API kljuc; bez njega se MCP alat uopste ne registruje
//   OLX_VID_MODEL      default claude-haiku-4-5 (user izbor: najjeftiniji Claude sa vidom)
//   OLX_VID_BASE_URL   opciono, za kompatibilan endpoint drugog provajdera
//
// Svaki poziv se biljezi u .olx-pik/ai-usage.jsonl, isti format kao scripts/ai-cijene.mjs
// (zapisiPotrosnju), pa ga npm run ai:usage vidi zajedno sa ostalim AI pozivima.

import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname } from "node:path";

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

export function vidKonfigurisan(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OLX_VID_API_KEY);
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

// Isti format reda kao zapisiPotrosnju u scripts/ai-cijene.mjs (namjerno dupliran umjesto
// importa .mjs u TS): jedan red po pozivu, samo brojevi, nikad sadrzaj.
function zabiljezi(model: string, usage: { input_tokens: number; output_tokens: number }, trajanjeMs: number, ok: boolean, greska?: string): void {
  const dnevnik = process.env.OLX_AI_USAGE_FILE || ".olx-pik/ai-usage.jsonl";
  const red = {
    ts: new Date().toISOString(),
    izvor: "vid",
    zadatak: "opis_slike",
    model_trazen: model,
    model_dobijen: model,
    ulaz_miss: usage.input_tokens,
    ulaz_hit: 0,
    ulaz_write: 0,
    izlaz: usage.output_tokens,
    ulaz_ukupno: usage.input_tokens,
    cijena_usd: null,
    stop_reason: null,
    alata_poslano: null,
    trajanje_ms: trajanjeMs,
    ok,
    greska: greska ?? null,
  };
  try {
    mkdirSync(dirname(dnevnik), { recursive: true });
    appendFileSync(dnevnik, `${JSON.stringify(red)}\n`, "utf8");
  } catch {
    // dnevnik je best-effort, opis slike ne smije pasti zbog njega
  }
}

/**
 * Posalje sliku vision modelu i vrati tekstualni opis. Baca jasnu gresku kad kljuc nije
 * postavljen, fajl ne postoji ili format nije podrzan.
 */
export async function opisiSliku(putanja: string, pitanje?: string): Promise<OpisSlike> {
  const kljuc = process.env.OLX_VID_API_KEY;
  if (!kljuc) {
    throw new Error("OLX_VID_API_KEY nije postavljen u .env, opis slike preko vision modela nije dostupan.");
  }
  const mediaType = medijskiTip(putanja);
  if (!mediaType) {
    throw new Error(`Nepodrzan format slike: ${putanja}. Podrzano: ${Object.keys(PODRZANI_TIPOVI).join(", ")}.`);
  }
  const podaci = readFileSync(putanja).toString("base64");
  const model = process.env.OLX_VID_MODEL || "claude-haiku-4-5";

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
            { type: "text", text: pitanje?.trim() || PODRAZUMIJEVANO_PITANJE },
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
