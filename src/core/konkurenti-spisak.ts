// Spisak konkurenata koje klijent prati i uparivanja njegovih artikala sa konkurentskim.
//
// Stanje klijenta, isti obrazac kao izuzeca.ts: jedan JSON u .olx-pik/, atomican upis, ciste
// funkcije nad ucitanim stanjem. Odvojen od konkurenti.ts, koji ostaje I/O dnevnih snimaka:
// ovdje je ODLUKA klijenta (koga pratiti, koji artikal je ciji pandan), tamo su MJERENJA.
//
// Uparivanje je rucna potvrda nad automatskim prijedlogom: kod predlozi parove po slicnosti
// naslova (match.ts), covjek potvrdi ili odbije, pa se signali (cijena, obnova, izdvajanje)
// dalje javljaju samo na potvrdjenim parovima. Odbijena uparivanja se CUVAJU, da se isti par
// ne nudi ponovo svaki dan.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildIdf, scorePair, DEFAULTS } from "./match.js";

export interface KonkurentUnos {
  username: string;
  /** Ko je konkurenta stavio na spisak: "klijent" ili "admin". */
  dodao: string;
  kada: string;
  biljeska?: string;
}

export type UparivanjeStatus = "predlozeno" | "potvrdjeno" | "odbijeno";

export interface Uparivanje {
  moj_id: number;
  moj_naslov: string;
  konkurent: string;
  njihov_id: number;
  njihov_naslov: string;
  /** Slicnost naslova 0..1 iz match.ts, samo informativno poslije potvrde. */
  ocjena: number;
  status: UparivanjeStatus;
  kada: string;
}

export interface KonkurentiParametri {
  /** Promjena cijene ispod ovog procenta se ne javlja. */
  prag_cijene_posto: number;
  /** Dnevni snimci stariji od ovoga se prorjedjuju na jedan po ISO sedmici. */
  cuvanje_dana: number;
}

export interface KonkurentiStanje {
  verzija: 1;
  parametri: KonkurentiParametri;
  konkurenti: KonkurentUnos[];
  uparivanja: Uparivanje[];
}

export function podrazumijevanoStanje(): KonkurentiStanje {
  return { verzija: 1, parametri: { prag_cijene_posto: 5, cuvanje_dana: 30 }, konkurenti: [], uparivanja: [] };
}

export function putanjaKonkurenti(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_KONKURENTI_FILE || ".olx-pik/konkurenti.json";
}

export function ucitajKonkurentiStanje(putanja = putanjaKonkurenti()): KonkurentiStanje {
  try {
    const s = JSON.parse(readFileSync(putanja, "utf8")) as KonkurentiStanje;
    if (!s || typeof s !== "object" || !Array.isArray(s.konkurenti)) return podrazumijevanoStanje();
    // Parametri se dopune podrazumijevanim, da fajl iz starijeg izdanja ne rusi citanje.
    return {
      verzija: 1,
      parametri: { ...podrazumijevanoStanje().parametri, ...(s.parametri ?? {}) },
      konkurenti: s.konkurenti,
      uparivanja: Array.isArray(s.uparivanja) ? s.uparivanja : [],
    };
  } catch {
    return podrazumijevanoStanje(); // nema fajla ili je pokvaren: spisak je prazan
  }
}

