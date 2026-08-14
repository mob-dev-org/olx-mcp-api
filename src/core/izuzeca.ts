// Oglasi koje vlasnik ne zeli automatski dizati: "ovaj ne obnavljaj" i "ovaj ne izdvajaj".
//
// Zasto postoji, iz prakse vlasnika shopa (30.07.2026.): neki artikli mu se ne isplati dizati.
// Bez ovog spiska svaka dnevna obnova ih ponovo pokupi, jer je jedini kriterij bio
// refresh_available. Uz to ima i racunsku stranu: shop koji sedmicno objavljuje nove artikle
// prelazi besplatnu mjesecnu kvotu obnova, pa svaka obnova potrosena na artikal koji vlasnik ne
// zeli dizati je obnova manje za onaj koji zeli.
//
// Spisak zivi u klonu (`.olx-pik/izuzeca.json`), jer je odluka o pojedinom artiklu stvar TOG
// klijenta. Van gita je, kao i ostatak `.olx-pik/`.
//
// Opseg je namjerno odvojen: "ne obnavljaj" i "ne izdvajaj" nisu ista odluka. Artikal se moze
// obnavljati besplatno a ne trositi kredite na njega.
//
// Treci opseg, "objava", je odvojena treca odluka: klijent sa velikim katalogom udari u limit
// broja oglasa po grupi kategorija koji nalog dobija sa API-ja, pa unaprijed oznaci koji artikli
// su najnizi prioritet za mjesto u tom limitu. To je samo signal za covjekovu odluku, ne akcija:
// ne dira obnovu ni izdvajanje, vidi komentar uz polje `objava` nize.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const OPSEZI = ["obnova", "izdvajanje", "objava", "sve"] as const;
export type Opseg = (typeof OPSEZI)[number];

export interface Izuzece {
  /** ne ulazi u automatsku obnovu */
  obnova: boolean;
  /** ne ulazi u plan izdvajanja */
  izdvajanje: boolean;
  /**
   * Najnizi prioritet za mjesto u limitu objave: prvi kandidat da se skloni kad grupa
   * kategorija udari u limit. Oznaka je signal za covjekovu odluku, ne akcija - ne dira
   * ni obnovu ni izdvajanje, a stvarno sklanjanje ide kroz olx_bulk_sklanjanje.
   *
   * Polje je NAMJERNO opciono, ne obavezno: postojeci `.olx-pik/izuzeca.json` na klonovima
   * nema to polje, a fajl se cita kroz cast bez validacije, pa bi obavezno polje bilo laz o
   * zatecenim podacima.
   */
  objava?: boolean;
  razlog: string | null;
  kada: string;
}

/** id oglasa -> izuzece. Kljuc je string jer JSON objekti nemaju brojeve kao kljuceve. */
export type Izuzeca = Record<string, Izuzece>;

export function putanjaIzuzeca(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_IZUZECA_FILE || ".olx-pik/izuzeca.json";
}

export function ucitajIzuzeca(putanja = putanjaIzuzeca()): Izuzeca {
  try {
    const sadrzaj = JSON.parse(readFileSync(putanja, "utf8")) as Izuzeca;
    return sadrzaj && typeof sadrzaj === "object" ? sadrzaj : {};
  } catch {
    return {}; // nema fajla ili je pokvaren: spisak je prazan, obnova radi kao i prije
  }
}

