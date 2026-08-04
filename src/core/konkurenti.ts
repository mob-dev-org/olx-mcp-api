// Cuvanje snimaka konkurenata na disk i citanje natrag.
//
// Odvojeno od `snapshoti.ts` iz dva razloga:
//   1. Ime fajla tamo je `views-YYYY-MM-DD.json`, bez naloga. Dva konkurenta snimljena istog dana
//      bi se pregazila, a `ucitajSnapshote()` bi mijesao vlastite i tudje tacke u istu seriju.
//   2. Snimak konkurenta je jeftin (jedan poziv za profil plus prelistavanje liste), dok je
//      `stats snapshot` skup (jedan poziv po oglasu). Ne treba im isti raspored ni isti format.
//
// Cuva se i kompaktna lista ID-jeva sa naslovima, jer agregat sam ne moze reci KOJI su oglasi
// novi, samo koliko ih je.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { KonkurentIzvjestaj } from "./stats.js";

export const KONKURENTI_DIR = ".olx-pik/konkurenti";

export interface KonkurentOglas {
  id: number;
  title: string;
  price?: number;
  sponsored?: number;
  /** Unix ts ZADNJE OBNOVE (polje `date` sa liste), ne datum objave. Od verzije 2. */
  date?: number;
  has_discount?: boolean;
  discounted_price?: number;
  refresh_available?: boolean;
}

/** Agregat izracunat iz same liste, za snimke bez punog izvjestaja (verzija 2, lagani rezim). */
export interface KonkurentAgregat {
  broj: number;
  sponzorisano: number;
  median_cijene: number | null;
}

// Verzija 1: pun izvjestaj (profil + finished, 2 poziva vise po konkurentu). Verzija 2 (lagani
// rezim dnevnog posla): samo lista aktivnih oglasa i agregat iz nje; cijena, sponsored i date
// zadnje obnove ionako dolaze iz liste, a to su signali koji se dnevno prate.
export interface KonkurentSnimak {
  verzija: number;
  ts: number;
  username: string;
  izvjestaj?: KonkurentIzvjestaj;
  agregat?: KonkurentAgregat;
  oglasi: KonkurentOglas[];
}

// Username ulazi u ime fajla, pa mora biti bezbjedan za fajl sistem. Kosa crta ili tacka u
// imenu bi mogla izaci iz direktorija.
function sigurnoIme(username: string): string {
  return username.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "nepoznat";
}

export function upisiKonkurenta(snimak: KonkurentSnimak, dir: string = KONKURENTI_DIR): string {
  const datum = new Date(snimak.ts * 1000).toISOString().slice(0, 10);
  const putanja = `${dir}/${sigurnoIme(snimak.username)}-${datum}.json`;
  mkdirSync(dir, { recursive: true });
  // tmp + rename, isti obrazac kao plan-fajl.ts: snimak konkurenta se pravi na zahtjev, u bilo
  // koje doba, pa se moze poklopiti sa backupom stanja koji ovaj folder kopira.
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snimak)}\n`, "utf8");
  renameSync(tmp, putanja);
  return putanja;
}

/** Svi snimci jednog konkurenta, hronoloski. Neispravan fajl se preskace uz poruku na stderr. */
export function ucitajKonkurenta(username: string, dir: string = KONKURENTI_DIR): KonkurentSnimak[] {
  if (!existsSync(dir)) return [];
  const prefiks = `${sigurnoIme(username)}-`;
  const snimci: KonkurentSnimak[] = [];
  for (const f of readdirSync(dir).filter((f) => f.startsWith(prefiks) && f.endsWith(".json")).sort()) {
    try {
      const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as KonkurentSnimak;
      // v1 nosi izvjestaj, v2 (lagani) samo listu i agregat: oba su validna, lista je obavezna.
      if (p && typeof p.ts === "number" && Array.isArray(p.oglasi)) snimci.push(p);
    } catch {
      console.error(`Snimak konkurenta ${f} nije citljiv JSON, preskacem.`);
    }
  }
  return snimci.sort((a, b) => a.ts - b.ts);
}

/**
 * Retencija snimaka: dnevni snimci mladji od cuvanjeDana ostaju svi, stariji se prorjedjuju na
 * jedan po ISO sedmici PO KONKURENTU (ostaje najnoviji u sedmici). Cista funkcija nad imenima
 * fajlova; brisanje radi pozivalac. Sa 100 konkurenata dnevni snimci rastu ~1 MB dnevno, pa bi
 * folder bez ovoga za godinu presao 300 MB a serija starija od mjesec ionako sluzi trendu, ne
 * dnevnom diffu.
 */
export function snimciZaBrisanje(imenaFajlova: string[], danasIso: string, cuvanjeDana: number): string[] {
  const granica = new Date(`${danasIso}T00:00:00Z`).getTime() - cuvanjeDana * 86_400_000;
  // kljuc "user|iso-godina-sedmica" -> imena fajlova te sedmice, hronoloski
  const poSedmici = new Map<string, string[]>();
  for (const ime of [...imenaFajlova].sort()) {
    const m = ime.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m?.[1] || !m[2]) continue;
    const datum = new Date(`${m[2]}T00:00:00Z`);
    if (Number.isNaN(datum.getTime()) || datum.getTime() >= granica) continue;
    // ISO sedmica: cetvrtak iste sedmice odredjuje godinu i redni broj.
    const d = new Date(datum);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const prviJanuar = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const sedmica = Math.ceil(((d.getTime() - prviJanuar.getTime()) / 86_400_000 + 1) / 7);
    const kljuc = `${m[1]}|${d.getUTCFullYear()}-${sedmica}`;
    const lista = poSedmici.get(kljuc) ?? [];
    lista.push(ime);
    poSedmici.set(kljuc, lista);
  }
  const zaBrisanje: string[] = [];
  for (const lista of poSedmici.values()) zaBrisanje.push(...lista.slice(0, -1)); // najnoviji ostaje
  return zaBrisanje.sort();
}

/** Usernameovi za koje postoji bar jedan snimak. */
export function pracenjeKonkurenti(dir: string = KONKURENTI_DIR): string[] {
  if (!existsSync(dir)) return [];
  const imena = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const m = f.match(/^(.+)-\d{4}-\d{2}-\d{2}\.json$/);
    if (m?.[1]) imena.add(m[1]);
  }
  return [...imena].sort();
}
