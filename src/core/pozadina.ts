// Stalna pozadina klijenta: scena na koju se njegovi artikli stavljaju umjesto na bijelu podlogu.
//
// Zasto postoji: shop cije sve slike dijele isti prostor izgleda kao jedan katalog, a ne kao
// gomila fotografija sa telefona. Klijent pozadinu zada JEDNOM, poslije samo slika artikal.
//
// Dva oblika, oba podrzana i oba se svode na isto mjesto u promptu:
//   - opis rijecima ("svijetlo sivi beton"): najjeftinije, bez dodatne ulazne slike
//   - slika pozadine: ide modelu kao referenca, daje dosljedniji rezultat od opisa
// Kad su zadana oba, slika vodi a opis joj se dodaje kao pojasnjenje.
//
// Od v0.13 pozadina sa SLIKOM se vise ne crta iznova nego se artikal na nju SLAZE u kodu
// (slaganje.ts): izrez artikla se zalijepi na pravu sliku pozadine, pa su pozadina i logo na
// slozenoj slici piksel identicni. Gemini poslije samo doradjuje svjetlo i sjenu, i ta doradjena
// varijanta garanciju za logo nema; klijent dobije obje. `slot` u zapisu kaze gdje artikal
// stoji (v1: dno sredina, sirina i margina u procentima). Pozadina zadana SAMO OPISOM i dalje
// ide starim putem crtanja, jer bez slike nema sta da se lijepi.
//
// Sve o klijentu zivi u njegovom klonu (CLAUDE.md), pa i ovo: `.olx-pik/pozadina/`.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { provjeriSlot, ZADANI_SLOT, type Slot } from "./slaganje.js";

/** Mapa je vlastita da bi backup mogao uzeti i JSON i sliku jednim obrascem, bez diranja diska. */
export function mapaPozadine(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_POZADINA_DIR || ".olx-pik/pozadina";
}

export function putanjaPozadine(env: NodeJS.ProcessEnv = process.env): string {
  return join(mapaPozadine(env), "pozadina.json");
}

/** Najveca slika pozadine koja se prima. Preko toga poziv modelu postaje bespotrebno skup. */
export const POZADINA_MAX_BAJTOVA = 8 * 1024 * 1024;

/** Opis pozadine smije biti duzi od dopune na receptu, ali prolazi isti filter sadrzaja. */
export const POZADINA_OPIS_MAX = 200;

const PODRZANE_EKSTENZIJE = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export interface Pozadina {
  /** Opis scene rijecima; prazno kad je zadana samo slika. */
  opis?: string;
  /** Putanja sacuvane slike pozadine u klonu; prazno kad je zadan samo opis. */
  slika?: string;
  /** Kad je postavljena, ISO. Sluzi da se covjeku moze reci otkad mu je pozadina takva. */
  postavljeno?: string;
  /** Gdje artikal stoji pri slaganju. Stari zapisi ga nemaju: tada vazi ZADANI_SLOT. */
  slot?: Slot;
}

/** Slot iz sirovog JSON-a, tolerantno: pokvaren ili nepotpun slot se ignorise, ne obara citanje. */
function slotIzZapisa(sirovo: unknown): Slot | undefined {
  if (!sirovo || typeof sirovo !== "object" || Array.isArray(sirovo)) return undefined;
  const z = sirovo as Record<string, unknown>;
  const slot: Slot = {
    sidro: "dno-sredina",
    sirinaPosto: Number(z.sirinaPosto),
    marginaDnaPosto: Number(z.marginaDnaPosto),
  };
  return provjeriSlot(slot).ok ? slot : undefined;
}

/** Sacuvana slika uvijek nosi ovo ime, da je backup moze uzeti fiksnim obrascem. */
function imeSlike(ekstenzija: string): string {
  return `slika${ekstenzija}`;
}

