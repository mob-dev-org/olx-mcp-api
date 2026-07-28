// Citanje i pisanje plana izdvajanja sa diska, plus kljuc protiv dvostrukog izvrsenja.
//
// Odvojeno od `plan.ts`, koji je namjerno bez I/O (ciste funkcije, testiraju se bez fajlova).
// Isti razlog zbog kojeg `snapshoti.ts` stoji odvojeno od `stats.ts`: format i logika citanja
// moraju biti isti za CLI (koji plan pravi i izvrsava) i za MCP i sedmicni izvjestaj (koji ga
// samo citaju).
//
// Do sada su ove funkcije zivjele lokalno u `src/cli/index.ts`, pa ih MCP nije mogao koristiti.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  // Preko privremenog fajla pa rename: prekid usred upisa (restart u 03h) ne smije ostaviti
  // presjecen JSON, jer bi citaoci plan tiho preskocili i plan bi bio izgubljen.
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja);
}

/**
 * Kljuc protiv dvostrukog izvrsenja: dva paralelna pokretanja ne smiju naplatiti isti termin,
 * niti dvaput promijeniti istu cijenu.
 *
 * Koristi `flag: "wx"`, koji na nivou fajl sistema ne uspije ako fajl vec postoji, pa nema
 * prozora izmedju provjere i upisa. Vraca funkciju za otpustanje.
 *
 * Samoizljecenje: u kljucu stoji pid vlasnika. Ako taj proces vise ne postoji (nocni restart
 * usred posla, pad masine), kljuc je ostatak i preuzima se sam. Bez toga bi klijentska sesija,
 * kojoj je Bash zabranjen, ostala trajno zakljucana i snapshoti bi tiho stali.
 */
export function zauzmiKljuc(putanja: string): () => void {
  const kljuc = `${putanja}.lock`;
  mkdirSync(dirname(kljuc), { recursive: true });
  for (let pokusaj = 0; pokusaj < 2; pokusaj++) {
    try {
      writeFileSync(kljuc, String(process.pid), { flag: "wx" });
      return () => {
        try {
          rmSync(kljuc, { force: true });
        } catch {
          // ako se kljuc ne moze obrisati, sljedece pokretanje ce ga preuzeti po mrtvom pidu
        }
      };
    } catch {
      // kljuc postoji: provjeri je li vlasnik ziv
    }
    let vlasnik = 0;
    try {
      vlasnik = Number(readFileSync(kljuc, "utf8").trim());
    } catch {
      continue; // kljuc nestao izmedju dva koraka, novi krug pokusava upis
    }
    if (Number.isFinite(vlasnik) && vlasnik > 0) {
      try {
        process.kill(vlasnik, 0);
        // vlasnik zivi: ovo je stvarno paralelno izvrsenje, ne ostatak
        throw new Error(`Izvrsenje je vec u toku (${kljuc}, pid ${vlasnik}).`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Izvrsenje")) throw e;
        // vlasnik mrtav: ostatak, preuzmi
      }
    }
    console.error(`Kljuc ${kljuc} je ostatak mrtvog procesa (pid ${vlasnik || "?"}), preuzimam.`);
    rmSync(kljuc, { force: true });
  }
  throw new Error(`Izvrsenje je vec u toku (postoji ${kljuc}). Ako je proces pao, obrisi taj fajl rucno.`);
}
