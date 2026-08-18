// Klijent sam sebe koci PRIJE nego dobije 429, po endpointu, na osnovu ratelimit zaglavlja.
// Bez env varijable, bez liste imena endpointa: nov poziv na nov endpoint automatski dobija
// svoj brojac, jer se sablon putanje racuna generickim pravilom (kljucEndpointa), a ne popisom.
//
// Izmjereno na zivom API-ju (ne provjeravati ponovo):
// - Odgovori nose `x-ratelimit-limit: 60` i `x-ratelimit-remaining`, NEMA `x-ratelimit-reset`.
// - Limit je PO ENDPOINTU: `/users/{user}/listings` trosi brojac tacno jedan po pozivu (60
//   prodje, 61. dobije 429), prozor je jedna minuta (65s pauze vratilo remaining sa 0 na 59).
// - `/listings/{id}` skoro ne trosi brojac (80 poziva bez pauze, remaining 59 -> 56, nijedan 429).
// - Odgovor 429 ne nosi NIJEDNO ratelimit zaglavlje, ni retry-after.

// Prag ostatka pri kojem se pocinje samostalno cekati. Namjerno ispod nule tolerancije: cilj je
// da se stane PRIJE 429, ne tacno na granici.
export const PRAG_OSTATKA = 5;

// Duzina prozora servera, izmjereno gore. Server ne kazuje kad prozor pocinje ni kad se resetuje,
// pa se prozor prati lokalno (azurirajStanje) i ovo je jedina poznata duzina tog prozora.
// `let`, ne `const`: testovi (client.test.ts) je privremeno skrate preko funkcije ispod, da
// dokaz o samostalnom cekanju ne mora trajati stvarnih 60 sekundi. Van testova se ne mijenja.
export let PROZOR_MS = 60_000;

// Dodatna rezerva iznad kraja prozora, da se ne pogodi ivica zbog razlike u satu ili kasnjenja
// mreze izmedju nas i servera.
export let REZERVA_MS = 500;

/**
 * Samo za testove: mijenja PROZOR_MS/REZERVA_MS da test ne mora cekati stvarni prozor od
 * minute. Namjerno bez env varijable, jer bi env varijabla vazila i van testova.
 *
 * Zato PROZOR_MS i REZERVA_MS nisu `const`. Ko ih koristi, cita ih U TRENUTKU RACUNA i ne cuva
 * vrijednost u svojoj promjenljivoj ni u zatvaracu, jer bi keširana kopija preskocila preklapanje
 * i test bi cekao pravu minutu. Test koji ih mijenja MORA ih vratiti u `finally`.
 */
export function _testPostaviTempoKonstante(preklapanja: { prozorMs?: number; rezervaMs?: number }): void {
  if (preklapanja.prozorMs !== undefined) PROZOR_MS = preklapanja.prozorMs;
  if (preklapanja.rezervaMs !== undefined) REZERVA_MS = preklapanja.rezervaMs;
}

export interface StanjeTempa {
  remaining: number | null;
  limit: number | null;
  prozorPoceoMs: number;
}

/**
 * Normalizuje putanju u sablon endpointa, da brojac bude po ENDPOINTU a ne po konkretnom
 * resursu. Pravila: segment koji je cisto numericki postaje `*`; segment neposredno poslije
 * segmenta `users` postaje `*` (tamo je username, koji nije broj i nece ga pravilo "numericki"
 * pokupiti). Query string se odbacuje. Namjerno bez liste imena endpointa: novi slicni pozivi
 * tako automatski dobijaju svoj brojac.
 */
export function kljucEndpointa(putanja: string): string {
  const bezQuery = putanja.split("?")[0] ?? putanja;
  const segmenti = bezQuery.split("/");
  const rezultat: string[] = [];
  for (let i = 0; i < segmenti.length; i++) {
    const seg = segmenti[i] ?? "";
    const jeNumericki = seg.length > 0 && /^[0-9]+$/.test(seg);
    const jePoslijeUsers = i > 0 && segmenti[i - 1] === "users";
    rezultat.push(jeNumericki || jePoslijeUsers ? "*" : seg);
  }
  return rezultat.join("/");
}

/**
 * Cista funkcija: unosi ocitano stanje ratelimit zaglavlja u knjigu. Kad stanja nema, ili kad je
 * novi `remaining` VECI od zapamcenog, prozor se ocito resetovao (server ga je iznova napunio),
 * pa `prozorPoceoMs` krece od `sada`. Inace ostaje na starom, jer server ne kazuje kad je prozor
 * pocelo, ovo je jedini nacin da se to zna.
 */
export function azurirajStanje(
  staro: StanjeTempa | null,
  ocitano: { remaining: number | null; limit: number | null },
  sada: number,
): StanjeTempa {
  const noviProzor = staro === null || (ocitano.remaining !== null && staro.remaining !== null && ocitano.remaining > staro.remaining);
  return {
    remaining: ocitano.remaining,
    limit: ocitano.limit,
    prozorPoceoMs: noviProzor ? sada : staro.prozorPoceoMs,
  };
}

/**
 * Cista funkcija: koliko ms cekati PRIJE sljedeceg poziva na dati endpoint. Bez stanja ili sa
 * `remaining` iznad praga: 0 (nema razloga cekati). Na ili ispod praga: cekaj do kraja prozora
 * (plus rezerva); ako je taj trenutak vec prosao, prozor je istekao i brojac ce se osvjeziti sam,
 * pa se vraca 0.
 */
export function planKasnjenja(arg: { stanje: StanjeTempa | null; sada: number }): number {
  const { stanje, sada } = arg;
  if (stanje === null || stanje.remaining === null) return 0;
  if (stanje.remaining > PRAG_OSTATKA) return 0;

  const krajProzora = stanje.prozorPoceoMs + PROZOR_MS + REZERVA_MS;
  const preostalo = krajProzora - sada;
  return preostalo > 0 ? preostalo : 0;
}