export function upisiIzuzeca(izuzeca: Izuzeca, putanja = putanjaIzuzeca()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(izuzeca, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao plan-fajl.ts
}

// ---- ciste funkcije, testirane bez diska ----

/** Nova mapa sa dodatim izuzecem. Ponovni dodatak istog id-a spaja opsege, ne gubi stari. */
export function saDodatim(izuzeca: Izuzeca, id: number, opseg: Opseg, razlog: string | null, kada: string): Izuzeca {
  const kljuc = String(id);
  const staro = izuzeca[kljuc];
  return {
    ...izuzeca,
    [kljuc]: {
      obnova: opseg === "sve" || opseg === "obnova" || Boolean(staro?.obnova),
      izdvajanje: opseg === "sve" || opseg === "izdvajanje" || Boolean(staro?.izdvajanje),
      objava: opseg === "sve" || opseg === "objava" || Boolean(staro?.objava),
      razlog: razlog ?? staro?.razlog ?? null,
      kada,
    },
  };
}

/**
 * Nova mapa bez izuzeca za dati opseg. Kad se skloni samo jedan opseg a drugi ostaje, zapis
 * ostaje; kad nijedan ne ostaje, zapis se brise da fajl ne raste beskonacno.
 */
export function bezSklonjenog(izuzeca: Izuzeca, id: number, opseg: Opseg): Izuzeca {
  const kljuc = String(id);
  const staro = izuzeca[kljuc];
  if (!staro) return izuzeca;
  const novo = { ...izuzeca };
  if (opseg === "sve") {
    delete novo[kljuc];
    return novo;
  }
  const preostalo: Izuzece = {
    ...staro,
    obnova: opseg === "obnova" ? false : staro.obnova,
    izdvajanje: opseg === "izdvajanje" ? false : staro.izdvajanje,
    objava: opseg === "objava" ? false : Boolean(staro.objava),
  };
  if (!preostalo.obnova && !preostalo.izdvajanje && !preostalo.objava) {
    delete novo[kljuc];
    return novo;
  }
  novo[kljuc] = preostalo;
  return novo;
}

export function jeIzuzet(izuzeca: Izuzeca, id: number, opseg: "obnova" | "izdvajanje" | "objava"): boolean {
  return Boolean(izuzeca[String(id)]?.[opseg]);
}

/**
 * Odvoji kandidate na one koji idu dalje i one koje je vlasnik izuzeo.
 * Vraca oba, jer se preskoceni MORAJU prijaviti: tiho preskakanje izgleda kao da obnova ne radi.
 *
 * Opseg je namjerno ogranicen na "obnova" | "izdvajanje", bez "objava": oznaka `objava` nikad
 * ne smije tiho blokirati dnevnu obnovu ili plan izdvajanja, ona nije razlog da se oglas
 * preskoci u automatskom poslu, nego samo signal za covjekovu odluku o limitu objave.
 */
export function odvojiIzuzete<T extends { id: number }>(
  kandidati: T[],
  izuzeca: Izuzeca,
  opseg: "obnova" | "izdvajanje",
): { prolaze: T[]; preskoceni: T[] } {
  const prolaze: T[] = [];
  const preskoceni: T[] = [];
  for (const k of kandidati) {
    if (jeIzuzet(izuzeca, k.id, opseg)) preskoceni.push(k);
    else prolaze.push(k);
  }
  return { prolaze, preskoceni };
}

/**
 * Prenos izuzeca sa starog oglasa na novi, pri ponovnoj objavi iz arhive: novi oglas dobija
 * novi id, a odluka vlasnika ("ovaj ne diraj") se odnosi na ARTIKAL, ne na broj. Bez prenosa
 * bi se ponovo objavljen artikal tiho vratio u automatsku obnovu.
 */
export function preneseno(izuzeca: Izuzeca, stariId: number, noviId: number, kada: string): Izuzeca {
  const staro = izuzeca[String(stariId)];
  if (!staro) return izuzeca;
  let novo: Izuzeca = { ...izuzeca };
  delete novo[String(stariId)];
  if (staro.obnova) novo = saDodatim(novo, noviId, "obnova", staro.razlog, kada);
  if (staro.izdvajanje) novo = saDodatim(novo, noviId, "izdvajanje", staro.razlog, kada);
  if (staro.objava) novo = saDodatim(novo, noviId, "objava", staro.razlog, kada);
  return novo;
}

/** Spisak za prikaz: id, sva tri opsega i razlog, sortirano po id-u da izlaz bude stabilan. */
export function spisak(
  izuzeca: Izuzeca,
): { id: number; obnova: boolean; izdvajanje: boolean; objava: boolean; razlog: string | null; kada: string }[] {
  return Object.entries(izuzeca)
    .map(([kljuc, v]) => ({
      id: Number(kljuc),
      obnova: v.obnova,
      izdvajanje: v.izdvajanje,
      objava: Boolean(v.objava),
      razlog: v.razlog ?? null,
      kada: v.kada,
    }))
    .sort((a, b) => a.id - b.id);
}
