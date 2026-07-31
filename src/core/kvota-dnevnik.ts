// Dnevni zapis stanja besplatne kvote obnova.
//
// Zasto postoji: API ne vraca datum kad se kvota resetuje (`/listing/refresh/limits` daje samo
// free_limit, free_count, paid_count, listing_count), a zvanicna pomoc ga ne precizira. Kad se
// kvota resetuje je zato otvoreno pitanje, vodjeno u olx-dokumentacija/pravila-brojeva.md.
//
// Bez ove serije se to pitanje ne moze zatvoriti mjerenjem: stanje kvote se nigdje ne pamti kroz
// dane, pa se danasnje ocitanje nema sa cim uporediti. Sa serijom se dan reseta VIDI: free_count
// skoci nazad prema nuli, a broj oglasa se nije mijenjao.
//
// Jedan red dnevno, samo brojevi. Nista o sadrzaju oglasa.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StanjeKvote {
  freeLimit: number;
  freeCount: number;
  aktivnih: number;
  /** Dan u mjesecu kad se kvota obnavlja, ako je poznat iz ciklusa pretplate. */
  danCiklusa?: number;
}

export function putanjaKvoteDnevnika(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_KVOTA_DNEVNIK_FILE || ".olx-pik/kvota-dnevnik.jsonl";
}

export function zapisiKvotu(stanje: StanjeKvote, dan?: string): void {
  const dnevnik = putanjaKvoteDnevnika();
  const red = {
    ts: new Date().toISOString(),
    dan: dan ?? new Date().toISOString().slice(0, 10),
    free_limit: stanje.freeLimit,
    free_count: stanje.freeCount,
    aktivnih: stanje.aktivnih,
    dan_ciklusa: stanje.danCiklusa ?? null,
  };
  try {
    mkdirSync(dirname(dnevnik), { recursive: true });
    appendFileSync(dnevnik, `${JSON.stringify(red)}\n`, "utf8");
  } catch {
    // best-effort: dnevna obnova ne smije pasti zato sto se zapis nije upisao
  }
}

export interface RedKvote {
  dan: string;
  free_count: number;
  free_limit: number;
  aktivnih: number;
}

/**
 * Dani na kojima je `free_count` PAO u odnosu na prethodni zapis. To je reset kvote.
 *
 * Pad je dovoljan znak: potroseno moze samo rasti unutar istog ciklusa. Prati se i `free_limit`,
 * jer promjena paketa takodjer mijenja brojeve, ali ne znaci reset.
 *
 * Cista funkcija nad procitanim redovima, da je test moze pozvati bez diska.
 */
export function daniResetaKvote(redovi: RedKvote[]): string[] {
  const dani: string[] = [];
  for (let i = 1; i < redovi.length; i++) {
    const prosli = redovi[i - 1];
    const ovaj = redovi[i];
    if (!prosli || !ovaj) continue;
    if (ovaj.free_count < prosli.free_count) dani.push(ovaj.dan);
  }
  return dani;
}

/** Procita dnevnik i vrati redove; pokvaren red se preskace, ne obara citanje. */
export function ucitajKvotuDnevnik(putanja = putanjaKvoteDnevnika()): RedKvote[] {
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch {
    return [];
  }
  const redovi: RedKvote[] = [];
  for (const red of sadrzaj.split("\n")) {
    if (!red.trim()) continue;
    try {
      const r = JSON.parse(red) as Partial<RedKvote>;
      if (typeof r.dan === "string" && typeof r.free_count === "number") {
        redovi.push({
          dan: r.dan,
          free_count: r.free_count,
          free_limit: typeof r.free_limit === "number" ? r.free_limit : 0,
          aktivnih: typeof r.aktivnih === "number" ? r.aktivnih : 0,
        });
      }
    } catch {
      // pokvaren red se preskace
    }
  }
  return redovi;
}