export function upisiKonkurentiStanje(stanje: KonkurentiStanje, putanja = putanjaKonkurenti()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(stanje, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts
}

// ---- ciste funkcije, testirane bez diska ----

function istoIme(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Novo stanje sa dodatim konkurentom. Ponovno dodavanje istog username-a ne pravi duplikat. */
export function saKonkurentom(stanje: KonkurentiStanje, unos: KonkurentUnos): KonkurentiStanje {
  if (stanje.konkurenti.some((k) => istoIme(k.username, unos.username))) return stanje;
  return { ...stanje, konkurenti: [...stanje.konkurenti, unos] };
}

/** Novo stanje bez konkurenta I bez njegovih uparivanja (bez spiska nema ni signala po parovima). */
export function bezKonkurenta(stanje: KonkurentiStanje, username: string): KonkurentiStanje {
  if (!stanje.konkurenti.some((k) => istoIme(k.username, username))) return stanje;
  return {
    ...stanje,
    konkurenti: stanje.konkurenti.filter((k) => !istoIme(k.username, username)),
    uparivanja: stanje.uparivanja.filter((u) => !istoIme(u.konkurent, username)),
  };
}

/** Samo potvrdjena uparivanja: jedina po kojima se klijentu javljaju signali. */
export function aktivnaUparivanja(stanje: KonkurentiStanje): Uparivanje[] {
  return stanje.uparivanja.filter((u) => u.status === "potvrdjeno");
}

/**
 * Odluka nad predlozenim parom. Vraca i flag da pozivalac zna je li par uopste postojao:
 * tiho "nista se nije desilo" bi klijent protumacio kao potvrdu.
 */
export function odluciUparivanje(
  stanje: KonkurentiStanje,
  mojId: number,
  njihovId: number,
  odluka: "potvrdi" | "odbij",
  kada: string,
): { stanje: KonkurentiStanje; nadjeno: boolean } {
  let nadjeno = false;
  const uparivanja = stanje.uparivanja.map((u) => {
    if (u.moj_id !== mojId || u.njihov_id !== njihovId) return u;
    nadjeno = true;
    return { ...u, status: (odluka === "potvrdi" ? "potvrdjeno" : "odbijeno") as UparivanjeStatus, kada };
  });
  return { stanje: nadjeno ? { ...stanje, uparivanja } : stanje, nadjeno };
}

export interface ArtikalZaUparivanje {
  id: number;
  title: string;
}

/** Koliko se prijedloga po konkurentu maksimalno nudi odjednom: spisak mora ostati pregledan. */
export const MAX_PRIJEDLOGA_PO_KONKURENTU = 20;

/**
 * Prijedlozi parova mojih artikala sa artiklima JEDNOG konkurenta, po slicnosti naslova
 * (match.ts: IDF jaccard + trigrami). Za svaki moj artikal najvise jedan kandidat, prag je
 * DEFAULTS.reviewThreshold. Parovi koji vec postoje u stanju (ma koji status, i odbijeni)
 * se preskacu: odbijen par se ne nudi ponovo.
 */
export function predloziUparivanja(
  moji: ArtikalZaUparivanje[],
  njihovi: ArtikalZaUparivanje[],
  konkurent: string,
  postojeca: Uparivanje[],
  kada: string,
): Uparivanje[] {
  if (moji.length === 0 || njihovi.length === 0) return [];
  const vecPredlozeno = new Set(
    postojeca.filter((u) => istoIme(u.konkurent, konkurent)).map((u) => `${u.moj_id}:${u.njihov_id}`),
  );
  // Moj artikal koji vec ima potvrdjen par kod ovog konkurenta ne trazi novi.
  const uparenMoj = new Set(
    postojeca.filter((u) => istoIme(u.konkurent, konkurent) && u.status === "potvrdjeno").map((u) => u.moj_id),
  );
  const idf = buildIdf([...moji.map((m) => m.title), ...njihovi.map((n) => n.title)]);
  const prijedlozi: Uparivanje[] = [];
  for (const moj of moji) {
    if (uparenMoj.has(moj.id)) continue;
    let najbolji: { artikal: ArtikalZaUparivanje; ocjena: number } | null = null;
    for (const njihov of njihovi) {
      if (vecPredlozeno.has(`${moj.id}:${njihov.id}`)) continue;
      const ocjena = scorePair(moj.title, njihov.title, idf);
      if (ocjena >= DEFAULTS.reviewThreshold && (najbolji === null || ocjena > najbolji.ocjena)) {
        najbolji = { artikal: njihov, ocjena };
      }
    }
    if (najbolji) {
      prijedlozi.push({
        moj_id: moj.id,
        moj_naslov: moj.title,
        konkurent,
        njihov_id: najbolji.artikal.id,
        njihov_naslov: najbolji.artikal.title,
        ocjena: Math.round(najbolji.ocjena * 100) / 100,
        status: "predlozeno",
        kada,
      });
    }
  }
  return prijedlozi.sort((a, b) => b.ocjena - a.ocjena).slice(0, MAX_PRIJEDLOGA_PO_KONKURENTU);
}

/** Novo stanje sa dopisanim prijedlozima (duplikati po (moj_id, njihov_id, konkurent) se preskacu). */
export function saPrijedlozima(stanje: KonkurentiStanje, prijedlozi: Uparivanje[]): { stanje: KonkurentiStanje; dodano: number } {
  const postoji = new Set(stanje.uparivanja.map((u) => `${u.konkurent.toLowerCase()}:${u.moj_id}:${u.njihov_id}`));
  const nova = prijedlozi.filter((p) => !postoji.has(`${p.konkurent.toLowerCase()}:${p.moj_id}:${p.njihov_id}`));
  if (nova.length === 0) return { stanje, dodano: 0 };
  return { stanje: { ...stanje, uparivanja: [...stanje.uparivanja, ...nova] }, dodano: nova.length };
}
