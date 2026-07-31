// Ritam kojim trgovac zeli da mu se oglasi obnavljaju.
//
// Zasto postoji: neki trgovci imaju svoj ritam ("sve u ponedjeljak", "svaki oglas svaka tri
// dana"), a bot je do sada nametao svoj raspored. Obnove su BESPLATNE unutar mjesecne kvote, pa
// se ovdje ne trosi nista klijentovo i ritam moze biti stvar ukusa. Za kredite to NE vazi i oni
// kroz ovaj modul ne prolaze nijednom linijom.
//
// Zasto ovdje a ne u `pamcenje.ts`: pamcenje nosi slobodan tekst za prompt, a ovo cita dnevni
// cron posao koji radi BEZ modela i treba mu broj. Isti obrazac i isto mjesto kao `izuzeca.ts`:
// strukturirana odluka klijenta u `.olx-pik/`, upisuje je alat, cita je posao.
//
// Prag platforme je iznad ovoga i ne moze se zaobici: isti oglas se besplatno obnavlja tek nakon
// praga (shop 7 dana, PRO 21, klasicni 30; olx://pravila-brojeva, Razred A), a platforma to i sama
// javlja poljem `refresh_available`. Ritam zato bira KOJE od dostupnih oglasa dizati danas, nikad
// ne moze dizati cesce nego sto platforma dopusta.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const STRATEGIJE = ["ravnomjerno", "sve-dostupno", "interval"] as const;
export type RitamStrategija = (typeof STRATEGIJE)[number];

export interface Ritam {
  strategija: RitamStrategija;
  /** Samo za `interval`: oglas se ne dize cesce od ovoliko dana. */
  dana?: number;
  /** Kada je zapisano; prazno kad je podrazumijevani, dakle klijent nije nista rekao. */
  kada?: string;
}

/**
 * Podrazumijevani ritam dok trgovac ne kaze svoje: ravnomjerno rasporedi ostvarivo do obnove
 * kvote. Bez `kada`, po cemu se prepoznaje da odluka nije donesena i da vrijedi pitati.
 */
export const RITAM_PODRAZUMIJEVANI: Ritam = { strategija: "ravnomjerno" };

/** Najduzi interval koji ima smisla: preko ovoga oglas ispada iz prometa. */
export const INTERVAL_MAX = 30;

export function putanjaRitma(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_RITAM_FILE || ".olx-pik/ritam-obnova.json";
}

export function ucitajRitam(putanja = putanjaRitma()): Ritam {
  try {
    const sirovo = JSON.parse(readFileSync(putanja, "utf8")) as unknown;
    return normalizujRitam(sirovo);
  } catch {
    // Nema fajla ili je pokvaren: radi se kao i prije, po podrazumijevanom.
    return RITAM_PODRAZUMIJEVANI;
  }
}

export function upisiRitam(ritam: Ritam, putanja = putanjaRitma()): void {
  mkdirSync(dirname(putanja), { recursive: true });
  const tmp = `${putanja}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(ritam, null, 2)}\n`, "utf8");
  renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts i plan-fajl.ts
}

// ---- ciste funkcije, testirane bez diska ----

/**
 * Svede procitani JSON na ispravan ritam. Nepoznata strategija i besmislen interval padaju na
 * podrazumijevani, jer pokvaren zapis ne smije zaustaviti dnevnu obnovu.
 */
export function normalizujRitam(sirovo: unknown): Ritam {
  if (!sirovo || typeof sirovo !== "object") return RITAM_PODRAZUMIJEVANI;
  const o = sirovo as Record<string, unknown>;
  const strategija = STRATEGIJE.find((s) => s === o.strategija);
  if (!strategija) return RITAM_PODRAZUMIJEVANI;
  const kada = typeof o.kada === "string" && o.kada ? o.kada : undefined;

  if (strategija !== "interval") return { strategija, ...(kada ? { kada } : {}) };

  const dana = Number(o.dana);
  if (!Number.isFinite(dana) || dana < 1 || dana > INTERVAL_MAX) return RITAM_PODRAZUMIJEVANI;
  return { strategija, dana: Math.floor(dana), ...(kada ? { kada } : {}) };
}

/** Je li trgovac ikad rekao svoj ritam. Po ovome bot odlucuje da li ga uopste vrijedi pitati. */
export function ritamZapisan(ritam: Ritam): boolean {
  return typeof ritam.kada === "string" && ritam.kada.length > 0;
}

/**
 * Interval podignut na prag platforme. Trgovac koji kaze "svaki dan" ne moze dobiti svaki dan,
 * jer platforma besplatnu obnovu istog oglasa daje tek nakon praga. Bolje mu to reci kroz
 * ispravljen broj nego mu tiho obecati nesto sto se ne moze izvrsiti.
 */
export function intervalUzPrag(dana: number, prag: number): number {
  return Math.max(prag, Math.floor(dana));
}

/**
 * Koji oglasi su danas na redu po intervalu. `zadnjaObnova` je unix sekunda; oglas bez tog
 * podatka se propusta, jer se ne moze dokazati da je prerano.
 */
export function poIntervalu<T extends { id: number; zadnjaObnova?: number }>(
  oglasi: T[],
  dana: number,
  sadaTs: number,
): T[] {
  const prag = dana * 86_400;
  return oglasi.filter((o) => typeof o.zadnjaObnova !== "number" || sadaTs - o.zadnjaObnova >= prag);
}
