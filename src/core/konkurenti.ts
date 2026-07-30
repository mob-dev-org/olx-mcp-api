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
}

export interface KonkurentSnimak {
  verzija: number;
  ts: number;
  username: string;
  izvjestaj: KonkurentIzvjestaj;
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
      if (p && typeof p.ts === "number" && p.izvjestaj) snimci.push(p);
    } catch {
      console.error(`Snimak konkurenta ${f} nije citljiv JSON, preskacem.`);
    }
  }
  return snimci.sort((a, b) => a.ts - b.ts);
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
