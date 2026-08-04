// Lokalna arhiva skinutih artikala: "skini artikal" sacuva kompletan oglas i ORIGINALNE slike
// (bajtove, ne linkove) prije sakrivanja, pa se artikal moze vratiti i kad oglasa na platformi
// vise nema (zavrsen, istekao, rucno obrisan). Dok oglas postoji skriven, povratak je otkrivanje
// i arhiva je samo osiguranje.
//
// Disk: .olx-pik/arhiva-artikala/<id>/oglas.json + 01.jpg, 02.webp... Redni broj fajla je
// sacuvani redoslijed slika, 01 je glavna. Slike namjerno NISU u podmapi zvanoj "slike":
// crni backup obrazac /(^|\/)slike(\/|$)/ se provjerava prije bijelog spiska i tiho bi ih
// izbacio iz backupa (vidi backup-spisak.ts).
//
// Arhiva raste samo eksplicitnom odlukom klijenta (nema automatskog arhiviranja), a fajlovi u
// njoj se nikad automatski ne brisu: brisanje originala je tacno ono od cega arhiva stiti.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CreateListingInput, Listing, ListingAttribute } from "./types.js";

export interface NeuspjelaSlika {
  url: string;
  greska: string;
}

export interface ArhivskiZapis {
  /** Spremno za olx_create_listing; polja koja create ne prima su u meta.nerekreirljivo. */
  create: CreateListingInput;
  meta: {
    originalni_id: number;
    naslov: string;
    arhivirano: string;
    status_pri_arhiviranju: string | null;
    /** Originalni URL-ovi, redoslijed sa oglasa. */
    url_slika: string[];
    /** Relativna imena fajlova u mapi zapisa, isti redoslijed (01.jpg...). */
    fajlovi_slika: string[];
    neuspjele_slike: NeuspjelaSlika[];
    /** Polja koja se kroz kreiranje ne mogu vratiti (quantity, shipping...), samo za covjeka. */
    nerekreirljivo: Record<string, unknown>;
    ponovo_objavljen: { novi_id: number; kada: string } | null;
  };
}

/** Granica po slici: originali sa OLX-a su po pravilu ispod ovoga, sve preko je sumnjivo. */
export const MAX_BAJTA_SLIKE = 10 * 1024 * 1024;

export function mapaArhive(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_ARHIVA_DIR || ".olx-pik/arhiva-artikala";
}

// ---- ciste funkcije, testirane bez diska i mreze ----

