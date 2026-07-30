// Generisanje slike oglasa iz fotografije koju je klijent poslao (Google Gemini image modeli).
//
// Zasto: klijent slika telefonom, u zatvorenom, sa odsjajem i losim svjetlom. Ista stvar u
// cistom prostoru i sa ravnim svjetlom dobija bitno vise klikova na kartici u aplikaciji.
// Model ovdje NE popravlja artikal, samo prostor i svjetlo (vidi RECEPTI).
//
// Tok: klijent posalje sliku na Telegram -> sesija pozove olx_generiraj_sliku -> ovaj modul
// posalje sliku Geminiju -> nova slika padne na disk -> ista putanja ide u olx_upload_images
// ili se posalje klijentu na odobrenje.
//
// Konfiguracija iz .env klona (vidi .env.example):
//   OLX_SLIKA_API_KEY      Google AI Studio kljuc; bez njega se MCP alat ne registruje
//   OLX_SLIKA_MODEL        default gemini-3.1-flash-lite-image (najjeftiniji sa dobrim rezultatom)
//   OLX_SLIKA_BASE_URL     default https://generativelanguage.googleapis.com/v1beta
//   OLX_SLIKA_MAX_DNEVNO   default 20; plafon je zastita racuna, ne kvota klijenta
//   OLX_SLIKA_DIR          default .olx-pik/slike
//
// Endpoint je klasicni models/{model}:generateContent. Google od 2026. nudi i noviji
// /v1beta/interactions, a generateContent je u dokumentaciji naveden kao i dalje u punoj
// podrsci; drzimo se njega jer mu je oblik zahtjeva i odgovora stabilan i provjeren.
// Svaki poziv se biljezi u .olx-pik/ai-usage.jsonl kroz zapisiAiPoziv.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { brojPozivaDanas, zapisiAiPoziv } from "./ai-dnevnik.js";
import { pozoviGemini, type GeminiDioZahtjeva } from "./gemini.js";
import { medijskiTip } from "./vid.js";

const IZVOR = "slika";

/** Odnosi strana koje Gemini prihvata. */
export const ODNOSI = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export type Odnos = (typeof ODNOSI)[number];

/**
 * Kartica oglasa u OLX/PIK aplikaciji je pejzazna, blizu 4:3 (izmjereno na snimku ekrana
 * 29.07.2026). Kvadratna slika se na kartici odsijeca gore i dole, pa je 4:3 zadana vrijednost.
 */
export const ZADANI_ODNOS: Odnos = "4:3";

/** Najvise ulaznih slika po pozivu. Vise od ovoga rijetko pomaze, a poziv poskupljuje. */
export const MAX_ULAZNIH = 3;

const EKSTENZIJE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

// Recepti su glavni alat kvaliteta: model daje dobar rezultat samo ako mu se tacno kaze sta
// smije a sta ne smije mijenjati. Pisani su na engleskom jer image modeli na njemu drze uputu
// dosljednije. {LOGO} se zamjenjuje imenom firme ili se ta recenica izbaci.
export const RECEPTI: Record<string, string> = {
  "proizvod-bijela":
    "You are given original photos of one product, taken with a phone. Recreate the exact same " +
    "product on a clean, pure white studio background. Keep the product identical: same shape, " +
    "same colour, same materials, same text and logos on it, and the same real condition. Do not " +
    "beautify it, do not repair it, do not remove scratches, dents, stains or signs of use, do not " +
    "swap it for a newer model. Soft even studio lighting, no glare, no reflections of the room, no " +
    "harsh shadows except a soft contact shadow under the product. The product is centred, fully " +
    "visible and fills most of the frame, nothing cropped. Photographic realism. Do not add any " +
    "text, watermark, price tag, border or frame.",

  "auto-salon":
    "You are given original photos of one specific car, taken with a phone. Recreate the exact same " +
    "car: same model and body shape, same trim, same wheels, same colour, same visible condition " +
    "including any scratches, dents or worn parts. Do not repair the car, do not change the wheels, " +
    "do not change the colour, do not turn it into a different or newer model. Place it in a clean, " +
    "bright, modern car dealership showroom with a polished floor and plain walls. Remove glare and " +
    "reflections of the surroundings from the paint and the glass, and remove any photographer " +
    "reflection. Even professional lighting so the real paint colour reads true. Three quarter front " +
    "view, the whole car inside the frame, nothing cropped. On the wall behind the car put a clean " +
    "dealership sign reading {LOGO}. Photographic realism. Apart from that sign do not add any text, " +
    "watermark, badge or border.",

  "profil":
    "Create a clean, professional cover image for the profile of an online shop that sells {LOGO}. " +
    "Calm, uncluttered composition with room for a name to be placed over it later. Photographic " +
    "realism, no people looking at the camera, no text, no watermark, no logo, no border.",
};

export function slikaKonfigurisana(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OLX_SLIKA_API_KEY);
}

export function maxDnevno(env: NodeJS.ProcessEnv = process.env): number {
  const sirovo = Number(env.OLX_SLIKA_MAX_DNEVNO);
  return Number.isFinite(sirovo) && sirovo > 0 ? Math.floor(sirovo) : 20;
}

