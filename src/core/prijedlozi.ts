// Citanje prijedloga sedmicne AI runde.
//
// Zasto postoji: runda pise `.olx-pik/prijedlozi/runda-YYYY-MM-DD.md` i tri mjesta u
// dokumentaciji tvrde da ih klijentski bot cita i primjenjuje. Ne moze: `Read(./.olx-pik/**)` mu
// je zabranjen, a `Skill` takodjer, pa se na "primijeni prijedloge" dobijala odbijena dozvola.
// Ovo je bio funkcionalni bug, ne samo netocna dokumentacija.
//
// Rjesenje je alat, ne otvaranje foldera kroz dozvole: `.olx-pik/` nosi i audit trag i potrosnju,
// i to klijentu ne treba. Alat pusta samo prijedloge i nista drugo.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function mapaPrijedloga(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_PRIJEDLOZI_DIR || ".olx-pik/prijedlozi";
}

export interface StavkaPrijedloga {
  ime: string;
  kada: string;
  znakova: number;
}

/** Sve datoteke prijedloga, najnovija prva. Prazan niz kad mape nema (runda jos nije radila). */
export function spisakPrijedloga(mapa = mapaPrijedloga()): StavkaPrijedloga[] {
  let imena: string[];
  try {
    imena = readdirSync(mapa).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    return [];
  }
  return imena
    .map((ime) => {
      try {
        const s = statSync(join(mapa, ime));
        return { ime, kada: new Date(s.mtimeMs).toISOString(), znakova: s.size };
      } catch {
        return null;
      }
    })
    .filter((x): x is StavkaPrijedloga => x !== null)
    .sort((a, b) => b.kada.localeCompare(a.kada));
}

/**
 * Sadrzaj jednog fajla prijedloga. Bez imena vraca najnoviji, jer je to ono sto se u praksi
 * uvijek trazi ("primijeni prijedloge").
 *
 * Ime se provjerava da ne moze izaci iz mape: alat prima ime od modela, a model prima poruke od
 * covjeka, pa je `../../.env` ono sto bi napad probao.
 */
export function procitajPrijedlog(ime?: string, mapa = mapaPrijedloga()): { ime: string; sadrzaj: string } | null {
  const spisak = spisakPrijedloga(mapa);
  if (spisak.length === 0) return null;

  let ciljano = spisak[0]!.ime;
  if (ime) {
    const trazeno = ime.trim();
    if (/[/\\]/.test(trazeno) || trazeno.includes("..")) {
      throw new Error("Ime fajla ne smije nositi putanju.");
    }
    const nadjen = spisak.find((s) => s.ime === trazeno);
    if (!nadjen) throw new Error(`Nema prijedloga "${trazeno}". Dostupno: ${spisak.map((s) => s.ime).join(", ")}.`);
    ciljano = nadjen.ime;
  }
  return { ime: ciljano, sadrzaj: readFileSync(join(mapa, ciljano), "utf8") };
}