export function ucitajPozadinu(env: NodeJS.ProcessEnv = process.env): Pozadina | null {
  const fajl = putanjaPozadine(env);
  if (!existsSync(fajl)) return null;
  try {
    const sirovo: unknown = JSON.parse(readFileSync(fajl, "utf8"));
    if (!sirovo || typeof sirovo !== "object" || Array.isArray(sirovo)) return null;
    const zapis = sirovo as Record<string, unknown>;
    const opis = typeof zapis.opis === "string" && zapis.opis.trim() ? zapis.opis.trim() : undefined;
    const imeSlikeIzZapisa = typeof zapis.slika === "string" ? zapis.slika : undefined;
    // U JSON-u stoji samo ime fajla, ne puna putanja: klon se smije preseliti ili preimenovati.
    const slika = imeSlikeIzZapisa ? join(mapaPozadine(env), imeSlikeIzZapisa) : undefined;
    const postavljeno = typeof zapis.postavljeno === "string" ? zapis.postavljeno : undefined;
    const slot = slotIzZapisa(zapis.slot);
    if (!opis && !(slika && existsSync(slika))) return null;
    return {
      ...(opis ? { opis } : {}),
      ...(slika && existsSync(slika) ? { slika } : {}),
      ...(postavljeno ? { postavljeno } : {}),
      ...(slot ? { slot } : {}),
    };
  } catch {
    // pokvaren zapis se tretira kao da pozadine nema; klijent je postavi ponovo
    return null;
  }
}

export type NalazPozadine = { ok: true; pozadina: Pozadina } | { ok: false; razlog: string };

/**
 * Zapamti pozadinu u klonu. `izvorSlike` je putanja fotografije koju je klijent poslao; ona se
 * KOPIRA u mapu pozadine, jer original iz Telegram inboxa nestaje kad ga ciscenje pokupi.
 *
 * Postavljanje je uvijek potpuna zamjena, ne dopuna: pozadina je jedna i mora biti jednoznacna.
 */