/**
 * Sastavi uputu za model: recept po imenu ili slobodan tekst, uz zamjenu {LOGO}.
 * Kad logo nije dat, recenica sa {LOGO} se izbacuje cijela, da model ne izmisli ime firme.
 */
export function sastaviUputu(receptIliTekst: string, logo?: string): string {
  const osnova = RECEPTI[receptIliTekst] ?? receptIliTekst;
  const ime = logo?.trim();
  if (ime) return osnova.replaceAll("{LOGO}", ime);
  return osnova
    .split(/(?<=\.)\s+/)
    .filter((recenica) => !recenica.includes("{LOGO}"))
    .join(" ")
    .trim();
}

export interface GenerisanaSlika {
  putanja: string;
  model: string;
  mime: string;
  bajtova: number;
  ulazTokena: number;
  izlazTokena: number;
  danas: number;
  plafon: number;
}

export interface OpcijeGenerisanja {
  /** Putanje do ulaznih slika, npr. iz Telegram inboxa. Bez njih model slika iz niceg. */
  ulazneSlike?: string[];
  /** Ime recepta iz RECEPTI ili slobodna uputa na engleskom. */
  recept: string;
  /** Ime firme za {LOGO} u receptu. */
  logo?: string;
  odnos?: Odnos;
}

/**
 * Posalje jednu ili vise ulaznih slika Gemini modelu i upise dobijenu sliku na disk.
 * Vraca putanju do nove slike. Baca jasnu gresku kad kljuc fali, format nije podrzan,
 * dnevni plafon je dostignut ili model nije vratio sliku.
 */
export async function generisiSliku(opcije: OpcijeGenerisanja): Promise<GenerisanaSlika> {
  const kljuc = process.env.OLX_SLIKA_API_KEY;
  if (!kljuc) {
    throw new Error("OLX_SLIKA_API_KEY nije postavljen u .env, generisanje slike nije dostupno.");
  }

  const plafon = maxDnevno();
  const danas = brojPozivaDanas(IZVOR);
  if (danas >= plafon) {
    throw new Error(
      `Dnevni plafon generisanja slika je dostignut (${danas}/${plafon}). Sutra se brojac resetuje, ` +
        `ili se plafon mijenja kroz OLX_SLIKA_MAX_DNEVNO.`,
    );
  }

  const ulazne = (opcije.ulazneSlike ?? []).slice(0, MAX_ULAZNIH);
  const dijelovi: GeminiDioZahtjeva[] = [{ text: sastaviUputu(opcije.recept, opcije.logo) }];
  for (const putanja of ulazne) {
    const mime = medijskiTip(putanja);
    if (!mime) {
      throw new Error(`Nepodrzan format ulazne slike: ${putanja}. Podrzano: jpg, jpeg, png, gif, webp.`);
    }
    dijelovi.push({ inline_data: { mime_type: mime, data: readFileSync(putanja).toString("base64") } });
  }

  const odnos = opcije.odnos ?? ZADANI_ODNOS;
  if (!ODNOSI.includes(odnos)) {
    throw new Error(`Nepodrzan odnos strana: ${odnos}. Podrzano: ${ODNOSI.join(", ")}.`);
  }

  const model = process.env.OLX_SLIKA_MODEL || "gemini-3.1-flash-lite-image";
  const baza = process.env.OLX_SLIKA_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const pocetak = Date.now();

  try {
    const rezultat = await pozoviGemini({
      kljuc,
      model,
      dijelovi,
      slikaNaIzlazu: { odnos },
      baseUrl: baza,
    });

    const slika = rezultat.slika;
    if (!slika) {
      throw new Error(`Gemini nije vratio sliku${rezultat.tekst ? `, nego tekst: ${rezultat.tekst.slice(0, 300)}` : "."}`);
    }

    const dir = process.env.OLX_SLIKA_DIR || ".olx-pik/slike";
    mkdirSync(dir, { recursive: true });
    const pecat = new Date().toISOString().replace(/[:.]/g, "-");
    const putanja = resolve(dir, `slika-${pecat}${EKSTENZIJE[slika.mime] ?? ".png"}`);
    const bajtovi = Buffer.from(slika.podaci, "base64");
    writeFileSync(putanja, bajtovi);

    const { ulazTokena, izlazTokena } = rezultat;
    zapisiAiPoziv({
      izvor: IZVOR,
      zadatak: "generisanje_slike",
      model,
      ulazTokena,
      izlazTokena,
      trajanjeMs: Date.now() - pocetak,
      ok: true,
    });

    return {
      putanja,
      model,
      mime: slika.mime,
      bajtova: bajtovi.length,
      ulazTokena,
      izlazTokena,
      danas: danas + 1,
      plafon,
    };
  } catch (e) {
    const greska = String(e instanceof Error ? e.message : e);
    zapisiAiPoziv({
      izvor: IZVOR,
      zadatak: "generisanje_slike",
      model,
      trajanjeMs: Date.now() - pocetak,
      ok: false,
      greska,
    });
    throw e;
  }
}
