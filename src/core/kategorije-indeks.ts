// Suzavanje CSV indeksa kategorija na gornje nivoe stabla. Rez mora biti vidljiv (granice.md):
// napomena ide u komentar-redovima na vrh CSV-a, sa brojem prikazanih od ukupno redova.

// Dubina do koje se resurs olx://categories-index servira po defaultu. Nivo 1-2 pokriva top-level
// i prvu podjelu (344 od ~2030 redova), dovoljno za orijentaciju; dublje trazenje ide kroz
// olx_find_category / olx_category_children.
export const PODRAZUMIJEVAN_MAX_NIVO = 2;

export interface SuzenIndeksKategorija {
  /** Kompletan CSV tekst: napomena kao komentar-redovi (#), pa zaglavlje, pa suzeni redovi. */
  text: string;
  /** Koliko redova (bez zaglavlja) ima suzeni prikaz. */
  prikazano: number;
  /** Koliko redova (bez zaglavlja) ima izvorni CSV. */
  ukupno: number;
  /** Prag dubine koji je primijenjen. */
  maxNivo: number;
}

// Minimalni CSV parser jednog reda: razdvaja po zarezu van navodnika, "" unutar navodnika je
// escapovan navodnik. Ne podrzava polje sa prelomom reda unutar navodnika (kategorije nemaju).
function parsirajCsvRed(red: string): string[] {
  const polja: string[] = [];
  let trenutno = "";
  let uNavodnicima = false;
  for (let i = 0; i < red.length; i++) {
    const znak = red[i];
    if (uNavodnicima) {
      if (znak === '"') {
        if (red[i + 1] === '"') {
          trenutno += '"';
          i++;
        } else {
          uNavodnicima = false;
        }
      } else {
        trenutno += znak;
      }
    } else if (znak === '"') {
      uNavodnicima = true;
    } else if (znak === ",") {
      polja.push(trenutno);
      trenutno = "";
    } else {
      trenutno += znak;
    }
  }
  polja.push(trenutno);
  return polja;
}

/**
 * Suzava CSV index kategorija na redove ciji je `level` <= maxNivo. Zaglavlje i sve kolone
 * ostaju nepromijenjeni, mijenja se samo broj redova. Na vrh se dodaje vidljiva napomena o rezu.
 */
// Alati za dublje trazenje NISU isti u oba profila: olx_find_category i olx_category_children su
// u SAMO_ADMIN, pa u klijentskom profilu ne postoje. Uputa koja ih imenuje klijentu bi ga poslala
// na alat koji ne moze pozvati, a kategoriju klijent bira kroz olx_suggest_category. Zato uputa
// zavisi od profila, a ne moze biti jedna za oba.
function uputaZaDublje(zaKlijenta: boolean): string[] {
  if (zaKlijenta) {
    return [
      "# Dublje trazenje: olx_suggest_category (po kljucnoj rijeci, vraca i broj oglasa).",
      "# Obavezna polja forme: olx_category_attributes <id>.",
    ];
  }
  return [
    "# Dublje trazenje: olx_find_category (po imenu) i olx_category_children <id> (silazak niz stablo).",
    "# Obavezna polja forme: olx_category_attributes <id>.",
  ];
}

export function suziKategorijeIndeks(
  csv: string,
  maxNivo: number = PODRAZUMIJEVAN_MAX_NIVO,
  zaKlijenta = false,
): SuzenIndeksKategorija {
  const bezZavrsnogPreloma = csv.replace(/\r?\n$/, "");
  const redovi = bezZavrsnogPreloma.split(/\r?\n/);
  const zaglavljeRed = redovi[0] ?? "";
  const zaglavlje = parsirajCsvRed(zaglavljeRed);
  const nivoIdx = zaglavlje.indexOf("level");
  const podaci = redovi.slice(1).filter((r) => r.length > 0);
  const ukupno = podaci.length;

  const suzeni =
    nivoIdx === -1
      ? podaci
      : podaci.filter((red) => {
          const nivo = Number(parsirajCsvRed(red)[nivoIdx]);
          return Number.isFinite(nivo) && nivo <= maxNivo;
        });
  const prikazano = suzeni.length;

  const napomena = [
    `# OLX/PIK index kategorija - SUZEN na gornje nivoe stabla (nivo <= ${maxNivo}).`,
    `# Prikazano ${prikazano} od ${ukupno} kategorija ukupno.`,
    ...uputaZaDublje(zaKlijenta),
  ];

  const text = [...napomena, zaglavljeRed, ...suzeni].join("\n") + "\n";
  return { text, prikazano, ukupno, maxNivo };
}
