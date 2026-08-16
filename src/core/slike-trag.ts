// Trag zahtjeva za generisanje slike: sta je trazeno, ne samo koliko puta.
//
// Zasto odvojen fajl a ne polje u ai-usage.jsonl: taj dnevnik izricito garantuje "samo brojevi,
// NIKAD sadrzaj poruka ni slike" (ai-dnevnik.ts), jer ga cita bun run ai:usage i jer se salje u
// izvjestaje. Ovdje nam treba suprotno: doslovan tekst koji je klijent napisao, jer bez njega se
// zloupotreba ne moze ni dokazati ni istraziti. Zato dva fajla sa dvije razlicite garancije.
//
// Zapisuje se I odbijen zahtjev. Odbijen zahtjev je upravo onaj koji je zanimljiv: pokazuje da
// je neko pokusao nesto sto alat nije za to.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ZahtjevSlike {
  recept: string;
  /** Doslovan tekst koji je napisao korisnik; prazno kad ga nije bilo. */
  dopuna?: string;
  ulaznihSlika: number;
  odbijeno: boolean;
  /** Razlog odbijanja; prazno kad je zahtjev prosao. */
  razlog?: string;
}

export function putanjaTraga(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_SLIKE_TRAG_FILE || ".olx-pik/slike-zahtjevi.jsonl";
}

export function zapisiZahtjevSlike(zahtjev: ZahtjevSlike): void {
  const trag = putanjaTraga();
  const red = {
    ts: new Date().toISOString(),
    recept: zahtjev.recept,
    dopuna: zahtjev.dopuna ?? null,
    ulaznih_slika: zahtjev.ulaznihSlika,
    odbijeno: zahtjev.odbijeno,
    razlog: zahtjev.razlog ?? null,
  };
  upisi(trag, red);
}

/**
 * Trag referentne (stock) slike sa interneta. Ide u isti fajl kao i zahtjevi generatoru, jer je
 * pitanje isto: sta je od slika uslo u oglase i odakle.
 *
 * Ovdje je zapis DOKAZ, ne statistika. Kad neko za pola godine pita odakle je ta fotografija i
 * pod kojom licencom je smjela u oglas, odgovor postoji samo ako su URL, licenca i autor
 * zapisani u trenutku preuzimanja. Zato se pise i kad je zahtjev odbijen.
 */
export interface StockZahtjev {
  /** Sta je korisnik trazio, doslovno (ime modela). */
  pojam: string;
  /** URL sa kojeg je slika stvarno preuzeta; prazno kad do preuzimanja nije ni doslo. */
  izvorUrl?: string;
  licenca?: string;
  autor?: string;
  /** Stanje artikla kako ga je brana vidjela: "new", "used" ili prazno kad nije bilo poznato. */
  stanje?: string;
  odbijeno: boolean;
  razlog?: string;
}

export function zapisiStockZahtjev(zahtjev: StockZahtjev): void {
  upisi(putanjaTraga(), {
    ts: new Date().toISOString(),
    vrsta: "stock_slika",
    pojam: zahtjev.pojam,
    izvor_url: zahtjev.izvorUrl ?? null,
    licenca: zahtjev.licenca ?? null,
    autor: zahtjev.autor ?? null,
    stanje: zahtjev.stanje ?? null,
    odbijeno: zahtjev.odbijeno,
    razlog: zahtjev.razlog ?? null,
  });
}

function upisi(trag: string, red: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(trag), { recursive: true });
    appendFileSync(trag, `${JSON.stringify(red)}\n`, "utf8");
  } catch {
    // trag je best-effort: posao ne smije pasti zato sto se zapis nije upisao
  }
}
