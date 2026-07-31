// Roba koja se po pravilima platforme ne smije oglasavati.
//
// Izvor je clan 8 Uslova koristenja PIK.ba (korpus:
// olx-dokumentacija/PIK-pomoc-korpus/clanci/uslovi-koristenja-208481969.md). Platforma tamo
// zadrzava pravo da oglas izmijeni, obrise ili ne objavi, bez obrazlozenja. Posljedica pada na
// klijenta, jer je oglas na njegovom nalogu i on je po istom clanu odgovoran za sadrzaj.
//
// SVJESNA ODLUKA: ovo UPOZORAVA i trazi potvrdu, ne blokira.
// Podudaranje kljucnih rijeci nad domacim tekstom oglasa daje i lazne pozitive i propuste. Za
// klijenta koji placa uslugu je blokirana legitimna prodaja veca steta od rijetkog spornog
// oglasa, a tiho propustanje je ipak najgore. Zato se sporan oglas ne moze objaviti bez izricite
// potvrde, isto kao oglas koji kosta kredite, i zato lista ostaje uska i visoke pouzdanosti.
//
// Sta NIJE na listi i zasto: oruzje i municija. Clan 8 ih ne navodi, a lovacko i sportsko oruzje
// se u BiH legalno prodaje uz dozvolu, pa bi upozorenje na svaki takav oglas bilo smetnja
// prodavcu, a ne zastita.

import { normalizujTekst, tokeni } from "./tekst.js";

export interface PogodakRobe {
  /** Rijec ili izraz koji je pronadjen u tekstu oglasa. */
  pojam: string;
  /** Zasto je sporno, jezikom clana 8, da se korisniku moze reci bez citanja pravilnika. */
  kategorija: string;
}

interface Pravilo {
  kategorija: string;
  /** Podudara se po POCETKU tokena, zbog padeza: "ukraden" hvata i "ukradeno" i "ukradenu". */
  korijeni?: string[];
  /** Podudara se kao podniz normalizovanog teksta; za pojmove od vise rijeci. */
  fraze?: string[];
}

const PRAVILA: Pravilo[] = [
  {
    kategorija: "lijekovi i recepti",
    korijeni: ["xanax", "ksalol", "bensedin", "apaurin", "diazepam", "tramadol", "morfij", "oksikodon", "fentanil"],
    fraze: ["lijekovi na recept", "lijek na recept", "recept za lijek", "bez recepta ljekara"],
  },
  {
    kategorija: "narkotici",
    korijeni: ["narkotik", "kokain", "heroin", "marihuan", "kanabis", "amfetamin", "hasis", "ekstazi"],
  },
  {
    kategorija: "ukradena ili ilegalna roba",
    korijeni: ["ukraden"],
    fraze: ["bez papira i porijekla", "ne pitaj odakle"],
  },
  {
    kategorija: "licni dokumenti",
    fraze: ["licna karta", "licne karte", "pasos na prodaju", "vozacka dozvola na prodaju", "gotova diploma"],
  },
  {
    kategorija: "ljudski organi",
    fraze: ["ljudski organ", "ljudske organe", "prodajem bubreg"],
  },
  {
    kategorija: "pornografija",
    korijeni: ["pornograf", "porno"],
  },
  {
    kategorija: "oprema za prisluskivanje i pracenje",
    korijeni: ["prisluskiv"],
    fraze: ["spijunska kamera", "buba za snimanje"],
  },
  {
    kategorija: "replike i falsifikati",
    korijeni: ["replika", "replike", "imitacij", "falsifikat"],
    fraze: ["ap kvalitet", "prva kopija"],
  },
  {
    kategorija: "ilegalne kopije autorskih djela",
    korijeni: ["piratsk", "krekovan"],
    fraze: ["krekovana verzija", "crack ukljucen", "bez licence, radi sve"],
  },
  {
    kategorija: "zasticene zivotinje",
    fraze: ["zasticena vrsta", "zasticene vrste"],
  },
];

/**
 * Nadje pojmove iz clana 8 u tekstu oglasa. Prazna lista znaci da nista nije zapelo, NE znaci da
 * je oglas siguran: lista je uska namjerno, jer je upozorenje korisno samo dok mu se vjeruje.
 *
 * Cista funkcija: bez diska, mreze i konfiguracije.
 */
export function provjeriRobu(naslov: string, opis?: string): PogodakRobe[] {
  const spojeno = `${naslov ?? ""} ${opis ?? ""}`;
  const normalizovano = normalizujTekst(spojeno);
  const rijeci = tokeni(spojeno);
  const nadjeno: PogodakRobe[] = [];
  const vec = new Set<string>();

  for (const pravilo of PRAVILA) {
    for (const fraza of pravilo.fraze ?? []) {
      if (normalizovano.includes(fraza) && !vec.has(fraza)) {
        vec.add(fraza);
        nadjeno.push({ pojam: fraza, kategorija: pravilo.kategorija });
      }
    }
    for (const korijen of pravilo.korijeni ?? []) {
      const pogodak = rijeci.find((r) => r.startsWith(korijen));
      if (pogodak && !vec.has(pogodak)) {
        vec.add(pogodak);
        nadjeno.push({ pojam: pogodak, kategorija: pravilo.kategorija });
      }
    }
  }
  return nadjeno;
}

/** Kratko objasnjenje za korisnika, bez citiranja pravilnika. */
export function objasniPogotke(pogoci: PogodakRobe[]): string {
  const kategorije = [...new Set(pogoci.map((p) => p.kategorija))];
  // Imena kategorija su u nominativu, pa recenica mora biti gradjena tako da u nju stanu bez
  // mijenjanja padeza; "Oglas spominje lijekovi i recepti" bi zvucalo kao prevod.
  return (
    `Oglas je sporan zbog: ${kategorije.join(", ")}. Takva roba se po pravilima platforme ` +
    `(clan 8 Uslova koristenja) ne smije oglasavati, pa oglas moze biti uklonjen, a nalog blokiran.`
  );
}
