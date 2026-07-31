// Sitna pomoc za poredjenje teksta koji je napisao covjek.
//
// Zasto postoji: svaka provjera nad domacim tekstom se obara na dvije stvari, kvacicama i
// padezima. "oružje" i "oruzje" su ista rijec, a "osoba" i "osobu" takodjer. Zato se prije
// poredjenja tekst svede na mala slova bez kvacica, pa se gleda POCETAK tokena, ne cijela rijec.
//
// Koriste ga filter dopune za slike (slika.ts) i provjera zabranjene robe (zabranjena-roba.ts).

/** Mala slova bez kvacica: "Oružje" i "oruzje" postaju isto. */
export function normalizujTekst(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // NFD rastavi s na s + kvacicu, ovo brise kvacicu
    .replaceAll("đ", "d"); // d sa crtom nije kombinacija, NFD ga ne rastavlja
}

/** Tokeni normalizovanog teksta: samo slova i cifre, sve ostalo je granica. */
export function tokeni(tekst: string): string[] {
  return normalizujTekst(tekst)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
