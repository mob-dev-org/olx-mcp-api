// Imena prodavaca koja je KLIJENT sam spomenuo u razgovoru.
//
// Ne mijesati sa `konkurenti.ts`: tamo se cuvaju SNIMCI konkurenata (izvjestaj i lista oglasa,
// jedan fajl po nalogu i danu), i to je admin posao koji zove API. Ovdje se ne zove nista i ne cuva
// se nista o tom nalogu, samo ime i vrijeme kad ga je covjek pomenuo.
//
// Cemu sluzi: klijentu konkurencija nije u paketu i bot mu na pitanje o njoj odgovara da se javi
// programerima (`runtime/SISTEM-klijent.md`). Ali ime koje je on sam naveo je najbolji trag o tome
// koga stvarno gleda, bolji od svakog naseg pogadjanja. Zato se tiho zapise i ostaje ulaz za ADMIN
// posao. U klijentskom razgovoru se odavde NIKAD nista ne cita.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SpomenutiKonkurent {
  username: string;
  /** ISO vrijeme prvog spominjanja. */
  prvi_put: string;
  /** ISO vrijeme zadnjeg spominjanja. */
  zadnji_put: string;
  /** Koliko puta je klijent to ime spomenuo. Ponavljanje je signal koga stvarno gleda. */
  puta: number;
  /** Kratak kontekst u kojem je ime palo. Bez prepisivanja cijele poruke. */
  napomena?: string;
}

export function putanjaSpomenutih(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_SPOMENUTI_KONKURENTI_FILE || ".olx-pik/spomenuti-konkurenti.jsonl";
}

/**
 * Ocisti username kako ga je covjek napisao.
 *
 * Ljudi ga zalijepe kao link, sa @ ispred, ili sa razmakom. Poredjenje i sazimanje rade nad ovim
 * oblikom, da isto ime napisano na dva nacina ne postane dva zapisa.
 */
export const MAX_USERNAME = 60;

export function normalizujUsername(sirovo: string): string {
  const bezLinka = sirovo.trim().replace(/^https?:\/\/[^/]+\/(?:korisnik|shop|users?)\//i, "");
  const ocisceno = bezLinka
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "")
    .trim();
  // Samo prva rijec, i to kratka. Username na platformi nema razmaka, pa je sve poslije prvog
  // razmaka visak. Ovo je i brana: bez nje bi model umjesto imena mogao proslijediti cijelu poruku
  // covjeka, a ovaj zapis smije nositi ime i kratku napomenu, nikad preprican razgovor.
  const prvaRijec = ocisceno.split(/\s+/)[0] ?? "";
  return prvaRijec.slice(0, MAX_USERNAME);
}

/**
 * Sazima dnevnik u stanje po korisniku.
 *
 * Fajl je append-only, jedan red po spominjanju, jer je to jedini oblik upisa koji ne moze izgubiti
 * raniji zapis kad se dva upisa poklope. Sazimanje je zato posao citanja, ne upisa.
 */
export function sazmiSpomenute(
  redovi: { username: string; kada: string; napomena?: string }[],
): SpomenutiKonkurent[] {
  const po = new Map<string, SpomenutiKonkurent>();
  for (const red of redovi) {
    const ime = normalizujUsername(red.username);
    if (!ime) continue;
    const kljuc = ime.toLowerCase();
    const postojeci = po.get(kljuc);
    if (!postojeci) {
      po.set(kljuc, {
        username: ime,
        prvi_put: red.kada,
        zadnji_put: red.kada,
        puta: 1,
        ...(red.napomena ? { napomena: red.napomena } : {}),
      });
      continue;
    }
    postojeci.puta += 1;
    if (red.kada > postojeci.zadnji_put) postojeci.zadnji_put = red.kada;
    if (red.kada < postojeci.prvi_put) postojeci.prvi_put = red.kada;
    // Zadnja napomena pobjedjuje: ona je najsvjezija slika zasto ga klijent gleda.
    if (red.napomena) postojeci.napomena = red.napomena;
  }
  return [...po.values()].sort((a, b) => (a.zadnji_put < b.zadnji_put ? 1 : a.zadnji_put > b.zadnji_put ? -1 : 0));
}

/**
 * Zapisuje jedno spominjanje. Vraca ocisceno ime, ili prazno kad od unosa nije ostalo nista
 * upotrebljivo. Prazno NIJE greska: ovo je tiha biljeska, ne radnja koju je korisnik trazio.
 */
export function zabiljeziSpomenutog(
  username: string,
  napomena?: string,
  putanja = putanjaSpomenutih(),
  sada = new Date(),
): string {
  const ime = normalizujUsername(username);
  if (!ime) return "";
  const red = {
    username: ime,
    kada: sada.toISOString(),
    ...(napomena?.trim() ? { napomena: napomena.trim() } : {}),
  };
  mkdirSync(dirname(putanja), { recursive: true });
  appendFileSync(putanja, `${JSON.stringify(red)}\n`, "utf8");
  return ime;
}

/** Sazet spisak za admina. Pokvaren red se preskace: jedan lose upisan red ne obara cijeli spisak. */
export function ucitajSpomenute(putanja = putanjaSpomenutih()): SpomenutiKonkurent[] {
  let sirovo: string;
  try {
    sirovo = readFileSync(putanja, "utf8");
  } catch {
    return [];
  }
  const redovi: { username: string; kada: string; napomena?: string }[] = [];
  for (const red of sirovo.split("\n")) {
    if (!red.trim()) continue;
    try {
      const o = JSON.parse(red) as { username?: unknown; kada?: unknown; napomena?: unknown };
      if (typeof o.username !== "string" || typeof o.kada !== "string") continue;
      redovi.push({
        username: o.username,
        kada: o.kada,
        ...(typeof o.napomena === "string" ? { napomena: o.napomena } : {}),
      });
    } catch {
      continue;
    }
  }
  return sazmiSpomenute(redovi);
}