export function sacuvajPozadinu(
  unos: { opis?: string; izvorSlike?: string; slot?: { sirinaPosto?: number; marginaDnaPosto?: number } },
  sada: string = new Date().toISOString(),
  env: NodeJS.ProcessEnv = process.env,
): NalazPozadine {
  const opis = unos.opis?.trim();
  const izvor = unos.izvorSlike?.trim();
  const postojeca = ucitajPozadinu(env);

  // Slot polazi od postojece odluke (nova slika ne resetuje poziciju artikla), pa od zadanog,
  // i preko toga idu polja koja je klijent sada zadao.
  const slot: Slot = {
    ...(postojeca?.slot ?? ZADANI_SLOT),
    ...(unos.slot?.sirinaPosto !== undefined ? { sirinaPosto: unos.slot.sirinaPosto } : {}),
    ...(unos.slot?.marginaDnaPosto !== undefined ? { marginaDnaPosto: unos.slot.marginaDnaPosto } : {}),
  };
  const nalazSlota = provjeriSlot(slot);
  if (!nalazSlota.ok) return { ok: false, razlog: nalazSlota.razlog };

  if (!opis && !izvor) {
    // Samo polozaj: dopuna vec postavljene pozadine, bez diranja slike i opisa.
    if (unos.slot !== undefined && postojeca) {
      const zapis: Record<string, unknown> = { postavljeno: postojeca.postavljeno ?? sada, slot };
      if (postojeca.opis) zapis.opis = postojeca.opis;
      if (postojeca.slika) zapis.slika = basename(postojeca.slika);
      const fajl = putanjaPozadine(env);
      const privremeni = `${fajl}.tmp`;
      writeFileSync(privremeni, `${JSON.stringify(zapis, null, 2)}\n`, "utf8");
      renameSync(privremeni, fajl);
      const ucitana = ucitajPozadinu(env);
      return ucitana ? { ok: true, pozadina: ucitana } : { ok: false, razlog: "pozadina se nije dala procitati poslije upisa" };
    }
    if (unos.slot !== undefined) {
      return { ok: false, razlog: "polozaj artikla se podesava na vec postavljenoj pozadini; prvo zadaj sliku pozadine" };
    }
    return { ok: false, razlog: "zadaj opis pozadine, sliku pozadine, ili oboje" };
  }

  let ekstenzija: string | undefined;
  if (izvor) {
    if (!existsSync(izvor)) return { ok: false, razlog: `slika pozadine ne postoji: ${izvor}` };
    ekstenzija = extname(izvor).toLowerCase();
    if (!PODRZANE_EKSTENZIJE.includes(ekstenzija)) {
      return { ok: false, razlog: `nepodrzan format pozadine: ${ekstenzija || "bez ekstenzije"}; podrzano ${PODRZANE_EKSTENZIJE.join(", ")}` };
    }
    const velicina = statSync(izvor).size;
    if (velicina > POZADINA_MAX_BAJTOVA) {
      return { ok: false, razlog: `slika pozadine je ${Math.round(velicina / 1048576)} MB, najvise ${POZADINA_MAX_BAJTOVA / 1048576} MB` };
    }
  }

  const mapa = mapaPozadine(env);
  mkdirSync(mapa, { recursive: true });
  // Stara slika ide prva, da klon ne ostane sa dvije pozadine razlicitih ekstenzija.
  for (const ime of readdirSync(mapa)) {
    if (ime.startsWith("slika.")) rmSync(join(mapa, ime), { force: true });
  }

  const zapis: Record<string, unknown> = { postavljeno: sada, slot };
  if (opis) zapis.opis = opis;
  if (izvor && ekstenzija) {
    copyFileSync(izvor, join(mapa, imeSlike(ekstenzija)));
    zapis.slika = imeSlike(ekstenzija);
  }

  const fajl = putanjaPozadine(env);
  const privremeni = `${fajl}.tmp`;
  writeFileSync(privremeni, `${JSON.stringify(zapis, null, 2)}\n`, "utf8");
  renameSync(privremeni, fajl);

  const ucitana = ucitajPozadinu(env);
  return ucitana ? { ok: true, pozadina: ucitana } : { ok: false, razlog: "pozadina se nije dala procitati poslije upisa" };
}

/** Ukloni pozadinu. Vraca da li je nesto bilo postavljeno. */
export function obrisiPozadinu(env: NodeJS.ProcessEnv = process.env): boolean {
  const mapa = mapaPozadine(env);
  if (!existsSync(mapa)) return false;
  const bilo = existsSync(putanjaPozadine(env));
  rmSync(mapa, { recursive: true, force: true });
  return bilo;
}

/**
 * Tekst koji ulazi u recept umjesto `{POZADINA}`. Cista funkcija.
 *
 * Kad postoji slika, prompt na nju pokazuje kao na POSLJEDNJU sliku u zahtjevu, a ne kao na
 * "drugu": klijent smije poslati vise fotografija artikla, pa je redni broj promjenjiv a
 * "posljednja" nije. Slaganje sa `generisiSliku`, koja pozadinu dodaje na kraj, je obavezno.
 */
export function opisZaRecept(pozadina: Pozadina): string {
  if (pozadina.slika && pozadina.opis) {
    return `the background scene shown in the LAST image provided, which is ${pozadina.opis}; every image before it shows the product`;
  }
  if (pozadina.slika) {
    return "the background scene shown in the LAST image provided; every image before it shows the product";
  }
  return pozadina.opis ?? "";
}

/** Kratak sazetak za covjeka, bez engleskog iz prompta. */
export function sazetakPozadine(pozadina: Pozadina): string {
  const dijelovi: string[] = [];
  if (pozadina.slika) dijelovi.push(`slika (${resolve(pozadina.slika)})`);
  if (pozadina.opis) dijelovi.push(`opis "${pozadina.opis}"`);
  return dijelovi.join(" i ");
}
