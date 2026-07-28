// Citanje i pisanje plana izdvajanja sa diska, plus kljuc protiv dvostrukog izvrsenja.
//
// Odvojeno od `plan.ts`, koji je namjerno bez I/O (ciste funkcije, testiraju se bez fajlova).
// Isti razlog zbog kojeg `snapshoti.ts` stoji odvojeno od `stats.ts`: format i logika citanja
// moraju biti isti za CLI (koji plan pravi i izvrsava) i za MCP i sedmicni izvjestaj (koji ga
// samo citaju).
//
// Do sada su ove funkcije zivjele lokalno u `src/cli/index.ts`, pa ih MCP nije mogao koristiti.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SponsorPlan } from "./plan.js";

export const PLAN_FILE = ".olx-pik/plan-izdvajanja.json";

/** Cita plan i provjerava da fajl stvarno jeste plan, a ne bilo kakav JSON. */
export function citajPlan(putanja: string = PLAN_FILE): SponsorPlan {
  const raw: unknown = JSON.parse(readFileSync(putanja, "utf8"));
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SponsorPlan).termini)) {
    throw new Error(`Fajl ${putanja} nije plan izdvajanja.`);
  }
  return raw as SponsorPlan;
}

/**
 * Cita plan ako postoji, inace vraca null.
 *
 * Za citaoce kojima plan nije obavezan (sedmicni izvjestaj, MCP pregled): odsustvo plana je
 * normalno stanje, ne greska. Neispravan fajl se takodjer preskace, uz poruku na stderr, da
 * jedan pokvaren plan ne obori cijeli sedmicni posao.
 */
export function citajPlanAkoPostoji(putanja: string = PLAN_FILE): SponsorPlan | null {
  try {
    return citajPlan(putanja);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    console.error(`Plan izdvajanja nije citljiv (${putanja}): ${String(e instanceof Error ? e.message : e)}`);
    return null;
  }
}

export function upisiPlan(plan: SponsorPlan, putanja: string = PLAN_FILE): void {
  mkdirSync(dirname(putanja), { recursive: true });
  writeFileSync(putanja, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

/**
 * Kljuc protiv dvostrukog izvrsenja: dva paralelna pokretanja ne smiju naplatiti isti termin,
 * niti dvaput promijeniti istu cijenu.
 *
 * Koristi `flag: "wx"`, koji na nivou fajl sistema ne uspije ako fajl vec postoji, pa nema
 * prozora izmedju provjere i upisa. Vraca funkciju za otpustanje.
 */
export function zauzmiKljuc(putanja: string): () => void {
  const kljuc = `${putanja}.lock`;
  try {
    mkdirSync(dirname(kljuc), { recursive: true });
    writeFileSync(kljuc, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error(`Izvrsenje je vec u toku (postoji ${kljuc}). Ako je proces pao, obrisi taj fajl rucno.`);
  }
  return () => {
    try {
      rmSync(kljuc, { force: true });
    } catch {
      // ako se kljuc ne moze obrisati, sljedece pokretanje ce to prijaviti
    }
  };
}