function broj(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Full listing u ulaz za kreiranje, plus polja koja se NE mogu rekreirati.
 * CreateListingInput (types.ts) nema quantity, price_by_agreement, shipping ni image_masking,
 * pa ta polja idu u nerekreirljivo: zapis za covjeka koji poslije objave rucno provjeri oglas.
 */
export function mapirajZaKreiranje(l: Listing): { input: CreateListingInput; nerekreirljivo: Record<string, unknown> } {
  const category = (l.category ?? null) as { id?: number } | null;
  const brand = (l.brand ?? null) as { id?: number } | null;
  const model = (l.model ?? null) as { id?: number } | null;
  const attributes: ListingAttribute[] = Array.isArray(l.attributes)
    ? (l.attributes as { id?: number; value?: unknown }[])
        .filter((a) => typeof a.id === "number" && a.value !== null && a.value !== undefined && a.value !== "")
        .map((a) => ({ id: a.id as number, value: String(a.value) }))
    : [];

  const input: CreateListingInput = { title: l.title };
  const categoryId = broj(l.category_id) ?? broj(category?.id);
  if (categoryId !== undefined) input.category_id = categoryId;
  if (l.short_description) input.short_description = l.short_description;
  const description = l.additional?.description;
  if (description) input.description = description;
  // city/country se u full payloadu razlikuju po nalogu; kad ih nema, objava iz arhive dopuni
  // iz config default vrijednosti (radi alat, ne ovaj modul).
  const cityId = broj(l.city_id) ?? broj((l.city as { id?: number } | undefined)?.id);
  if (cityId !== undefined) input.city_id = cityId;
  const countryId = broj(l.country_id) ?? broj((l.country as { id?: number } | undefined)?.id);
  if (countryId !== undefined) input.country_id = countryId;
  const price = broj(l.price);
  if (price !== undefined) input.price = price;
  if (typeof l.available === "boolean") input.available = l.available;
  if (l.listing_type) input.listing_type = l.listing_type;
  if (l.state) input.state = l.state;
  const brandId = broj(brand?.id);
  if (brandId !== undefined) input.brand_id = brandId;
  const modelId = broj(model?.id);
  if (modelId !== undefined) input.model_id = modelId;
  // sku_number se postavlja SAMO pri kreiranju i poslije se ne mijenja: zato se prenosi ovdje.
  if (typeof l.sku_number === "string" && l.sku_number) input.sku_number = l.sku_number;
  if (attributes.length > 0) input.attributes = attributes;

  const nerekreirljivo: Record<string, unknown> = {};
  if (l.quantity !== undefined) nerekreirljivo.quantity = l.quantity;
  if (l.price_by_agreement !== undefined) nerekreirljivo.price_by_agreement = l.price_by_agreement;
  if (l.shipping !== undefined) nerekreirljivo.shipping = l.shipping;
  if (l.views !== undefined) nerekreirljivo.views = l.views;

  return { input, nerekreirljivo };
}

const POZNATE_EKSTENZIJE = /\.(jpe?g|png|webp|gif)(?:$|\?)/i;

/** Ime fajla slike: redni broj cuva redoslijed (01 = glavna), ekstenzija iz URL-a pa content-type pa jpg. */
export function nazivSlike(redni: number, url: string, contentType?: string | null): string {
  let ekst = "jpg";
  const izUrla = POZNATE_EKSTENZIJE.exec(url)?.[1];
  if (izUrla) {
    ekst = izUrla.toLowerCase().replace("jpeg", "jpg");
  } else if (contentType) {
    const tip = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    if (tip === "image/png") ekst = "png";
    else if (tip === "image/webp") ekst = "webp";
    else if (tip === "image/gif") ekst = "gif";
  }
  return `${String(redni).padStart(2, "0")}.${ekst}`;
}

/** Novi zapis iz full listinga, bez slika: njih dopise preuzmiSlike pa se zapis upise cio. */
export function noviZapis(l: Listing, kada: string): ArhivskiZapis {
  const { input, nerekreirljivo } = mapirajZaKreiranje(l);
  const status = [l.status ?? null, typeof l.visible === "boolean" ? (l.visible ? "vidljiv" : "skriven") : null]
    .filter(Boolean)
    .join(", ");
  return {
    create: input,
    meta: {
      originalni_id: l.id,
      naslov: l.title,
      arhivirano: kada,
      status_pri_arhiviranju: status || null,
      url_slika: Array.isArray(l.images) ? (l.images as string[]) : [],
      fajlovi_slika: [],
      neuspjele_slike: [],
      nerekreirljivo,
      ponovo_objavljen: null,
    },
  };
}

export function saOznakomObjave(z: ArhivskiZapis, noviId: number, kada: string): ArhivskiZapis {
  return { ...z, meta: { ...z.meta, ponovo_objavljen: { novi_id: noviId, kada } } };
}

/**
 * Odluka sta "vrati artikal" radi. Cista funkcija da grane budu testirane bez mreze:
 * oglas skriven -> otkrij (besplatno); oglasa nema ili je zavrsen/istekao -> objavi iz arhive;
 * sve ostalo -> stoj sa razlogom.
 */
export function planVracanja(
  zapis: ArhivskiZapis | null,
  oglas: Listing | null,
): { radnja: "otkrij" } | { radnja: "objavi" } | { radnja: "stoj"; zasto: string } {
  if (oglas && oglas.visible === false) return { radnja: "otkrij" };
  if (oglas && oglas.visible !== false) {
    return { radnja: "stoj", zasto: "oglas je vec vidljiv, nema sta da se vraca" };
  }
  if (!zapis) return { radnja: "stoj", zasto: "oglasa nema na platformi a nema ni arhive za ponovnu objavu" };
  return { radnja: "objavi" };
}

/** Kompaktan spisak za prikaz, sortiran od najnovijeg arhiviranja. */
export function kompaktSpisak(
  zapisi: ArhivskiZapis[],
): { id: number; naslov: string; arhivirano: string; slika_broj: number; ponovo_objavljen: number | null }[] {
  return zapisi
    .map((z) => ({
      id: z.meta.originalni_id,
      naslov: z.meta.naslov,
      arhivirano: z.meta.arhivirano,
      slika_broj: z.meta.fajlovi_slika.length,
      ponovo_objavljen: z.meta.ponovo_objavljen?.novi_id ?? null,
    }))
    .sort((a, b) => b.arhivirano.localeCompare(a.arhivirano));
}

// ---- I/O omotaci, tanki i bez logike ----

export function mapaZapisa(id: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(mapaArhive(env), String(id));
}

export function putanjaZapisa(id: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(mapaZapisa(id, env), "oglas.json");
}

export function ucitajZapis(id: number, env: NodeJS.ProcessEnv = process.env): ArhivskiZapis | null {
  try {
    const zapis = JSON.parse(readFileSync(putanjaZapisa(id, env), "utf8")) as ArhivskiZapis;
    return zapis && typeof zapis === "object" && zapis.meta ? zapis : null;
  } catch {
    return null; // nema zapisa ili je pokvaren
  }
}

export function upisiZapis(z: ArhivskiZapis, env: NodeJS.ProcessEnv = process.env): void {
  const putanja = putanjaZapisa(z.meta.originalni_id, env);
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(z, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts
}

export function ucitajSveZapise(env: NodeJS.ProcessEnv = process.env): ArhivskiZapis[] {
  const mapa = mapaArhive(env);
  let stavke: string[];
  try {
    stavke = readdirSync(mapa);
  } catch {
    return []; // arhive jos nema
  }
  const zapisi: ArhivskiZapis[] = [];
  for (const ime of stavke) {
    const id = Number(ime);
    if (!Number.isInteger(id) || id <= 0) continue;
    const zapis = ucitajZapis(id, env);
    if (zapis) zapisi.push(zapis);
  }
  return zapisi;
}

/** Zbir velicine svih fajlova arhive u bajtima, za uvid u listi. */
export function velicinaArhive(env: NodeJS.ProcessEnv = process.env): number {
  const mapa = mapaArhive(env);
  let ukupno = 0;
  let mape: string[];
  try {
    mape = readdirSync(mapa);
  } catch {
    return 0;
  }
  for (const ime of mape) {
    const puna = join(mapa, ime);
    try {
      for (const fajl of readdirSync(puna)) ukupno += statSync(join(puna, fajl)).size;
    } catch {
      // pojedinacna mapa necitljiva, velicina ostaje procjena
    }
  }
  return ukupno;
}

/**
 * Preuzmi originale slika u mapu zapisa. Pad jednog URL-a ne rusi ostale: preuzme sta moze,
 * neuspjele vrati da ih alat glasno prijavi. Preskace fajl koji vec postoji sa istim imenom
 * (ponovno arhiviranje ne skida ponovo ono sto vec ima).
 */
export async function preuzmiSlike(
  urls: string[],
  mapa: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ fajlovi: string[]; neuspjele: NeuspjelaSlika[] }> {
  mkdirSync(mapa, { recursive: true });
  const fajlovi: string[] = [];
  const neuspjele: NeuspjelaSlika[] = [];
  for (const [i, url] of urls.entries()) {
    try {
      const odgovor = await fetchFn(url);
      if (!odgovor.ok) throw new Error(`HTTP ${odgovor.status}`);
      const najavljeno = Number(odgovor.headers.get("content-length"));
      if (Number.isFinite(najavljeno) && najavljeno > MAX_BAJTA_SLIKE) {
        throw new Error(`slika najavljuje ${najavljeno} bajta, granica je ${MAX_BAJTA_SLIKE}`);
      }
      const bafer = Buffer.from(await odgovor.arrayBuffer());
      if (bafer.length > MAX_BAJTA_SLIKE) {
        throw new Error(`slika ima ${bafer.length} bajta, granica je ${MAX_BAJTA_SLIKE}`);
      }
      const ime = nazivSlike(i + 1, url, odgovor.headers.get("content-type"));
      const putanja = join(mapa, ime);
      if (!existsSync(putanja)) writeFileSync(putanja, bafer);
      fajlovi.push(ime);
    } catch (e) {
      neuspjele.push({ url, greska: e instanceof Error ? e.message : String(e) });
    }
  }
  return { fajlovi, neuspjele };
}
